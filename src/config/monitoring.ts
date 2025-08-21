import promClient from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import * as Sentry from '@sentry/node';
import * as Tracing from '@sentry/tracing';
import { config } from '@/config';
import { logger } from '@/utils/logger';

// Prometheus metrics
export const metrics = {
  httpRequestDuration: new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  }),

  httpRequestsTotal: new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
  }),

  activeConnections: new promClient.Gauge({
    name: 'active_connections',
    help: 'Number of active connections',
  }),

  databaseConnections: new promClient.Gauge({
    name: 'database_connections',
    help: 'Number of database connections',
    labelNames: ['state'],
  }),

  redisConnections: new promClient.Gauge({
    name: 'redis_connections',
    help: 'Number of Redis connections',
    labelNames: ['state'],
  }),

  authenticationAttempts: new promClient.Counter({
    name: 'authentication_attempts_total',
    help: 'Total number of authentication attempts',
    labelNames: ['result', 'method'],
  }),

  authorizationChecks: new promClient.Counter({
    name: 'authorization_checks_total',
    help: 'Total number of authorization checks',
    labelNames: ['result', 'resource'],
  }),

  externalApiCalls: new promClient.Histogram({
    name: 'external_api_call_duration_seconds',
    help: 'Duration of external API calls in seconds',
    labelNames: ['service', 'endpoint', 'status_code'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  }),

  cacheOperations: new promClient.Histogram({
    name: 'cache_operation_duration_seconds',
    help: 'Duration of cache operations in seconds',
    labelNames: ['operation', 'result'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  }),

  businessMetrics: {
    userLogins: new promClient.Counter({
      name: 'user_logins_total',
      help: 'Total number of user logins',
      labelNames: ['success'],
    }),

    userSessions: new promClient.Gauge({
      name: 'active_user_sessions',
      help: 'Number of active user sessions',
    }),

    apiUsage: new promClient.Counter({
      name: 'api_usage_total',
      help: 'Total API usage by endpoint',
      labelNames: ['endpoint', 'user_role'],
    }),
  },
};

let sdk: NodeSDK;

export async function initializeMonitoring(): Promise<void> {
  try {
    // Initialize Sentry for error tracking
    if (config.monitoring.sentryDsn) {
      Sentry.init({
        dsn: config.monitoring.sentryDsn,
        environment: config.env,
        integrations: [
          new Sentry.Integrations.Http({ tracing: true }),
          new Tracing.Integrations.Express({ app: undefined }),
        ],
        tracesSampleRate: config.isProduction ? 0.1 : 1.0,
        beforeSend: (event) => {
          // Filter out sensitive information
          if (event.request?.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
          return event;
        },
      });

      console.log('Sentry error tracking initialized');
    }

    // Initialize OpenTelemetry for distributed tracing
    if (config.features.tracing) {
      sdk = new NodeSDK({
        instrumentations: [
          new HttpInstrumentation({
            ignoreIncomingRequestHook: (req: any) => {
              // Ignore health checks and metrics endpoints
              const url = req.url || '';
              return url.includes('/health') || url.includes('/metrics');
            },
          }),
          new ExpressInstrumentation(),
          new PgInstrumentation(),
          new RedisInstrumentation(),
        ],
        traceExporter: new JaegerExporter({
          endpoint: config.monitoring.jaegerEndpoint,
        }),
      });

      sdk.start();
      console.log('OpenTelemetry tracing initialized');
    }

    // Register default Prometheus metrics
    promClient.collectDefaultMetrics({
      prefix: 'bff_',
      register: promClient.register,
    });

    // Add custom metrics collection
    setInterval(() => {
      collectCustomMetrics();
    }, 10000); // Collect every 10 seconds

    console.log('Prometheus metrics initialized');
  } catch (error) {
    console.error('Failed to initialize monitoring:', error);
    throw error;
  }
}

function collectCustomMetrics(): void {
  try {
    // Database connection metrics would be collected here
    // This is a placeholder - in real implementation, you'd get actual connection counts
    metrics.databaseConnections.set({ state: 'active' }, 5);
    metrics.databaseConnections.set({ state: 'idle' }, 10);

    // Redis connection metrics
    metrics.redisConnections.set({ state: 'connected' }, 1);

    // Business metrics collection would go here
    // Example: metrics.businessMetrics.userSessions.set(getActiveUserCount());
  } catch (error) {
    console.error('Error collecting custom metrics:', error);
  }
}

// Middleware to track HTTP metrics
export function metricsMiddleware(req: any, res: any, next: any): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path || 'unknown';
    const method = req.method;
    const statusCode = res.statusCode.toString();

    metrics.httpRequestDuration.labels(method, route, statusCode).observe(duration);

    metrics.httpRequestsTotal.labels(method, route, statusCode).inc();
  });

  next();
}

// Helper functions for business metrics
export const businessMetrics = {
  recordLogin: (success: boolean): void => {
    metrics.businessMetrics.userLogins.labels(success.toString()).inc();
  },

  recordApiUsage: (endpoint: string, userRole: string): void => {
    metrics.businessMetrics.apiUsage.labels(endpoint, userRole).inc();
  },

  updateActiveUserSessions: (count: number): void => {
    metrics.businessMetrics.userSessions.set(count);
  },

  recordAuthAttempt: (result: 'success' | 'failure', method: string): void => {
    metrics.authenticationAttempts.labels(result, method).inc();
  },

  recordAuthzCheck: (result: 'allowed' | 'denied', resource: string): void => {
    metrics.authorizationChecks.labels(result, resource).inc();
  },

  recordUserAction: (action: string, userId: string): void => {
    metrics.businessMetrics.apiUsage.labels(action, userId).inc();
  },

  recordExternalApiCall: (
    service: string,
    endpoint: string,
    duration: number,
    statusCode: number
  ): void => {
    metrics.externalApiCalls
      .labels(service, endpoint, statusCode.toString())
      .observe(duration / 1000);
  },

  recordCacheOperation: (
    operation: string,
    result: 'hit' | 'miss' | 'error',
    duration: number
  ): void => {
    metrics.cacheOperations.labels(operation, result).observe(duration / 1000);
  },
};

// Graceful shutdown for monitoring
export async function shutdownMonitoring(): Promise<void> {
  try {
    if (sdk) {
      await sdk.shutdown();
      console.log('OpenTelemetry SDK shutdown');
    }

    if (config.monitoring.sentryDsn) {
      await Sentry.close(2000);
      console.log('Sentry client closed');
    }

    console.log('Monitoring services shutdown completed');
  } catch (error) {
    console.error('Error during monitoring shutdown:', error);
  }
}
