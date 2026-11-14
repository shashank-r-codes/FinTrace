import crypto from 'node:crypto';
import { query, withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface ScreeningInput {
  senderAccountId: string;
  receiverAccountId: string;
  amount: number;
  currency?: string;
  channel: 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'CARD' | 'WALLET';
  timestamp?: string;
  clientId?: string;
  idempotencyKey?: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  latitude?: number;
  longitude?: number;
}

export interface CachedProfile {
  account_id: string;
  account_number: string;
  holder_name: string;
  bank_name: string;
  bank_code: string;
  is_frozen: boolean;
  risk_score: number;
  risk_classification: 'Low' | 'Medium' | 'High' | 'Critical' | 'Under Investigation';
  account_status: 'NORMAL' | 'SUSPICIOUS_ACCOUNT' | 'SUSPECTED_MULE_ACCOUNT' | 'CONFIRMED_FRAUD_LINKED';
  avg_incoming_amount: number;
  avg_outgoing_amount: number;
  pass_through_ratio: number;
  rapid_forward_count_24h: number;
  mule_indicators: string[];
  risk_reasons: string[];
  cached_at: number;
}

// In-Memory Profile Cache
const profileCache = new Map<string, CachedProfile>();
const CACHE_TTL_MS = 60 * 1000;

export function invalidateAccountCache(accountId: string): void {
  profileCache.delete(accountId);
}

export function clearProfileCache(): void {
  profileCache.clear();
}

async function getCachedProfile(accountIdOrNumber: string): Promise<CachedProfile> {
  const now = Date.now();
  const cached = profileCache.get(accountIdOrNumber);
  if (cached && now - cached.cached_at < CACHE_TTL_MS) {
    return cached;
  }

  const sql = `
    SELECT 
      ba.id AS account_id,
      ba.account_number,
      ba.holder_name,
      ba.is_frozen,
      fi.name AS bank_name,
      fi.bank_code,
      COALESCE(aip.risk_score, 10.0)::float AS risk_score,
      COALESCE(aip.risk_classification, 'Low') AS risk_classification,
      COALESCE(aip.account_status, 'NORMAL') AS account_status,
      COALESCE(aip.avg_incoming_amount, 25000)::float AS avg_incoming_amount,
      COALESCE(aip.avg_outgoing_amount, 20000)::float AS avg_outgoing_amount,
      COALESCE(aip.pass_through_ratio, 0.0)::float AS pass_through_ratio,
      COALESCE(aip.rapid_forward_count_24h, 0)::int AS rapid_forward_count_24h,
      COALESCE(aip.mule_indicators, '[]'::jsonb) AS mule_indicators,
      COALESCE(aip.risk_reasons, '[]'::jsonb) AS risk_reasons
    FROM bank_accounts ba
    JOIN financial_institutions fi ON fi.id = ba.institution_id
    LEFT JOIN account_intelligence_profiles aip ON aip.account_id = ba.id
    WHERE ba.id::text = $1 OR ba.account_number = $1
    LIMIT 1
  `;

  const res = await query(sql, [accountIdOrNumber]);
  if (!res.rows[0]) {
    throw new AppError(`Account '${accountIdOrNumber}' not found.`, 404, 'ACCOUNT_NOT_FOUND');
  }

  const r = res.rows[0];
  const profile: CachedProfile = {
    account_id: r.account_id,
    account_number: r.account_number,
    holder_name: r.holder_name,
    bank_name: r.bank_name,
    bank_code: r.bank_code,
    is_frozen: Boolean(r.is_frozen),
    risk_score: Number(r.risk_score),
    risk_classification: r.risk_classification,
    account_status: r.account_status,
    avg_incoming_amount: Number(r.avg_incoming_amount),
    avg_outgoing_amount: Number(r.avg_outgoing_amount),
    pass_through_ratio: Number(r.pass_through_ratio),
    rapid_forward_count_24h: Number(r.rapid_forward_count_24h),
    mule_indicators: Array.isArray(r.mule_indicators) ? r.mule_indicators : [],
    risk_reasons: Array.isArray(r.risk_reasons) ? r.risk_reasons : [],
    cached_at: now,
  };

  profileCache.set(profile.account_id, profile);
  profileCache.set(profile.account_number, profile);
  return profile;
}

export async function getActiveThresholds(): Promise<{
  version: number;
  low_max: number;
  medium_max: number;
  high_max: number;
}> {
  try {
    const res = await query(
      `SELECT version, low_max::float, medium_max::float, high_max::float
       FROM screening_thresholds
       WHERE is_active = TRUE
       ORDER BY version DESC
       LIMIT 1`
    );
    if (res.rows[0]) {
      return {
        version: Number(res.rows[0].version),
        low_max: Number(res.rows[0].low_max),
        medium_max: Number(res.rows[0].medium_max),
        high_max: Number(res.rows[0].high_max),
      };
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch active thresholds, falling back to v1 default');
  }
  return { version: 1, low_max: 40.0, medium_max: 65.0, high_max: 80.0 };
}

export async function getSystemSetting(key: string, defaultValue: string): Promise<string> {
  try {
    const res = await query('SELECT value FROM system_settings WHERE key = $1 LIMIT 1', [key]);
    if (res.rows[0]) return res.rows[0].value;
  } catch {
    // fallback
  }
  return defaultValue;
}

export async function findExistingScreening(idempotencyKey: string) {
  const sql = `
    SELECT 
      tsr.id AS screening_id,
      tsr.idempotency_key,
      tsr.decision,
      tsr.risk_score,
      tsr.risk_classification,
      tsr.latency_ms,
      tsr.applied_fail_mode,
      tsr.screened_at,
      tra.account_risk_score,
      tra.transaction_risk_score,
      tra.network_risk_score,
      tra.composite_score,
      tra.score_source,
      tra.thresholds_version,
      tra.rules_triggered,
      tra.plain_language_explanation,
      tra.limitations_disclaimer,
      ti.recommended_action,
      sba.id AS sender_id,
      sba.account_number AS sender_acc,
      sba.holder_name AS sender_holder,
      sfi.name AS sender_bank,
      rba.id AS receiver_id,
      rba.account_number AS receiver_acc,
      rba.holder_name AS receiver_holder,
      rfi.name AS receiver_bank
    FROM transaction_screening_requests tsr
    JOIN transaction_risk_assessments tra ON tra.screening_id = tsr.id
    JOIN transaction_interventions ti ON ti.screening_id = tsr.id
    JOIN bank_accounts sba ON sba.id = tsr.sender_account_id
    JOIN financial_institutions sfi ON sfi.id = sba.institution_id
    JOIN bank_accounts rba ON rba.id = tsr.receiver_account_id
    JOIN financial_institutions rfi ON rfi.id = rba.institution_id
    WHERE tsr.idempotency_key = $1
    LIMIT 1
  `;
  const res = await query(sql, [idempotencyKey]);
  if (!res.rows[0]) return null;

  const row = res.rows[0];
  return {
    screeningId: row.screening_id,
    idempotencyKey: row.idempotency_key,
    decision: row.decision,
    recommendedAction: row.recommended_action,
    riskScore: Number(row.risk_score),
    riskClassification: row.risk_classification,
    accountRiskScore: Number(row.account_risk_score),
    transactionRiskScore: Number(row.transaction_risk_score),
    networkRiskScore: Number(row.network_risk_score),
    compositeScore: Number(row.composite_score),
    senderRiskScore: Number(row.account_risk_score),
    receiverRiskScore: Number(row.account_risk_score),
    latencyMs: Number(row.latency_ms),
    appliedFailMode: row.applied_fail_mode,
    scoreSource: row.score_source,
    thresholdsVersion: Number(row.thresholds_version),
    rulesTriggered: Array.isArray(row.rules_triggered) ? row.rules_triggered : [],
    plainLanguageExplanation: row.plain_language_explanation,
    limitationsDisclaimer: row.limitations_disclaimer,
    senderAccount: {
      id: row.sender_id,
      accountNumber: row.sender_acc,
      holderName: row.sender_holder,
      bankName: row.sender_bank,
      accountStatus: 'NORMAL' as const,
    },
    receiverAccount: {
      id: row.receiver_id,
      accountNumber: row.receiver_acc,
      holderName: row.receiver_holder,
      bankName: row.receiver_bank,
      accountStatus: 'NORMAL' as const,
    },
    idempotentReplay: true,
    screenedAt: row.screened_at,
  };
}

export async function screenTransaction(input: ScreeningInput, actorUserId?: string) {
  const startTime = performance.now();
  const idempotencyKey =
    input.idempotencyKey?.trim() ||
    crypto
      .createHash('sha256')
      .update(`${input.senderAccountId}:${input.receiverAccountId}:${input.amount}:${input.timestamp || ''}`)
      .digest('hex')
      .slice(0, 32);

  // 1. Idempotency Check
  const existing = await findExistingScreening(idempotencyKey);
  if (existing) {
    return existing;
  }

  // 2. Fetch sender and receiver profiles in parallel
  const [sender, receiver, thresholds, failSafePolicyStr, latencyBudgetStr] = await Promise.all([
    getCachedProfile(input.senderAccountId),
    getCachedProfile(input.receiverAccountId),
    getActiveThresholds(),
    getSystemSetting('FAIL_SAFE_POLICY', 'FAIL_CLOSED'),
    getSystemSetting('LATENCY_BUDGET_MS', '50'),
  ]);

  if (sender.account_id === receiver.account_id) {
    throw new AppError('Sender and receiver accounts cannot be identical.', 400, 'SENDER_RECEIVER_IDENTICAL');
  }

  const latencyBudget = Number(latencyBudgetStr) || 50;
  const failSafePolicy = failSafePolicyStr === 'FAIL_OPEN' ? 'FAIL_OPEN' : 'FAIL_CLOSED';

  // 3. Multi-Factor Risk Evaluation
  const rulesTriggered: Array<{
    rule_id: string;
    name: string;
    weight: number;
    contribution: number;
    category: 'SENDER' | 'RECEIVER' | 'TRANSACTION' | 'NETWORK';
  }> = [];

  // A. Sender Risk Evaluation
  let senderScore = sender.risk_score;
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

  if (sender.avg_outgoing_amount > 0 && input.amount > 5 * sender.avg_outgoing_amount) {
    const deviationMult = (input.amount / sender.avg_outgoing_amount).toFixed(1);
    senderScore = Math.min(100, senderScore + 25);
    rulesTriggered.push({
      rule_id: 'SENDER_AMOUNT_DEVIATION_HIGH',
      name: `Transaction amount is ${deviationMult}x higher than sender's historical outgoing average`,
      weight: 25,
      contribution: 25,
      category: 'SENDER',
    });
  }

  // B. Receiver Risk Evaluation
  let receiverScore = receiver.risk_score;
  if (receiver.account_status === 'CONFIRMED_FRAUD_LINKED') {
    receiverScore = Math.max(receiverScore, 95.0);
    rulesTriggered.push({
      rule_id: 'RECEIVER_CONFIRMED_FRAUD_LINKAGE',
      name: 'Receiver account has verified linkage to active cybercrime complaints or evidence',
      weight: 50,
      contribution: 50,
      category: 'RECEIVER',
    });
  } else if (receiver.account_status === 'SUSPECTED_MULE_ACCOUNT') {
    receiverScore = Math.max(receiverScore, 78.0);
    rulesTriggered.push({
      rule_id: 'RECEIVER_SUSPECTED_MULE',
      name: 'Receiver account exhibits high pass-through velocity and rapid forward bursts',
      weight: 35,
      contribution: 35,
      category: 'RECEIVER',
    });
  } else if (receiver.account_status === 'SUSPICIOUS_ACCOUNT') {
    receiverScore = Math.max(receiverScore, 55.0);
    rulesTriggered.push({
      rule_id: 'RECEIVER_SUSPICIOUS_FLAGS',
      name: 'Receiver account has active suspicious intelligence flags',
      weight: 20,
      contribution: 20,
      category: 'RECEIVER',
    });
  }

  if (receiver.pass_through_ratio >= 0.75) {
    receiverScore = Math.min(100, receiverScore + 15);
    rulesTriggered.push({
      rule_id: 'RECEIVER_HIGH_PASS_THROUGH',
      name: `Receiver displays ${(receiver.pass_through_ratio * 100).toFixed(0)}% rapid pass-through ratio`,
      weight: 15,
      contribution: 15,
      category: 'RECEIVER',
    });
  }

  // C. Transaction Risk Evaluation
  let transactionScore = 10.0;
  // First-time beneficiary check
  const priorTxnCheck = await query(
    'SELECT id FROM transactions WHERE from_account = $1 AND to_account = $2 LIMIT 1',
    [sender.account_id, receiver.account_id]
  );
  const isFirstTime = !priorTxnCheck.rows[0];
  if (isFirstTime) {
    transactionScore += 25.0;
    rulesTriggered.push({
      rule_id: 'FIRST_TIME_BENEFICIARY',
      name: 'First-time transfer between remitter and beneficiary',
      weight: 25,
      contribution: 25,
      category: 'TRANSACTION',
    });
  }

  if (input.amount >= 500000) {
    transactionScore += 30.0;
    rulesTriggered.push({
      rule_id: 'HIGH_VALUE_TRANSACTION',
      name: 'High-value transaction >= INR 5,00,000',
      weight: 30,
      contribution: 30,
      category: 'TRANSACTION',
    });
  } else if (input.amount >= 100000) {
    transactionScore += 15.0;
    rulesTriggered.push({
      rule_id: 'ELEVATED_VALUE_TRANSACTION',
      name: 'Elevated transaction amount >= INR 1,00,000',
      weight: 15,
      contribution: 15,
      category: 'TRANSACTION',
    });
  }

  if ((input.channel === 'UPI' || input.channel === 'IMPS') && isFirstTime && input.amount > 50000) {
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
  const relCheck = await query(
    `SELECT hops_to_confirmed_fraud, relationship_type, risk_weight::float AS risk_weight
     FROM suspicious_account_relationships
     WHERE (source_account_id = $1 AND target_account_id = $2)
        OR (source_account_id = $2 AND hops_to_confirmed_fraud <= 2)
     ORDER BY hops_to_confirmed_fraud ASC
     LIMIT 1`,
    [sender.account_id, receiver.account_id]
  );

  if (relCheck.rows[0]) {
    const rel = relCheck.rows[0];
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

  // E. Machine Learning Model Inference (Strict 35ms Latency Budget Guard)
  let scoreSource: 'Trained ML prediction' | 'Rule-based risk score' = 'Rule-based risk score';
  let modelVersion = 'v1.0-rules-engine';
  let mlFactors: Array<{ factor: string; value: number; shap_value: number; direction: string; description: string }> = [];
  let mlScore: number | null = null;

  try {
    const mlPayload = {
      sender_account_id: sender.account_id,
      receiver_account_id: receiver.account_id,
      amount: input.amount,
      channel: input.channel,
      sender_risk_score: senderScore,
      receiver_risk_score: receiverScore,
      sender_pass_through: sender.pass_through_ratio,
      receiver_pass_through: receiver.pass_through_ratio,
      rapid_forward_count: receiver.rapid_forward_count_24h,
      is_first_time_beneficiary: isFirstTime,
      hops_to_confirmed_fraud: relCheck.rows[0]?.hops_to_confirmed_fraud ?? 99,
      device_fingerprint: input.deviceFingerprint ?? null,
      ip_address: input.ipAddress ?? null,
    };

    const mlRes = await fetch(`${env.ML_SERVICE_URL}/ml/screen/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mlPayload),
      signal: AbortSignal.timeout(35),
    });

    if (mlRes.ok) {
      const mlJson = (await mlRes.json()) as {
        ml_score: number;
        model_version: string;
        top_shap_factors: Array<{ factor: string; value: number; shap_value: number; direction: string; description: string }>;
        score_source: 'Trained ML prediction' | 'Rule-based risk score';
      };
      mlScore = mlJson.ml_score;
      modelVersion = mlJson.model_version || 'xgb-v1.0';
      mlFactors = mlJson.top_shap_factors || [];
      scoreSource = 'Trained ML prediction';
    }
  } catch {
    // Graceful fallback to deterministic rule evaluation within budget
    logger.debug('ML service unavailable or timed out (> 35ms); falling back to rule evaluation');
  }

  // F. Composite Risk Calculation (Blending Rules + ML)
  let ruleComposite = 0;
  if (receiver.account_status === 'CONFIRMED_FRAUD_LINKED' || sender.is_frozen) {
    ruleComposite = Math.max(
      88.0,
      0.15 * senderScore + 0.55 * receiverScore + 0.15 * transactionScore + 0.15 * networkScore
    );
  } else {
    ruleComposite =
      0.25 * senderScore + 0.35 * receiverScore + 0.20 * transactionScore + 0.20 * networkScore;
  }

  let compositeScore = ruleComposite;
  if (mlScore !== null) {
    compositeScore = 0.65 * ruleComposite + 0.35 * mlScore;
  }
  compositeScore = Math.min(100.0, Math.max(5.0, Math.round(compositeScore * 10) / 10));

  // G. Decision Mapping & Thresholds Cutoff
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

  // G. Fail-Safe Timeout Verification
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

  // H. Explanation Text
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

  // 4. Atomic Transaction Persistence
  const result = await withTransaction(async (client) => {
    const screeningRes = await client.query(
      `INSERT INTO transaction_screening_requests (
         idempotency_key, sender_account_id, receiver_account_id,
         amount, currency, channel, client_id, status, decision,
         risk_score, risk_classification, latency_ms, applied_fail_mode,
         is_synthetic, screened_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8, $9, $10, $11, $12, TRUE, NOW())
       RETURNING *`,
      [
        idempotencyKey,
        sender.account_id,
        receiver.account_id,
        input.amount,
        input.currency || 'INR',
        input.channel,
        input.clientId || 'BANK_CORE_SWITCH',
        decision,
        compositeScore,
        riskClassification,
        elapsedMs,
        appliedFailMode,
      ]
    );
    const screeningId = screeningRes.rows[0].id;

    await client.query(
      `INSERT INTO transaction_risk_assessments (
         screening_id, account_risk_score, transaction_risk_score,
         network_risk_score, composite_score, score_source,
         thresholds_version, model_version, rules_triggered, ml_factors,
         plain_language_explanation, limitations_disclaimer, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, NOW())`,
      [
        screeningId,
        Math.round(((senderScore + receiverScore) / 2) * 10) / 10,
        transactionScore,
        networkScore,
        compositeScore,
        scoreSource,
        thresholds.version,
        modelVersion,
        JSON.stringify(rulesTriggered),
        JSON.stringify(mlFactors),
        plainLanguageExplanation,
        limitationsDisclaimer,
      ]
    );

    await client.query(
      `INSERT INTO transaction_interventions (
         screening_id, recommended_action, review_status, created_at, updated_at
       )
       VALUES ($1, $2, 'PENDING', NOW(), NOW())`,
      [screeningId, recommendedAction]
    );

    // I. Cryptographic SHA-256 Tamper-Evident Hash Chain
    const lastAuditRes = await client.query(
      `SELECT entry_hash FROM intervention_audit_logs ORDER BY sequence_number DESC LIMIT 1`
    );
    const prevHash =
      lastAuditRes.rows[0]?.entry_hash ||
      '0000000000000000000000000000000000000000000000000000000000000000';

    const screenedAtIso = new Date().toISOString();
    const currHash = crypto
      .createHash('sha256')
      .update(`${prevHash}:${screeningId}:SCREENING_DECISION_RECORDED:${decision}:${screenedAtIso}`)
      .digest('hex');

    await client.query(
      `INSERT INTO intervention_audit_logs (
         screening_id, actor_user_id, actor_role, action,
         previous_hash, entry_hash, payload_json, ip_address, created_at
       )
       VALUES ($1, $2, $3, 'SCREENING_DECISION_RECORDED', $4, $5, $6::jsonb, $7, NOW())`,
      [
        screeningId,
        actorUserId || null,
        'SYSTEM_SCREENER',
        prevHash,
        currHash,
        JSON.stringify({
          decision,
          compositeScore,
          rulesTriggered: rulesTriggered.map((r) => r.name),
        }),
        '127.0.0.1',
      ]
    );

    return {
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
      scoreSource,
      thresholdsVersion: thresholds.version,
      rulesTriggered,
      plainLanguageExplanation,
      limitationsDisclaimer,
      senderAccount: {
        id: sender.account_id,
        accountNumber: sender.account_number,
        holderName: sender.holder_name,
        bankName: sender.bank_name,
        accountStatus: sender.account_status,
      },
      receiverAccount: {
        id: receiver.account_id,
        accountNumber: receiver.account_number,
        holderName: receiver.holder_name,
        bankName: receiver.bank_name,
        accountStatus: receiver.account_status,
      },
      idempotentReplay: false,
      screenedAt: screenedAtIso,
    };
  });

  return result;
}
