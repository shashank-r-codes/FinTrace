import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeOfficer, authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';

const router = Router();

const listAlertsQuerySchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'DISPATCHED', 'RESOLVED', 'FALSE_POSITIVE']).optional(),
  severity: z.enum(['Critical', 'High', 'Medium', 'Low']).optional(),
  complaintId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createAlertSchema = z.object({
  complaintId: z.string().uuid(),
  accountId: z.string().uuid().nullable().optional(),
  atmId: z.string().max(40).nullable().optional(),
  alertType: z.enum(['CASH_OUT_IMMINENT', 'MULE_BURST', 'LAYERING_CYCLE', 'HIGH_VALUE_HOP', 'ANOMALY_DETECTED']),
  severity: z.enum(['Critical', 'High', 'Medium', 'Low']),
  title: z.string().min(5).max(200),
  description: z.string().min(10).max(2000),
  scoreSource: z
    .enum(['Trained ML prediction', 'Rule-based risk score', 'Synthetic demo result'])
    .default('Rule-based risk score'),
});

const updateAlertSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'DISPATCHED', 'RESOLVED', 'FALSE_POSITIVE']),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

router.use(authenticate, authorizeOfficer);

router.get(
  '/',
  validate({ query: listAlertsQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof listAlertsQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.status) {
        params.push(q.status);
        conditions.push(`al.status = $${params.length}`);
      }
      if (q.severity) {
        params.push(q.severity);
        conditions.push(`al.severity = $${params.length}`);
      }
      if (q.complaintId) {
        params.push(q.complaintId);
        conditions.push(`al.complaint_id = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(q.limit);

      const sql = `
        SELECT al.*,
               c.complaint_number,
               ba.account_number, ba.holder_name,
               a.bank AS atm_bank, a.address AS atm_address, a.locality AS atm_locality,
               u.full_name AS acknowledged_by_name
        FROM alerts al
        LEFT JOIN complaints c ON c.id = al.complaint_id
        LEFT JOIN bank_accounts ba ON ba.id = al.account_id
        LEFT JOIN atms a ON a.id = al.atm_id
        LEFT JOIN users u ON u.id = al.acknowledged_by
        ${whereClause}
        ORDER BY
          CASE al.severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END ASC,
          al.created_at DESC
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
  validate({ body: createAlertSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createAlertSchema>;
      const result = await query(
        `INSERT INTO alerts (
           complaint_id, account_id, atm_id, alert_type, severity, status, title, description, score_source
         )
         VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8)
         RETURNING *`,
        [
          body.complaintId,
          body.accountId ?? null,
          body.atmId ?? null,
          body.alertType,
          body.severity,
          body.title,
          body.description,
          body.scoreSource,
        ]
      );

      await recordAuditLog({
        req,
        action: 'ALERT_CREATED',
        resourceType: 'ALERT',
        resourceId: result.rows[0].id,
        statusCode: 201,
        details: { severity: body.severity, alertType: body.alertType },
      });

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
  validate({ params: idParamSchema, body: updateAlertSchema }),
  async (
    req: ValidatedRequest<z.infer<typeof updateAlertSchema>, Record<string, unknown>, { id: string }>,
    res,
    next
  ) => {
    try {
      const { id } = req.validatedParams!;
      const body = req.body as z.infer<typeof updateAlertSchema>;

      const result = await query(
        `UPDATE alerts
         SET status = $2,
             acknowledged_by = CASE WHEN $2 IN ('ACKNOWLEDGED', 'DISPATCHED', 'RESOLVED', 'FALSE_POSITIVE') THEN $3 ELSE acknowledged_by END,
             acknowledged_at = CASE WHEN $2 IN ('ACKNOWLEDGED', 'DISPATCHED', 'RESOLVED', 'FALSE_POSITIVE') AND acknowledged_at IS NULL THEN NOW() ELSE acknowledged_at END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, body.status, req.user!.userId]
      );

      if (!result.rows[0]) {
        throw new AppError('Alert not found.', 404, 'ALERT_NOT_FOUND');
      }

      await recordAuditLog({
        req,
        action: 'ALERT_STATUS_UPDATED',
        resourceType: 'ALERT',
        resourceId: id,
        statusCode: 200,
        details: { status: body.status },
      });

      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
