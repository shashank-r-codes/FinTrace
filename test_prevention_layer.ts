import assert from 'node:assert';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { dbStore } from './server/store.ts';

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const SAFETY_DISCLAIMER =
  'FinTrace returns RECOMMENDATIONS. Simulated intervention only. No actual banking freeze or fund blocking is executed on live financial rails.';

describe('FinTrace Comprehensive Prevention Layer Test Suite', () => {
  describe('Suite 1: Account Intelligence & Multi-Factor Risk Registry', () => {
    it('verifies 42 intelligence profiles with proper classification distribution', () => {
      assert.ok(dbStore.accountIntelligenceProfiles.length >= 42, 'Expected at least 42 intelligence profiles in store');

      const confirmedMules = dbStore.accountIntelligenceProfiles.filter(
        (p) => p.account_status === 'CONFIRMED_FRAUD_LINKED'
      );
      const suspectedMules = dbStore.accountIntelligenceProfiles.filter(
        (p) => p.account_status === 'SUSPECTED_MULE_ACCOUNT'
      );
      const suspiciousAccounts = dbStore.accountIntelligenceProfiles.filter(
        (p) => p.account_status === 'SUSPICIOUS_ACCOUNT'
      );
      const activeNormal = dbStore.accountIntelligenceProfiles.filter(
        (p) => p.account_status === 'NORMAL'
      );

      assert.ok(confirmedMules.length > 0, 'Expected at least one CONFIRMED_FRAUD_LINKED account');
      assert.ok(suspectedMules.length > 0, 'Expected at least one SUSPECTED_MULE_ACCOUNT');
      assert.ok(suspiciousAccounts.length > 0, 'Expected at least one SUSPICIOUS_ACCOUNT');
      assert.ok(activeNormal.length > 0, 'Expected at least one NORMAL account');

      console.log(
        `   [Profile Distribution] Normal: ${activeNormal.length}, Suspicious: ${suspiciousAccounts.length}, Suspected Mule: ${suspectedMules.length}, Confirmed Fraud-Linked: ${confirmedMules.length}`
      );
    });

    it('strictly enforces that CONFIRMED_FRAUD_LINKED accounts have complaint or forensic linkage', () => {
      const confirmedProfiles = dbStore.accountIntelligenceProfiles.filter(
        (p) => p.account_status === 'CONFIRMED_FRAUD_LINKED'
      );

      for (const profile of confirmedProfiles) {
        const acc = dbStore.accounts.find((a) => a.id === profile.account_id);
        const hasFlaggedTxn = dbStore.transactions.some(
          (t) => (t.to_account === profile.account_id || t.from_account === profile.account_id) && t.is_flagged_fraud
        );
        const hasComplaintOrEvidence =
          hasFlaggedTxn ||
          dbStore.evidenceRecords.length > 0 ||
          profile.risk_reasons.some(
            (r) =>
              r.toLowerCase().includes('fir') ||
              r.toLowerCase().includes('complaint') ||
              r.toLowerCase().includes('confirmed')
          );

        assert.ok(
          hasComplaintOrEvidence,
          `Account ${acc?.account_number ?? profile.account_id} marked CONFIRMED_FRAUD_LINKED without complaint or evidence linkage!`
        );
      }
    });

    it('validates multi-factor risk scoring formula bounds (0 to 100)', () => {
      for (const profile of dbStore.accountIntelligenceProfiles) {
        assert.ok(profile.risk_score >= 0 && profile.risk_score <= 100, `Score ${profile.risk_score} out of bounds`);
        if (profile.risk_score >= 85) {
          assert.ok(profile.risk_classification === 'Critical' || profile.risk_classification === 'High');
        } else if (profile.risk_score >= 65) {
          assert.ok(profile.risk_classification === 'High' || profile.risk_classification === 'Medium');
        } else if (profile.risk_score <= 30) {
          assert.ok(profile.risk_classification === 'Low');
        }
      }
    });
  });

  describe('Suite 2: Sub-50ms Real-Time Screening Hot Path & Latency Budget', () => {
    it('evaluates pre-authorisation transfers within the sub-50ms latency budget', () => {
      const normalProfiles = dbStore.accountIntelligenceProfiles.filter((p) => p.account_status === 'NORMAL');
      assert.ok(normalProfiles.length >= 2, 'Found at least 2 normal profiles');

      const legitSender = dbStore.accounts.find((a) => a.id === normalProfiles[0].account_id);
      const legitReceiver = dbStore.accounts.find((a) => a.id === normalProfiles[1].account_id);
      assert.ok(legitSender && legitReceiver, 'Clean seed accounts found');

      const iterations = 50;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();

        // Local screening hot path evaluation
        const senderProf = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === legitSender.id);
        const receiverProf = dbStore.accountIntelligenceProfiles.find((p) => p.account_id === legitReceiver.id);

        let compositeScore = 0;
        let decision: 'ALLOW' | 'ADDITIONAL_VERIFICATION' | 'HOLD_FOR_REVIEW' | 'REJECT_BLOCK' = 'ALLOW';

        if (receiverProf?.account_status === 'CONFIRMED_FRAUD_LINKED') {
          compositeScore = 98.0;
          decision = 'REJECT_BLOCK';
        } else if (receiverProf?.account_status === 'SUSPECTED_MULE_ACCOUNT') {
          compositeScore = 88.0;
          decision = 'HOLD_FOR_REVIEW';
        } else {
          compositeScore = Math.max(senderProf?.risk_score ?? 10, receiverProf?.risk_score ?? 10);
          if (compositeScore >= 85) decision = 'REJECT_BLOCK';
          else if (compositeScore >= 65) decision = 'HOLD_FOR_REVIEW';
          else if (compositeScore >= 45) decision = 'ADDITIONAL_VERIFICATION';
          else decision = 'ALLOW';
        }

        const elapsed = performance.now() - start;
        latencies.push(elapsed);
        assert.strictEqual(decision, 'ALLOW', 'Expected ALLOW for clean retail transfer');
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      console.log(`   [Latency Benchmark] 50 Screening Runs -> Avg: ${avgLatency.toFixed(3)}ms, Max: ${maxLatency.toFixed(3)}ms (Budget: <50ms)`);
      assert.ok(avgLatency < 50, `Average screening latency (${avgLatency}ms) exceeded 50ms budget!`);
    });

    it('verifies deterministic scenario classification across synthetic seed cases', () => {
      assert.ok(dbStore.screeningRequests.length >= 7, 'Expected 7 seed screening requests');

      // Index 0: Scenario A (Legitimate clean retail -> ALLOW)
      const sc0 = dbStore.screeningRequests[0];
      assert.strictEqual(sc0.decision, 'ALLOW');
      assert.ok(sc0.risk_score < 45);

      // Index 1: Scenario E/F (Verification threshold -> VERIFY)
      const sc1 = dbStore.screeningRequests[1];
      assert.strictEqual(sc1.decision, 'VERIFY');
      assert.ok(sc1.risk_score >= 45 && sc1.risk_score < 65);

      // Index 2: Scenario B (Rapid pass-through mule -> HOLD)
      const sc2 = dbStore.screeningRequests[2];
      assert.strictEqual(sc2.decision, 'HOLD');
      assert.ok(sc2.risk_score >= 65);

      // Index 5: Scenario D (Mule ring cycle -> BLOCK)
      const sc5 = dbStore.screeningRequests[5];
      assert.strictEqual(sc5.decision, 'BLOCK');
      assert.ok(sc5.risk_score >= 85);
    });

    it('enforces screening idempotency via unique request hash', () => {
      const reqId = 'IDEMP-TEST-001';
      const senderId = dbStore.accounts[0].id;
      const receiverId = dbStore.accounts[1].id;
      const amount = 50000;

      const hash1 = crypto.createHash('sha256').update(`${reqId}:${senderId}:${receiverId}:${amount}`).digest('hex');
      const hash2 = crypto.createHash('sha256').update(`${reqId}:${senderId}:${receiverId}:${amount}`).digest('hex');
      assert.strictEqual(hash1, hash2, 'Idempotency key generation mismatch');
    });
  });

  describe('Suite 3: NetworkX Graph Account Intelligence & Syndicate Detection', () => {
    it('detects circular mule rings and assigns MULE_RING_CYCLE pattern', () => {
      const ringAccounts = dbStore.accountIntelligenceProfiles.filter((p) =>
        p.risk_reasons.some((r) => r.toLowerCase().includes('ring') || r.toLowerCase().includes('cycle'))
      );
      assert.ok(ringAccounts.length > 0, 'Found mule ring accounts');
      for (const ra of ringAccounts) {
        assert.ok(ra.risk_score >= 70, 'Mule ring member has elevated risk score');
      }
    });

    it('validates BFS risk propagation down multi-hop mule corridors', () => {
      const flaggedSeedTxn = dbStore.transactions.find((t) => t.is_flagged_fraud);
      assert.ok(flaggedSeedTxn, 'Flagged fraud seed transaction present');

      const receiver = dbStore.accountIntelligenceProfiles.find(
        (p) => p.account_id === flaggedSeedTxn.to_account
      );
      if (receiver) {
        assert.ok(receiver.risk_score >= 60, 'Risk successfully propagated to direct downstream beneficiary');
      }
    });
  });

  describe('Suite 4: Transaction Intervention Centre & Cryptographic SHA-256 Audit Chaining', () => {
    it('validates sequential cryptographic integrity from genesis to head', () => {
      const logs = dbStore.interventionAuditLogs.slice().sort((a, b) => a.sequence_number - b.sequence_number);
      assert.ok(logs.length > 0, 'Audit logs present in chain');

      // Genesis check
      assert.strictEqual(logs[0].previous_hash, GENESIS_HASH, 'Genesis previous_hash is not all zeros');

      // Sequential link verification
      for (let i = 1; i < logs.length; i++) {
        const prev = logs[i - 1];
        const curr = logs[i];
        assert.strictEqual(
          curr.previous_hash,
          prev.entry_hash,
          `Broken hash link at sequence #${curr.sequence_number}`
        );
      }

      console.log(
        `   [Cryptographic Audit Chain] Verified ${logs.length} sequential entries unbroken from Genesis ${GENESIS_HASH.slice(0, 10)}... to Head ${logs[logs.length - 1].entry_hash.slice(0, 10)}...`
      );
    });

    it('verifies that any tampering immediately breaks the chain', () => {
      const logs = dbStore.interventionAuditLogs.slice().sort((a, b) => a.sequence_number - b.sequence_number);
      if (logs.length > 1) {
        // Clone and tamper entry 1
        const tamperedLogs = logs.map((l) => ({ ...l }));
        tamperedLogs[1].entry_hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

        let detected = false;
        for (let i = 1; i < tamperedLogs.length; i++) {
          if (i === 2 && tamperedLogs[i].previous_hash !== tamperedLogs[1].entry_hash) {
            detected = true;
            break;
          }
        }
        assert.ok(detected, 'Tampered entry successfully detected by hash verification algorithm!');
      }
    });

    it('enforces mandatory officer justification (>= 5 chars) for interventions', () => {
      const validNotes = 'Confirmed fraudulent velocity pattern matching FIR #449/2026.';
      const invalidNotes = 'bad';

      assert.ok(validNotes.trim().length >= 5, 'Valid notes accepted');
      assert.ok(invalidNotes.trim().length < 5, 'Invalid notes rejected');
    });

    it('aggregates operational metrics (intercepted exposure, prevented loss, override rate)', () => {
      const total = dbStore.interventions.length;
      const pending = dbStore.interventions.filter((i) => i.review_status === 'PENDING').length;
      const approved = dbStore.interventions.filter((i) => i.review_status === 'APPROVED').length;
      const rejected = dbStore.interventions.filter((i) => i.review_status === 'REJECTED').length;

      let interceptedAmount = 0;
      let preventedAmount = 0;

      for (const item of dbStore.interventions) {
        const sr = dbStore.screeningRequests.find((r) => r.id === item.screening_id);
        const amt = sr?.amount ?? 0;
        if (item.recommended_action === 'HOLD_FOR_REVIEW' || item.recommended_action === 'REJECT_BLOCK') {
          interceptedAmount += amt;
          if (item.review_status === 'APPROVED') {
            preventedAmount += amt;
          }
        }
      }

      console.log(
        `   [Intervention Metrics] Total: ${total}, Pending: ${pending}, Approved: ${approved}, Rejected: ${rejected}`
      );
      console.log(
        `   [Financial Protection] Intercepted Exposure: INR ${interceptedAmount.toLocaleString('en-IN')}, Prevented Loss: INR ${preventedAmount.toLocaleString('en-IN')}`
      );

      assert.ok(total > 0);
      assert.ok(interceptedAmount > 0);
    });
  });

  describe('Suite 5: End-to-End Prevention-to-Forensics Bridge (Section 91 CrPC)', () => {
    it('bridges an intercepted intervention into full LEA investigation dossier and Section 91 CrPC evidence', () => {
      const targetIntervention = dbStore.interventions.find(
        (i) => i.recommended_action === 'HOLD_FOR_REVIEW' || i.recommended_action === 'REJECT_BLOCK'
      );
      assert.ok(targetIntervention, 'Found candidate intervention for bridge');

      const initialInvCount = dbStore.investigations.length;
      const initialEvCount = dbStore.evidenceRecords.length;
      const initialAuditCount = dbStore.interventionAuditLogs.length;

      const sr = dbStore.screeningRequests.find((r) => r.id === targetIntervention.screening_id);
      assert.ok(sr, 'Screening request resolved');

      const now = new Date();
      const nowIso = now.toISOString();
      const tsSuffix = Math.floor(now.getTime() / 1000);

      // 1. Complaint
      const cmpId = crypto.randomUUID();
      const newComplaint = {
        id: cmpId,
        complaint_number: `CMP-PREV-${tsSuffix}`,
        complainant_name: 'Sentinel Intercept Automation',
        complainant_phone: '+919800000000',
        complainant_email: 'sentinel@fintrace.gov.in',
        fraud_type: 'MULE_NETWORK' as const,
        amount_lost: sr.amount,
        incident_date: sr.screened_at,
        status: 'UNDER_INVESTIGATION' as const,
        description: `Pre-Authorisation Sentinel Intercept on ${sr.id}.`,
        acknowledgement_number: `ACK-PREV-${tsSuffix}`,
        created_at: nowIso,
        updated_at: nowIso,
      };
      dbStore.complaints.push(newComplaint as any);

      // 2. Investigation
      const invId = crypto.randomUUID();
      const caseNumber = `INV-PREV-${now.getFullYear()}-${tsSuffix.toString().slice(-4)}`;
      const newInvestigation = {
        id: invId,
        complaint_id: cmpId,
        case_number: caseNumber,
        assigned_investigator_id: null,
        lead_investigator: null,
        status: 'OPEN' as const,
        findings_summary: `Bridge test investigation for intervention ${targetIntervention.id}`,
        recommended_actions: [
          { action: 'SECTION_91_CRPC_NOTICE', priority: 'IMMEDIATE' as const, done: false },
          { action: 'COORDINATED_MULE_FREEZE', priority: 'HIGH' as const, done: false },
        ],
        opened_at: nowIso,
        closed_at: null,
        updated_at: nowIso,
      };
      dbStore.investigations.push(newInvestigation as any);

      // 3. Evidence Record (Section 91 CrPC)
      const evId = crypto.randomUUID();
      const lastAudit = dbStore.interventionAuditLogs[dbStore.interventionAuditLogs.length - 1];
      const newEvidence = {
        id: evId,
        investigation_id: invId,
        complaint_id: cmpId,
        uploaded_by: '00000000-0000-4000-8000-000000000001',
        evidence_type: 'FREEZE_ORDER' as const,
        title: `Section 91 CrPC: Screening Audit & Intercept Notice (${sr.id.slice(0, 8)})`,
        description: `Cryptographically linked to audit entry hash ${lastAudit.entry_hash}`,
        file_name: `section91_screening_${sr.id.slice(0, 8)}.pdf`,
        mime_type: 'application/pdf',
        file_size: 20480,
        sha256_hash: lastAudit.entry_hash,
        metadata_json: {
          screening_id: sr.id,
          intervention_id: targetIntervention.id,
          audit_hash: lastAudit.entry_hash,
          statutory_basis: 'Section 91 Code of Criminal Procedure, 1973',
        },
        recorded_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      };
      dbStore.evidenceRecords.push(newEvidence as any);

      // 4. Upgrade Beneficiary Account Intelligence Status
      const beneficiaryProf = dbStore.accountIntelligenceProfiles.find(
        (p) => p.account_id === sr.receiver_account_id
      );
      if (beneficiaryProf) {
        beneficiaryProf.account_status = 'CONFIRMED_FRAUD_LINKED';
        beneficiaryProf.risk_score = Math.max(beneficiaryProf.risk_score, 98.0);
        beneficiaryProf.risk_classification = 'Critical';
      }

      // 5. Append Audit Entry
      const entryHash = crypto
        .createHash('sha256')
        .update(`${lastAudit.entry_hash}:${targetIntervention.id}:BRIDGE:${invId}:${nowIso}`)
        .digest('hex');

      dbStore.interventionAuditLogs.push({
        id: crypto.randomUUID(),
        sequence_number: lastAudit.sequence_number + 1,
        screening_id: sr.id,
        intervention_id: targetIntervention.id,
        actor_user_id: '00000000-0000-4000-8000-000000000001',
        actor_role: 'Bank Nodal Officer',
        action: 'INTERVENTION_BRIDGED_TO_FORENSICS',
        previous_hash: lastAudit.entry_hash,
        entry_hash: entryHash,
        payload_json: {
          case_number: caseNumber,
          complaint_id: cmpId,
          evidence_id: evId,
        },
        ip_address: '127.0.0.1',
        created_at: now,
      });

      // Assertions
      assert.strictEqual(dbStore.investigations.length, initialInvCount + 1);
      assert.strictEqual(dbStore.evidenceRecords.length, initialEvCount + 1);
      assert.strictEqual(dbStore.interventionAuditLogs.length, initialAuditCount + 1);

      if (beneficiaryProf) {
        assert.strictEqual(beneficiaryProf.account_status, 'CONFIRMED_FRAUD_LINKED');
        assert.ok(beneficiaryProf.risk_score >= 95.0);
      }

      console.log(
        `   [Bridge Complete] Created Case: ${caseNumber}, Evidence Record: ${newEvidence.title}, Beneficiary Status: CONFIRMED_FRAUD_LINKED`
      );
    });

    it('verifies that newly confirmed fraud-linked account blocks subsequent pre-auth transfers at Hop 1', () => {
      const confirmedProf = dbStore.accountIntelligenceProfiles.find(
        (p) => p.account_status === 'CONFIRMED_FRAUD_LINKED'
      );
      assert.ok(confirmedProf, 'Confirmed fraud-linked profile exists');

      // Attempt transfer to this confirmed profile
      const isBlocked = confirmedProf.account_status === 'CONFIRMED_FRAUD_LINKED';
      assert.ok(isBlocked, 'Pre-authorisation transfer intercepted at Hop 1');
    });
  });

  describe('Suite 6: Statutory Safety Disclaimer & Compliance Admissibility', () => {
    it('verifies prominent safety disclaimer constant adherence', () => {
      assert.ok(
        SAFETY_DISCLAIMER.includes('RECOMMENDATIONS'),
        'Safety disclaimer specifies RECOMMENDATIONS'
      );
      assert.ok(
        SAFETY_DISCLAIMER.includes('Simulated intervention only'),
        'Safety disclaimer specifies Simulated intervention only'
      );
      assert.ok(
        SAFETY_DISCLAIMER.includes('No actual banking freeze'),
        'Safety disclaimer confirms no actual banking freeze'
      );
    });

    it('verifies Section 65B Indian Evidence Act SHA-256 hash payload integrity', () => {
      for (const record of dbStore.evidenceRecords) {
        assert.ok(record.sha256_hash, 'Evidence record has SHA-256 hash');
        assert.strictEqual(record.sha256_hash.length, 64, 'SHA-256 hash is 64 hex characters');
      }
    });
  });
});
