import crypto from 'node:crypto';
import { query, withTransaction } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { clearProfileCache } from '../screening/screening.service.js';

const DISCLAIMER =
  'FinTrace returns RECOMMENDATIONS. Simulated intervention only. No actual banking freeze or fund blocking is executed on live financial rails.';

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export interface InterventionFilter {
  status?: string;
  action?: string;
  riskLevel?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export async function listInterventions(filter: InterventionFilter) {
  const page = Math.max(1, filter.page || 1);
  const limit = Math.min(100, Math.max(1, filter.limit || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filter.status && filter.status !== 'ALL') {
    conditions.push(`i.review_status = $${paramIdx++}`);
    params.push(filter.status);
  }

  if (filter.action && filter.action !== 'ALL') {
    conditions.push(`i.recommended_action = $${paramIdx++}`);
    params.push(filter.action);
  }

  if (filter.riskLevel && filter.riskLevel !== 'ALL') {
    conditions.push(`s.risk_classification = $${paramIdx++}`);
    params.push(filter.riskLevel);
  }

  if (filter.search?.trim()) {
    const term = `%${filter.search.trim()}%`;
    conditions.push(`(
      fa.account_number ILIKE $${paramIdx} OR
      fa.holder_name ILIKE $${paramIdx} OR
      ta.account_number ILIKE $${paramIdx} OR
      ta.holder_name ILIKE $${paramIdx} OR
      i.id::text ILIKE $${paramIdx} OR
      s.id::text ILIKE $${paramIdx}
    )`);
    params.push(term);
    paramIdx++;
  }

  if (filter.startDate) {
    conditions.push(`i.created_at >= $${paramIdx++}`);
    params.push(new Date(filter.startDate));
  }

  if (filter.endDate) {
    conditions.push(`i.created_at <= $${paramIdx++}`);
    params.push(new Date(filter.endDate));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM transaction_interventions i
    JOIN transaction_screening_requests s ON s.id = i.screening_id
    JOIN bank_accounts fa ON fa.id = s.sender_account_id
    JOIN bank_accounts ta ON ta.id = s.receiver_account_id
    ${whereClause}
  `;
  const countRes = await query<{ total: number }>(countSql, params);
  const total = countRes.rows[0]?.total || 0;

  const dataSql = `
    SELECT 
      i.id,
      i.screening_id,
      i.recommended_action,
      i.review_status,
      i.resolved_by,
      u.full_name AS resolver_name,
      u.role AS resolver_role,
      i.resolved_at,
      i.review_notes,
      i.created_at,
      i.updated_at,

      s.amount,
      s.currency,
      s.channel,
      s.client_id,
      s.screened_at,
      s.decision,
      s.risk_score AS screening_risk_score,
      s.risk_classification,

      fa.id AS sender_account_id,
      fa.account_number AS sender_account_number,
      fa.holder_name AS sender_holder_name,
      COALESCE(fp.bank_name, 'FinTrace Bank') AS sender_bank_name,
      COALESCE(fp.risk_score, 10.0) AS sender_risk_score,
      COALESCE(fp.risk_classification, 'Low') AS sender_risk_classification,

      ta.id AS receiver_account_id,
      ta.account_number AS receiver_account_number,
      ta.holder_name AS receiver_holder_name,
      COALESCE(tp.bank_name, 'FinTrace Bank') AS receiver_bank_name,
      COALESCE(tp.risk_score, 10.0) AS receiver_risk_score,
      COALESCE(tp.risk_classification, 'Low') AS receiver_risk_classification,

      COALESCE(a.composite_score, s.risk_score) AS composite_risk_score,
      COALESCE(a.score_source, 'Rule-based risk score') AS score_source,
      COALESCE(a.rules_triggered, '[]'::jsonb) AS rules_triggered
    FROM transaction_interventions i
    JOIN transaction_screening_requests s ON s.id = i.screening_id
    LEFT JOIN transaction_risk_assessments a ON a.screening_id = s.id
    JOIN bank_accounts fa ON fa.id = s.sender_account_id
    JOIN bank_accounts ta ON ta.id = s.receiver_account_id
    LEFT JOIN account_intelligence_profiles fp ON fp.account_id = fa.id
    LEFT JOIN account_intelligence_profiles tp ON tp.account_id = ta.id
    LEFT JOIN users u ON u.id = i.resolved_by
    ${whereClause}
    ORDER BY i.created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;

  const dataRes = await query(dataSql, [...params, limit, offset]);

  return {
    interventions: dataRes.rows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    limitations_disclaimer: DISCLAIMER,
  };
}

export async function getInterventionById(id: string) {
  const sql = `
    SELECT 
      i.id,
      i.screening_id,
      i.recommended_action,
      i.review_status,
      i.resolved_by,
      u.full_name AS resolver_name,
      u.role AS resolver_role,
      i.resolved_at,
      i.review_notes,
      i.created_at,
      i.updated_at,

      s.amount,
      s.currency,
      s.channel,
      s.client_id,
      s.screened_at,
      s.decision,
      s.risk_score AS screening_risk_score,
      s.risk_classification,

      fa.id AS sender_account_id,
      fa.account_number AS sender_account_number,
      fa.holder_name AS sender_holder_name,
      COALESCE(fp.bank_name, 'FinTrace Bank') AS sender_bank_name,
      COALESCE(fp.risk_score, 10.0) AS sender_risk_score,
      COALESCE(fp.risk_classification, 'Low') AS sender_risk_classification,

      ta.id AS receiver_account_id,
      ta.account_number AS receiver_account_number,
      ta.holder_name AS receiver_holder_name,
      COALESCE(tp.bank_name, 'FinTrace Bank') AS receiver_bank_name,
      COALESCE(tp.risk_score, 10.0) AS receiver_risk_score,
      COALESCE(tp.risk_classification, 'Low') AS receiver_risk_classification,

      COALESCE(a.composite_score, s.risk_score) AS composite_risk_score,
      COALESCE(a.score_source, 'Rule-based risk score') AS score_source,
      COALESCE(a.rules_triggered, '[]'::jsonb) AS rules_triggered,
      COALESCE(a.ml_factors, '[]'::jsonb) AS ml_factors,
      a.plain_language_explanation,
      a.model_version
    FROM transaction_interventions i
    JOIN transaction_screening_requests s ON s.id = i.screening_id
    LEFT JOIN transaction_risk_assessments a ON a.screening_id = s.id
    JOIN bank_accounts fa ON fa.id = s.sender_account_id
    JOIN bank_accounts ta ON ta.id = s.receiver_account_id
    LEFT JOIN account_intelligence_profiles fp ON fp.account_id = fa.id
    LEFT JOIN account_intelligence_profiles tp ON tp.account_id = ta.id
    LEFT JOIN users u ON u.id = i.resolved_by
    WHERE i.id = $1
    LIMIT 1
  `;

  const res = await query(sql, [id]);
  if (!res.rows[0]) {
    throw new AppError(`Intervention '${id}' not found.`, 404, 'INTERVENTION_NOT_FOUND');
  }

  const intervention = res.rows[0];

  // Fetch tamper-evident audit trail entries
  const auditRes = await query(
    `SELECT 
       al.id, al.sequence_number, al.screening_id, al.intervention_id,
       al.actor_user_id, u.full_name AS actor_name, al.actor_role,
       al.action, al.previous_hash, al.entry_hash, al.payload_json,
       al.ip_address, al.created_at
     FROM intervention_audit_logs al
     LEFT JOIN users u ON u.id = al.actor_user_id
     WHERE al.intervention_id = $1 OR al.screening_id = $2
     ORDER BY al.sequence_number ASC`,
    [id, intervention.screening_id]
  );

  return {
    ...intervention,
    audit_trail: auditRes.rows,
    limitations_disclaimer: DISCLAIMER,
  };
}

export async function reviewIntervention(
  id: string,
  payload: {
    decision: 'APPROVED' | 'REJECTED' | 'ESCALATED' | 'FALSE_POSITIVE';
    action?: 'ALLOW' | 'ADDITIONAL_VERIFICATION' | 'HOLD_FOR_REVIEW' | 'REJECT_BLOCK';
    notes: string;
  },
  actor: { userId: string; role: string; fullName: string },
  ipAddress: string
) {
  return await withTransaction(async (client) => {
    // 1. Fetch current intervention
    const existingRes = await client.query(
      `SELECT * FROM transaction_interventions WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!existingRes.rows[0]) {
      throw new AppError(`Intervention '${id}' not found.`, 404, 'INTERVENTION_NOT_FOUND');
    }
    const current = existingRes.rows[0];

    const finalAction = payload.action || current.recommended_action;
    const now = new Date();
    const nowIso = now.toISOString();

    // 2. Update intervention
    const updateRes = await client.query(
      `UPDATE transaction_interventions
       SET review_status = $1,
           recommended_action = $2,
           resolved_by = $3,
           resolved_at = $4,
           review_notes = $5,
           updated_at = $4
       WHERE id = $6
       RETURNING *`,
      [payload.decision, finalAction, actor.userId, now, payload.notes, id]
    );

    // 3. Cryptographic Tamper-Evident SHA-256 Hash Chaining
    const lastAuditRes = await client.query(
      `SELECT entry_hash FROM intervention_audit_logs ORDER BY sequence_number DESC LIMIT 1`
    );
    const prevHash = lastAuditRes.rows[0]?.entry_hash || GENESIS_HASH;

    const actionName = `INTERVENTION_${payload.decision}`;
    const payloadJson = {
      decision: payload.decision,
      action: finalAction,
      notes: payload.notes,
      prior_status: current.review_status,
      screening_id: current.screening_id,
      reviewed_by: actor.fullName,
    };

    const entryHash = crypto
      .createHash('sha256')
      .update(`${prevHash}:${id}:${actionName}:${actor.userId}:${nowIso}`)
      .digest('hex');

    const auditInsertRes = await client.query(
      `INSERT INTO intervention_audit_logs (
         screening_id, intervention_id, actor_user_id, actor_role, action,
         previous_hash, entry_hash, payload_json, ip_address, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       RETURNING *`,
      [
        current.screening_id,
        id,
        actor.userId,
        actor.role,
        actionName,
        prevHash,
        entryHash,
        JSON.stringify(payloadJson),
        ipAddress || '127.0.0.1',
        now,
      ]
    );

    return {
      intervention: updateRes.rows[0],
      audit_entry: auditInsertRes.rows[0],
      limitations_disclaimer: DISCLAIMER,
    };
  });
}

export async function verifyAuditHashChain() {
  const res = await query(
    `SELECT id, sequence_number, screening_id, intervention_id,
            actor_user_id, actor_role, action, previous_hash,
            entry_hash, payload_json, ip_address, created_at
     FROM intervention_audit_logs
     ORDER BY sequence_number ASC`
  );

  const logs = res.rows;
  if (logs.length === 0) {
    return {
      status: 'VALID' as const,
      total_entries_verified: 0,
      first_sequence: null,
      last_sequence: null,
      genesis_hash: GENESIS_HASH,
      latest_hash: null,
      broken_link_index: null,
      broken_details: null,
      verified_at: new Date().toISOString(),
      limitations_disclaimer: DISCLAIMER,
    };
  }

  let brokenIndex: number | null = null;
  let brokenDetails: string | null = null;

  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i];
    if (i === 0) {
      if (entry.previous_hash !== GENESIS_HASH) {
        brokenIndex = 0;
        brokenDetails = `Genesis entry previous_hash mismatch: expected ${GENESIS_HASH}, got ${entry.previous_hash}`;
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

  return {
    status: (brokenIndex === null ? 'VALID' : 'COMPROMISED') as 'VALID' | 'COMPROMISED',
    total_entries_verified: logs.length,
    first_sequence: logs[0]?.sequence_number ?? null,
    last_sequence: logs[logs.length - 1]?.sequence_number ?? null,
    genesis_hash: logs[0]?.previous_hash ?? GENESIS_HASH,
    latest_hash: logs[logs.length - 1]?.entry_hash ?? null,
    broken_link_index: brokenIndex,
    broken_details: brokenDetails,
    verified_at: new Date().toISOString(),
    limitations_disclaimer: DISCLAIMER,
  };
}

export async function getInterventionMetrics() {
  const sql = `
    SELECT
      COUNT(*)::int AS total_interventions,
      COUNT(*) FILTER (WHERE i.review_status = 'PENDING')::int AS pending_count,
      COUNT(*) FILTER (WHERE i.review_status = 'APPROVED')::int AS approved_count,
      COUNT(*) FILTER (WHERE i.review_status = 'REJECTED')::int AS rejected_count,
      COUNT(*) FILTER (WHERE i.review_status = 'ESCALATED')::int AS escalated_count,
      COUNT(*) FILTER (WHERE i.review_status = 'FALSE_POSITIVE')::int AS false_positive_count,
      COUNT(*) FILTER (WHERE i.review_status = 'AUTO_RESOLVED')::int AS auto_resolved_count,
      
      COUNT(*) FILTER (WHERE i.recommended_action = 'ALLOW')::int AS action_allow,
      COUNT(*) FILTER (WHERE i.recommended_action = 'ADDITIONAL_VERIFICATION')::int AS action_verify,
      COUNT(*) FILTER (WHERE i.recommended_action = 'HOLD_FOR_REVIEW')::int AS action_hold,
      COUNT(*) FILTER (WHERE i.recommended_action = 'REJECT_BLOCK')::int AS action_block,

      COALESCE(SUM(s.amount) FILTER (WHERE i.recommended_action IN ('HOLD_FOR_REVIEW', 'REJECT_BLOCK')), 0)::numeric AS total_intercepted_amount,
      COALESCE(SUM(s.amount) FILTER (WHERE i.review_status = 'APPROVED' AND i.recommended_action IN ('HOLD_FOR_REVIEW', 'REJECT_BLOCK')), 0)::numeric AS total_prevented_loss_amount,

      COUNT(*) FILTER (WHERE i.review_status IN ('REJECTED', 'FALSE_POSITIVE'))::int AS override_count,
      COUNT(*) FILTER (WHERE i.review_status = 'PENDING' AND s.risk_score >= 75)::int AS high_risk_queue_count,

      COALESCE(AVG(EXTRACT(EPOCH FROM (i.resolved_at - i.created_at))) FILTER (WHERE i.resolved_at IS NOT NULL), 0)::numeric AS avg_review_time_sec
    FROM transaction_interventions i
    JOIN transaction_screening_requests s ON s.id = i.screening_id
  `;

  const res = await query(sql);
  const row = res.rows[0];

  const total = Number(row.total_interventions) || 0;
  const overrides = Number(row.override_count) || 0;
  const falsePositives = Number(row.false_positive_count) || 0;

  return {
    total_interventions: total,
    pending_count: Number(row.pending_count) || 0,
    approved_count: Number(row.approved_count) || 0,
    rejected_count: Number(row.rejected_count) || 0,
    escalated_count: Number(row.escalated_count) || 0,
    false_positive_count: falsePositives,
    auto_resolved_count: Number(row.auto_resolved_count) || 0,
    by_action: {
      ALLOW: Number(row.action_allow) || 0,
      ADDITIONAL_VERIFICATION: Number(row.action_verify) || 0,
      HOLD_FOR_REVIEW: Number(row.action_hold) || 0,
      REJECT_BLOCK: Number(row.action_block) || 0,
    },
    total_intercepted_amount: Number(row.total_intercepted_amount) || 0,
    total_prevented_loss_amount: Number(row.total_prevented_loss_amount) || 0,
    override_count: overrides,
    override_rate_pct: total > 0 ? Math.round((overrides / total) * 1000) / 10 : 0,
    false_positive_rate_pct: total > 0 ? Math.round((falsePositives / total) * 1000) / 10 : 0,
    avg_review_time_sec: Math.round(Number(row.avg_review_time_sec)),
    high_risk_queue_count: Number(row.high_risk_queue_count) || 0,
    limitations_disclaimer: DISCLAIMER,
  };
}

export interface BridgeToForensicsInput {
  caseTitle?: string;
  generateEvidenceRecord?: boolean;
  flagAccountAsConfirmed?: boolean;
  notes?: string;
}

export async function bridgeInterventionToForensics(
  id: string,
  input: BridgeToForensicsInput,
  actor: { userId: string; role: string; fullName: string },
  ipAddress: string
) {
  return await withTransaction(async (client) => {
    // 1. Fetch intervention + screening
    const invRes = await client.query(
      `SELECT i.*, 
              s.id AS screening_request_id,
              s.sender_account_id,
              s.receiver_account_id,
              s.amount,
              s.currency,
              s.channel,
              s.risk_score,
              s.risk_classification,
              s.screened_at,
              fa.account_number AS sender_acc,
              fa.holder_name AS sender_name,
              ta.account_number AS receiver_acc,
              ta.holder_name AS receiver_name
       FROM transaction_interventions i
       JOIN transaction_screening_requests s ON s.id = i.screening_id
       JOIN bank_accounts fa ON fa.id = s.sender_account_id
       JOIN bank_accounts ta ON ta.id = s.receiver_account_id
       WHERE i.id = $1
       FOR UPDATE`,
      [id]
    );

    if (!invRes.rows[0]) {
      throw new AppError(`Intervention '${id}' not found.`, 404, 'INTERVENTION_NOT_FOUND');
    }
    const inv = invRes.rows[0];

    // Fetch latest entry_hash from intervention_audit_logs for this intervention
    const auditRes = await client.query(
      `SELECT entry_hash FROM intervention_audit_logs 
       WHERE intervention_id = $1 OR screening_id = $2
       ORDER BY sequence_number DESC LIMIT 1`,
      [id, inv.screening_id]
    );
    const latestAuditHash = auditRes.rows[0]?.entry_hash || GENESIS_HASH;

    const now = new Date();
    const timestampSuffix = Math.floor(now.getTime() / 1000);

    // 2. Create linked complaint record
    const cmpNumber = `CMP-PREV-${timestampSuffix}`;
    const ackNumber = `ACK-PREV-${timestampSuffix}`;
    const cmpTitle =
      input.caseTitle ||
      `Section 91 CrPC Pre-Authorisation Sentinel Case: Intercepted ${inv.channel} ₹${Number(
        inv.amount
      ).toLocaleString('en-IN')}`;

    const cmpInsert = await client.query(
      `INSERT INTO complaints (
         complaint_number, complainant_name, complainant_phone,
         fraud_type, amount_lost, incident_date, status,
         description, acknowledgement_number
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        cmpNumber,
        inv.sender_name || 'Automated Pre-Authorisation Sentinel',
        '+919800000000',
        'MULE_NETWORK',
        inv.amount,
        inv.screened_at || now,
        'UNDER_INVESTIGATION',
        `${cmpTitle}. Screened with Risk Score ${inv.risk_score}/100. Recommended Action: ${
          inv.recommended_action
        }. ${input.notes || ''}`,
        ackNumber,
      ]
    );
    const complaint = cmpInsert.rows[0];

    // 3. Create linked investigation record
    const caseNumber = `INV-PREV-${now.getFullYear()}-${timestampSuffix.toString().slice(-4)}`;
    const invInsert = await client.query(
      `INSERT INTO investigations (
         case_number, complaint_id, lead_investigator, status,
         findings_summary, recommended_actions, opened_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING *`,
      [
        caseNumber,
        complaint.id,
        null,
        'OPEN',
        `Pre-authorisation intervention case bridged to forensic casework. Intercepted transfer from ${inv.sender_acc} to ${inv.receiver_acc}. Screening ID: ${inv.screening_id}`,
        JSON.stringify([
          'SECTION_91_CRPC_NOTICE',
          'COORDINATED_MULE_FREEZE',
          'ATM_SURVEILLANCE_ALERT',
        ]),
        now,
      ]
    );
    const investigation = invInsert.rows[0];

    // 4. Create Section 91 CrPC evidence record
    let evidenceRecord = null;
    if (input.generateEvidenceRecord !== false) {
      const evDesc =
        `Section 91 CrPC Pre-Authorisation Screening Report for Transaction ${inv.screening_id}. ` +
        `Amount: ₹${Number(inv.amount).toLocaleString('en-IN')}, Channel: ${inv.channel}, Composite Score: ${
          inv.risk_score
        }/100. ` +
        `Cryptographically linked to audit entry hash: ${latestAuditHash}.`;

      const evInsert = await client.query(
        `INSERT INTO evidence_records (
           investigation_id, complaint_id, uploaded_by, evidence_type,
           title, description, file_name, mime_type, file_size,
           sha256_hash, metadata_json, recorded_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
         RETURNING *`,
        [
          investigation.id,
          complaint.id,
          actor.userId,
          'FREEZE_ORDER',
          `Section 91 CrPC: Screening Audit & Intercept Notice (${inv.screening_id.slice(0, 8)})`,
          evDesc,
          `section91_screening_${inv.screening_id.slice(0, 8)}.pdf`,
          'application/pdf',
          24576,
          latestAuditHash,
          JSON.stringify({
            screening_id: inv.screening_id,
            intervention_id: id,
            audit_hash: latestAuditHash,
            sender_account: inv.sender_acc,
            receiver_account: inv.receiver_acc,
            amount: inv.amount,
            channel: inv.channel,
            decision: inv.review_status,
            bridged_by: actor.fullName,
            statutory_basis: 'Section 91 Code of Criminal Procedure, 1973',
          }),
          now,
        ]
      );
      evidenceRecord = evInsert.rows[0];
    }

    // 5. Update beneficiary account intelligence if requested
    let accountUpdated = false;
    if (input.flagAccountAsConfirmed) {
      await client.query(
        `UPDATE account_intelligence_profiles
         SET account_status = 'CONFIRMED_FRAUD_LINKED',
             risk_score = GREATEST(risk_score, 95.0),
             risk_classification = 'CRITICAL',
             last_assessment_at = $1,
             updated_at = $1
         WHERE account_id = $2`,
        [now, inv.receiver_account_id]
      );
      clearProfileCache(inv.receiver_account_id);
      accountUpdated = true;
    }

    // 6. Record in cryptographic audit chain
    const lastAuditRes = await client.query(
      `SELECT entry_hash FROM intervention_audit_logs ORDER BY sequence_number DESC LIMIT 1`
    );
    const prevHash = lastAuditRes.rows[0]?.entry_hash || GENESIS_HASH;
    const actionName = 'INTERVENTION_BRIDGED_TO_FORENSICS';
    const entryHash = crypto
      .createHash('sha256')
      .update(`${prevHash}:${id}:${actionName}:${investigation.id}:${now.toISOString()}`)
      .digest('hex');

    await client.query(
      `INSERT INTO intervention_audit_logs (
         screening_id, intervention_id, actor_user_id, actor_role, action,
         previous_hash, entry_hash, payload_json, ip_address, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        inv.screening_id,
        id,
        actor.userId,
        actor.role,
        actionName,
        prevHash,
        entryHash,
        JSON.stringify({
          complaint_id: complaint.id,
          complaint_number: cmpNumber,
          investigation_id: investigation.id,
          case_number: caseNumber,
          evidence_record_id: evidenceRecord?.id ?? null,
          account_status_updated: accountUpdated,
          bridged_by: actor.fullName,
        }),
        ipAddress || '127.0.0.1',
        now,
      ]
    );

    return {
      complaint,
      investigation,
      evidence_record: evidenceRecord,
      account_updated: accountUpdated,
      audit_entry_hash: entryHash,
      message: `Intervention bridged to forensic investigation ${caseNumber} with Section 91 CrPC evidence record.`,
      limitations_disclaimer: DISCLAIMER,
    };
  });
}
