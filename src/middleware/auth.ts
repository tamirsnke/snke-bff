import { Request, Response, NextFunction } from 'express';
import { getKeycloak, extractTokenFromHeader, isTokenExpired } from '@/config/keycloak';
import { getDatabase } from '@/config/database';
import { logger } from '@/utils/logger';
import { businessMetrics } from '@/config/monitoring';
import { ensureValidToken } from '@/routes/auth';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
    firstName?: string;
    lastName?: string;
    roles: string[];
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
  };
}

// Simple session-based authentication check
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = req.session as any;

  if (!session?.user || !session?.tokens) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please login to access this resource',
      shouldRedirectToLogin: true,
    });
  }

  next();
}

// Authentication check with automatic token refresh
export function requireAuthWithRefresh(req: Request, res: Response, next: NextFunction) {
  return ensureValidToken(req, res, next);
}

// Role-based access control for session-based auth
export function requireSessionRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = req.session as any;
    const userRoles = session?.user?.roles || [];

    if (!userRoles.includes(role)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `Role '${role}' required`,
        requiredRole: role,
        userRoles,
      });
    }

    next();
  };
}

// Multiple roles check (user must have ANY of the specified roles)
export function requireSessionAnyRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = req.session as any;
    const userRoles = session?.user?.roles || [];

    const hasRequiredRole = roles.some((role) => userRoles.includes(role));

    if (!hasRequiredRole) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `One of these roles required: ${roles.join(', ')}`,
        requiredRoles: roles,
        userRoles,
      });
    }

    next();
  };
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<Response | void> {
  try {
    // Skip authentication for public endpoints
    if (isPublicEndpoint(req.path)) {
      return next();
    }

    // Check for token in Authorization header
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader as string);

    if (!token) {
      logger.security.accessDenied({
        resource: req.path,
        action: req.method,
        ip: req.ip,
        reason: 'No token provided',
      });

      businessMetrics.recordAuthAttempt('failure', 'bearer_token');

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Access token required',
      });
    }

    try {
      // Validate token with Keycloak
      const keycloak = getKeycloak();
      const userinfo = await keycloak.validateToken(token);

      // Get user from database or create if not exists
      const user = await getOrCreateUser(userinfo, token);

      // Attach user to request
      req.user = user;

      logger.security.tokenValidation({
        userId: user?.id || '',
        tokenType: 'access_token',
        valid: true,
      });

      businessMetrics.recordAuthAttempt('success', 'bearer_token');

      next();
    } catch (error) {
      logger.security.tokenValidation({
        tokenType: 'access_token',
        valid: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });

      businessMetrics.recordAuthAttempt('failure', 'bearer_token');

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
    }
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication service unavailable',
    });
  }
}

export function requireRole(role: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): Response | void => {
    if (!req.user) {
      businessMetrics.recordAuthzCheck('denied', req.path);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    if (!req.user.roles.includes(role)) {
      logger.security.accessDenied({
        userId: req.user.id,
        resource: req.path,
        action: req.method,
        ip: req.ip,
        reason: `Required role: ${role}`,
      });

      businessMetrics.recordAuthzCheck('denied', req.path);

      return res.status(403).json({
        error: 'Forbidden',
        message: `Insufficient permissions. Required role: ${role}`,
      });
    }

    businessMetrics.recordAuthzCheck('allowed', req.path);
    next();
  };
}

export function requireAnyRole(roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): Response | void => {
    if (!req.user) {
      businessMetrics.recordAuthzCheck('denied', req.path);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    const hasRequiredRole = roles.some((role) => req.user!.roles.includes(role));

    if (!hasRequiredRole) {
      logger.security.accessDenied({
        userId: req.user.id,
        resource: req.path,
        action: req.method,
        ip: req.ip,
        reason: `Required roles: ${roles.join(', ')}`,
      });

      businessMetrics.recordAuthzCheck('denied', req.path);

      return res.status(403).json({
        error: 'Forbidden',
        message: `Insufficient permissions. Required roles: ${roles.join(', ')}`,
      });
    }

    businessMetrics.recordAuthzCheck('allowed', req.path);
    next();
  };
}

export function requireAllRoles(roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): Response | void => {
    if (!req.user) {
      businessMetrics.recordAuthzCheck('denied', req.path);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    const hasAllRoles = roles.every((role) => req.user!.roles.includes(role));

    if (!hasAllRoles) {
      logger.security.accessDenied({
        userId: req.user.id,
        resource: req.path,
        action: req.method,
        ip: req.ip,
        reason: `All required roles: ${roles.join(', ')}`,
      });

      businessMetrics.recordAuthzCheck('denied', req.path);

      return res.status(403).json({
        error: 'Forbidden',
        message: `Insufficient permissions. All required roles: ${roles.join(', ')}`,
      });
    }

    businessMetrics.recordAuthzCheck('allowed', req.path);
    next();
  };
}

function isPublicEndpoint(path: string): boolean {
  const publicPaths = [
    '/health',
    '/metrics',
    '/api-docs',
    '/auth/login',
    '/auth/callback',
    '/auth/logout',
    '/api/public',
  ];

  return publicPaths.some((publicPath) => path.startsWith(publicPath));
}

async function getOrCreateUser(
  userinfo: any,
  token: string
): Promise<AuthenticatedRequest['user']> {
  const db = getDatabase();

  try {
    // Try to get existing user
    const result = await db.query('SELECT * FROM users WHERE keycloak_id = $1', [userinfo.sub]);

    let user;

    if (result.rows.length === 0) {
      // Create new user
      const insertResult = await db.query(
        `INSERT INTO users (keycloak_id, username, email, first_name, last_name, roles)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          userinfo.sub,
          userinfo.preferred_username,
          userinfo.email,
          userinfo.given_name,
          userinfo.family_name,
          userinfo.realm_access?.roles || [],
        ]
      );
      user = insertResult.rows[0];

      logger.info('New user created', {
        userId: user.id,
        username: user.username,
        email: user.email,
      });
    } else {
      user = result.rows[0];

      // Update last login
      await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      roles: user.roles,
      accessToken: token,
    };
  } catch (error) {
    logger.error('Error getting/creating user:', error);
    throw error;
  }
}
