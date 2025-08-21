import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { config } from '@/config';
import { businessMetrics } from '@/config/monitoring';

interface CircuitBreakerOptions {
  threshold: number;
  timeout: number;
  resetTimeout: number;
  monitor?: boolean;
}

interface CircuitBreakerState {
  failures: number;
  nextAttempt: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

class SimpleCircuitBreaker {
  private name: string;
  private threshold: number;
  private timeout: number;
  private resetTimeout: number;

  constructor(name: string, options: CircuitBreakerOptions) {
    this.name = name;
    this.threshold = options.threshold;
    this.timeout = options.timeout;
    this.resetTimeout = options.resetTimeout;

    if (!circuitBreakers.has(name)) {
      circuitBreakers.set(name, {
        failures: 0,
        nextAttempt: 0,
        state: 'CLOSED',
      });
    }
  }

  private getState(): CircuitBreakerState {
    return circuitBreakers.get(this.name)!;
  }

  private setState(state: Partial<CircuitBreakerState>): void {
    const current = this.getState();
    circuitBreakers.set(this.name, { ...current, ...state });
  }

  public isOpen(): boolean {
    const state = this.getState();
    const now = Date.now();

    if (state.state === 'OPEN' && now > state.nextAttempt) {
      this.setState({ state: 'HALF_OPEN' });
      logger.info(`Circuit breaker half-opened for ${this.name}`);
      return false;
    }

    return state.state === 'OPEN';
  }

  public isHalfOpen(): boolean {
    return this.getState().state === 'HALF_OPEN';
  }

  public isClosed(): boolean {
    return this.getState().state === 'CLOSED';
  }

  public record(error: Error | null): void {
    const state = this.getState();
    const now = Date.now();

    if (error) {
      const newFailures = state.failures + 1;

      if (newFailures >= this.threshold) {
        this.setState({
          state: 'OPEN',
          failures: newFailures,
          nextAttempt: now + this.resetTimeout,
        });

        logger.warn(`Circuit breaker opened for ${this.name}`, {
          circuitBreaker: this.name,
          failures: newFailures,
          threshold: this.threshold,
        });
      } else {
        this.setState({ failures: newFailures });
      }
    } else {
      // Success - reset failures and close circuit if it was half-open
      if (state.state === 'HALF_OPEN') {
        this.setState({ state: 'CLOSED', failures: 0 });
        logger.info(`Circuit breaker closed for ${this.name}`);
      } else if (state.state === 'CLOSED') {
        this.setState({ failures: Math.max(0, state.failures - 1) });
      }
    }
  }

  public reset(): void {
    this.setState({ state: 'CLOSED', failures: 0, nextAttempt: 0 });
  }

  public forceOpen(): void {
    this.setState({ state: 'OPEN', nextAttempt: Date.now() + this.resetTimeout });
  }

  public forceClosed(): void {
    this.setState({ state: 'CLOSED', failures: 0, nextAttempt: 0 });
  }

  public getFailures(): number {
    return this.getState().failures;
  }

