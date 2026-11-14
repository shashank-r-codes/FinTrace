import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeOfficer, authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';
import {
  clearProfileCache,
  getActiveThresholds,
  screenTransaction,
  ScreeningInput,
} from './screening.service.js';

const router = Router();

const screeningRequestSchema = z.object({
  senderAccountId: z.string().min(1).max(64),
  receiverAccountId: z.string().min(1).max(64),
  amount: z.number().positive(),
  currency: z.string().length(3).default('INR'),
  channel: z.enum(['UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET']),
  timestamp: z.string().optional(),
  clientId: z.string().max(80).optional(),
  idempotencyKey: z.string().max(128).optional(),
  deviceFingerprint: z.string().max(128).optional(),
  ipAddress: z.string().max(45).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

const updateThresholdsSchema = z.object({
  low_max: z.number().min(1).max(99),
  medium_max: z.number().min(1).max(99),
  high_max: z.number().min(1).max(100),
  reason_for_change: z.string().min(5).max(500),
});

const updateSettingSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().min(1).max(255),
});

const simulateSwitchSchema = z.object({
  scenarioId: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']).optional(),
  channel: z.enum(['UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET']).optional(),
  amount: z.number().positive().optional(),
});

// Middleware: Authenticate officer or allow verified system client header
router.use(authenticate, authorizeOfficer);

