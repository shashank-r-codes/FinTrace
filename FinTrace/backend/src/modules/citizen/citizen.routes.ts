import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query, withTransaction } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';
import {
  maskAccountNumber,
  toCitizenComplaintDetailDto,
  toCitizenComplaintSummaryDto,
} from './citizen.serializer.js';

const router = Router();

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new AppError('Only PNG, JPEG, WEBP images and PDF files are allowed.', 400, 'INVALID_FILE_TYPE'));
      return;
    }
    cb(null, true);
  },
});

const INCIDENT_TO_FRAUD_TYPE: Record<
  string,
  'UPI_PHISHING' | 'INVESTMENT_SCAM' | 'DIGITAL_ARREST' | 'OTP_HIJACK' | 'CARD_SKIMMING' | 'OTHER'
> = {
  UPI_FRAUD: 'UPI_PHISHING',
  UPI_PHISHING: 'UPI_PHISHING',
  PHISHING: 'UPI_PHISHING',
  INVESTMENT_SCAM: 'INVESTMENT_SCAM',
  OTP_VISHING: 'OTP_HIJACK',
  OTP_HIJACK: 'OTP_HIJACK',
  CARD_FRAUD: 'CARD_SKIMMING',
  CARD_SKIMMING: 'CARD_SKIMMING',
  DIGITAL_ARREST: 'DIGITAL_ARREST',
  SEXTORTION_OTHER: 'OTHER',
  OTHER: 'OTHER',
};

const disputedTxnSchema = z.object({
  txnId: z.string().min(4).max(64),
  date: z.string().min(8),
  amount: z.coerce.number().positive(),
  beneficiaryAccount: z.string().min(4).max(64),
  beneficiaryBank: z.string().min(2).max(120),
  channel: z.enum(['UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET']).default('UPI'),
});

const createCitizenComplaintSchema = z.object({
  incidentType: z.enum([
    'UPI_FRAUD',
    'PHISHING',
    'INVESTMENT_SCAM',
    'OTP_VISHING',
    'CARD_FRAUD',
    'SEXTORTION_OTHER',
    'UPI_PHISHING',
    'DIGITAL_ARREST',
    'OTP_HIJACK',
    'CARD_SKIMMING',
    'OTHER',
  ]),
  incidentTimestamp: z.string().min(8),
  description: z.string().min(10).max(2000),
  amountLost: z.coerce.number().positive(),
  victimBankName: z.string().min(2).max(150),
  victimAccountNumber: z.string().min(4).max(64),
  city: z.string().min(2).max(100).default('Bengaluru'),
  disputedTransactions: z.array(disputedTxnSchema).min(1).max(25),
});

