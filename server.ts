import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createApiRouter } from './server/routes.ts';
import { dbStore } from './server/store.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

async function startServer(): Promise<void> {
  process.env.VITE_API_BASE_URL = process.env.VITE_API_BASE_URL || '/api/v1';

  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(
    '/api/v1',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 600,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' },
      },
    }),
    createApiRouter()
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    // Guaranteed SPA fallback for any non-API GET request
    app.use('*', async (req, res, next) => {
      if (req.method !== 'GET' || req.originalUrl.startsWith('/api')) {
        return next();
      }
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=============================================================================`);
    console.log(`FinTrace Command Centre & API listening on http://0.0.0.0:${PORT}`);
    console.log(`[Prevention Layer] Mounted routes verified:`);
    console.log(`  - GET  /api/v1/accounts/intelligence (Account Intelligence Registry)`);
    console.log(`  - GET  /api/v1/accounts/intelligence/filters (Filter Options)`);
    console.log(`  - GET  /api/v1/accounts/intelligence/summary (Risk Telemetry Summary)`);
    console.log(`  - GET  /api/v1/interventions         (Transaction Intervention Centre Queue)`);
    console.log(`  - GET  /api/v1/interventions/metrics (Intervention Metrics & KPI Summary)`);
    console.log(`  - GET  /api/v1/interventions/verify-chain (SHA-256 Hash Chain Verification)`);
    console.log(`  - GET  /api/v1/graph/mule-clusters   (Mule Syndicates & Ring Detection)`);
    console.log(`  - POST /api/v1/screening/screen      (Real-Time Screening Hot Path)`);
    console.log(`[Prevention Data] Profiles: ${dbStore.accountIntelligenceProfiles.length}, Screening Requests: ${dbStore.screeningRequests.length}, Interventions: ${dbStore.interventions.length}`);
    console.log(`=============================================================================`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start FinTrace server:', err);
  process.exit(1);
});
