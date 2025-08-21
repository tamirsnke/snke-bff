import express from 'express';
import session from 'express-session';
import RedisStore from 'connect-redis';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { config } from '@/config';
import { getRedis } from '@/config/redis';
import { httpLogger, correlationIdMiddleware } from '@/utils/logger';
import { metricsMiddleware } from '@/config/monitoring';
import { authMiddleware } from '@/middleware/auth';
import { errorHandler } from '@/middleware/errorHandler';
import { validationMiddleware } from '@/middleware/validation';
import { circuitBreakerMiddleware } from '@/middleware/circuitBreaker';

export function setupMiddleware(app: express.Application): void {
  // Trust proxy for production deployments behind load balancers
  if (config.isProduction) {
    app.set('trust proxy', 1);
  }

  // Security middleware - must be first
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS configuration
  app.use(
    cors({
      origin: config.cors.origin,
      credentials: config.cors.credentials,
      optionsSuccessStatus: 200,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'X-Correlation-ID',
        'X-API-Key',
      ],
      exposedHeaders: ['X-Correlation-ID'],
    })
  );

  // Request parsing middleware
  app.use(
    express.json({
      limit: '10mb',
      strict: true,
    })
  );
  app.use(
    express.urlencoded({
      extended: true,
      limit: '10mb',
    })
  );
  app.use(cookieParser());

  // Compression for responses
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );

  // Correlation ID middleware
  app.use(correlationIdMiddleware);

  // Logging middleware
  app.use(httpLogger);

  // Metrics collection middleware
  if (config.features.metrics) {
    app.use(metricsMiddleware);
  }

  // Rate limiting middleware
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    skipSuccessfulRequests: config.rateLimit.skipSuccessfulRequests,
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req): string => {
      // Use IP address and user ID if available for rate limiting
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const userId = (req as any).user?.id;
      return userId ? `${ip}:${userId}` : ip;
    },
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/health' || req.path === '/metrics';
    },
  });

  app.use(limiter);

  // Session configuration
  const sessionConfig: session.SessionOptions = {
    secret: config.session.secret,
    name: config.session.name,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: config.session.secure,
      httpOnly: config.session.httpOnly,
      maxAge: config.session.maxAge,
      sameSite: config.session.sameSite,
    },
  };

  // Use Redis store if available, fallback to memory store
  if (config.session.store === 'redis') {
    try {
      const redis = getRedis();
      if (redis.isConnected) {
        sessionConfig.store = new RedisStore({
          client: redis.client as any,
          prefix: 'bff:session:',
        });
      }
    } catch (error) {
      console.warn('Redis not available, using memory session store');
    }
  }

  app.use(session(sessionConfig));

  // Circuit breaker middleware for external services
  app.use('/api/external', circuitBreakerMiddleware);

  // Request validation middleware
  app.use(validationMiddleware);

  // Authentication middleware (applied to protected routes)
  app.use('/api', authMiddleware as express.RequestHandler);

  // Error handling middleware (must be last)
  app.use(errorHandler);
}
