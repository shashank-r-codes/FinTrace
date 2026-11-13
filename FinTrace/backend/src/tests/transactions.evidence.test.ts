import crypto from 'node:crypto';
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

function authHeader(role: 'Administrator' | 'Senior Investigator' | 'Investigator' | 'Bank Nodal Officer' = 'Investigator') {
  const token = jwt.sign(
    {
      userId: '22222222-2222-4222-8222-222222222222',
      email: 'investigator@fintrace.in',
      fullName: 'Kavya Nair',
      role,
      institutionId: null,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
  return `Bearer ${token}`;
}

describe('FinTrace Transactions, Evidence Verification & Assistant Guards', () => {
  const app = createApp();

  beforeEach(() => {
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  it('POST /api/v1/transactions rejects identical source and destination accounts', async () => {
    const sameUuid = '33333333-3333-4333-8333-333333333333';
    mockWithTransaction.mockImplementationOnce(
      async (cb: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
        const client = {
          query: vi.fn().mockResolvedValue({ rows: [{ id: sameUuid }], rowCount: 1 }),
        };
        return cb(client);
      }
    );

    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', authHeader('Investigator'))
      .send({
        fromAccount: sameUuid,
        toAccount: sameUuid,
        amount: 25000,
        timestamp: '2026-03-10T10:00:00.000Z',
        channel: 'UPI',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SAME_ACCOUNT');
  });

  it('POST /api/v1/transactions/upload-csv ingests valid CSV rows and counts duplicates', async () => {
    const fromUuid = '44444444-4444-4444-8444-444444444444';
    const toUuid = '55555555-5555-4555-8555-555555555555';

    mockWithTransaction.mockImplementationOnce(
      async (cb: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
        const clientQuery = vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: fromUuid }], rowCount: 1 }) // resolve from_account
          .mockResolvedValueOnce({ rows: [{ id: toUuid }], rowCount: 1 }) // resolve to_account
          .mockResolvedValueOnce({ rows: [{ txn_id: 'TXN-CSV-001' }], rowCount: 1 }) // insert txn 1
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // upsert beneficiary 1
          .mockResolvedValueOnce({ rows: [{ id: fromUuid }], rowCount: 1 }) // resolve from_account row 2
          .mockResolvedValueOnce({ rows: [{ id: toUuid }], rowCount: 1 }) // resolve to_account row 2
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // duplicate txn 2 skipped

        return cb({ query: clientQuery });
      }
    );
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // audit log

    const csvPayload = [
      'txn_id,from_account,to_account,amount,timestamp,channel,hop_depth,is_flagged_fraud',
      `${'TXN-CSV-001'},${fromUuid},${toUuid},45000,2026-03-10T11:00:00Z,UPI,1,true`,
      `${'TXN-CSV-DUP'},${fromUuid},${toUuid},12000,2026-03-10T11:05:00Z,IMPS,2,false`,
    ].join('\n');

    const res = await request(app)
      .post('/api/v1/transactions/upload-csv')
      .set('Authorization', authHeader('Investigator'))
      .attach('file', Buffer.from(csvPayload, 'utf-8'), 'test_batch.csv');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalRows).toBe(2);
    expect(res.body.data.inserted).toBe(1);
    expect(res.body.data.skippedDuplicates).toBe(1);
    expect(res.body.data.errors).toEqual([]);
  });

  it('POST /api/v1/evidence/:id/verify confirms matching SHA-256 digest', async () => {
    const evidenceId = '66666666-6666-4666-8666-666666666666';
    const rawPayload = 'NPCI_UTR_9988776655_VERIFIED';
    const expectedHash = crypto.createHash('sha256').update(rawPayload, 'utf8').digest('hex');

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: evidenceId, sha256_hash: expectedHash }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // audit log

    const res = await request(app)
      .post(`/api/v1/evidence/${evidenceId}/verify`)
      .set('Authorization', authHeader('Investigator'))
      .send({ contentPayload: rawPayload });

    expect(res.status).toBe(200);
    expect(res.body.data.matched).toBe(true);
    expect(res.body.data.storedHash).toBe(expectedHash);
  });

  it('GET /api/v1/assistant/status and POST /api/v1/assistant/query fail cleanly when GEMINI_API_KEY is unset', async () => {
    const statusRes = await request(app)
      .get('/api/v1/assistant/status')
      .set('Authorization', authHeader('Investigator'));

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.configured).toBe(false);

    const queryRes = await request(app)
      .post('/api/v1/assistant/query')
      .set('Authorization', authHeader('Investigator'))
      .send({ question: 'Summarize open ATM alerts' });

    expect(queryRes.status).toBe(503);
    expect(queryRes.body.error.code).toBe('GEMINI_NOT_CONFIGURED');
  });
});