const listQuerySchema = z.object({
  search: z.string().max(100).optional(),
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

router.use(authenticate, authorizeRoles('citizen'));

router.get(
  '/complaints',
  validate({ query: listQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof listQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const params: unknown[] = [req.user!.userId];
      const conditions: string[] = ['c.filed_by_user_id = $1'];

      if (q.citizenStatus) {
        params.push(q.citizenStatus);
        conditions.push(`c.citizen_status = $${params.length}`);
      }
      if (q.search) {
        params.push(`%${q.search}%`);
        conditions.push(
          `(c.reference_no ILIKE $${params.length} OR c.summary ILIKE $${params.length} OR c.fraud_type ILIKE $${params.length})`
        );
      }

      const sql = `
        SELECT c.id, c.reference_no, c.fraud_type, c.reported_amount, c.currency,
               c.incident_timestamp, c.reported_at, c.citizen_status, c.summary, c.city,
               c.victim_bank_name, c.victim_account_masked, c.assigned_to, c.updated_at,
               (SELECT COUNT(*)::int FROM transactions t WHERE t.complaint_id = c.id) AS transaction_count,
               (SELECT COUNT(*)::int FROM evidence_records er WHERE er.complaint_id = c.id AND er.is_citizen_visible = TRUE) AS document_count
        FROM complaints c
        WHERE ${conditions.join(' AND ')}
        ORDER BY c.reported_at DESC
      `;
      const result = await query(sql, params);
      res.json({
        success: true,
        data: result.rows.map((r: Parameters<typeof toCitizenComplaintSummaryDto>[0]) =>
          toCitizenComplaintSummaryDto(r)
        ),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/complaints',
  validate({ body: createCitizenComplaintSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createCitizenComplaintSchema>;
      const userId = req.user!.userId;
      const fraudType = INCIDENT_TO_FRAUD_TYPE[body.incidentType] ?? 'OTHER';
      const incidentDate = new Date(body.incidentTimestamp);
      if (Number.isNaN(incidentDate.getTime())) {
        throw new AppError('Invalid incidentTimestamp provided.', 400, 'VALIDATION_ERROR');
      }

      const created = await withTransaction(async (client) => {
        // Resolve or create linked victim profile for citizen
        const userRow = await client.query<{
          victim_id: string | null;
          full_name: string;
          email: string;
          phone_masked: string | null;
        }>('SELECT victim_id, full_name, email, phone_masked FROM users WHERE id = $1 LIMIT 1', [userId]);
        const u = userRow.rows[0];
        if (!u) {
          throw new AppError('Citizen user profile not found.', 404, 'USER_NOT_FOUND');
        }

        let victimId = u.victim_id;
        if (!victimId) {
          const vRes = await client.query<{ id: string }>(
            `INSERT INTO victims (full_name, phone_masked, email, city, state, home_lat, home_lng, is_synthetic)
             VALUES ($1, $2, $3, $4, 'Karnataka', 12.9716, 77.5946, TRUE)
             RETURNING id`,
            [u.full_name, u.phone_masked ?? '+91-98XXX-XX000', u.email, body.city]
          );
          victimId = vRes.rows[0].id;
          await client.query('UPDATE users SET victim_id = $1 WHERE id = $2', [victimId, userId]);
        }

        const seqRes = await client.query<{ cnt: number }>('SELECT COUNT(*)::int + 101 AS cnt FROM complaints');
        const nextNum = seqRes.rows[0].cnt;
        const year = new Date().getFullYear();
        const suffix = crypto.randomInt(10, 99);
        const complaintNumber = `CMP-${year}-${String(nextNum).padStart(4, '0')}`;
        const referenceNo = `FT-${year}-${String(nextNum).padStart(4, '0')}${suffix}`;
        const victimAccMasked = maskAccountNumber(body.victimAccountNumber);

        const priority =
          body.amountLost >= 500000 ? 'CRITICAL' : body.amountLost >= 100000 ? 'HIGH' : 'MEDIUM';

        const cmpRes = await client.query(
          `INSERT INTO complaints (
             complaint_number, reference_no, victim_id, filed_by_user_id, assigned_to, fraud_type,
             reported_amount, currency, incident_timestamp, status, citizen_status, priority,
             summary, city, victim_bank_name, victim_account_masked, is_synthetic
           )
           VALUES ($1, $2, $3, $4, NULL, $5, $6, 'INR', $7, 'REGISTERED', 'Submitted', $8, $9, $10, $11, $12, TRUE)
           RETURNING *`,
          [
            complaintNumber,
            referenceNo,
            victimId,
            userId,
            fraudType,
            body.amountLost,
            incidentDate,
            priority,
            body.description,
            body.city,
            body.victimBankName,
            victimAccMasked,
          ]
        );
        const complaint = cmpRes.rows[0];

        // Open initial investigation shell so investigator tools & evidence link smoothly
        const caseNumber = `INV-BLR-${year}-${String(nextNum).padStart(3, '0')}`;
        await client.query(
          `INSERT INTO investigations (case_number, complaint_id, lead_investigator, status, findings_summary)
           VALUES ($1, $2, NULL, 'OPEN', $3)`,
          [caseNumber, complaint.id, `Citizen portal intake (${referenceNo}) pending investigator review.`]
        );

        // Resolve/create bank accounts & insert disputed transactions into pipeline
        const instRes = await client.query<{ id: string }>(
          'SELECT id FROM financial_institutions ORDER BY name ASC LIMIT 1'
        );
        const defaultInstId = instRes.rows[0]?.id;

        const ensureAccount = async (acctNumRaw: string, holderName: string, isVictim: boolean): Promise<string> => {
          const acctClean = acctNumRaw.trim().toUpperCase().slice(0, 32);
          const existing = await client.query<{ id: string }>(
            'SELECT id FROM bank_accounts WHERE account_number = $1 LIMIT 1',
            [acctClean]
          );
          if (existing.rows[0]) return existing.rows[0].id;
          const accRes = await client.query<{ id: string }>(
            `INSERT INTO bank_accounts (
               account_number, institution_id, holder_name, account_type, ifsc_code,
               branch_city, branch_lat, branch_lng, kyc_verified, account_age_days, is_frozen, is_synthetic
             )
             VALUES ($1, $2, $3, $4, 'SYNS0001099', $5, 12.9716, 77.5946, $6, $7, FALSE, TRUE)
             RETURNING id`,
            [
              acctClean,
              defaultInstId,
              holderName,
              isVictim ? 'SAVINGS' : 'CURRENT',
              body.city,
              isVictim,
              isVictim ? 920 : 22,
            ]
          );
          return accRes.rows[0].id;
        };

        const victimAccountId = await ensureAccount(body.victimAccountNumber, u.full_name, true);
        const insertedTxns = [];

        for (const tx of body.disputedTransactions) {
          const benAccountId = await ensureAccount(
            tx.beneficiaryAccount,
            `${tx.beneficiaryBank} Beneficiary`,
            false
          );
          const txDate = new Date(tx.date);
          const validDate = Number.isNaN(txDate.getTime()) ? incidentDate : txDate;
          const cleanTxnId = tx.txnId.trim().slice(0, 64);

          await client.query(
            `INSERT INTO transactions (
               txn_id, from_account, to_account, amount, currency, timestamp, channel,
               complaint_id, hop_depth, is_flagged_fraud, remarks, is_synthetic
             )
             VALUES ($1, $2, $3, $4, 'INR', $5, $6, $7, 1, TRUE, $8, TRUE)
             ON CONFLICT (txn_id) DO NOTHING`,
            [
              cleanTxnId,
              victimAccountId,
              benAccountId,
              tx.amount,
              validDate,
              tx.channel,
              complaint.id,
              `Citizen intake disputed transfer (${tx.beneficiaryBank})`,
            ]
          );
          insertedTxns.push({
            txn_id: cleanTxnId,
            timestamp: validDate,
            amount: tx.amount,
            channel: tx.channel,
            beneficiary_account_masked: maskAccountNumber(tx.beneficiaryAccount),
            beneficiary_bank: tx.beneficiaryBank,
          });
        }

        // Initial status history entry
        await client.query(
          `INSERT INTO complaint_status_history (complaint_id, status, citizen_status, public_remark, changed_by)
           VALUES ($1, 'REGISTERED', 'Submitted', $2, $3)`,
          [
            complaint.id,
            `Complaint registered with reference ${referenceNo} and ${insertedTxns.length} disputed transaction(s).`,
            userId,
          ]
        );

        // Alert Senior Investigators
        await client.query(
          `INSERT INTO alerts (complaint_id, alert_type, severity, status, title, description, score_source)
           VALUES ($1, 'HIGH_VALUE_HOP', $2, 'OPEN', $3, $4, 'Rule-based risk score')`,
          [
            complaint.id,
            body.amountLost >= 500000 ? 'Critical' : body.amountLost >= 100000 ? 'High' : 'Medium',
            `New Citizen Complaint Filed: ${referenceNo} (${fraudType})`,
            `Citizen portal intake for INR ${Number(body.amountLost).toLocaleString('en-IN')} across ${insertedTxns.length} disputed transaction(s). Ready for graph trace and ML scoring.`,
          ]
        );

        return { complaint, insertedTxns };
      });

      await recordAuditLog({
        req,
        action: 'CITIZEN_COMPLAINT_SUBMITTED',
        resourceType: 'COMPLAINT',
        resourceId: created.complaint.id,
        statusCode: 201,
        details: {
          reference_no: created.complaint.reference_no,
          reported_amount: created.complaint.reported_amount,
          disputed_txn_count: created.insertedTxns.length,
        },
      });

      res.status(201).json({
        success: true,
        data: toCitizenComplaintSummaryDto({
          ...created.complaint,
          transaction_count: created.insertedTxns.length,
          document_count: 0,
        }),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/complaints/:id',
  validate({ params: idParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { id: string }>, res, next) => {
    try {
      const { id } = req.validatedParams!;
      const cmpRes = await query(
        `SELECT id, reference_no, fraud_type, reported_amount, currency,
                incident_timestamp, reported_at, citizen_status, summary, city,
                victim_bank_name, victim_account_masked, assigned_to, updated_at
         FROM complaints
         WHERE id = $1 AND filed_by_user_id = $2
         LIMIT 1`,
        [id, req.user!.userId]
      );
      const cmp = cmpRes.rows[0];
      if (!cmp) {
        // Strict ownership enforcement: return 404 to prevent IDOR enumeration
        throw new AppError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND');
      }

      const [txnsRes, histRes, docsRes] = await Promise.all([
        query(
          `SELECT t.txn_id, t.timestamp, t.amount, t.channel, ba.account_number AS to_account_number,
                  fi.name AS beneficiary_bank
           FROM transactions t
           JOIN bank_accounts ba ON ba.id = t.to_account
           LEFT JOIN financial_institutions fi ON fi.id = ba.institution_id
           WHERE t.complaint_id = $1
           ORDER BY t.timestamp ASC`,
          [id]
        ),
        query(
          `SELECT id, citizen_status, public_remark, changed_at
           FROM complaint_status_history
           WHERE complaint_id = $1
           ORDER BY changed_at ASC`,
          [id]
        ),
        query(
          `SELECT id, title, file_name, mime_type, file_size, recorded_at
           FROM evidence_records
           WHERE complaint_id = $1 AND is_citizen_visible = TRUE
           ORDER BY recorded_at DESC`,
          [id]
        ),
      ]);

      res.json({
        success: true,
        data: toCitizenComplaintDetailDto(cmp, txnsRes.rows, histRes.rows, docsRes.rows),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/complaints/:id/evidence',
  validate({ params: idParamSchema }),
  upload.single('file'),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { id: string }>, res, next) => {
    try {
      const { id } = req.validatedParams!;
      const cmpRes = await query<{ id: string; reference_no: string }>(
        'SELECT id, reference_no FROM complaints WHERE id = $1 AND filed_by_user_id = $2 LIMIT 1',
        [id, req.user!.userId]
      );
      if (!cmpRes.rows[0]) {
        throw new AppError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND');
      }
      if (!req.file) {
        throw new AppError('Evidence file (PNG, JPEG, WEBP, or PDF, max 5MB) is required.', 400, 'FILE_MISSING');
      }

      const title =
        typeof req.body?.title === 'string' && req.body.title.trim().length >= 3
          ? req.body.title.trim().slice(0, 200)
          : req.file.originalname;
      const description =
        typeof req.body?.description === 'string' && req.body.description.trim().length > 0
          ? req.body.description.trim().slice(0, 1000)
          : `Supporting evidence uploaded by complainant (${req.file.originalname})`;

      const sha256Hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const invRes = await query<{ id: string }>('SELECT id FROM investigations WHERE complaint_id = $1 LIMIT 1', [id]);

      const insertRes = await query(
        `INSERT INTO evidence_records (
           investigation_id, complaint_id, uploaded_by, evidence_type, title, description,
           file_name, sha256_hash, mime_type, file_size, is_citizen_visible, metadata_json
         )
         VALUES ($1, $2, $3, 'OTHER', $4, $5, $6, $7, $8, $9, TRUE, $10::jsonb)
         RETURNING id, title, file_name, mime_type, file_size, recorded_at`,
        [
          invRes.rows[0]?.id ?? null,
          id,
          req.user!.userId,
          title,
          description,
          req.file.originalname,
          sha256Hash,
          req.file.mimetype,
          req.file.size,
          JSON.stringify({ source: 'citizen_portal', sha256_hash: sha256Hash }),
        ]
      );

      await recordAuditLog({
        req,
        action: 'CITIZEN_EVIDENCE_UPLOADED',
        resourceType: 'EVIDENCE',
        resourceId: insertRes.rows[0].id,
        statusCode: 201,
        details: { complaint_id: id, file_name: req.file.originalname, file_size: req.file.size },
      });

      res.status(201).json({
        success: true,
        data: {
          id: insertRes.rows[0].id,
          title: insertRes.rows[0].title,
          file_name: insertRes.rows[0].file_name,
          mime_type: insertRes.rows[0].mime_type,
          file_size: Number(insertRes.rows[0].file_size),
          uploaded_at: insertRes.rows[0].recorded_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/notifications', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, complaint_id, reference_no, title, message, citizen_status, is_read, created_at
       FROM citizen_notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.user!.userId]
    );
    const unreadCount = result.rows.filter((r: Record<string, unknown>) => !r.is_read).length;
    res.json({
      success: true,
      data: {
        unreadCount,
        notifications: result.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/read', async (req, res, next) => {
  try {
    await query('UPDATE citizen_notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE', [
      req.user!.userId,
    ]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
