import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from '@/config';
import { logger } from '@/utils/logger';

interface DatabaseConfig {
  pool: Pool;
  query: (text: string, params?: any[]) => Promise<QueryResult>;
  getClient: () => Promise<PoolClient>;
  end: () => Promise<void>;
}

let database: DatabaseConfig;

export async function initializeDatabase(): Promise<void> {
  try {
    const pool = new Pool({
      connectionString: config.database.url,
      ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
      min: config.database.pool.min,
      max: config.database.pool.max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test the connection
    await pool.query('SELECT NOW()');

    database = {
      pool,
      query: async (text: string, params?: any[]): Promise<QueryResult> => {
        const start = Date.now();
        try {
          const result = await pool.query(text, params);
          const duration = Date.now() - start;
          logger.debug('Executed query', { text, duration, rows: result.rowCount });
          return result;
        } catch (error) {
          logger.error('Database query error', { text, error });
          throw error;
        }
      },
      getClient: async (): Promise<PoolClient> => {
        return await pool.connect();
      },
      end: async (): Promise<void> => {
        await pool.end();
      },
    };

    // Create tables if they don't exist
    await createTables();

    logger.info('Database connection established successfully');
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }
}

async function createTables(): Promise<void> {
  const client = await database.getClient();

  try {
    await client.query('BEGIN');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        keycloak_id VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        roles TEXT[] DEFAULT '{}',
        is_active BOOLEAN DEFAULT TRUE,
        last_login TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Sessions table for database session storage fallback
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR(255) PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP WITH TIME ZONE NOT NULL
      )
    `);

    // Audit logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        action VARCHAR(255) NOT NULL,
        resource VARCHAR(255),
        details JSONB,
        ip_address INET,
        user_agent TEXT,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // API tokens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        token_hash VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        scopes TEXT[] DEFAULT '{}',
        expires_at TIMESTAMP WITH TIME ZONE,
        last_used TIMESTAMP WITH TIME ZONE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Rate limit tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id VARCHAR(255) PRIMARY KEY,
        hits INTEGER DEFAULT 0,
        reset_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_keycloak_id ON users(keycloak_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_time ON rate_limits(reset_time);
    `);

    await client.query('COMMIT');
    logger.info('Database tables created/verified successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to create database tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

export function getDatabase(): DatabaseConfig {
  if (!database) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (database) {
    await database.end();
    logger.info('Database connection closed');
  }
}
