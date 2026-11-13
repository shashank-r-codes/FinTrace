import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate, AuthUserPayload, UserRole } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { validate } from '../../middleware/validate.js';
import { maskPhoneNumber } from '../citizen/citizen.serializer.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many authentication attempts. Please try again later.' },
  },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerCitizenSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name is required').max(150),
    email: z.string().trim().email('Valid email is required'),
    phone: z
      .string()
      .trim()
      .regex(/^[+\d\s()-]{8,20}$/, 'Enter a valid phone number (8-20 characters)'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128)
      .regex(/[A-Z]/, 'Password must include an uppercase letter')
      .regex(/[a-z]/, 'Password must include a lowercase letter')
      .regex(/\d/, 'Password must include a number')
      .regex(/[^A-Za-z0-9]/, 'Password must include a special character'),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
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
  phone_masked?: string | null;
  is_active: boolean;
  permissions: string[];
}

router.post('/register-citizen', authLimiter, (req, _res, next) => {
  if (
    req.body &&
    typeof req.body === 'object' &&
    ('role' in req.body || 'roleName' in req.body || 'roleId' in req.body)
  ) {
    next(new AppError('Role assignment is not allowed during citizen self-registration.', 400, 'ROLE_FORBIDDEN'));
    return;
  }
  next();
}, validate({ body: registerCitizenSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof registerCitizenSchema>;
    const existing = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [body.email]);
    if (existing.rows[0]) {
      throw new AppError('An account with this email already exists.', 409, 'EMAIL_EXISTS');
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    const maskedPhone = maskPhoneNumber(body.phone);

    const created = await withTransaction(async (client) => {
      const roleRes = await client.query<{ id: number; permissions: string[] }>(
        "SELECT id, permissions FROM roles WHERE name = 'citizen' LIMIT 1"
      );
      const citizenRole = roleRes.rows[0];
      if (!citizenRole) {
        throw new AppError('Citizen role is not provisioned in database.', 500, 'ROLE_MISSING');
      }

      const victimRes = await client.query<{ id: string }>(
        `INSERT INTO victims (full_name, phone_masked, email, city, state, home_lat, home_lng, is_synthetic)
         VALUES ($1, $2, $3, 'Bengaluru', 'Karnataka', 12.9716, 77.5946, TRUE)
         RETURNING id`,
        [body.fullName, maskedPhone, body.email.toLowerCase()]
      );
      const victimId = victimRes.rows[0].id;

      const userRes = await client.query<{ id: string; email: string; full_name: string }>(
        `INSERT INTO users (email, password_hash, full_name, role_id, institution_id, victim_id, phone_masked, is_active, last_login_at)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, TRUE, NOW())
         RETURNING id, email, full_name`,
        [body.email.toLowerCase(), passwordHash, body.fullName, citizenRole.id, victimId, maskedPhone]
      );
      const user = userRes.rows[0];

      const payload: AuthUserPayload = {
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        role: 'citizen',
        institutionId: null,
      };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(user.id);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, hashToken(refreshToken), expiresAt]
      );

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: 'citizen' as UserRole,
          institutionId: null,
          phoneMasked: maskedPhone,
          permissions: citizenRole.permissions,
        },
      };
    });

    await recordAuditLog({
      req,
      actorUserId: created.user.id,
      actorRole: 'citizen',
      action: 'CITIZEN_REGISTERED',
      resourceType: 'AUTH',
      resourceId: created.user.id,
      statusCode: 201,
      details: { email: created.user.email },
    });

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res, next) => {
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
      `SELECT u.id, u.email, u.full_name, r.name AS role_name, u.institution_id, u.phone_masked, u.is_active, r.permissions
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
        phoneMasked: user.phone_masked ?? null,
        isActive: user.is_active,
        permissions: user.permissions,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
