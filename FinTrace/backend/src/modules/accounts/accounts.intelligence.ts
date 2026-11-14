import { z } from 'zod';
import { query, withTransaction } from '../../config/db.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { AppError } from '../../middleware/errorHandler.js';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

export const listIntelligenceQuerySchema = z.object({
  search: z.string().max(100).optional(),
  bank: z.string().max(100).optional(),
  bankName: z.string().max(100).optional(),
  riskCategory: z.enum(['Low', 'Medium', 'High', 'Critical', 'Under Investigation', 'ALL']).optional(),
  riskClassification: z.enum(['Low', 'Medium', 'High', 'Critical', 'Under Investigation', 'ALL']).optional(),
  classification: z.enum([
    'NORMAL',
    'SUSPICIOUS_ACCOUNT',
    'SUSPECTED_MULE_ACCOUNT',
    'CONFIRMED_FRAUD_LINKED',
    'ALL',
  ]).optional(),
  accountStatus: z.enum([
    'NORMAL',
    'SUSPICIOUS_ACCOUNT',
    'SUSPECTED_MULE_ACCOUNT',
    'CONFIRMED_FRAUD_LINKED',
    'ALL',
  ]).optional(),
  investigationStatus: z.enum(['ACTIVE', 'UNDER_INVESTIGATION', 'CLEARED', 'FROZEN', 'ALL']).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(100).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z
    .enum([
      'risk_score',
      'velocity_score',
      'incoming_frequency_24h',
      'outgoing_frequency_24h',
      'last_assessed_at',
      'account_number',
    ])
    .default('risk_score'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const updateClassificationSchema = z.object({
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
});

export const reEvaluateQuerySchema = z.object({
  timeWindowHours: z.coerce.number().int().min(1).max(168).default(24),
});

// =============================================================================
// QUERY FUNCTIONS (POSTGRESQL)
// =============================================================================

export async function getIntelligenceRegistry(
  params: z.infer<typeof listIntelligenceQuerySchema>
) {
  const conditions: string[] = [];
  const queryParams: unknown[] = [];

  if (params.search) {
    queryParams.push(`%${params.search}%`);
    const idx = queryParams.length;
    conditions.push(
      `(ba.account_number ILIKE $${idx} OR ba.holder_name ILIKE $${idx} OR ba.branch_city ILIKE $${idx} OR fi.name ILIKE $${idx} OR fi.bank_code ILIKE $${idx})`
    );
  }

  const bank = params.bankName || params.bank;
  if (bank && bank !== 'ALL') {
    queryParams.push(bank);
    const idx = queryParams.length;
    conditions.push(`(fi.bank_code = $${idx} OR fi.name ILIKE '%' || $${idx} || '%' OR fi.id::text = $${idx})`);
  }

  const riskCat = params.riskClassification || params.riskCategory;
  if (riskCat && riskCat !== 'ALL') {
    queryParams.push(riskCat);
    conditions.push(`aip.risk_classification = $${queryParams.length}`);
  }

  const status = params.accountStatus || params.classification;
  if (status && status !== 'ALL') {
    queryParams.push(status);
    conditions.push(`aip.account_status = $${queryParams.length}`);
  }

  if (params.investigationStatus && params.investigationStatus !== 'ALL') {
    if (params.investigationStatus === 'FROZEN') {
      conditions.push('ba.is_frozen = TRUE');
    } else if (params.investigationStatus === 'ACTIVE') {
      conditions.push('ba.is_frozen = FALSE');
    } else if (params.investigationStatus === 'UNDER_INVESTIGATION') {
      conditions.push("aip.risk_classification = 'Under Investigation'");
    } else if (params.investigationStatus === 'CLEARED') {
      conditions.push("NOT EXISTS (SELECT 1 FROM suspicious_accounts sa WHERE sa.account_id = ba.id AND sa.status <> 'CLEARED')");
    }
  }

  if (params.minScore !== undefined) {
    queryParams.push(params.minScore);
    conditions.push(`aip.risk_score >= $${queryParams.length}`);
  }

  if (params.maxScore !== undefined) {
    queryParams.push(params.maxScore);
    conditions.push(`aip.risk_score <= $${queryParams.length}`);
  }

  if (params.startDate) {
    queryParams.push(params.startDate);
    conditions.push(`aip.last_assessed_at >= $${queryParams.length}`);
  }

  if (params.endDate) {
    queryParams.push(params.endDate);
    conditions.push(`aip.last_assessed_at <= $${queryParams.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortCol = params.sortBy === 'account_number' ? 'ba.account_number' : `aip.${params.sortBy}`;
  const sortDir = params.sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  queryParams.push(params.limit);
  const limitIdx = queryParams.length;
  queryParams.push(params.offset);
  const offsetIdx = queryParams.length;

  const dataSql = `
    SELECT 
      aip.account_id,
      ba.account_number,
      ba.holder_name,
      ba.branch_city,
      ba.ifsc_code,
      ba.account_type,
      ba.is_frozen,
      fi.name AS bank_name,
      fi.bank_code,
      aip.risk_score::float AS risk_score,
      aip.risk_classification,
      aip.account_status,
      aip.incoming_frequency_24h,
      aip.outgoing_frequency_24h,
      aip.incoming_volume_24h::float AS incoming_volume_24h,
      aip.outgoing_volume_24h::float AS outgoing_volume_24h,
      aip.avg_incoming_amount::float AS avg_incoming_amount,
      aip.avg_outgoing_amount::float AS avg_outgoing_amount,
      aip.velocity_score::float AS velocity_score,
      aip.pass_through_ratio::float AS pass_through_ratio,
      aip.rapid_forward_count_24h,
      aip.connected_accounts_count,
      aip.suspicious_counterparties_count,
      aip.prior_complaints_count,
      aip.mule_indicators,
      aip.risk_reasons,
      aip.score_source,
      aip.last_assessed_at,
      aip.is_synthetic,
      aip.created_at,
      aip.updated_at
    FROM account_intelligence_profiles aip
    JOIN bank_accounts ba ON ba.id = aip.account_id
    JOIN financial_institutions fi ON fi.id = ba.institution_id
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}, ba.account_number ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const countSql = `
    SELECT 
      COUNT(*)::int AS total_count,
      COUNT(*) FILTER (WHERE aip.risk_classification = 'Critical')::int AS critical_count,
      COUNT(*) FILTER (WHERE aip.risk_classification = 'High')::int AS high_count,
      COUNT(*) FILTER (WHERE aip.risk_classification = 'Medium')::int AS medium_count,
      COUNT(*) FILTER (WHERE aip.risk_classification = 'Low')::int AS low_count,
      COUNT(*) FILTER (WHERE aip.risk_classification = 'Under Investigation')::int AS under_inv_count,
      COUNT(*) FILTER (WHERE aip.account_status = 'CONFIRMED_FRAUD_LINKED')::int AS confirmed_fraud_count,
      COUNT(*) FILTER (WHERE aip.account_status = 'SUSPECTED_MULE_ACCOUNT')::int AS suspected_mule_count,
      COUNT(*) FILTER (WHERE aip.account_status = 'SUSPICIOUS_ACCOUNT')::int AS suspicious_account_count,
      COUNT(*) FILTER (WHERE aip.account_status = 'NORMAL')::int AS normal_count
    FROM account_intelligence_profiles aip
    JOIN bank_accounts ba ON ba.id = aip.account_id
    JOIN financial_institutions fi ON fi.id = ba.institution_id
    ${whereClause}
  `;

  const [rowsRes, countRes] = await Promise.all([
    query(dataSql, queryParams),
    query(countSql, queryParams.slice(0, queryParams.length - 2)),
  ]);

  const counts = countRes.rows[0] || {};

  return {
    accounts: rowsRes.rows,
    summary: {
      totalAccounts: counts.total_count ?? 0,
      totalMonitoredAccounts: counts.total_count ?? 0,
      highOrCriticalCount: (counts.critical_count ?? 0) + (counts.high_count ?? 0),
      criticalCount: counts.critical_count ?? 0,
      highCount: counts.high_count ?? 0,
      mediumCount: counts.medium_count ?? 0,
      lowCount: counts.low_count ?? 0,
      underInvestigationCount: counts.under_inv_count ?? 0,
      confirmedFraudLinkedCount: counts.confirmed_fraud_count ?? 0,
      suspectedMuleCount: counts.suspected_mule_count ?? 0,
      suspiciousAccountCount: counts.suspicious_account_count ?? 0,
      normalCount: counts.normal_count ?? 0,
    },
    pagination: {
      total: counts.total_count ?? 0,
      limit: params.limit,
      offset: params.offset,
    },
  };
}

export async function getAccountIntelligenceDetail(accountId: string) {
  const accSql = `
    SELECT 
      ba.id,
      ba.account_number,
      ba.holder_name,
      ba.branch_city,
      ba.ifsc_code,
      ba.account_type,
      ba.is_frozen,
      fi.name AS bank_name,
      fi.bank_code,
      aip.risk_score::float AS risk_score,
      aip.risk_classification,
      aip.account_status,
      aip.incoming_frequency_24h,
      aip.outgoing_frequency_24h,
      aip.incoming_volume_24h::float AS incoming_volume_24h,
      aip.outgoing_volume_24h::float AS outgoing_volume_24h,
      aip.avg_incoming_amount::float AS avg_incoming_amount,
      aip.avg_outgoing_amount::float AS avg_outgoing_amount,
      aip.velocity_score::float AS velocity_score,
      aip.pass_through_ratio::float AS pass_through_ratio,
      aip.rapid_forward_count_24h,
      aip.connected_accounts_count,
      aip.suspicious_counterparties_count,
      aip.prior_complaints_count,
      aip.mule_indicators,
      aip.risk_reasons,
      aip.score_source,
      aip.last_assessed_at,
      aip.is_synthetic,
      aip.created_at,
      aip.updated_at
    FROM bank_accounts ba
    JOIN financial_institutions fi ON fi.id = ba.institution_id
    LEFT JOIN account_intelligence_profiles aip ON aip.account_id = ba.id
    WHERE ba.id = $1
    LIMIT 1
  `;

  const accRes = await query(accSql, [accountId]);
  if (!accRes.rows[0]) {
    throw new AppError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND');
  }

  const accountRow = accRes.rows[0];

  const [relRes, histRes, compRes, txnsRes] = await Promise.all([
    query(
      `SELECT 
         sar.id,
         sar.source_account_id,
         sar.target_account_id,
         ba.account_number AS target_account_number,
         ba.holder_name AS target_holder_name,
         fi.name AS target_bank,
         sar.relationship_type,
         sar.hops_to_confirmed_fraud,
         sar.risk_weight::float AS risk_weight,
         sar.first_observed_at,
         sar.last_observed_at
       FROM suspicious_account_relationships sar
       JOIN bank_accounts ba ON ba.id = sar.target_account_id
       JOIN financial_institutions fi ON fi.id = ba.institution_id
       WHERE sar.source_account_id = $1
       ORDER BY sar.risk_weight DESC, sar.hops_to_confirmed_fraud ASC`,
      [accountId]
    ),
    query(
      `SELECT 
         id,
         account_id,
         previous_score::float AS previous_score,
         new_score::float AS new_score,
         previous_classification,
         new_classification,
         trigger_event,
         trigger_reference_id,
         reasons_json,
         assessed_by,
         recorded_at
       FROM account_risk_history
       WHERE account_id = $1
       ORDER BY recorded_at DESC
       LIMIT 50`,
      [accountId]
    ),
    query(
      `SELECT DISTINCT
         c.id,
         c.complaint_number,
         c.status,
         c.fraud_type,
         c.reported_amount::float AS reported_amount
       FROM suspicious_accounts sa
       JOIN complaints c ON c.id = sa.complaint_id
       WHERE sa.account_id = $1`,
      [accountId]
    ),
    query(
      `SELECT 
         t.id,
         t.from_account,
         t.to_account,
         t.amount::float AS amount,
         t.timestamp
       FROM transactions t
       WHERE (t.from_account = $1 OR t.to_account = $1)
         AND t.timestamp >= NOW() - INTERVAL '24 hours'
       ORDER BY t.timestamp DESC`,
      [accountId]
    ),
  ]);

  const recentTxns = txnsRes.rows;
  const incoming = recentTxns.filter((t) => t.to_account === accountId);
  const outgoing = recentTxns.filter((t) => t.from_account === accountId);
  const uniqueSenders = new Set(incoming.map((t) => t.from_account)).size;
  const inTotal = incoming.reduce((s, t) => s + Number(t.amount), 0);
  const outTotal = outgoing.reduce((s, t) => s + Number(t.amount), 0);
  const passThrough = inTotal > 0 ? Math.min(1.0, outTotal / inTotal) : 0;

  let bursts = 0;
  for (const inTx of incoming) {
    const inTime = new Date(inTx.timestamp).getTime();
    const hasRapidOut = outgoing.some((outTx) => {
      const outTime = new Date(outTx.timestamp).getTime();
      const diffSec = (outTime - inTime) / 1000;
      return diffSec >= 0 && diffSec <= 300;
    });
    if (hasRapidOut) bursts++;
  }

  const avgIn = accountRow.avg_incoming_amount || 25000;
  const largeReceipts = incoming.filter((t) => Number(t.amount) > 3 * avgIn).length;

  return {
    account: {
      id: accountRow.id,
      account_number: accountRow.account_number,
      holder_name: accountRow.holder_name,
      branch_city: accountRow.branch_city,
      ifsc_code: accountRow.ifsc_code,
      account_type: accountRow.account_type,
      is_frozen: accountRow.is_frozen,
      bank_name: accountRow.bank_name,
      bank_code: accountRow.bank_code,
    },
    profile: {
      account_id: accountRow.id,
      account_number: accountRow.account_number,
      holder_name: accountRow.holder_name,
      branch_city: accountRow.branch_city,
      ifsc_code: accountRow.ifsc_code,
      account_type: accountRow.account_type,
      is_frozen: accountRow.is_frozen,
      bank_name: accountRow.bank_name,
      bank_code: accountRow.bank_code,
      risk_score: accountRow.risk_score ?? 10.0,
      risk_classification: accountRow.risk_classification ?? 'Low',
      account_status: accountRow.account_status ?? 'NORMAL',
      incoming_frequency_24h: accountRow.incoming_frequency_24h ?? 0,
      outgoing_frequency_24h: accountRow.outgoing_frequency_24h ?? 0,
      incoming_volume_24h: accountRow.incoming_volume_24h ?? 0,
      outgoing_volume_24h: accountRow.outgoing_volume_24h ?? 0,
      avg_incoming_amount: accountRow.avg_incoming_amount ?? 0,
      avg_outgoing_amount: accountRow.avg_outgoing_amount ?? 0,
      velocity_score: accountRow.velocity_score ?? 0,
      pass_through_ratio: accountRow.pass_through_ratio ?? 0,
      rapid_forward_count_24h: accountRow.rapid_forward_count_24h ?? 0,
      connected_accounts_count: accountRow.connected_accounts_count ?? 0,
      suspicious_counterparties_count: accountRow.suspicious_counterparties_count ?? 0,
      prior_complaints_count: accountRow.prior_complaints_count ?? 0,
      mule_indicators: accountRow.mule_indicators ?? [],
      risk_reasons: accountRow.risk_reasons ?? [],
      score_source: accountRow.score_source ?? 'Rule-based risk score',
      last_assessed_at: accountRow.last_assessed_at ?? new Date().toISOString(),
      is_synthetic: accountRow.is_synthetic ?? true,
      created_at: accountRow.created_at ?? new Date().toISOString(),
      updated_at: accountRow.updated_at ?? new Date().toISOString(),
    },
    relationships: relRes.rows,
    riskHistory: histRes.rows,
    recentPatterns: {
      fanInCount: uniqueSenders,
      passThroughRatio: Number(passThrough.toFixed(4)),
      rapidForwardBursts: bursts,
      largeReceiptsCount: largeReceipts,
      flaggedCounterparties: relRes.rows.length,
      hourlyVelocityMax: Math.max(incoming.length, outgoing.length),
    },
    linkedComplaints: compRes.rows,
  };
}

export async function getAccountRiskHistory(
  accountId: string,
  limit = 50,
  offset = 0
) {
  const sql = `
    SELECT 
      id,
      account_id,
      previous_score::float AS previous_score,
      new_score::float AS new_score,
      previous_classification,
      new_classification,
      trigger_event,
      trigger_reference_id,
      reasons_json,
      assessed_by,
      recorded_at
    FROM account_risk_history
    WHERE account_id = $1
    ORDER BY recorded_at DESC
    LIMIT $2 OFFSET $3
  `;
  const result = await query(sql, [accountId, limit, offset]);
  return result.rows;
}

export async function updateAccountClassification(
  accountId: string,
  body: z.infer<typeof updateClassificationSchema>,
  userId: string
) {
  if (body.classification === 'CONFIRMED_FRAUD_LINKED') {
    if (!body.complaintId && !body.evidenceId) {
      throw new AppError(
        'CONFIRMED_FRAUD_LINKED classification requires linkage to an active complaint or recorded evidence record. Algorithmic patterns alone cannot confirm fraud.',
        400,
        'COMPLAINT_OR_EVIDENCE_REQUIRED'
      );
    }
  }

  return withTransaction(async (client) => {
    const accCheck = await client.query(
      `SELECT ba.id, ba.is_frozen, aip.risk_score, aip.risk_classification, aip.account_status
       FROM bank_accounts ba
       LEFT JOIN account_intelligence_profiles aip ON aip.account_id = ba.id
       WHERE ba.id = $1 LIMIT 1`,
      [accountId]
    );

    if (!accCheck.rows[0]) {
      throw new AppError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND');
    }

    const current = accCheck.rows[0];

    if (body.complaintId) {
      const cmp = await client.query('SELECT id FROM complaints WHERE id = $1 LIMIT 1', [body.complaintId]);
      if (!cmp.rows[0]) {
        throw new AppError('Specified complaint does not exist.', 400, 'INVALID_COMPLAINT_ID');
      }
    }

    if (body.evidenceId) {
      const ev = await client.query('SELECT id FROM evidence_records WHERE id = $1 LIMIT 1', [body.evidenceId]);
      if (!ev.rows[0]) {
        throw new AppError('Specified evidence record does not exist.', 400, 'INVALID_EVIDENCE_ID');
      }
    }

    let nextScore = body.adjustedScore ?? (current.risk_score ? Number(current.risk_score) : 10.0);
    let nextClassification: string = current.risk_classification ?? 'Low';

    if (body.classification === 'CONFIRMED_FRAUD_LINKED') {
      nextClassification = 'Critical';
      nextScore = Math.max(nextScore, 85.0);
    } else if (body.classification === 'SUSPECTED_MULE_ACCOUNT') {
      nextClassification = 'High';
      nextScore = Math.max(nextScore, 68.0);
    } else if (body.classification === 'SUSPICIOUS_ACCOUNT') {
      nextClassification = 'Medium';
      nextScore = Math.max(nextScore, 45.0);
    } else if (body.classification === 'NORMAL') {
      nextClassification = 'Low';
      nextScore = Math.min(nextScore, 20.0);
    }

    const updatedProfile = await client.query(
      `INSERT INTO account_intelligence_profiles (
         account_id, risk_score, risk_classification, account_status,
         score_source, last_assessed_at, updated_at
       )
       VALUES ($1, $2, $3, $4, 'Rule-based risk score', NOW(), NOW())
       ON CONFLICT (account_id) DO UPDATE
       SET risk_score = EXCLUDED.risk_score,
           risk_classification = EXCLUDED.risk_classification,
           account_status = EXCLUDED.account_status,
           score_source = EXCLUDED.score_source,
           last_assessed_at = NOW(),
           updated_at = NOW()
       RETURNING *`,
      [accountId, nextScore, nextClassification, body.classification]
    );

    if (body.freezeAccount) {
      await client.query('UPDATE bank_accounts SET is_frozen = TRUE WHERE id = $1', [accountId]);
    } else if (body.classification === 'NORMAL') {
      await client.query('UPDATE bank_accounts SET is_frozen = FALSE WHERE id = $1', [accountId]);
    }

    const triggerRef = body.complaintId ?? body.evidenceId ?? null;
    await client.query(
      `INSERT INTO account_risk_history (
         account_id, previous_score, new_score,
         previous_classification, new_classification,
         trigger_event, trigger_reference_id, reasons_json,
         assessed_by, recorded_at
       )
       VALUES ($1, $2, $3, $4, $5, 'OFFICER_RECLASSIFICATION', $6, $7::jsonb, $8, NOW())`,
      [
        accountId,
        current.risk_score !== null ? Number(current.risk_score) : null,
        nextScore,
        current.risk_classification ?? null,
        nextClassification,
        triggerRef,
        JSON.stringify([body.reason]),
        userId,
      ]
    );

    if (body.complaintId) {
      const suspClass =
        body.classification === 'CONFIRMED_FRAUD_LINKED'
          ? 'SUSPECTED_MULE'
          : body.classification === 'SUSPECTED_MULE_ACCOUNT'
            ? 'SUSPECTED_MULE'
            : body.classification === 'NORMAL'
              ? 'CLEARED'
              : 'LAYERING_NODE';

      await client.query(
        `INSERT INTO suspicious_accounts (
           account_id, complaint_id, classification, mule_probability,
           score_source, reason, flagged_by, status
         )
         VALUES ($1, $2, $3, $4, 'Rule-based risk score', $5, $6, $7)
         ON CONFLICT (account_id, complaint_id) DO UPDATE
         SET classification = EXCLUDED.classification,
             mule_probability = EXCLUDED.mule_probability,
             reason = EXCLUDED.reason,
             flagged_by = EXCLUDED.flagged_by,
             status = EXCLUDED.status,
             updated_at = NOW()`,
        [
          accountId,
          body.complaintId,
          suspClass,
          nextScore / 100,
          body.reason,
          userId,
          body.freezeAccount ? 'FROZEN' : body.classification === 'NORMAL' ? 'CLEARED' : 'ACTIVE',
        ]
      );
    }

    return updatedProfile.rows[0];
  });
}

export async function reEvaluateAccountProfile(accountId: string, userId: string) {
  return withTransaction(async (client) => {
    const accCheck = await client.query(
      `SELECT ba.id, ba.account_number, aip.risk_score, aip.risk_classification, aip.account_status, aip.avg_incoming_amount
       FROM bank_accounts ba
       LEFT JOIN account_intelligence_profiles aip ON aip.account_id = ba.id
       WHERE ba.id = $1 LIMIT 1`,
      [accountId]
    );

    if (!accCheck.rows[0]) {
      throw new AppError('Bank account not found.', 404, 'ACCOUNT_NOT_FOUND');
    }

    const current = accCheck.rows[0];

    const txnsRes = await client.query(
      `SELECT from_account, to_account, amount::float AS amount, timestamp
       FROM transactions
       WHERE (from_account = $1 OR to_account = $1)
         AND timestamp >= NOW() - INTERVAL '24 hours'
       ORDER BY timestamp ASC`,
      [accountId]
    );

    const txns = txnsRes.rows;
    const incoming = txns.filter((t) => t.to_account === accountId);
    const outgoing = txns.filter((t) => t.from_account === accountId);

    const uniqueSenders = new Set(incoming.map((t) => t.from_account)).size;
    const inTotal = incoming.reduce((s, t) => s + Number(t.amount), 0);
    const outTotal = outgoing.reduce((s, t) => s + Number(t.amount), 0);
    const passThroughRatio = inTotal > 0 ? Math.min(1.0, outTotal / inTotal) : 0.0;

    let rapidForwardBursts = 0;
    for (const inTx of incoming) {
      const inTime = new Date(inTx.timestamp).getTime();
      const match = outgoing.some((outTx) => {
        const outTime = new Date(outTx.timestamp).getTime();
        const diff = (outTime - inTime) / 1000;
        return diff >= 0 && diff <= 300;
      });
      if (match) rapidForwardBursts++;
    }

    const baselineAvg = current.avg_incoming_amount ? Number(current.avg_incoming_amount) : 25000;
    const largeReceipts = incoming.filter((t) => Number(t.amount) > 3 * baselineAvg).length;

    const relRes = await client.query(
      `SELECT COUNT(*)::int AS flagged_counterparties
       FROM suspicious_account_relationships sar
       WHERE sar.source_account_id = $1 AND sar.hops_to_confirmed_fraud <= 2`,
      [accountId]
    );
    const flaggedCounterparties = relRes.rows[0]?.flagged_counterparties ?? 0;

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

    let newClassification: string = 'Low';
    if (computedScore >= 80) newClassification = 'Critical';
    else if (computedScore >= 65) newClassification = 'High';
    else if (computedScore >= 40) newClassification = 'Medium';

    if (current.risk_classification === 'Under Investigation') {
      newClassification = 'Under Investigation';
    }

    let nextStatus: string = current.account_status ?? 'NORMAL';
    if (current.account_status !== 'CONFIRMED_FRAUD_LINKED') {
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

    const updatedProfile = await client.query(
      `INSERT INTO account_intelligence_profiles (
         account_id, risk_score, risk_classification, account_status,
         incoming_frequency_24h, outgoing_frequency_24h, incoming_volume_24h, outgoing_volume_24h,
         avg_incoming_amount, avg_outgoing_amount, velocity_score, pass_through_ratio,
         rapid_forward_count_24h, mule_indicators, risk_reasons, score_source,
         last_assessed_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb,
         'Rule-based risk score', NOW(), NOW()
       )
       ON CONFLICT (account_id) DO UPDATE
       SET risk_score = EXCLUDED.risk_score,
           risk_classification = EXCLUDED.risk_classification,
           account_status = EXCLUDED.account_status,
           incoming_frequency_24h = EXCLUDED.incoming_frequency_24h,
           outgoing_frequency_24h = EXCLUDED.outgoing_frequency_24h,
           incoming_volume_24h = EXCLUDED.incoming_volume_24h,
           outgoing_volume_24h = EXCLUDED.outgoing_volume_24h,
           avg_incoming_amount = EXCLUDED.avg_incoming_amount,
           avg_outgoing_amount = EXCLUDED.avg_outgoing_amount,
           velocity_score = EXCLUDED.velocity_score,
           pass_through_ratio = EXCLUDED.pass_through_ratio,
           rapid_forward_count_24h = EXCLUDED.rapid_forward_count_24h,
           mule_indicators = EXCLUDED.mule_indicators,
           risk_reasons = EXCLUDED.risk_reasons,
           score_source = EXCLUDED.score_source,
           last_assessed_at = NOW(),
           updated_at = NOW()
       RETURNING *`,
      [
        accountId,
        computedScore,
        newClassification,
        nextStatus,
        incoming.length,
        outgoing.length,
        inTotal,
        outTotal,
        incoming.length > 0 ? Math.round(inTotal / incoming.length) : baselineAvg,
        outgoing.length > 0 ? Math.round(outTotal / outgoing.length) : 0,
        Math.min(100, incoming.length * 4.5),
        Number(passThroughRatio.toFixed(4)),
        rapidForwardBursts,
        JSON.stringify(indicators),
        JSON.stringify(reasons),
      ]
    );

    await client.query(
      `INSERT INTO account_risk_history (
         account_id, previous_score, new_score,
         previous_classification, new_classification,
         trigger_event, reasons_json, assessed_by, recorded_at
       )
       VALUES ($1, $2, $3, $4, $5, 'DYNAMIC_BEHAVIOURAL_REEVALUATION', $6::jsonb, $7, NOW())`,
      [
        accountId,
        current.risk_score !== null ? Number(current.risk_score) : null,
        computedScore,
        current.risk_classification ?? null,
        newClassification,
        JSON.stringify(reasons),
        userId,
      ]
    );

    return updatedProfile.rows[0];
  });
}

export async function getIntelligenceFilters() {
  const result = await query(
    'SELECT DISTINCT name, bank_code FROM financial_institutions ORDER BY name ASC'
  );
  return {
    banks: result.rows.map((r: { name: string }) => r.name),
    riskClassifications: ['Low', 'Medium', 'High', 'Critical', 'Under Investigation'],
    accountStatuses: ['NORMAL', 'SUSPICIOUS_ACCOUNT', 'SUSPECTED_MULE_ACCOUNT', 'CONFIRMED_FRAUD_LINKED'],
  };
}

export async function getIntelligenceSummary() {
  const countSql = `
    SELECT 
      COUNT(*)::int AS total_count,
      COUNT(*) FILTER (WHERE aip.risk_classification = 'Critical')::int AS critical_count,
      COUNT(*) FILTER (WHERE aip.risk_classification = 'High')::int AS high_count,
      COUNT(*) FILTER (WHERE aip.risk_classification = 'Medium')::int AS medium_count,
      COUNT(*) FILTER (WHERE aip.risk_classification = 'Low')::int AS low_count,
      COUNT(*) FILTER (WHERE aip.risk_classification = 'Under Investigation')::int AS under_inv_count,
      COUNT(*) FILTER (WHERE aip.account_status = 'CONFIRMED_FRAUD_LINKED')::int AS confirmed_fraud_count,
      COUNT(*) FILTER (WHERE aip.account_status = 'SUSPECTED_MULE_ACCOUNT')::int AS suspected_mule_count,
      COUNT(*) FILTER (WHERE aip.account_status = 'SUSPICIOUS_ACCOUNT')::int AS suspicious_account_count,
      COUNT(*) FILTER (WHERE aip.account_status = 'NORMAL')::int AS normal_count
    FROM account_intelligence_profiles aip
  `;
  const countRes = await query(countSql);
  const counts = countRes.rows[0] || {};
  return {
    totalAccounts: counts.total_count ?? 0,
    totalMonitoredAccounts: counts.total_count ?? 0,
    highOrCriticalCount: (counts.critical_count ?? 0) + (counts.high_count ?? 0),
    criticalCount: counts.critical_count ?? 0,
    highCount: counts.high_count ?? 0,
    mediumCount: counts.medium_count ?? 0,
    lowCount: counts.low_count ?? 0,
    underInvestigationCount: counts.under_inv_count ?? 0,
    confirmedFraudLinkedCount: counts.confirmed_fraud_count ?? 0,
    suspectedMuleCount: counts.suspected_mule_count ?? 0,
    suspiciousAccountCount: counts.suspicious_account_count ?? 0,
    normalCount: counts.normal_count ?? 0,
  };
}
