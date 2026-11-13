import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { NextFunction, Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import {
  CitizenStatus,
  mapOfficerStatusToCitizenStatus,
  maskAccountNumber,
  maskPhoneNumber,
  toCitizenComplaintDetailDto,
  toCitizenComplaintSummaryDto,
} from '../FinTrace/backend/src/modules/citizen/citizen.serializer.ts';
import {
  computeAtmClusters,
  dbStore,
  detectFraudForComplaint,
  findSuspiciousPaths,
  resolveAccount,
  runAtmPredictionForComplaint,
  traceAccountGraph,
  traceComplaintGraph,
  trainBaselineEvaluator,
} from './store.ts';

type UserRole = 'Administrator' | 'Senior Investigator' | 'Investigator' | 'Bank Nodal Officer' | 'citizen';

const OFFICER_ROLES: UserRole[] = [
  'Administrator',
  'Senior Investigator',
  'Investigator',
  'Bank Nodal Officer',
];

interface AuthUserPayload {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  institutionId: string | null;
}

interface AuthedRequest extends Request {
  user?: AuthUserPayload;
}

const JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || crypto.createHash('sha256').update('fintrace-preview-access-key').digest('hex');
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || crypto.createHash('sha256').update('fintrace-preview-refresh-key').digest('hex');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

class HttpError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'API_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken(payload: AuthUserPayload): string {
  return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: '2h' });
}

function signRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

function authenticate(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    next(new HttpError('Authentication token missing.', 401, 'AUTH_MISSING'));
    return;
  }
  const token = header.slice(7).trim();
  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET) as AuthUserPayload;
    const user = dbStore.users.find((u) => u.id === decoded.userId);
    if (!user || !user.is_active) {
      next(new HttpError('User account inactive or missing.', 401, 'ACCOUNT_INACTIVE'));
      return;
    }
    req.user = {
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role_name,
      institutionId: user.institution_id,
    };
    next();
  } catch {
    next(new HttpError('Invalid or expired access token.', 401, 'TOKEN_INVALID'));
  }
}

function authorizeRoles(...allowed: UserRole[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError('Authentication required.', 401, 'AUTH_REQUIRED'));
      return;
    }
    if (!allowed.includes(req.user.role)) {
      next(new HttpError(`Role '${req.user.role}' is not permitted to perform this action.`, 403, 'FORBIDDEN'));
      return;
    }
    next();
  };
}

const authorizeOfficer = authorizeRoles(...OFFICER_ROLES);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts. Please try again later.',
    },
  },
});

const ALLOWED_EVIDENCE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
]);

const citizenUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_EVIDENCE_MIME.has(file.mimetype)) {
      cb(new HttpError('Only PNG, JPEG, WEBP images and PDF files are allowed.', 400, 'INVALID_FILE_TYPE'));
      return;
    }
    cb(null, true);
  },
});

function recordAudit(
  req: AuthedRequest,
  action: string,
  resourceType: string,
  resourceId: string | null,
  statusCode: number,
  details: Record<string, unknown> = {},
  overrideActor?: { id: string; role: string }
): void {
  dbStore.auditLogs.unshift({
    id: crypto.randomUUID(),
    actor_user_id: overrideActor?.id ?? req.user?.userId ?? null,
    actor_role: overrideActor?.role ?? req.user?.role ?? null,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    http_method: req.method,
    endpoint: req.originalUrl,
    ip_address: req.ip ?? '127.0.0.1',
    status_code: statusCode,
    details_json: details,
    created_at: new Date().toISOString(),
  });
  if (dbStore.auditLogs.length > 400) {
    dbStore.auditLogs.length = 400;
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(msg, 400, 'VALIDATION_ERROR');
  }
  return parsed.data;
}

function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim() || '';
  if (!key) return false;
  if (key.startsWith('CHANGE_ME') || key === 'MY_GEMINI_API_KEY') return false;
  return true;
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(','));
  return [headerLine, ...dataLines].join('\n');
}

