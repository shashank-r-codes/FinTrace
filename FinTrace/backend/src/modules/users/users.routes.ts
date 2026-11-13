import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeRoles } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';

const router = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2).max(150),
  roleName: z.enum(['Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer']),
  institutionId: z.string().uuid().nullable().optional(),
  investigatorProfile: z
    .object({
      badgeNumber: z.string().min(3).max(50),
      unitName: z.string().min(2).max(120),
      jurisdiction: z.string().min(2).max(120),
      specialization: z.string().max(120).optional(),
    })
    .optional(),
});

const updateUserSchema = z.object({
  roleName: z.enum(['Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer']).optional(),
  isActive: z.boolean().optional(),
  fullName: z.string().min(2).max(150).optional(),
});

const userParamsSchema = z.object({
  id: z.string().uuid(),
});

router.use(authenticate);

router.get('/roles', authorizeRoles('Administrator', 'Senior Investigator'), async (_req, res, next) => {
  try {
    const result = await query('SELECT id, name, description, permissions FROM roles ORDER BY id ASC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/investigators', async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT i.id, i.user_id, u.full_name, u.email, r.name AS role_name,
              i.badge_number, i.unit_name, i.jurisdiction, i.specialization, i.active_caseload
       FROM investigators i
       JOIN users u ON u.id = i.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = TRUE
       ORDER BY u.full_name ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/', authorizeRoles('Administrator', 'Senior Investigator'), async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.last_login_at, u.created_at,
              r.name AS role, u.institution_id, fi.name AS institution_name,
              i.badge_number, i.unit_name, i.jurisdiction
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN financial_institutions fi ON fi.id = u.institution_id
       LEFT JOIN investigators i ON i.user_id = u.id
       ORDER BY u.created_at DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  authorizeRoles('Administrator'),
  validate({ body: createUserSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createUserSchema>;
      const passwordHash = await bcrypt.hash(body.password, 10);

      const created = await withTransaction(async (client) => {
        const roleRes = await client.query<{ id: number }>('SELECT id FROM roles WHERE name = $1 LIMIT 1', [
          body.roleName,
        ]);
        const role = roleRes.rows[0];
        if (!role) {
          throw new AppError('Invalid role specified.', 400, 'INVALID_ROLE');
        }

        const userRes = await client.query<{
          id: string;
          email: string;
          full_name: string;
          is_active: boolean;
          created_at: Date;
        }>(
          `INSERT INTO users (email, password_hash, full_name, role_id, institution_id, is_active)
           VALUES ($1, $2, $3, $4, $5, TRUE)
           RETURNING id, email, full_name, is_active, created_at`,
          [body.email, passwordHash, body.fullName, role.id, body.institutionId ?? null]
        );
        const newUser = userRes.rows[0];

        if (
          body.investigatorProfile &&
          (body.roleName === 'Investigator' || body.roleName === 'Senior Investigator')
        ) {
          await client.query(
            `INSERT INTO investigators (user_id, badge_number, unit_name, jurisdiction, specialization)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              newUser.id,
              body.investigatorProfile.badgeNumber,
              body.investigatorProfile.unitName,
              body.investigatorProfile.jurisdiction,
              body.investigatorProfile.specialization ?? null,
            ]
          );
        }

        return { ...newUser, role: body.roleName };
      });

      await recordAuditLog({
        req,
        action: 'USER_CREATED',
        resourceType: 'USER',
        resourceId: created.id,
        statusCode: 201,
        details: { email: created.email, role: created.role },
      });

      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  authorizeRoles('Administrator'),
  validate({ params: userParamsSchema, body: updateUserSchema }),
  async (req: ValidatedRequest<z.infer<typeof updateUserSchema>, Record<string, unknown>, { id: string }>, res, next) => {
    try {
      const { id } = req.validatedParams!;
      const body = req.body as z.infer<typeof updateUserSchema>;

      let roleId: number | null = null;
      if (body.roleName) {
        const r = await query<{ id: number }>('SELECT id FROM roles WHERE name = $1 LIMIT 1', [body.roleName]);
        if (!r.rows[0]) {
          throw new AppError('Invalid role specified.', 400, 'INVALID_ROLE');
        }
        roleId = r.rows[0].id;
      }

      const updated = await query(
        `UPDATE users
         SET role_id = COALESCE($2, role_id),
             is_active = COALESCE($3, is_active),
             full_name = COALESCE($4, full_name),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, email, full_name, is_active, updated_at`,
        [id, roleId, body.isActive ?? null, body.fullName ?? null]
      );

      if (!updated.rows[0]) {
        throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
      }

      await recordAuditLog({
        req,
        action: 'USER_UPDATED',
        resourceType: 'USER',
        resourceId: id,
        statusCode: 200,
        details: body as Record<string, unknown>,
      });

      res.json({ success: true, data: updated.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
