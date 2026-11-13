import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeOfficer, authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';
import { mapOfficerStatusToCitizenStatus } from '../citizen/citizen.serializer.js';

const router = Router();

const listComplaintsQuerySchema = z.object({
  status: z
    .enum(['REGISTERED', 'TRACING', 'MULE_IDENTIFIED', 'ATM_ALERTED', 'CONTAINED', 'CLOSED'])
    .optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  fraudType: z
    .enum([
      'UPI_PHISHING',
      'INVESTMENT_SCAM',
      'DIGITAL_ARREST',
      'OTP_HIJACK',
      'CARD_SKIMMING',
      'LOAN_APP_FRAUD',
      'OTHER',
    ])
    .optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const createComplaintSchema = z.object({
  victim: z.object({
    fullName: z.string().min(2).max(150),
    phoneMasked: z.string().min(6).max(20),
    email: z.string().email().optional(),
    city: z.string().min(2).max(100),
    state: z.string().min(2).max(100),
    homeLat: z.number().min(-90).max(90).optional(),
    homeLng: z.number().min(-180).max(180).optional(),
  }),
  fraudType: z.enum([
    'UPI_PHISHING',
    'INVESTMENT_SCAM',
    'DIGITAL_ARREST',
    'OTP_HIJACK',
    'CARD_SKIMMING',
    'LOAN_APP_FRAUD',
    'OTHER',
  ]),
  reportedAmount: z.number().positive(),
  incidentTimestamp: z.string().datetime(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('HIGH'),
  summary: z.string().min(10).max(2000),
  city: z.string().min(2).max(100),
  assignedTo: z.string().uuid().nullable().optional(),
  openInvestigation: z.boolean().default(true),
});

const updateStatusSchema = z.object({
  status: z.enum(['REGISTERED', 'TRACING', 'MULE_IDENTIFIED', 'ATM_ALERTED', 'CONTAINED', 'CLOSED']),
  assignedTo: z.string().uuid().nullable().optional(),
  publicRemark: z.string().max(1000).optional(),
  internalNote: z.string().max(2000).optional(),
  citizenStatus: z
    .enum([
      'Submitted',
      'Under Review',
      'Assigned to Investigator',
      'Investigation in Progress',
      'Action Taken / Closed',
    ])
    .optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

router.use(authenticate, authorizeOfficer);

router.get(
  '/',
  validate({ query: listComplaintsQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof listComplaintsQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.status) {
        params.push(q.status);
        conditions.push(`c.status = $${params.length}`);
      }
      if (q.priority) {
        params.push(q.priority);
        conditions.push(`c.priority = $${params.length}`);
      }
      if (q.fraudType) {
        params.push(q.fraudType);
        conditions.push(`c.fraud_type = $${params.length}`);
      }
      if (q.search) {
        params.push(`%${q.search}%`);
        conditions.push(
          `(c.complaint_number ILIKE $${params.length} OR v.full_name ILIKE $${params.length} OR c.summary ILIKE $${params.length})`
        );
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countSql = `
        SELECT COUNT(*)::int AS total
        FROM complaints c
        JOIN victims v ON v.id = c.victim_id
        ${whereClause}
      `;
      const countRes = await query<{ total: number }>(countSql, params);

      params.push(q.limit);
      const limitIdx = params.length;
      params.push(q.offset);
      const offsetIdx = params.length;

      const listSql = `
        SELECT c.id, c.complaint_number, c.reference_no, c.fraud_type, c.reported_amount, c.currency,
               c.incident_timestamp, c.reported_at, c.status, c.citizen_status, c.priority, c.summary, c.city,
               c.is_synthetic, c.created_at,
               v.id AS victim_id, v.full_name AS victim_name, v.phone_masked AS victim_phone,
               i.id AS investigator_id, u.full_name AS investigator_name,
               (SELECT COUNT(*)::int FROM transactions t WHERE t.complaint_id = c.id) AS transaction_count,
               (SELECT COUNT(*)::int FROM atm_predictions ap WHERE ap.complaint_id = c.id) AS atm_prediction_count,
               (SELECT COUNT(*)::int FROM alerts al WHERE al.complaint_id = c.id AND al.status = 'OPEN') AS open_alert_count
        FROM complaints c
        JOIN victims v ON v.id = c.victim_id
        LEFT JOIN investigators i ON i.id = c.assigned_to
        LEFT JOIN users u ON u.id = i.user_id
        ${whereClause}
        ORDER BY c.reported_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
      const rowsRes = await query(listSql, params);

      res.json({
        success: true,
        data: rowsRes.rows,
        pagination: {
          total: countRes.rows[0]?.total ?? 0,
          limit: q.limit,
          offset: q.offset,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ body: createComplaintSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createComplaintSchema>;

      const created = await withTransaction(async (client) => {
        const victimRes = await client.query<{ id: string }>(
          `INSERT INTO victims (full_name, phone_masked, email, city, state, home_lat, home_lng, is_synthetic)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
           RETURNING id`,
          [
            body.victim.fullName,
            body.victim.phoneMasked,
            body.victim.email ?? null,
            body.victim.city,
            body.victim.state,
            body.victim.homeLat ?? null,
            body.victim.homeLng ?? null,
          ]
        );
        const victimId = victimRes.rows[0].id;

        const seqRes = await client.query<{ cnt: number }>('SELECT COUNT(*)::int + 1 AS cnt FROM complaints');
        const nextNum = seqRes.rows[0].cnt;
        const year = new Date().getFullYear();
        const complaintNumber = `CMP-${year}-${String(nextNum).padStart(4, '0')}`;
        const referenceNo = `FT-${year}-${String(nextNum).padStart(4, '0')}${crypto.randomInt(10, 99)}`;
        const citizenStatus = mapOfficerStatusToCitizenStatus('REGISTERED', Boolean(body.assignedTo));

        const cmpRes = await client.query(
          `INSERT INTO complaints (
             complaint_number, reference_no, victim_id, assigned_to, fraud_type, reported_amount,
             currency, incident_timestamp, status, citizen_status, priority, summary, city, is_synthetic
           )
           VALUES ($1, $2, $3, $4, $5, $6, 'INR', $7, 'REGISTERED', $8, $9, $10, $11, TRUE)
           RETURNING *`,
          [
            complaintNumber,
            referenceNo,
            victimId,
            body.assignedTo ?? null,
            body.fraudType,
            body.reportedAmount,
            body.incidentTimestamp,
            citizenStatus,
            body.priority,
            body.summary,
            body.city,
          ]
        );
        const complaint = cmpRes.rows[0];

        if (body.openInvestigation) {
          const caseNumber = `INV-BLR-${new Date().getFullYear()}-${String(nextNum).padStart(2, '0')}`;
          await client.query(
            `INSERT INTO investigations (case_number, complaint_id, lead_investigator, status, findings_summary)
             VALUES ($1, $2, $3, 'OPEN', $4)`,
            [caseNumber, complaint.id, body.assignedTo ?? null, 'Investigation initialized upon complaint registration.']
          );
        }

        return complaint;
      });

      await recordAuditLog({
        req,
        action: 'COMPLAINT_REGISTERED',
        resourceType: 'COMPLAINT',
        resourceId: created.id,
        statusCode: 201,
        details: { complaint_number: created.complaint_number, reported_amount: created.reported_amount },
      });

      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { id: string }>, res, next) => {
    try {
      const { id } = req.validatedParams!;
      const cmpRes = await query(
        `SELECT c.*, v.full_name AS victim_name, v.phone_masked AS victim_phone, v.email AS victim_email,
                v.city AS victim_city, v.state AS victim_state, v.home_lat, v.home_lng,
                u.full_name AS investigator_name, i.badge_number AS investigator_badge
         FROM complaints c
         JOIN victims v ON v.id = c.victim_id
         LEFT JOIN investigators i ON i.id = c.assigned_to
         LEFT JOIN users u ON u.id = i.user_id
         WHERE c.id = $1
         LIMIT 1`,
        [id]
      );

      if (!cmpRes.rows[0]) {
        throw new AppError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND');
      }

      const [txnsRes, suspRes, invRes, predsRes, histRes] = await Promise.all([
        query(
          `SELECT t.*, fa.account_number AS from_account_number, fa.holder_name AS from_holder,
                  ta.account_number AS to_account_number, ta.holder_name AS to_holder
           FROM transactions t
           JOIN bank_accounts fa ON fa.id = t.from_account
           JOIN bank_accounts ta ON ta.id = t.to_account
           WHERE t.complaint_id = $1
           ORDER BY t.timestamp ASC`,
          [id]
        ),
        query(
          `SELECT sa.*, ba.account_number, ba.holder_name, ba.branch_city, ba.is_frozen
           FROM suspicious_accounts sa
           JOIN bank_accounts ba ON ba.id = sa.account_id
           WHERE sa.complaint_id = $1
           ORDER BY sa.mule_probability DESC NULLS LAST`,
          [id]
        ),
        query('SELECT * FROM investigations WHERE complaint_id = $1 LIMIT 1', [id]),
        query(
          `SELECT ap.*, a.bank, a.address, a.locality, a.city, a.lat, a.lng
           FROM atm_predictions ap
           JOIN atms a ON a.id = ap.atm_id
           WHERE ap.complaint_id = $1
           ORDER BY ap.rank_order ASC`,
          [id]
        ),
        query(
          `SELECT h.*, u.full_name AS changed_by_name
           FROM complaint_status_history h
           LEFT JOIN users u ON u.id = h.changed_by
           WHERE h.complaint_id = $1
           ORDER BY h.changed_at DESC`,
          [id]
        ),
      ]);

      res.json({
        success: true,
        data: {
          complaint: cmpRes.rows[0],
          transactions: txnsRes.rows,
          suspiciousAccounts: suspRes.rows,
          investigation: invRes.rows[0] ?? null,
          atmPredictions: predsRes.rows,
          statusHistory: histRes.rows,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id/status',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ params: idParamSchema, body: updateStatusSchema }),
  async (
    req: ValidatedRequest<z.infer<typeof updateStatusSchema>, Record<string, unknown>, { id: string }>,
    res,
    next
  ) => {
    try {
      const { id } = req.validatedParams!;
      const body = req.body as z.infer<typeof updateStatusSchema>;

      const updated = await withTransaction(async (client) => {
        const existingRes = await client.query<{
          id: string;
          reference_no: string;
          assigned_to: string | null;
          filed_by_user_id: string | null;
        }>('SELECT id, reference_no, assigned_to, filed_by_user_id FROM complaints WHERE id = $1 LIMIT 1', [id]);
        const existing = existingRes.rows[0];
        if (!existing) {
          throw new AppError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND');
        }

        const nextAssigned = body.assignedTo !== undefined ? body.assignedTo : existing.assigned_to;
        const citizenStatus =
          body.citizenStatus ?? mapOfficerStatusToCitizenStatus(body.status, Boolean(nextAssigned));

        const updRes = await client.query(
          `UPDATE complaints
           SET status = $2,
               citizen_status = $3,
               assigned_to = COALESCE($4, assigned_to),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [id, body.status, citizenStatus, body.assignedTo ?? null]
        );

        const publicRemark = body.publicRemark?.trim() || null;
        const internalNote = body.internalNote?.trim() || null;

        await client.query(
          `INSERT INTO complaint_status_history (
             complaint_id, status, citizen_status, public_remark, internal_note, changed_by
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, body.status, citizenStatus, publicRemark, internalNote, req.user!.userId]
        );

        if (existing.filed_by_user_id) {
          await client.query(
            `INSERT INTO citizen_notifications (user_id, complaint_id, reference_no, title, message, citizen_status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              existing.filed_by_user_id,
              id,
              existing.reference_no,
              `Status updated: ${citizenStatus}`,
              publicRemark || `Your complaint ${existing.reference_no} is now ${citizenStatus}.`,
              citizenStatus,
            ]
          );
        }

        return updRes.rows[0];
      });

      await recordAuditLog({
        req,
        action: 'COMPLAINT_STATUS_UPDATED',
        resourceType: 'COMPLAINT',
        resourceId: id,
        statusCode: 200,
        details: body as Record<string, unknown>,
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
