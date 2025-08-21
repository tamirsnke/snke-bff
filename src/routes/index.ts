import express from 'express';
import { Request, Response } from 'express';
import promClient from 'prom-client';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';
import { config } from '@/config';
import { getDatabase } from '@/config/database';
import { getRedis } from '@/config/redis';
import { getCircuitBreakerStats } from '@/middleware/circuitBreaker';
import { notFoundHandler } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

// Import route modules
import authRoutes from '@/routes/auth';
import userRoutes from '@/routes/users';
import adminRoutes from '@/routes/admin';
import proxyRoutes from '@/routes/proxy';

export function setupRoutes(app: express.Application): void {
  // Health check endpoint
  if (config.features.healthCheck) {
    app.get('/health', healthCheck);
    app.get('/health/detailed', detailedHealthCheck);
  }

  // Metrics endpoint
  if (config.features.metrics) {
    app.get('/metrics', metricsEndpoint);
  }

  // API documentation
  if (config.features.apiDocs) {
    try {
      const swaggerDocument = YAML.load(path.join(__dirname, '../docs/swagger.yml'));
      app.use(
        '/api-docs',
        swaggerUi.serve,
        swaggerUi.setup(swaggerDocument, {
          explorer: true,
          customCss: '.swagger-ui .topbar { display: none }',
          customSiteTitle: 'BFF API Documentation',
        })
      );
    } catch (error) {
      console.warn('Could not load Swagger documentation', error);
    }
  }

  // Authentication routes
  app.use('/auth', authRoutes);

  // API routes
  app.use('/api/users', userRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/proxy', proxyRoutes);

  // Static files
  app.use('/static', express.static(path.join(__dirname, '../public')));

  // Catch-all for undefined routes
  app.use('*', notFoundHandler);
}

async function healthCheck(req: Request, res: Response): Promise<void> {
  try {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.env,
      version: process.env.npm_package_version || '1.0.0',
    };

    res.status(200).json(health);
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      message: 'Health check failed',
    });
  }
}

async function detailedHealthCheck(req: Request, res: Response): Promise<void> {
  const checks: Record<string, any> = {};
  let overallStatus = 'ok';

  // Database health check
  try {
    const db = getDatabase();
    const result = await db.query('SELECT 1');
    checks.database = {
      status: 'ok',
      responseTime: 'fast',
    };
  } catch (error) {
    checks.database = {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    overallStatus = 'error';
  }

  // Redis health check
  try {
    const redis = getRedis();
    if (redis.isConnected) {
      await redis.client.ping();
      checks.redis = {
        status: 'ok',
        connected: true,
      };
    } else {
      checks.redis = {
        status: 'warning',
        connected: false,
        message: 'Redis not connected, using fallback',
      };
      if (overallStatus === 'ok') overallStatus = 'warning';
    }
  } catch (error) {
    checks.redis = {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    overallStatus = 'error';
  }

  // Memory usage
  const memoryUsage = process.memoryUsage();
  checks.memory = {
    status: 'ok',
    usage: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
    },
  };

  // Circuit breaker status
  checks.circuitBreakers = getCircuitBreakerStats();

  const statusCode = overallStatus === 'ok' ? 200 : overallStatus === 'warning' ? 200 : 503;

  const health = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.env,
    version: process.env.npm_package_version || '1.0.0',
    checks,
  };

  res.status(statusCode).json(health);
}

async function metricsEndpoint(req: Request, res: Response): Promise<void> {
  try {
    res.set('Content-Type', promClient.register.contentType);
    const metrics = await promClient.register.metrics();
    res.end(metrics);
  } catch (error) {
    console.error('Metrics endpoint error:', error);
    res.status(500).json({
      error: 'Failed to collect metrics',
    });
  }
}
