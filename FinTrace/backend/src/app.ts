import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { query } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import accountsRoutes from './modules/accounts/accounts.routes.js';
import alertsRoutes from './modules/alerts/alerts.routes.js';
import assistantRoutes from './modules/assistant/assistant.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import citizenRoutes from './modules/citizen/citizen.routes.js';
import complaintsRoutes from './modules/complaints/complaints.routes.js';
import evidenceRoutes from './modules/evidence/evidence.routes.js';
import graphRoutes from './modules/graph/graph.routes.js';
import investigationsRoutes from './modules/investigations/investigations.routes.js';
import interventionsRoutes from './modules/interventions/interventions.routes.js';
import mlRoutes from './modules/ml/ml.routes.js';
import { atmsRouter, predictionsRouter } from './modules/predictions/predictions.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';
import screeningRoutes from './modules/screening/screening.routes.js';
import transactionsRoutes from './modules/transactions/transactions.routes.js';
import usersRoutes from './modules/users/users.routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    })
  );
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' },
      },
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: env.NODE_ENV !== 'test',
    })
  );

  // Health Check
  app.get('/api/v1/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      let preventionStatus = 'READY';
      let preventionCounts = { accounts: 0, screening: 0, interventions: 0 };
      try {
        const pCheck = await query(`
          SELECT 
            (SELECT COUNT(*) FROM account_intelligence_profiles)::int AS accounts,
            (SELECT COUNT(*) FROM transaction_screening_requests)::int AS screening,
            (SELECT COUNT(*) FROM transaction_interventions)::int AS interventions
        `);
        if (pCheck.rows[0]) {
          preventionCounts = pCheck.rows[0];
        }
      } catch {
        preventionStatus = 'MIGRATION_PENDING';
      }

      res.json({
        success: true,
        service: 'fintrace-backend',
        status: 'healthy',
        database: 'connected',
        syntheticDemo: true,
        preventionLayer: {
          status: preventionStatus,
          accountProfilesCount: preventionCounts.accounts,
          screeningRequestsCount: preventionCounts.screening,
          interventionsCount: preventionCounts.interventions,
        },
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        success: false,
        service: 'fintrace-backend',
        status: 'degraded',
        database: 'disconnected',
      });
    }
  });

  // Core API v1 routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/citizen', citizenRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/complaints', complaintsRoutes);
  app.use('/api/v1/screening', screeningRoutes);
  app.use('/api/v1/interventions', interventionsRoutes);
  app.use('/api/v1/accounts', accountsRoutes);
  app.use('/api/v1/transactions', transactionsRoutes);
  app.use('/api/v1/alerts', alertsRoutes);
  app.use('/api/v1/audit-logs', auditRoutes);
  app.use('/api/v1/graph', graphRoutes);
  app.use('/api/v1/ml', mlRoutes);
  app.use('/api/v1/atms', atmsRouter);
  app.use('/api/v1/predictions', predictionsRouter);
  app.use('/api/v1/investigations', investigationsRoutes);
  app.use('/api/v1/evidence', evidenceRoutes);
  app.use('/api/v1/reports', reportsRoutes);
  app.use('/api/v1/assistant', assistantRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
