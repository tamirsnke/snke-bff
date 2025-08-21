import pino from 'pino';
import pinoHttp from 'pino-http';

// Create a safe logger that doesn't depend on config initially
let loggerConfig;
try {
  const { config } = require('@/config');
  loggerConfig = config;
} catch (error) {
  // Fallback configuration if config loading fails
  loggerConfig = {
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      format: process.env.LOG_FORMAT || 'json',
    },
    isDevelopment: process.env.NODE_ENV === 'development',
  };
}

// Create base logger
const baseLogger = pino({
  level: loggerConfig.logging.level,
  transport:
    loggerConfig.isDevelopment && loggerConfig.logging.format === 'pretty'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            levelFirst: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'secret',
      'apiKey',
      'access_token',
      'refresh_token',
    ],
    censor: '[REDACTED]',
  },
});

// Create HTTP logger middleware
export const httpLogger = pinoHttp({
  logger: baseLogger,
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    } else if (res.statusCode >= 300 && res.statusCode < 400) {
      return 'silent';
    }
    return 'info';
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      query: req.query,
      params: req.params,
      headers: {
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-real-ip': req.headers['x-real-ip'],
      },
      remoteAddress: req.remoteAddress,
      remotePort: req.remotePort,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
      headers: {
        'content-type': res.headers['content-type'],
        'content-length': res.headers['content-length'],
      },
    }),
    err: pino.stdSerializers.err,
  },
  customProps: (req) => ({
    correlationId: req.headers['x-correlation-id'] || req.id,
    userId: (req as any).user?.id,
    sessionId: (req as any).sessionID,
  }),
});

// Enhanced logger with additional methods
export const logger = {
  ...baseLogger,

  // Security logging
  security: {
    loginAttempt: (data: {
      userId?: string;
      username?: string;
      ip?: string;
      success: boolean;
      reason?: string;
    }) => {
      baseLogger.info(
        {
          event: 'login_attempt',
          ...data,
        },
        `Login attempt ${data.success ? 'successful' : 'failed'}`
      );
    },

    accessDenied: (data: {
      userId?: string;
      resource: string;
      action: string;
      ip?: string;
      reason?: string;
    }) => {
      baseLogger.warn(
        {
          event: 'access_denied',
          ...data,
        },
        'Access denied'
      );
    },

    suspiciousActivity: (data: {
      userId?: string;
      activity: string;
      ip?: string;
      details?: any;
    }) => {
      baseLogger.warn(
        {
          event: 'suspicious_activity',
          ...data,
        },
        'Suspicious activity detected'
      );
    },

    tokenValidation: (data: {
      userId?: string;
      tokenType: string;
      valid: boolean;
      reason?: string;
    }) => {
      baseLogger.debug(
        {
          event: 'token_validation',
          ...data,
        },
        `Token validation ${data.valid ? 'successful' : 'failed'}`
      );
    },
  },

  // Performance logging
  performance: {
    dbQuery: (data: { query: string; duration: number; rows?: number; error?: string }) => {
      if (data.error) {
        baseLogger.error(
          {
            event: 'db_query_error',
            ...data,
          },
          'Database query failed'
        );
      } else {
        baseLogger.debug(
          {
            event: 'db_query',
            ...data,
          },
          'Database query executed'
        );
      }
    },

    externalApi: (data: {
      service: string;
      endpoint: string;
      method: string;
      duration: number;
      status?: number;
      error?: string;
    }) => {
      if (data.error || (data.status && data.status >= 400)) {
        baseLogger.error(
          {
            event: 'external_api_error',
            ...data,
          },
          'External API call failed'
        );
      } else {
        baseLogger.debug(
          {
            event: 'external_api_call',
            ...data,
          },
          'External API call completed'
        );
      }
    },

    cacheOperation: (data: {
      operation: string;
      key: string;
      hit?: boolean;
      duration?: number;
      error?: string;
    }) => {
      if (data.error) {
        baseLogger.error(
          {
            event: 'cache_error',
            ...data,
          },
          'Cache operation failed'
        );
      } else {
        baseLogger.debug(
          {
            event: 'cache_operation',
            ...data,
          },
          'Cache operation completed'
        );
      }
    },
  },

  // Business logic logging
  business: {
    userAction: (data: { userId: string; action: string; resource?: string; details?: any }) => {
      baseLogger.info(
        {
          event: 'user_action',
          ...data,
        },
        'User action performed'
      );
    },

    systemEvent: (data: { event: string; details?: any; severity?: 'low' | 'medium' | 'high' }) => {
      const level = data.severity === 'high' ? 'warn' : 'info';
      baseLogger[level](
        {
          event_type: 'system_event',
          event_name: data.event,
          details: data.details,
          severity: data.severity,
        },
        'System event occurred'
      );
    },
  },

  // Audit logging
  audit: {
    dataAccess: (data: {
      userId: string;
      resource: string;
      action: string;
      recordId?: string;
      ip?: string;
    }) => {
      baseLogger.info(
        {
          event: 'data_access',
          ...data,
        },
        'Data access audit'
      );
    },

    configChange: (data: {
      userId: string;
      setting: string;
      oldValue?: any;
      newValue?: any;
      ip?: string;
    }) => {
      baseLogger.warn(
        {
          event: 'config_change',
          ...data,
        },
        'Configuration changed'
      );
    },

    privilegeEscalation: (data: {
      userId: string;
      fromRole: string;
      toRole: string;
      grantedBy: string;
      ip?: string;
    }) => {
      baseLogger.warn(
        {
          event: 'privilege_escalation',
          ...data,
        },
        'User privileges changed'
      );
    },
  },
};

// Create correlation ID middleware
export function correlationIdMiddleware(req: any, res: any, next: any) {
  req.id = req.headers['x-correlation-id'] || req.id || generateCorrelationId();
  res.setHeader('X-Correlation-ID', req.id);
  next();
}

function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export default logger;
