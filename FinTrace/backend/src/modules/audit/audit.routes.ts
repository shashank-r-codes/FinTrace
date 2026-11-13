import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { authenticate } from '../../middleware/auth.js';
import { authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';

const router = Router();

const auditQuerySchema = z.object({
  action: z.string().max(100).optional(),
  resourceType: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.use(authenticate);
router.use(authorizeRoles('Administrator', 'Senior Investigator'));

router.get(
  '/',
  validate({ query: auditQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof auditQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (q.action) {
        params.push(`%${q.action}%`);
        conditions.push(`al.action ILIKE $${params.length}`);
      }
      if (q.resourceType) {
        params.push(q.resourceType);
        conditions.push(`al.resource_type = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(q.limit);
      const limitIdx = params.length;
      params.push(q.offset);
      const offsetIdx = params.length;

      const sql = `
        SELECT al.*, u.email AS actor_email, u.full_name AS actor_name
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
      const result = await query(sql, params);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
