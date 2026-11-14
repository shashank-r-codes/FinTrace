import { Router } from 'express';
import { z } from 'zod';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { authorizeOfficer } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';
import * as service from './interventions.service.js';

const router = Router();

const interventionsQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'APPROVED', 'REJECTED', 'ESCALATED', 'AUTO_RESOLVED', 'FALSE_POSITIVE', 'ALL'])
    .default('ALL'),
  action: z
    .enum(['ALLOW', 'ADDITIONAL_VERIFICATION', 'HOLD_FOR_REVIEW', 'REJECT_BLOCK', 'ALL'])
    .default('ALL'),
  riskLevel: z.enum(['Low', 'Medium', 'High', 'Critical', 'ALL']).default('ALL'),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const reviewBodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'ESCALATED', 'FALSE_POSITIVE']),
  action: z.enum(['ALLOW', 'ADDITIONAL_VERIFICATION', 'HOLD_FOR_REVIEW', 'REJECT_BLOCK']).optional(),
  notes: z
    .string()
    .min(5, 'Review notes must be at least 5 characters for compliance audit justification'),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

router.use(authenticate, authorizeOfficer);

/**
 * List interventions with filtering and pagination.
 */
router.get(
  '/',
  validate({ query: interventionsQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof interventionsQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const result = await service.listInterventions(q);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Summary metrics and performance indicators for the Intervention Centre.
 */
router.get('/metrics', async (_req, res, next) => {
  try {
    const metrics = await service.getInterventionMetrics();
    res.json({ success: true, data: metrics });
  } catch (err) {
    next(err);
  }
});

/**
 * Cryptographic audit hash chain verification endpoint.
 * Validates SHA-256 sequential linking from genesis to latest entry.
 */
router.get('/verify-chain', async (req, res, next) => {
  try {
    const report = await service.verifyAuditHashChain();

    await recordAuditLog({
      req,
      action: 'AUDIT_CHAIN_VERIFIED',
      resourceType: 'INTERVENTION_AUDIT_LOGS',
      resourceId: report.latest_hash || 'GENESIS',
      statusCode: report.status === 'VALID' ? 200 : 409,
    });

    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

/**
 * Get detailed intervention record with embedded screening details and tamper-evident audit history.
 */
router.get(
  '/:id',
  validate({ params: uuidParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { id: string }>, res, next) => {
    try {
      const { id } = req.validatedParams!;
      const intervention = await service.getInterventionById(id);
      res.json({ success: true, data: intervention });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Review or override an intervention decision with mandatory officer justification.
 */
router.post(
  '/:id/review',
  validate({ params: uuidParamSchema, body: reviewBodySchema }),
  async (
    req: ValidatedRequest<z.infer<typeof reviewBodySchema>, Record<string, unknown>, { id: string }>,
    res,
    next
  ) => {
    try {
      const { id } = req.validatedParams!;
      const body = req.validatedBody!;

      const result = await service.reviewIntervention(
        id,
        body,
        {
          userId: req.user!.userId,
          role: req.user!.role,
          fullName: req.user!.fullName,
        },
        req.ip || '127.0.0.1'
      );

      await recordAuditLog({
        req,
        action: `INTERVENTION_REVIEW_${body.decision}`,
        resourceType: 'TRANSACTION_INTERVENTION',
        resourceId: id,
        statusCode: 200,
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

const bridgeBodySchema = z.object({
  caseTitle: z.string().optional(),
  generateEvidenceRecord: z.boolean().default(true),
  flagAccountAsConfirmed: z.boolean().default(false),
  notes: z.string().optional(),
});

/**
 * Bridge an intercepted intervention directly into post-fraud forensics:
 * creates a formal investigation case and generates Section 91 CrPC evidence.
 */
router.post(
  '/:id/bridge-to-forensics',
  validate({ params: uuidParamSchema, body: bridgeBodySchema }),
  async (
    req: ValidatedRequest<z.infer<typeof bridgeBodySchema>, Record<string, unknown>, { id: string }>,
    res,
    next
  ) => {
    try {
      const { id } = req.validatedParams!;
      const body = req.validatedBody!;

      const result = await service.bridgeInterventionToForensics(
        id,
        body,
        {
          userId: req.user!.userId,
          role: req.user!.role,
          fullName: req.user!.fullName,
        },
        req.ip || '127.0.0.1'
      );

      await recordAuditLog({
        req,
        action: 'INTERVENTION_BRIDGED_TO_FORENSICS',
        resourceType: 'INVESTIGATION',
        resourceId: result.investigation.id,
        statusCode: 201,
      });

      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