export function createApiRouter(): Router {
  const api = Router();

  // Health
  api.get('/health', (_req, res) => {
    res.json({
      success: true,
      service: 'fintrace-preview-runtime',
      status: 'healthy',
      database: 'in-memory-synthetic-seeded',
      syntheticDemo: true,
      timestamp: new Date().toISOString(),
    });
  });

  // ---------------- AUTH ----------------
  const loginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });
  api.post('/auth/login', authLimiter, async (req: AuthedRequest, res, next) => {
    try {
      const { email, password } = parseOrThrow(loginSchema, req.body);
      const user = dbStore.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (!user) throw new HttpError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
      if (!user.is_active) throw new HttpError('User account is deactivated.', 403, 'ACCOUNT_INACTIVE');

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) throw new HttpError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');

      const roleDef = dbStore.roles.find((r) => r.name === user.role_name);
      const payload: AuthUserPayload = {
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role_name,
        institutionId: user.institution_id,
      };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(user.id);
      user.last_login_at = new Date().toISOString();
      dbStore.refreshTokens.push({
        id: crypto.randomUUID(),
        user_id: user.id,
        token_hash: hashToken(refreshToken),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        revoked_at: null,
      });

      recordAudit(req, 'USER_LOGIN', 'AUTH', user.id, 200, { email: user.email }, { id: user.id, role: user.role_name });

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
            phoneMasked: user.phone_masked ?? null,
            permissions: roleDef?.permissions ?? [],
          },
        },
      });
    } catch (err) {
      next(err);
    }
  });

  const registerCitizenSchema = z
    .object({
      fullName: z.string().trim().min(2).max(150),
      email: z.string().trim().email().max(150),
      phone: z.string().trim().min(8).max(20),
      password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .max(128)
        .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
        .regex(/[a-z]/, 'Password must include at least one lowercase letter')
        .regex(/[0-9]/, 'Password must include at least one digit')
        .regex(/[^A-Za-z0-9]/, 'Password must include at least one special character'),
      confirmPassword: z.string().min(8),
      city: z.string().trim().min(2).max(100).default('Bengaluru'),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    });

  api.post('/auth/register-citizen', authLimiter, async (req: AuthedRequest, res, next) => {
    try {
      const rawBody = req.body as Record<string, unknown> | undefined;
      if (
        rawBody &&
        ('role' in rawBody ||
          'roleName' in rawBody ||
          'roleId' in rawBody ||
          'isAdmin' in rawBody ||
          'permissions' in rawBody)
      ) {
        throw new HttpError(
          'Role assignment is not allowed on self-registration.',
          400,
          'ROLE_ASSIGNMENT_FORBIDDEN'
        );
      }

      const body = parseOrThrow(registerCitizenSchema, req.body);
      const emailNormalized = body.email.toLowerCase();

      if (dbStore.users.some((u) => u.email.toLowerCase() === emailNormalized)) {
        throw new HttpError('An account with this email already exists.', 409, 'EMAIL_EXISTS');
      }

      const passwordHash = await bcrypt.hash(body.password, 10);
      const phoneMasked = maskPhoneNumber(body.phone);
      const victimId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      dbStore.victims.push({
        id: victimId,
        full_name: body.fullName,
        phone_masked: phoneMasked,
        email: emailNormalized,
        city: body.city,
        state: 'Karnataka',
        home_lat: 12.9716,
        home_lng: 77.5946,
      });

      dbStore.users.unshift({
        id: userId,
        email: emailNormalized,
        password_hash: passwordHash,
        full_name: body.fullName,
        role_name: 'citizen',
        institution_id: null,
        victim_id: victimId,
        phone_masked: phoneMasked,
        is_active: true,
        last_login_at: nowIso,
        created_at: nowIso,
      });

      const payload: AuthUserPayload = {
        userId,
        email: emailNormalized,
        fullName: body.fullName,
        role: 'citizen',
        institutionId: null,
      };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(userId);
      dbStore.refreshTokens.push({
        id: crypto.randomUUID(),
        user_id: userId,
        token_hash: hashToken(refreshToken),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        revoked_at: null,
      });

      const roleDef = dbStore.roles.find((r) => r.name === 'citizen');
      recordAudit(
        req,
        'CITIZEN_REGISTERED',
        'AUTH',
        userId,
        201,
        { email: emailNormalized },
        { id: userId, role: 'citizen' }
      );

      res.status(201).json({
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: {
            id: userId,
            email: emailNormalized,
            fullName: body.fullName,
            role: 'citizen',
            institutionId: null,
            phoneMasked,
            permissions: roleDef?.permissions ?? ['citizen_complaints:create', 'citizen_complaints:read_own'],
          },
        },
      });
    } catch (err) {
      next(err);
    }
  });

  api.post('/auth/refresh', (req, res, next) => {
    try {
      const { refreshToken } = parseOrThrow(z.object({ refreshToken: z.string().min(20) }), req.body);
      let decoded: { userId: string; type: string };
      try {
        decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as { userId: string; type: string };
      } catch {
        throw new HttpError('Invalid or expired refresh token.', 401, 'REFRESH_INVALID');
      }
      if (decoded.type !== 'refresh') throw new HttpError('Invalid token type.', 401, 'REFRESH_INVALID');

      const tokenHash = hashToken(refreshToken);
      const stored = dbStore.refreshTokens.find((rt) => rt.token_hash === tokenHash);
      if (!stored || stored.revoked_at !== null || new Date(stored.expires_at) < new Date()) {
        throw new HttpError('Refresh token has been revoked or expired.', 401, 'REFRESH_REVOKED');
      }
      const user = dbStore.users.find((u) => u.id === stored.user_id);
      if (!user || !user.is_active) throw new HttpError('User not active.', 403, 'ACCOUNT_INACTIVE');

      stored.revoked_at = new Date().toISOString();
      const nextAccess = signAccessToken({
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role_name,
        institutionId: user.institution_id,
      });
      const nextRefresh = signRefreshToken(user.id);
      dbStore.refreshTokens.push({
        id: crypto.randomUUID(),
        user_id: user.id,
        token_hash: hashToken(nextRefresh),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        revoked_at: null,
      });
      res.json({ success: true, data: { accessToken: nextAccess, refreshToken: nextRefresh } });
    } catch (err) {
      next(err);
    }
  });

  api.post('/auth/logout', authenticate, (req: AuthedRequest, res) => {
    const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
    if (refreshToken) {
      const h = hashToken(refreshToken);
      for (const rt of dbStore.refreshTokens) {
        if (rt.token_hash === h && rt.user_id === req.user!.userId) rt.revoked_at = new Date().toISOString();
      }
    } else {
      for (const rt of dbStore.refreshTokens) {
        if (rt.user_id === req.user!.userId && !rt.revoked_at) rt.revoked_at = new Date().toISOString();
      }
    }
    recordAudit(req, 'USER_LOGOUT', 'AUTH', req.user!.userId, 200);
    res.json({ success: true, message: 'Logged out successfully.' });
  });

  api.get('/auth/me', authenticate, (req: AuthedRequest, res, next) => {
    const user = dbStore.users.find((u) => u.id === req.user!.userId);
    if (!user) {
      next(new HttpError('User not found.', 404, 'USER_NOT_FOUND'));
      return;
    }
    const roleDef = dbStore.roles.find((r) => r.name === user.role_name);
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
        permissions: roleDef?.permissions ?? [],
      },
    });
  });

  // ---------------- USERS ----------------
  api.get('/users/roles', authenticate, authorizeRoles('Administrator', 'Senior Investigator'), (_req, res) => {
    res.json({ success: true, data: dbStore.roles });
  });

  api.get('/users/investigators', authenticate, authorizeOfficer, (_req, res) => {
    const rows = dbStore.investigators
      .map((inv) => {
        const u = dbStore.users.find((x) => x.id === inv.user_id);
        if (!u || !u.is_active) return null;
        return {
          id: inv.id,
          user_id: u.id,
          full_name: u.full_name,
          email: u.email,
          role_name: u.role_name,
          badge_number: inv.badge_number,
          unit_name: inv.unit_name,
          jurisdiction: inv.jurisdiction,
          specialization: inv.specialization,
          active_caseload: inv.active_caseload,
        };
      })
      .filter(Boolean);
    res.json({ success: true, data: rows });
  });

  api.get('/users', authenticate, authorizeRoles('Administrator', 'Senior Investigator'), (_req, res) => {
    const rows = dbStore.users.map((u) => {
      const inst = u.institution_id ? dbStore.institutions.find((i) => i.id === u.institution_id) : null;
      const inv = dbStore.investigators.find((i) => i.user_id === u.id);
      return {
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        is_active: u.is_active,
        last_login_at: u.last_login_at,
        created_at: u.created_at,
        role: u.role_name,
        institution_id: u.institution_id,
        institution_name: inst?.name ?? null,
        badge_number: inv?.badge_number ?? null,
        unit_name: inv?.unit_name ?? null,
        jurisdiction: inv?.jurisdiction ?? null,
      };
    });
    res.json({ success: true, data: rows });
  });

  api.post('/users', authenticate, authorizeRoles('Administrator'), async (req: AuthedRequest, res, next) => {
    try {
      const body = parseOrThrow(
        z.object({
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
        }),
        req.body
      );

      if (dbStore.users.some((u) => u.email.toLowerCase() === body.email.toLowerCase())) {
        throw new HttpError('A user with this email already exists.', 409, 'EMAIL_EXISTS');
      }

      const passwordHash = await bcrypt.hash(body.password, 10);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      dbStore.users.unshift({
        id,
        email: body.email,
        password_hash: passwordHash,
        full_name: body.fullName,
        role_name: body.roleName,
        institution_id: body.institutionId ?? null,
        victim_id: null,
        phone_masked: null,
        is_active: true,
        last_login_at: null,
        created_at: now,
      });

      if (body.investigatorProfile && (body.roleName === 'Investigator' || body.roleName === 'Senior Investigator')) {
        dbStore.investigators.push({
          id: crypto.randomUUID(),
          user_id: id,
          badge_number: body.investigatorProfile.badgeNumber,
          unit_name: body.investigatorProfile.unitName,
          jurisdiction: body.investigatorProfile.jurisdiction,
          specialization: body.investigatorProfile.specialization ?? null,
          active_caseload: 0,
        });
      }

      recordAudit(req, 'USER_CREATED', 'USER', id, 201, { email: body.email, role: body.roleName });
      res.status(201).json({
        success: true,
        data: { id, email: body.email, full_name: body.fullName, is_active: true, created_at: now, role: body.roleName },
      });
    } catch (err) {
      next(err);
    }
  });

  api.patch('/users/:id', authenticate, authorizeRoles('Administrator'), (req: AuthedRequest, res, next) => {
    try {
      const body = parseOrThrow(
        z.object({
          roleName: z.enum(['Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer']).optional(),
          isActive: z.boolean().optional(),
          fullName: z.string().min(2).max(150).optional(),
        }),
        req.body
      );
      const user = dbStore.users.find((u) => u.id === req.params.id);
      if (!user) throw new HttpError('User not found.', 404, 'USER_NOT_FOUND');

      if (body.roleName) user.role_name = body.roleName;
      if (body.isActive !== undefined) user.is_active = body.isActive;
      if (body.fullName) user.full_name = body.fullName;

      recordAudit(req, 'USER_UPDATED', 'USER', user.id, 200, body as Record<string, unknown>);
      res.json({
        success: true,
        data: { id: user.id, email: user.email, full_name: user.full_name, is_active: user.is_active },
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------------- COMPLAINTS ----------------
  api.get('/complaints', authenticate, authorizeOfficer, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    let rows = dbStore.complaints.map((c) => {
      const victim = dbStore.victims.find((v) => v.id === c.victim_id);
      const inv = c.assigned_to ? dbStore.investigators.find((i) => i.id === c.assigned_to) : null;
      const invUser = inv ? dbStore.users.find((u) => u.id === inv.user_id) : null;
      return {
        id: c.id,
        complaint_number: c.complaint_number,
        reference_no: c.reference_no,
        fraud_type: c.fraud_type,
        reported_amount: c.reported_amount,
        currency: c.currency,
        incident_timestamp: c.incident_timestamp.toISOString(),
        reported_at: c.reported_at.toISOString(),
        status: c.status,
        citizen_status: c.citizen_status,
        priority: c.priority,
        summary: c.summary,
        city: c.city,
        is_synthetic: c.is_synthetic,
        created_at: c.created_at,
        victim_id: c.victim_id,
        victim_name: victim?.full_name ?? 'Unknown Victim',
        victim_phone: victim?.phone_masked ?? 'N/A',
        investigator_id: inv?.id ?? null,
        investigator_name: invUser?.full_name ?? null,
        transaction_count: dbStore.transactions.filter((t) => t.complaint_id === c.id).length,
        atm_prediction_count: dbStore.atmPredictions.filter((p) => p.complaint_id === c.id).length,
        open_alert_count: dbStore.alerts.filter((a) => a.complaint_id === c.id && a.status === 'OPEN').length,
      };
    });

    if (q.status) rows = rows.filter((r) => r.status === q.status);
    if (q.priority) rows = rows.filter((r) => r.priority === q.priority);
    if (q.fraudType) rows = rows.filter((r) => r.fraud_type === q.fraudType);
    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.complaint_number.toLowerCase().includes(s) ||
          r.victim_name.toLowerCase().includes(s) ||
          r.summary.toLowerCase().includes(s)
      );
    }
    rows.sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime());

    const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
    const offset = Math.max(0, Number(q.offset) || 0);
    res.json({
      success: true,
      data: rows.slice(offset, offset + limit),
      pagination: { total: rows.length, limit, offset },
    });
  });

  api.post(
    '/complaints',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
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
          }),
          req.body
        );

        const victimId = crypto.randomUUID();
        dbStore.victims.push({
          id: victimId,
          full_name: body.victim.fullName,
          phone_masked: body.victim.phoneMasked,
          email: body.victim.email ?? 'victim@synthetic.local',
          city: body.victim.city,
          state: body.victim.state,
          home_lat: body.victim.homeLat ?? 12.9716,
          home_lng: body.victim.homeLng ?? 77.5946,
        });

        const nextNum = dbStore.complaints.length + 101;
        const year = new Date().getFullYear();
        const complaintNumber = `CMP-${year}-${String(nextNum).padStart(4, '0')}`;
        const referenceNo = `FT-${year}-${String(nextNum).padStart(4, '0')}${crypto.randomInt(10, 99)}`;
        const cmpId = crypto.randomUUID();
        const now = new Date();
        const citizenStatus = mapOfficerStatusToCitizenStatus('REGISTERED', Boolean(body.assignedTo));
        const cmp = {
          id: cmpId,
          complaint_number: complaintNumber,
          reference_no: referenceNo,
          victim_id: victimId,
          filed_by_user_id: null,
          assigned_to: body.assignedTo ?? null,
          fraud_type: body.fraudType,
          reported_amount: body.reportedAmount,
          currency: 'INR',
          incident_timestamp: new Date(body.incidentTimestamp),
          reported_at: now,
          status: 'REGISTERED' as const,
          citizen_status: citizenStatus,
          priority: body.priority,
          summary: body.summary,
          city: body.city,
          victim_bank_name: null,
          victim_account_masked: null,
          is_synthetic: true,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        };
        dbStore.complaints.unshift(cmp);

        if (body.openInvestigation) {
          dbStore.investigations.unshift({
            id: crypto.randomUUID(),
            case_number: `INV-BLR-${new Date().getFullYear()}-${String(nextNum).padStart(2, '0')}`,
            complaint_id: cmpId,
            lead_investigator: body.assignedTo ?? null,
            status: 'OPEN',
            findings_summary: 'Investigation initialized upon complaint registration.',
            recommended_actions: [],
            opened_at: now.toISOString(),
            closed_at: null,
            updated_at: now.toISOString(),
          });
        }

        recordAudit(req, 'COMPLAINT_REGISTERED', 'COMPLAINT', cmpId, 201, {
          complaint_number: complaintNumber,
          reported_amount: body.reportedAmount,
        });
        res.status(201).json({ success: true, data: cmp });
      } catch (err) {
        next(err);
      }
    }
  );

  api.get('/complaints/:id', authenticate, authorizeOfficer, (req, res, next) => {
    const cmp = dbStore.complaints.find((c) => c.id === req.params.id);
    if (!cmp) {
      next(new HttpError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND'));
      return;
    }
    const victim = dbStore.victims.find((v) => v.id === cmp.victim_id);
    const inv = cmp.assigned_to ? dbStore.investigators.find((i) => i.id === cmp.assigned_to) : null;
    const invUser = inv ? dbStore.users.find((u) => u.id === inv.user_id) : null;
    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
    const atmMap = new Map(dbStore.atms.map((a) => [a.id, a]));
    const userMap = new Map(dbStore.users.map((u) => [u.id, u]));

    const txns = dbStore.transactions
      .filter((t) => t.complaint_id === cmp.id)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((t) => ({
        ...t,
        timestamp: t.timestamp.toISOString(),
        from_account_number: accMap.get(t.from_account)?.account_number ?? t.from_account,
        from_holder: accMap.get(t.from_account)?.holder_name ?? 'Unknown',
        to_account_number: accMap.get(t.to_account)?.account_number ?? t.to_account,
        to_holder: accMap.get(t.to_account)?.holder_name ?? 'Unknown',
      }));

    const susp = dbStore.suspiciousAccounts
      .filter((s) => s.complaint_id === cmp.id)
      .sort((a, b) => (b.mule_probability ?? 0) - (a.mule_probability ?? 0))
      .map((s) => {
        const acc = accMap.get(s.account_id);
        return {
          ...s,
          account_number: acc?.account_number ?? s.account_id,
          holder_name: acc?.holder_name ?? 'Unknown',
          branch_city: acc?.branch_city ?? 'Bengaluru',
          is_frozen: acc?.is_frozen ?? false,
        };
      });

    const investigation = dbStore.investigations.find((i) => i.complaint_id === cmp.id) ?? null;
    const atmPredictions = dbStore.atmPredictions
      .filter((ap) => ap.complaint_id === cmp.id)
      .sort((a, b) => a.rank_order - b.rank_order)
      .map((ap) => {
        const atm = atmMap.get(ap.atm_id);
        return {
          ...ap,
          bank: atm?.bank ?? 'Unknown',
          address: atm?.address ?? '',
          locality: atm?.locality ?? '',
          city: atm?.city ?? 'Bengaluru',
          lat: atm?.lat ?? 12.9716,
          lng: atm?.lng ?? 77.5946,
        };
      });

    const statusHistory = dbStore.complaintStatusHistory
      .filter((h) => h.complaint_id === cmp.id)
      .sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime())
      .map((h) => ({
        ...h,
        changed_by_name: h.changed_by ? userMap.get(h.changed_by)?.full_name ?? 'Officer' : 'System',
      }));

    res.json({
      success: true,
      data: {
        complaint: {
          ...cmp,
          incident_timestamp: cmp.incident_timestamp.toISOString(),
          reported_at: cmp.reported_at.toISOString(),
          victim_name: victim?.full_name ?? 'Unknown',
          victim_phone: victim?.phone_masked ?? 'N/A',
          victim_email: victim?.email ?? null,
          victim_city: victim?.city ?? 'Bengaluru',
          victim_state: victim?.state ?? 'Karnataka',
          home_lat: victim?.home_lat ?? null,
          home_lng: victim?.home_lng ?? null,
          investigator_name: invUser?.full_name ?? null,
          investigator_badge: inv?.badge_number ?? null,
        },
        transactions: txns,
        suspiciousAccounts: susp,
        investigation,
        atmPredictions,
        statusHistory,
      },
    });
  });

  api.patch(
    '/complaints/:id/status',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
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
          }),
          req.body
        );
        const cmp = dbStore.complaints.find((c) => c.id === req.params.id);
        if (!cmp) throw new HttpError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND');

        const nextAssignedTo = body.assignedTo !== undefined ? body.assignedTo : cmp.assigned_to;
        const nextCitizenStatus: CitizenStatus =
          body.citizenStatus ?? mapOfficerStatusToCitizenStatus(body.status, Boolean(nextAssignedTo));
        const nowIso = new Date().toISOString();

        cmp.status = body.status;
        cmp.assigned_to = nextAssignedTo;
        cmp.citizen_status = nextCitizenStatus;
        cmp.updated_at = nowIso;

        const cleanPublicRemark = body.publicRemark?.trim() || null;
        const cleanInternalNote = body.internalNote?.trim() || null;

        dbStore.complaintStatusHistory.push({
          id: crypto.randomUUID(),
          complaint_id: cmp.id,
          status: body.status,
          citizen_status: nextCitizenStatus,
          public_remark: cleanPublicRemark,
          internal_note: cleanInternalNote,
          changed_by: req.user!.userId,
          changed_at: nowIso,
        });

        if (cmp.filed_by_user_id) {
          dbStore.citizenNotifications.unshift({
            id: crypto.randomUUID(),
            user_id: cmp.filed_by_user_id,
            complaint_id: cmp.id,
            reference_no: cmp.reference_no,
            title: `Status updated: ${nextCitizenStatus}`,
            message:
              cleanPublicRemark ??
              `Your complaint ${cmp.reference_no} moved to '${nextCitizenStatus}'.`,
            citizen_status: nextCitizenStatus,
            is_read: false,
            created_at: nowIso,
          });
        }

        recordAudit(req, 'COMPLAINT_STATUS_UPDATED', 'COMPLAINT', cmp.id, 200, {
          status: body.status,
          citizen_status: nextCitizenStatus,
          assignedTo: nextAssignedTo,
          hasPublicRemark: Boolean(cleanPublicRemark),
          hasInternalNote: Boolean(cleanInternalNote),
        });
        res.json({ success: true, data: cmp });
      } catch (err) {
        next(err);
      }
    }
  );

  // ---------------- ACCOUNTS ----------------
  api.get('/accounts/institutions', authenticate, authorizeOfficer, (_req, res) => {
    res.json({ success: true, data: dbStore.institutions });
  });

  api.get('/accounts', authenticate, authorizeOfficer, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const instMap = new Map(dbStore.institutions.map((i) => [i.id, i]));
    let rows = dbStore.accounts.map((acc) => {
      const inst = instMap.get(acc.institution_id);
      const flags = dbStore.suspiciousAccounts.filter((s) => s.account_id === acc.id && s.status !== 'CLEARED');
      const maxProb = flags.reduce<number | null>(
        (mx, f) => (f.mule_probability !== null ? Math.max(mx ?? 0, f.mule_probability) : mx),
        null
      );
      const inflow = dbStore.transactions
        .filter((t) => t.to_account === acc.id)
        .reduce((s, t) => s + Number(t.amount), 0);
      const outflow = dbStore.transactions
        .filter((t) => t.from_account === acc.id)
        .reduce((s, t) => s + Number(t.amount), 0);

      return {
        ...acc,
        bank_name: inst?.name ?? 'Synthetic Bank',
        bank_code: inst?.bank_code ?? 'SYN',
        suspicious_flag_count: flags.length,
        max_mule_prob: maxProb,
        inflow_total: inflow,
        outflow_total: outflow,
      };
    });

    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.account_number.toLowerCase().includes(s) ||
          r.holder_name.toLowerCase().includes(s) ||
          r.branch_city.toLowerCase().includes(s)
      );
    }
    if (q.frozenOnly === 'true') rows = rows.filter((r) => r.is_frozen);
    if (q.suspiciousOnly === 'true') rows = rows.filter((r) => r.suspicious_flag_count > 0);
    rows.sort((a, b) => b.suspicious_flag_count - a.suspicious_flag_count || a.account_number.localeCompare(b.account_number));

    const limit = Math.min(100, Math.max(1, Number(q.limit) || 40));
    const offset = Math.max(0, Number(q.offset) || 0);
    res.json({ success: true, data: rows.slice(offset, offset + limit) });
  });

  api.get('/accounts/:id', authenticate, authorizeOfficer, (req, res, next) => {
    const acc = dbStore.accounts.find((a) => a.id === req.params.id);
    if (!acc) {
      next(new HttpError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND'));
      return;
    }
    const inst = dbStore.institutions.find((i) => i.id === acc.institution_id);
    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
    const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));
    const atmMap = new Map(dbStore.atms.map((a) => [a.id, a]));

    const txns = dbStore.transactions
      .filter((t) => t.from_account === acc.id || t.to_account === acc.id)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 100)
      .map((t) => ({
        ...t,
        timestamp: t.timestamp.toISOString(),
        from_account_number: accMap.get(t.from_account)?.account_number ?? t.from_account,
        to_account_number: accMap.get(t.to_account)?.account_number ?? t.to_account,
      }));

    const suspiciousFlags = dbStore.suspiciousAccounts
      .filter((s) => s.account_id === acc.id)
      .map((s) => ({ ...s, complaint_number: cmpMap.get(s.complaint_id)?.complaint_number ?? null }));

    const atmWithdrawals = dbStore.atmWithdrawals
      .filter((w) => w.account_id === acc.id)
      .map((w) => {
        const atm = atmMap.get(w.atm_id);
        return {
          ...w,
          withdrawn_at: w.withdrawn_at.toISOString(),
          bank: atm?.bank ?? '',
          address: atm?.address ?? '',
          locality: atm?.locality ?? '',
          city: atm?.city ?? 'Bengaluru',
        };
      });

    res.json({
      success: true,
      data: {
        account: { ...acc, bank_name: inst?.name ?? '', bank_code: inst?.bank_code ?? '' },
        transactions: txns,
        suspiciousFlags,
        atmWithdrawals,
      },
    });
  });

  api.post(
    '/accounts/:id/flag',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
            complaintId: z.string().uuid().nullable().optional(),
            classification: z.enum([
              'SUSPECTED_MULE',
              'LAYERING_NODE',
              'CASH_OUT_CANDIDATE',
              'ORIGIN_COMPROMISED',
              'CLEARED',
            ]),
            muleProbability: z.number().min(0).max(1).nullable().optional(),
            scoreSource: z
              .enum(['Trained ML prediction', 'Rule-based risk score', 'Synthetic demo result'])
              .default('Rule-based risk score'),
            reason: z.string().min(5).max(1000),
            freezeAccount: z.boolean().default(false),
          }),
          req.body
        );

        const acc = dbStore.accounts.find((a) => a.id === req.params.id);
        if (!acc) throw new HttpError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND');

        const status = body.classification === 'CLEARED' ? 'CLEARED' : body.freezeAccount ? 'FROZEN' : 'ACTIVE';
        const targetCmpId = body.complaintId ?? dbStore.complaints[0]?.id ?? '';
        let record = dbStore.suspiciousAccounts.find(
          (s) => s.account_id === acc.id && s.complaint_id === targetCmpId
        );
        const nowIso = new Date().toISOString();

        if (record) {
          record.classification = body.classification;
          record.mule_probability = body.muleProbability ?? record.mule_probability;
          record.score_source = body.scoreSource;
          record.reason = body.reason;
          record.flagged_by = req.user!.userId;
          record.status = status;
          record.updated_at = nowIso;
        } else {
          record = {
            id: crypto.randomUUID(),
            account_id: acc.id,
            complaint_id: targetCmpId,
            classification: body.classification,
            mule_probability: body.muleProbability ?? null,
            score_source: body.scoreSource,
            reason: body.reason,
            flagged_by: req.user!.userId,
            status,
            created_at: nowIso,
            updated_at: nowIso,
          };
          dbStore.suspiciousAccounts.unshift(record);
        }

        if (body.freezeAccount) acc.is_frozen = true;
        else if (body.classification === 'CLEARED' || body.freezeAccount === false) acc.is_frozen = false;

        recordAudit(
          req,
          body.freezeAccount ? 'ACCOUNT_FROZEN_AND_FLAGGED' : 'ACCOUNT_FLAGGED',
          'BANK_ACCOUNT',
          acc.id,
          200,
          body as Record<string, unknown>
        );
        res.json({ success: true, data: record });
      } catch (err) {
        next(err);
      }
    }
  );

  // ---------------- TRANSACTIONS ----------------
  api.get('/transactions', authenticate, authorizeOfficer, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
    const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));

    let rows = dbStore.transactions.map((t) => {
      const fa = accMap.get(t.from_account);
      const ta = accMap.get(t.to_account);
      return {
        ...t,
        timestamp: t.timestamp.toISOString(),
        from_account_number: fa?.account_number ?? t.from_account,
        from_holder: fa?.holder_name ?? 'Unknown',
        from_city: fa?.branch_city ?? 'Bengaluru',
        to_account_number: ta?.account_number ?? t.to_account,
        to_holder: ta?.holder_name ?? 'Unknown',
        to_city: ta?.branch_city ?? 'Bengaluru',
        complaint_number: t.complaint_id ? cmpMap.get(t.complaint_id)?.complaint_number ?? null : null,
      };
    });

    if (q.complaintId) rows = rows.filter((r) => r.complaint_id === q.complaintId);
    if (q.accountId) rows = rows.filter((r) => r.from_account === q.accountId || r.to_account === q.accountId);
    if (q.channel) rows = rows.filter((r) => r.channel === q.channel);
    if (q.flaggedOnly === 'true') rows = rows.filter((r) => r.is_flagged_fraud);
    if (q.minAmount !== undefined && q.minAmount !== '') rows = rows.filter((r) => r.amount >= Number(q.minAmount));
    if (q.maxAmount !== undefined && q.maxAmount !== '') rows = rows.filter((r) => r.amount <= Number(q.maxAmount));
    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.txn_id.toLowerCase().includes(s) ||
          r.from_account_number.toLowerCase().includes(s) ||
          r.to_account_number.toLowerCase().includes(s) ||
          r.from_holder.toLowerCase().includes(s) ||
          r.to_holder.toLowerCase().includes(s)
      );
    }

    rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const offset = Math.max(0, Number(q.offset) || 0);
    res.json({
      success: true,
      data: rows.slice(offset, offset + limit),
      pagination: { total: rows.length, limit, offset },
    });
  });

  api.post(
    '/transactions',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
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
          }),
          req.body
        );

        const fromAcc = resolveAccount(dbStore, body.fromAccount);
        const toAcc = resolveAccount(dbStore, body.toAccount);
        if (!fromAcc) throw new HttpError(`Bank account '${body.fromAccount}' not found.`, 400, 'ACCOUNT_NOT_FOUND');
        if (!toAcc) throw new HttpError(`Bank account '${body.toAccount}' not found.`, 400, 'ACCOUNT_NOT_FOUND');
        if (fromAcc.id === toAcc.id) throw new HttpError('Source and destination accounts must be distinct.', 400, 'SAME_ACCOUNT');

        const txnId = body.txnId ?? `TXN-MAN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        if (dbStore.transactions.some((t) => t.txn_id === txnId)) {
          throw new HttpError(`Transaction '${txnId}' already exists.`, 409, 'DUPLICATE_TXN');
        }

        const inserted = {
          id: crypto.randomUUID(),
          txn_id: txnId,
          from_account: fromAcc.id,
          to_account: toAcc.id,
          amount: body.amount,
          currency: 'INR',
          timestamp: new Date(body.timestamp),
          channel: body.channel,
          complaint_id: body.complaintId ?? null,
          hop_depth: body.hopDepth ?? null,
          is_flagged_fraud: body.isFlaggedFraud,
          remarks: body.remarks ?? 'Manual investigator ingestion',
          is_synthetic: true,
        };
        dbStore.transactions.unshift(inserted);

        recordAudit(req, 'TRANSACTION_CREATED', 'TRANSACTION', txnId, 201, {
          amount: body.amount,
          channel: body.channel,
        });
        res.status(201).json({ success: true, data: { ...inserted, timestamp: inserted.timestamp.toISOString() } });
      } catch (err) {
        next(err);
      }
    }
  );

  api.post(
    '/transactions/upload-csv',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
    upload.single('file'),
    (req: AuthedRequest, res, next) => {
      try {
        if (!req.file) throw new HttpError('CSV file is required under field name "file".', 400, 'FILE_MISSING');
        const records = parse(req.file.buffer.toString('utf-8'), {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        }) as Array<Record<string, unknown>>;

        if (records.length === 0) throw new HttpError('Uploaded CSV file contains no rows.', 400, 'EMPTY_CSV');

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

        let inserted = 0;
        let skippedDuplicates = 0;
        const errors: Array<{ row: number; error: string }> = [];

        for (let i = 0; i < records.length; i++) {
          const parsed = csvRowSchema.safeParse(records[i]);
          if (!parsed.success) {
            errors.push({
              row: i + 2,
              error: parsed.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; '),
            });
            continue;
          }
          const r = parsed.data;
          const ts = new Date(r.timestamp);
          if (Number.isNaN(ts.getTime())) {
            errors.push({ row: i + 2, error: `Invalid timestamp '${r.timestamp}'` });
            continue;
          }
          const fromAcc = resolveAccount(dbStore, r.from_account);
          const toAcc = resolveAccount(dbStore, r.to_account);
          if (!fromAcc || !toAcc) {
            errors.push({ row: i + 2, error: `Account not found (${r.from_account} / ${r.to_account})` });
            continue;
          }
          if (fromAcc.id === toAcc.id) {
            errors.push({ row: i + 2, error: 'from_account and to_account cannot be identical' });
            continue;
          }
          if (dbStore.transactions.some((t) => t.txn_id === r.txn_id)) {
            skippedDuplicates++;
            continue;
          }
          let cmpId: string | null = r.complaint_id ?? null;
          if (!cmpId && r.complaint_number) {
            cmpId = dbStore.complaints.find((c) => c.complaint_number === r.complaint_number)?.id ?? null;
          }
          dbStore.transactions.unshift({
            id: crypto.randomUUID(),
            txn_id: r.txn_id,
            from_account: fromAcc.id,
            to_account: toAcc.id,
            amount: r.amount,
            currency: 'INR',
            timestamp: ts,
            channel: r.channel,
            complaint_id: cmpId,
            hop_depth: r.hop_depth,
            is_flagged_fraud: r.is_flagged_fraud,
            remarks: r.remarks ?? 'CSV bulk upload',
            is_synthetic: true,
          });
          inserted++;
        }

        recordAudit(req, 'TRANSACTIONS_CSV_UPLOADED', 'TRANSACTION_BATCH', req.file.originalname, 201, {
          totalRows: records.length,
          inserted,
          skippedDuplicates,
          errorCount: errors.length,
        });
        res.status(201).json({
          success: true,
          data: { totalRows: records.length, inserted, skippedDuplicates, errors },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ---------------- GRAPH ----------------
  api.get('/graph/cte-trace', authenticate, authorizeOfficer, (req, res, next) => {
    try {
      const q = parseOrThrow(
        z.object({
          accountId: z.string().min(4),
          direction: z.enum(['forward', 'reverse', 'both']).default('forward'),
          depth: z.coerce.number().int().min(1).max(6).default(3),
          complaintId: z.string().uuid().optional(),
        }),
        req.query
      );
      const acc = resolveAccount(dbStore, q.accountId);
      if (!acc) throw new HttpError(`Account '${q.accountId}' not found.`, 404, 'ACCOUNT_NOT_FOUND');

      const { cteRows } = traceAccountGraph(dbStore, acc.id, q.direction, q.depth, q.complaintId);
      res.json({
        success: true,
        engine: 'typescript-bfs-trace',
        data: { rootAccountId: acc.id, direction: q.direction, depth: q.depth, edges: cteRows },
      });
    } catch (err) {
      next(err);
    }
  });

  api.get('/graph/trace', authenticate, authorizeOfficer, (req, res, next) => {
    try {
      const q = parseOrThrow(
        z.object({
          accountId: z.string().min(4),
          direction: z.enum(['forward', 'reverse', 'both']).default('forward'),
          depth: z.coerce.number().int().min(1).max(6).default(3),
          complaintId: z.string().uuid().optional(),
        }),
        req.query
      );
      const acc = resolveAccount(dbStore, q.accountId);
      if (!acc) throw new HttpError(`Account '${q.accountId}' not found.`, 404, 'ACCOUNT_NOT_FOUND');

      const { graph } = traceAccountGraph(dbStore, acc.id, q.direction, q.depth, q.complaintId);
      res.json({ success: true, data: graph });
    } catch (err) {
      next(err);
    }
  });

  api.get('/graph/complaint/:id', authenticate, authorizeOfficer, (req: AuthedRequest, res, next) => {
    const cmp = dbStore.complaints.find((c) => c.id === req.params.id);
    if (!cmp) {
      next(new HttpError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND'));
      return;
    }
    const graphData = traceComplaintGraph(dbStore, cmp.id);
    recordAudit(req, 'COMPLAINT_GRAPH_TRACED', 'TRANSACTION_NETWORK', cmp.id, 200);
    res.json({ success: true, data: graphData });
  });

  api.get('/graph/paths', authenticate, authorizeOfficer, (req, res, next) => {
    try {
      const q = parseOrThrow(
        z.object({
          sourceAccountId: z.string().uuid(),
          targetAccountId: z.string().uuid().optional(),
          complaintId: z.string().uuid().optional(),
          maxDepth: z.coerce.number().int().min(1).max(8).default(5),
        }),
        req.query
      );
      const paths = findSuspiciousPaths(dbStore, q.sourceAccountId, q.targetAccountId, q.complaintId, q.maxDepth);
      res.json({ success: true, data: { paths, count: paths.length } });
    } catch (err) {
      next(err);
    }
  });

  // ---------------- ML & FRAUD DETECTION ----------------
  api.post(
    '/ml/train',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator'),
    (req: AuthedRequest, res) => {
      const metric = trainBaselineEvaluator(dbStore);
      recordAudit(req, 'ML_MODELS_TRAINED', 'ML_MODEL', metric.model_version, 200, {
        split_strategy: metric.split_strategy,
        f1: metric.f1_score,
      });
      res.json({
        success: true,
        data: {
          model_version: metric.model_version,
          split_strategy: metric.split_strategy,
          metrics: metric,
        },
      });
    }
  );

  api.get('/ml/metrics', authenticate, authorizeOfficer, (_req, res) => {
    res.json({ success: true, data: dbStore.modelMetrics.slice(0, 10) });
  });

  api.post(
    '/ml/detect/:id',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res, next) => {
      const cmp = dbStore.complaints.find((c) => c.id === req.params.id);
      if (!cmp) {
        next(new HttpError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND'));
        return;
      }
      const predictions = detectFraudForComplaint(dbStore, cmp.id);
      recordAudit(req, 'ML_FRAUD_DETECTION_RUN', 'COMPLAINT', cmp.id, 200, {
        score_source: 'Rule-based risk score',
        accounts_scored: predictions.length,
      });
      res.json({
        success: true,
        data: {
          complaint_id: cmp.id,
          score_source: 'Rule-based risk score',
          predictions,
        },
      });
    }
  );

  api.get('/ml/predictions', authenticate, authorizeOfficer, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
    const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));
    let rows = dbStore.fraudResults.map((r) => {
      const acc = accMap.get(r.account_id);
      const cmp = r.complaint_id ? cmpMap.get(r.complaint_id) : null;
      return {
        ...r,
        account_number: acc?.account_number ?? r.account_id,
        holder_name: acc?.holder_name ?? 'Unknown',
        branch_city: acc?.branch_city ?? 'Bengaluru',
        is_frozen: acc?.is_frozen ?? false,
        complaint_number: cmp?.complaint_number ?? null,
      };
    });
    if (q.complaintId) rows = rows.filter((r) => r.complaint_id === q.complaintId);
    if (q.accountId) rows = rows.filter((r) => r.account_id === q.accountId);
    rows.sort((a, b) => b.mule_score - a.mule_score);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    res.json({ success: true, data: rows.slice(0, limit) });
  });

  api.get('/ml/clusters/atms', authenticate, authorizeOfficer, (_req, res) => {
    res.json({ success: true, data: { clusters: computeAtmClusters(dbStore) } });
  });

  // ---------------- ATMs & PREDICTIONS ----------------
  api.get('/atms', authenticate, authorizeOfficer, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    let rows = dbStore.atms.map((atm) => {
      const preds = dbStore.atmPredictions.filter((p) => p.atm_id === atm.id);
      const wds = dbStore.atmWithdrawals.filter((w) => w.atm_id === atm.id);
      return {
        ...atm,
        max_risk_score: preds.reduce((mx, p) => Math.max(mx, p.risk_score), 0),
        active_prediction_cases: new Set(preds.map((p) => p.complaint_id)).size,
        historical_withdrawal_count: wds.length,
      };
    });
    if (q.city) rows = rows.filter((r) => r.city.toLowerCase().includes(q.city!.toLowerCase()));
    if (q.locality) rows = rows.filter((r) => r.locality.toLowerCase().includes(q.locality!.toLowerCase()));
    if (q.is24x7 === 'true') rows = rows.filter((r) => r.is_24x7);
    rows.sort((a, b) => b.max_risk_score - a.max_risk_score);
    res.json({ success: true, data: rows });
  });

  api.get('/atms/withdrawals', authenticate, authorizeOfficer, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const atmMap = new Map(dbStore.atms.map((a) => [a.id, a]));
    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
    const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));

    let rows = dbStore.atmWithdrawals.map((w) => {
      const atm = atmMap.get(w.atm_id);
      const acc = accMap.get(w.account_id);
      return {
        ...w,
        withdrawn_at: w.withdrawn_at.toISOString(),
        bank: atm?.bank ?? '',
        address: atm?.address ?? '',
        locality: atm?.locality ?? '',
        city: atm?.city ?? 'Bengaluru',
        lat: atm?.lat ?? 12.9716,
        lng: atm?.lng ?? 77.5946,
        account_number: acc?.account_number ?? w.account_id,
        holder_name: acc?.holder_name ?? 'Unknown',
        complaint_number: w.complaint_id ? cmpMap.get(w.complaint_id)?.complaint_number ?? null : null,
      };
    });

    if (q.atmId) rows = rows.filter((r) => r.atm_id === q.atmId);
    if (q.accountId) rows = rows.filter((r) => r.account_id === q.accountId);
    if (q.complaintId) rows = rows.filter((r) => r.complaint_id === q.complaintId);
    if (q.flaggedOnly === 'true') rows = rows.filter((r) => r.is_flagged_cashout);
    rows.sort((a, b) => new Date(b.withdrawn_at).getTime() - new Date(a.withdrawn_at).getTime());

    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    res.json({ success: true, data: rows.slice(0, limit) });
  });

  api.post(
    '/predictions/atm/run/:complaintId',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res, next) => {
      const cmp = dbStore.complaints.find((c) => c.id === req.params.complaintId);
      if (!cmp) {
        next(new HttpError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND'));
        return;
      }
      const topN = Math.min(20, Math.max(1, Number(req.query.topN) || 8));
      const autoAlert = req.query.autoAlert !== 'false';
      const data = runAtmPredictionForComplaint(dbStore, cmp.id, topN)!;

      if (autoAlert && data.top_3_atms.length > 0) {
        const top = data.top_3_atms[0];
        if (top.risk_level === 'Critical' || top.risk_level === 'High') {
          const exists = dbStore.alerts.some(
            (a) => a.complaint_id === cmp.id && a.atm_id === top.atm_id && (a.status === 'OPEN' || a.status === 'ACKNOWLEDGED')
          );
          if (!exists) {
            const nowIso = new Date().toISOString();
            dbStore.alerts.unshift({
              id: crypto.randomUUID(),
              complaint_id: cmp.id,
              account_id: top.linked_accounts_json?.[0]?.account_id ?? null,
              atm_id: top.atm_id,
              alert_type: 'CASH_OUT_IMMINENT',
              severity: top.risk_level === 'Critical' ? 'Critical' : 'High',
              status: 'OPEN',
              title: `Predicted Cash-Out Hotspot: ${top.locality} (${top.window})`,
              description: `${cmp.complaint_number}: Top-ranked terminal ${top.atm_id} scored ${top.risk_score}/100 (${top.risk_level}) for ${top.window} window.`,
              score_source: 'Rule-based risk score',
              acknowledged_by: null,
              acknowledged_at: null,
              created_at: nowIso,
              updated_at: nowIso,
            });
          }
          if (cmp.status === 'REGISTERED' || cmp.status === 'TRACING' || cmp.status === 'MULE_IDENTIFIED') {
            cmp.status = 'ATM_ALERTED';
            cmp.updated_at = new Date().toISOString();
          }
        }
      }

      recordAudit(req, 'ATM_PREDICTION_EXECUTED', 'COMPLAINT', cmp.id, 200, {
        score_source: data.score_source,
        model_version: data.model_version,
        predicted_count: data.predictions.length,
      });
      res.json({ success: true, data });
    }
  );

  api.get('/predictions/atm', authenticate, authorizeOfficer, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const atmMap = new Map(dbStore.atms.map((a) => [a.id, a]));
    const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));
    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));

    let rows = dbStore.atmPredictions.map((ap) => {
      const atm = atmMap.get(ap.atm_id);
      const cmp = cmpMap.get(ap.complaint_id);
      return {
        ...ap,
        linked_accounts_json: ap.linked_accounts_json.map((la) => ({
          ...la,
          holder_name: accMap.get(la.account_id)?.holder_name ?? la.account_number,
        })),
        bank: atm?.bank ?? '',
        address: atm?.address ?? '',
        locality: atm?.locality ?? '',
        city: atm?.city ?? 'Bengaluru',
        state: atm?.state ?? 'Karnataka',
        lat: atm?.lat ?? 12.9716,
        lng: atm?.lng ?? 77.5946,
        cash_capacity_tier: atm?.cash_capacity_tier ?? 'MEDIUM',
        is_24x7: atm?.is_24x7 ?? true,
        complaint_number: cmp?.complaint_number ?? null,
        fraud_type: cmp?.fraud_type ?? 'OTHER',
        reported_amount: cmp?.reported_amount ?? 0,
      };
    });

    if (q.complaintId) rows = rows.filter((r) => r.complaint_id === q.complaintId);
    if (q.riskLevel) rows = rows.filter((r) => r.risk_level === q.riskLevel);
    if (q.window) rows = rows.filter((r) => r.window === q.window);
    rows.sort((a, b) => b.risk_score - a.risk_score || a.rank_order - b.rank_order);

    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const sliced = rows.slice(0, limit);
    res.json({ success: true, data: { top3: sliced.slice(0, 3), predictions: sliced } });
  });

  api.get('/predictions/atm/heatmap', authenticate, authorizeOfficer, (_req, res) => {
    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
    const rows = dbStore.atms
      .map((atm) => {
        const preds = dbStore.atmPredictions.filter((p) => p.atm_id === atm.id).sort((a, b) => b.risk_score - a.risk_score);
        const wds = dbStore.atmWithdrawals.filter((w) => w.atm_id === atm.id);
        const topPred = preds[0];
        return {
          atm_id: atm.id,
          bank: atm.bank,
          address: atm.address,
          locality: atm.locality,
          city: atm.city,
          lat: atm.lat,
          lng: atm.lng,
          max_risk_score: topPred?.risk_score ?? 0,
          peak_risk_level: topPred?.risk_level ?? 'Low',
          peak_window: topPred?.window ?? '>24h',
          top_linked_accounts: (topPred?.linked_accounts_json ?? []).map((la) => ({
            ...la,
            holder_name: accMap.get(la.account_id)?.holder_name ?? la.account_number,
          })),
          top_relevant_paths: topPred?.relevant_paths_json ?? [],
          prediction_count: preds.length,
          withdrawal_count: wds.length,
        };
      })
      .sort((a, b) => b.max_risk_score - a.max_risk_score);
    res.json({ success: true, data: rows });
  });

  // ---------------- ALERTS ----------------
  api.get('/alerts', authenticate, authorizeOfficer, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));
    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
    const atmMap = new Map(dbStore.atms.map((a) => [a.id, a]));
    const userMap = new Map(dbStore.users.map((u) => [u.id, u]));

    let rows = dbStore.alerts.map((al) => {
      const cmp = cmpMap.get(al.complaint_id);
      const acc = al.account_id ? accMap.get(al.account_id) : null;
      const atm = al.atm_id ? atmMap.get(al.atm_id) : null;
      const ackUser = al.acknowledged_by ? userMap.get(al.acknowledged_by) : null;
      return {
        ...al,
        complaint_number: cmp?.complaint_number ?? null,
        account_number: acc?.account_number ?? null,
        holder_name: acc?.holder_name ?? null,
        atm_bank: atm?.bank ?? null,
        atm_address: atm?.address ?? null,
        atm_locality: atm?.locality ?? null,
        acknowledged_by_name: ackUser?.full_name ?? null,
      };
    });

    if (q.status) rows = rows.filter((r) => r.status === q.status);
    if (q.severity) rows = rows.filter((r) => r.severity === q.severity);
    if (q.complaintId) rows = rows.filter((r) => r.complaint_id === q.complaintId);

    const sevRank: Record<string, number> = { Critical: 1, High: 2, Medium: 3, Low: 4 };
    rows.sort(
      (a, b) =>
        (sevRank[a.severity] ?? 5) - (sevRank[b.severity] ?? 5) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    res.json({ success: true, data: rows.slice(0, limit) });
  });

  api.post(
    '/alerts',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
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
          }),
          req.body
        );
        const nowIso = new Date().toISOString();
        const created = {
          id: crypto.randomUUID(),
          complaint_id: body.complaintId,
          account_id: body.accountId ?? null,
          atm_id: body.atmId ?? null,
          alert_type: body.alertType,
          severity: body.severity,
          status: 'OPEN' as const,
          title: body.title,
          description: body.description,
          score_source: body.scoreSource,
          acknowledged_by: null,
          acknowledged_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        dbStore.alerts.unshift(created);
        recordAudit(req, 'ALERT_CREATED', 'ALERT', created.id, 201, { severity: body.severity });
        res.status(201).json({ success: true, data: created });
      } catch (err) {
        next(err);
      }
    }
  );

  api.patch(
    '/alerts/:id',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'DISPATCHED', 'RESOLVED', 'FALSE_POSITIVE']) }),
          req.body
        );
        const al = dbStore.alerts.find((a) => a.id === req.params.id);
        if (!al) throw new HttpError('Alert not found.', 404, 'ALERT_NOT_FOUND');

        al.status = body.status;
        if (body.status !== 'OPEN') {
          al.acknowledged_by = req.user!.userId;
          if (!al.acknowledged_at) al.acknowledged_at = new Date().toISOString();
        }
        al.updated_at = new Date().toISOString();

        recordAudit(req, 'ALERT_STATUS_UPDATED', 'ALERT', al.id, 200, { status: body.status });
        res.json({ success: true, data: al });
      } catch (err) {
        next(err);
      }
    }
  );

  // ---------------- INVESTIGATIONS ----------------
  api.get(
    '/investigations',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      let rows = dbStore.investigations.map((inv) => {
        const cmp = dbStore.complaints.find((c) => c.id === inv.complaint_id);
        const victim = cmp ? dbStore.victims.find((v) => v.id === cmp.victim_id) : null;
        const lead = inv.lead_investigator ? dbStore.investigators.find((i) => i.id === inv.lead_investigator) : null;
        const leadUser = lead ? dbStore.users.find((u) => u.id === lead.user_id) : null;
        return {
          ...inv,
          complaint_number: cmp?.complaint_number ?? 'N/A',
          fraud_type: cmp?.fraud_type ?? 'OTHER',
          reported_amount: cmp?.reported_amount ?? 0,
          complaint_status: cmp?.status ?? 'REGISTERED',
          complaint_priority: cmp?.priority ?? 'HIGH',
          complaint_city: cmp?.city ?? 'Bengaluru',
          victim_name: victim?.full_name ?? 'Unknown',
          lead_investigator_name: leadUser?.full_name ?? null,
          lead_badge_number: lead?.badge_number ?? null,
          lead_unit_name: lead?.unit_name ?? null,
          evidence_count: dbStore.evidenceRecords.filter((e) => e.investigation_id === inv.id).length,
          open_alert_count: dbStore.alerts.filter((a) => a.complaint_id === inv.complaint_id && a.status === 'OPEN').length,
          atm_prediction_count: dbStore.atmPredictions.filter((p) => p.complaint_id === inv.complaint_id).length,
        };
      });
      if (q.status) rows = rows.filter((r) => r.status === q.status);
      if (q.complaintId) rows = rows.filter((r) => r.complaint_id === q.complaintId);
      rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      res.json({ success: true, data: rows.slice(0, Number(q.limit) || 50) });
    }
  );

  api.post(
    '/investigations',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
            complaintId: z.string().uuid(),
            leadInvestigator: z.string().uuid().nullable().optional(),
            status: z.enum(['OPEN', 'ACTIVE_TRACE', 'FREEZE_REQUESTED', 'ATM_SURVEILLANCE', 'CLOSED']).default('OPEN'),
            findingsSummary: z.string().max(4000).optional(),
            recommendedActions: z
              .array(
                z.object({
                  action: z.string().min(3).max(300),
                  priority: z.enum(['IMMEDIATE', 'HIGH', 'MEDIUM', 'LOW']).default('HIGH'),
                  done: z.boolean().default(false),
                })
              )
              .default([]),
          }),
          req.body
        );
        if (dbStore.investigations.some((i) => i.complaint_id === body.complaintId)) {
          throw new HttpError('An investigation case already exists for this complaint.', 409, 'INVESTIGATION_EXISTS');
        }
        const nowIso = new Date().toISOString();
        const caseNumber = `INV-BLR-${new Date().getFullYear()}-${String(dbStore.investigations.length + 1).padStart(3, '0')}`;
        const created = {
          id: crypto.randomUUID(),
          case_number: caseNumber,
          complaint_id: body.complaintId,
          lead_investigator: body.leadInvestigator ?? null,
          status: body.status,
          findings_summary: body.findingsSummary ?? 'Investigation opened for financial trail and ATM forecast coordination.',
          recommended_actions: body.recommendedActions,
          opened_at: nowIso,
          closed_at: body.status === 'CLOSED' ? nowIso : null,
          updated_at: nowIso,
        };
        dbStore.investigations.unshift(created);
        recordAudit(req, 'INVESTIGATION_CREATED', 'INVESTIGATION', created.id, 201, { caseNumber });
        res.status(201).json({ success: true, data: created });
      } catch (err) {
        next(err);
      }
    }
  );

  api.patch(
    '/investigations/:id',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
            leadInvestigator: z.string().uuid().nullable().optional(),
            status: z.enum(['OPEN', 'ACTIVE_TRACE', 'FREEZE_REQUESTED', 'ATM_SURVEILLANCE', 'CLOSED']).optional(),
            findingsSummary: z.string().max(4000).nullable().optional(),
            recommendedActions: z
              .array(
                z.object({
                  action: z.string().min(3).max(300),
                  priority: z.enum(['IMMEDIATE', 'HIGH', 'MEDIUM', 'LOW']).default('HIGH'),
                  done: z.boolean().default(false),
                })
              )
              .optional(),
          }),
          req.body
        );
        const inv = dbStore.investigations.find((i) => i.id === req.params.id);
        if (!inv) throw new HttpError('Investigation case not found.', 404, 'INVESTIGATION_NOT_FOUND');

        if (body.status) inv.status = body.status;
        if (body.leadInvestigator !== undefined) inv.lead_investigator = body.leadInvestigator;
        if (body.findingsSummary !== undefined) inv.findings_summary = body.findingsSummary;
        if (body.recommendedActions !== undefined) inv.recommended_actions = body.recommendedActions;
        inv.closed_at = inv.status === 'CLOSED' ? inv.closed_at ?? new Date().toISOString() : null;
        inv.updated_at = new Date().toISOString();

        recordAudit(req, 'INVESTIGATION_UPDATED', 'INVESTIGATION', inv.id, 200, { status: inv.status });
        res.json({ success: true, data: inv });
      } catch (err) {
        next(err);
      }
    }
  );

  // ---------------- EVIDENCE ----------------
  api.get(
    '/evidence',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      const invMap = new Map(dbStore.investigations.map((i) => [i.id, i]));
      const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));
      const userMap = new Map(dbStore.users.map((u) => [u.id, u]));

      let rows = dbStore.evidenceRecords.map((er) => ({
        ...er,
        case_number: er.investigation_id ? (invMap.get(er.investigation_id)?.case_number ?? 'Citizen Upload') : 'Citizen Upload',
        complaint_number: cmpMap.get(er.complaint_id)?.complaint_number ?? 'N/A',
        uploaded_by_name: userMap.get(er.uploaded_by)?.full_name ?? 'Investigator',
        uploaded_by_email: userMap.get(er.uploaded_by)?.email ?? '',
      }));

      if (q.investigationId) rows = rows.filter((r) => r.investigation_id === q.investigationId);
      if (q.complaintId) rows = rows.filter((r) => r.complaint_id === q.complaintId);
      if (q.evidenceType) rows = rows.filter((r) => r.evidence_type === q.evidenceType);
      rows.sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
      res.json({ success: true, data: rows.slice(0, Number(q.limit) || 50) });
    }
  );

  api.post(
    '/evidence',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
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
            sha256Hash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
            metadataJson: z.record(z.string(), z.unknown()).default({}),
          }),
          req.body
        );
        const inv = dbStore.investigations.find((i) => i.id === body.investigationId);
        if (!inv) throw new HttpError('Referenced investigation does not exist.', 404, 'INVESTIGATION_NOT_FOUND');
        if (inv.complaint_id !== body.complaintId) {
          throw new HttpError('Complaint ID does not match the referenced investigation.', 400, 'INVESTIGATION_COMPLAINT_MISMATCH');
        }

        const digestSource =
          body.contentPayload ??
          `${body.complaintId}|${body.investigationId}|${body.evidenceType}|${body.title}|${body.description}|${body.fileName ?? ''}`;
        const computedHash = body.sha256Hash
          ? body.sha256Hash.toLowerCase()
          : crypto.createHash('sha256').update(digestSource, 'utf8').digest('hex');

        const created = {
          id: crypto.randomUUID(),
          investigation_id: body.investigationId,
          complaint_id: body.complaintId,
          uploaded_by: req.user!.userId,
          evidence_type: body.evidenceType,
          title: body.title,
          description: body.description,
          file_name: body.fileName ?? null,
          sha256_hash: computedHash,
          metadata_json: {
            ...body.metadataJson,
            hashAlgorithm: 'SHA-256',
            chainOfCustodyActor: req.user!.email,
          },
          recorded_at: new Date().toISOString(),
        };
        dbStore.evidenceRecords.unshift(created);
        recordAudit(req, 'EVIDENCE_RECORDED', 'EVIDENCE', created.id, 201, { sha256Hash: computedHash });
        res.status(201).json({ success: true, data: created });
      } catch (err) {
        next(err);
      }
    }
  );

  api.post(
    '/evidence/:id/verify',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
            sha256Hash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
            contentPayload: z.string().min(1).max(20000).optional(),
          }),
          req.body
        );
        if (!body.sha256Hash && !body.contentPayload) {
          throw new HttpError('Provide either sha256Hash or contentPayload to verify integrity.', 400, 'VERIFICATION_INPUT_REQUIRED');
        }
        const ev = dbStore.evidenceRecords.find((e) => e.id === req.params.id);
        if (!ev) throw new HttpError('Evidence record not found.', 404, 'EVIDENCE_NOT_FOUND');

        const candidateHash = body.sha256Hash
          ? body.sha256Hash.toLowerCase()
          : crypto.createHash('sha256').update(body.contentPayload!, 'utf8').digest('hex');
        const storedHash = String(ev.sha256_hash ?? '').trim().toLowerCase();
        const matched = Boolean(storedHash && candidateHash === storedHash);

        recordAudit(req, 'EVIDENCE_VERIFIED', 'EVIDENCE', ev.id, 200, { matched });
        res.json({
          success: true,
          data: {
            evidenceId: ev.id,
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

  // ---------------- REPORTS ----------------
  api.get('/reports/analytics', authenticate, authorizeOfficer, (_req, res) => {
    const statusMap = new Map<string, { status: string; count: number; total_amount: number }>();
    const fraudMap = new Map<string, { fraud_type: string; count: number; total_amount: number }>();
    for (const c of dbStore.complaints) {
      const s = statusMap.get(c.status) ?? { status: c.status, count: 0, total_amount: 0 };
      s.count++;
      s.total_amount += Number(c.reported_amount);
      statusMap.set(c.status, s);

      const f = fraudMap.get(c.fraud_type) ?? { fraud_type: c.fraud_type, count: 0, total_amount: 0 };
      f.count++;
      f.total_amount += Number(c.reported_amount);
      fraudMap.set(c.fraud_type, f);
    }

    const chMap = new Map<string, { channel: string; txn_count: number; total_amount: number }>();
    for (const t of dbStore.transactions) {
      const ch = chMap.get(t.channel) ?? { channel: t.channel, txn_count: 0, total_amount: 0 };
      ch.txn_count++;
      ch.total_amount += Number(t.amount);
      chMap.set(t.channel, ch);
    }

    const riskMap = new Map<string, { risk_level: string; count: number; sum: number }>();
    for (const ap of dbStore.atmPredictions) {
      const r = riskMap.get(ap.risk_level) ?? { risk_level: ap.risk_level, count: 0, sum: 0 };
      r.count++;
      r.sum += Number(ap.risk_score);
      riskMap.set(ap.risk_level, r);
    }

    const alMap = new Map<string, { status: string; severity: string; count: number }>();
    for (const al of dbStore.alerts) {
      const k = `${al.status}|${al.severity}`;
      const row = alMap.get(k) ?? { status: al.status, severity: al.severity, count: 0 };
      row.count++;
      alMap.set(k, row);
    }

    res.json({
      success: true,
      data: {
        summary: {
          total_complaints: dbStore.complaints.length,
          total_reported_loss: dbStore.complaints.reduce((s, c) => s + Number(c.reported_amount), 0),
          total_transactions: dbStore.transactions.length,
          flagged_accounts: dbStore.suspiciousAccounts.filter((s) => s.status !== 'CLEARED').length,
          frozen_accounts: dbStore.accounts.filter((a) => a.is_frozen).length,
          total_atm_forecasts: dbStore.atmPredictions.length,
          total_evidence_records: dbStore.evidenceRecords.length,
        },
        byComplaintStatus: Array.from(statusMap.values()),
        byFraudType: Array.from(fraudMap.values()),
        byChannel: Array.from(chMap.values()),
        byAtmRiskLevel: Array.from(riskMap.values()).map((r) => ({
          risk_level: r.risk_level,
          count: r.count,
          avg_score: Math.round((r.sum / Math.max(1, r.count)) * 10) / 10,
        })),
        byAlertStatus: Array.from(alMap.values()),
      },
    });
  });

  api.get(
    '/reports/export/csv',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res) => {
      const dataset = String(req.query.dataset || 'complaints');
      const complaintId = typeof req.query.complaintId === 'string' ? req.query.complaintId : undefined;
      let csv = '';

      if (dataset === 'transactions') {
        const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
        const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));
        const rows = dbStore.transactions
          .filter((t) => (!complaintId ? true : t.complaint_id === complaintId))
          .map((t) => ({
            txn_id: t.txn_id,
            complaint_number: t.complaint_id ? cmpMap.get(t.complaint_id)?.complaint_number ?? '' : '',
            from_account: accMap.get(t.from_account)?.account_number ?? t.from_account,
            from_holder: accMap.get(t.from_account)?.holder_name ?? '',
            to_account: accMap.get(t.to_account)?.account_number ?? t.to_account,
            to_holder: accMap.get(t.to_account)?.holder_name ?? '',
            amount: t.amount,
            currency: t.currency,
            channel: t.channel,
            hop_depth: t.hop_depth ?? '',
            is_flagged_fraud: t.is_flagged_fraud,
            timestamp: t.timestamp.toISOString(),
            remarks: t.remarks,
          }));
        csv = toCsv(
          ['txn_id', 'complaint_number', 'from_account', 'from_holder', 'to_account', 'to_holder', 'amount', 'currency', 'channel', 'hop_depth', 'is_flagged_fraud', 'timestamp', 'remarks'],
          rows
        );
      } else if (dataset === 'predictions') {
        const atmMap = new Map(dbStore.atms.map((a) => [a.id, a]));
        const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));
        const rows = dbStore.atmPredictions
          .filter((p) => (!complaintId ? true : p.complaint_id === complaintId))
          .map((p) => {
            const atm = atmMap.get(p.atm_id);
            return {
              complaint_number: cmpMap.get(p.complaint_id)?.complaint_number ?? '',
              rank_order: p.rank_order,
              atm_id: p.atm_id,
              bank: atm?.bank ?? '',
              locality: atm?.locality ?? '',
              city: atm?.city ?? 'Bengaluru',
              risk_score: p.risk_score,
              risk_level: p.risk_level,
              window: p.window,
              confidence: p.confidence,
              score_source: p.score_source,
              model_version: p.model_version,
              predicted_at: p.predicted_at,
            };
          });
        csv = toCsv(
          ['complaint_number', 'rank_order', 'atm_id', 'bank', 'locality', 'city', 'risk_score', 'risk_level', 'window', 'confidence', 'score_source', 'model_version', 'predicted_at'],
          rows
        );
      } else if (dataset === 'alerts') {
        const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));
        const rows = dbStore.alerts
          .filter((a) => (!complaintId ? true : a.complaint_id === complaintId))
          .map((a) => ({
            complaint_number: cmpMap.get(a.complaint_id)?.complaint_number ?? '',
            alert_type: a.alert_type,
            severity: a.severity,
            status: a.status,
            title: a.title,
            atm_id: a.atm_id ?? '',
            score_source: a.score_source,
            created_at: a.created_at,
          }));
        csv = toCsv(['complaint_number', 'alert_type', 'severity', 'status', 'title', 'atm_id', 'score_source', 'created_at'], rows);
      } else {
        const rows = dbStore.complaints
          .filter((c) => (!complaintId ? true : c.id === complaintId))
          .map((c) => {
            const v = dbStore.victims.find((x) => x.id === c.victim_id);
            return {
              complaint_number: c.complaint_number,
              fraud_type: c.fraud_type,
              reported_amount: c.reported_amount,
              currency: c.currency,
              status: c.status,
              priority: c.priority,
              city: c.city,
              victim_name: v?.full_name ?? '',
              victim_phone: v?.phone_masked ?? '',
              incident_timestamp: c.incident_timestamp.toISOString(),
              reported_at: c.reported_at.toISOString(),
            };
          });
        csv = toCsv(
          ['complaint_number', 'fraud_type', 'reported_amount', 'currency', 'status', 'priority', 'city', 'victim_name', 'victim_phone', 'incident_timestamp', 'reported_at'],
          rows
        );
      }

      recordAudit(req, 'REPORT_CSV_EXPORTED', 'REPORT', complaintId ?? dataset, 200, { dataset });
      const filename = `fintrace-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    }
  );

  api.get(
    '/reports/export/pdf/:complaintId',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (req: AuthedRequest, res, next) => {
      const cmp = dbStore.complaints.find((c) => c.id === req.params.complaintId);
      if (!cmp) {
        next(new HttpError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND'));
        return;
      }

      const victim = dbStore.victims.find((v) => v.id === cmp.victim_id);
      const inv = dbStore.investigations.find((i) => i.complaint_id === cmp.id);
      const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
      const atmMap = new Map(dbStore.atms.map((a) => [a.id, a]));
      const txns = dbStore.transactions.filter((t) => t.complaint_id === cmp.id);
      const susp = dbStore.suspiciousAccounts.filter((s) => s.complaint_id === cmp.id);
      const preds = dbStore.atmPredictions.filter((p) => p.complaint_id === cmp.id).sort((a, b) => a.rank_order - b.rank_order);
      const alerts = dbStore.alerts.filter((a) => a.complaint_id === cmp.id);
      const evids = dbStore.evidenceRecords.filter((e) => e.complaint_id === cmp.id);

      recordAudit(req, 'REPORT_PDF_EXPORTED', 'COMPLAINT', cmp.id, 200, { complaint_number: cmp.complaint_number });

      const doc = new PDFDocument({ margin: 46, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="fintrace-dossier-${cmp.complaint_number}.pdf"`);
        res.send(pdf);
      });

      doc.fontSize(17).fillColor('#0F172A').text('FINTRACE CYBERCRIME INTELLIGENCE DOSSIER');
      doc.fontSize(9).fillColor('#475569').text(
        `Complaint: ${cmp.complaint_number}  |  Generated: ${new Date().toISOString()}  |  Synthetic Demo Data: YES`
      );
      doc.moveDown(0.8);

      doc.fontSize(12).fillColor('#0F172A').text('1. Complaint & Victim Summary');
      doc.fontSize(9.5).fillColor('#1E293B');
      doc.text(`Victim: ${victim?.full_name ?? 'Unknown'} (${victim?.phone_masked ?? 'N/A'}) — ${victim?.city ?? cmp.city}`);
      doc.text(`Fraud Type: ${cmp.fraud_type}  |  Priority: ${cmp.priority}  |  Status: ${cmp.status}`);
      doc.text(`Reported Loss: INR ${Number(cmp.reported_amount).toLocaleString('en-IN')}`);
      doc.text(`Summary: ${cmp.summary}`);
      doc.moveDown(0.7);

      doc.fontSize(12).fillColor('#0F172A').text('2. Investigation Casework');
      doc.fontSize(9.5).fillColor('#1E293B');
      if (inv) {
        doc.text(`Case Number: ${inv.case_number}  |  Status: ${inv.status}`);
        doc.text(`Findings: ${inv.findings_summary ?? 'No findings recorded yet.'}`);
      } else {
        doc.text('No investigation record initialized yet.');
      }
      doc.moveDown(0.7);

      doc.fontSize(12).fillColor('#0F172A').text('3. Flagged Accounts & Attribution');
      doc.fontSize(9).fillColor('#1E293B');
      if (susp.length === 0) doc.text('No suspicious accounts flagged.');
      for (const s of susp) {
        const acc = accMap.get(s.account_id);
        doc.text(
          `• ${acc?.account_number ?? s.account_id} (${acc?.holder_name ?? ''}) | ${s.classification} | Frozen: ${acc?.is_frozen ? 'YES' : 'NO'} | Source: ${s.score_source}`
        );
      }
      doc.moveDown(0.7);

      doc.fontSize(12).fillColor('#0F172A').text('4. Predictive ATM Cash-Out Locations');
      doc.fontSize(9).fillColor('#1E293B');
      if (preds.length === 0) doc.text('No ATM forecasts generated for this complaint.');
      for (const p of preds) {
        const atm = atmMap.get(p.atm_id);
        doc.text(
          `#${p.rank_order} ${p.atm_id} (${atm?.bank ?? ''}, ${atm?.locality ?? ''}) | Risk: ${p.risk_score.toFixed(1)}/100 (${p.risk_level}) | Window: ${p.window} | Source: ${p.score_source}`
        );
      }
      doc.moveDown(0.7);

      doc.fontSize(12).fillColor('#0F172A').text(`5. Transaction Trail (${txns.length} rows)`);
      doc.fontSize(8.5).fillColor('#1E293B');
      for (const t of txns.slice(0, 40)) {
        doc.text(
          `${t.txn_id} | ${accMap.get(t.from_account)?.account_number ?? t.from_account} -> ${accMap.get(t.to_account)?.account_number ?? t.to_account} | INR ${Number(t.amount).toLocaleString('en-IN')} | ${t.channel}`
        );
      }
      doc.moveDown(0.7);

      doc.fontSize(12).fillColor('#0F172A').text('6. Alerts & Evidence Chain of Custody');
      doc.fontSize(8.5).fillColor('#1E293B');
      doc.text(`Alerts: ${alerts.length} | Evidence Artifacts: ${evids.length}`);
      for (const ev of evids) {
        doc.text(`• [${ev.evidence_type}] ${ev.title} | SHA-256: ${ev.sha256_hash}`);
      }

      doc.end();
    }
  );

  // ---------------- AUDIT LOGS ----------------
  api.get('/audit-logs', authenticate, authorizeRoles('Administrator', 'Senior Investigator'), (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const userMap = new Map(dbStore.users.map((u) => [u.id, u]));
    let rows = dbStore.auditLogs.map((al) => {
      const u = al.actor_user_id ? userMap.get(al.actor_user_id) : null;
      return { ...al, actor_email: u?.email ?? null, actor_name: u?.full_name ?? null };
    });
    if (q.action) rows = rows.filter((r) => r.action.toLowerCase().includes(q.action!.toLowerCase()));
    if (q.resourceType) rows = rows.filter((r) => r.resource_type === q.resourceType);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const offset = Math.max(0, Number(q.offset) || 0);
    res.json({ success: true, data: rows.slice(offset, offset + limit) });
  });

  // ---------------- AI INVESTIGATIVE ASSISTANT (GEMINI SERVER-SIDE) ----------------
  api.get(
    '/assistant/status',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    (_req, res) => {
      res.json({
        success: true,
        data: {
          configured: isGeminiConfigured(),
          model: GEMINI_MODEL,
        },
      });
    }
  );

  api.post(
    '/assistant/query',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator'),
    async (req: AuthedRequest, res, next) => {
      try {
        if (!isGeminiConfigured()) {
          throw new HttpError(
            'Gemini API key is not configured in environment secrets (GEMINI_API_KEY). Add it in Settings > Secrets to enable live AI briefings.',
            503,
            'GEMINI_NOT_CONFIGURED'
          );
        }

        const body = parseOrThrow(
          z.object({
            question: z.string().min(3).max(2000),
            complaintId: z.string().uuid().optional(),
            history: z
              .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) }))
              .max(8)
              .default([]),
          }),
          req.body
        );

        const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
        const atmMap = new Map(dbStore.atms.map((a) => [a.id, a]));
        let groundedScope = 'Global Operations Queue';
        let recordCounts: Record<string, number>;
        let groundingContext: Record<string, unknown>;

        if (body.complaintId) {
          const cmp = dbStore.complaints.find((c) => c.id === body.complaintId);
          if (!cmp) throw new HttpError('Referenced complaint not found.', 404, 'COMPLAINT_NOT_FOUND');

          const txns = dbStore.transactions.filter((t) => t.complaint_id === cmp.id).slice(0, 40);
          const susp = dbStore.suspiciousAccounts.filter((s) => s.complaint_id === cmp.id);
          const atmPreds = dbStore.atmPredictions.filter((p) => p.complaint_id === cmp.id);
          const alerts = dbStore.alerts.filter((a) => a.complaint_id === cmp.id);
          const evids = dbStore.evidenceRecords.filter((e) => e.complaint_id === cmp.id);

          groundedScope = cmp.complaint_number;
          recordCounts = {
            transactions: txns.length,
            suspiciousAccounts: susp.length,
            atmPredictions: atmPreds.length,
            alerts: alerts.length,
            evidence: evids.length,
          };
          groundingContext = {
            complaint: cmp,
            transactions: txns.map((t) => ({
              txn_id: t.txn_id,
              from_account: accMap.get(t.from_account)?.account_number,
              to_account: accMap.get(t.to_account)?.account_number,
              amount: t.amount,
              channel: t.channel,
              hop_depth: t.hop_depth,
              timestamp: t.timestamp.toISOString(),
            })),
            suspiciousAccounts: susp.map((s) => ({
              account_number: accMap.get(s.account_id)?.account_number,
              holder_name: accMap.get(s.account_id)?.holder_name,
              is_frozen: accMap.get(s.account_id)?.is_frozen,
              classification: s.classification,
              mule_probability: s.mule_probability,
              score_source: s.score_source,
              reason: s.reason,
            })),
            atmPredictions: atmPreds.map((p) => ({
              rank_order: p.rank_order,
              atm_id: p.atm_id,
              locality: atmMap.get(p.atm_id)?.locality,
              risk_score: p.risk_score,
              risk_level: p.risk_level,
              window: p.window,
              score_source: p.score_source,
              limitations_text: p.limitations_text,
            })),
            alerts,
            evidenceRecords: evids,
          };
        } else {
          const cmps = dbStore.complaints.slice(0, 12);
          const preds = [...dbStore.atmPredictions].sort((a, b) => b.risk_score - a.risk_score).slice(0, 12);
          const alerts = dbStore.alerts.slice(0, 15);
          const susp = dbStore.suspiciousAccounts.slice(0, 15);
          groundedScope = 'Global Operations Queue';
          recordCounts = {
            complaints: cmps.length,
            atmPredictions: preds.length,
            alerts: alerts.length,
            suspiciousAccounts: susp.length,
          };
          groundingContext = {
            recentComplaints: cmps,
            priorityAtmPredictions: preds.map((p) => ({
              atm_id: p.atm_id,
              locality: atmMap.get(p.atm_id)?.locality,
              risk_score: p.risk_score,
              risk_level: p.risk_level,
              window: p.window,
              score_source: p.score_source,
            })),
            recentAlerts: alerts,
            flaggedAccounts: susp.map((s) => ({
              account_number: accMap.get(s.account_id)?.account_number,
              classification: s.classification,
              mule_probability: s.mule_probability,
              score_source: s.score_source,
            })),
          };
        }

        const systemInstruction = [
          'You are the FinTrace Cybercrime Investigative Intelligence Assistant (Smart India Hackathon PS 26184).',
          'STRICT GROUNDING RULES:',
          '1. Answer ONLY using facts present in the JSON context provided below.',
          '2. Always cite exact identifiers when available: complaint_number, txn_id, account_number, atm_id.',
          '3. Always cite score_source ("Trained ML prediction", "Rule-based risk score", or "Synthetic demo result") and clarify that ATM risk_score (0-100) is a weighted risk score, NOT a calibrated probability.',
          '4. NEVER fabricate account numbers, UTRs, ATM IDs, or metrics. If absent from context, state clearly that it is not recorded.',
        ].join('\n');

        const historyText = body.history
          .map((h) => `${h.role === 'user' ? 'Investigator' : 'Assistant'}: ${h.text}`)
          .join('\n');

        const promptText = [
          `DATABASE CONTEXT (${groundedScope}):`,
          JSON.stringify(groundingContext),
          historyText ? `\nPRIOR CONVERSATION:\n${historyText}` : '',
          `\nINVESTIGATOR QUESTION:\n${body.question}`,
        ]
          .filter(Boolean)
          .join('\n');

        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: promptText,
          config: { systemInstruction },
        });
        const answer = response.text?.trim();
        if (!answer) {
          throw new HttpError('Gemini returned an empty response.', 502, 'GEMINI_EMPTY_RESPONSE');
        }

        recordAudit(req, 'ASSISTANT_QUERY_EXECUTED', 'ASSISTANT', body.complaintId ?? 'GLOBAL', 200, {
          model: GEMINI_MODEL,
          groundedScope,
        });
        res.json({
          success: true,
          data: {
            answer,
            model: GEMINI_MODEL,
            groundedScope,
            recordCounts,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ---------------- CITIZEN PORTAL (STRICT OWNERSHIP + DTO) ----------------
  const INCIDENT_TO_FRAUD: Record<
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

  const citizenCreateSchema = z.object({
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
    disputedTransactions: z
      .array(
        z.object({
          txnId: z.string().min(4).max(64),
          date: z.string().min(8),
          amount: z.coerce.number().positive(),
          beneficiaryAccount: z.string().min(4).max(64),
          beneficiaryBank: z.string().min(2).max(120),
          channel: z.enum(['UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET']).default('UPI'),
        })
      )
      .min(1)
      .max(25),
  });

  api.get('/citizen/complaints', authenticate, authorizeRoles('citizen'), (req: AuthedRequest, res) => {
    const q = req.query as Record<string, string | undefined>;
    let mine = dbStore.complaints.filter((c) => c.filed_by_user_id === req.user!.userId);
    if (q.citizenStatus) {
      mine = mine.filter((c) => c.citizen_status === q.citizenStatus);
    }
    if (q.search) {
      const s = q.search.toLowerCase();
      mine = mine.filter(
        (c) =>
          c.reference_no.toLowerCase().includes(s) ||
          c.summary.toLowerCase().includes(s) ||
          c.fraud_type.toLowerCase().includes(s)
      );
    }
    mine.sort((a, b) => b.reported_at.getTime() - a.reported_at.getTime());

    const data = mine.map((c) =>
      toCitizenComplaintSummaryDto({
        ...c,
        transaction_count: dbStore.transactions.filter((t) => t.complaint_id === c.id).length,
        document_count: dbStore.evidenceRecords.filter(
          (e) => e.complaint_id === c.id && e.is_citizen_visible !== false
        ).length,
      })
    );
    res.json({ success: true, data });
  });

  api.post('/citizen/complaints', authenticate, authorizeRoles('citizen'), (req: AuthedRequest, res, next) => {
    try {
      const body = parseOrThrow(citizenCreateSchema, req.body);
      const user = dbStore.users.find((u) => u.id === req.user!.userId);
      if (!user) throw new HttpError('Citizen profile not found.', 404, 'USER_NOT_FOUND');

      const incidentDate = new Date(body.incidentTimestamp);
      if (Number.isNaN(incidentDate.getTime())) {
        throw new HttpError('Invalid incidentTimestamp provided.', 400, 'VALIDATION_ERROR');
      }

      let victimId = user.victim_id ?? null;
      if (!victimId) {
        victimId = crypto.randomUUID();
        dbStore.victims.push({
          id: victimId,
          full_name: user.full_name,
          phone_masked: user.phone_masked ?? '+91-98XXX-XX000',
          email: user.email,
          city: body.city,
          state: 'Karnataka',
          home_lat: 12.9716,
          home_lng: 77.5946,
        });
        user.victim_id = victimId;
      }

      const nextNum = dbStore.complaints.length + 101;
      const year = new Date().getFullYear();
      const suffix = crypto.randomInt(10, 99);
      const complaintNumber = `CMP-${year}-${String(nextNum).padStart(4, '0')}`;
      const referenceNo = `FT-${year}-${String(nextNum).padStart(4, '0')}${suffix}`;
      const cmpId = crypto.randomUUID();
      const now = new Date();
      const nowIso = now.toISOString();
      const fraudType = INCIDENT_TO_FRAUD[body.incidentType] ?? 'OTHER';
      const priority = body.amountLost >= 500000 ? 'CRITICAL' : body.amountLost >= 100000 ? 'HIGH' : 'MEDIUM';

      const createdCmp = {
        id: cmpId,
        complaint_number: complaintNumber,
        reference_no: referenceNo,
        victim_id: victimId,
        filed_by_user_id: user.id,
        assigned_to: null,
        fraud_type: fraudType,
        reported_amount: body.amountLost,
        currency: 'INR',
        incident_timestamp: incidentDate,
        reported_at: now,
        status: 'REGISTERED' as const,
        citizen_status: 'Submitted' as CitizenStatus,
        priority: priority as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
        summary: body.description,
        city: body.city,
        victim_bank_name: body.victimBankName,
        victim_account_masked: maskAccountNumber(body.victimAccountNumber),
        is_synthetic: true,
        created_at: nowIso,
        updated_at: nowIso,
      };
      dbStore.complaints.unshift(createdCmp);

      dbStore.investigations.unshift({
        id: crypto.randomUUID(),
        case_number: `INV-BLR-${year}-${String(nextNum).padStart(3, '0')}`,
        complaint_id: cmpId,
        lead_investigator: null,
        status: 'OPEN',
        findings_summary: `Citizen portal intake (${referenceNo}) pending investigator review.`,
        recommended_actions: [],
        opened_at: nowIso,
        closed_at: null,
        updated_at: nowIso,
      });

      const defaultInstId = dbStore.institutions[0]?.id ?? 'inst-01';
      const ensureAccount = (acctNumRaw: string, holderName: string, isVictim: boolean) => {
        const clean = acctNumRaw.trim().toUpperCase().slice(0, 32);
        const existing = dbStore.accounts.find((a) => a.account_number.toUpperCase() === clean);
        if (existing) return existing;
        const createdAcc = {
          id: crypto.randomUUID(),
          account_number: clean,
          institution_id: defaultInstId,
          holder_name: holderName,
          account_type: (isVictim ? 'SAVINGS' : 'CURRENT') as 'SAVINGS' | 'CURRENT',
          ifsc_code: 'SYNS0001099',
          branch_city: body.city,
          branch_lat: 12.9716,
          branch_lng: 77.5946,
          kyc_verified: isVictim,
          account_age_days: isVictim ? 920 : 22,
          is_frozen: false,
        };
        dbStore.accounts.push(createdAcc);
        return createdAcc;
      };

      const victimAcc = ensureAccount(body.victimAccountNumber, user.full_name, true);
      for (const tx of body.disputedTransactions) {
        const benAcc = ensureAccount(tx.beneficiaryAccount, `${tx.beneficiaryBank} Beneficiary`, false);
        const txDate = new Date(tx.date);
        const validDate = Number.isNaN(txDate.getTime()) ? incidentDate : txDate;
        const cleanTxnId = tx.txnId.trim().slice(0, 64);
        if (!dbStore.transactions.some((existing) => existing.txn_id === cleanTxnId)) {
          dbStore.transactions.unshift({
            id: crypto.randomUUID(),
            txn_id: cleanTxnId,
            from_account: victimAcc.id,
            to_account: benAcc.id,
            amount: tx.amount,
            currency: 'INR',
            timestamp: validDate,
            channel: tx.channel,
            complaint_id: cmpId,
            hop_depth: 1,
            is_flagged_fraud: true,
            remarks: `Citizen intake disputed transfer (${tx.beneficiaryBank})`,
            is_synthetic: true,
          });
        }
      }

      dbStore.complaintStatusHistory.push({
        id: crypto.randomUUID(),
        complaint_id: cmpId,
        status: 'REGISTERED',
        citizen_status: 'Submitted',
        public_remark: `Complaint registered with reference ${referenceNo} and ${body.disputedTransactions.length} disputed transaction(s).`,
        internal_note: null,
        changed_by: user.id,
        changed_at: nowIso,
      });

      dbStore.alerts.unshift({
        id: crypto.randomUUID(),
        complaint_id: cmpId,
        account_id: null,
        atm_id: null,
        alert_type: 'HIGH_VALUE_HOP',
        severity: body.amountLost >= 500000 ? 'Critical' : body.amountLost >= 100000 ? 'High' : 'Medium',
        status: 'OPEN',
        title: `New Citizen Complaint Filed: ${referenceNo} (${fraudType})`,
        description: `Citizen portal intake for INR ${Number(body.amountLost).toLocaleString('en-IN')} across ${body.disputedTransactions.length} disputed transaction(s). Ready for graph trace and ML scoring.`,
        score_source: 'Rule-based risk score',
        acknowledged_by: null,
        acknowledged_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      });

      recordAudit(req, 'CITIZEN_COMPLAINT_SUBMITTED', 'COMPLAINT', cmpId, 201, {
        reference_no: referenceNo,
        reported_amount: body.amountLost,
        disputed_txn_count: body.disputedTransactions.length,
      });

      res.status(201).json({
        success: true,
        data: toCitizenComplaintSummaryDto({
          ...createdCmp,
          transaction_count: body.disputedTransactions.length,
          document_count: 0,
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  api.get('/citizen/complaints/:id', authenticate, authorizeRoles('citizen'), (req: AuthedRequest, res, next) => {
    const cmp = dbStore.complaints.find(
      (c) => c.id === req.params.id && c.filed_by_user_id === req.user!.userId
    );
    if (!cmp) {
      next(new HttpError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND'));
      return;
    }

    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
    const instMap = new Map(dbStore.institutions.map((i) => [i.id, i]));

    const txns = dbStore.transactions
      .filter((t) => t.complaint_id === cmp.id)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((t) => {
        const toAcc = accMap.get(t.to_account);
        const toInst = toAcc ? instMap.get(toAcc.institution_id) : null;
        return {
          txn_id: t.txn_id,
          timestamp: t.timestamp,
          amount: t.amount,
          channel: t.channel,
          to_account_number: toAcc?.account_number ?? t.to_account,
          beneficiary_bank: toInst?.name ?? 'Beneficiary Bank',
        };
      });

    const history = dbStore.complaintStatusHistory
      .filter((h) => h.complaint_id === cmp.id)
      .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime());

    const docs = dbStore.evidenceRecords
      .filter((e) => e.complaint_id === cmp.id && e.is_citizen_visible !== false)
      .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());

    res.json({
      success: true,
      data: toCitizenComplaintDetailDto(cmp, txns, history, docs),
    });
  });

  api.post(
    '/citizen/complaints/:id/evidence',
    authenticate,
    authorizeRoles('citizen'),
    citizenUpload.single('file'),
    (req: AuthedRequest, res, next) => {
      try {
        const cmp = dbStore.complaints.find(
          (c) => c.id === req.params.id && c.filed_by_user_id === req.user!.userId
        );
        if (!cmp) throw new HttpError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND');
        if (!req.file) {
          throw new HttpError('Evidence file (PNG, JPEG, WEBP, or PDF, max 5MB) is required.', 400, 'FILE_MISSING');
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
        const inv = dbStore.investigations.find((i) => i.complaint_id === cmp.id);
        const nowIso = new Date().toISOString();

        const created = {
          id: crypto.randomUUID(),
          investigation_id: inv?.id ?? null,
          complaint_id: cmp.id,
          uploaded_by: req.user!.userId,
          evidence_type: 'OTHER' as const,
          title,
          description,
          file_name: req.file.originalname,
          mime_type: req.file.mimetype,
          file_size: req.file.size,
          is_citizen_visible: true,
          sha256_hash: sha256Hash,
          metadata_json: { source: 'citizen_portal', sha256_hash: sha256Hash },
          recorded_at: nowIso,
        };
        dbStore.evidenceRecords.unshift(created);

        recordAudit(req, 'CITIZEN_EVIDENCE_UPLOADED', 'EVIDENCE', created.id, 201, {
          complaint_id: cmp.id,
          file_name: req.file.originalname,
          file_size: req.file.size,
        });

        res.status(201).json({
          success: true,
          data: {
            id: created.id,
            title: created.title,
            file_name: created.file_name,
            mime_type: created.mime_type,
            file_size: created.file_size,
            uploaded_at: created.recorded_at,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  api.get('/citizen/notifications', authenticate, authorizeRoles('citizen'), (req: AuthedRequest, res) => {
    const notifications = dbStore.citizenNotifications
      .filter((n) => n.user_id === req.user!.userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 30);
    const unreadCount = notifications.filter((n) => !n.is_read).length;
    res.json({
      success: true,
      data: { unreadCount, notifications },
    });
  });

  api.post('/citizen/notifications/read', authenticate, authorizeRoles('citizen'), (req: AuthedRequest, res) => {
    for (const n of dbStore.citizenNotifications) {
      if (n.user_id === req.user!.userId) n.is_read = true;
    }
    res.json({ success: true });
  });

  // API 404 & Error handler
  api.use((_req, _res, next) => {
    next(new HttpError('API endpoint not found.', 404, 'NOT_FOUND'));
  });

  api.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    const code = err instanceof HttpError ? err.code : 'INTERNAL_ERROR';
    res.status(status).json({
      success: false,
      error: {
        code,
        message: err.message || 'Internal server error',
      },
    });
  });

  return api;
}
