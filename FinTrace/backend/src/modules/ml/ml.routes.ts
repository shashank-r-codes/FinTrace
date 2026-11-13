import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';

const router = Router();

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const predictionsQuerySchema = z.object({
  complaintId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

async function callMlService<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.ML_SERVICE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new AppError(
      `ML service error (${response.status}): ${errText}`,
      response.status >= 500 ? 502 : response.status,
      'ML_SERVICE_ERROR'
    );
  }
  return (await response.json()) as T;
}

router.use(authenticate);

router.post(
  '/train',
  authorizeRoles('Administrator', 'Senior Investigator'),
  async (req, res, next) => {
    try {
      const result = await callMlService<Record<string, unknown>>('/ml/train', {
        method: 'POST',
      });

      await recordAuditLog({
        req,
        action: 'ML_MODELS_TRAINED',
        resourceType: 'ML_MODEL',
        resourceId: String(result.model_version ?? 'latest'),
        statusCode: 200,
        details: {
          split_strategy: result.split_strategy,
          metrics: result.metrics,
        },
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/metrics', async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT *
       FROM model_metrics
       ORDER BY trained_at DESC
       LIMIT 10`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/detect/:id',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ params: idParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { id: string }>, res, next) => {
    try {
      const { id } = req.validatedParams!;
      const cmpCheck = await query('SELECT id FROM complaints WHERE id = $1 LIMIT 1', [id]);
      if (!cmpCheck.rows[0]) {
        throw new AppError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND');
      }

      const result = await callMlService<{
        complaint_id: string;
        score_source: string;
        predictions: Array<{ account_id: string; mule_score: number; is_anomaly: boolean }>;
      }>(`/ml/detect/${id}`, { method: 'POST' });

      await recordAuditLog({
        req,
        action: 'ML_FRAUD_DETECTION_RUN',
        resourceType: 'COMPLAINT',
        resourceId: id,
        statusCode: 200,
        details: {
          score_source: result.score_source,
          accounts_scored: result.predictions.length,
        },
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/predictions',
  validate({ query: predictionsQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof predictionsQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.complaintId) {
        params.push(q.complaintId);
        conditions.push(`fdr.complaint_id = $${params.length}`);
      }
      if (q.accountId) {
        params.push(q.accountId);
        conditions.push(`fdr.account_id = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(q.limit);

      const sql = `
        SELECT fdr.*,
               ba.account_number, ba.holder_name, ba.branch_city, ba.is_frozen,
               c.complaint_number,
               mp.shap_values_json, mp.model_name, mp.model_version, mp.predicted_label
        FROM fraud_detection_results fdr
        JOIN bank_accounts ba ON ba.id = fdr.account_id
        LEFT JOIN complaints c ON c.id = fdr.complaint_id
        LEFT JOIN LATERAL (
          SELECT shap_values_json, model_name, model_version, predicted_label
          FROM ml_predictions mp2
          WHERE mp2.account_id = fdr.account_id
            AND (mp2.complaint_id = fdr.complaint_id OR mp2.complaint_id IS NULL)
          ORDER BY mp2.predicted_at DESC
          LIMIT 1
        ) mp ON TRUE
        ${whereClause}
        ORDER BY fdr.detected_at DESC, fdr.mule_score DESC
        LIMIT $${params.length}
      `;
      const result = await query(sql, params);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/clusters/atms', async (_req, res, next) => {
  try {
    const clusters = await callMlService('/ml/clusters/atms');
    res.json({ success: true, data: clusters });
  } catch (err) {
    next(err);
  }
});

export default router;
