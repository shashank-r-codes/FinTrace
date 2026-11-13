import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeOfficer, authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';

const router = Router();

const listEvidenceQuerySchema = z.object({
  investigationId: z.string().uuid().optional(),
  complaintId: z.string().uuid().optional(),
  evidenceType: z
    .enum([
      'BANK_STATEMENT_CSV',
      'CDR_EXTRACT',
      'ATM_CCTV_NOTE',
      'NPCI_REF',
      'FREEZE_ORDER',
      'OTHER',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createEvidenceSchema = z.object({
  investigationId: z.string().uuid(),
  complaintId: z.string().uuid(),
  evidenceType: z.enum([
    'BANK_STATEMENT_CSV',
    'CDR_EXTRACT',
    'ATM_CCTV_NOTE',
    'NPCI_REF',
    'FREEZE_ORDER',
    'OTHER',
  ]),
  title: z.string().min(4).max(200),
  description: z.string().min(8).max(4000),
  fileName: z.string().max(255).nullable().optional(),
  contentPayload: z.string().max(20000).optional(),
  sha256Hash: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'SHA-256 hash must be 64 hexadecimal characters')
    .optional(),
  metadataJson: z.record(z.string(), z.unknown()).default({}),
});

const verifyEvidenceSchema = z.object({
  sha256Hash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  contentPayload: z.string().min(1).max(20000).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

router.use(authenticate, authorizeOfficer);

router.get(
  '/',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ query: listEvidenceQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof listEvidenceQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.investigationId) {
        params.push(q.investigationId);
        conditions.push(`er.investigation_id = $${params.length}`);
      }
      if (q.complaintId) {
        params.push(q.complaintId);
        conditions.push(`er.complaint_id = $${params.length}`);
      }
      if (q.evidenceType) {
        params.push(q.evidenceType);
        conditions.push(`er.evidence_type = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(q.limit);

      const sql = `
        SELECT er.*,
               inv.case_number,
               c.complaint_number,
               u.full_name AS uploaded_by_name,
               u.email AS uploaded_by_email
        FROM evidence_records er
        LEFT JOIN investigations inv ON inv.id = er.investigation_id
        JOIN complaints c ON c.id = er.complaint_id
        JOIN users u ON u.id = er.uploaded_by
        ${whereClause}
        ORDER BY er.recorded_at DESC
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
  validate({ body: createEvidenceSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createEvidenceSchema>;

      const invCheck = await query(
        'SELECT id, complaint_id FROM investigations WHERE id = $1 LIMIT 1',
        [body.investigationId]
      );
      if (!invCheck.rows[0]) {
        throw new AppError('Referenced investigation does not exist.', 404, 'INVESTIGATION_NOT_FOUND');
      }
      if (invCheck.rows[0].complaint_id !== body.complaintId) {
        throw new AppError(
          'Complaint ID does not match the referenced investigation.',
          400,
          'INVESTIGATION_COMPLAINT_MISMATCH'
        );
      }

      const digestSource =
        body.contentPayload ??
        `${body.complaintId}|${body.investigationId}|${body.evidenceType}|${body.title}|${body.description}|${body.fileName ?? ''}`;

      const computedHash = body.sha256Hash
        ? body.sha256Hash.toLowerCase()
        : crypto.createHash('sha256').update(digestSource, 'utf8').digest('hex');

      const enrichedMeta = {
        ...body.metadataJson,
        hashAlgorithm: 'SHA-256',
        hashInputMode: body.sha256Hash
          ? 'supplied_digest'
          : body.contentPayload
            ? 'payload_digest'
            : 'canonical_record_digest',
        chainOfCustodyActor: req.user!.email,
      };

      const result = await query(
        `INSERT INTO evidence_records (
           investigation_id, complaint_id, uploaded_by, evidence_type, title, description,
           file_name, sha256_hash, metadata_json
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING *`,
        [
          body.investigationId,
          body.complaintId,
          req.user!.userId,
          body.evidenceType,
          body.title,
          body.description,
          body.fileName ?? null,
          computedHash,
          JSON.stringify(enrichedMeta),
        ]
      );

      await recordAuditLog({
        req,
        action: 'EVIDENCE_RECORDED',
        resourceType: 'EVIDENCE',
        resourceId: result.rows[0].id,
        statusCode: 201,
        details: {
          investigationId: body.investigationId,
          evidenceType: body.evidenceType,
          sha256Hash: computedHash,
        },
      });

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/verify',
  authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
  validate({ params: idParamSchema, body: verifyEvidenceSchema }),
  async (
    req: ValidatedRequest<z.infer<typeof verifyEvidenceSchema>, Record<string, unknown>, { id: string }>,
    res,
    next
  ) => {
    try {
      const { id } = req.validatedParams!;
      const body = req.body as z.infer<typeof verifyEvidenceSchema>;

      if (!body.sha256Hash && !body.contentPayload) {
        throw new AppError(
          'Provide either sha256Hash or contentPayload to verify integrity.',
          400,
          'VERIFICATION_INPUT_REQUIRED'
        );
      }

      const evRes = await query('SELECT * FROM evidence_records WHERE id = $1 LIMIT 1', [id]);
      if (!evRes.rows[0]) {
        throw new AppError('Evidence record not found.', 404, 'EVIDENCE_NOT_FOUND');
      }

      const record = evRes.rows[0];
      const candidateHash = body.sha256Hash
        ? body.sha256Hash.toLowerCase()
        : crypto.createHash('sha256').update(body.contentPayload!, 'utf8').digest('hex');

      const storedHash = String(record.sha256_hash ?? '').trim().toLowerCase();
      const matched = Boolean(storedHash && candidateHash === storedHash);

      await recordAuditLog({
        req,
        action: 'EVIDENCE_VERIFIED',
        resourceType: 'EVIDENCE',
        resourceId: id,
        statusCode: 200,
        details: { matched, candidateHash },
      });

      res.json({
        success: true,
        data: {
          evidenceId: id,
          matched,
          storedHash,
          candidateHash,
          verifiedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
