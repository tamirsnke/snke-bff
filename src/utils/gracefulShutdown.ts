import { Server } from 'http';
import { logger } from '@/utils/logger';
import { closeDatabase } from '@/config/database';
import { closeRedis } from '@/config/redis';
import { shutdownMonitoring } from '@/config/monitoring';

let isShuttingDown = false;

export function gracefulShutdown(server: Server): void {
  const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'] as const;

  signals.forEach((signal) => {
    process.on(signal, async () => {
      if (isShuttingDown) {
        console.warn(`Received ${signal} but shutdown already in progress`);
        return;
      }

      isShuttingDown = true;
      console.log(`Received ${signal}, starting graceful shutdown...`);

      await shutdown(server, signal);
    });
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await shutdown(server, 'uncaughtException');
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await shutdown(server, 'unhandledRejection');
    process.exit(1);
  });
}

async function shutdown(server: Server, reason: string): Promise<void> {
  const startTime = Date.now();
  console.info(`Shutdown initiated due to: ${reason}`);

  try {
    // Stop accepting new connections
    server.close((err) => {
      if (err) {
        console.error('Error closing server:', err);
      } else {
        logger.info('HTTP server closed');
      }
    });

    // Set a timeout for force shutdown
    const forceShutdownTimeout = setTimeout(() => {
      logger.error('Force shutdown due to timeout');
      process.exit(1);
    }, 30000); // 30 seconds timeout

    // Gracefully close all connections
    await Promise.all([closeDatabase(), closeRedis(), shutdownMonitoring()]);

    clearTimeout(forceShutdownTimeout);

    const duration = Date.now() - startTime;
    logger.info(`Graceful shutdown completed in ${duration}ms`);

    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}
