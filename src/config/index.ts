import dotenv from 'dotenv';
import Joi from 'joi';

// Load environment variables
dotenv.config();

// Configuration schema for validation
const configSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production').default('development'),

  // Server Configuration
  SERVER_HOST: Joi.string().default('0.0.0.0'),
  SERVER_PORT: Joi.number().default(3000),
  SSL_ENABLED: Joi.boolean().default(false),
  SSL_KEY_PATH: Joi.string().default('./certs/server-key.pem'),
  SSL_CERT_PATH: Joi.string().default('./certs/server-cert.pem'),
  SSL_CA_PATH: Joi.string().default('./certs/ca-cert.pem'),

  // Quentry Configuration
  QUENTRY_BASE_URL: Joi.string().default('http://localhost:8000'),
  QUENTRY_API_URL: Joi.string().default('http://localhost:8000/api'),
  QUENTRY_AUTH_ENDPOINT: Joi.string().default('http://localhost:8000/api/r8/sessions'),
  QUENTRY_COOKIES: Joi.string().allow(''),
  QUENTRY_SERVICE_USERNAME: Joi.string().allow(''),
  QUENTRY_SERVICE_PASSWORD: Joi.string().allow(''),

  // Database Configuration
  DATABASE_URL: Joi.string().required(),
  DATABASE_SSL: Joi.boolean().default(false),
  DATABASE_POOL_MIN: Joi.number().default(2),
  DATABASE_POOL_MAX: Joi.number().default(10),

  // Redis Configuration
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: Joi.string().allow(''),
  REDIS_TLS: Joi.boolean().default(false),
  SESSION_STORE: Joi.string().valid('redis', 'memory').default('redis'),

  // Keycloak Configuration
  KEYCLOAK_URL: Joi.string().required(),
  KEYCLOAK_REALM: Joi.string().default('myrealm'),
  KEYCLOAK_CLIENT_ID: Joi.string().default('myclient'),
  KEYCLOAK_CLIENT_SECRET: Joi.string().required(),

  // Security Configuration
  SESSION_SECRET: Joi.string().min(32).required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  BCRYPT_ROUNDS: Joi.number().default(12),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().default(15 * 60 * 1000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),
  RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: Joi.boolean().default(false),

  // CORS Configuration
  CORS_ORIGIN: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.string()), Joi.boolean())
    .default(['http://localhost:3000', 'http://localhost:8080']),
  CORS_CREDENTIALS: Joi.boolean().default(true),

  // Monitoring Configuration
  METRICS_PORT: Joi.number().default(9090),
  JAEGER_ENDPOINT: Joi.string().default('http://localhost:14268/api/traces'),
  SENTRY_DSN: Joi.string().allow(''),

  // Logging Configuration
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  LOG_FORMAT: Joi.string().valid('json', 'pretty').default('json'),
  LOG_FILE: Joi.boolean().default(true),

  // Feature Flags
  FEATURE_HEALTH_CHECK: Joi.boolean().default(true),
  FEATURE_METRICS: Joi.boolean().default(true),
  FEATURE_TRACING: Joi.boolean().default(true),
  FEATURE_API_DOCS: Joi.boolean().default(true),

  // External Service URLs
  MICROSERVICE_USER_URL: Joi.string().default('http://localhost:3001'),
  MICROSERVICE_ORDER_URL: Joi.string().default('http://localhost:3002'),
  MICROSERVICE_INVENTORY_URL: Joi.string().default('http://localhost:3003'),

  // Circuit Breaker Configuration
  CIRCUIT_BREAKER_THRESHOLD: Joi.number().default(5),
  CIRCUIT_BREAKER_TIMEOUT: Joi.number().default(60000),
  CIRCUIT_BREAKER_RESET_TIMEOUT: Joi.number().default(30000),
});

// Validate configuration
const { error, value: envVars } = configSchema.validate(process.env, {
  allowUnknown: true,
  stripUnknown: true,
});

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Export configuration object
export const config = {
  env: envVars.NODE_ENV,
  isDevelopment: envVars.NODE_ENV === 'development',
  isProduction: envVars.NODE_ENV === 'production',
  isStaging: envVars.NODE_ENV === 'staging',

  quentry: {
    baseUrl: envVars.QUENTRY_BASE_URL,
    apiUrl: envVars.QUENTRY_API_URL,
    authEndpoint: envVars.QUENTRY_AUTH_ENDPOINT,
    cookies: envVars.QUENTRY_COOKIES,
    serviceUsername: envVars.QUENTRY_SERVICE_USERNAME,
    servicePassword: envVars.QUENTRY_SERVICE_PASSWORD,
  },

  server: {
    host: envVars.SERVER_HOST,
    port: envVars.SERVER_PORT,
    ssl: {
      enabled: envVars.SSL_ENABLED,
      keyPath: envVars.SSL_KEY_PATH,
      certPath: envVars.SSL_CERT_PATH,
      caPath: envVars.SSL_CA_PATH,
    },
  },

  database: {
    url: envVars.DATABASE_URL,
    ssl: envVars.DATABASE_SSL,
    pool: {
      min: envVars.DATABASE_POOL_MIN,
      max: envVars.DATABASE_POOL_MAX,
    },
  },

  redis: {
    url: envVars.REDIS_URL,
    password: envVars.REDIS_PASSWORD,
    tls: envVars.REDIS_TLS,
    enabled: envVars.SESSION_STORE === 'redis',
  },

  session: {
    store: envVars.SESSION_STORE as 'redis' | 'memory',
    secret: envVars.SESSION_SECRET,
    name: 'bff.session.id',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: envVars.SSL_ENABLED,
    httpOnly: true,
    sameSite: 'strict' as const,
  },

  keycloak: {
    url: envVars.KEYCLOAK_URL,
    realm: envVars.KEYCLOAK_REALM,
    clientId: envVars.KEYCLOAK_CLIENT_ID,
    clientSecret: envVars.KEYCLOAK_CLIENT_SECRET,
  },

  security: {
    jwtSecret: envVars.JWT_SECRET,
    jwtExpiresIn: envVars.JWT_EXPIRES_IN,
    bcryptRounds: envVars.BCRYPT_ROUNDS,
  },

  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
    skipSuccessfulRequests: envVars.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS,
  },

  cors: {
    origin: envVars.CORS_ORIGIN,
    credentials: envVars.CORS_CREDENTIALS,
  },

  monitoring: {
    metricsPort: envVars.METRICS_PORT,
    jaegerEndpoint: envVars.JAEGER_ENDPOINT,
    sentryDsn: envVars.SENTRY_DSN,
  },

  logging: {
    level: envVars.LOG_LEVEL,
    format: envVars.LOG_FORMAT as 'json' | 'pretty',
    file: envVars.LOG_FILE,
  },

  features: {
    healthCheck: envVars.FEATURE_HEALTH_CHECK,
    metrics: envVars.FEATURE_METRICS,
    tracing: envVars.FEATURE_TRACING,
    apiDocs: envVars.FEATURE_API_DOCS,
  },

  microservices: {
    userService: envVars.MICROSERVICE_USER_URL,
    orderService: envVars.MICROSERVICE_ORDER_URL,
    inventoryService: envVars.MICROSERVICE_INVENTORY_URL,
  },

  circuitBreaker: {
    threshold: envVars.CIRCUIT_BREAKER_THRESHOLD,
    timeout: envVars.CIRCUIT_BREAKER_TIMEOUT,
    resetTimeout: envVars.CIRCUIT_BREAKER_RESET_TIMEOUT,
  },
} as const;
