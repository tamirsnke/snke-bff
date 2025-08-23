import express from 'express';
import { Server } from 'http';
import { config } from '@/config';
import { initializeMonitoring } from '@/config/monitoring';
import { initializeDatabase } from '@/config/database';
import { initializeRedis, getRedis } from '@/config/redis';
import { initializeKeycloak } from '@/config/keycloak';
import { setupMiddleware } from '@/middleware';
import { setupRoutes } from '@/routes';
import { logger } from '@/utils/logger';
import { gracefulShutdown } from '@/utils/gracefulShutdown';

class Application {
  private app: express.Application;
  private server: Server | null = null;

  constructor() {
    this.app = express();
  }

  public async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing SNKE BFF Application...');

      // Initialize monitoring first
      await initializeMonitoring();
      console.log('🔍 Monitoring initialized');

      // Initialize database (graceful failure)
      try {
        await initializeDatabase();
        console.log('🗄️  Database initialized');
      } catch (error) {
        console.warn(
          '⚠️  Database initialization failed, continuing without DB:',
          error instanceof Error ? error.message : String(error)
        );
      }

      // Initialize Redis (graceful failure)
      try {
        await initializeRedis();
        const redisInstance = getRedis();
        if (redisInstance.isConnected && redisInstance.client) {
          console.log('🔴 Redis initialized and connected');
        } else {
          console.log('Redis not available, using memory session store');
        }
      } catch (error) {
        console.warn(
          '⚠️  Redis initialization failed, using memory session store:',
          error instanceof Error ? error.message : String(error)
        );
      }

      // Initialize Keycloak (graceful failure)
      try {
        await initializeKeycloak();
        console.log('🔐 Keycloak initialized');
      } catch (error) {
        console.warn(
          '⚠️  Keycloak initialization failed, auth will be disabled:',
          error instanceof Error ? error.message : String(error)
        );
      }

      // Setup middleware
      setupMiddleware(this.app);
      console.log('🔧 Middleware configured');

      // Setup routes
      setupRoutes(this.app);
      console.log('🛣️  Routes configured');

      console.log('✅ Application initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
      process.exit(1);
    }
  }

  public async start(): Promise<void> {
    const port = config.server.port;
    const host = config.server.host;

    this.server = this.app.listen(port, host, () => {
      console.log(
        `🚀 BFF Server running on ${config.server.ssl.enabled ? 'https' : 'http'}://${host}:${port}`
      );
      console.log(
        `📊 Metrics available at http://${host}:${config.monitoring.metricsPort}/metrics`
      );
      console.log(`📖 API Documentation at http://${host}:${port}/api-docs`);
      console.log(`🏥 Health check at http://${host}:${port}/health`);
    });

    // Setup graceful shutdown
    gracefulShutdown(this.server);
  }

  public getApp(): express.Application {
    return this.app;
  }
}

// Start the application
async function bootstrap(): Promise<void> {
  const app = new Application();
  await app.initialize();
  await app.start();
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  bootstrap().catch((error) => {
    console.error('Failed to start application:', error);
    process.exit(1);
  });
}

export { Application };
