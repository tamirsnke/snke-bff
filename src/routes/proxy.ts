import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { businessMetrics } from '../config/monitoring';
import { config } from '../config';

const router = Router();

// Proxy configuration for different services
const proxyConfigs = {
  api1: {
    target: 'http://localhost:3001',
    pathRewrite: {
      '^/api/proxy/api1': '',
    },
  },
  api2: {
    target: 'http://localhost:3002',
    pathRewrite: {
      '^/api/proxy/api2': '',
    },
  },
  legacy: {
    target: 'http://localhost:3003',
    pathRewrite: {
      '^/api/proxy/legacy': '',
    },
  },
};

// Create proxy middleware for each service
Object.entries(proxyConfigs).forEach(([serviceName, proxyConfig]) => {
  const proxyMiddleware = createProxyMiddleware({
    target: proxyConfig.target,
    changeOrigin: true,
    pathRewrite: proxyConfig.pathRewrite,
    onProxyReq: (proxyReq, req: any) => {
      // Add authentication headers
      if (req.user?.accessToken) {
        proxyReq.setHeader('Authorization', `Bearer ${req.user.accessToken}`);
      }

      // Add user context headers
      if (req.user) {
        proxyReq.setHeader('X-User-ID', req.user.id);
        proxyReq.setHeader('X-User-Roles', req.user.roles.join(','));
        proxyReq.setHeader('X-User-Email', req.user.email);
      }

      // Add tracing headers
      proxyReq.setHeader('X-Request-ID', req.headers['x-request-id'] || '');
      proxyReq.setHeader('X-Forwarded-For', req.ip || '');

      logger.info('Proxying request', {
        service: serviceName,
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        target: proxyConfig.target,
      });

      businessMetrics.recordApiUsage(`/proxy/${serviceName}`, req.user?.roles[0] || 'anonymous');
    },
    onProxyRes: (proxyRes, req: any) => {
      logger.info('Proxy response', {
        service: serviceName,
        path: req.path,
        statusCode: proxyRes.statusCode,
        userId: req.user?.id,
      });
    },
    onError: (err, req: any, res) => {
      logger.error('Proxy error', {
        service: serviceName,
        error: err.message,
        path: req.path,
        userId: req.user?.id,
      });

      res.status(502).json({
        error: 'Bad Gateway',
        message: `Service ${serviceName} is currently unavailable`,
        service: serviceName,
      });
    },
    // Security configurations
    secure: process.env.NODE_ENV === 'production',
    followRedirects: false,
    xfwd: true,
  });

  // Mount the proxy middleware for each service
  router.use(`/${serviceName}/*`, proxyMiddleware);
});

// Health check for proxied services
router.get(
  '/health',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const healthChecks = await Promise.allSettled(
      Object.entries(proxyConfigs).map(async ([serviceName, config]) => {
        try {
          const response = await fetch(`${config.target}/health`, {
            method: 'GET',
          });

          return {
            service: serviceName,
            status: response.ok ? 'healthy' : 'unhealthy',
            statusCode: response.status,
            target: config.target,
          };
        } catch (error) {
          return {
            service: serviceName,
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error',
            target: config.target,
          };
        }
      })
    );

    const results = healthChecks.map((check, index) => {
      const serviceName = Object.keys(proxyConfigs)[index];
      if (check.status === 'fulfilled') {
        return check.value;
      } else {
        return {
          service: serviceName,
          status: 'error',
          error: check.reason?.message || 'Health check failed',
          target: proxyConfigs[serviceName as keyof typeof proxyConfigs].target,
        };
      }
    });

    const allHealthy = results.every((result) => result.status === 'healthy');

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      services: results,
      timestamp: new Date().toISOString(),
    });
  })
);

// Service discovery endpoint
router.get(
  '/services',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const services = Object.entries(proxyConfigs).map(([name, config]) => ({
      name,
      target: config.target,
      proxy_path: `/api/proxy/${name}`,
    }));

    res.json({ services });
  })
);

export default router;
