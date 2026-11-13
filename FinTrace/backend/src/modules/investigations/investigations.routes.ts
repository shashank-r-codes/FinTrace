import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeOfficer, authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';

const router = Router();

const listQuerySchema = z.object({
  status: z
    .enum(['OPEN', 'ACTIVE_TRACE', 'FREEZE_REQUESTED', 'ATM_SURVEILLANCE', 'CLOSED'])
    .optional(),
  complaintId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const recommendedActionSchema = z.object({
  action: z.string().min(3).max(300),
  priority: z.enum(['IMMEDIATE', 'HIGH', 'MEDIUM', 'LOW']).default('HIGH'),
  done: z.boolean().default(false),
});

const createInvestigationSchema = z.object({
  complaintId: z.string().uuid(),
  leadInvestigator: z.string().uuid().nullable().optional(),
  status: z
    .enum(['OPEN', 'ACTIVE_TRACE', 'FREEZE_REQUESTED', 'ATM_SURVEILLANCE', 'CLOSED'])
    .default('OPEN'),
  findingsSummary: z.string().max(4000).optional(),
  recommendedActions: z.array(recommendedActionSchema).default([]),
});

const updateInvestigationSchema = z.object({
  leadInvestigator: z.string().uuid().nullable().optional(),
  status: z
    .enum(['OPEN', 'ACTIVE_TRACE', 'FREEZE_REQUESTED', 'ATM_SURVEILLANCE', 'CLOSED'])
    .optional(),
  findingsSummary: z.string().max(4000).nullable().optional(),
  recommendedActions: z.array(recommendedActionSchema).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

router.use(authenticate, authorizeOfficer);

router.get(
  '/',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ query: listQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof listQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.status) {
        params.push(q.status);
        conditions.push(`inv.status = $${params.length}`);
      }
      if (q.complaintId) {
        params.push(q.complaintId);
        conditions.push(`inv.complaint_id = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(q.limit);

      const sql = `
        SELECT inv.*,
               c.complaint_number, c.fraud_type, c.reported_amount, c.status AS complaint_status,
               c.priority AS complaint_priority, c.city AS complaint_city,
               v.full_name AS victim_name,
               u.full_name AS lead_investigator_name,
               i.badge_number AS lead_badge_number,
               i.unit_name AS lead_unit_name,
               (SELECT COUNT(*)::int FROM evidence_records er WHERE er.investigation_id = inv.id) AS evidence_count,
               (SELECT COUNT(*)::int FROM alerts al WHERE al.complaint_id = inv.complaint_id AND al.status = 'OPEN') AS open_alert_count,
               (SELECT COUNT(*)::int FROM atm_predictions ap WHERE ap.complaint_id = inv.complaint_id) AS atm_prediction_count
        FROM investigations inv
        JOIN complaints c ON c.id = inv.complaint_id
        JOIN victims v ON v.id = c.victim_id
        LEFT JOIN investigators i ON i.id = inv.lead_investigator
        LEFT JOIN users u ON u.id = i.user_id
        ${whereClause}
        ORDER BY inv.updated_at DESC, inv.opened_at DESC
        LIMIT $${params.length}
      `;
      const result = await query(sql, params);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ body: createInvestigationSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createInvestigationSchema>;

      const existing = await query('SELECT id FROM investigations WHERE complaint_id = $1 LIMIT 1', [
        body.complaintId,
      ]);
      if (existing.rows[0]) {
        throw new AppError(
          'An investigation case already exists for this complaint.',
          409,
          'INVESTIGATION_EXISTS'
        );
      }

      const seqRes = await query<{ cnt: number }>('SELECT COUNT(*)::int + 1 AS cnt FROM investigations');
      const nextNum = seqRes.rows[0].cnt;
      const caseNumber = `INV-BLR-${new Date().getFullYear()}-${String(nextNum).padStart(3, '0')}`;

      const result = await query(
        `INSERT INTO investigations (
           case_number, complaint_id, lead_investigator, status, findings_summary, recommended_actions,
           closed_at
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, CASE WHEN $4 = 'CLOSED' THEN NOW() ELSE NULL END)
         RETURNING *`,
        [
          caseNumber,
          body.complaintId,
          body.leadInvestigator ?? null,
          body.status,
          body.findingsSummary ?? 'Investigation opened for financial trail and ATM forecast coordination.',
          JSON.stringify(body.recommendedActions),
        ]
      );

      await recordAuditLog({
        req,
        action: 'INVESTIGATION_CREATED',
        resourceType: 'INVESTIGATION',
        resourceId: result.rows[0].id,
        statusCode: 201,
        details: { caseNumber, complaintId: body.complaintId },
      });

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ params: idParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { id: string }>, res, next) => {
    try {
      const { id } = req.validatedParams!;
      const invRes = await query(
        `SELECT inv.*,
                c.complaint_number, c.fraud_type, c.reported_amount, c.status AS complaint_status,
                c.summary AS complaint_summary, c.city AS complaint_city,
                v.full_name AS victim_name, v.phone_masked AS victim_phone,
                u.full_name AS lead_investigator_name, i.badge_number AS lead_badge_number
         FROM investigations inv
         JOIN complaints c ON c.id = inv.complaint_id
         JOIN victims v ON v.id = c.victim_id
         LEFT JOIN investigators i ON i.id = inv.lead_investigator
         LEFT JOIN users u ON u.id = i.user_id
         WHERE inv.id = $1
         LIMIT 1`,
        [id]
      );

      if (!invRes.rows[0]) {
        throw new AppError('Investigation case not found.', 404, 'INVESTIGATION_NOT_FOUND');
      }

      const investigation = invRes.rows[0];
      const [evidenceRes, alertsRes, predsRes] = await Promise.all([
        query(
          `SELECT er.*, u.full_name AS uploaded_by_name
           FROM evidence_records er
           JOIN users u ON u.id = er.uploaded_by
           WHERE er.investigation_id = $1
           ORDER BY er.recorded_at DESC`,
          [id]
        ),
        query(
          `SELECT al.*, a.bank AS atm_bank, a.locality AS atm_locality
           FROM alerts al
           LEFT JOIN atms a ON a.id = al.atm_id
           WHERE al.complaint_id = $1
           ORDER BY al.created_at DESC`,
          [investigation.complaint_id]
        ),
        query(
          `SELECT ap.*, a.bank, a.address, a.locality
           FROM atm_predictions ap
           JOIN atms a ON a.id = ap.atm_id
           WHERE ap.complaint_id = $1
           ORDER BY ap.rank_order ASC
           LIMIT 5`,
          [investigation.complaint_id]
        ),
      ]);

      res.json({
        success: true,
        data: {
          investigation,
          evidence: evidenceRes.rows,
          alerts: alertsRes.rows,
          atmPredictions: predsRes.rows,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ params: idParamSchema, body: updateInvestigationSchema }),
  async (
    req: ValidatedRequest<z.infer<typeof updateInvestigationSchema>, Record<string, unknown>, { id: string }>,
    res,
    next
  ) => {
    try {
      const { id } = req.validatedParams!;
      const body = req.body as z.infer<typeof updateInvestigationSchema>;

      const existing = await query('SELECT * FROM investigations WHERE id = $1 LIMIT 1', [id]);
      if (!existing.rows[0]) {
        throw new AppError('Investigation case not found.', 404, 'INVESTIGATION_NOT_FOUND');
      }

      const current = existing.rows[0];
      const nextStatus = body.status ?? current.status;
      const nextLead =
        body.leadInvestigator !== undefined ? body.leadInvestigator : current.lead_investigator;
      const nextFindings =
        body.findingsSummary !== undefined ? body.findingsSummary : current.findings_summary;
      const nextActions =
        body.recommendedActions !== undefined
          ? JSON.stringify(body.recommendedActions)
          : JSON.stringify(current.recommended_actions ?? []);

      const updated = await query(
        `UPDATE investigations
         SET status = $2,
             lead_investigator = $3,
             findings_summary = $4,
             recommended_actions = $5::jsonb,
             closed_at = CASE WHEN $2 = 'CLOSED' THEN COALESCE(closed_at, NOW()) ELSE NULL END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, nextStatus, nextLead, nextFindings, nextActions]
      );

      await recordAuditLog({
        req,
        action: 'INVESTIGATION_UPDATED',
        resourceType: 'INVESTIGATION',
        resourceId: id,
        statusCode: 200,
        details: {
          status: nextStatus,
          leadInvestigator: nextLead,
        },
      });

      res.json({ success: true, data: updated.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
