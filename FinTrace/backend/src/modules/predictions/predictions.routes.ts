import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeOfficer, authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';

export const atmsRouter = Router();
export const predictionsRouter = Router();

const atmsQuerySchema = z.object({
  city: z.string().max(100).optional(),
  locality: z.string().max(120).optional(),
  is24x7: z.enum(['true', 'false']).optional(),
});

const withdrawalsQuerySchema = z.object({
  atmId: z.string().max(40).optional(),
  accountId: z.string().uuid().optional(),
  complaintId: z.string().uuid().optional(),
  flaggedOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const runPredictionParamsSchema = z.object({
  complaintId: z.string().uuid(),
});

const runPredictionQuerySchema = z.object({
  topN: z.coerce.number().int().min(1).max(20).default(8),
  autoAlert: z.enum(['true', 'false']).default('true'),
});

const listPredictionsQuerySchema = z.object({
  complaintId: z.string().uuid().optional(),
  riskLevel: z.enum(['Critical', 'High', 'Medium', 'Low']).optional(),
  window: z.enum(['0-6h', '6-12h', '12-24h', '>24h']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

atmsRouter.use(authenticate, authorizeOfficer);
predictionsRouter.use(authenticate, authorizeOfficer);

atmsRouter.get(
  '/',
  validate({ query: atmsQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof atmsQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.city) {
        params.push(`%${q.city}%`);
        conditions.push(`a.city ILIKE $${params.length}`);
      }
      if (q.locality) {
        params.push(`%${q.locality}%`);
        conditions.push(`a.locality ILIKE $${params.length}`);
      }
      if (q.is24x7 === 'true') {
        conditions.push('a.is_24x7 = TRUE');
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `
        SELECT a.*,
               COALESCE(MAX(ap.risk_score), 0)::float AS max_risk_score,
               COUNT(DISTINCT ap.complaint_id)::int AS active_prediction_cases,
               COUNT(DISTINCT aw.id)::int AS historical_withdrawal_count
        FROM atms a
        LEFT JOIN atm_predictions ap ON ap.atm_id = a.id
        LEFT JOIN atm_withdrawals aw ON aw.atm_id = a.id
        ${whereClause}
        GROUP BY a.id
        ORDER BY max_risk_score DESC, a.id ASC
      `;
      const result = await query(sql, params);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

atmsRouter.get(
  '/withdrawals',
  validate({ query: withdrawalsQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof withdrawalsQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.atmId) {
        params.push(q.atmId);
        conditions.push(`aw.atm_id = $${params.length}`);
      }
      if (q.accountId) {
        params.push(q.accountId);
        conditions.push(`aw.account_id = $${params.length}`);
      }
      if (q.complaintId) {
        params.push(q.complaintId);
        conditions.push(`aw.complaint_id = $${params.length}`);
      }
      if (q.flaggedOnly === 'true') {
        conditions.push('aw.is_flagged_cashout = TRUE');
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(q.limit);

      const sql = `
        SELECT aw.*, a.bank, a.address, a.locality, a.city, a.lat, a.lng,
               ba.account_number, ba.holder_name, c.complaint_number
        FROM atm_withdrawals aw
        JOIN atms a ON a.id = aw.atm_id
        JOIN bank_accounts ba ON ba.id = aw.account_id
        LEFT JOIN complaints c ON c.id = aw.complaint_id
        ${whereClause}
        ORDER BY aw.withdrawn_at DESC
        LIMIT $${params.length}
      `;
      const result = await query(sql, params);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

predictionsRouter.post(
  '/atm/run/:complaintId',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ params: runPredictionParamsSchema, query: runPredictionQuerySchema }),
  async (
    req: ValidatedRequest<
      unknown,
      z.infer<typeof runPredictionQuerySchema>,
      z.infer<typeof runPredictionParamsSchema>
    >,
    res,
    next
  ) => {
    try {
      const { complaintId } = req.validatedParams!;
      const q = req.validatedQuery!;

      const cmpRes = await query<{ id: string; complaint_number: string; status: string }>(
        'SELECT id, complaint_number, status FROM complaints WHERE id = $1 LIMIT 1',
        [complaintId]
      );
      const complaint = cmpRes.rows[0];
      if (!complaint) {
        throw new AppError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND');
      }

      const mlResp = await fetch(`${env.ML_SERVICE_URL}/atm/predict/${complaintId}?top_n=${q.topN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!mlResp.ok) {
        const errText = await mlResp.text();
        throw new AppError(`ATM predictor error (${mlResp.status}): ${errText}`, 502, 'ML_SERVICE_ERROR');
      }

      const data = (await mlResp.json()) as {
        complaint_id: string;
        complaint_number: string;
        score_source: string;
        model_version: string;
        top_3_atms: Array<{
          atm_id: string;
          locality: string;
          risk_score: number;
          risk_level: string;
          window: string;
          linked_accounts_json: Array<{ account_id: string; account_number: string }>;
        }>;
        predictions: Array<Record<string, unknown>>;
      };

      // Generate early warning alert for Critical / 0-6h prediction if requested
      if (q.autoAlert === 'true' && data.top_3_atms.length > 0) {
        const top = data.top_3_atms[0];
        if (top.risk_level === 'Critical' || top.risk_level === 'High') {
          const linkedAccId = top.linked_accounts_json?.[0]?.account_id ?? null;
          const existingAlert = await query(
            `SELECT id FROM alerts
             WHERE complaint_id = $1 AND atm_id = $2 AND status IN ('OPEN', 'ACKNOWLEDGED')
             LIMIT 1`,
            [complaintId, top.atm_id]
          );
          if (!existingAlert.rows[0]) {
            await query(
              `INSERT INTO alerts (
                 complaint_id, account_id, atm_id, alert_type, severity, status, title, description, score_source
               )
               VALUES ($1, $2, $3, 'CASH_OUT_IMMINENT', $4, 'OPEN', $5, $6, $7)`,
              [
                complaintId,
                linkedAccId,
                top.atm_id,
                top.risk_level === 'Critical' ? 'Critical' : 'High',
                `Predicted Cash-Out Hotspot: ${top.locality} (${top.window})`,
                `${complaint.complaint_number}: Top-ranked terminal ${top.atm_id} scored ${top.risk_score}/100 (${top.risk_level}) for ${top.window} window.`,
                data.score_source,
              ]
            );
          }

          if (complaint.status === 'REGISTERED' || complaint.status === 'TRACING' || complaint.status === 'MULE_IDENTIFIED') {
            await query("UPDATE complaints SET status = 'ATM_ALERTED', updated_at = NOW() WHERE id = $1", [
              complaintId,
            ]);
          }
        }
      }

      await recordAuditLog({
        req,
        action: 'ATM_PREDICTION_EXECUTED',
        resourceType: 'COMPLAINT',
        resourceId: complaintId,
        statusCode: 200,
        details: {
          score_source: data.score_source,
          model_version: data.model_version,
          predicted_count: data.predictions.length,
        },
      });

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

predictionsRouter.get(
  '/atm',
  validate({ query: listPredictionsQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof listPredictionsQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.complaintId) {
        params.push(q.complaintId);
        conditions.push(`ap.complaint_id = $${params.length}`);
      }
      if (q.riskLevel) {
        params.push(q.riskLevel);
        conditions.push(`ap.risk_level = $${params.length}`);
      }
      if (q.window) {
        params.push(q.window);
        conditions.push(`ap."window" = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(q.limit);

      const sql = `
        SELECT ap.*,
               a.bank, a.address, a.locality, a.city, a.state, a.lat, a.lng, a.cash_capacity_tier, a.is_24x7,
               c.complaint_number, c.fraud_type, c.reported_amount
        FROM atm_predictions ap
        JOIN atms a ON a.id = ap.atm_id
        JOIN complaints c ON c.id = ap.complaint_id
        ${whereClause}
        ORDER BY ap.risk_score DESC, ap.rank_order ASC
        LIMIT $${params.length}
      `;
      const result = await query(sql, params);

      res.json({
        success: true,
        data: {
          top3: result.rows.slice(0, 3),
          predictions: result.rows,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

predictionsRouter.get('/atm/heatmap', async (_req, res, next) => {
  try {
    const sql = `
      SELECT a.id AS atm_id, a.bank, a.address, a.locality, a.city, a.lat, a.lng,
             COALESCE(MAX(ap.risk_score), 0)::float AS max_risk_score,
             COALESCE(
               (ARRAY_AGG(ap.risk_level ORDER BY ap.risk_score DESC))[1],
               'Low'
             ) AS peak_risk_level,
             COALESCE(
               (ARRAY_AGG(ap."window" ORDER BY ap.risk_score DESC))[1],
               '>24h'
             ) AS peak_window,
             (ARRAY_AGG(ap.linked_accounts_json ORDER BY ap.risk_score DESC))[1] AS top_linked_accounts,
             (ARRAY_AGG(ap.relevant_paths_json ORDER BY ap.risk_score DESC))[1] AS top_relevant_paths,
             COUNT(ap.id)::int AS prediction_count,
             COUNT(aw.id)::int AS withdrawal_count
      FROM atms a
      LEFT JOIN atm_predictions ap ON ap.atm_id = a.id
      LEFT JOIN atm_withdrawals aw ON aw.atm_id = a.id
      GROUP BY a.id
      ORDER BY max_risk_score DESC
    `;
    const result = await query(sql);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});