  public getLastFailure(): number {
    return this.getState().nextAttempt - this.resetTimeout;
  }
}

export function createCircuitBreaker(
  name: string,
  options: CircuitBreakerOptions = {
    threshold: config.circuitBreaker.threshold,
    timeout: config.circuitBreaker.timeout,
    resetTimeout: config.circuitBreaker.resetTimeout,
    monitor: true,
  }
): SimpleCircuitBreaker {
  const existingBreaker = circuitBreakers.get(name);
  if (existingBreaker) {
    return new SimpleCircuitBreaker(name, options);
  }

  const breaker = new SimpleCircuitBreaker(name, options);
  return breaker;
}

export function circuitBreakerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Response | void {
  // Extract service name from the route
  const serviceName = extractServiceName(req.path);

  if (!serviceName) {
    return next();
  }

  const breaker = createCircuitBreaker(serviceName);

  // Wrap the response handling
  const originalSend = res.send;
  res.send = function (data: any) {
    const statusCode = res.statusCode;

    if (statusCode >= 500) {
      // Circuit breaker should be notified of failures
      breaker.record(new Error(`HTTP ${statusCode}`));
    } else {
      // Record success
      breaker.record(null);
    }

    return originalSend.call(this, data);
  };

  // Check circuit breaker state
  if (breaker.isOpen()) {
    logger.warn('Circuit breaker is open, rejecting request', {
      service: serviceName,
      path: req.path,
    });

    businessMetrics.recordExternalApiCall(serviceName, req.path, 0, 503);

    return res.status(503).json({
      error: 'Service Unavailable',
      message: `Service ${serviceName} is temporarily unavailable`,
      retryAfter: Math.ceil(config.circuitBreaker.resetTimeout / 1000),
    });
  }

  next();
}

function extractServiceName(path: string): string | null {
  // Extract service name from path patterns like:
  // /api/external/user-service/... -> user-service
  // /api/external/order-service/... -> order-service
  const match = path.match(/^\/api\/external\/([^\/]+)/);
  return match ? match[1] : null;
}

// Health check circuit breaker wrapper
export function withCircuitBreaker<T extends any[], R>(
  serviceName: string,
  fn: (...args: T) => Promise<R>,
  options?: Partial<CircuitBreakerOptions>
): (...args: T) => Promise<R> {
  const breaker = createCircuitBreaker(serviceName, {
    threshold: config.circuitBreaker.threshold,
    timeout: config.circuitBreaker.timeout,
    resetTimeout: config.circuitBreaker.resetTimeout,
    monitor: true,
    ...options,
  });

  return async (...args: T): Promise<R> => {
    if (breaker.isOpen()) {
      logger.warn(`Circuit breaker is open for ${serviceName}`, {
        service: serviceName,
      });
      throw new Error(`Circuit breaker is open for ${serviceName}`);
    }

    const start = Date.now();

    try {
      const result = await fn(...args);
      const duration = Date.now() - start;

      breaker.record(null);

      businessMetrics.recordExternalApiCall(serviceName, 'function_call', duration, 200);

      return result;
    } catch (error) {
      const duration = Date.now() - start;

      breaker.record(error as Error);

      businessMetrics.recordExternalApiCall(serviceName, 'function_call', duration, 500);

      throw error;
    }
  };
}

// Get circuit breaker stats
export function getCircuitBreakerStats(): Record<string, any> {
  const stats: Record<string, any> = {};

  for (const [name] of circuitBreakers) {
    const state = circuitBreakers.get(name)!;
    stats[name] = {
      state: state.state,
      isOpen: state.state === 'OPEN',
      isHalfOpen: state.state === 'HALF_OPEN',
      isClosed: state.state === 'CLOSED',
      failures: state.failures,
      nextAttempt: state.nextAttempt,
    };
  }

  return stats;
}

// Reset circuit breaker
export function resetCircuitBreaker(name: string): boolean {
  const state = circuitBreakers.get(name);
  if (state) {
    circuitBreakers.set(name, {
      state: 'CLOSED',
      failures: 0,
      nextAttempt: 0,
    });
    logger.info(`Circuit breaker reset for ${name}`);
    return true;
  }
  return false;
}

// Force circuit breaker open (for maintenance)
export function forceCircuitBreakerOpen(name: string): boolean {
  const state = circuitBreakers.get(name);
  if (state) {
    circuitBreakers.set(name, {
      ...state,
      state: 'OPEN',
      nextAttempt: Date.now() + config.circuitBreaker.resetTimeout,
    });
    logger.warn(`Circuit breaker forced open for ${name}`);
    return true;
  }
  return false;
}

// Force circuit breaker closed
export function forceCircuitBreakerClosed(name: string): boolean {
  const state = circuitBreakers.get(name);
  if (state) {
    circuitBreakers.set(name, {
      state: 'CLOSED',
      failures: 0,
      nextAttempt: 0,
    });
    logger.info(`Circuit breaker forced closed for ${name}`);
    return true;
  }
  return false;
}
