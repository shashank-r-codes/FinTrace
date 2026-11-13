import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { generateSyntheticDataset } from './synthetic_generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://fintrace:fintrace_dev_pass@localhost:5432/fintrace_db';

async function runSeed(): Promise<void> {
  const shouldReset = process.argv.includes('--reset');
  const pool = new Pool({ connectionString: databaseUrl });
  const data = generateSyntheticDataset();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (shouldReset) {
      console.log('Resetting synthetic tables...');
      await client.query(`
        TRUNCATE TABLE
          audit_logs,
          evidence_records,
          investigations,
          alerts,
          risk_scores,
          atm_predictions,
          ml_predictions,
          model_metrics,
          fraud_detection_results,
          transaction_networks,
          atm_withdrawals,
          suspicious_accounts,
          beneficiary_accounts,
          transactions,
          bank_accounts,
          atms,
          complaints,
          victims,
          investigators,
          refresh_tokens,
          users,
          financial_institutions,
          roles
        RESTART IDENTITY CASCADE;
      `);
    }

    // 1. Roles
    for (const r of data.roles) {
      await client.query(
        `INSERT INTO roles (id, name, description, permissions)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, permissions = EXCLUDED.permissions`,
        [r.id, r.name, r.description, JSON.stringify(r.permissions)]
      );
    }

    // 2. Institutions
    for (const inst of data.institutions) {
      await client.query(
        `INSERT INTO financial_institutions (id, name, ifsc_prefix, bank_code, nodal_email, headquarters, is_synthetic)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [inst.id, inst.name, inst.ifsc_prefix, inst.bank_code, inst.nodal_email, inst.headquarters]
      );
    }

    // 3. Users & Investigators
    const roleMap = new Map(data.roles.map((r) => [r.name, r.id]));
    for (const u of data.users) {
      const roleId = roleMap.get(u.role_name);
      if (!roleId) {
        throw new Error(`Missing role ID for ${u.role_name}`);
      }
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, role_id, institution_id, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (email) DO NOTHING`,
        [u.id, u.email, u.password_hash, u.full_name, roleId, u.institution_id]
      );

      if (u.investigator) {
        await client.query(
          `INSERT INTO investigators (id, user_id, badge_number, unit_name, jurisdiction, specialization, active_caseload)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id) DO NOTHING`,
          [
            u.investigator.id,
            u.id,
            u.investigator.badge_number,
            u.investigator.unit_name,
            u.investigator.jurisdiction,
            u.investigator.specialization,
            u.investigator.active_caseload,
          ]
        );
      }
    }

    // 4. Victims
    for (const v of data.victims) {
      await client.query(
        `INSERT INTO victims (id, full_name, phone_masked, email, city, state, home_lat, home_lng, is_synthetic)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [v.id, v.full_name, v.phone_masked, v.email, v.city, v.state, v.home_lat, v.home_lng]
      );
    }

    // 5. ATMs
    for (const atm of data.atms) {
      await client.query(
        `INSERT INTO atms (id, bank, institution_id, address, locality, city, state, lat, lng, cash_capacity_tier, is_24x7, is_synthetic)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [
          atm.id,
          atm.bank,
          atm.institution_id,
          atm.address,
          atm.locality,
          atm.city,
          atm.state,
          atm.lat,
          atm.lng,
          atm.cash_capacity_tier,
          atm.is_24x7,
        ]
      );
    }

    // 6. Bank Accounts
    for (const acc of data.accounts) {
      await client.query(
        `INSERT INTO bank_accounts (
           id, account_number, institution_id, holder_name, account_type,
           ifsc_code, branch_city, branch_lat, branch_lng, kyc_verified,
           account_age_days, is_frozen, is_synthetic
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE)
         ON CONFLICT (account_number) DO NOTHING`,
        [
          acc.id,
          acc.account_number,
          acc.institution_id,
          acc.holder_name,
          acc.account_type,
          acc.ifsc_code,
          acc.branch_city,
          acc.branch_lat,
          acc.branch_lng,
          acc.kyc_verified,
          acc.account_age_days,
          acc.is_frozen,
        ]
      );
    }

    // 7. Complaints
    for (const cmp of data.complaints) {
      await client.query(
        `INSERT INTO complaints (
           id, complaint_number, victim_id, assigned_to, fraud_type,
           reported_amount, currency, incident_timestamp, reported_at,
           status, priority, summary, city, is_synthetic
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'INR', $7, $8, $9, $10, $11, $12, TRUE)
         ON CONFLICT (complaint_number) DO NOTHING`,
        [
          cmp.id,
          cmp.complaint_number,
          cmp.victim_id,
          cmp.assigned_to,
          cmp.fraud_type,
          cmp.reported_amount,
          cmp.incident_timestamp,
          cmp.reported_at,
          cmp.status,
          cmp.priority,
          cmp.summary,
          cmp.city,
        ]
      );
    }

    // 8. Transactions & Beneficiary Aggregations
    const beneficiaryAgg = new Map<
      string,
      { source: string; target: string; total: number; count: number; firstAt: Date }
    >();

    for (const tx of data.transactions) {
      await client.query(
        `INSERT INTO transactions (
           txn_id, from_account, to_account, amount, currency, timestamp,
           channel, complaint_id, hop_depth, is_flagged_fraud, remarks, is_synthetic
         )
         VALUES ($1, $2, $3, $4, 'INR', $5, $6, $7, $8, $9, $10, TRUE)
         ON CONFLICT (txn_id) DO NOTHING`,
        [
          tx.txn_id,
          tx.from_account,
          tx.to_account,
          tx.amount,
          tx.timestamp,
          tx.channel,
          tx.complaint_id,
          tx.hop_depth,
          tx.is_flagged_fraud,
          tx.remarks,
        ]
      );

      const pairKey = `${tx.from_account}:${tx.to_account}`;
      const existing = beneficiaryAgg.get(pairKey);
      if (existing) {
        existing.total += tx.amount;
        existing.count += 1;
        if (tx.timestamp < existing.firstAt) existing.firstAt = tx.timestamp;
      } else {
        beneficiaryAgg.set(pairKey, {
          source: tx.from_account,
          target: tx.to_account,
          total: tx.amount,
          count: 1,
          firstAt: tx.timestamp,
        });
      }
    }

    for (const b of beneficiaryAgg.values()) {
      await client.query(
        `INSERT INTO beneficiary_accounts (source_account_id, beneficiary_id, added_at, total_transferred, transfer_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_account_id, beneficiary_id) DO UPDATE
         SET total_transferred = EXCLUDED.total_transferred, transfer_count = EXCLUDED.transfer_count`,
        [b.source, b.target, b.firstAt, b.total.toFixed(2), b.count]
      );
    }

    // 9. ATM Withdrawals
    for (const wd of data.atmWithdrawals) {
      await client.query(
        `INSERT INTO atm_withdrawals (id, atm_id, account_id, complaint_id, amount, withdrawn_at, card_last4, is_flagged_cashout, is_synthetic)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [
          wd.id,
          wd.atm_id,
          wd.account_id,
          wd.complaint_id,
          wd.amount,
          wd.withdrawn_at,
          wd.card_last4,
          wd.is_flagged_cashout,
        ]
      );
    }

    // 10. Suspicious Accounts
    for (const sa of data.suspiciousAccounts) {
      await client.query(
        `INSERT INTO suspicious_accounts (id, account_id, complaint_id, classification, mule_probability, score_source, reason, flagged_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (account_id, complaint_id) DO NOTHING`,
        [
          sa.id,
          sa.account_id,
          sa.complaint_id,
          sa.classification,
          sa.mule_probability,
          sa.score_source,
          sa.reason,
          sa.flagged_by,
          sa.status,
        ]
      );
    }

    // 11. ATM Predictions
    for (const ap of data.atmPredictions) {
      await client.query(
        `INSERT INTO atm_predictions (
           id, atm_id, complaint_id, risk_score, risk_level, "window", confidence,
           score_source, linked_accounts_json, relevant_paths_json, explanation_json,
           limitations_text, model_version, rank_order
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14)
         ON CONFLICT (id) DO NOTHING`,
        [
          ap.id,
          ap.atm_id,
          ap.complaint_id,
          ap.risk_score,
          ap.risk_level,
          ap.window,
          ap.confidence,
          ap.score_source,
          JSON.stringify(ap.linked_accounts_json),
          JSON.stringify(ap.relevant_paths_json),
          JSON.stringify(ap.explanation_json),
          ap.limitations_text,
          ap.model_version,
          ap.rank_order,
        ]
      );
    }

    // 12. Alerts
    for (const al of data.alerts) {
      await client.query(
        `INSERT INTO alerts (id, complaint_id, account_id, atm_id, alert_type, severity, status, title, description, score_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          al.id,
          al.complaint_id,
          al.account_id,
          al.atm_id,
          al.alert_type,
          al.severity,
          al.status,
          al.title,
          al.description,
          al.score_source,
        ]
      );
    }

    // 13. Investigations
    for (const inv of data.investigations) {
      await client.query(
        `INSERT INTO investigations (id, case_number, complaint_id, lead_investigator, status, findings_summary, recommended_actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (case_number) DO NOTHING`,
        [
          inv.id,
          inv.case_number,
          inv.complaint_id,
          inv.lead_investigator,
          inv.status,
          inv.findings_summary,
          JSON.stringify(inv.recommended_actions),
        ]
      );
    }

    // 14. Evidence Records
    for (const ev of data.evidenceRecords) {
      await client.query(
        `INSERT INTO evidence_records (id, investigation_id, complaint_id, uploaded_by, evidence_type, title, description, file_name, sha256_hash, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          ev.id,
          ev.investigation_id,
          ev.complaint_id,
          ev.uploaded_by,
          ev.evidence_type,
          ev.title,
          ev.description,
          ev.file_name,
          ev.sha256_hash,
          JSON.stringify(ev.metadata_json),
        ]
      );
    }

    // 15. Initial Seed Audit Entry
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, resource_type, resource_id, details_json)
       VALUES ($1, 'Administrator', 'SYNTHETIC_SEED_APPLIED', 'SYSTEM', 'fintrace-demo', $2::jsonb)`,
      [
        data.users[0].id,
        JSON.stringify({
          is_synthetic: true,
          complaints: data.complaints.length,
          accounts: data.accounts.length,
          transactions: data.transactions.length,
          atms: data.atms.length,
        }),
      ]
    );

    await client.query('COMMIT');

    console.log('FinTrace synthetic seed completed successfully:');
    console.log(`  Roles:               ${data.roles.length}`);
    console.log(`  Users:               ${data.users.length} (demo password: FinTrace@Demo2026)`);
    console.log(`  Institutions:        ${data.institutions.length}`);
    console.log(`  ATMs (Bengaluru):    ${data.atms.length}`);
    console.log(`  Bank Accounts:       ${data.accounts.length}`);
    console.log(`  Complaints:          ${data.complaints.length}`);
    console.log(`  Transactions:        ${data.transactions.length}`);
    console.log(`  ATM Withdrawals:     ${data.atmWithdrawals.length}`);
    console.log(`  ATM Predictions:     ${data.atmPredictions.length}`);
    console.log(`  Alerts:              ${data.alerts.length}`);
    console.log(`  Investigations:      ${data.investigations.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
