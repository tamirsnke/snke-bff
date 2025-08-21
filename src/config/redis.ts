import Redis from 'ioredis';
import { config } from '@/config';
import { logger } from '@/utils/logger';

interface RedisConfig {
  client: Redis;
  isConnected: boolean;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttl?: number) => Promise<void>;
  del: (key: string) => Promise<void>;
  exists: (key: string) => Promise<boolean>;
  expire: (key: string, ttl: number) => Promise<void>;
  disconnect: () => void;
}

let redis: RedisConfig;

export async function initializeRedis(): Promise<void> {
  try {
    const client = new Redis(config.redis.url, {
      password: config.redis.password || undefined,
      tls: config.redis.tls ? {} : undefined,
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        return err.message.includes(targetError);
      },
    });

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
          throw error;
        }
      },
      set: async (key: string, value: string, ttl?: number): Promise<void> => {
        try {
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
          await client.del(key);
        } catch (error) {
          logger.error('Redis DEL error:', { key, error });
          throw error;
        }
      },
      exists: async (key: string): Promise<boolean> => {
        try {
          const result = await client.exists(key);
          return result === 1;
        } catch (error) {
          logger.error('Redis EXISTS error:', { key, error });
          throw error;
        }
      },
      expire: async (key: string, ttl: number): Promise<void> => {
        try {
          await client.expire(key, ttl);
        } catch (error) {
          logger.error('Redis EXPIRE error:', { key, ttl, error });
          throw error;
        }
      },
      disconnect: (): void => {
        client.disconnect();
        redis.isConnected = false;
      },
    };

    // Handle Redis events
    client.on('connect', () => {
      logger.info('Redis client connected');
      redis.isConnected = true;
    });

    client.on('ready', () => {
      logger.info('Redis client ready');
    });

    client.on('error', (error) => {
      logger.error('Redis client error:', error);
      redis.isConnected = false;
    });

    client.on('close', () => {
      logger.warn('Redis client connection closed');
      redis.isConnected = false;
    });

    client.on('reconnecting', () => {
      logger.info('Redis client reconnecting');
    });

    logger.info('Redis connection established successfully');
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);

    // For development, we might want to continue without Redis
    if (config.isDevelopment && config.session.store === 'memory') {
      logger.warn('Redis connection failed, but continuing with memory session store');
      redis = createMockRedis();
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
