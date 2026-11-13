import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { PoolClient } from 'pg';
import { query, withTransaction } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeOfficer, authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const listTxnQuerySchema = z.object({
  complaintId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  channel: z.enum(['UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET']).optional(),
  flaggedOnly: z.enum(['true', 'false']).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  minAmount: z.coerce.number().nonnegative().optional(),
  maxAmount: z.coerce.number().positive().optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createTxnSchema = z.object({
  txnId: z.string().min(4).max(64).optional(),
  fromAccount: z.string().min(4).max(64),
  toAccount: z.string().min(4).max(64),
  amount: z.number().positive(),
  timestamp: z.string().datetime(),
  channel: z.enum(['UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET']),
  complaintId: z.string().uuid().nullable().optional(),
  hopDepth: z.number().int().min(0).max(20).nullable().optional(),
  isFlaggedFraud: z.boolean().default(false),
  remarks: z.string().max(500).optional(),
});

const csvRowSchema = z.object({
  txn_id: z.string().min(4).max(64),
  from_account: z.string().min(4).max(64),
  to_account: z.string().min(4).max(64),
  amount: z.coerce.number().positive(),
  timestamp: z.string().min(10),
  channel: z.enum(['UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET']),
  complaint_number: z.string().optional(),
  complaint_id: z.string().uuid().optional(),
  hop_depth: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().int().min(0).max(20).nullable()
  ),
  is_flagged_fraud: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || String(v).toLowerCase() === 'true' || v === '1'),
  remarks: z.string().max(500).optional(),
});

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveAccountId(client: PoolClient, identifier: string): Promise<string> {
  if (uuidRegex.test(identifier)) {
    const res = await client.query<{ id: string }>('SELECT id FROM bank_accounts WHERE id = $1 LIMIT 1', [
      identifier,
    ]);
    if (res.rows[0]) return res.rows[0].id;
  }

  const resByNumber = await client.query<{ id: string }>(
    'SELECT id FROM bank_accounts WHERE account_number = $1 LIMIT 1',
    [identifier]
  );
  if (!resByNumber.rows[0]) {
    throw new AppError(`Bank account '${identifier}' not found.`, 400, 'ACCOUNT_NOT_FOUND');
  }
  return resByNumber.rows[0].id;
}

router.use(authenticate, authorizeOfficer);

