import axios from 'axios';
import { quentryConfig } from '../config/quentry';
import { logger } from '../utils/logger';
import Redis from 'ioredis';
import { config } from '../config';

// Initialize Redis client with better error handling
let redisClient: Redis;

try {
  redisClient = new Redis(config.redis.url, {
    password: config.redis.password || undefined,
    tls: config.redis.tls ? {} : undefined,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redisClient.on('error', (error) => {
    logger.error('Redis client error', { error: error.message });
  });

  logger.info('Redis client initialized successfully');
} catch (error: any) {
  logger.error('Failed to initialize Redis client', { error: error?.message || 'Unknown error' });
  // Provide a fallback implementation to avoid crashes
  redisClient = {
    set: async () => 'OK',
    get: async () => null,
    del: async () => 0,
  } as any;
}

export interface QuentryUser {
  firstName: string;
  lastName: string;
  region: number;
  regionName: string;
  userName: string;
  title: string | null;
  businessCity: string;
  country: string;
  countryCode: string;
  countryName: string | null;
  systemID: string;
  entityType: number;
  entityName: string;
  businessInstitution: string;
}

export interface QuentrySession {
  token: string;
  webAPIURL: string;
  userName: string;
  fullName: string;
  userEmail: string;
  userSystemId: string;
  expires: number;
  // Additional fields from Quentry response
  region?: number;
  portalDefaultUrl?: string;
  userSpecialities?: number[];
  userSystemRoleTypes?: number[];
  urlsLookup?: Record<string, string>;
}

/**
 * Maps a Keycloak user to a Quentry username
 */
export async function mapKeycloakToQuentryUser(
  keycloakUser: any
): Promise<{ username: string; password?: string }> {
  // Direct mapping strategy - use the same username
  if (quentryConfig.userMapping.type === 'direct-mapping') {
    return {
      username: keycloakUser.username,
      // Password not needed for direct mapping as we'll use the service account password
    };
  }

  // Fallback to service account
  return {
    username: quentryConfig.userMapping.serviceUsername || '',
    password: quentryConfig.userMapping.servicePassword,
  };
}

/**
 * Authenticates with Quentry API
 */
export async function authenticateWithQuentry(
  username: string,
  password: string
): Promise<QuentrySession> {
  try {
    logger.info(`Authenticating user ${username} with Quentry`);

    const response = await axios.post(
      quentryConfig.authEndpoint,
      {
        username,
        password,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          VoyantClientAppName: 'Quentry',
          'X-Voyant-Client-Application': 'Quentry',
          Cookie: quentryConfig.cookies,
          'User-Agent': 'BFF-Integration/1.0',
        },
      }
    );

    // Log the response structure for debugging
    logger.debug('Quentry auth response structure', {
      hasData: !!response.data?.data,
      directToken: !!response.data?.token,
      nestedToken: !!response.data?.data?.token,
    });

    // Handle nested data structure: { data: { token: 'xxx' } }
    const responseData = response.data?.data || response.data;

    if (!responseData?.token) {
      logger.error('Quentry authentication failed - no token found', {
        username,
        responseStructure: JSON.stringify(response.data),
      });
      throw new Error('Invalid response from Quentry auth service - no token found');
    }

    const quentrySession: QuentrySession = {
      token: responseData.token,
      webAPIURL: responseData.webAPIURL,
      userName: responseData.userName,
      fullName: responseData.fullName,
      userEmail: responseData.userEmail,
      userSystemId: responseData.userSystemId,
      region: responseData.region,
      portalDefaultUrl: responseData.portalDefaultUrl,
      userSpecialities: responseData.userSpecialities,
      userSystemRoleTypes: responseData.userSystemRoleTypes,
      urlsLookup: responseData.urlsLookup,
      expires: Date.now() + quentryConfig.sessionTtl * 1000, // Default TTL
    };

    return quentrySession;
  } catch (error: any) {
    logger.error('Failed to authenticate with Quentry', {
      error: error?.message || 'Unknown error',
    });
    throw new Error(`Quentry authentication failed: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * Stores Quentry session in Redis
 */
export async function storeQuentrySession(
  keycloakId: string,
  session: QuentrySession
): Promise<void> {
  await redisClient.set(
    `${quentryConfig.redisPrefix}${keycloakId}`,
    JSON.stringify(session),
    'EX',
    Math.floor((session.expires - Date.now()) / 1000)
  );
}

/**
 * Retrieves Quentry session from Redis
 */
export async function getQuentrySession(keycloakId: string): Promise<QuentrySession | null> {
  const session = await redisClient.get(`${quentryConfig.redisPrefix}${keycloakId}`);
  if (!session) return null;
  return JSON.parse(session);
}

/**
 * Deletes Quentry session from Redis
 */
export async function deleteQuentrySession(keycloakId: string): Promise<void> {
  await redisClient.del(`${quentryConfig.redisPrefix}${keycloakId}`);
}

/**
 * Creates the headers needed for Quentry API requests
 */
export function createQuentryAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Token ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Validates a Quentry token by making a test API call
 */
export async function validateQuentryToken(token: string): Promise<boolean> {
  try {
    // Make a lightweight API call to validate the token
    await axios.get(`${quentryConfig.apiUrl}/r8/ping`, {
      headers: {
        Authorization: `Token ${token}`,
      },
    });
    return true;
  } catch (error: any) {
    logger.debug('Quentry token validation failed', {
      error: error?.message || 'Unknown error',
    });
    return false;
  }
}
