import { config } from './index';

export const quentryConfig = {
  baseUrl: process.env.QUENTRY_BASE_URL || 'http://localhost:8000',
  apiUrl: process.env.QUENTRY_API_URL || 'http://localhost:8000/api',
  authEndpoint: process.env.QUENTRY_AUTH_ENDPOINT || 'http://localhost:8000/api/r8/sessions',
  apiPrefix: '/api/r8',
  // Cookie header needed for Quentry requests
  cookies: process.env.QUENTRY_COOKIES || '_ga=GA1.1.676161230.1755775053; blBrand=default',
  // User mapping strategy
  userMapping: {
    type: 'direct-mapping', // Maps Keycloak usernames directly to Quentry usernames
    // Optional: fallback service account
    serviceUsername: process.env.QUENTRY_SERVICE_USERNAME,
    servicePassword: process.env.QUENTRY_SERVICE_PASSWORD,
  },
  // Redis storage
  redisPrefix: 'quentry_session:',
  // Session TTL in seconds
  sessionTtl: 3600, // 1 hour
};
