import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeOfficer, authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';
import {
  getAccountIntelligenceDetail,
  getAccountRiskHistory,
  getIntelligenceFilters,
  getIntelligenceRegistry,
  getIntelligenceSummary,
  listIntelligenceQuerySchema,
  reEvaluateAccountProfile,
  updateAccountClassification,
  updateClassificationSchema,
} from './accounts.intelligence.js';

const router = Router();

const listAccountsQuerySchema = z.object({
  search: z.string().max(100).optional(),
  frozenOnly: z.enum(['true', 'false']).optional(),
  suspiciousOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  offset: z.coerce.number().int().min(0).default(0),
});

const flagAccountSchema = z.object({
  complaintId: z.string().uuid().nullable().optional(),
  classification: z.enum([
    'SUSPECTED_MULE',
    'LAYERING_NODE',
    'CASH_OUT_CANDIDATE',
    'ORIGIN_COMPROMISED',
    'CLEARED',
  ]),
  muleProbability: z.number().min(0).max(1).nullable().optional(),
  scoreSource: z
    .enum(['Trained ML prediction', 'Rule-based risk score', 'Synthetic demo result'])
    .default('Rule-based risk score'),
  reason: z.string().min(5).max(1000),
  freezeAccount: z.boolean().default(false),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const accountIdParamSchema = z.object({
  accountId: z.string().uuid(),
});

router.use(authenticate, authorizeOfficer);

// ---------------- INSTITUTIONS ----------------
router.get('/institutions', async (_req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, ifsc_prefix, bank_code, nodal_email, headquarters, is_synthetic FROM financial_institutions ORDER BY name ASC'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// PREVENTION LAYER: ACCOUNT INTELLIGENCE & RISK REGISTRY (Phase 2)
// (Mounted BEFORE /:id to prevent parameter route shadowing)
// =============================================================================

router.get(
  '/intelligence',
  validate({ query: listIntelligenceQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof listIntelligenceQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const result = await getIntelligenceRegistry(q);
      res.json({
        success: true,
        data: result.accounts,
        summary: result.summary,
        pagination: result.pagination,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Route order: Literal routes declared BEFORE parameterised :accountId to prevent shadowing.
 */
router.get('/intelligence/filters', async (_req, res, next) => {
  try {
    const data = await getIntelligenceFilters();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/intelligence/summary', async (_req, res, next) => {
  try {
    const data = await getIntelligenceSummary();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/intelligence/:accountId',
  validate({ params: accountIdParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { accountId: string }>, res, next) => {
    try {
      const { accountId } = req.validatedParams!;
      const data = await getAccountIntelligenceDetail(accountId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/intelligence/:accountId/history',
  validate({ params: accountIdParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { accountId: string }>, res, next) => {
    try {
      const { accountId } = req.validatedParams!;
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const data = await getAccountRiskHistory(accountId, limit, offset);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/intelligence/:accountId/classification',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
  validate({ params: accountIdParamSchema, body: updateClassificationSchema }),
  async (
    req: ValidatedRequest<z.infer<typeof updateClassificationSchema>, Record<string, unknown>, { accountId: string }>,
    res,
    next
  ) => {
    try {
      const { accountId } = req.validatedParams!;
      const body = req.body as z.infer<typeof updateClassificationSchema>;
      const updated = await updateAccountClassification(accountId, body, req.user!.userId);

      await recordAuditLog({
        req,
        action: 'ACCOUNT_CLASSIFICATION_UPDATED',
        resourceType: 'ACCOUNT_INTELLIGENCE',
        resourceId: accountId,
        statusCode: 200,
        details: {
          classification: body.classification,
          reason: body.reason,
          complaintId: body.complaintId ?? null,
          evidenceId: body.evidenceId ?? null,
          freezeAccount: body.freezeAccount,
        },
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/intelligence/:accountId/re-evaluate',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
  validate({ params: accountIdParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { accountId: string }>, res, next) => {
    try {
      const { accountId } = req.validatedParams!;
      const result = await reEvaluateAccountProfile(accountId, req.user!.userId);

      await recordAuditLog({
        req,
        action: 'ACCOUNT_INTELLIGENCE_REEVALUATED',
        resourceType: 'ACCOUNT_INTELLIGENCE',
        resourceId: accountId,
        statusCode: 200,
        details: {
          risk_score: result.risk_score,
          risk_classification: result.risk_classification,
          account_status: result.account_status,
          mule_indicators: result.mule_indicators,
        },
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------- EXISTING ACCOUNTS LISTING ----------------
router.get(
  '/',
  validate({ query: listAccountsQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof listAccountsQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.search) {
        params.push(`%${q.search}%`);
        conditions.push(
          `(ba.account_number ILIKE $${params.length} OR ba.holder_name ILIKE $${params.length} OR ba.branch_city ILIKE $${params.length})`
        );
      }
      if (q.frozenOnly === 'true') {
        conditions.push('ba.is_frozen = TRUE');
      }
      if (q.suspiciousOnly === 'true') {
        conditions.push('EXISTS (SELECT 1 FROM suspicious_accounts sa WHERE sa.account_id = ba.id AND sa.status <> \'CLEARED\')');
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(q.limit);
      const limitIdx = params.length;
      params.push(q.offset);
      const offsetIdx = params.length;

      const sql = `
        SELECT ba.*, fi.name AS bank_name, fi.bank_code,
               COALESCE(sa_agg.flag_count, 0)::int AS suspicious_flag_count,
               sa_agg.max_mule_prob,
               COALESCE(in_agg.inflow_total, 0)::numeric AS inflow_total,
               COALESCE(out_agg.outflow_total, 0)::numeric AS outflow_total
        FROM bank_accounts ba
        JOIN financial_institutions fi ON fi.id = ba.institution_id
        LEFT JOIN (
          SELECT account_id, COUNT(*) AS flag_count, MAX(mule_probability) AS max_mule_prob
          FROM suspicious_accounts
          WHERE status <> 'CLEARED'
          GROUP BY account_id
        ) sa_agg ON sa_agg.account_id = ba.id
        LEFT JOIN (
          SELECT to_account AS account_id, SUM(amount) AS inflow_total
          FROM transactions
          GROUP BY to_account
        ) in_agg ON in_agg.account_id = ba.id
        LEFT JOIN (
          SELECT from_account AS account_id, SUM(amount) AS outflow_total
          FROM transactions
          GROUP BY from_account
        ) out_agg ON out_agg.account_id = ba.id
        ${whereClause}
        ORDER BY suspicious_flag_count DESC, ba.account_number ASC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;

      const result = await query(sql, params);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------- EXISTING ACCOUNT DETAIL ----------------
router.get(
  '/:id',
  validate({ params: idParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { id: string }>, res, next) => {
    try {
      const { id } = req.validatedParams!;
      const accRes = await query(
        `SELECT ba.*, fi.name AS bank_name, fi.bank_code
         FROM bank_accounts ba
         JOIN financial_institutions fi ON fi.id = ba.institution_id
         WHERE ba.id = $1
         LIMIT 1`,
        [id]
      );
      if (!accRes.rows[0]) {
        throw new AppError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND');
      }

      const [txnsRes, flagsRes, withdrawalsRes] = await Promise.all([
        query(
          `SELECT t.*, fa.account_number AS from_account_number, ta.account_number AS to_account_number
           FROM transactions t
           JOIN bank_accounts fa ON fa.id = t.from_account
           JOIN bank_accounts ta ON ta.id = t.to_account
           WHERE t.from_account = $1 OR t.to_account = $1
           ORDER BY t.timestamp DESC
           LIMIT 100`,
          [id]
        ),
        query(
          `SELECT sa.*, c.complaint_number
           FROM suspicious_accounts sa
           LEFT JOIN complaints c ON c.id = sa.complaint_id
           WHERE sa.account_id = $1
           ORDER BY sa.created_at DESC`,
          [id]
        ),
        query(
          `SELECT aw.*, a.bank, a.address, a.locality, a.city
           FROM atm_withdrawals aw
           JOIN atms a ON a.id = aw.atm_id
           WHERE aw.account_id = $1
           ORDER BY aw.withdrawn_at DESC`,
          [id]
        ),
      ]);

      res.json({
        success: true,
        data: {
          account: accRes.rows[0],
          transactions: txnsRes.rows,
          suspiciousFlags: flagsRes.rows,
          atmWithdrawals: withdrawalsRes.rows,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------- EXISTING FLAG / FREEZE ACCOUNT ----------------
router.post(
  '/:id/flag',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
  validate({ params: idParamSchema, body: flagAccountSchema }),
  async (
    req: ValidatedRequest<z.infer<typeof flagAccountSchema>, Record<string, unknown>, { id: string }>,
    res,
    next
  ) => {
    try {
      const { id } = req.validatedParams!;
      const body = req.body as z.infer<typeof flagAccountSchema>;

      const flagged = await withTransaction(async (client) => {
        const accCheck = await client.query('SELECT id FROM bank_accounts WHERE id = $1 LIMIT 1', [id]);
        if (!accCheck.rows[0]) {
          throw new AppError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND');
        }

        const status = body.classification === 'CLEARED' ? 'CLEARED' : body.freezeAccount ? 'FROZEN' : 'ACTIVE';

        const upsertRes = await client.query(
          `INSERT INTO suspicious_accounts (
             account_id, complaint_id, classification, mule_probability, score_source, reason, flagged_by, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (account_id, complaint_id) DO UPDATE
           SET classification = EXCLUDED.classification,
               mule_probability = EXCLUDED.mule_probability,
               score_source = EXCLUDED.score_source,
               reason = EXCLUDED.reason,
               flagged_by = EXCLUDED.flagged_by,
               status = EXCLUDED.status,
               updated_at = NOW()
           RETURNING *`,
          [
            id,
            body.complaintId ?? null,
            body.classification,
            body.muleProbability ?? null,
            body.scoreSource,
            body.reason,
            req.user!.userId,
            status,
          ]
        );

        if (body.freezeAccount) {
          await client.query('UPDATE bank_accounts SET is_frozen = TRUE WHERE id = $1', [id]);
        } else if (body.classification === 'CLEARED') {
          await client.query('UPDATE bank_accounts SET is_frozen = FALSE WHERE id = $1', [id]);
        }

        return upsertRes.rows[0];
      });

      await recordAuditLog({
        req,
        action: body.freezeAccount ? 'ACCOUNT_FROZEN_AND_FLAGGED' : 'ACCOUNT_FLAGGED',
        resourceType: 'BANK_ACCOUNT',
        resourceId: id,
        statusCode: 200,
        details: body as Record<string, unknown>,
      });

      res.json({ success: true, data: flagged });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
