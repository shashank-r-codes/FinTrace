import { createApp } from './app.js';
import { pool } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, mlServiceUrl: env.ML_SERVICE_URL },
    'FinTrace Backend API started'
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down FinTrace Backend API...');
  server.close(async () => {
    await pool.end();
    logger.info('PostgreSQL pool closed cleanly.');
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
