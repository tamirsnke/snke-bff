import { Request, Response } from 'express';
import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getRedis } from '../config/redis';

// Redis key prefix for Quentry sessions
const REDIS_KEY_PREFIX = 'quentry_session:';

/**
 * Handle Quentry login request
 */
export async function login(req: Request, res: Response): Promise<void> {
  try {
    // Get user from Keycloak session
    const session = req.session as any;
    if (!session?.user?.id) {
      res.status(401).json({ error: 'Not authenticated with Keycloak' });
      return;
    }

    // Get credentials from body or use stored/service account
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    // Authenticate with Quentry
    try {
      const response = await axios.post(
        `${config.quentry.authEndpoint}`,
        {
          username,
          password,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            VoyantClientAppName: 'Quentry',
            'X-Voyant-Client-Application': 'Quentry',
            Cookie: config.quentry.cookies,
            'User-Agent': 'BFF-Integration/1.0',
          },
        }
      );

      // Handle nested data structure: { data: { token: 'xxx' } }
      const responseData = response.data?.data || response.data;

      // Debug log the response structure
      logger.debug('Quentry auth response structure', {
        hasData: !!response.data?.data,
        directToken: !!response.data?.token,
        nestedToken: !!response.data?.data?.token,
      });

      if (!responseData?.token) {
        logger.warn('Quentry authentication failed - no token returned', {
          username,
          responseStructure: JSON.stringify(response.data).substring(0, 200),
        });
        res.status(401).json({ error: 'Invalid credentials - no token returned' });
        return;
      }

      // Store Quentry session in Redis
      const quentrySession = {
        ...responseData,
        expires: Date.now() + 3600 * 1000, // 1 hour expiration
      };

      const redis = getRedis();
      await redis.set(
        `${REDIS_KEY_PREFIX}${session.user.id}`,
        JSON.stringify(quentrySession),
        3600 // 1 hour TTL
      );

      // Return success to client
      res.json({
        success: true,
        user: {
          username: responseData.userName,
          fullName: responseData.fullName,
          email: responseData.userEmail,
          id: responseData.userSystemId,
        },
        urlsLookup: responseData.urlsLookup,
      });
    } catch (error: any) {
      logger.error('Quentry authentication error', {
        error: error?.message || 'Unknown error',
        response: error.response?.data,
      });

      res.status(error.response?.status || 500).json({
        error: 'Authentication failed',
        message: error.response?.data?.message || error.message || 'Unknown error',
      });
    }
  } catch (error: any) {
    logger.error('Quentry login error', { error: error?.message || 'Unknown error' });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Handle Quentry logout request
 */
export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const session = req.session as any;
    if (!session?.user?.id) {
      res.status(401).json({ error: 'Not authenticated with Keycloak' });
      return;
    }

    // Delete Quentry session from Redis
    const redis = getRedis();
    await redis.del(`${REDIS_KEY_PREFIX}${session.user.id}`);

    res.json({ success: true, message: 'Logged out from Quentry' });
  } catch (error: any) {
    logger.error('Quentry logout error', { error: error?.message || 'Unknown error' });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get Quentry session status
 */
export async function status(req: Request, res: Response): Promise<void> {
  try {
    const session = req.session as any;
    if (!session?.user?.id) {
      res.json({ authenticated: false, message: 'Not authenticated with Keycloak' });
      return;
    }

    // Get Quentry session from Redis
    const redis = getRedis();
    const quentrySessionJson = await redis.get(`${REDIS_KEY_PREFIX}${session.user.id}`);

    if (!quentrySessionJson) {
      res.json({ authenticated: false, message: 'No Quentry session found' });
      return;
    }

    const quentrySession = JSON.parse(quentrySessionJson);
    const now = Date.now();

    // Check if session is expired
    if (quentrySession.expires <= now) {
      // Delete expired session
      await redis.del(`${REDIS_KEY_PREFIX}${session.user.id}`);
      res.json({ authenticated: false, message: 'Quentry session expired' });
      return;
    }

    // Return session status
    res.json({
      authenticated: true,
      expiresIn: Math.floor((quentrySession.expires - now) / 1000),
      user: {
        username: quentrySession.userName,
        fullName: quentrySession.fullName,
        email: quentrySession.userEmail,
        id: quentrySession.userSystemId,
      },
    });
  } catch (error: any) {
    logger.error('Quentry status error', { error: error?.message || 'Unknown error' });
    res.status(500).json({ error: 'Internal server error' });
  }
}