// =============================================================================
// 1. REAL-TIME SCREENING HOT PATH (< 50ms)
// =============================================================================
router.post(
  '/screen',
  validate({ body: screeningRequestSchema }),
  async (req: ValidatedRequest<z.infer<typeof screeningRequestSchema>>, res, next) => {
    try {
      const headerKey = req.headers['idempotency-key'] as string | undefined;
      const input: ScreeningInput = {
        ...req.validatedBody!,
        idempotencyKey: headerKey || req.validatedBody!.idempotencyKey,
      };

      const result = await screenTransaction(input, req.user?.userId);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// =============================================================================
// 2. RECENT SCREENING REQUESTS ACTIVITY FEED
// =============================================================================
router.get('/requests', async (req, res, next) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 40));
    const offset = Math.max(0, Number(q.offset) || 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.decision) {
      params.push(q.decision);
      conditions.push(`tsr.decision = $${params.length}`);
    }
    if (q.riskClassification) {
      params.push(q.riskClassification);
      conditions.push(`tsr.risk_classification = $${params.length}`);
    }
    if (q.channel) {
      params.push(q.channel);
      conditions.push(`tsr.channel = $${params.length}`);
    }
    if (q.search) {
      params.push(`%${q.search}%`);
      const idx = params.length;
      conditions.push(
        `(sba.account_number ILIKE $${idx} OR rba.account_number ILIKE $${idx} OR sba.holder_name ILIKE $${idx} OR rba.holder_name ILIKE $${idx})`
      );
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const sql = `
      SELECT 
        tsr.id,
        tsr.idempotency_key,
        tsr.amount::float AS amount,
        tsr.currency,
        tsr.channel,
        tsr.client_id,
        tsr.status,
        tsr.decision,
        tsr.risk_score::float AS risk_score,
        tsr.risk_classification,
        tsr.latency_ms,
        tsr.applied_fail_mode,
        tsr.screened_at,
        sba.id AS sender_id,
        sba.account_number AS sender_account_number,
        sba.holder_name AS sender_holder_name,
        sfi.name AS sender_bank,
        rba.id AS receiver_id,
        rba.account_number AS receiver_account_number,
        rba.holder_name AS receiver_holder_name,
        rfi.name AS receiver_bank,
        ti.recommended_action,
        ti.review_status
      FROM transaction_screening_requests tsr
      JOIN bank_accounts sba ON sba.id = tsr.sender_account_id
      JOIN financial_institutions sfi ON sfi.id = sba.institution_id
      JOIN bank_accounts rba ON rba.id = tsr.receiver_account_id
      JOIN financial_institutions rfi ON rfi.id = rba.institution_id
      LEFT JOIN transaction_interventions ti ON ti.screening_id = tsr.id
      ${where}
      ORDER BY tsr.screened_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM transaction_screening_requests tsr
      JOIN bank_accounts sba ON sba.id = tsr.sender_account_id
      JOIN bank_accounts rba ON rba.id = tsr.receiver_account_id
      ${where}
    `;

    const [rowsRes, countRes] = await Promise.all([
      query(sql, params),
      query(countSql, params.slice(0, params.length - 2)),
    ]);

    res.json({
      success: true,
      data: rowsRes.rows,
      pagination: {
        total: countRes.rows[0]?.total ?? 0,
        limit,
        offset,
      },
    });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// 3. SINGLE SCREENING REQUEST AUDIT & DETAIL
// =============================================================================
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT 
        tsr.*,
        tra.account_risk_score::float AS account_risk_score,
        tra.transaction_risk_score::float AS transaction_risk_score,
        tra.network_risk_score::float AS network_risk_score,
        tra.composite_score::float AS composite_score,
        tra.rules_triggered,
        tra.ml_factors,
        tra.plain_language_explanation,
        tra.limitations_disclaimer,
        ti.id AS intervention_id,
        ti.recommended_action,
        ti.review_status,
        ti.review_notes,
        sba.account_number AS sender_account_number,
        sba.holder_name AS sender_holder_name,
        rba.account_number AS receiver_account_number,
        rba.holder_name AS receiver_holder_name
      FROM transaction_screening_requests tsr
      LEFT JOIN transaction_risk_assessments tra ON tra.screening_id = tsr.id
      LEFT JOIN transaction_interventions ti ON ti.screening_id = tsr.id
      JOIN bank_accounts sba ON sba.id = tsr.sender_account_id
      JOIN bank_accounts rba ON rba.id = tsr.receiver_account_id
      WHERE tsr.id::text = $1 OR tsr.idempotency_key = $1
      LIMIT 1
    `;

    const resDb = await query(sql, [id]);
    if (!resDb.rows[0]) {
      throw new AppError('Screening request not found.', 404, 'SCREENING_NOT_FOUND');
    }

    const auditRes = await query(
      `SELECT * FROM intervention_audit_logs WHERE screening_id = $1 ORDER BY sequence_number ASC`,
      [resDb.rows[0].id]
    );

    res.json({
      success: true,
      data: {
        ...resDb.rows[0],
        auditChain: auditRes.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// 4. CONFIGURABLE THRESHOLDS MANAGEMENT
// =============================================================================
router.get('/thresholds/active', async (_req, res, next) => {
  try {
    const active = await getActiveThresholds();
    res.json({ success: true, data: active });
  } catch (err) {
    next(err);
  }
});

router.get('/thresholds/history', async (_req, res, next) => {
  try {
    const history = await query(
      `SELECT st.*, u.full_name AS modified_by_name
       FROM screening_thresholds st
       LEFT JOIN users u ON u.id = st.modified_by
       ORDER BY st.version DESC`
    );
    res.json({ success: true, data: history.rows });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/thresholds',
  authorizeRoles('Administrator', 'Senior Investigator'),
  validate({ body: updateThresholdsSchema }),
  async (req: ValidatedRequest<z.infer<typeof updateThresholdsSchema>>, res, next) => {
    try {
      const b = req.validatedBody!;
      if (!(b.low_max < b.medium_max && b.medium_max < b.high_max)) {
        throw new AppError(
          'Invalid threshold bounds: low_max < medium_max < high_max must be strictly maintained.',
          400,
          'INVALID_THRESHOLD_BOUNDARIES'
        );
      }

      const updated = await withTransaction(async (client) => {
        await client.query('UPDATE screening_thresholds SET is_active = FALSE');
        const verRes = await client.query('SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM screening_thresholds');
        const nextVer = verRes.rows[0].next_ver;

        const insertRes = await client.query(
          `INSERT INTO screening_thresholds (
             version, low_max, medium_max, high_max, is_active, modified_by, reason_for_change
           )
           VALUES ($1, $2, $3, $4, TRUE, $5, $6)
           RETURNING *`,
          [nextVer, b.low_max, b.medium_max, b.high_max, req.user!.userId, b.reason_for_change]
        );
        return insertRes.rows[0];
      });

      await recordAuditLog({
        req,
        action: 'SCREENING_THRESHOLDS_UPDATED',
        resourceType: 'SCREENING_CONFIG',
        resourceId: updated.id,
        statusCode: 200,
        details: b as Record<string, unknown>,
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// =============================================================================
// 5. SYSTEM SETTINGS (Fail-Safe Policy, Latency Budget, Cache TTL)
// =============================================================================
router.get('/settings', async (_req, res, next) => {
  try {
    const settingsRes = await query('SELECT * FROM system_settings ORDER BY key ASC');
    res.json({ success: true, data: settingsRes.rows });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/settings',
  authorizeRoles('Administrator'),
  validate({ body: updateSettingSchema }),
  async (req: ValidatedRequest<z.infer<typeof updateSettingSchema>>, res, next) => {
    try {
      const { key, value } = req.validatedBody!;
      if (key === 'FAIL_SAFE_POLICY' && value !== 'FAIL_OPEN' && value !== 'FAIL_CLOSED') {
        throw new AppError("FAIL_SAFE_POLICY must be either 'FAIL_OPEN' or 'FAIL_CLOSED'", 400, 'INVALID_FAIL_SAFE_VALUE');
      }

      const updateRes = await query(
        `UPDATE system_settings
         SET value = $1, updated_at = NOW()
         WHERE key = $2
         RETURNING *`,
        [value, key]
      );

      if (!updateRes.rows[0]) {
        throw new AppError(`Setting key '${key}' does not exist.`, 404, 'SETTING_NOT_FOUND');
      }

      if (key === 'CACHE_TTL_SECONDS') {
        clearProfileCache();
      }

      await recordAuditLog({
        req,
        action: 'SYSTEM_SETTING_UPDATED',
        resourceType: 'SYSTEM_SETTINGS',
        resourceId: key,
        statusCode: 200,
        details: { key, value },
      });

      res.json({ success: true, data: updateRes.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// =============================================================================
// 6. SIMULATED CORE BANKING SWITCH ENDPOINT
// =============================================================================
router.post(
  '/simulate-switch',
  validate({ body: simulateSwitchSchema }),
  async (req: ValidatedRequest<z.infer<typeof simulateSwitchSchema>>, res, next) => {
    try {
      const b = req.validatedBody!;
      const accountsRes = await query(
        `SELECT ba.id, ba.account_number, aip.account_status, aip.risk_classification
         FROM bank_accounts ba
         LEFT JOIN account_intelligence_profiles aip ON aip.account_id = ba.id
         ORDER BY ba.account_number ASC
         LIMIT 20`
      );

      const accs = accountsRes.rows;
      if (accs.length < 2) {
        throw new AppError('Insufficient accounts for simulation.', 500, 'INSUFFICIENT_DATA');
      }

      // Pick sender and receiver based on requested scenario
      let senderId = accs[0].id;
      let receiverId = accs[1].id;
      let amount = b.amount || 25000;
      let channel: 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'CARD' | 'WALLET' = b.channel || 'UPI';

      if (b.scenarioId === 'B' || b.scenarioId === 'E') {
        // High risk mule receiver
        const mule = accs.find(
          (a) => a.account_status === 'CONFIRMED_FRAUD_LINKED' || a.account_status === 'SUSPECTED_MULE_ACCOUNT'
        );
        if (mule) receiverId = mule.id;
        amount = 185000;
        channel = 'IMPS';
      } else if (b.scenarioId === 'C') {
        // Sudden spike
        amount = 450000;
      }

      const input: ScreeningInput = {
        senderAccountId: senderId,
        receiverAccountId: receiverId,
        amount,
        channel,
        clientId: 'SIMULATED_PAYMENT_GATEWAY_SWITCH',
      };

      const result = await screenTransaction(input, req.user?.userId);
      res.json({ success: true, scenario: b.scenarioId || 'DEFAULT', data: result });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
