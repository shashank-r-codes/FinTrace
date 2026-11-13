import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockWithTransaction = vi.fn();

vi.mock('../config/db.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
  pool: { end: vi.fn() },
}));

import { createApp } from '../app.js';
import { env } from '../config/env.js';

function makeAuthHeader(role: 'Administrator' | 'Senior Investigator' | 'Investigator' | 'Bank Nodal Officer') {
  const token = jwt.sign(
    {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'tester@fintrace.in',
      fullName: 'Test Operator',
      role,
      institutionId: null,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
  return `Bearer ${token}`;
}

describe('FinTrace Auth, Health & RBAC Guards', () => {
  const app = createApp();

  beforeEach(() => {
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  it('GET /api/v1/health reports connected when SELECT 1 succeeds', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });

    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.database).toBe('connected');
    expect(res.body.syntheticDemo).toBe(true);
  });

  it('GET /api/v1/health returns 503 when PostgreSQL query fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection refused'));

    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body.database).toBe('disconnected');
  });

  it('GET /api/v1/auth/me rejects missing bearer token with 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/v1/auth/login issues accessToken + refreshToken for valid credentials', async () => {
    const hash = await bcrypt.hash('FinTrace@Demo2026', 6);
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'admin@fintrace.in',
            password_hash: hash,
            full_name: 'Arvind Menon',
            role_name: 'Administrator',
            institution_id: null,
            is_active: true,
            permissions: ['*'],
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // audit_logs insert

    mockWithTransaction.mockImplementationOnce(async (cb: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
      return cb(client);
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@fintrace.in', password: 'FinTrace@Demo2026' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
    expect(res.body.data.user.role).toBe('Administrator');
  });

  it('POST /api/v1/auth/login returns 401 on wrong password', async () => {
    const hash = await bcrypt.hash('CorrectPassword1', 6);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'admin@fintrace.in',
          password_hash: hash,
          full_name: 'Arvind Menon',
          role_name: 'Administrator',
          institution_id: null,
          is_active: true,
          permissions: ['*'],
        },
      ],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@fintrace.in', password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('RBAC blocks Investigator from POST /api/v1/users (403 FORBIDDEN)', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', makeAuthHeader('Investigator'))
      .send({
        email: 'new@fintrace.in',
        password: 'Password@123',
        fullName: 'New Officer',
        roleName: 'Investigator',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('RBAC blocks Bank Nodal Officer from GET /api/v1/audit-logs (403 FORBIDDEN)', async () => {
    const res = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', makeAuthHeader('Bank Nodal Officer'));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
