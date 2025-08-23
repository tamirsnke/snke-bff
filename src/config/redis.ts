import Redis from 'ioredis';
import { config } from '@/config';
import { logger } from '@/utils/logger';

interface RedisConfig {
  client: Redis | null;
  isConnected: boolean;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttl?: number) => Promise<void>;
  del: (key: string) => Promise<void>;
  exists: (key: string) => Promise<boolean>;
  expire: (key: string, ttl: number) => Promise<void>;
  disconnect: () => void;
}

// In-memory fallback store when Redis is not available
const memoryStore = new Map<string, { value: string; expiry: number | null }>();

// Create default Redis config with memory fallback
let redis: RedisConfig = createMemoryStore();

function createMemoryStore(): RedisConfig {
  return {
    client: null,
    isConnected: false,
    get: async (key: string): Promise<string | null> => {
      const item = memoryStore.get(key);
      if (!item) return null;

      // Check if expired
      if (item.expiry !== null && item.expiry < Date.now()) {
        memoryStore.delete(key);
        return null;
      }

      return item.value;
    },
    set: async (key: string, value: string, ttl?: number): Promise<void> => {
      const expiry = ttl ? Date.now() + ttl * 1000 : null;
      memoryStore.set(key, { value, expiry });
    },
    del: async (key: string): Promise<void> => {
      memoryStore.delete(key);
    },
    exists: async (key: string): Promise<boolean> => {
      return memoryStore.has(key);
    },
    expire: async (key: string, ttl: number): Promise<void> => {
      const item = memoryStore.get(key);
      if (item) {
        item.expiry = Date.now() + ttl * 1000;
      }
    },
    disconnect: () => {
      // No-op for memory store
    },
  };
}

export async function initializeRedis(): Promise<RedisConfig> {
  try {
    // Skip Redis initialization if disabled
    if (!config.redis.enabled) {
      logger.info('Redis disabled, using memory session store');
      return createMemoryStore();
    }

    let client: Redis | null = null;

    try {
      client = new Redis(config.redis.url, {
        password: config.redis.password || undefined,
        tls: config.redis.tls ? {} : undefined,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        connectTimeout: 3000, // 3 seconds timeout
        retryStrategy: () => null, // Disable retries
        reconnectOnError: () => false, // Disable reconnection on error
      });

      // Setup error handler before connecting
      client.on('error', (err) => {
        console.warn('Redis connection error, will use memory fallback:', err.message);
        // Close the connection and don't retry
        try {
          client?.disconnect();
        } catch (e) {
          // Ignore disconnection errors
        }
      });
    } catch (err) {
      console.error('Failed to create Redis client:', err);
      // Return memory store
      return createMemoryStore();
    }

    // Connect to Redis
    await client.connect();

    // Test the connection
    await client.ping();

    redis = {
      client,
      isConnected: true,
      get: async (key: string): Promise<string | null> => {
        try {
          return await client.get(key);
        } catch (error) {
          logger.error('Redis GET error:', { key, error });
          return null; // Graceful failure
        }
      },
      set: async (key: string, value: string, ttl?: number): Promise<void> => {
        try {
          if (!client) return;
          if (ttl) {
            await client.setex(key, ttl, value);
          } else {
            await client.set(key, value);
          }
        } catch (error) {
          logger.error('Redis SET error:', { key, error });
          throw error;
        }
      },
      del: async (key: string): Promise<void> => {
        try {
          if (!client) return;
          await client.del(key);
        } catch (error) {
          logger.error('Redis DEL error:', { key, error });
          // Graceful failure
        }
      },
      exists: async (key: string): Promise<boolean> => {
        try {
          if (!client) return false;
          const result = await client.exists(key);
          return result === 1;
        } catch (error) {
          logger.error('Redis EXISTS error:', { key, error });
          return false; // Graceful failure
        }
      },
      expire: async (key: string, ttl: number): Promise<void> => {
        try {
          if (!client) return;
          await client.expire(key, ttl);
        } catch (error) {
          logger.error('Redis EXPIRE error:', { key, ttl, error });
          // Graceful failure
        }
      },
      disconnect: (): void => {
        client.disconnect();
        redis.isConnected = false;
      },
    };

    // Handle Redis events
    client.on('connect', () => {
      console.info('Redis client connected');
      redis.isConnected = true;
    });

    client.on('ready', () => {
      console.info('Redis client ready');
    });

    client.on('error', (error) => {
      console.error('Redis client error:', error.message);
      redis.isConnected = false;
    });

    client.on('close', () => {
      console.warn('Redis client connection closed');
      redis.isConnected = false;
    });

    client.on('reconnecting', () => {
      console.info('Redis client reconnecting');
    });

    logger.info('Redis connection established successfully');
    return redis;
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);

    // For development, we might want to continue without Redis
    if (config.isDevelopment || config.session.store === 'memory') {
      logger.warn('Redis connection failed, but continuing with memory session store');
      return createMemoryStore();
    } else {
      throw error;
    }
  }
}

function createMockRedis(): RedisConfig {
  const mockStorage = new Map<string, { value: string; expiry?: number }>();

  return {
    client: null as any,
    isConnected: false,
    get: async (key: string): Promise<string | null> => {
      const item = mockStorage.get(key);
      if (!item) return null;

      if (item.expiry && Date.now() > item.expiry) {
        mockStorage.delete(key);
        return null;
      }

      return item.value;
    },
    set: async (key: string, value: string, ttl?: number): Promise<void> => {
      const expiry = ttl ? Date.now() + ttl * 1000 : undefined;
      mockStorage.set(key, { value, expiry });
    },
    del: async (key: string): Promise<void> => {
      mockStorage.delete(key);
    },
    exists: async (key: string): Promise<boolean> => {
      const item = mockStorage.get(key);
      if (!item) return false;

      if (item.expiry && Date.now() > item.expiry) {
        mockStorage.delete(key);
        return false;
      }

      return true;
    },
    expire: async (key: string, ttl: number): Promise<void> => {
      const item = mockStorage.get(key);
      if (item) {
        item.expiry = Date.now() + ttl * 1000;
        mockStorage.set(key, item);
      }
    },
    disconnect: (): void => {
      mockStorage.clear();
    },
  };
}

export function getRedis(): RedisConfig {
  if (!redis) {
    throw new Error('Redis not initialized. Call initializeRedis() first.');
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis && redis.isConnected) {
    redis.disconnect();
    logger.info('Redis connection closed');
  }
}
