import express from 'express';
import * as quentryController from '../controllers/quentryController';
import { ensureQuentryAuth, createQuentryProxyMiddleware } from '../middleware/quentryProxy';
import { ensureValidToken } from './auth';
import { config } from '../config';
import { logger } from '../utils/logger';
import axios from 'axios';
import { getRedis } from '../config/redis';

const router = express.Router();

// For development, create a bypass middleware to simulate a valid session
const devBypass = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (config.isDevelopment && config.env === 'development') {
    // Simulate a valid Keycloak session
    (req.session as any).user = {
      id: 'test-user-id',
      username: 'test-user',
      email: 'test@example.com',
      roles: ['user'],
    };
    next();
    return;
  }
  // In production, use the real middleware
  return ensureValidToken(req, res, next);
};

// Choose auth middleware based on environment
const authMiddleware = config.isDevelopment ? devBypass : ensureValidToken;

// Test endpoint for development only
if (config.isDevelopment) {
  router.post('/test-auth', async (req: express.Request, res: express.Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      console.log('Test authentication with Quentry', { username });

      // Simulate Keycloak session
      (req.session as any).user = {
        id: 'test-user-id',
        username: 'test-user',
        email: 'test@example.com',
        roles: ['user'],
      };

      // Save session
      try {
        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              console.error('Session save error:', err);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      } catch (sessionError) {
        console.error('Failed to save session', { error: sessionError });
        return res.status(500).json({ error: 'Session error', details: 'Failed to save session' });
      }

      // Mock successful authentication for testing
      if (username === 'test@example.com' && password === 'test123') {
        // This is a test account that always works
        const mockData = {
          token: 'mock-token-123',
          userName: 'TestUser',
          fullName: 'Test User',
          userEmail: 'test@example.com',
          userSystemId: 'mock-user-id-123',
          urlsLookup: { dashboard: '/dashboard' },
        };

        try {
          const redis = getRedis();
          await redis.set(
            `quentry_session:test-user-id`,
            JSON.stringify({
              ...mockData,
              expires: Date.now() + 3600 * 1000, // 1 hour expiration
            }),
            3600 // 1 hour TTL
          );
        } catch (redisError) {
          console.warn('Redis error during test auth, continuing with mock data', {
            error: redisError,
          });
        }

        return res.json({
          success: true,
          user: {
            username: mockData.userName,
            fullName: mockData.fullName,
            email: mockData.userEmail,
            id: mockData.userSystemId,
          },
          sessionId: req.sessionID,
          mock: true,
          urlsLookup: mockData.urlsLookup,
        });
      }

      // Proceed with real Quentry authentication
      try {
        console.log('Attempting Quentry authentication', {
          endpoint: config.quentry.authEndpoint,
        });

        // Create request options
        const options = {
          headers: {
            'Content-Type': 'application/json',
            VoyantClientAppName: 'Quentry',
            'X-Voyant-Client-Application': 'Quentry',
            Cookie: config.quentry.cookies || '_ga=GA1.1.676161230.1755775053; blBrand=default',
            'User-Agent': 'BFF-Integration/1.0',
          },
          timeout: 10000, // 10 second timeout
        };

        console.log('Using headers:', options.headers);

        // Send authentication request
        const response = await axios.post(
          `${config.quentry.authEndpoint}`,
          {
            username,
            password,
          },
          options
        );

        console.log('Quentry auth response received', {
          status: response.status,
          hasData: !!response.data?.data,
          hasToken: !!response.data?.data?.token,
          responseData: JSON.stringify(response.data).substring(0, 500), // Log partial response data
        });

        // Extract data from the response - handle nested structure
        const responseData = response.data?.data || response.data;

        // Check if the response contains a token
        const quentryToken = responseData?.token;
        if (!quentryToken) {
          console.log(
            'No token in response data. Full data:',
            JSON.stringify(response.data, null, 2)
          );
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        console.log('Successfully extracted token:', quentryToken.substring(0, 10) + '...');

        // Store Quentry session - use responseData which already has the correct structure
        const quentrySession = {
          ...responseData, // Use the extracted data object
          expires: Date.now() + 3600 * 1000, // 1 hour expiration
        };

        try {
          const redis = getRedis();
          await redis.set(
            `quentry_session:test-user-id`,
            JSON.stringify(quentrySession),
            3600 // 1 hour TTL
          );
        } catch (redisError) {
          console.warn('Redis error during test auth, continuing without Redis', {
            error: redisError,
          });
        }

        // Return success to client
        return res.json({
          success: true,
          user: {
            username: responseData.userName,
            fullName: responseData.fullName,
            email: responseData.userEmail,
            id: responseData.userSystemId,
          },
          sessionId: req.sessionID,
          mock: false,
          urlsLookup: responseData.urlsLookup,
        });
      } catch (error: any) {
        // Avoid using the logger to prevent crashing
        console.error('Quentry test auth error', {
          error: error?.message || 'Unknown error',
          status: error.response?.status,
          data: error.response?.data,
        });

        return res.status(error.response?.status || 500).json({
          error: 'Authentication failed',
          message: error.response?.data?.message || error.message || 'Unknown error',
        });
      }
    } catch (error: any) {
      console.error('Test authentication error', { error: error?.message });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Simple test endpoint that doesn't make external calls
  router.get('/test', (req: express.Request, res: express.Response) => {
    res.json({
      message: 'BFF test endpoint is working',
      time: new Date().toISOString(),
      session: req.sessionID,
    });
  });
}

// Quentry authentication routes (protected by Keycloak)
router.post('/login', authMiddleware, quentryController.login);
router.post('/logout', authMiddleware, quentryController.logout);
router.get('/status', authMiddleware, quentryController.status);

// Quentry API proxy route (protected by Keycloak and Quentry session)
router.use('/api', authMiddleware, ensureQuentryAuth, createQuentryProxyMiddleware());

export default router;
