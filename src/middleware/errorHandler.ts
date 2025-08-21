import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { config } from '@/config';

export interface AppError extends Error {
  statusCode?: number;
  status?: string;
  isOperational?: boolean;
  code?: string;
  details?: any;
}

export class ValidationError extends Error {
  statusCode = 400;
  status = 'fail';
  isOperational = true;

  constructor(
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends Error {
  statusCode = 401;
  status = 'fail';
  isOperational = true;

  constructor(message: string = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  statusCode = 403;
  status = 'fail';
  isOperational = true;

  constructor(message: string = 'Insufficient permissions') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  status = 'fail';
  isOperational = true;

  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  statusCode = 409;
  status = 'fail';
  isOperational = true;

  constructor(message: string = 'Resource conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends Error {
  statusCode = 429;
  status = 'fail';
  isOperational = true;

  constructor(message: string = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ServiceUnavailableError extends Error {
  statusCode = 503;
  status = 'error';
  isOperational = true;

  constructor(message: string = 'Service temporarily unavailable') {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

export function errorHandler(err: AppError, req: Request, res: Response, next: NextFunction): void {
  // Set default error properties
  let error = { ...err };
  error.statusCode = err.statusCode || 500;
  error.status = err.status || 'error';

  // Log error details
  const errorLog = {
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      statusCode: error.statusCode,
      code: err.code,
      details: err.details,
    },
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      query: req.query,
      params: req.params,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    },
    user: (req as any).user?.id,
    correlationId: req.headers['x-correlation-id'] || (req as any).id,
  };

  if (error.statusCode >= 500) {
    console.error('Server error occurred', errorLog);
  } else {
    console.warn('Client error occurred', errorLog);
  }

  // Handle specific error types
  if (err.name === 'ValidationError') {
    error = handleValidationError(err);
  } else if (err.name === 'CastError') {
    error = handleCastError(err);
  } else if (err.code === '11000') {
    error = handleDuplicateError(err);
  } else if (err.name === 'JsonWebTokenError') {
    error = handleJWTError(err);
  } else if (err.name === 'TokenExpiredError') {
    error = handleJWTExpiredError(err);
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    error = handleFileSizeError(err);
  } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    error = handleConnectionError(err);
  }

  // Send error response
  const response: any = {
    status: error.status,
    message: error.message,
    correlationId: errorLog.correlationId,
  };

  // Include error details in development
  if (config.isDevelopment) {
    response.error = err;
    response.stack = err.stack;
  }

  // Include validation details if present
  if (error.details) {
    response.details = error.details;
  }

  res.status(error.statusCode || 500).json(response);
}

function handleValidationError(err: AppError): AppError {
  const message = 'Invalid input data';
  return { ...err, message, statusCode: 400 };
}

function handleCastError(err: AppError): AppError {
  const message = 'Invalid data format';
  return { ...err, message, statusCode: 400 };
}

function handleDuplicateError(err: AppError): AppError {
  const message = 'Duplicate data entry';
  return { ...err, message, statusCode: 409 };
}

function handleJWTError(err: AppError): AppError {
  const message = 'Invalid token';
  return { ...err, message, statusCode: 401 };
}

function handleJWTExpiredError(err: AppError): AppError {
  const message = 'Token expired';
  return { ...err, message, statusCode: 401 };
}

function handleFileSizeError(err: AppError): AppError {
  const message = 'File size too large';
  return { ...err, message, statusCode: 413 };
}

function handleConnectionError(err: AppError): AppError {
  const message = 'External service unavailable';
  return { ...err, message, statusCode: 503 };
}

// 404 handler for undefined routes
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  console.warn(`404 Not Found: ${req.method} ${req.url}`); // Changed from logger.warn

  res.status(404).json({
    error: 'Not Found',
    message: `The requested resource ${req.url} was not found`,
    path: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
}

// Async error wrapper
export function asyncHandler<T extends any[], R>(fn: (...args: T) => Promise<R>) {
  return (...args: T): Promise<R | void> => {
    const [req, res, next] = args as unknown as [Request, Response, NextFunction];
    return Promise.resolve(fn(...args)).catch(next);
  };
}
