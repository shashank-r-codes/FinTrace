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

function authHeader(role: 'Administrator' | 'Senior Investigator' | 'Investigator' | 'Bank Nodal Officer' = 'Bank Nodal Officer') {
  const token = jwt.sign(
    {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'officer@fintrace.gov.in',
      fullName: 'Rahul Sharma',
      role,
      institutionId: 'inst-001',
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
  return `Bearer ${token}`;
}

describe('FinTrace Fraud Prevention Layer End-to-End Test Suite', () => {
  const app = createApp();

  beforeEach(() => {
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  it('GET /api/v1/accounts/:id/intelligence returns intelligence profile with safety disclaimer', async () => {
    const accId = '22222222-2222-4222-8222-222222222222';
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'prof-001',
          account_id: accId,
          account_number: 'SBIN0001001',
          holder_name: 'Aarav Patel',
          risk_score: 82.5,
          risk_classification: 'HIGH',
          account_status: 'SUSPECTED_MULE',
          inflow_velocity_1h: 450000,
          outflow_velocity_1h: 440000,
          rapid_pass_through_ratio: 0.97,
        },
      ],
      rowCount: 1,
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // risk history

    const res = await request(app)
      .get(`/api/v1/accounts/${accId}/intelligence`)
      .set('Authorization', authHeader('Bank Nodal Officer'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.account_number).toBe('SBIN0001001');
    expect(res.body.data.account_status).toBe('SUSPECTED_MULE');
    expect(res.body.data.limitations_disclaimer).toContain('FinTrace returns RECOMMENDATIONS');
  });

  it('POST /api/v1/screening/screen evaluates pre-authorisation transfer and generates risk assessment', async () => {
    const senderId = '33333333-3333-4333-8333-333333333333';
    const receiverId = '44444444-4444-4444-8444-444444444444';

    // Mock sender profile
    mockQuery.mockResolvedValueOnce({
      rows: [{ account_id: senderId, risk_score: 12.0, account_status: 'ACTIVE_NORMAL' }],
    });
    // Mock receiver profile (Mule profile)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          account_id: receiverId,
          risk_score: 88.0,
          account_status: 'SUSPECTED_MULE',
          inflow_velocity_1h: 600000,
          rapid_pass_through_ratio: 0.98,
        },
      ],
    });
    // Mock screening thresholds
    mockQuery.mockResolvedValueOnce({
      rows: [
        { setting_key: 'SCREENING_AUTO_REJECT_THRESHOLD', setting_value: '85.0' },
        { setting_key: 'SCREENING_HOLD_REVIEW_THRESHOLD', setting_value: '65.0' },
        { setting_key: 'SCREENING_VERIFY_THRESHOLD', setting_value: '45.0' },
      ],
    });

    // Mock insertion transaction
    mockWithTransaction.mockImplementationOnce(async (cb) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'screen-001',
                sender_account_id: senderId,
                receiver_account_id: receiverId,
                amount: 350000,
                decision: 'REJECT_BLOCK',
                risk_score: 88.0,
                risk_classification: 'HIGH',
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [{ id: 'assess-001' }] })
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'intervene-001',
                screening_id: 'screen-001',
                recommended_action: 'REJECT_BLOCK',
                review_status: 'PENDING',
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [{ entry_hash: 'genesis' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'audit-001' }] }),
      };
      return cb(client);
    });

    const res = await request(app)
      .post('/api/v1/screening/screen')
      .set('Authorization', authHeader('Bank Nodal Officer'))
      .send({
        sender_account_id: senderId,
        receiver_account_id: receiverId,
        amount: 350000,
        currency: 'INR',
        channel: 'IMPS',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.action).toBe('REJECT_BLOCK');
    expect(res.body.data.latency_ms).toBeLessThan(100);
    expect(res.body.data.limitations_disclaimer).toContain('FinTrace returns RECOMMENDATIONS');
  });

  it('GET /api/v1/interventions/verify-chain verifies sequential SHA-256 cryptographic linking', async () => {
    const genesis = '0000000000000000000000000000000000000000000000000000000000000000';
    const hash1 = crypto.createHash('sha256').update(`${genesis}:1:ENTRY1`).digest('hex');
    const hash2 = crypto.createHash('sha256').update(`${hash1}:2:ENTRY2`).digest('hex');

    mockQuery.mockResolvedValueOnce({
      rows: [
        { sequence_number: 1, previous_hash: genesis, entry_hash: hash1 },
        { sequence_number: 2, previous_hash: hash1, entry_hash: hash2 },
      ],
      rowCount: 2,
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // audit record

    const res = await request(app)
      .get('/api/v1/interventions/verify-chain')
      .set('Authorization', authHeader('Bank Nodal Officer'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('VALID');
    expect(res.body.data.total_entries_verified).toBe(2);
    expect(res.body.data.latest_hash).toBe(hash2);
  });

  it('POST /api/v1/interventions/:id/bridge-to-forensics creates complaint, case, and Section 91 CrPC evidence', async () => {
    const interventionId = '55555555-5555-4555-8555-555555555555';
    const screeningId = '66666666-6666-4666-8666-666666666666';
    const receiverAccId = '77777777-7777-4777-8777-777777777777';

    mockWithTransaction.mockImplementationOnce(async (cb) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: interventionId,
                screening_id: screeningId,
                sender_account_id: 'sender-01',
                receiver_account_id: receiverAccId,
                amount: 450000,
                channel: 'NEFT',
                risk_score: 92.0,
                recommended_action: 'REJECT_BLOCK',
                sender_acc: 'ACC-SENDER',
                sender_name: 'Victim User',
                receiver_acc: 'ACC-MULE',
                receiver_name: 'Mule Ring Lead',
              },
            ],
          }) // 1. fetch intervention
          .mockResolvedValueOnce({ rows: [{ entry_hash: 'audit-hash-prev' }] }) // audit hash
          .mockResolvedValueOnce({
            rows: [{ id: 'cmp-001', complaint_number: 'CMP-PREV-2026-01' }],
          }) // 2. complaint insert
          .mockResolvedValueOnce({
            rows: [{ id: 'inv-001', case_number: 'INV-PREV-2026-9001' }],
          }) // 3. investigation insert
          .mockResolvedValueOnce({
            rows: [{ id: 'ev-001', sha256_hash: 'audit-hash-prev' }],
          }) // 4. evidence insert
          .mockResolvedValueOnce({ rows: [] }) // 5. update account profile
          .mockResolvedValueOnce({ rows: [{ entry_hash: 'audit-head-hash' }] }) // 6. fetch last audit
          .mockResolvedValueOnce({ rows: [{ id: 'audit-002' }] }), // 7. insert audit
      };
      return cb(client);
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // audit log

    const res = await request(app)
      .post(`/api/v1/interventions/${interventionId}/bridge-to-forensics`)
      .set('Authorization', authHeader('Bank Nodal Officer'))
      .send({
        caseTitle: 'Section 91 CrPC Intercept on Fast Dissipation Mule',
        generateEvidenceRecord: true,
        flagAccountAsConfirmed: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.complaint.complaint_number).toBe('CMP-PREV-2026-01');
    expect(res.body.data.investigation.case_number).toBe('INV-PREV-2026-9001');
    expect(res.body.data.account_updated).toBe(true);
    expect(res.body.data.evidence_record.sha256_hash).toBe('audit-hash-prev');
    expect(res.body.data.limitations_disclaimer).toContain('FinTrace returns RECOMMENDATIONS');
  });
});
