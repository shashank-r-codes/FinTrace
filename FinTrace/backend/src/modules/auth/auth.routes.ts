import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate, AuthUserPayload, UserRole } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { validate } from '../../middleware/validate.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken(payload: AuthUserPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function signRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role_name: UserRole;
  institution_id: string | null;
  is_active: boolean;
  permissions: string[];
}

router.post('/login', validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const userRes = await query<UserRow>(
      `SELECT u.id, u.email, u.password_hash, u.full_name, r.name AS role_name,
              u.institution_id, u.is_active, r.permissions
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE LOWER(u.email) = LOWER($1)
       LIMIT 1`,
      [email]
    );

    const user = userRes.rows[0];
    if (!user) {
      throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }
    if (!user.is_active) {
      throw new AppError('User account is deactivated.', 403, 'ACCOUNT_INACTIVE');
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }

    const payload: AuthUserPayload = {
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role_name,
      institutionId: user.institution_id,
    };

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(user.id);
    const refreshHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await withTransaction(async (client) => {
      await client.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, refreshHash, expiresAt]
      );
    });

    await recordAuditLog({
      req,
      actorUserId: user.id,
      actorRole: user.role_name,
      action: 'USER_LOGIN',
      resourceType: 'AUTH',
      resourceId: user.id,
      statusCode: 200,
    });

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: user.role_name,
          institutionId: user.institution_id,
          permissions: user.permissions,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', validate({ body: refreshSchema }), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;

    let decoded: { userId: string; type: string };
    try {
      decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { userId: string; type: string };
    } catch {
      throw new AppError('Invalid or expired refresh token.', 401, 'REFRESH_INVALID');
    }

    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid token type.', 401, 'REFRESH_INVALID');
    }

    const tokenHash = hashToken(refreshToken);

    const result = await withTransaction(async (client) => {
      const tokenRes = await client.query<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null }>(
        `SELECT id, user_id, expires_at, revoked_at
         FROM refresh_tokens
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );

      const stored = tokenRes.rows[0];
      if (!stored || stored.revoked_at !== null || new Date(stored.expires_at) < new Date()) {
        throw new AppError('Refresh token has been revoked or expired.', 401, 'REFRESH_REVOKED');
      }

      const userRes = await client.query<UserRow>(
        `SELECT u.id, u.email, u.password_hash, u.full_name, r.name AS role_name,
                u.institution_id, u.is_active, r.permissions
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = $1
         LIMIT 1`,
        [stored.user_id]
      );

      const user = userRes.rows[0];
      if (!user || !user.is_active) {
        throw new AppError('User not active.', 403, 'ACCOUNT_INACTIVE');
      }

      await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [stored.id]);

      const payload: AuthUserPayload = {
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role_name,
        institutionId: user.institution_id,
      };
      const nextAccess = signAccessToken(payload);
      const nextRefresh = signRefreshToken(user.id);
      const nextRefreshHash = hashToken(nextRefresh);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, nextRefreshHash, expiresAt]
      );

      return { accessToken: nextAccess, refreshToken: nextRefresh };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
    if (refreshToken) {
      await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND user_id = $2', [
        hashToken(refreshToken),
        req.user!.userId,
      ]);
    } else {
      await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [
        req.user!.userId,
      ]);
    }

    await recordAuditLog({
      req,
      action: 'USER_LOGOUT',
      resourceType: 'AUTH',
      resourceId: req.user!.userId,
      statusCode: 200,
    });

    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const userRes = await query<UserRow>(
      `SELECT u.id, u.email, u.full_name, r.name AS role_name, u.institution_id, u.is_active, r.permissions
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1
       LIMIT 1`,
      [req.user!.userId]
    );
    const user = userRes.rows[0];
    if (!user) {
      throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role_name,
        institutionId: user.institution_id,
        isActive: user.is_active,
        permissions: user.permissions,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
