import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { ValidationError } from '@/middleware/errorHandler';

// Export validateRequest as an alias for validationMiddleware
export const validateRequest = validationMiddleware;

export function validationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const validationErrors = errors.array().map((error) => ({
      field: (error as any).param || 'unknown',
      message: error.msg,
      value: (error as any).value,
    }));

    throw new ValidationError('Validation failed', validationErrors);
  }

  next();
}

// Common validation rules
export const validationRules = {
  // User validation
  createUser: [
    body('username')
      .trim()
      .isLength({ min: 3, max: 50 })
      .withMessage('Username must be between 3 and 50 characters')
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Username can only contain letters, numbers, underscores, and hyphens'),

    body('email').isEmail().normalizeEmail().withMessage('Must be a valid email address'),

    body('firstName')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('First name must be between 1 and 50 characters'),

    body('lastName')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Last name must be between 1 and 50 characters'),
  ],

  updateUser: [
    param('id').isUUID().withMessage('User ID must be a valid UUID'),

    body('firstName')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('First name must be between 1 and 50 characters'),

    body('lastName')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Last name must be between 1 and 50 characters'),
  ],

  // Pagination validation
  pagination: [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),

    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),

    query('sort')
      .optional()
      .matches(/^[a-zA-Z_]+:(asc|desc)$/)
      .withMessage('Sort must be in format "field:direction" (e.g., "createdAt:desc")'),
  ],

  // ID validation
  uuidParam: [param('id').isUUID().withMessage('ID must be a valid UUID')],

  // API token validation
  createApiToken: [
    body('name')
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Token name must be between 1 and 100 characters'),

    body('scopes')
      .isArray()
      .withMessage('Scopes must be an array')
      .custom((scopes: string[]) => {
        const validScopes = ['read', 'write', 'admin'];
        return scopes.every((scope) => validScopes.includes(scope));
      })
      .withMessage('Invalid scope provided'),

    body('expiresIn')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Expires in must be a positive integer (days)'),
  ],

  // Login validation
  login: [
    body('username').trim().notEmpty().withMessage('Username is required'),

    body('password').isLength({ min: 1 }).withMessage('Password is required'),
  ],

  // Password validation
  changePassword: [
    body('currentPassword').notEmpty().withMessage('Current password is required'),

    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage(
        'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
      ),

    body('confirmPassword').custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Password confirmation does not match');
      }
      return true;
    }),
  ],

  // File upload validation
  fileUpload: [
    body('file').custom((value, { req }) => {
      if (!req.file) {
        throw new Error('File is required');
      }

      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        throw new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF files are allowed');
      }

      const maxSize = 5 * 1024 * 1024; // 5MB
      if (req.file.size > maxSize) {
        throw new Error('File size too large. Maximum size is 5MB');
      }

      return true;
    }),
  ],

  // Search validation
  search: [
    query('q')
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Search query must be between 1 and 100 characters'),

    query('type')
      .optional()
      .isIn(['user', 'role', 'token'])
      .withMessage('Search type must be one of: user, role, token'),
  ],

  // Date range validation
  dateRange: [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Start date must be a valid ISO 8601 date'),

    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('End date must be a valid ISO 8601 date')
      .custom((value, { req }) => {
        if (req.query?.startDate && value < req.query.startDate) {
          throw new Error('End date must be after start date');
        }
        return true;
      }),
  ],

  // Role validation
  createRole: [
    body('name')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Role name must be between 1 and 50 characters')
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Role name can only contain letters, numbers, underscores, and hyphens'),

    body('description')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Description must not exceed 255 characters'),

    body('permissions').isArray().withMessage('Permissions must be an array'),
  ],

  // Audit log validation
  auditLogs: [
    query('userId').optional().isUUID().withMessage('User ID must be a valid UUID'),

    query('action')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Action must be between 1 and 50 characters'),

    query('resource')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Resource must be between 1 and 100 characters'),
  ],
};

// Custom validation middleware creator
export function validate(rules: any[]) {
  return [...rules, validationMiddleware];
}

// Sanitization middleware
export function sanitizeInput(req: Request, res: Response, next: NextFunction): void {
  // Sanitize query parameters
  for (const key in req.query) {
    if (typeof req.query[key] === 'string') {
      req.query[key] = (req.query[key] as string).trim();
    }
  }

  // Sanitize body parameters
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }

  next();
}

function sanitizeObject(obj: any): void {
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      obj[key] = obj[key].trim();
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitizeObject(obj[key]);
    }
  }
}
