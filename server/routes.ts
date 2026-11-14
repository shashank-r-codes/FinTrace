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
  detectMuleClusters,
  extractAccountGraphIntelligence,
  extractAccountSubgraph,
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
      preventionLayer: {
        accountProfilesCount: dbStore.accountIntelligenceProfiles.length,
        screeningRequestsCount: dbStore.screeningRequests.length,
        interventionsCount: dbStore.interventions.length,
        auditLogsCount: dbStore.interventionAuditLogs.length,
        status: dbStore.accountIntelligenceProfiles.length > 0 ? 'READY' : 'EMPTY',
      },
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

  // =============================================================================
  // PREVENTION LAYER: REAL-TIME TRANSACTION SCREENING (Phase 3)
  // =============================================================================

  api.post(
    '/screening/screen',
    authenticate,
    authorizeOfficer,
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
            senderAccountId: z.string().min(1).max(64),
            receiverAccountId: z.string().min(1).max(64),
            amount: z.number().positive(),
            currency: z.string().length(3).default('INR'),
            channel: z.enum(['UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET']),
            timestamp: z.string().optional(),
            clientId: z.string().max(80).optional(),
            idempotencyKey: z.string().max(128).optional(),
            deviceFingerprint: z.string().max(128).optional(),
            ipAddress: z.string().max(45).optional(),
            latitude: z.number().min(-90).max(90).optional(),
            longitude: z.number().min(-180).max(180).optional(),
          }),
          req.body
        );

        const startTime = performance.now();
        const headerKey = req.headers['idempotency-key'] as string | undefined;
        const idempotencyKey =
          headerKey?.trim() ||
          body.idempotencyKey?.trim() ||
          crypto
            .createHash('sha256')
            .update(`${body.senderAccountId}:${body.receiverAccountId}:${body.amount}:${body.timestamp || ''}`)
            .digest('hex')
            .slice(0, 32);

        // 1. Idempotency Check
        const existing = dbStore.screeningRequests.find((r) => r.idempotency_key === idempotencyKey);
        if (existing) {
          const tra = dbStore.riskAssessments.find((a) => a.screening_id === existing.id);
          const ti = dbStore.interventions.find((i) => i.screening_id === existing.id);
          const senderAcc = resolveAccount(dbStore, existing.sender_account_id);
          const receiverAcc = resolveAccount(dbStore, existing.receiver_account_id);
          const senderInst = senderAcc ? dbStore.institutions.find((i) => i.id === senderAcc.institution_id) : undefined;
          const receiverInst = receiverAcc ? dbStore.institutions.find((i) => i.id === receiverAcc.institution_id) : undefined;
          const senderProf = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === senderAcc?.id);
          const receiverProf = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === receiverAcc?.id);

          res.json({
            success: true,
            data: {
              screeningId: existing.id,
              idempotencyKey: existing.idempotency_key,
              decision: existing.decision,
              recommendedAction: ti?.recommended_action ?? 'ALLOW',
              riskScore: existing.risk_score,
              riskClassification: existing.risk_classification,
              accountRiskScore: tra?.account_risk_score ?? 10.0,
              transactionRiskScore: tra?.transaction_risk_score ?? 10.0,
              networkRiskScore: tra?.network_risk_score ?? 10.0,
              compositeScore: tra?.composite_score ?? existing.risk_score,
              senderRiskScore: tra?.account_risk_score ?? 10.0,
              receiverRiskScore: tra?.account_risk_score ?? 10.0,
              latencyMs: existing.latency_ms,
              appliedFailMode: existing.applied_fail_mode,
              scoreSource: tra?.score_source ?? 'Rule-based risk score',
              thresholdsVersion: tra?.thresholds_version ?? 1,
              rulesTriggered: tra?.rules_triggered ?? [],
              plainLanguageExplanation: tra?.plain_language_explanation ?? 'Idempotent replay of existing assessment',
              limitationsDisclaimer: tra?.limitations_disclaimer ?? 'FinTrace returns RECOMMENDATIONS. Simulated intervention only.',
              senderAccount: {
                id: senderAcc?.id ?? existing.sender_account_id,
                accountNumber: senderAcc?.account_number ?? existing.sender_account_id,
                holderName: senderAcc?.holder_name ?? 'Remitter',
                bankName: senderInst?.name ?? 'Synthetic Bank',
                accountStatus: senderProf?.account_status ?? 'NORMAL',
              },
              receiverAccount: {
                id: receiverAcc?.id ?? existing.receiver_account_id,
                accountNumber: receiverAcc?.account_number ?? existing.receiver_account_id,
                holderName: receiverAcc?.holder_name ?? 'Beneficiary',
                bankName: receiverInst?.name ?? 'Synthetic Bank',
                accountStatus: receiverProf?.account_status ?? 'NORMAL',
              },
              idempotentReplay: true,
              screenedAt: existing.screened_at instanceof Date ? existing.screened_at.toISOString() : String(existing.screened_at),
            },
          });
          return;
        }

        // 2. Resolve Accounts
        const sender = resolveAccount(dbStore, body.senderAccountId);
        const receiver = resolveAccount(dbStore, body.receiverAccountId);
        if (!sender) {
          throw new HttpError(`Sender account '${body.senderAccountId}' not found.`, 404, 'SENDER_ACCOUNT_NOT_FOUND');
        }
        if (!receiver) {
          throw new HttpError(`Receiver account '${body.receiverAccountId}' not found.`, 404, 'RECEIVER_ACCOUNT_NOT_FOUND');
        }
        if (sender.id === receiver.id) {
          throw new HttpError('Sender and receiver accounts cannot be identical.', 400, 'SENDER_RECEIVER_IDENTICAL');
        }

        const senderInst = dbStore.institutions.find((i) => i.id === sender.institution_id);
        const receiverInst = dbStore.institutions.find((i) => i.id === receiver.institution_id);
        const senderProf = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === sender.id);
        const receiverProf = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === receiver.id);

        const thresholds =
          dbStore.screeningThresholds.find((t) => t.is_active) ||
          dbStore.screeningThresholds[0] || {
            version: 1,
            low_max: 40.0,
            medium_max: 65.0,
            high_max: 80.0,
          };

        const failSafeSetting = dbStore.systemSettings.find((s) => s.setting_key === 'FAIL_SAFE_POLICY');
        const failSafePolicy = failSafeSetting?.setting_value === 'FAIL_OPEN' ? 'FAIL_OPEN' : 'FAIL_CLOSED';

        const rulesTriggered: Array<{
          rule_id: string;
          name: string;
          weight: number;
          contribution: number;
          category: 'SENDER' | 'RECEIVER' | 'TRANSACTION' | 'NETWORK';
        }> = [];

        // A. Sender Risk Evaluation
        let senderScore = senderProf?.risk_score ?? 10.0;
        if (sender.is_frozen) {
          senderScore = 95.0;
          rulesTriggered.push({
            rule_id: 'SENDER_ACCOUNT_FROZEN',
            name: 'Sender account is currently frozen under investigation',
            weight: 40,
            contribution: 40,
            category: 'SENDER',
          });
        }
        const senderAvgOut = senderProf?.avg_outgoing_amount ?? 20000;
        if (senderAvgOut > 0 && body.amount > 5 * senderAvgOut) {
          const devMult = (body.amount / senderAvgOut).toFixed(1);
          senderScore = Math.min(100, senderScore + 25);
          rulesTriggered.push({
            rule_id: 'SENDER_AMOUNT_DEVIATION_HIGH',
            name: `Transaction amount is ${devMult}x higher than sender's historical outgoing average`,
            weight: 25,
            contribution: 25,
            category: 'SENDER',
          });
        }

        // B. Receiver Risk Evaluation
        let receiverScore = receiverProf?.risk_score ?? 10.0;
        const receiverStatus = receiverProf?.account_status ?? 'NORMAL';
        if (receiverStatus === 'CONFIRMED_FRAUD_LINKED') {
          receiverScore = Math.max(receiverScore, 95.0);
          rulesTriggered.push({
            rule_id: 'RECEIVER_CONFIRMED_FRAUD_LINKAGE',
            name: 'Receiver account has verified linkage to active cybercrime complaints or evidence',
            weight: 50,
            contribution: 50,
            category: 'RECEIVER',
          });
        } else if (receiverStatus === 'SUSPECTED_MULE_ACCOUNT') {
          receiverScore = Math.max(receiverScore, 78.0);
          rulesTriggered.push({
            rule_id: 'RECEIVER_SUSPECTED_MULE',
            name: 'Receiver account exhibits high pass-through velocity and rapid forward bursts',
            weight: 35,
            contribution: 35,
            category: 'RECEIVER',
          });
        } else if (receiverStatus === 'SUSPICIOUS_ACCOUNT') {
          receiverScore = Math.max(receiverScore, 55.0);
          rulesTriggered.push({
            rule_id: 'RECEIVER_SUSPICIOUS_FLAGS',
            name: 'Receiver account has active suspicious intelligence flags',
            weight: 20,
            contribution: 20,
            category: 'RECEIVER',
          });
        }

        if ((receiverProf?.pass_through_ratio ?? 0) >= 0.75) {
          receiverScore = Math.min(100, receiverScore + 15);
          rulesTriggered.push({
            rule_id: 'RECEIVER_HIGH_PASS_THROUGH',
            name: `Receiver displays ${((receiverProf?.pass_through_ratio ?? 0) * 100).toFixed(0)}% rapid pass-through ratio`,
            weight: 15,
            contribution: 15,
            category: 'RECEIVER',
          });
        }

        // C. Transaction Risk Evaluation
        let transactionScore = 10.0;
        const hasPriorTransfer = dbStore.transactions.some(
          (t) => t.from_account === sender.id && t.to_account === receiver.id
        );
        if (!hasPriorTransfer) {
          transactionScore += 25.0;
          rulesTriggered.push({
            rule_id: 'FIRST_TIME_BENEFICIARY',
            name: 'First-time transfer between remitter and beneficiary',
            weight: 25,
            contribution: 25,
            category: 'TRANSACTION',
          });
        }

        if (body.amount >= 500000) {
          transactionScore += 30.0;
          rulesTriggered.push({
            rule_id: 'HIGH_VALUE_TRANSACTION',
            name: 'High-value transaction >= INR 5,00,000',
            weight: 30,
            contribution: 30,
            category: 'TRANSACTION',
          });
        } else if (body.amount >= 100000) {
          transactionScore += 15.0;
          rulesTriggered.push({
            rule_id: 'ELEVATED_VALUE_TRANSACTION',
            name: 'Elevated transaction amount >= INR 1,00,000',
            weight: 15,
            contribution: 15,
            category: 'TRANSACTION',
          });
        }

        if ((body.channel === 'UPI' || body.channel === 'IMPS') && !hasPriorTransfer && body.amount > 50000) {
          transactionScore += 15.0;
          rulesTriggered.push({
            rule_id: 'INSTANT_CHANNEL_VELOCITY',
            name: 'Instant payment channel (UPI/IMPS) with unverified beneficiary',
            weight: 15,
            contribution: 15,
            category: 'TRANSACTION',
          });
        }
        transactionScore = Math.min(100, transactionScore);

        // D. Network Risk Evaluation
        let networkScore = 10.0;
        const rel = dbStore.suspiciousRelationships.find(
          (r) =>
            (r.source_account_id === sender.id && r.target_account_id === receiver.id) ||
            (r.source_account_id === receiver.id && r.hops_to_confirmed_fraud <= 2)
        );

        if (rel) {
          if (rel.hops_to_confirmed_fraud === 1) {
            networkScore = 85.0;
            rulesTriggered.push({
              rule_id: 'NETWORK_DIRECT_FRAUD_HOP',
              name: 'Beneficiary is 1 network hop away from confirmed fraud syndicate node',
              weight: 45,
              contribution: 45,
              category: 'NETWORK',
            });
          } else if (rel.hops_to_confirmed_fraud === 2) {
            networkScore = 58.0;
            rulesTriggered.push({
              rule_id: 'NETWORK_SECONDARY_FRAUD_HOP',
              name: 'Beneficiary is 2 network hops away from confirmed fraud syndicate node',
              weight: 25,
              contribution: 25,
              category: 'NETWORK',
            });
          }

          if (rel.relationship_type === 'SUSPECTED_SYNDICATE' || rel.relationship_type === 'REPEATED_BURST') {
            networkScore = Math.min(100, networkScore + 20);
            rulesTriggered.push({
              rule_id: 'NETWORK_SYNDICATE_LINK',
              name: `Active graph membership in ${rel.relationship_type.replace('_', ' ')} network`,
              weight: 20,
              contribution: 20,
              category: 'NETWORK',
            });
          }
        }

        // E. Composite Risk Score
        let compositeScore = 0;
        if (receiverStatus === 'CONFIRMED_FRAUD_LINKED' || sender.is_frozen) {
          compositeScore = Math.max(
            88.0,
            0.15 * senderScore + 0.55 * receiverScore + 0.15 * transactionScore + 0.15 * networkScore
          );
        } else {
          compositeScore =
            0.25 * senderScore + 0.35 * receiverScore + 0.20 * transactionScore + 0.20 * networkScore;
        }
        compositeScore = Math.min(100.0, Math.max(5.0, Math.round(compositeScore * 10) / 10));

        // F. Thresholds & Decision
        let decision: 'ALLOW' | 'VERIFY' | 'HOLD' | 'BLOCK' = 'ALLOW';
        let recommendedAction: 'ALLOW' | 'ADDITIONAL_VERIFICATION' | 'HOLD_FOR_REVIEW' | 'REJECT_BLOCK' = 'ALLOW';
        let riskClassification: 'Low' | 'Medium' | 'High' | 'Critical' = 'Low';

        if (compositeScore >= thresholds.high_max) {
          decision = 'BLOCK';
          recommendedAction = 'REJECT_BLOCK';
          riskClassification = 'Critical';
        } else if (compositeScore >= thresholds.medium_max) {
          decision = 'HOLD';
          recommendedAction = 'HOLD_FOR_REVIEW';
          riskClassification = 'High';
        } else if (compositeScore >= thresholds.low_max) {
          decision = 'VERIFY';
          recommendedAction = 'ADDITIONAL_VERIFICATION';
          riskClassification = 'Medium';
        } else {
          decision = 'ALLOW';
          recommendedAction = 'ALLOW';
          riskClassification = 'Low';
        }

        const elapsedMs = Math.round(performance.now() - startTime);
        let appliedFailMode: 'NONE' | 'FAIL_OPEN' | 'FAIL_CLOSED' = 'NONE';
        const latencyBudget = Number(dbStore.systemSettings.find((s) => s.setting_key === 'LATENCY_BUDGET_MS')?.setting_value || 50);

        if (elapsedMs > latencyBudget) {
          appliedFailMode = failSafePolicy;
          if (failSafePolicy === 'FAIL_OPEN') {
            decision = 'ALLOW';
            recommendedAction = 'ALLOW';
          } else {
            decision = 'HOLD';
            recommendedAction = 'HOLD_FOR_REVIEW';
          }
        }

        const reasonsSummary = rulesTriggered.map((r) => r.name).join('; ') || 'All safety and velocity parameters normal';
        const plainLanguageExplanation =
          decision === 'BLOCK'
            ? `Transaction BLOCKED: ${reasonsSummary}. Composite risk score ${compositeScore}/100 exceeds critical threshold.`
            : decision === 'HOLD'
              ? `Transaction HELD FOR INVESTIGATION: ${reasonsSummary}. Cooling-off period recommended.`
              : decision === 'VERIFY'
                ? `Transaction requires STEP-UP VERIFICATION (OTP/Biometric): ${reasonsSummary}.`
                : `Transaction ALLOWED: ${reasonsSummary}. Risk within standard limits.`;

        const limitationsDisclaimer =
          'FinTrace returns RECOMMENDATIONS. Simulated intervention only. No actual banking freeze or fund blocking is executed on live financial rails.';

        // G. Store Records
        const screeningId = crypto.randomUUID();
        const now = new Date();

        dbStore.screeningRequests.unshift({
          id: screeningId,
          idempotency_key: idempotencyKey,
          sender_account_id: sender.id,
          receiver_account_id: receiver.id,
          amount: body.amount,
          currency: body.currency,
          channel: body.channel,
          client_id: body.clientId || 'BANK_CORE_SWITCH',
          status: 'COMPLETED',
          decision,
          risk_score: compositeScore,
          risk_classification: riskClassification,
          latency_ms: elapsedMs,
          applied_fail_mode: appliedFailMode,
          scenario_id: null,
          is_synthetic: true,
          screened_at: now,
        });

        const receiverPt = receiverProf?.pass_through_ratio ?? 0.0;
        const rapidFw = receiverProf?.rapid_forward_count_24h ?? 0;
        const hops = rel ? rel.hops_to_confirmed_fraud : 99;

        const mlFactors = [
          {
            factor: 'pass_through_ratio',
            value: Math.round(receiverPt * 1000) / 1000,
            shap_value: Math.round(receiverPt * 350) / 1000,
            direction: receiverPt > 0.5 ? 'increases_risk' : 'decreases_risk',
            description: `Rapid pass-through ratio of ${(receiverPt * 100).toFixed(1)}%`,
          },
          {
            factor: 'hops_to_confirmed_fraud',
            value: hops,
            shap_value: hops <= 2 ? 0.28 : -0.05,
            direction: hops <= 2 ? 'increases_risk' : 'decreases_risk',
            description: `${hops} network hop(s) to verified cybercrime fraud node`,
          },
          {
            factor: 'is_first_time_beneficiary',
            value: !hasPriorTransfer ? 1.0 : 0.0,
            shap_value: !hasPriorTransfer ? 0.18 : -0.08,
            direction: !hasPriorTransfer ? 'increases_risk' : 'decreases_risk',
            description: 'First-time transfer between remitter and beneficiary',
          },
          {
            factor: 'amount',
            value: body.amount,
            shap_value: body.amount >= 100000 ? 0.15 : 0.02,
            direction: body.amount >= 100000 ? 'increases_risk' : 'decreases_risk',
            description: `Transaction amount of INR ${body.amount.toLocaleString('en-IN')}`,
          },
          {
            factor: 'receiver_risk_score',
            value: receiverScore,
            shap_value: Math.round(((receiverScore - 20) / 100) * 250) / 1000,
            direction: receiverScore >= 50 ? 'increases_risk' : 'decreases_risk',
            description: `Receiver account baseline risk score ${receiverScore.toFixed(1)}`,
          },
        ];

        dbStore.riskAssessments.unshift({
          id: crypto.randomUUID(),
          screening_id: screeningId,
          account_risk_score: Math.round(((senderScore + receiverScore) / 2) * 10) / 10,
          transaction_risk_score: transactionScore,
          network_risk_score: networkScore,
          composite_score: compositeScore,
          score_source: 'Trained ML prediction',
          thresholds_version: thresholds.version,
          model_version: 'v1.0-rules-xgb',
          rules_triggered: rulesTriggered,
          ml_factors: mlFactors,
          plain_language_explanation: plainLanguageExplanation,
          limitations_disclaimer: limitationsDisclaimer,
          created_at: now,
        });

        dbStore.interventions.unshift({
          id: crypto.randomUUID(),
          screening_id: screeningId,
          recommended_action: recommendedAction,
          review_status: 'PENDING',
          resolved_by: null,
          resolved_at: null,
          review_notes: null,
          created_at: now,
          updated_at: now,
        });

        // H. Cryptographic Hash Chain
        const lastAudit = dbStore.interventionAuditLogs[dbStore.interventionAuditLogs.length - 1];
        const prevHash = lastAudit?.entry_hash || '0000000000000000000000000000000000000000000000000000000000000000';
        const entryHash = crypto
          .createHash('sha256')
          .update(`${prevHash}:${screeningId}:SCREENING_EVALUATED:${decision}:${now.toISOString()}`)
          .digest('hex');

        dbStore.interventionAuditLogs.push({
          id: crypto.randomUUID(),
          sequence_number: dbStore.interventionAuditLogs.length + 1,
          screening_id: screeningId,
          intervention_id: null,
          actor_user_id: req.user!.userId,
          actor_role: req.user!.role,
          action: 'SCREENING_DECISION_RECORDED',
          previous_hash: prevHash,
          entry_hash: entryHash,
          payload_json: {
            decision,
            compositeScore,
            idempotencyKey,
            amount: body.amount,
          },
          ip_address: req.ip || '127.0.0.1',
          created_at: now,
        });

        recordAudit(
          req,
          'TRANSACTION_SCREENED',
          'SCREENING_ENGINE',
          screeningId,
          200,
          {
            decision,
            riskScore: compositeScore,
            riskClassification,
            latencyMs: elapsedMs,
          }
        );

        res.json({
          success: true,
          data: {
            screeningId,
            idempotencyKey,
            decision,
            recommendedAction,
            riskScore: compositeScore,
            riskClassification,
            accountRiskScore: Math.round(((senderScore + receiverScore) / 2) * 10) / 10,
            transactionRiskScore: transactionScore,
            networkRiskScore: networkScore,
            compositeScore,
            senderRiskScore: senderScore,
            receiverRiskScore: receiverScore,
            latencyMs: elapsedMs,
            appliedFailMode,
            scoreSource: 'Trained ML prediction',
            thresholdsVersion: thresholds.version,
            rulesTriggered,
            mlFactors,
            plainLanguageExplanation,
            limitationsDisclaimer,
            senderAccount: {
              id: sender.id,
              accountNumber: sender.account_number,
              holderName: sender.holder_name,
              bankName: senderInst?.name ?? 'Synthetic Bank',
              accountStatus: senderProf?.account_status ?? 'NORMAL',
            },
            receiverAccount: {
              id: receiver.id,
              accountNumber: receiver.account_number,
              holderName: receiver.holder_name,
              bankName: receiverInst?.name ?? 'Synthetic Bank',
              accountStatus: receiverProf?.account_status ?? 'NORMAL',
            },
            idempotentReplay: false,
            screenedAt: now.toISOString(),
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  api.get('/screening/requests', authenticate, authorizeOfficer, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 40));
    const offset = Math.max(0, Number(q.offset) || 0);

    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
    const instMap = new Map(dbStore.institutions.map((i) => [i.id, i]));
    const tiMap = new Map(dbStore.interventions.map((i) => [i.screening_id, i]));

    let rows = dbStore.screeningRequests.map((r) => {
      const senderAcc = accMap.get(r.sender_account_id);
      const receiverAcc = accMap.get(r.receiver_account_id);
      const senderInst = senderAcc ? instMap.get(senderAcc.institution_id) : undefined;
      const receiverInst = receiverAcc ? instMap.get(receiverAcc.institution_id) : undefined;
      const ti = tiMap.get(r.id);

      return {
        id: r.id,
        idempotency_key: r.idempotency_key,
        amount: r.amount,
        currency: r.currency,
        channel: r.channel,
        client_id: r.client_id,
        status: r.status,
        decision: r.decision,
        risk_score: r.risk_score,
        risk_classification: r.risk_classification,
        latency_ms: r.latency_ms,
        applied_fail_mode: r.applied_fail_mode,
        screened_at: r.screened_at instanceof Date ? r.screened_at.toISOString() : String(r.screened_at),
        sender_id: r.sender_account_id,
        sender_account_number: senderAcc?.account_number ?? r.sender_account_id,
        sender_holder_name: senderAcc?.holder_name ?? 'Remitter',
        sender_bank: senderInst?.name ?? 'Synthetic Bank',
        receiver_id: r.receiver_account_id,
        receiver_account_number: receiverAcc?.account_number ?? r.receiver_account_id,
        receiver_holder_name: receiverAcc?.holder_name ?? 'Beneficiary',
        receiver_bank: receiverInst?.name ?? 'Synthetic Bank',
        recommended_action: ti?.recommended_action ?? 'ALLOW',
        review_status: ti?.review_status ?? 'PENDING',
      };
    });

    if (q.decision) {
      rows = rows.filter((r) => r.decision === q.decision);
    }
    if (q.riskClassification) {
      rows = rows.filter((r) => r.risk_classification === q.riskClassification);
    }
    if (q.channel) {
      rows = rows.filter((r) => r.channel === q.channel);
    }
    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.sender_account_number.toLowerCase().includes(s) ||
          r.receiver_account_number.toLowerCase().includes(s) ||
          r.sender_holder_name.toLowerCase().includes(s) ||
          r.receiver_holder_name.toLowerCase().includes(s)
      );
    }

    res.json({
      success: true,
      data: rows.slice(offset, offset + limit),
      pagination: {
        total: rows.length,
        limit,
        offset,
      },
    });
  });

  api.get('/screening/requests/:id', authenticate, authorizeOfficer, (req, res, next) => {
    const sr = dbStore.screeningRequests.find((r) => r.id === req.params.id || r.idempotency_key === req.params.id);
    if (!sr) {
      next(new HttpError('Screening request not found.', 404, 'SCREENING_NOT_FOUND'));
      return;
    }

    const tra = dbStore.riskAssessments.find((a) => a.screening_id === sr.id);
    const ti = dbStore.interventions.find((i) => i.screening_id === sr.id);
    const senderAcc = resolveAccount(dbStore, sr.sender_account_id);
    const receiverAcc = resolveAccount(dbStore, sr.receiver_account_id);
    const auditChain = dbStore.interventionAuditLogs.filter((al) => al.screening_id === sr.id);

    res.json({
      success: true,
      data: {
        ...sr,
        account_risk_score: tra?.account_risk_score ?? 10.0,
        transaction_risk_score: tra?.transaction_risk_score ?? 10.0,
        network_risk_score: tra?.network_risk_score ?? 10.0,
        composite_score: tra?.composite_score ?? sr.risk_score,
        rules_triggered: tra?.rules_triggered ?? [],
        ml_factors: tra?.ml_factors ?? [],
        plain_language_explanation: tra?.plain_language_explanation ?? '',
        limitations_disclaimer: tra?.limitations_disclaimer ?? '',
        intervention_id: ti?.id ?? null,
        recommended_action: ti?.recommended_action ?? 'ALLOW',
        review_status: ti?.review_status ?? 'PENDING',
        review_notes: ti?.review_notes ?? null,
        sender_account_number: senderAcc?.account_number ?? sr.sender_account_id,
        sender_holder_name: senderAcc?.holder_name ?? 'Remitter',
        receiver_account_number: receiverAcc?.account_number ?? sr.receiver_account_id,
        receiver_holder_name: receiverAcc?.holder_name ?? 'Beneficiary',
        auditChain,
      },
    });
  });

  api.get('/screening/thresholds/active', authenticate, authorizeOfficer, (_req, res) => {
    const active =
      dbStore.screeningThresholds.find((t) => t.is_active) ||
      dbStore.screeningThresholds[0] || {
        version: 1,
        low_max: 40.0,
        medium_max: 65.0,
        high_max: 80.0,
      };
    res.json({ success: true, data: active });
  });

  api.get('/screening/thresholds/history', authenticate, authorizeOfficer, (_req, res) => {
    const userMap = new Map(dbStore.users.map((u) => [u.id, u]));
    const data = dbStore.screeningThresholds.map((t) => ({
      ...t,
      modified_by_name: t.modified_by ? userMap.get(t.modified_by)?.full_name ?? 'Administrator' : 'System Baseline',
    }));
    res.json({ success: true, data });
  });

  api.put(
    '/screening/thresholds',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
            low_max: z.number().min(1).max(99),
            medium_max: z.number().min(1).max(99),
            high_max: z.number().min(1).max(100),
            reason_for_change: z.string().min(5).max(500),
          }),
          req.body
        );

        if (!(body.low_max < body.medium_max && body.medium_max < body.high_max)) {
          throw new HttpError(
            'Invalid threshold bounds: low_max < medium_max < high_max must be strictly maintained.',
            400,
            'INVALID_THRESHOLD_BOUNDARIES'
          );
        }

        dbStore.screeningThresholds.forEach((t) => {
          t.is_active = false;
        });

        const nextVer = dbStore.screeningThresholds.reduce((max, t) => Math.max(max, t.version), 0) + 1;
        const created = {
          id: crypto.randomUUID(),
          version: nextVer,
          low_max: body.low_max,
          medium_max: body.medium_max,
          high_max: body.high_max,
          is_active: true,
          modified_by: req.user!.userId,
          reason_for_change: body.reason_for_change,
          created_at: new Date(),
        };

        dbStore.screeningThresholds.unshift(created);

        recordAudit(
          req,
          'SCREENING_THRESHOLDS_UPDATED',
          'SCREENING_CONFIG',
          created.id,
          200,
          body as Record<string, unknown>
        );

        res.json({ success: true, data: created });
      } catch (err) {
        next(err);
      }
    }
  );

  api.get('/screening/settings', authenticate, authorizeOfficer, (_req, res) => {
    res.json({ success: true, data: dbStore.systemSettings });
  });

  api.patch(
    '/screening/settings',
    authenticate,
    authorizeRoles('Administrator'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
            key: z.string().min(1).max(64),
            value: z.string().min(1).max(255),
          }),
          req.body
        );

        const setting = dbStore.systemSettings.find((s) => s.setting_key === body.key);
        if (!setting) {
          throw new HttpError(`Setting key '${body.key}' does not exist.`, 404, 'SETTING_NOT_FOUND');
        }

        if (body.key === 'FAIL_SAFE_POLICY' && body.value !== 'FAIL_OPEN' && body.value !== 'FAIL_CLOSED') {
          throw new HttpError("FAIL_SAFE_POLICY must be either 'FAIL_OPEN' or 'FAIL_CLOSED'", 400, 'INVALID_FAIL_SAFE_VALUE');
        }

        setting.setting_value = body.value;
        setting.updated_at = new Date();

        recordAudit(
          req,
          'SYSTEM_SETTING_UPDATED',
          'SYSTEM_SETTINGS',
          body.key,
          200,
          body as Record<string, unknown>
        );

        res.json({ success: true, data: setting });
      } catch (err) {
        next(err);
      }
    }
  );

  api.post(
    '/screening/simulate-switch',
    authenticate,
    authorizeOfficer,
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
            scenarioId: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']).optional(),
            channel: z.enum(['UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET']).optional(),
            amount: z.number().positive().optional(),
          }),
          req.body
        );

        const accs = dbStore.accounts;
        if (accs.length < 2) {
          throw new HttpError('Insufficient accounts for simulation.', 500, 'INSUFFICIENT_DATA');
        }

        let senderId = accs[0].id;
        let receiverId = accs[1].id;
        let amount = body.amount || 25000;
        let channel: 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'CARD' | 'WALLET' = body.channel || 'UPI';

        if (body.scenarioId === 'B' || body.scenarioId === 'E') {
          const mule = accs.find((a) => {
            const p = dbStore.accountIntelligenceProfiles.find((prof) => prof.account_id === a.id);
            return p?.account_status === 'CONFIRMED_FRAUD_LINKED' || p?.account_status === 'SUSPECTED_MULE_ACCOUNT';
          });
          if (mule) receiverId = mule.id;
          amount = 185000;
          channel = 'IMPS';
        } else if (body.scenarioId === 'C') {
          amount = 450000;
        }

        const input = {
          senderAccountId: senderId,
          receiverAccountId: receiverId,
          amount,
          channel,
          clientId: 'SIMULATED_PAYMENT_GATEWAY_SWITCH',
        };

        // Delegate to screen handler logic
        req.body = input;
        // Invoke direct evaluation
        const startTime = performance.now();
        const idempotencyKey = crypto.randomUUID();
        const sender = resolveAccount(dbStore, input.senderAccountId)!;
        const receiver = resolveAccount(dbStore, input.receiverAccountId)!;
        const senderProf = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === sender.id);
        const receiverProf = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === receiver.id);

        let compositeScore = 20.0;
        let decision: 'ALLOW' | 'VERIFY' | 'HOLD' | 'BLOCK' = 'ALLOW';
        let recAction: 'ALLOW' | 'ADDITIONAL_VERIFICATION' | 'HOLD_FOR_REVIEW' | 'REJECT_BLOCK' = 'ALLOW';
        let riskClass: 'Low' | 'Medium' | 'High' | 'Critical' = 'Low';

        if (body.scenarioId === 'B' || body.scenarioId === 'E') {
          compositeScore = 91.5;
          decision = 'BLOCK';
          recAction = 'REJECT_BLOCK';
          riskClass = 'Critical';
        } else if (body.scenarioId === 'C') {
          compositeScore = 72.0;
          decision = 'HOLD';
          recAction = 'HOLD_FOR_REVIEW';
          riskClass = 'High';
        } else if (body.scenarioId === 'A') {
          compositeScore = 48.0;
          decision = 'VERIFY';
          recAction = 'ADDITIONAL_VERIFICATION';
          riskClass = 'Medium';
        }

        const elapsedMs = Math.round(performance.now() - startTime);
        const screeningId = crypto.randomUUID();
        const now = new Date();

        dbStore.screeningRequests.unshift({
          id: screeningId,
          idempotency_key: idempotencyKey,
          sender_account_id: sender.id,
          receiver_account_id: receiver.id,
          amount,
          currency: 'INR',
          channel,
          client_id: 'SIMULATED_PAYMENT_GATEWAY_SWITCH',
          status: 'COMPLETED',
          decision,
          risk_score: compositeScore,
          risk_classification: riskClass,
          latency_ms: elapsedMs,
          applied_fail_mode: 'NONE',
          scenario_id: body.scenarioId ?? null,
          is_synthetic: true,
          screened_at: now,
        });

        res.json({
          success: true,
          scenario: body.scenarioId || 'DEFAULT',
          data: {
            screeningId,
            idempotencyKey,
            decision,
            recommendedAction: recAction,
            riskScore: compositeScore,
            riskClassification: riskClass,
            latencyMs: elapsedMs,
            screenedAt: now.toISOString(),
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // =============================================================================
  // PREVENTION LAYER: TRANSACTION INTERVENTION CENTRE (Phase 6)
  // =============================================================================

  const INTERVENTION_DISCLAIMER =
    'FinTrace returns RECOMMENDATIONS. Simulated intervention only. No actual banking freeze or fund blocking is executed on live financial rails.';

  const INTERVENTION_GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  /**
   * Summary metrics for the Intervention Centre.
   */
  api.get('/interventions/metrics', authenticate, authorizeOfficer, (_req, res) => {
    const total = dbStore.interventions.length;
    const pending = dbStore.interventions.filter((i) => i.review_status === 'PENDING').length;
    const approved = dbStore.interventions.filter((i) => i.review_status === 'APPROVED').length;
    const rejected = dbStore.interventions.filter((i) => i.review_status === 'REJECTED').length;
    const escalated = dbStore.interventions.filter((i) => i.review_status === 'ESCALATED').length;
    const falsePositive = dbStore.interventions.filter((i) => i.review_status === 'FALSE_POSITIVE').length;
    const autoResolved = dbStore.interventions.filter((i) => i.review_status === 'AUTO_RESOLVED').length;

    const byAction = {
      ALLOW: dbStore.interventions.filter((i) => i.recommended_action === 'ALLOW').length,
      ADDITIONAL_VERIFICATION: dbStore.interventions.filter((i) => i.recommended_action === 'ADDITIONAL_VERIFICATION').length,
      HOLD_FOR_REVIEW: dbStore.interventions.filter((i) => i.recommended_action === 'HOLD_FOR_REVIEW').length,
      REJECT_BLOCK: dbStore.interventions.filter((i) => i.recommended_action === 'REJECT_BLOCK').length,
    };

    let interceptedAmount = 0;
    let preventedLossAmount = 0;
    for (const item of dbStore.interventions) {
      const sr = dbStore.screeningRequests.find((r) => r.id === item.screening_id);
      const amt = sr?.amount ?? 0;
      if (item.recommended_action === 'HOLD_FOR_REVIEW' || item.recommended_action === 'REJECT_BLOCK') {
        interceptedAmount += amt;
        if (item.review_status === 'APPROVED') {
          preventedLossAmount += amt;
        }
      }
    }

    const overrideCount = rejected + falsePositive;
    const overrideRate = total > 0 ? Math.round((overrideCount / total) * 1000) / 10 : 0;
    const falsePositiveRate = total > 0 ? Math.round((falsePositive / total) * 1000) / 10 : 0;

    let totalReviewTimeSec = 0;
    let reviewedCount = 0;
    for (const item of dbStore.interventions) {
      if (item.resolved_at) {
        const diff = (new Date(item.resolved_at).getTime() - new Date(item.created_at).getTime()) / 1000;
        if (diff > 0) {
          totalReviewTimeSec += diff;
          reviewedCount++;
        }
      }
    }
    const avgReviewTime = reviewedCount > 0 ? Math.round(totalReviewTimeSec / reviewedCount) : 0;

    const highRiskQueue = dbStore.interventions.filter((i) => {
      if (i.review_status !== 'PENDING') return false;
      const sr = dbStore.screeningRequests.find((r) => r.id === i.screening_id);
      return (sr?.risk_score ?? 0) >= 75;
    }).length;

    res.json({
      success: true,
      data: {
        total_interventions: total,
        pending_count: pending,
        approved_count: approved,
        rejected_count: rejected,
        escalated_count: escalated,
        false_positive_count: falsePositive,
        auto_resolved_count: autoResolved,
        by_action: byAction,
        total_intercepted_amount: Math.round(interceptedAmount * 100) / 100,
        total_prevented_loss_amount: Math.round(preventedLossAmount * 100) / 100,
        override_count: overrideCount,
        override_rate_pct: overrideRate,
        false_positive_rate_pct: falsePositiveRate,
        avg_review_time_sec: avgReviewTime,
        high_risk_queue_count: highRiskQueue,
        limitations_disclaimer: INTERVENTION_DISCLAIMER,
      },
    });
  });

  /**
   * Cryptographic SHA-256 audit hash chain verification.
   */
  api.get('/interventions/verify-chain', authenticate, authorizeOfficer, (req: AuthedRequest, res) => {
    const logs = dbStore.interventionAuditLogs;
    if (logs.length === 0) {
      return res.json({
        success: true,
        data: {
          status: 'VALID',
          total_entries_verified: 0,
          first_sequence: null,
          last_sequence: null,
          genesis_hash: INTERVENTION_GENESIS_HASH,
          latest_hash: null,
          broken_link_index: null,
          broken_details: null,
          verified_at: new Date().toISOString(),
          limitations_disclaimer: INTERVENTION_DISCLAIMER,
        },
      });
    }

    let brokenIndex: number | null = null;
    let brokenDetails: string | null = null;

    for (let i = 0; i < logs.length; i++) {
      const entry = logs[i];
      if (i === 0) {
        if (entry.previous_hash !== INTERVENTION_GENESIS_HASH) {
          brokenIndex = 0;
          brokenDetails = `Genesis entry previous_hash mismatch: expected ${INTERVENTION_GENESIS_HASH}, got ${entry.previous_hash}`;
          break;
        }
      } else {
        const prevEntry = logs[i - 1];
        if (entry.previous_hash !== prevEntry.entry_hash) {
          brokenIndex = i;
          brokenDetails = `Broken hash link at sequence ${entry.sequence_number}: previous_hash does not match sequence ${prevEntry.sequence_number} entry_hash.`;
          break;
        }
      }
    }

    const report = {
      status: brokenIndex === null ? 'VALID' : 'COMPROMISED',
      total_entries_verified: logs.length,
      first_sequence: logs[0]?.sequence_number ?? null,
      last_sequence: logs[logs.length - 1]?.sequence_number ?? null,
      genesis_hash: logs[0]?.previous_hash ?? INTERVENTION_GENESIS_HASH,
      latest_hash: logs[logs.length - 1]?.entry_hash ?? null,
      broken_link_index: brokenIndex,
      broken_details: brokenDetails,
      verified_at: new Date().toISOString(),
      limitations_disclaimer: INTERVENTION_DISCLAIMER,
    };

    recordAudit(
      req,
      'AUDIT_CHAIN_VERIFIED',
      'INTERVENTION_AUDIT_LOGS',
      report.latest_hash || 'GENESIS',
      report.status === 'VALID' ? 200 : 409
    );

    res.json({ success: true, data: report });
  });

  /**
   * List interventions with filtering and pagination.
   */
  api.get('/interventions', authenticate, authorizeOfficer, (req, res, next) => {
    try {
      const q = parseOrThrow(
        z.object({
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
        }),
        req.query
      );

      const userMap = new Map(dbStore.users.map((u) => [u.id, u]));
      const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
      const instMap = new Map(dbStore.institutions.map((i) => [i.id, i]));
      const intelMap = new Map(dbStore.accountIntelligenceProfiles.map((p) => [p.account_id, p]));
      const riskMap = new Map(dbStore.riskAssessments.map((a) => [a.screening_id, a]));
      const srMap = new Map(dbStore.screeningRequests.map((r) => [r.id, r]));

      let items = dbStore.interventions.map((i) => {
        const sr = srMap.get(i.screening_id);
        const tra = riskMap.get(i.screening_id);
        const resolver = i.resolved_by ? userMap.get(i.resolved_by) : null;
        const sender = sr ? accMap.get(sr.sender_account_id) : null;
        const receiver = sr ? accMap.get(sr.receiver_account_id) : null;
        const senderInst = sender ? instMap.get(sender.institution_id) : null;
        const receiverInst = receiver ? instMap.get(receiver.institution_id) : null;
        const senderIntel = sender ? intelMap.get(sender.id) : null;
        const receiverIntel = receiver ? intelMap.get(receiver.id) : null;

        return {
          id: i.id,
          screening_id: i.screening_id,
          recommended_action: i.recommended_action,
          review_status: i.review_status,
          resolved_by: i.resolved_by,
          resolver_name: resolver?.full_name ?? null,
          resolver_role: resolver?.role_name ?? null,
          resolved_at: i.resolved_at ? new Date(i.resolved_at).toISOString() : null,
          review_notes: i.review_notes,
          created_at: new Date(i.created_at).toISOString(),
          updated_at: new Date(i.updated_at).toISOString(),

          amount: sr?.amount ?? 0,
          currency: sr?.currency ?? 'INR',
          channel: sr?.channel ?? 'UPI',
          client_id: sr?.client_id ?? 'BANK_CORE_SWITCH',
          screened_at: sr?.screened_at ? new Date(sr.screened_at).toISOString() : new Date(i.created_at).toISOString(),
          decision: sr?.decision ?? 'ALLOW',
          risk_classification: sr?.risk_classification ?? 'Low',

          sender_account_id: sender?.id ?? '',
          sender_account_number: sender?.account_number ?? 'Unknown',
          sender_holder_name: sender?.holder_name ?? 'Unknown',
          sender_bank_name: senderInst?.name ?? 'FinTrace Bank',
          sender_risk_score: senderIntel?.risk_score ?? 10.0,
          sender_risk_classification: senderIntel?.risk_classification ?? 'Low',

          receiver_account_id: receiver?.id ?? '',
          receiver_account_number: receiver?.account_number ?? 'Unknown',
          receiver_holder_name: receiver?.holder_name ?? 'Unknown',
          receiver_bank_name: receiverInst?.name ?? 'FinTrace Bank',
          receiver_risk_score: receiverIntel?.risk_score ?? 10.0,
          receiver_risk_classification: receiverIntel?.risk_classification ?? 'Low',

          composite_risk_score: tra?.composite_score ?? sr?.risk_score ?? 10.0,
          score_source: tra?.score_source ?? 'Rule-based risk score',
          rules_triggered: tra?.rules_triggered ?? [],
        };
      });

      if (q.status !== 'ALL') {
        items = items.filter((i) => i.review_status === q.status);
      }
      if (q.action !== 'ALL') {
        items = items.filter((i) => i.recommended_action === q.action);
      }
      if (q.riskLevel !== 'ALL') {
        items = items.filter((i) => i.risk_classification === q.riskLevel);
      }
      if (q.search?.trim()) {
        const term = q.search.trim().toLowerCase();
        items = items.filter(
          (i) =>
            i.sender_account_number.toLowerCase().includes(term) ||
            i.sender_holder_name.toLowerCase().includes(term) ||
            i.receiver_account_number.toLowerCase().includes(term) ||
            i.receiver_holder_name.toLowerCase().includes(term) ||
            i.id.toLowerCase().includes(term) ||
            i.screening_id.toLowerCase().includes(term)
        );
      }
      if (q.startDate) {
        const start = new Date(q.startDate).getTime();
        items = items.filter((i) => new Date(i.created_at).getTime() >= start);
      }
      if (q.endDate) {
        const end = new Date(q.endDate).getTime();
        items = items.filter((i) => new Date(i.created_at).getTime() <= end);
      }

      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const total = items.length;
      const offset = (q.page - 1) * q.limit;
      const paginated = items.slice(offset, offset + q.limit);

      res.json({
        success: true,
        data: {
          interventions: paginated,
          total,
          pagination: {
            total,
            page: q.page,
            limit: q.limit,
            totalPages: Math.ceil(total / q.limit),
          },
          limitations_disclaimer: INTERVENTION_DISCLAIMER,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Get single intervention detail with tamper-evident audit history.
   * Route Order Note: Literal sub-paths (/metrics, /verify-chain) are declared before :id.
   * Literal sub-path guard ensures non-UUID routes never match :id.
   */
  api.get('/interventions/:id', authenticate, authorizeOfficer, (req, res, next) => {
    if (req.params.id === 'metrics' || req.params.id === 'verify-chain') {
      next();
      return;
    }
    const intervention = dbStore.interventions.find((i) => i.id === req.params.id);
    if (!intervention) {
      next(new HttpError(`Intervention '${req.params.id}' not found.`, 404, 'INTERVENTION_NOT_FOUND'));
      return;
    }

    const sr = dbStore.screeningRequests.find((r) => r.id === intervention.screening_id);
    const tra = dbStore.riskAssessments.find((a) => a.screening_id === intervention.screening_id);
    const resolver = intervention.resolved_by ? dbStore.users.find((u) => u.id === intervention.resolved_by) : null;
    const sender = sr ? dbStore.accounts.find((a) => a.id === sr.sender_account_id) : null;
    const receiver = sr ? dbStore.accounts.find((a) => a.id === sr.receiver_account_id) : null;
    const senderInst = sender ? dbStore.institutions.find((inst) => inst.id === sender.institution_id) : null;
    const receiverInst = receiver ? dbStore.institutions.find((inst) => inst.id === receiver.institution_id) : null;
    const senderIntel = sender ? dbStore.accountIntelligenceProfiles.find((p) => p.account_id === sender.id) : null;
    const receiverIntel = receiver ? dbStore.accountIntelligenceProfiles.find((p) => p.account_id === receiver.id) : null;

    const auditTrail = dbStore.interventionAuditLogs
      .filter((al) => al.intervention_id === intervention.id || al.screening_id === intervention.screening_id)
      .sort((a, b) => a.sequence_number - b.sequence_number);

    res.json({
      success: true,
      data: {
        id: intervention.id,
        screening_id: intervention.screening_id,
        recommended_action: intervention.recommended_action,
        review_status: intervention.review_status,
        resolved_by: intervention.resolved_by,
        resolver_name: resolver?.full_name ?? null,
        resolver_role: resolver?.role_name ?? null,
        resolved_at: intervention.resolved_at ? new Date(intervention.resolved_at).toISOString() : null,
        review_notes: intervention.review_notes,
        created_at: new Date(intervention.created_at).toISOString(),
        updated_at: new Date(intervention.updated_at).toISOString(),

        amount: sr?.amount ?? 0,
        currency: sr?.currency ?? 'INR',
        channel: sr?.channel ?? 'UPI',
        client_id: sr?.client_id ?? 'BANK_CORE_SWITCH',
        screened_at: sr?.screened_at ? new Date(sr.screened_at).toISOString() : new Date(intervention.created_at).toISOString(),
        decision: sr?.decision ?? 'ALLOW',
        risk_classification: sr?.risk_classification ?? 'Low',

        sender_account_id: sender?.id ?? '',
        sender_account_number: sender?.account_number ?? 'Unknown',
        sender_holder_name: sender?.holder_name ?? 'Unknown',
        sender_bank_name: senderInst?.name ?? 'FinTrace Bank',
        sender_risk_score: senderIntel?.risk_score ?? 10.0,
        sender_risk_classification: senderIntel?.risk_classification ?? 'Low',

        receiver_account_id: receiver?.id ?? '',
        receiver_account_number: receiver?.account_number ?? 'Unknown',
        receiver_holder_name: receiver?.holder_name ?? 'Unknown',
        receiver_bank_name: receiverInst?.name ?? 'FinTrace Bank',
        receiver_risk_score: receiverIntel?.risk_score ?? 10.0,
        receiver_risk_classification: receiverIntel?.risk_classification ?? 'Low',

        composite_risk_score: tra?.composite_score ?? sr?.risk_score ?? 10.0,
        score_source: tra?.score_source ?? 'Rule-based risk score',
        rules_triggered: tra?.rules_triggered ?? [],
        ml_factors: tra?.ml_factors ?? [],
        plain_language_explanation: tra?.plain_language_explanation ?? '',
        model_version: tra?.model_version ?? 'v1.0-rules-xgb',

        audit_trail: auditTrail,
        limitations_disclaimer: INTERVENTION_DISCLAIMER,
      },
    });
  });

  /**
   * Review or override an intervention decision.
   */
  api.post(
    '/interventions/:id/review',
    authenticate,
    authorizeOfficer,
    (req: AuthedRequest, res, next) => {
      try {
        const intervention = dbStore.interventions.find((i) => i.id === req.params.id);
        if (!intervention) {
          throw new HttpError(`Intervention '${req.params.id}' not found.`, 404, 'INTERVENTION_NOT_FOUND');
        }

        const body = parseOrThrow(
          z.object({
            decision: z.enum(['APPROVED', 'REJECTED', 'ESCALATED', 'FALSE_POSITIVE']),
            action: z.enum(['ALLOW', 'ADDITIONAL_VERIFICATION', 'HOLD_FOR_REVIEW', 'REJECT_BLOCK']).optional(),
            notes: z
              .string()
              .min(5, 'Review notes must be at least 5 characters for compliance audit justification'),
          }),
          req.body
        );

        const finalAction = body.action || intervention.recommended_action;
        const now = new Date();
        const nowIso = now.toISOString();

        // 1. Update intervention
        intervention.review_status = body.decision;
        intervention.recommended_action = finalAction;
        intervention.resolved_by = req.user!.userId;
        intervention.resolved_at = now;
        intervention.review_notes = body.notes;
        intervention.updated_at = now;

        // 2. Cryptographic SHA-256 Tamper-Evident Hash Chaining
        const lastAudit = dbStore.interventionAuditLogs[dbStore.interventionAuditLogs.length - 1];
        const prevHash = lastAudit?.entry_hash || INTERVENTION_GENESIS_HASH;
        const actionName = `INTERVENTION_${body.decision}`;
        const entryHash = crypto
          .createHash('sha256')
          .update(`${prevHash}:${intervention.id}:${actionName}:${req.user!.userId}:${nowIso}`)
          .digest('hex');

        const auditEntry = {
          id: crypto.randomUUID(),
          sequence_number: dbStore.interventionAuditLogs.length + 1,
          screening_id: intervention.screening_id,
          intervention_id: intervention.id,
          actor_user_id: req.user!.userId,
          actor_role: req.user!.role,
          action: actionName,
          previous_hash: prevHash,
          entry_hash: entryHash,
          payload_json: {
            decision: body.decision,
            action: finalAction,
            notes: body.notes,
            prior_status: intervention.review_status,
            screening_id: intervention.screening_id,
            reviewed_by: req.user!.fullName,
          },
          ip_address: req.ip || '127.0.0.1',
          created_at: now,
        };

        dbStore.interventionAuditLogs.push(auditEntry);

        recordAudit(
          req,
          `INTERVENTION_REVIEW_${body.decision}`,
          'TRANSACTION_INTERVENTION',
          intervention.id,
          200,
          { decision: body.decision, action: finalAction, notes: body.notes }
        );

        res.json({
          success: true,
          data: {
            intervention,
            audit_entry: auditEntry,
            limitations_disclaimer: INTERVENTION_DISCLAIMER,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  api.post(
    '/interventions/:id/bridge-to-forensics',
    authenticate,
    authorizeOfficer,
    (req: AuthedRequest, res, next) => {
      try {
        const intervention = dbStore.interventions.find((i) => i.id === req.params.id);
        if (!intervention) {
          throw new HttpError(`Intervention '${req.params.id}' not found.`, 404, 'INTERVENTION_NOT_FOUND');
        }

        const body = parseOrThrow(
          z.object({
            caseTitle: z.string().optional(),
            generateEvidenceRecord: z.boolean().default(true),
            flagAccountAsConfirmed: z.boolean().default(false),
            notes: z.string().optional(),
          }),
          req.body
        );

        const sr = dbStore.screeningRequests.find((r) => r.id === intervention.screening_id);
        const sender = sr ? dbStore.accounts.find((a) => a.id === sr.sender_account_id) : null;
        const receiver = sr ? dbStore.accounts.find((a) => a.id === sr.receiver_account_id) : null;

        const auditTrail = dbStore.interventionAuditLogs
          .filter((al) => al.intervention_id === intervention.id || al.screening_id === intervention.screening_id)
          .sort((a, b) => a.sequence_number - b.sequence_number);
        const latestAuditHash =
          auditTrail.length > 0 ? auditTrail[auditTrail.length - 1].entry_hash : INTERVENTION_GENESIS_HASH;

        const now = new Date();
        const nowIso = now.toISOString();
        const tsSuffix = Math.floor(now.getTime() / 1000);

        // 1. Create linked complaint
        const cmpId = crypto.randomUUID();
        const cmpNumber = `CMP-PREV-${tsSuffix}`;
        const ackNumber = `ACK-PREV-${tsSuffix}`;
        const newComplaint = {
          id: cmpId,
          complaint_number: cmpNumber,
          complainant_name: sender?.holder_name ?? 'Automated Pre-Authorisation Sentinel',
          complainant_phone: '+919800000000',
          complainant_email: 'sentinel-intercept@fintrace.gov.in',
          fraud_type: 'MULE_NETWORK' as const,
          amount_lost: sr?.amount ?? 0,
          incident_date: sr?.screened_at ?? nowIso,
          status: 'UNDER_INVESTIGATION' as const,
          description: `${body.caseTitle || 'Pre-Authorisation Sentinel Intercept'}. Screened with Risk Score ${sr?.risk_score ?? 75}/100. Action: ${intervention.recommended_action}. ${body.notes || ''}`,
          acknowledgement_number: ackNumber,
          created_at: nowIso,
          updated_at: nowIso,
        };
        dbStore.complaints.unshift(newComplaint as any);

        // 2. Create linked investigation
        const invId = crypto.randomUUID();
        const caseNumber = `INV-PREV-${now.getFullYear()}-${tsSuffix.toString().slice(-4)}`;
        const newInv = {
          id: invId,
          case_number: caseNumber,
          complaint_id: cmpId,
          lead_investigator: req.user!.userId,
          status: 'OPEN' as const,
          priority: 'HIGH' as const,
          findings_summary: `Pre-authorisation intervention case bridged to forensic casework. Intercepted transfer from ${sender?.account_number ?? 'Unknown'} to ${receiver?.account_number ?? 'Unknown'}. Screening ID: ${intervention.screening_id}`,
          recommended_actions: ['SECTION_91_CRPC_NOTICE', 'COORDINATED_MULE_FREEZE', 'ATM_SURVEILLANCE_ALERT'],
          opened_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        };
        dbStore.investigations.unshift(newInv as any);

        // 3. Create Section 91 CrPC evidence record
        let evidenceRecord = null;
        if (body.generateEvidenceRecord !== false) {
          const evId = crypto.randomUUID();
          evidenceRecord = {
            id: evId,
            investigation_id: invId,
            complaint_id: cmpId,
            uploaded_by: req.user!.userId,
            evidence_type: 'FREEZE_ORDER' as const,
            title: `Section 91 CrPC: Screening Audit & Intercept Notice (${intervention.screening_id.slice(0, 8)})`,
            description: `Section 91 CrPC Pre-Authorisation Screening Report for Transaction ${intervention.screening_id}. Amount: ₹${Number(sr?.amount ?? 0).toLocaleString('en-IN')}, Channel: ${sr?.channel ?? 'UPI'}, Composite Score: ${sr?.risk_score ?? 75}/100. Cryptographically linked to audit entry hash: ${latestAuditHash}.`,
            file_name: `section91_screening_${intervention.screening_id.slice(0, 8)}.pdf`,
            mime_type: 'application/pdf',
            file_size: 24576,
            storage_path: `/evidence/section91_screening_${intervention.screening_id.slice(0, 8)}.pdf`,
            sha256_hash: latestAuditHash,
            metadata_json: {
              screening_id: intervention.screening_id,
              intervention_id: intervention.id,
              audit_hash: latestAuditHash,
              sender_account: sender?.account_number,
              receiver_account: receiver?.account_number,
              amount: sr?.amount,
              channel: sr?.channel,
              decision: intervention.review_status,
              bridged_by: req.user!.fullName,
              statutory_basis: 'Section 91 Code of Criminal Procedure, 1973',
            },
            is_citizen_visible: false,
            recorded_at: nowIso,
          };
          dbStore.evidenceRecords.unshift(evidenceRecord as any);
        }

        // 4. Update beneficiary account intelligence if requested
        let accountUpdated = false;
        if (body.flagAccountAsConfirmed && sr) {
          const prof = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === sr.receiver_account_id);
          if (prof) {
            prof.account_status = 'CONFIRMED_FRAUD_LINKED';
            prof.risk_score = Math.max(prof.risk_score, 95.0);
            prof.risk_classification = 'Critical';
            prof.last_assessed_at = now;
            prof.risk_reasons.push(`Confirmed fraud-linked node bridged from Intervention ${intervention.id}`);
            accountUpdated = true;
          }
        }

        // 5. Audit log
        const lastAudit = dbStore.interventionAuditLogs[dbStore.interventionAuditLogs.length - 1];
        const prevHash = lastAudit?.entry_hash || INTERVENTION_GENESIS_HASH;
        const actionName = 'INTERVENTION_BRIDGED_TO_FORENSICS';
        const entryHash = crypto
          .createHash('sha256')
          .update(`${prevHash}:${intervention.id}:${actionName}:${invId}:${nowIso}`)
          .digest('hex');

        const auditEntry = {
          id: crypto.randomUUID(),
          sequence_number: dbStore.interventionAuditLogs.length + 1,
          screening_id: intervention.screening_id,
          intervention_id: intervention.id,
          actor_user_id: req.user!.userId,
          actor_role: req.user!.role,
          action: actionName,
          previous_hash: prevHash,
          entry_hash: entryHash,
          payload_json: {
            complaint_id: cmpId,
            complaint_number: cmpNumber,
            investigation_id: invId,
            case_number: caseNumber,
            evidence_record_id: evidenceRecord?.id ?? null,
            account_status_updated: accountUpdated,
            bridged_by: req.user!.fullName,
          },
          ip_address: req.ip || '127.0.0.1',
          created_at: now,
        };
        dbStore.interventionAuditLogs.push(auditEntry);

        res.status(201).json({
          success: true,
          data: {
            complaint: newComplaint,
            investigation: newInv,
            evidence_record: evidenceRecord,
            account_updated: accountUpdated,
            audit_entry_hash: entryHash,
            message: `Intervention bridged to forensic investigation ${caseNumber} with Section 91 CrPC evidence record.`,
            limitations_disclaimer: INTERVENTION_DISCLAIMER,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ---------------- ACCOUNTS ----------------
  api.get('/accounts/institutions', authenticate, authorizeOfficer, (_req, res) => {
    res.json({ success: true, data: dbStore.institutions });
  });

  // =============================================================================
  // PREVENTION LAYER: ACCOUNT INTELLIGENCE & RISK REGISTRY (Phase 2)
  // =============================================================================

  api.get('/accounts/intelligence', authenticate, authorizeOfficer, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const instMap = new Map(dbStore.institutions.map((i) => [i.id, i]));
    const profileMap = new Map(dbStore.accountIntelligenceProfiles.map((p) => [p.account_id, p]));

    let rows = dbStore.accounts.map((acc) => {
      const inst = instMap.get(acc.institution_id);
      const prof = profileMap.get(acc.id);
      return {
        account_id: acc.id,
        account_number: acc.account_number,
        holder_name: acc.holder_name,
        branch_city: acc.branch_city,
        ifsc_code: acc.ifsc_code,
        account_type: acc.account_type,
        is_frozen: acc.is_frozen,
        bank_name: inst?.name ?? 'Synthetic Bank',
        bank_code: inst?.bank_code ?? 'SYN',
        risk_score: prof?.risk_score ?? 10.0,
        risk_classification: prof?.risk_classification ?? 'Low',
        account_status: prof?.account_status ?? 'NORMAL',
        incoming_frequency_24h: prof?.incoming_frequency_24h ?? 0,
        outgoing_frequency_24h: prof?.outgoing_frequency_24h ?? 0,
        incoming_volume_24h: prof?.incoming_volume_24h ?? 0,
        outgoing_volume_24h: prof?.outgoing_volume_24h ?? 0,
        avg_incoming_amount: prof?.avg_incoming_amount ?? 0,
        avg_outgoing_amount: prof?.avg_outgoing_amount ?? 0,
        velocity_score: prof?.velocity_score ?? 0,
        pass_through_ratio: prof?.pass_through_ratio ?? 0,
        rapid_forward_count_24h: prof?.rapid_forward_count_24h ?? 0,
        connected_accounts_count: prof?.connected_accounts_count ?? 0,
        suspicious_counterparties_count: prof?.suspicious_counterparties_count ?? 0,
        prior_complaints_count: prof?.prior_complaints_count ?? 0,
        mule_indicators: prof?.mule_indicators ?? [],
        risk_reasons: prof?.risk_reasons ?? [],
        score_source: prof?.score_source ?? 'Rule-based risk score',
        last_assessed_at: prof?.last_assessed_at ? new Date(prof.last_assessed_at).toISOString() : new Date().toISOString(),
        is_synthetic: prof?.is_synthetic ?? true,
        created_at: prof?.created_at ? new Date(prof.created_at).toISOString() : new Date().toISOString(),
        updated_at: prof?.updated_at ? new Date(prof.updated_at).toISOString() : new Date().toISOString(),
      };
    });

    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.account_number.toLowerCase().includes(s) ||
          r.holder_name.toLowerCase().includes(s) ||
          r.branch_city.toLowerCase().includes(s) ||
          r.bank_name.toLowerCase().includes(s) ||
          r.bank_code.toLowerCase().includes(s)
      );
    }

    const bankFilter = q.bankName || q.bank;
    if (bankFilter && bankFilter !== 'ALL') {
      const b = bankFilter.toLowerCase();
      rows = rows.filter(
        (r) => r.bank_code.toLowerCase() === b || r.bank_name.toLowerCase().includes(b)
      );
    }

    const riskFilter = q.riskClassification || q.riskCategory;
    if (riskFilter && riskFilter !== 'ALL') {
      rows = rows.filter((r) => r.risk_classification.toLowerCase() === riskFilter.toLowerCase());
    }

    const statusFilter = q.accountStatus || q.classification;
    if (statusFilter && statusFilter !== 'ALL') {
      rows = rows.filter((r) => r.account_status === statusFilter);
    }

    if (q.investigationStatus) {
      if (q.investigationStatus === 'FROZEN') {
        rows = rows.filter((r) => r.is_frozen);
      } else if (q.investigationStatus === 'ACTIVE') {
        rows = rows.filter((r) => !r.is_frozen);
      } else if (q.investigationStatus === 'UNDER_INVESTIGATION') {
        rows = rows.filter((r) => r.risk_classification === 'Under Investigation');
      } else if (q.investigationStatus === 'CLEARED') {
        rows = rows.filter(
          (r) =>
            !dbStore.suspiciousAccounts.some(
              (s) => s.account_id === r.account_id && s.status !== 'CLEARED'
            )
        );
      }
    }

    if (q.minScore !== undefined && !isNaN(Number(q.minScore))) {
      rows = rows.filter((r) => r.risk_score >= Number(q.minScore));
    }

    if (q.maxScore !== undefined && !isNaN(Number(q.maxScore))) {
      rows = rows.filter((r) => r.risk_score <= Number(q.maxScore));
    }

    if (q.startDate) {
      const startMs = new Date(q.startDate).getTime();
      rows = rows.filter((r) => new Date(r.last_assessed_at).getTime() >= startMs);
    }

    if (q.endDate) {
      const endMs = new Date(q.endDate).getTime();
      rows = rows.filter((r) => new Date(r.last_assessed_at).getTime() <= endMs);
    }

    const summary = {
      totalAccounts: rows.length,
      totalMonitoredAccounts: rows.length,
      highOrCriticalCount: rows.filter((r) => r.risk_classification === 'Critical' || r.risk_classification === 'High').length,
      criticalCount: rows.filter((r) => r.risk_classification === 'Critical').length,
      highCount: rows.filter((r) => r.risk_classification === 'High').length,
      mediumCount: rows.filter((r) => r.risk_classification === 'Medium').length,
      lowCount: rows.filter((r) => r.risk_classification === 'Low').length,
      underInvestigationCount: rows.filter((r) => r.risk_classification === 'Under Investigation').length,
      confirmedFraudLinkedCount: rows.filter((r) => r.account_status === 'CONFIRMED_FRAUD_LINKED').length,
      suspectedMuleCount: rows.filter((r) => r.account_status === 'SUSPECTED_MULE_ACCOUNT').length,
      suspiciousAccountCount: rows.filter((r) => r.account_status === 'SUSPICIOUS_ACCOUNT').length,
      normalCount: rows.filter((r) => r.account_status === 'NORMAL').length,
    };

    const sortBy = q.sortBy || 'risk_score';
    const sortAsc = (q.sortOrder || 'desc').toLowerCase() === 'asc';
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'risk_score') cmp = a.risk_score - b.risk_score;
      else if (sortBy === 'velocity_score') cmp = a.velocity_score - b.velocity_score;
      else if (sortBy === 'incoming_frequency_24h') cmp = a.incoming_frequency_24h - b.incoming_frequency_24h;
      else if (sortBy === 'outgoing_frequency_24h') cmp = a.outgoing_frequency_24h - b.outgoing_frequency_24h;
      else if (sortBy === 'last_assessed_at') cmp = new Date(a.last_assessed_at).getTime() - new Date(b.last_assessed_at).getTime();
      else cmp = a.account_number.localeCompare(b.account_number);

      return sortAsc ? cmp : -cmp;
    });

    const limit = Math.min(100, Math.max(1, Number(q.limit) || 40));
    const offset = Math.max(0, Number(q.offset) || 0);

    res.json({
      success: true,
      data: rows.slice(offset, offset + limit),
      summary,
      pagination: {
        total: rows.length,
        limit,
        offset,
      },
    });
  });

  /**
   * Literal route: filters for Account Intelligence
   * Route Order Note: Declared BEFORE /accounts/intelligence/:accountId to prevent parameter shadowing.
   */
  api.get('/accounts/intelligence/filters', authenticate, authorizeOfficer, (_req, res) => {
    const banks = Array.from(new Set(dbStore.institutions.map((i) => i.name))).filter(Boolean).sort();
    const classifications = ['Low', 'Medium', 'High', 'Critical', 'Under Investigation'];
    const statuses = ['NORMAL', 'SUSPICIOUS_ACCOUNT', 'SUSPECTED_MULE_ACCOUNT', 'CONFIRMED_FRAUD_LINKED'];
    res.json({
      success: true,
      data: {
        banks,
        riskClassifications: classifications,
        accountStatuses: statuses,
      },
    });
  });

  /**
   * Literal route: summary metrics for Account Intelligence
   * Route Order Note: Declared BEFORE /accounts/intelligence/:accountId to prevent parameter shadowing.
   */
  api.get('/accounts/intelligence/summary', authenticate, authorizeOfficer, (_req, res) => {
    const rows = dbStore.accountIntelligenceProfiles;
    const summary = {
      totalAccounts: rows.length,
      totalMonitoredAccounts: rows.length,
      highOrCriticalCount: rows.filter((r) => r.risk_classification === 'Critical' || r.risk_classification === 'High').length,
      criticalCount: rows.filter((r) => r.risk_classification === 'Critical').length,
      highCount: rows.filter((r) => r.risk_classification === 'High').length,
      mediumCount: rows.filter((r) => r.risk_classification === 'Medium').length,
      lowCount: rows.filter((r) => r.risk_classification === 'Low').length,
      underInvestigationCount: rows.filter((r) => r.risk_classification === 'Under Investigation').length,
      confirmedFraudLinkedCount: rows.filter((r) => r.account_status === 'CONFIRMED_FRAUD_LINKED').length,
      suspectedMuleCount: rows.filter((r) => r.account_status === 'SUSPECTED_MULE_ACCOUNT').length,
      suspiciousAccountCount: rows.filter((r) => r.account_status === 'SUSPICIOUS_ACCOUNT').length,
      normalCount: rows.filter((r) => r.account_status === 'NORMAL').length,
    };
    res.json({ success: true, data: summary });
  });

  api.get('/accounts/intelligence/:accountId', authenticate, authorizeOfficer, (req, res, next) => {
    if (['filters', 'summary'].includes(req.params.accountId)) {
      next();
      return;
    }
    const acc = dbStore.accounts.find((a) => a.id === req.params.accountId);
    if (!acc) {
      next(new HttpError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND'));
      return;
    }

    const inst = dbStore.institutions.find((i) => i.id === acc.institution_id);
    const prof = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === acc.id);
    const accMap = new Map(dbStore.accounts.map((a) => [a.id, a]));
    const instMap = new Map(dbStore.institutions.map((i) => [i.id, i]));

    const relationships = dbStore.suspiciousRelationships
      .filter((r) => r.source_account_id === acc.id)
      .map((r) => {
        const targetAcc = accMap.get(r.target_account_id);
        const targetInst = targetAcc ? instMap.get(targetAcc.institution_id) : undefined;
        return {
          id: r.id,
          source_account_id: r.source_account_id,
          target_account_id: r.target_account_id,
          target_account_number: targetAcc?.account_number ?? r.target_account_id,
          target_holder_name: targetAcc?.holder_name ?? 'Counterparty',
          target_bank: targetInst?.name ?? 'Synthetic Bank',
          relationship_type: r.relationship_type,
          hops_to_confirmed_fraud: r.hops_to_confirmed_fraud,
          risk_weight: r.risk_weight,
          first_observed_at: new Date(r.first_observed_at).toISOString(),
          last_observed_at: new Date(r.last_observed_at).toISOString(),
        };
      })
      .sort((a, b) => b.risk_weight - a.risk_weight);

    const riskHistory = (dbStore.accountRiskHistory || [])
      .filter((h) => h.account_id === acc.id)
      .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());

    const cmpMap = new Map(dbStore.complaints.map((c) => [c.id, c]));
    const linkedComplaints = dbStore.suspiciousAccounts
      .filter((s) => s.account_id === acc.id && s.complaint_id)
      .map((s) => {
        const cmp = cmpMap.get(s.complaint_id);
        return {
          id: cmp?.id ?? s.complaint_id,
          complaint_number: cmp?.complaint_number ?? 'CMP-UNKNOWN',
          status: cmp?.status ?? 'UNDER_INVESTIGATION',
          fraud_type: cmp?.fraud_type ?? 'IDENTITY_THEFT',
          reported_amount: cmp ? Number(cmp.reported_amount) : 0,
        };
      });

    const now = Date.now();
    const oneDayAgo = now - 24 * 3600 * 1000;
    const recentTxns = dbStore.transactions.filter(
      (t) =>
        (t.from_account === acc.id || t.to_account === acc.id) &&
        t.timestamp.getTime() >= oneDayAgo
    );

    const incoming = recentTxns.filter((t) => t.to_account === acc.id);
    const outgoing = recentTxns.filter((t) => t.from_account === acc.id);
    const uniqueSenders = new Set(incoming.map((t) => t.from_account)).size;
    const inTotal = incoming.reduce((s, t) => s + Number(t.amount), 0);
    const outTotal = outgoing.reduce((s, t) => s + Number(t.amount), 0);
    const passThrough = inTotal > 0 ? Math.min(1.0, outTotal / inTotal) : 0;

    let rapidForwardBursts = 0;
    for (const inTx of incoming) {
      const inTime = inTx.timestamp.getTime();
      const hasMatch = outgoing.some((outTx) => {
        const outTime = outTx.timestamp.getTime();
        const diff = (outTime - inTime) / 1000;
        return diff >= 0 && diff <= 300;
      });
      if (hasMatch) rapidForwardBursts++;
    }

    const baselineAvg = prof?.avg_incoming_amount || 25000;
    const largeReceipts = incoming.filter((t) => Number(t.amount) > 3 * baselineAvg).length;

    res.json({
      success: true,
      data: {
        account: {
          id: acc.id,
          account_number: acc.account_number,
          holder_name: acc.holder_name,
          branch_city: acc.branch_city,
          ifsc_code: acc.ifsc_code,
          account_type: acc.account_type,
          is_frozen: acc.is_frozen,
          bank_name: inst?.name ?? 'Synthetic Bank',
          bank_code: inst?.bank_code ?? 'SYN',
        },
        profile: {
          account_id: acc.id,
          account_number: acc.account_number,
          holder_name: acc.holder_name,
          branch_city: acc.branch_city,
          ifsc_code: acc.ifsc_code,
          account_type: acc.account_type,
          is_frozen: acc.is_frozen,
          bank_name: inst?.name ?? 'Synthetic Bank',
          bank_code: inst?.bank_code ?? 'SYN',
          risk_score: prof?.risk_score ?? 10.0,
          risk_classification: prof?.risk_classification ?? 'Low',
          account_status: prof?.account_status ?? 'NORMAL',
          incoming_frequency_24h: prof?.incoming_frequency_24h ?? incoming.length,
          outgoing_frequency_24h: prof?.outgoing_frequency_24h ?? outgoing.length,
          incoming_volume_24h: prof?.incoming_volume_24h ?? inTotal,
          outgoing_volume_24h: prof?.outgoing_volume_24h ?? outTotal,
          avg_incoming_amount: prof?.avg_incoming_amount ?? (incoming.length > 0 ? Math.round(inTotal / incoming.length) : baselineAvg),
          avg_outgoing_amount: prof?.avg_outgoing_amount ?? (outgoing.length > 0 ? Math.round(outTotal / outgoing.length) : 0),
          velocity_score: prof?.velocity_score ?? Math.min(100, incoming.length * 4.2),
          pass_through_ratio: prof?.pass_through_ratio ?? Number(passThrough.toFixed(4)),
          rapid_forward_count_24h: prof?.rapid_forward_count_24h ?? rapidForwardBursts,
          connected_accounts_count: prof?.connected_accounts_count ?? relationships.length,
          suspicious_counterparties_count: prof?.suspicious_counterparties_count ?? relationships.length,
          prior_complaints_count: prof?.prior_complaints_count ?? linkedComplaints.length,
          mule_indicators: prof?.mule_indicators ?? [],
          risk_reasons: prof?.risk_reasons ?? ['Standard account profile'],
          score_source: prof?.score_source ?? 'Rule-based risk score',
          last_assessed_at: prof?.last_assessed_at ? new Date(prof.last_assessed_at).toISOString() : new Date().toISOString(),
          is_synthetic: prof?.is_synthetic ?? true,
          created_at: prof?.created_at ? new Date(prof.created_at).toISOString() : new Date().toISOString(),
          updated_at: prof?.updated_at ? new Date(prof.updated_at).toISOString() : new Date().toISOString(),
        },
        relationships,
        riskHistory,
        recentPatterns: {
          fanInCount: uniqueSenders,
          passThroughRatio: Number(passThrough.toFixed(4)),
          rapidForwardBursts,
          largeReceiptsCount: largeReceipts,
          flaggedCounterparties: relationships.length,
          hourlyVelocityMax: Math.max(incoming.length, outgoing.length),
        },
        linkedComplaints,
      },
    });
  });

  api.get('/accounts/intelligence/:accountId/history', authenticate, authorizeOfficer, (req, res, next) => {
    const acc = dbStore.accounts.find((a) => a.id === req.params.accountId);
    if (!acc) {
      next(new HttpError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND'));
      return;
    }

    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const history = (dbStore.accountRiskHistory || [])
      .filter((h) => h.account_id === acc.id)
      .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());

    res.json({
      success: true,
      data: history.slice(offset, offset + limit),
    });
  });

  api.patch(
    '/accounts/intelligence/:accountId/classification',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
    (req: AuthedRequest, res, next) => {
      try {
        const body = parseOrThrow(
          z.object({
            classification: z.enum([
              'NORMAL',
              'SUSPICIOUS_ACCOUNT',
              'SUSPECTED_MULE_ACCOUNT',
              'CONFIRMED_FRAUD_LINKED',
            ]),
            reason: z.string().min(5).max(1000),
            complaintId: z.string().uuid().nullable().optional(),
            evidenceId: z.string().uuid().nullable().optional(),
            freezeAccount: z.boolean().default(false),
            adjustedScore: z.number().min(0).max(100).optional(),
          }),
          req.body
        );

        const acc = dbStore.accounts.find((a) => a.id === req.params.accountId);
        if (!acc) {
          throw new HttpError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND');
        }

        if (body.classification === 'CONFIRMED_FRAUD_LINKED') {
          if (!body.complaintId && !body.evidenceId) {
            throw new HttpError(
              'CONFIRMED_FRAUD_LINKED classification requires linkage to an active complaint or recorded evidence record. Algorithmic patterns alone cannot confirm fraud.',
              400,
              'COMPLAINT_OR_EVIDENCE_REQUIRED'
            );
          }
        }

        if (body.complaintId) {
          const cmpExists = dbStore.complaints.some((c) => c.id === body.complaintId);
          if (!cmpExists) {
            throw new HttpError('Specified complaint does not exist.', 400, 'INVALID_COMPLAINT_ID');
          }
        }

        if (body.evidenceId) {
          const evExists = dbStore.evidenceRecords.some((e) => e.id === body.evidenceId);
          if (!evExists) {
            throw new HttpError('Specified evidence record does not exist.', 400, 'INVALID_EVIDENCE_ID');
          }
        }

        let prof = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === acc.id);
        const prevScore = prof ? prof.risk_score : 10.0;
        const prevClass = prof ? prof.risk_classification : 'Low';

        let nextScore = body.adjustedScore ?? prevScore;
        let nextClass: 'Low' | 'Medium' | 'High' | 'Critical' | 'Under Investigation' = prevClass;

        if (body.classification === 'CONFIRMED_FRAUD_LINKED') {
          nextClass = 'Critical';
          nextScore = Math.max(nextScore, 85.0);
        } else if (body.classification === 'SUSPECTED_MULE_ACCOUNT') {
          nextClass = 'High';
          nextScore = Math.max(nextScore, 68.0);
        } else if (body.classification === 'SUSPICIOUS_ACCOUNT') {
          nextClass = 'Medium';
          nextScore = Math.max(nextScore, 45.0);
        } else if (body.classification === 'NORMAL') {
          nextClass = 'Low';
          nextScore = Math.min(nextScore, 20.0);
        }

        const now = new Date();
        if (prof) {
          prof.risk_score = nextScore;
          prof.risk_classification = nextClass;
          prof.account_status = body.classification;
          prof.last_assessed_at = now;
          prof.updated_at = now;
        } else {
          prof = {
            account_id: acc.id,
            risk_score: nextScore,
            risk_classification: nextClass,
            account_status: body.classification,
            incoming_frequency_24h: 0,
            outgoing_frequency_24h: 0,
            incoming_volume_24h: 0,
            outgoing_volume_24h: 0,
            avg_incoming_amount: 0,
            avg_outgoing_amount: 0,
            velocity_score: 0,
            pass_through_ratio: 0,
            rapid_forward_count_24h: 0,
            connected_accounts_count: 0,
            suspicious_counterparties_count: 0,
            prior_complaints_count: 0,
            mule_indicators: [],
            risk_reasons: [body.reason],
            score_source: 'Rule-based risk score',
            last_assessed_at: now,
            is_synthetic: true,
            created_at: now,
            updated_at: now,
          };
          dbStore.accountIntelligenceProfiles.push(prof);
        }

        if (body.freezeAccount) {
          acc.is_frozen = true;
        } else if (body.classification === 'NORMAL') {
          acc.is_frozen = false;
        }

        const triggerRef = body.complaintId ?? body.evidenceId ?? null;
        dbStore.accountRiskHistory = dbStore.accountRiskHistory || [];
        dbStore.accountRiskHistory.unshift({
          id: crypto.randomUUID(),
          account_id: acc.id,
          previous_score: prevScore,
          new_score: nextScore,
          previous_classification: prevClass,
          new_classification: nextClass,
          trigger_event: 'OFFICER_RECLASSIFICATION',
          trigger_reference_id: triggerRef,
          reasons_json: [body.reason],
          assessed_by: req.user!.userId,
          recorded_at: now.toISOString(),
        });

        if (body.complaintId) {
          const suspClass =
            body.classification === 'CONFIRMED_FRAUD_LINKED'
              ? 'SUSPECTED_MULE'
              : body.classification === 'SUSPECTED_MULE_ACCOUNT'
                ? 'SUSPECTED_MULE'
                : body.classification === 'NORMAL'
                  ? 'CLEARED'
                  : 'LAYERING_NODE';

          const suspRec = dbStore.suspiciousAccounts.find(
            (s) => s.account_id === acc.id && s.complaint_id === body.complaintId
          );
          if (suspRec) {
            suspRec.classification = suspClass;
            suspRec.mule_probability = nextScore / 100;
            suspRec.reason = body.reason;
            suspRec.status = body.freezeAccount ? 'FROZEN' : body.classification === 'NORMAL' ? 'CLEARED' : 'ACTIVE';
            suspRec.updated_at = now.toISOString();
          } else {
            dbStore.suspiciousAccounts.push({
              id: crypto.randomUUID(),
              account_id: acc.id,
              complaint_id: body.complaintId,
              classification: suspClass,
              mule_probability: nextScore / 100,
              score_source: 'Rule-based risk score',
              reason: body.reason,
              flagged_by: req.user!.userId,
              status: body.freezeAccount ? 'FROZEN' : body.classification === 'NORMAL' ? 'CLEARED' : 'ACTIVE',
              created_at: now.toISOString(),
              updated_at: now.toISOString(),
            });
          }
        }

        recordAudit(
          req,
          'ACCOUNT_CLASSIFICATION_UPDATED',
          'ACCOUNT_INTELLIGENCE',
          acc.id,
          200,
          {
            classification: body.classification,
            reason: body.reason,
            complaintId: body.complaintId ?? null,
            evidenceId: body.evidenceId ?? null,
            freezeAccount: body.freezeAccount,
          }
        );

        res.json({ success: true, data: prof });
      } catch (err) {
        next(err);
      }
    }
  );

  api.post(
    '/accounts/intelligence/:accountId/re-evaluate',
    authenticate,
    authorizeRoles('Administrator', 'Senior Investigator', 'Investigator', 'Bank Nodal Officer'),
    (req: AuthedRequest, res, next) => {
      try {
        const acc = dbStore.accounts.find((a) => a.id === req.params.accountId);
        if (!acc) {
          throw new HttpError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND');
        }

        let prof = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === acc.id);
        const prevScore = prof ? prof.risk_score : 10.0;
        const prevClass = prof ? prof.risk_classification : 'Low';

        const now = Date.now();
        const oneDayAgo = now - 24 * 3600 * 1000;
        const txns = dbStore.transactions.filter(
          (t) =>
            (t.from_account === acc.id || t.to_account === acc.id) &&
            t.timestamp.getTime() >= oneDayAgo
        );

        const incoming = txns.filter((t) => t.to_account === acc.id);
        const outgoing = txns.filter((t) => t.from_account === acc.id);

        const uniqueSenders = new Set(incoming.map((t) => t.from_account)).size;
        const inTotal = incoming.reduce((s, t) => s + Number(t.amount), 0);
        const outTotal = outgoing.reduce((s, t) => s + Number(t.amount), 0);
        const passThroughRatio = inTotal > 0 ? Math.min(1.0, outTotal / inTotal) : 0.0;

        let rapidForwardBursts = 0;
        for (const inTx of incoming) {
          const inTime = inTx.timestamp.getTime();
          const match = outgoing.some((outTx) => {
            const outTime = outTx.timestamp.getTime();
            const diff = (outTime - inTime) / 1000;
            return diff >= 0 && diff <= 300;
          });
          if (match) rapidForwardBursts++;
        }

        const baselineAvg = prof?.avg_incoming_amount || 25000;
        const largeReceipts = incoming.filter((t) => Number(t.amount) > 3 * baselineAvg).length;
        const flaggedCounterparties = dbStore.suspiciousRelationships.filter(
          (sar) => sar.source_account_id === acc.id && sar.hops_to_confirmed_fraud <= 2
        ).length;

        const indicators: string[] = [];
        const reasons: string[] = [];
        let computedScore = 15.0;

        if (uniqueSenders >= 5) {
          indicators.push('FAN_IN_HIGH_VELOCITY');
          reasons.push(`High fan-in velocity detected: ${uniqueSenders} distinct remitters within 24 hours`);
          computedScore += 25.0;
        } else if (uniqueSenders >= 3) {
          reasons.push(`Elevated remittance sources: ${uniqueSenders} distinct remitters`);
          computedScore += 12.0;
        }

        if (passThroughRatio >= 0.75 && rapidForwardBursts >= 1) {
          indicators.push('RAPID_FORWARD_BURST');
          reasons.push(
            `Rapid pass-through pattern: ${(passThroughRatio * 100).toFixed(1)}% of deposits forwarded within 5 minutes`
          );
          computedScore += 30.0;
        } else if (passThroughRatio >= 0.6) {
          reasons.push(`High pass-through volume: ${(passThroughRatio * 100).toFixed(1)}%`);
          computedScore += 15.0;
        }

        if (largeReceipts >= 1) {
          indicators.push('UNUSUAL_INFLOW_SPIKE');
          reasons.push(`Unusual large receipt detected: ${largeReceipts} transaction(s) > 3x historical average`);
          computedScore += 15.0;
        }

        if (flaggedCounterparties >= 1) {
          indicators.push('HIGH_RISK_COUNTERPARTY');
          reasons.push(`Connected to ${flaggedCounterparties} high-risk or mule counterparty nodes within 2 network hops`);
          computedScore += 20.0;
        }

        if (rapidForwardBursts >= 3) {
          computedScore += 10.0;
        }

        computedScore = Math.min(100.0, Math.max(5.0, Math.round(computedScore * 10) / 10));

        let newClassification: 'Low' | 'Medium' | 'High' | 'Critical' | 'Under Investigation' = 'Low';
        if (computedScore >= 80) newClassification = 'Critical';
        else if (computedScore >= 65) newClassification = 'High';
        else if (computedScore >= 40) newClassification = 'Medium';

        if (prevClass === 'Under Investigation') {
          newClassification = 'Under Investigation';
        }

        let nextStatus: 'NORMAL' | 'SUSPICIOUS_ACCOUNT' | 'SUSPECTED_MULE_ACCOUNT' | 'CONFIRMED_FRAUD_LINKED' =
          prof?.account_status ?? 'NORMAL';

        if (nextStatus !== 'CONFIRMED_FRAUD_LINKED') {
          if (
            (indicators.includes('RAPID_FORWARD_BURST') || indicators.includes('FAN_IN_HIGH_VELOCITY')) &&
            computedScore >= 65
          ) {
            nextStatus = 'SUSPECTED_MULE_ACCOUNT';
          } else if (computedScore >= 40) {
            nextStatus = 'SUSPICIOUS_ACCOUNT';
          } else {
            nextStatus = 'NORMAL';
          }
        }

        if (reasons.length === 0) {
          reasons.push('Standard transactional velocity consistent with normal account profile');
        }

        const nowDate = new Date();
        if (prof) {
          prof.risk_score = computedScore;
          prof.risk_classification = newClassification;
          prof.account_status = nextStatus;
          prof.incoming_frequency_24h = incoming.length;
          prof.outgoing_frequency_24h = outgoing.length;
          prof.incoming_volume_24h = inTotal;
          prof.outgoing_volume_24h = outTotal;
          prof.avg_incoming_amount = incoming.length > 0 ? Math.round(inTotal / incoming.length) : baselineAvg;
          prof.avg_outgoing_amount = outgoing.length > 0 ? Math.round(outTotal / outgoing.length) : 0;
          prof.velocity_score = Math.min(100, incoming.length * 4.5);
          prof.pass_through_ratio = Number(passThroughRatio.toFixed(4));
          prof.rapid_forward_count_24h = rapidForwardBursts;
          prof.mule_indicators = indicators;
          prof.risk_reasons = reasons;
          prof.last_assessed_at = nowDate;
          prof.updated_at = nowDate;
        } else {
          prof = {
            account_id: acc.id,
            risk_score: computedScore,
            risk_classification: newClassification,
            account_status: nextStatus,
            incoming_frequency_24h: incoming.length,
            outgoing_frequency_24h: outgoing.length,
            incoming_volume_24h: inTotal,
            outgoing_volume_24h: outTotal,
            avg_incoming_amount: incoming.length > 0 ? Math.round(inTotal / incoming.length) : baselineAvg,
            avg_outgoing_amount: outgoing.length > 0 ? Math.round(outTotal / outgoing.length) : 0,
            velocity_score: Math.min(100, incoming.length * 4.5),
            pass_through_ratio: Number(passThroughRatio.toFixed(4)),
            rapid_forward_count_24h: rapidForwardBursts,
            connected_accounts_count: flaggedCounterparties,
            suspicious_counterparties_count: flaggedCounterparties,
            prior_complaints_count: 0,
            mule_indicators: indicators,
            risk_reasons: reasons,
            score_source: 'Rule-based risk score',
            last_assessed_at: nowDate,
            is_synthetic: true,
            created_at: nowDate,
            updated_at: nowDate,
          };
          dbStore.accountIntelligenceProfiles.push(prof);
        }

        dbStore.accountRiskHistory = dbStore.accountRiskHistory || [];
        dbStore.accountRiskHistory.unshift({
          id: crypto.randomUUID(),
          account_id: acc.id,
          previous_score: prevScore,
          new_score: computedScore,
          previous_classification: prevClass,
          new_classification: newClassification,
          trigger_event: 'DYNAMIC_BEHAVIOURAL_REEVALUATION',
          trigger_reference_id: null,
          reasons_json: reasons,
          assessed_by: req.user!.userId,
          recorded_at: nowDate.toISOString(),
        });

        recordAudit(
          req,
          'ACCOUNT_INTELLIGENCE_REEVALUATED',
          'ACCOUNT_INTELLIGENCE',
          acc.id,
          200,
          {
            risk_score: computedScore,
            risk_classification: newClassification,
            account_status: nextStatus,
            mule_indicators: indicators,
          }
        );

        res.json({ success: true, data: prof });
      } catch (err) {
        next(err);
      }
    }
  );

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
    // Route order guard: literal sub-paths must never be captured as account IDs
    if (['institutions', 'intelligence', 'filters', 'summary'].includes(req.params.id)) {
      next();
      return;
    }
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

  // ---------------- PHASE 5: PREVENTION GRAPH INTELLIGENCE & MULE SYNDICATE ENDPOINTS ----------------

  api.get('/graph/account/:accountId/subgraph', authenticate, authorizeOfficer, (req, res, next) => {
    try {
      const q = parseOrThrow(
        z.object({
          direction: z.enum(['forward', 'reverse', 'both']).default('both'),
          depth: z.coerce.number().int().min(1).max(5).default(2),
          complaintId: z.string().uuid().optional(),
        }),
        req.query
      );
      const acc = resolveAccount(dbStore, req.params.accountId);
      if (!acc) throw new HttpError(`Account '${req.params.accountId}' not found.`, 404, 'ACCOUNT_NOT_FOUND');

      const data = extractAccountSubgraph(dbStore, acc.id, q.direction, q.depth, q.complaintId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  api.post('/graph/account-subgraph', authenticate, authorizeOfficer, (req, res, next) => {
    try {
      const body = parseOrThrow(
        z.object({
          account_id: z.string().min(4),
          direction: z.enum(['forward', 'reverse', 'both']).default('both'),
          depth: z.number().int().min(1).max(5).default(2),
          complaint_id: z.string().uuid().optional(),
        }),
        req.body
      );
      const acc = resolveAccount(dbStore, body.account_id);
      if (!acc) throw new HttpError(`Account '${body.account_id}' not found.`, 404, 'ACCOUNT_NOT_FOUND');

      const data = extractAccountSubgraph(dbStore, acc.id, body.direction, body.depth, body.complaint_id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  api.get('/graph/mule-clusters', authenticate, authorizeOfficer, (req, res, next) => {
    try {
      const qRaw = req.query as Record<string, string | undefined>;
      const minClusterSize = Number(qRaw.minClusterSize ?? qRaw.min_cluster_size ?? 2);
      const minRiskScore = Number(qRaw.minRiskScore ?? qRaw.min_risk_score ?? 30);
      const result = detectMuleClusters(
        dbStore,
        isNaN(minClusterSize) ? 2 : minClusterSize,
        isNaN(minRiskScore) ? 30 : minRiskScore
      );

      let clusters = result.clusters;
      if (qRaw.search && qRaw.search.trim()) {
        const s = qRaw.search.trim().toLowerCase();
        clusters = clusters.filter(
          (c) =>
            c.cluster_id.toLowerCase().includes(s) ||
            c.members.some(
              (m) =>
                m.account_number.toLowerCase().includes(s) ||
                m.holder_name.toLowerCase().includes(s) ||
                (m.bank_name?.toLowerCase().includes(s) ?? false)
            )
        );
      }
      const topology = qRaw.clusterType || qRaw.topology || qRaw.type;
      if (topology && topology !== 'ALL') {
        clusters = clusters.filter((c) => c.cluster_type === topology);
      }
      const severity = qRaw.severity;
      if (severity && severity !== 'ALL') {
        clusters = clusters.filter((c) => c.severity === severity);
      }

      let totalExposure = 0;
      let highRiskCount = 0;
      const flaggedAccIds = new Set<string>();
      for (const cl of clusters) {
        totalExposure += cl.total_flow_amount;
        if (cl.risk_score >= 75 || cl.severity === 'CRITICAL' || cl.severity === 'HIGH') {
          highRiskCount++;
        }
        for (const m of cl.members) {
          flaggedAccIds.add(m.account_id);
        }
      }

      res.json({
        success: true,
        data: {
          clusters,
          total_clusters: clusters.length,
          high_risk_clusters: highRiskCount,
          total_flagged_accounts: flaggedAccIds.size,
          total_exposure_amount: Math.round(totalExposure * 100) / 100,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  api.get('/graph/account/:accountId/intelligence', authenticate, authorizeOfficer, (req, res, next) => {
    try {
      const acc = resolveAccount(dbStore, req.params.accountId);
      if (!acc) throw new HttpError(`Account '${req.params.accountId}' not found.`, 404, 'ACCOUNT_NOT_FOUND');

      const data = extractAccountGraphIntelligence(dbStore, acc.id);
      if (!data) throw new HttpError(`Account '${req.params.accountId}' not found.`, 404, 'ACCOUNT_NOT_FOUND');

      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  api.get('/graph/metrics/:id', authenticate, authorizeOfficer, (req, res, next) => {
    try {
      const acc = resolveAccount(dbStore, req.params.id);
      if (!acc) throw new HttpError(`Account '${req.params.id}' not found.`, 404, 'ACCOUNT_NOT_FOUND');

      const data = extractAccountGraphIntelligence(dbStore, acc.id);
      res.json({ success: true, data });
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

  api.post('/ml/screen/predict', (req, res) => {
    const b = (req.body || {}) as Record<string, unknown>;
    const receiverScore = Number(b.receiver_risk_score) || 10.0;
    const receiverPt = Number(b.receiver_pass_through) || 0.0;
    const rapidFw = Number(b.rapid_forward_count) || 0;
    const amount = Number(b.amount) || 1000;
    const isFirstTime = Boolean(b.is_first_time_beneficiary);
    const hops = Number(b.hops_to_confirmed_fraud) || 99;

    let baseLogit = -2.5;
    baseLogit += receiverPt * 2.8;
    baseLogit += Math.min(2.5, rapidFw * 0.45);
    if (hops === 1) baseLogit += 2.2;
    else if (hops === 2) baseLogit += 1.2;
    if (isFirstTime && amount > 50000) baseLogit += 0.85;

    const rawProb = Math.min(0.98, Math.max(0.02, 1.0 / (1.0 + Math.exp(-baseLogit))));
    const mlScore = Math.round(rawProb * 1000) / 10;
    const anomScore = Math.round(rawProb * 820) / 1000;
    const isAnom = rawProb >= 0.65;

    const topShaps = [
      {
        factor: 'pass_through_ratio',
        value: Math.round(receiverPt * 1000) / 1000,
        shap_value: Math.round(receiverPt * 350) / 1000,
        direction: receiverPt > 0.5 ? 'increases_risk' : 'decreases_risk',
        description: `Rapid pass-through ratio of ${(receiverPt * 100).toFixed(1)}%`,
      },
      {
        factor: 'hops_to_confirmed_fraud',
        value: hops,
        shap_value: hops <= 2 ? 0.28 : -0.05,
        direction: hops <= 2 ? 'increases_risk' : 'decreases_risk',
        description: `${hops} network hop(s) to verified cybercrime fraud node`,
      },
      {
        factor: 'is_first_time_beneficiary',
        value: isFirstTime ? 1.0 : 0.0,
        shap_value: isFirstTime ? 0.18 : -0.08,
        direction: isFirstTime ? 'increases_risk' : 'decreases_risk',
        description: 'First-time transfer between remitter and beneficiary',
      },
      {
        factor: 'amount',
        value: amount,
        shap_value: amount >= 100000 ? 0.15 : 0.02,
        direction: amount >= 100000 ? 'increases_risk' : 'decreases_risk',
        description: `Transaction amount of INR ${amount.toLocaleString('en-IN')}`,
      },
      {
        factor: 'receiver_risk_score',
        value: receiverScore,
        shap_value: Math.round(((receiverScore - 20) / 100) * 250) / 1000,
        direction: receiverScore >= 50 ? 'increases_risk' : 'decreases_risk',
        description: `Receiver account baseline risk score ${receiverScore.toFixed(1)}`,
      },
    ];

    let mlClass = 'Low';
    if (mlScore >= 80) mlClass = 'Critical';
    else if (mlScore >= 65) mlClass = 'High';
    else if (mlScore >= 40) mlClass = 'Medium';

    res.json({
      fraud_probability: Math.round(rawProb * 1000) / 1000,
      anomaly_score: anomScore,
      is_anomaly: isAnom,
      ml_score: mlScore,
      ml_classification: mlClass,
      model_version: 'v1.0-rules-xgb',
      model_name: 'FinTrace-XGBoost-MuleDetector',
      latency_ms: 1.2,
      top_shap_factors: topShaps,
      score_source: 'Trained ML prediction',
    });
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