router.get(
  '/',
  validate({ query: listTxnQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof listTxnQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.complaintId) {
        params.push(q.complaintId);
        conditions.push(`t.complaint_id = $${params.length}`);
      }
      if (q.accountId) {
        params.push(q.accountId);
        conditions.push(`(t.from_account = $${params.length} OR t.to_account = $${params.length})`);
      }
      if (q.channel) {
        params.push(q.channel);
        conditions.push(`t.channel = $${params.length}`);
      }
      if (q.flaggedOnly === 'true') {
        conditions.push('t.is_flagged_fraud = TRUE');
      }
      if (q.fromDate) {
        params.push(q.fromDate);
        conditions.push(`t.timestamp >= $${params.length}`);
      }
      if (q.toDate) {
        params.push(q.toDate);
        conditions.push(`t.timestamp <= $${params.length}`);
      }
      if (q.minAmount !== undefined) {
        params.push(q.minAmount);
        conditions.push(`t.amount >= $${params.length}`);
      }
      if (q.maxAmount !== undefined) {
        params.push(q.maxAmount);
        conditions.push(`t.amount <= $${params.length}`);
      }
      if (q.search) {
        params.push(`%${q.search}%`);
        conditions.push(
          `(t.txn_id ILIKE $${params.length} OR fa.account_number ILIKE $${params.length} OR ta.account_number ILIKE $${params.length} OR fa.holder_name ILIKE $${params.length} OR ta.holder_name ILIKE $${params.length})`
        );
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countSql = `
        SELECT COUNT(*)::int AS total
        FROM transactions t
        JOIN bank_accounts fa ON fa.id = t.from_account
        JOIN bank_accounts ta ON ta.id = t.to_account
        ${whereClause}
      `;
      const countRes = await query<{ total: number }>(countSql, params);

      params.push(q.limit);
      const limitIdx = params.length;
      params.push(q.offset);
      const offsetIdx = params.length;

      const sql = `
        SELECT t.*,
               fa.account_number AS from_account_number, fa.holder_name AS from_holder, fa.branch_city AS from_city,
               ta.account_number AS to_account_number, ta.holder_name AS to_holder, ta.branch_city AS to_city,
               c.complaint_number
        FROM transactions t
        JOIN bank_accounts fa ON fa.id = t.from_account
        JOIN bank_accounts ta ON ta.id = t.to_account
        LEFT JOIN complaints c ON c.id = t.complaint_id
        ${whereClause}
        ORDER BY t.timestamp DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
      const rowsRes = await query(sql, params);

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
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
  validate({ body: createTxnSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createTxnSchema>;
      const txnId = body.txnId ?? `TXN-MAN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      const inserted = await withTransaction(async (client) => {
        const fromId = await resolveAccountId(client, body.fromAccount);
        const toId = await resolveAccountId(client, body.toAccount);

        if (fromId === toId) {
          throw new AppError('Source and destination accounts must be distinct.', 400, 'SAME_ACCOUNT');
        }

        const txRes = await client.query(
          `INSERT INTO transactions (
             txn_id, from_account, to_account, amount, currency, timestamp,
             channel, complaint_id, hop_depth, is_flagged_fraud, remarks, is_synthetic
           )
           VALUES ($1, $2, $3, $4, 'INR', $5, $6, $7, $8, $9, $10, TRUE)
           RETURNING *`,
          [
            txnId,
            fromId,
            toId,
            body.amount,
            body.timestamp,
            body.channel,
            body.complaintId ?? null,
            body.hopDepth ?? null,
            body.isFlaggedFraud,
            body.remarks ?? 'Manual investigator ingestion',
          ]
        );

        await client.query(
          `INSERT INTO beneficiary_accounts (source_account_id, beneficiary_id, added_at, total_transferred, transfer_count)
           VALUES ($1, $2, $3, $4, 1)
           ON CONFLICT (source_account_id, beneficiary_id) DO UPDATE
           SET total_transferred = beneficiary_accounts.total_transferred + EXCLUDED.total_transferred,
               transfer_count = beneficiary_accounts.transfer_count + 1`,
          [fromId, toId, body.timestamp, body.amount]
        );

        return txRes.rows[0];
      });

      await recordAuditLog({
        req,
        action: 'TRANSACTION_CREATED',
        resourceType: 'TRANSACTION',
        resourceId: txnId,
        statusCode: 201,
        details: { amount: body.amount, channel: body.channel, complaintId: body.complaintId ?? null },
      });

      res.status(201).json({ success: true, data: inserted });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/upload-csv',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new AppError('CSV file is required under field name "file".', 400, 'FILE_MISSING');
      }

      const rawCsv = req.file.buffer.toString('utf-8');
      const records = parse(rawCsv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, unknown>>;

      if (records.length === 0) {
        throw new AppError('Uploaded CSV file contains no rows.', 400, 'EMPTY_CSV');
      }
      if (records.length > 5000) {
        throw new AppError('CSV upload limited to 5,000 rows per batch.', 400, 'BATCH_TOO_LARGE');
      }

      let insertedCount = 0;
      let duplicateCount = 0;
      const rowErrors: Array<{ row: number; error: string }> = [];

      await withTransaction(async (client) => {
        for (let i = 0; i < records.length; i++) {
          const parsedRow = csvRowSchema.safeParse(records[i]);
          if (!parsedRow.success) {
            rowErrors.push({
              row: i + 2,
              error: parsedRow.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; '),
            });
            continue;
          }

          const row = parsedRow.data;
          const ts = new Date(row.timestamp);
          if (Number.isNaN(ts.getTime())) {
            rowErrors.push({ row: i + 2, error: `Invalid timestamp '${row.timestamp}'` });
            continue;
          }

          let fromId: string;
          let toId: string;
          try {
            fromId = await resolveAccountId(client, row.from_account);
            toId = await resolveAccountId(client, row.to_account);
          } catch (e) {
            rowErrors.push({ row: i + 2, error: (e as Error).message });
            continue;
          }

          if (fromId === toId) {
            rowErrors.push({ row: i + 2, error: 'from_account and to_account cannot be identical' });
            continue;
          }

          let complaintId: string | null = row.complaint_id ?? null;
          if (!complaintId && row.complaint_number) {
            const cmpRes = await client.query<{ id: string }>(
              'SELECT id FROM complaints WHERE complaint_number = $1 LIMIT 1',
              [row.complaint_number]
            );
            complaintId = cmpRes.rows[0]?.id ?? null;
          }

          const insertRes = await client.query(
            `INSERT INTO transactions (
               txn_id, from_account, to_account, amount, currency, timestamp,
               channel, complaint_id, hop_depth, is_flagged_fraud, remarks, is_synthetic
             )
             VALUES ($1, $2, $3, $4, 'INR', $5, $6, $7, $8, $9, $10, TRUE)
             ON CONFLICT (txn_id) DO NOTHING
             RETURNING txn_id`,
            [
              row.txn_id,
              fromId,
              toId,
              row.amount,
              ts.toISOString(),
              row.channel,
              complaintId,
              row.hop_depth,
              row.is_flagged_fraud,
              row.remarks ?? 'CSV bulk upload',
            ]
          );

          if (insertRes.rowCount === 0) {
            duplicateCount += 1;
            continue;
          }

          await client.query(
            `INSERT INTO beneficiary_accounts (source_account_id, beneficiary_id, added_at, total_transferred, transfer_count)
             VALUES ($1, $2, $3, $4, 1)
             ON CONFLICT (source_account_id, beneficiary_id) DO UPDATE
             SET total_transferred = beneficiary_accounts.total_transferred + EXCLUDED.total_transferred,
                 transfer_count = beneficiary_accounts.transfer_count + 1`,
            [fromId, toId, ts.toISOString(), row.amount]
          );

          insertedCount += 1;
        }
      });

      await recordAuditLog({
        req,
        action: 'TRANSACTIONS_CSV_UPLOADED',
        resourceType: 'TRANSACTION_BATCH',
        resourceId: req.file.originalname,
        statusCode: 201,
        details: {
          totalRows: records.length,
          inserted: insertedCount,
          duplicates: duplicateCount,
          errorCount: rowErrors.length,
        },
      });

      res.status(201).json({
        success: true,
        data: {
          totalRows: records.length,
          inserted: insertedCount,
          skippedDuplicates: duplicateCount,
          errors: rowErrors,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:txnId', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.*,
              fa.account_number AS from_account_number, fa.holder_name AS from_holder, fa.ifsc_code AS from_ifsc,
              ta.account_number AS to_account_number, ta.holder_name AS to_holder, ta.ifsc_code AS to_ifsc,
              c.complaint_number
       FROM transactions t
       JOIN bank_accounts fa ON fa.id = t.from_account
       JOIN bank_accounts ta ON ta.id = t.to_account
       LEFT JOIN complaints c ON c.id = t.complaint_id
       WHERE t.txn_id = $1
       LIMIT 1`,
      [req.params.txnId]
    );
    if (!result.rows[0]) {
      throw new AppError('Transaction not found.', 404, 'TXN_NOT_FOUND');
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
