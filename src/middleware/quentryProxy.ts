import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getRedis } from '../config/redis';

// Redis key prefix for Quentry sessions
const REDIS_KEY_PREFIX = 'quentry_session:';

/**
 * Creates proxy middleware for Quentry API requests
 */
export function createQuentryProxyMiddleware() {
  const options: Options = {
    target: config.quentry.baseUrl,
    changeOrigin: true,
    pathRewrite: {
      '^/quentry/api': '/api/r8', // Rewrite from /quentry/api to /api/r8
    },
    logLevel: 'silent', // We'll handle logging ourselves
    onProxyReq: async (proxyReq, req: Request, res: Response) => {
      try {
        // Get user from Keycloak session
        const session = req.session as any;
        if (!session?.user?.id) {
          res.status(401).json({ error: 'Not authenticated with Keycloak' });
          return;
        }

        // Get Quentry session from Redis
        const redis = getRedis();
        const quentrySessionJson = await redis.get(`${REDIS_KEY_PREFIX}${session.user.id}`);
        if (!quentrySessionJson) {
          res.status(401).json({
            error: 'Not authenticated with Quentry',
            message: 'Please login to Quentry first',
          });
          return;
        }

        const quentrySession = JSON.parse(quentrySessionJson);

        // Check if session is expired
        if (quentrySession.expires <= Date.now()) {
          await redis.del(`${REDIS_KEY_PREFIX}${session.user.id}`);
          res.status(401).json({
            error: 'Quentry session expired',
            message: 'Please login to Quentry again',
          });
          return;
        }

        // Add Quentry authentication headers
        proxyReq.setHeader('Authorization', `Token ${quentrySession.token}`);

        // Add required cookies
        if (config.quentry.cookies) {
          proxyReq.setHeader('Cookie', config.quentry.cookies);
        }

        logger.debug('Proxying request to Quentry', {
          method: req.method,
          path: req.path,
          targetPath: req.path.replace('/quentry/api', '/api/r8'),
        });
      } catch (error: any) {
        logger.error('Error in Quentry proxy middleware', {
          error: error?.message || 'Unknown error',
        });
        res.status(500).json({ error: 'Internal server error' });
      }
    },
    onProxyRes: (proxyRes, req: Request, res: Response) => {
      logger.debug('Quentry proxy response', {
        method: req.method,
        path: req.path,
        status: proxyRes.statusCode,
      });
    },
    onError: (err, req, res) => {
      logger.error('Quentry proxy error', { error: err.message });
      res.status(500).json({ error: 'Quentry service unavailable' });
    },
  };

  return createProxyMiddleware(options);
}

/**
 * Middleware to check if user is authenticated with Quentry
 */
export async function ensureQuentryAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Get user from Keycloak session
    const session = req.session as any;
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Not authenticated with Keycloak' });
    }

    // Get Quentry session from Redis
    const redis = getRedis();
    const quentrySessionJson = await redis.get(`${REDIS_KEY_PREFIX}${session.user.id}`);
    if (!quentrySessionJson) {
      return res.status(401).json({
        error: 'Not authenticated with Quentry',
        message: 'Please login to Quentry first',
      });
    }

    const quentrySession = JSON.parse(quentrySessionJson);

    // Check if session is expired
    if (quentrySession.expires <= Date.now()) {
      await redis.del(`${REDIS_KEY_PREFIX}${session.user.id}`);
      return res.status(401).json({
        error: 'Quentry session expired',
        message: 'Please login to Quentry again',
      });
    }

    // Add Quentry session to request for later use
    (req as any).quentrySession = quentrySession;

    next();
  } catch (error: any) {
    logger.error('Quentry auth middleware error', { error: error?.message || 'Unknown error' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
