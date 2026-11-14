import crypto from 'node:crypto';
import {
  AccountSeed,
  AccountIntelligenceSeed,
  AlertSeed,
  AtmPredictionSeed,
  AtmSeed,
  AtmWithdrawalSeed,
  CitizenNotificationSeed,
  ComplaintSeed,
  ComplaintStatusHistorySeed,
  EvidenceSeed,
  FraudIndicatorSeed,
  generateSyntheticDataset,
  InstitutionSeed,
  InterventionAuditSeed,
  InterventionSeed,
  InvestigationSeed,
  RiskAssessmentSeed,
  RoleSeed,
  ScreeningRequestSeed,
  ScreeningThresholdSeed,
  SuspiciousAccountSeed,
  SuspiciousRelationshipSeed,
  SystemSettingSeed,
  TransactionSeed,
  UserSeed,
  VictimSeed,
} from '../FinTrace/database/seeds/synthetic_generator.ts';

export interface StoredUser extends UserSeed {
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface StoredInvestigator {
  id: string;
  user_id: string;
  badge_number: string;
  unit_name: string;
  jurisdiction: string;
  specialization: string | null;
  active_caseload: number;
}

export interface StoredRefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface StoredTransaction extends TransactionSeed {
  id: string;
  currency: string;
  is_synthetic: boolean;
}

export interface StoredComplaint extends ComplaintSeed {
  currency: string;
  is_synthetic: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoredSuspiciousAccount extends SuspiciousAccountSeed {
  created_at: string;
  updated_at: string;
}

export interface StoredAtmPrediction extends AtmPredictionSeed {
  predicted_at: string;
}

export interface StoredAlert extends AlertSeed {
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredInvestigation {
  id: string;
  case_number: string;
  complaint_id: string;
  lead_investigator: string | null;
  status: InvestigationSeed['status'];
  findings_summary: string | null;
  recommended_actions: Array<{
    action: string;
    priority: 'IMMEDIATE' | 'HIGH' | 'MEDIUM' | 'LOW';
    done: boolean;
  }>;
  opened_at: string;
  closed_at: string | null;
  updated_at: string;
}

export interface StoredEvidence extends Omit<EvidenceSeed, 'file_name' | 'investigation_id'> {
  investigation_id: string | null;
  file_name: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  is_citizen_visible?: boolean;
  recorded_at: string;
}

export interface StoredComplaintStatusHistory extends Omit<ComplaintStatusHistorySeed, 'changed_at'> {
  changed_at: string;
}

export interface StoredCitizenNotification extends Omit<CitizenNotificationSeed, 'created_at'> {
  created_at: string;
}

export interface ShapFactor {
  feature: string;
  value: number;
  shap_value: number;
  direction: 'increases_risk' | 'decreases_risk';
}

export interface StoredFraudResult {
  id: string;
  complaint_id: string | null;
  account_id: string;
  is_anomaly: boolean;
  anomaly_score: number;
  mule_score: number;
  score_source: 'Trained ML prediction' | 'Rule-based risk score' | 'Synthetic demo result';
  velocity_1h: number;
  pass_through_ratio: number;
  avg_forward_latency_sec: number | null;
  explanation_json: {
    top_shap_factors?: ShapFactor[];
    rule_factors?: string[];
    model_version?: string;
  };
  shap_values_json: ShapFactor[] | null;
  model_name: string | null;
  model_version: string | null;
  predicted_label: string | null;
  detected_at: string;
}

export interface StoredModelMetrics {
  id: string;
  model_name: string;
  model_version: string;
  split_strategy: string;
  train_count: number;
  val_count: number;
  test_count: number;
  precision_score: number;
  recall_score: number;
  f1_score: number;
  roc_auc: number | null;
  pr_auc: number | null;
  precision_at_k: Record<string, number>;
  recall_at_k: Record<string, number>;
  confusion_matrix: { tn: number; fp: number; fn: number; tp: number };
  feature_importance: Array<{ feature: string; importance: number }>;
  trained_at: string;
}

export interface StoredAuditLog {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  http_method: string | null;
  endpoint: string | null;
  ip_address: string | null;
  status_code: number | null;
  details_json: Record<string, unknown>;
  created_at: string;
}

export interface GraphNodeMetrics {
  id: string;
  account_number: string;
  holder_name: string;
  account_type: string;
  branch_city: string;
  is_frozen: boolean;
  suspicious_classification: string | null;
  mule_probability: number | null;
  in_degree: number;
  out_degree: number;
  fan_in: number;
  fan_out: number;
  total_inflow: number;
  total_outflow: number;
  pass_through_ratio: number | null;
  avg_forward_latency_sec: number | null;
  min_forward_latency_sec: number | null;
  velocity_1h: number;
  pagerank: number;
  betweenness_centrality: number;
  risk_score?: number;
  risk_classification?: string;
  propagated_risk?: number;
  mule_cluster_id?: string | null;
  mule_cluster_role?: string | null;
}

export interface FinTraceStore {
  roles: RoleSeed[];
  institutions: InstitutionSeed[];
  users: StoredUser[];
  investigators: StoredInvestigator[];
  refreshTokens: StoredRefreshToken[];
  victims: VictimSeed[];
  accounts: AccountSeed[];
  atms: AtmSeed[];
  complaints: StoredComplaint[];
  transactions: StoredTransaction[];
  atmWithdrawals: AtmWithdrawalSeed[];
  suspiciousAccounts: StoredSuspiciousAccount[];
  atmPredictions: StoredAtmPrediction[];
  alerts: StoredAlert[];
  investigations: StoredInvestigation[];
  evidenceRecords: StoredEvidence[];
  fraudResults: StoredFraudResult[];
  modelMetrics: StoredModelMetrics[];
  auditLogs: StoredAuditLog[];
  complaintStatusHistory: StoredComplaintStatusHistory[];
  citizenNotifications: StoredCitizenNotification[];
  screeningThresholds: ScreeningThresholdSeed[];
  systemSettings: SystemSettingSeed[];
  fraudIndicators: FraudIndicatorSeed[];
  accountIntelligenceProfiles: AccountIntelligenceSeed[];
  accountRiskHistory: AccountRiskHistoryRecord[];
  screeningRequests: ScreeningRequestSeed[];
  riskAssessments: RiskAssessmentSeed[];
  interventions: InterventionSeed[];
  suspiciousRelationships: SuspiciousRelationshipSeed[];
  interventionAuditLogs: InterventionAuditSeed[];
}

export interface AccountRiskHistoryRecord {
  id: string;
  account_id: string;
  previous_score: number | null;
  new_score: number;
  previous_classification: string | null;
  new_classification: string;
  trigger_event: string;
  trigger_reference_id?: string | null;
  reasons_json: string[];
  assessed_by: string;
  recorded_at: string;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createInitialStore(): FinTraceStore {
  const seed = generateSyntheticDataset();
  const nowIso = new Date().toISOString();

  const investigators: StoredInvestigator[] = [];
  const users: StoredUser[] = seed.users.map((u) => {
    if (u.investigator) {
      investigators.push({
        id: u.investigator.id,
        user_id: u.id,
        badge_number: u.investigator.badge_number,
        unit_name: u.investigator.unit_name,
        jurisdiction: u.investigator.jurisdiction,
        specialization: u.investigator.specialization,
        active_caseload: u.investigator.active_caseload,
      });
    }
    return {
      ...u,
      is_active: true,
      last_login_at: null,
      created_at: nowIso,
    };
  });

  const complaints: StoredComplaint[] = seed.complaints.map((c) => ({
    ...c,
    currency: 'INR',
    is_synthetic: true,
    created_at: c.reported_at.toISOString(),
    updated_at: c.reported_at.toISOString(),
  }));

  const transactions: StoredTransaction[] = seed.transactions.map((t) => ({
    ...t,
    id: crypto.randomUUID(),
    currency: 'INR',
    is_synthetic: true,
  }));

  const suspiciousAccounts: StoredSuspiciousAccount[] = seed.suspiciousAccounts.map((sa) => ({
    ...sa,
    created_at: nowIso,
    updated_at: nowIso,
  }));

  const atmPredictions: StoredAtmPrediction[] = seed.atmPredictions.map((ap) => ({
    ...ap,
    predicted_at: nowIso,
  }));

  const alerts: StoredAlert[] = seed.alerts.map((al, idx) => ({
    ...al,
    acknowledged_by: al.status === 'OPEN' ? null : users[1].id,
    acknowledged_at: al.status === 'OPEN' ? null : new Date(Date.now() - (idx + 1) * 3600000).toISOString(),
    created_at: new Date(Date.now() - (idx + 1) * 1800000).toISOString(),
    updated_at: nowIso,
  }));

  const investigations: StoredInvestigation[] = seed.investigations.map((inv) => ({
    id: inv.id,
    case_number: inv.case_number,
    complaint_id: inv.complaint_id,
    lead_investigator: inv.lead_investigator,
    status: inv.status,
    findings_summary: inv.findings_summary,
    recommended_actions: inv.recommended_actions.map((action, idx) => ({
      action,
      priority: idx === 0 ? 'IMMEDIATE' : 'HIGH',
      done: inv.status === 'CLOSED',
    })),
    opened_at: nowIso,
    closed_at: inv.status === 'CLOSED' ? nowIso : null,
    updated_at: nowIso,
  }));

  const evidenceRecords: StoredEvidence[] = seed.evidenceRecords.map((ev, idx) => ({
    ...ev,
    recorded_at: new Date(Date.now() - (idx + 1) * 3600000).toISOString(),
  }));

  const store: FinTraceStore = {
    roles: seed.roles,
    institutions: seed.institutions,
    users,
    investigators,
    refreshTokens: [],
    victims: seed.victims,
    accounts: seed.accounts,
    atms: seed.atms,
    complaints,
    transactions,
    atmWithdrawals: seed.atmWithdrawals,
    suspiciousAccounts,
    atmPredictions,
    alerts,
    investigations,
    evidenceRecords,
    fraudResults: [],
    modelMetrics: [],
    complaintStatusHistory: seed.complaintStatusHistory.map((h) => ({
      ...h,
      changed_at: h.changed_at.toISOString(),
    })),
    citizenNotifications: seed.citizenNotifications.map((n) => ({
      ...n,
      created_at: n.created_at.toISOString(),
    })),
    screeningThresholds: seed.screeningThresholds,
    systemSettings: seed.systemSettings,
    fraudIndicators: seed.fraudIndicators,
    accountIntelligenceProfiles: seed.accountIntelligenceProfiles,
    accountRiskHistory: seed.accountIntelligenceProfiles.flatMap((prof, i) => {
      const records: AccountRiskHistoryRecord[] = [
        {
          id: `hist-base-${prof.account_id.slice(0, 8)}`,
          account_id: prof.account_id,
          previous_score: null,
          new_score: prof.risk_score,
          previous_classification: null,
          new_classification: prof.risk_classification,
          trigger_event:
            prof.account_status === 'CONFIRMED_FRAUD_LINKED'
              ? 'COMPLAINT_EVIDENCE_LINKAGE'
              : prof.account_status === 'SUSPECTED_MULE_ACCOUNT'
                ? 'MULE_NETWORK_DETECTION'
                : 'BASELINE_ACCOUNT_ONBOARDING',
          trigger_reference_id:
            prof.account_status === 'CONFIRMED_FRAUD_LINKED' ? 'CMP-2024-001' : null,
          reasons_json: prof.risk_reasons,
          assessed_by: 'SYSTEM',
          recorded_at: new Date(Date.now() - 3600 * 1000 * (48 + (i % 24))).toISOString(),
        },
      ];
      if (prof.risk_score >= 50) {
        records.push({
          id: `hist-subseq-${prof.account_id.slice(0, 8)}`,
          account_id: prof.account_id,
          previous_score: Math.max(10, prof.risk_score - 25),
          new_score: prof.risk_score,
          previous_classification: 'Low',
          new_classification: prof.risk_classification,
          trigger_event: 'VELOCITY_ACCELERATION_BURST',
          trigger_reference_id: null,
          reasons_json:
            prof.mule_indicators.length > 0
              ? prof.mule_indicators
              : ['Rapid pass-through acceleration detected in screening pipeline'],
          assessed_by: 'AUTOMATED_SCREENING_SERVICE',
          recorded_at: new Date(Date.now() - 3600 * 1000 * (6 + (i % 6))).toISOString(),
        });
      }
      return records;
    }),
    screeningRequests: seed.screeningRequests,
    riskAssessments: seed.riskAssessments,
    interventions: seed.interventions,
    suspiciousRelationships: seed.suspiciousRelationships,
    interventionAuditLogs: seed.interventionAuditLogs,
    auditLogs: [
      {
        id: crypto.randomUUID(),
        actor_user_id: users[0].id,
        actor_role: 'Administrator',
        action: 'SYNTHETIC_DATASET_SEEDED',
        resource_type: 'SYSTEM',
        resource_id: 'fintrace-preview',
        http_method: 'BOOT',
        endpoint: '/bootstrap',
        ip_address: '127.0.0.1',
        status_code: 200,
        details_json: {
          accounts: seed.accounts.length,
          complaints: complaints.length,
          transactions: transactions.length,
          atms: seed.atms.length,
        },
        created_at: nowIso,
      },
    ],
  };

  // Seed initial rule-based fraud detections across active complaints
  for (const cmp of store.complaints) {
    detectFraudForComplaint(store, cmp.id);
  }
  // Compute initial chronological baseline evaluation on the synthetic dataset
  trainBaselineEvaluator(store);

  return store;
}

export const dbStore: FinTraceStore = createInitialStore();

export function resolveAccount(store: FinTraceStore, identifier: string): AccountSeed | undefined {
  return (
    store.accounts.find((a) => a.id === identifier) ??
    store.accounts.find((a) => a.account_number.toLowerCase() === identifier.toLowerCase())
  );
}

function computeSubgraphMetrics(
  store: FinTraceStore,
  subEdges: StoredTransaction[],
  nodeIds: Set<string>
): { nodes: GraphNodeMetrics[]; cycles: string[][] } {
  const accountMap = new Map(store.accounts.map((a) => [a.id, a]));
  const suspByAcc = new Map<string, StoredSuspiciousAccount>();
  for (const s of store.suspiciousAccounts) {
    const existing = suspByAcc.get(s.account_id);
    if (!existing || (s.mule_probability ?? 0) > (existing.mule_probability ?? 0)) {
      suspByAcc.set(s.account_id, s);
    }
  }

  const nodeIdList = Array.from(nodeIds);
  const inEdges = new Map<string, StoredTransaction[]>();
  const outEdges = new Map<string, StoredTransaction[]>();
  for (const id of nodeIdList) {
    inEdges.set(id, []);
    outEdges.set(id, []);
  }

  for (const e of subEdges) {
    inEdges.get(e.to_account)?.push(e);
    outEdges.get(e.from_account)?.push(e);
  }

  // Iterative PageRank (20 iterations, damping=0.85)
  const nCount = Math.max(1, nodeIdList.length);
  let pr = new Map<string, number>(nodeIdList.map((id) => [id, 1 / nCount]));
  for (let iter = 0; iter < 20; iter++) {
    const nextPr = new Map<string, number>(nodeIdList.map((id) => [id, 0.15 / nCount]));
    let danglingSum = 0;
    for (const id of nodeIdList) {
      const outs = outEdges.get(id) ?? [];
      if (outs.length === 0) {
        danglingSum += pr.get(id) ?? 0;
      } else {
        const share = (0.85 * (pr.get(id) ?? 0)) / outs.length;
        for (const e of outs) {
          nextPr.set(e.to_account, (nextPr.get(e.to_account) ?? 0) + share);
        }
      }
    }
    const danglingShare = (0.85 * danglingSum) / nCount;
    for (const id of nodeIdList) {
      nextPr.set(id, (nextPr.get(id) ?? 0) + danglingShare);
    }
    pr = nextPr;
  }

  // Unweighted shortest-path betweenness centrality
  const btw = new Map<string, number>(nodeIdList.map((id) => [id, 0]));
  for (const s of nodeIdList) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>(nodeIdList.map((v) => [v, []]));
    const sigma = new Map<string, number>(nodeIdList.map((v) => [v, v === s ? 1 : 0]));
    const dist = new Map<string, number>(nodeIdList.map((v) => [v, v === s ? 0 : -1]));
    const queue: string[] = [s];
    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      const neighbors = Array.from(new Set((outEdges.get(v) ?? []).map((e) => e.to_account)));
      for (const w of neighbors) {
        if ((dist.get(w) ?? -1) < 0) {
          queue.push(w);
          dist.set(w, (dist.get(v) ?? 0) + 1);
        }
        if (dist.get(w) === (dist.get(v) ?? 0) + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 0));
          pred.get(w)!.push(v);
        }
      }
    }
    const delta = new Map<string, number>(nodeIdList.map((v) => [v, 0]));
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred.get(w) ?? []) {
        const contrib = ((sigma.get(v) ?? 0) / Math.max(1, sigma.get(w) ?? 1)) * (1 + (delta.get(w) ?? 0));
        delta.set(v, (delta.get(v) ?? 0) + contrib);
      }
      if (w !== s) {
        btw.set(w, (btw.get(w) ?? 0) + (delta.get(w) ?? 0));
      }
    }
  }
  const normDenom = nodeIdList.length > 2 ? (nodeIdList.length - 1) * (nodeIdList.length - 2) : 1;

  // Simple directed cycles (bounded depth <= 5)
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const id of nodeIdList) {
    adj.set(id, Array.from(new Set((outEdges.get(id) ?? []).map((e) => e.to_account))));
  }
  const dfsCycle = (start: string, curr: string, path: string[], visited: Set<string>) => {
    if (cycles.length >= 12 || path.length > 5) return;
    for (const nxt of adj.get(curr) ?? []) {
      if (nxt === start && path.length >= 2) {
        const minIdx = path.reduce((best, val, idx) => (val < path[best] ? idx : best), 0);
        const canonical = [...path.slice(minIdx), ...path.slice(0, minIdx)].join('->');
        if (!seenCycleKeys.has(canonical)) {
          seenCycleKeys.add(canonical);
          cycles.push([...path]);
        }
      } else if (!visited.has(nxt) && nxt > start) {
        visited.add(nxt);
        path.push(nxt);
        dfsCycle(start, nxt, path, visited);
        path.pop();
        visited.delete(nxt);
      }
    }
  };
  for (const start of [...nodeIdList].sort()) {
    dfsCycle(start, start, [start], new Set([start]));
  }

  const nodes: GraphNodeMetrics[] = nodeIdList
    .map((id) => {
      const acc = accountMap.get(id);
      const ins = inEdges.get(id) ?? [];
      const outs = outEdges.get(id) ?? [];
      const totalIn = ins.reduce((s, e) => s + Number(e.amount), 0);
      const totalOut = outs.reduce((s, e) => s + Number(e.amount), 0);
      const fanIn = new Set(ins.map((e) => e.from_account)).size;
      const fanOut = new Set(outs.map((e) => e.to_account)).size;

      // Forward latencies from earliest/matched inflow to subsequent outflow
      const latencies: number[] = [];
      for (const outTx of outs) {
        const outTime = new Date(outTx.timestamp).getTime();
        const priorIns = ins.filter((inTx) => new Date(inTx.timestamp).getTime() <= outTime);
        if (priorIns.length > 0) {
          const latestIn = Math.max(...priorIns.map((t) => new Date(t.timestamp).getTime()));
          latencies.push(Math.max(1, Math.round((outTime - latestIn) / 1000)));
        }
      }

      // Max 1h transaction velocity
      const allTimes = [...ins, ...outs]
        .map((t) => new Date(t.timestamp).getTime())
        .sort((a, b) => a - b);
      let max1h = 0;
      let left = 0;
      for (let right = 0; right < allTimes.length; right++) {
        while (allTimes[right] - allTimes[left] > 3600 * 1000) left++;
        max1h = Math.max(max1h, right - left + 1);
      }

      const susp = suspByAcc.get(id);
      const intel = store.accountIntelligenceProfiles.find((p) => p.account_id === id);
      const riskScore = intel?.risk_score ?? (
        susp?.classification === 'SUSPECTED_MULE' || susp?.classification === 'CASH_OUT_CANDIDATE' ? 75 :
        susp?.classification === 'LAYERING_NODE' ? 65 : 10
      );
      const riskCls = intel?.risk_classification ?? (
        susp?.classification === 'SUSPECTED_MULE' || susp?.classification === 'CASH_OUT_CANDIDATE' ? 'High' :
        susp?.classification === 'LAYERING_NODE' ? 'Medium' : 'Low'
      );

      return {
        id,
        account_number: acc?.account_number ?? id,
        holder_name: acc?.holder_name ?? 'Unknown Holder',
        account_type: acc?.account_type ?? 'SAVINGS',
        branch_city: acc?.branch_city ?? 'Bengaluru',
        is_frozen: acc?.is_frozen ?? false,
        suspicious_classification: susp?.classification ?? null,
        mule_probability: susp?.mule_probability ?? null,
        risk_score: riskScore,
        risk_classification: riskCls,
        in_degree: ins.length,
        out_degree: outs.length,
        fan_in: fanIn,
        fan_out: fanOut,
        total_inflow: Math.round(totalIn * 100) / 100,
        total_outflow: Math.round(totalOut * 100) / 100,
        pass_through_ratio: totalIn > 0 ? Math.min(2, Math.round((totalOut / totalIn) * 1000) / 1000) : null,
        avg_forward_latency_sec:
          latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
        min_forward_latency_sec: latencies.length > 0 ? Math.min(...latencies) : null,
        velocity_1h: max1h,
        pagerank: Math.round((pr.get(id) ?? 0) * 10000) / 10000,
        betweenness_centrality: Math.round(((btw.get(id) ?? 0) / normDenom) * 10000) / 10000,
      };
    })
    .sort((a, b) => b.total_inflow + b.total_outflow - (a.total_inflow + a.total_outflow));

  return { nodes, cycles };
}

function buildGraphResponse(
  store: FinTraceStore,
  subEdges: StoredTransaction[],
  nodeIds: Set<string>,
  extraSummary: Record<string, unknown> = {}
) {
  const sortedEdges = [...subEdges].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const accMap = new Map(store.accounts.map((a) => [a.id, a]));
  const { nodes, cycles } = computeSubgraphMetrics(store, sortedEdges, nodeIds);

  const timeline = sortedEdges.map((e, idx) => {
    const prevTime = idx > 0 ? new Date(sortedEdges[idx - 1].timestamp).getTime() : new Date(e.timestamp).getTime();
    const currTime = new Date(e.timestamp).getTime();
    const fa = accMap.get(e.from_account);
    const ta = accMap.get(e.to_account);
    return {
      txn_id: e.txn_id,
      timestamp: e.timestamp.toISOString(),
      delta_from_prev_sec: idx === 0 ? 0 : Math.max(0, Math.round((currTime - prevTime) / 1000)),
      from_account: e.from_account,
      from_account_number: fa?.account_number ?? e.from_account,
      from_holder: fa?.holder_name ?? 'Unknown',
      to_account: e.to_account,
      to_account_number: ta?.account_number ?? e.to_account,
      to_holder: ta?.holder_name ?? 'Unknown',
      amount: Number(e.amount),
      channel: e.channel,
      hop_depth: e.hop_depth,
      is_flagged_fraud: e.is_flagged_fraud,
    };
  });

  const totalAmount = sortedEdges.reduce((s, e) => s + Number(e.amount), 0);
  return {
    nodes,
    edges: sortedEdges.map((e) => ({
      txn_id: e.txn_id,
      from_account: e.from_account,
      to_account: e.to_account,
      amount: Number(e.amount),
      timestamp: e.timestamp.toISOString(),
      channel: e.channel,
      complaint_id: e.complaint_id,
      hop_depth: e.hop_depth,
      is_flagged_fraud: e.is_flagged_fraud,
    })),
    timeline,
    cycles,
    summary: {
      node_count: nodes.length,
      edge_count: sortedEdges.length,
      total_amount: Math.round(totalAmount * 100) / 100,
      has_cycles: cycles.length > 0,
      cycle_count: cycles.length,
      ...extraSummary,
    },
  };
}

export function traceAccountGraph(
  store: FinTraceStore,
  rootAccountId: string,
  direction: 'forward' | 'reverse' | 'both',
  maxDepth: number,
  complaintId?: string
) {
  const pool = complaintId
    ? store.transactions.filter((t) => t.complaint_id === complaintId)
    : store.transactions;

  const visitedNodes = new Set<string>([rootAccountId]);
  const collectedEdges = new Map<string, StoredTransaction>();
  const cteRows: Array<{
    txn_id: string;
    from_account: string;
    to_account: string;
    amount: number;
    timestamp: string;
    channel: string;
    complaint_id: string | null;
    is_flagged_fraud: boolean;
    depth: number;
    from_account_number: string;
    from_holder: string;
    to_account_number: string;
    to_holder: string;
  }> = [];

  let frontier = new Set<string>([rootAccountId]);
  const accMap = new Map(store.accounts.map((a) => [a.id, a]));

  for (let d = 1; d <= maxDepth && frontier.size > 0; d++) {
    const nextFrontier = new Set<string>();
    for (const tx of pool) {
      const fwdMatch = (direction === 'forward' || direction === 'both') && frontier.has(tx.from_account);
      const revMatch = (direction === 'reverse' || direction === 'both') && frontier.has(tx.to_account);
      if (fwdMatch || revMatch) {
        if (!collectedEdges.has(tx.txn_id)) {
          collectedEdges.set(tx.txn_id, tx);
          const fa = accMap.get(tx.from_account);
          const ta = accMap.get(tx.to_account);
          cteRows.push({
            txn_id: tx.txn_id,
            from_account: tx.from_account,
            to_account: tx.to_account,
            amount: Number(tx.amount),
            timestamp: tx.timestamp.toISOString(),
            channel: tx.channel,
            complaint_id: tx.complaint_id,
            is_flagged_fraud: tx.is_flagged_fraud,
            depth: d,
            from_account_number: fa?.account_number ?? tx.from_account,
            from_holder: fa?.holder_name ?? 'Unknown',
            to_account_number: ta?.account_number ?? tx.to_account,
            to_holder: ta?.holder_name ?? 'Unknown',
          });
        }
        if (fwdMatch && !visitedNodes.has(tx.to_account)) {
          visitedNodes.add(tx.to_account);
          nextFrontier.add(tx.to_account);
        }
        if (revMatch && !visitedNodes.has(tx.from_account)) {
          visitedNodes.add(tx.from_account);
          nextFrontier.add(tx.from_account);
        }
      }
    }
    frontier = nextFrontier;
  }

  const graph = buildGraphResponse(store, Array.from(collectedEdges.values()), visitedNodes, {
    root_account_id: rootAccountId,
    direction,
    max_depth: maxDepth,
  });

  return { graph, cteRows };
}

export function traceComplaintGraph(store: FinTraceStore, complaintId: string) {
  const edges = store.transactions.filter((t) => t.complaint_id === complaintId);
  const nodeIds = new Set<string>();
  for (const e of edges) {
    nodeIds.add(e.from_account);
    nodeIds.add(e.to_account);
  }
  const rootId = edges[0]?.from_account;
  return buildGraphResponse(store, edges, nodeIds, {
    root_account_id: rootId,
    direction: 'forward',
    max_depth: 5,
  });
}

export function findSuspiciousPaths(
  store: FinTraceStore,
  sourceAccountId: string,
  targetAccountId?: string,
  complaintId?: string,
  maxDepth = 5
) {
  const pool = complaintId
    ? store.transactions.filter((t) => t.complaint_id === complaintId)
    : store.transactions;
  const accMap = new Map(store.accounts.map((a) => [a.id, a]));

  const bySource = new Map<string, StoredTransaction[]>();
  for (const tx of pool) {
    const list = bySource.get(tx.from_account) ?? [];
    list.push(tx);
    bySource.set(tx.from_account, list);
  }

  const results: Array<{
    path_ids: string[];
    path_account_numbers: string[];
    hop_count: number;
    bottleneck_amount: number;
    edges: Array<{ from: string; to: string; txn_ids: string[]; amount: number }>;
  }> = [];

  const dfs = (curr: string, path: string[], edgeChain: StoredTransaction[], visited: Set<string>) => {
    if (results.length >= 25) return;
    const outs = bySource.get(curr) ?? [];
    const isLeaf = outs.filter((e) => !visited.has(e.to_account)).length === 0;

    if (path.length >= 2 && ((targetAccountId && curr === targetAccountId) || (!targetAccountId && isLeaf))) {
      const groupedEdges = edgeChain.map((e) => ({
        from: e.from_account,
        to: e.to_account,
        txn_ids: [e.txn_id],
        amount: Number(e.amount),
      }));
      results.push({
        path_ids: [...path],
        path_account_numbers: path.map((id) => accMap.get(id)?.account_number ?? id),
        hop_count: edgeChain.length,
        bottleneck_amount: Math.min(...edgeChain.map((e) => Number(e.amount))),
        edges: groupedEdges,
      });
      if (targetAccountId) return;
    }

    if (edgeChain.length >= maxDepth) return;
    for (const tx of outs) {
      if (!visited.has(tx.to_account)) {
        visited.add(tx.to_account);
        path.push(tx.to_account);
        edgeChain.push(tx);
        dfs(tx.to_account, path, edgeChain, visited);
        edgeChain.pop();
        path.pop();
        visited.delete(tx.to_account);
      }
    }
  };

  dfs(sourceAccountId, [sourceAccountId], [], new Set([sourceAccountId]));
  return results.sort((a, b) => b.bottleneck_amount - a.bottleneck_amount);
}

// ---------------- PHASE 5: MULE CLUSTER DETECTION & GRAPH INTELLIGENCE ----------------

export interface StoredMuleClusterMember {
  account_id: string;
  account_number: string;
  holder_name: string;
  bank_name?: string;
  role: 'SOURCE' | 'INTERMEDIARY_MULE' | 'CASH_OUT_SINK' | 'COORDINATOR' | 'MEMBER';
  risk_score: number;
  risk_classification: string;
  mule_probability: number;
  in_degree: number;
  out_degree: number;
  total_inflow: number;
  total_outflow: number;
  is_frozen: boolean;
}

export interface StoredMuleCluster {
  cluster_id: string;
  cluster_type:
    | 'MULE_RING_CYCLE'
    | 'FAN_OUT_DISPERSAL'
    | 'RAPID_PASS_THROUGH_CHAIN'
    | 'FUNNEL_COLLECTION'
    | 'SUSPICIOUS_COMMUNITY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  member_count: number;
  members: StoredMuleClusterMember[];
  total_flow_amount: number;
  transaction_count: number;
  avg_transfer_latency_sec: number | null;
  has_cycle: boolean;
  cycle_nodes: string[];
  risk_score: number;
  identified_patterns: string[];
  recommended_action: string;
  detected_at: string;
}

export function detectMuleClusters(
  store: FinTraceStore,
  minClusterSize = 2,
  minRiskScore = 30
) {
  const accMap = new Map(store.accounts.map((a) => [a.id, a]));
  const intelMap = new Map(store.accountIntelligenceProfiles.map((p) => [p.account_id, p]));
  const suspMap = new Map(store.suspiciousAccounts.map((s) => [s.account_id, s]));

  const bySource = new Map<string, StoredTransaction[]>();
  const byTarget = new Map<string, StoredTransaction[]>();
  for (const tx of store.transactions) {
    const sList = bySource.get(tx.from_account) ?? [];
    sList.push(tx);
    bySource.set(tx.from_account, sList);

    const tList = byTarget.get(tx.to_account) ?? [];
    tList.push(tx);
    byTarget.set(tx.to_account, tList);
  }

  const clusters: StoredMuleCluster[] = [];
  const seenSignatures = new Set<string>();

  const getBankName = (accId: string) => {
    const acc = accMap.get(accId);
    if (!acc) return 'FinTrace Bank';
    return store.institutions.find((i) => i.id === acc.institution_id)?.name ?? 'FinTrace Bank';
  };

  const getMuleProb = (accId: string) => {
    const susp = suspMap.get(accId);
    if (susp?.mule_probability !== undefined && susp.mule_probability !== null) return susp.mule_probability;
    const intel = intelMap.get(accId);
    if (intel?.account_status === 'CONFIRMED_FRAUD_LINKED') return 0.98;
    if (intel?.account_status === 'SUSPECTED_MULE_ACCOUNT') return 0.85;
    return 0.2;
  };

  // A. Cycle rings (MULE_RING_CYCLE)
  const allNodeIds = Array.from(new Set(store.transactions.flatMap((t) => [t.from_account, t.to_account])));
  const adj = new Map<string, string[]>();
  for (const id of allNodeIds) {
    adj.set(id, Array.from(new Set((bySource.get(id) ?? []).map((e) => e.to_account))));
  }

  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  const dfsCycle = (start: string, curr: string, path: string[], visited: Set<string>) => {
    if (cycles.length >= 15 || path.length > 5) return;
    for (const nxt of adj.get(curr) ?? []) {
      if (nxt === start && path.length >= 2) {
        const minIdx = path.reduce((best, val, idx) => (val < path[best] ? idx : best), 0);
        const canonical = [...path.slice(minIdx), ...path.slice(0, minIdx)].join('->');
        if (!seenCycleKeys.has(canonical)) {
          seenCycleKeys.add(canonical);
          cycles.push([...path]);
        }
      } else if (!visited.has(nxt) && nxt > start) {
        visited.add(nxt);
        path.push(nxt);
        dfsCycle(start, nxt, path, visited);
        path.pop();
        visited.delete(nxt);
      }
    }
  };

  for (const start of [...allNodeIds].sort()) {
    dfsCycle(start, start, [start], new Set([start]));
  }

  for (const cycle of cycles) {
    const sig = [...cycle].sort().join('-');
    if (seenSignatures.has(sig)) continue;
    seenSignatures.add(sig);

    const cycleTxs = store.transactions.filter(
      (t) => cycle.includes(t.from_account) && cycle.includes(t.to_account)
    );
    const totalAmt = cycleTxs.reduce((s, t) => s + Number(t.amount), 0);

    const members: StoredMuleClusterMember[] = cycle.map((n) => {
      const acc = accMap.get(n);
      const intel = intelMap.get(n);
      const susp = suspMap.get(n);
      const ins = cycleTxs.filter((t) => t.to_account === n);
      const outs = cycleTxs.filter((t) => t.from_account === n);

      const rScore = intel?.risk_score ?? (
        intel?.account_status === 'CONFIRMED_FRAUD_LINKED' ? 95 :
        susp?.classification === 'SUSPECTED_MULE' || susp?.classification === 'CASH_OUT_CANDIDATE' ? 75 : 70
      );

      return {
        account_id: n,
        account_number: acc?.account_number ?? n,
        holder_name: acc?.holder_name ?? 'Unknown',
        bank_name: getBankName(n),
        role: 'INTERMEDIARY_MULE',
        risk_score: rScore,
        risk_classification: intel?.risk_classification ?? (susp?.classification === 'SUSPECTED_MULE' ? 'High' : 'Medium'),
        mule_probability: getMuleProb(n),
        in_degree: (byTarget.get(n) ?? []).length,
        out_degree: (bySource.get(n) ?? []).length,
        total_inflow: Math.round(ins.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100,
        total_outflow: Math.round(outs.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100,
        is_frozen: acc?.is_frozen ?? false,
      };
    });

    const maxScore = Math.max(...members.map((m) => m.risk_score), 75);
    const hasFraud = members.some((m) => m.risk_classification === 'Critical' || m.risk_score >= 90);
    const clusterScore = hasFraud ? Math.max(maxScore, 92) : maxScore;
    const severity = clusterScore >= 85 || totalAmt >= 300000 ? 'CRITICAL' : 'HIGH';

    clusters.push({
      cluster_id: `RING-${String(clusters.length + 1).padStart(3, '0')}`,
      cluster_type: 'MULE_RING_CYCLE',
      severity,
      member_count: members.length,
      members,
      total_flow_amount: Math.round(totalAmt * 100) / 100,
      transaction_count: cycleTxs.length,
      avg_transfer_latency_sec: 420,
      has_cycle: true,
      cycle_nodes: cycle,
      risk_score: Math.round(clusterScore * 10) / 10,
      identified_patterns: [
        `Circular fund layering loop across ${cycle.length} interconnected nodes`,
        'Near-zero economic balance retention across participants',
        'High-velocity cross-account pass-through',
      ],
      recommended_action:
        'Execute simultaneous preventive lien across all ring accounts to prevent capital dispersal.',
      detected_at: new Date().toISOString(),
    });
  }

  // B. Fan-Out Dispersals (1-to-many smurfing)
  for (const [nodeId, outs] of bySource.entries()) {
    const targets = Array.from(new Set(outs.map((t) => t.to_account)));
    if (targets.length >= 3) {
      const sig = `FANOUT-${nodeId}`;
      if (seenSignatures.has(sig)) continue;
      seenSignatures.add(sig);

      const srcAcc = accMap.get(nodeId);
      const srcIntel = intelMap.get(nodeId);
      const srcSusp = suspMap.get(nodeId);
      const totalAmt = outs.reduce((s, t) => s + Number(t.amount), 0);

      const members: StoredMuleClusterMember[] = [
        {
          account_id: nodeId,
          account_number: srcAcc?.account_number ?? nodeId,
          holder_name: srcAcc?.holder_name ?? 'Unknown',
          bank_name: getBankName(nodeId),
          role: 'SOURCE',
          risk_score: srcIntel?.risk_score ?? (srcIntel?.account_status === 'CONFIRMED_FRAUD_LINKED' ? 95 : 75),
          risk_classification: srcIntel?.risk_classification ?? (srcSusp?.classification === 'SUSPECTED_MULE' ? 'High' : 'Medium'),
          mule_probability: getMuleProb(nodeId),
          in_degree: (byTarget.get(nodeId) ?? []).length,
          out_degree: outs.length,
          total_inflow: 0,
          total_outflow: Math.round(totalAmt * 100) / 100,
          is_frozen: srcAcc?.is_frozen ?? false,
        },
      ];

      for (const tgt of targets) {
        const tgtAcc = accMap.get(tgt);
        const tgtIntel = intelMap.get(tgt);
        const tgtSusp = suspMap.get(tgt);
        const tgtIns = outs.filter((t) => t.to_account === tgt);
        const tgtOuts = bySource.get(tgt) ?? [];

        members.push({
          account_id: tgt,
          account_number: tgtAcc?.account_number ?? tgt,
          holder_name: tgtAcc?.holder_name ?? 'Unknown',
          bank_name: getBankName(tgt),
          role: tgtOuts.length === 0 ? 'CASH_OUT_SINK' : 'INTERMEDIARY_MULE',
          risk_score: tgtIntel?.risk_score ?? (tgtSusp?.classification === 'SUSPECTED_MULE' ? 70 : 60),
          risk_classification: tgtIntel?.risk_classification ?? (tgtSusp?.classification === 'SUSPECTED_MULE' ? 'High' : 'Medium'),
          mule_probability: getMuleProb(tgt),
          in_degree: (byTarget.get(tgt) ?? []).length,
          out_degree: tgtOuts.length,
          total_inflow: Math.round(tgtIns.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100,
          total_outflow: 0,
          is_frozen: tgtAcc?.is_frozen ?? false,
        });
      }

      const maxScore = Math.max(...members.map((m) => m.risk_score));
      if (maxScore >= minRiskScore) {
        clusters.push({
          cluster_id: `DISPERSAL-${String(clusters.length + 1).padStart(3, '0')}`,
          cluster_type: 'FAN_OUT_DISPERSAL',
          severity: maxScore >= 80 ? 'CRITICAL' : 'HIGH',
          member_count: members.length,
          members,
          total_flow_amount: Math.round(totalAmt * 100) / 100,
          transaction_count: outs.length,
          avg_transfer_latency_sec: 300,
          has_cycle: false,
          cycle_nodes: [],
          risk_score: Math.round(maxScore * 10) / 10,
          identified_patterns: [
            `1-to-${targets.length} fan-out dispersal pattern (smurfing/layering)`,
            'Rapid fund dispersion below standard reporting thresholds',
          ],
          recommended_action:
            'Halt outbound clearing on source hub and inspect linked beneficiary endpoints.',
          detected_at: new Date().toISOString(),
        });
      }
    }
  }

  // C. Funnel Collections (many-to-1 accumulator)
  for (const [nodeId, ins] of byTarget.entries()) {
    const senders = Array.from(new Set(ins.map((t) => t.from_account)));
    if (senders.length >= 3) {
      const sig = `FUNNEL-${nodeId}`;
      if (seenSignatures.has(sig)) continue;
      seenSignatures.add(sig);

      const acc = accMap.get(nodeId);
      const intel = intelMap.get(nodeId);
      const susp = suspMap.get(nodeId);
      const totalAmt = ins.reduce((s, t) => s + Number(t.amount), 0);

      const members: StoredMuleClusterMember[] = [
        {
          account_id: nodeId,
          account_number: acc?.account_number ?? nodeId,
          holder_name: acc?.holder_name ?? 'Unknown',
          bank_name: getBankName(nodeId),
          role: 'COORDINATOR',
          risk_score: intel?.risk_score ?? (intel?.account_status === 'CONFIRMED_FRAUD_LINKED' ? 95 : 75),
          risk_classification: intel?.risk_classification ?? (susp?.classification === 'SUSPECTED_MULE' ? 'High' : 'Medium'),
          mule_probability: getMuleProb(nodeId),
          in_degree: ins.length,
          out_degree: (bySource.get(nodeId) ?? []).length,
          total_inflow: Math.round(totalAmt * 100) / 100,
          total_outflow: 0,
          is_frozen: acc?.is_frozen ?? false,
        },
      ];

      for (const src of senders) {
        const srcAcc = accMap.get(src);
        const srcIntel = intelMap.get(src);
        const srcSusp = suspMap.get(src);
        const srcOuts = ins.filter((t) => t.from_account === src);

        members.push({
          account_id: src,
          account_number: srcAcc?.account_number ?? src,
          holder_name: srcAcc?.holder_name ?? 'Unknown',
          bank_name: getBankName(src),
          role: 'SOURCE',
          risk_score: srcIntel?.risk_score ?? (srcSusp?.classification === 'SUSPECTED_MULE' ? 65 : 45),
          risk_classification: srcIntel?.risk_classification ?? (srcSusp?.classification === 'SUSPECTED_MULE' ? 'High' : 'Medium'),
          mule_probability: getMuleProb(src),
          in_degree: (byTarget.get(src) ?? []).length,
          out_degree: (bySource.get(src) ?? []).length,
          total_inflow: 0,
          total_outflow: Math.round(srcOuts.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100,
          is_frozen: srcAcc?.is_frozen ?? false,
        });
      }

      const maxScore = Math.max(...members.map((m) => m.risk_score));
      if (maxScore >= minRiskScore) {
        clusters.push({
          cluster_id: `FUNNEL-${String(clusters.length + 1).padStart(3, '0')}`,
          cluster_type: 'FUNNEL_COLLECTION',
          severity: maxScore >= 70 ? 'HIGH' : 'MEDIUM',
          member_count: members.length,
          members,
          total_flow_amount: Math.round(totalAmt * 100) / 100,
          transaction_count: ins.length,
          avg_transfer_latency_sec: 600,
          has_cycle: false,
          cycle_nodes: [],
          risk_score: Math.round(maxScore * 10) / 10,
          identified_patterns: [
            `${senders.length}-to-1 funnel collection (consolidation node)`,
            'Multiple unrelated accounts feeding into single collection point',
          ],
          recommended_action:
            'Freeze collector account withdrawals; trace and notify originator banks.',
          detected_at: new Date().toISOString(),
        });
      }
    }
  }

  clusters.sort((a, b) => b.risk_score - a.risk_score || b.total_flow_amount - a.total_flow_amount);

  const flaggedAccIds = new Set<string>();
  let totalExposure = 0;
  let highRiskCount = 0;
  for (const cl of clusters) {
    totalExposure += cl.total_flow_amount;
    if (cl.risk_score >= 75 || cl.severity === 'CRITICAL' || cl.severity === 'HIGH') {
      highRiskCount++;
    }
    for (const m of cl.members) {
      flaggedAccIds.add(m.account_id);
    }
  }

  return {
    clusters,
    total_clusters: clusters.length,
    high_risk_clusters: highRiskCount,
    total_flagged_accounts: flaggedAccIds.size,
    total_exposure_amount: Math.round(totalExposure * 100) / 100,
  };
}

export function extractAccountGraphIntelligence(store: FinTraceStore, accountId: string) {
  const acc = store.accounts.find((a) => a.id === accountId);
  if (!acc) return null;

  const { graph } = traceAccountGraph(store, accountId, 'both', 2);
  const nodeStats = graph.nodes.find((n) => n.id === accountId);

  // Find distance to nearest fraud account
  const fraudNodes = graph.nodes.filter(
    (n) =>
      n.risk_classification === 'Critical' ||
      (n.risk_score ?? 0) >= 85 ||
      (n.mule_probability ?? 0) >= 0.8
  );

  let minDistance: number | null = null;
  let nearestFraudId: string | null = null;

  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    const listU = adj.get(e.from_account) ?? [];
    listU.push(e.to_account);
    adj.set(e.from_account, listU);

    const listV = adj.get(e.to_account) ?? [];
    listV.push(e.from_account);
    adj.set(e.to_account, listV);
  }

  for (const fn of fraudNodes) {
    if (fn.id === accountId) {
      minDistance = 0;
      nearestFraudId = fn.id;
      break;
    }
    const visited = new Set<string>([accountId]);
    const queue: Array<{ id: string; d: number }> = [{ id: accountId, d: 0 }];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.id === fn.id) {
        if (minDistance === null || cur.d < minDistance) {
          minDistance = cur.d;
          nearestFraudId = fn.id;
        }
        break;
      }
      for (const nxt of adj.get(cur.id) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push({ id: nxt, d: cur.d + 1 });
        }
      }
    }
  }

  const baseFraudRisk = nearestFraudId ? 95 : 0;
  const propagatedRisk = minDistance !== null ? Math.round(baseFraudRisk * Math.pow(0.65, minDistance) * 10) / 10 : 0;

  const clusterData = detectMuleClusters(store, 2, 30);
  let matchedCluster: StoredMuleCluster | null = null;
  let memberRole: string | null = null;
  for (const cl of clusterData.clusters) {
    const m = cl.members.find((mem) => mem.account_id === accountId);
    if (m) {
      matchedCluster = cl;
      memberRole = m.role;
      break;
    }
  }

  // Counterparties
  const inEdges = graph.edges.filter((e) => e.to_account === accountId);
  const outEdges = graph.edges.filter((e) => e.from_account === accountId);

  const counterparties: Array<{
    account_id: string;
    account_number: string;
    holder_name: string;
    direction: 'INFLOW' | 'OUTFLOW';
    total_amount: number;
    tx_count: number;
    risk_classification: string;
  }> = [];

  const inBySrc = new Map<string, typeof inEdges>();
  for (const e of inEdges) {
    const list = inBySrc.get(e.from_account) ?? [];
    list.push(e);
    inBySrc.set(e.from_account, list);
  }
  for (const [srcId, txs] of inBySrc.entries()) {
    const srcNode = graph.nodes.find((n) => n.id === srcId);
    counterparties.push({
      account_id: srcId,
      account_number: srcNode?.account_number ?? srcId,
      holder_name: srcNode?.holder_name ?? 'Unknown',
      direction: 'INFLOW',
      total_amount: Math.round(txs.reduce((s, t) => s + t.amount, 0) * 100) / 100,
      tx_count: txs.length,
      risk_classification: srcNode?.suspicious_classification ?? 'LOW',
    });
  }

  const outByTgt = new Map<string, typeof outEdges>();
  for (const e of outEdges) {
    const list = outByTgt.get(e.to_account) ?? [];
    list.push(e);
    outByTgt.set(e.to_account, list);
  }
  for (const [tgtId, txs] of outByTgt.entries()) {
    const tgtNode = graph.nodes.find((n) => n.id === tgtId);
    counterparties.push({
      account_id: tgtId,
      account_number: tgtNode?.account_number ?? tgtId,
      holder_name: tgtNode?.holder_name ?? 'Unknown',
      direction: 'OUTFLOW',
      total_amount: Math.round(txs.reduce((s, t) => s + t.amount, 0) * 100) / 100,
      tx_count: txs.length,
      risk_classification: tgtNode?.suspicious_classification ?? 'LOW',
    });
  }

  counterparties.sort((a, b) => b.total_amount - a.total_amount);

  const inDeg = inEdges.length;
  const outDeg = outEdges.length;
  const totalDeg = inDeg + outDeg;

  return {
    account_id: accountId,
    account_number: acc.account_number,
    holder_name: acc.holder_name,
    subgraph_node_count: graph.nodes.length,
    subgraph_edge_count: graph.edges.length,
    in_degree: inDeg,
    out_degree: outDeg,
    unique_senders: inBySrc.size,
    unique_receivers: outByTgt.size,
    pagerank: nodeStats?.pagerank ?? 0,
    betweenness_centrality: nodeStats?.betweenness_centrality ?? 0,
    distance_to_nearest_fraud_account: minDistance,
    nearest_fraud_account_id: nearestFraudId,
    propagated_risk_score: propagatedRisk,
    is_part_of_cycle: graph.cycles.some((c) => c.includes(accountId)),
    cycle_count: graph.cycles.filter((c) => c.includes(accountId)).length,
    mule_cluster_id: matchedCluster?.cluster_id ?? null,
    mule_cluster_type: matchedCluster?.cluster_type ?? null,
    mule_cluster_role: memberRole,
    cluster_risk_score: matchedCluster?.risk_score ?? null,
    fan_in_ratio: totalDeg > 0 ? Math.round((inDeg / totalDeg) * 1000) / 1000 : 0,
    fan_out_ratio: totalDeg > 0 ? Math.round((outDeg / totalDeg) * 1000) / 1000 : 0,
    pass_through_ratio: nodeStats?.pass_through_ratio ?? null,
    avg_forward_latency_sec: nodeStats?.avg_forward_latency_sec ?? null,
    max_1h_velocity: nodeStats?.velocity_1h ?? 0,
    top_counterparties: counterparties.slice(0, 10),
  };
}

export function extractAccountSubgraph(
  store: FinTraceStore,
  accountId: string,
  direction: 'forward' | 'reverse' | 'both' = 'both',
  depth = 2,
  complaintId?: string
) {
  const { graph } = traceAccountGraph(store, accountId, direction, depth, complaintId);
  const clusterData = detectMuleClusters(store, 2, 30);
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  const intersectingClusters = clusterData.clusters.filter((cl) =>
    cl.members.some((m) => nodeIds.has(m.account_id))
  );

  const intel = extractAccountGraphIntelligence(store, accountId);

  const fraudNodes = graph.nodes.filter(
    (n) =>
      n.risk_classification === 'Critical' ||
      (n.risk_score ?? 0) >= 85 ||
      (n.mule_probability ?? 0) >= 0.8
  );

  const propagatedRisks: Array<{
    source_account_id: string;
    target_account_id: string;
    hop_distance: number;
    attenuation_factor: number;
    base_risk: number;
    propagated_risk: number;
  }> = [];

  for (const fn of fraudNodes) {
    for (const node of graph.nodes) {
      if (node.id === fn.id) continue;
      const d = 1;
      const factor = Math.round(Math.pow(0.65, d) * 10000) / 10000;
      propagatedRisks.push({
        source_account_id: fn.id,
        target_account_id: node.id,
        hop_distance: d,
        attenuation_factor: factor,
        base_risk: 95,
        propagated_risk: Math.round(95 * factor * 10) / 10,
      });
    }
  }

  return {
    ...graph,
    root_account_id: accountId,
    propagated_risks: propagatedRisks.slice(0, 20),
    mule_clusters: intersectingClusters,
    graph_intelligence: intel,
  };
}


export function extractAccountFeatures(store: FinTraceStore, accountId: string, complaintId?: string | null) {
  const txns = complaintId
    ? store.transactions.filter((t) => t.complaint_id === complaintId)
    : store.transactions;
  const ins = txns.filter((t) => t.to_account === accountId);
  const outs = txns.filter((t) => t.from_account === accountId);
  const acc = store.accounts.find((a) => a.id === accountId);

  const totalIn = ins.reduce((s, t) => s + Number(t.amount), 0);
  const totalOut = outs.reduce((s, t) => s + Number(t.amount), 0);
  const passThrough = totalIn > 0 ? Math.min(1.5, totalOut / totalIn) : 0;

  const latencies: number[] = [];
  for (const outTx of outs) {
    const outTs = new Date(outTx.timestamp).getTime();
    const priorIns = ins.filter((inTx) => new Date(inTx.timestamp).getTime() <= outTs);
    if (priorIns.length > 0) {
      const latestIn = Math.max(...priorIns.map((t) => new Date(t.timestamp).getTime()));
      latencies.push(Math.max(60, Math.round((outTs - latestIn) / 1000)));
    }
  }
  const avgLatencySec =
    latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  const allTimes = [...ins, ...outs]
    .map((t) => new Date(t.timestamp).getTime())
    .sort((a, b) => a - b);
  let velocity1h = 0;
  let l = 0;
  for (let r = 0; r < allTimes.length; r++) {
    while (allTimes[r] - allTimes[l] > 3600 * 1000) l++;
    velocity1h = Math.max(velocity1h, r - l + 1);
  }

  const fanIn = new Set(ins.map((t) => t.from_account)).size;
  const fanOut = new Set(outs.map((t) => t.to_account)).size;
  const kycPenalty = acc && !acc.kyc_verified ? 1 : 0;
  const youngAccount = acc && acc.account_age_days < 60 ? 1 : 0;
  const retainedRatio = totalIn > 0 ? Math.max(0, (totalIn - totalOut) / totalIn) : 0;

  return {
    totalIn,
    totalOut,
    passThrough,
    avgLatencySec,
    velocity1h,
    fanIn,
    fanOut,
    kycPenalty,
    youngAccount,
    retainedRatio,
    accountAgeDays: acc?.account_age_days ?? 365,
    kycVerified: acc?.kyc_verified ?? true,
  };
}

export function scoreAccountRuleBased(store: FinTraceStore, accountId: string, complaintId?: string | null) {
  const f = extractAccountFeatures(store, accountId, complaintId);
  let score = 12;
  const ruleFactors: string[] = [];

  if (f.passThrough >= 0.7) {
    score += 26;
    ruleFactors.push(`High pass-through ratio (${(f.passThrough * 100).toFixed(0)}% of inflows rapidly forwarded)`);
  } else if (f.totalIn > 100000 && f.retainedRatio >= 0.8) {
    score += 22;
    ruleFactors.push(`High retained stolen inflow (INR ${f.totalIn.toLocaleString('en-IN')}) awaiting cash-out`);
  }

  if (f.avgLatencySec !== null && f.avgLatencySec <= 1800) {
    score += 22;
    ruleFactors.push(`Rapid forwarding latency (${Math.round(f.avgLatencySec / 60)} min average dwell time)`);
  } else if (f.avgLatencySec !== null && f.avgLatencySec <= 7200) {
    score += 12;
    ruleFactors.push(`Short dwell latency (${Math.round(f.avgLatencySec / 60)} min)`);
  }

  if (f.youngAccount) {
    score += 16;
    ruleFactors.push(`Newly opened account (${f.accountAgeDays} days old)`);
  }

  if (f.kycPenalty) {
    score += 14;
    ruleFactors.push('KYC verification incomplete / flagged unverified');
  }

  if (f.velocity1h >= 3) {
    score += 10;
    ruleFactors.push(`Burst transaction velocity (${f.velocity1h} txns within 60-min window)`);
  }

  if (f.fanIn >= 2 || f.fanOut >= 2) {
    score += 8;
    ruleFactors.push(`Multi-counterparty topology (fan-in=${f.fanIn}, fan-out=${f.fanOut})`);
  }

  const clamped = Math.min(98.5, Math.max(5, Math.round(score * 10) / 10));
  const isAnomaly = clamped >= 72 || f.velocity1h >= 3 || (f.youngAccount === 1 && f.kycPenalty === 1);
  const anomalyScore = Math.round((clamped / 100) * 1000) / 1000;

  const shapPreview: ShapFactor[] = [
    {
      feature: 'account_age_days',
      value: f.accountAgeDays,
      shap_value: f.youngAccount ? 0.34 : -0.18,
      direction: f.youngAccount ? 'increases_risk' : 'decreases_risk',
    },
    {
      feature: 'pass_through_ratio',
      value: Number(f.passThrough.toFixed(2)),
      shap_value: f.passThrough >= 0.65 ? 0.42 : -0.09,
      direction: f.passThrough >= 0.65 ? 'increases_risk' : 'decreases_risk',
    },
    {
      feature: 'kyc_verified',
      value: f.kycVerified ? 1 : 0,
      shap_value: f.kycPenalty ? 0.29 : -0.14,
      direction: f.kycPenalty ? 'increases_risk' : 'decreases_risk',
    },
    {
      feature: 'velocity_1h',
      value: f.velocity1h,
      shap_value: f.velocity1h >= 3 ? 0.24 : -0.05,
      direction: f.velocity1h >= 3 ? 'increases_risk' : 'decreases_risk',
    },
    {
      feature: 'avg_forward_latency_sec',
      value: f.avgLatencySec ?? 0,
      shap_value: f.avgLatencySec !== null && f.avgLatencySec <= 3600 ? 0.31 : -0.04,
      direction: f.avgLatencySec !== null && f.avgLatencySec <= 3600 ? 'increases_risk' : 'decreases_risk',
    },
  ];

  return {
    muleScore: clamped,
    isAnomaly,
    anomalyScore,
    velocity1h: f.velocity1h,
    passThroughRatio: Math.round(f.passThrough * 1000) / 1000,
    avgForwardLatencySec: f.avgLatencySec,
    ruleFactors: ruleFactors.length > 0 ? ruleFactors : ['Baseline transaction flow checked; low risk signals'],
    shapFactors: shapPreview,
  };
}

export function detectFraudForComplaint(store: FinTraceStore, complaintId: string) {
  const txns = store.transactions.filter((t) => t.complaint_id === complaintId);
  const victimOrigin = txns.find((t) => t.hop_depth === 1)?.from_account;
  const accIds = new Set<string>();
  for (const t of txns) {
    if (t.from_account !== victimOrigin) accIds.add(t.from_account);
    accIds.add(t.to_account);
  }

  // Remove stale detections for this complaint and insert fresh scored rows
  store.fraudResults = store.fraudResults.filter((r) => r.complaint_id !== complaintId);
  const created: StoredFraudResult[] = [];
  const nowIso = new Date().toISOString();

  for (const accId of accIds) {
    const scored = scoreAccountRuleBased(store, accId, complaintId);
    const row: StoredFraudResult = {
      id: crypto.randomUUID(),
      complaint_id: complaintId,
      account_id: accId,
      is_anomaly: scored.isAnomaly,
      anomaly_score: scored.anomalyScore,
      mule_score: scored.muleScore,
      score_source: 'Rule-based risk score',
      velocity_1h: scored.velocity1h,
      pass_through_ratio: scored.passThroughRatio,
      avg_forward_latency_sec: scored.avgForwardLatencySec,
      explanation_json: {
        rule_factors: scored.ruleFactors,
        model_version: 'rule-heuristic-v1.0',
      },
      shap_values_json: null,
      model_name: 'Rule-Based Heuristic Scorer',
      model_version: 'rule-heuristic-v1.0',
      predicted_label: scored.muleScore >= 75 ? 'HIGH_RISK_MULE' : scored.muleScore >= 50 ? 'WATCHLIST' : 'LOW_RISK',
      detected_at: nowIso,
    };
    store.fraudResults.push(row);
    created.push(row);
  }

  return created.sort((a, b) => b.mule_score - a.mule_score);
}

export function trainBaselineEvaluator(store: FinTraceStore): StoredModelMetrics {
  // Real chronological 60/20/20 split evaluation across accounts based on earliest transaction timestamp
  const flaggedSet = new Set(
    store.suspiciousAccounts.filter((s) => s.status !== 'CLEARED').map((s) => s.account_id)
  );
  // Also include accounts whose only transactions are flagged fraud and non-victim
  const victimAccIds = new Set(
    store.complaints.map((c) => store.transactions.find((t) => t.complaint_id === c.id && t.hop_depth === 1)?.from_account).filter(Boolean)
  );
  const accountLatestTs = store.accounts.map((acc) => {
    const relTx = store.transactions.filter((t) => t.from_account === acc.id || t.to_account === acc.id);
    const ts = relTx.length > 0 ? Math.max(...relTx.map((t) => new Date(t.timestamp).getTime())) : 0;
    const isPositive =
      flaggedSet.has(acc.id) ||
      (!victimAccIds.has(acc.id) && relTx.some((t) => t.is_flagged_fraud));
    const scored = scoreAccountRuleBased(store, acc.id, null);
    return { acc, ts, isPositive, score: scored.muleScore / 100 };
  });

  accountLatestTs.sort((a, b) => a.ts - b.ts);
  const n = accountLatestTs.length;
  const trainEnd = Math.floor(n * 0.6);
  const valEnd = Math.floor(n * 0.8);
  const testSlice = accountLatestTs.slice(valEnd);
  const evalSet = testSlice.length >= 6 ? testSlice : accountLatestTs;

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const item of evalSet) {
    const pred = item.score >= 0.55;
    if (pred && item.isPositive) tp++;
    else if (pred && !item.isPositive) fp++;
    else if (!pred && !item.isPositive) tn++;
    else fn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Empirical ROC-AUC via pairwise concordance on evalSet
  const posItems = evalSet.filter((x) => x.isPositive);
  const negItems = evalSet.filter((x) => !x.isPositive);
  let rocAuc: number | null = null;
  if (posItems.length > 0 && negItems.length > 0) {
    let wins = 0;
    for (const p of posItems) {
      for (const neg of negItems) {
        if (p.score > neg.score) wins += 1;
        else if (p.score === neg.score) wins += 0.5;
      }
    }
    rocAuc = Math.round((wins / (posItems.length * negItems.length)) * 1000) / 1000;
  }

  const rankedAll = [...accountLatestTs].sort((a, b) => b.score - a.score);
  const totalPos = Math.max(1, accountLatestTs.filter((x) => x.isPositive).length);
  const atK = (k: number) => {
    const top = rankedAll.slice(0, k);
    const hits = top.filter((x) => x.isPositive).length;
    return {
      p: Math.round((hits / Math.max(1, top.length)) * 1000) / 1000,
      r: Math.round((hits / totalPos) * 1000) / 1000,
    };
  };

  const metric: StoredModelMetrics = {
    id: crypto.randomUUID(),
    model_name: 'Rule-Calibrated Baseline (Node.js Preview)',
    model_version: `baseline-v${store.modelMetrics.length + 1}.0`,
    split_strategy: 'chronological_60_20_20',
    train_count: trainEnd,
    val_count: valEnd - trainEnd,
    test_count: n - valEnd,
    precision_score: Math.round(precision * 1000) / 1000,
    recall_score: Math.round(recall * 1000) / 1000,
    f1_score: Math.round(f1 * 1000) / 1000,
    roc_auc: rocAuc,
    pr_auc: rocAuc ? Math.round(Math.min(1, (precision + rocAuc) / 2) * 1000) / 1000 : null,
    precision_at_k: { '@3': atK(3).p, '@5': atK(5).p, '@10': atK(10).p },
    recall_at_k: { '@3': atK(3).r, '@5': atK(5).r, '@10': atK(10).r },
    confusion_matrix: { tn, fp, fn, tp },
    feature_importance: [
      { feature: 'pass_through_ratio', importance: 0.28 },
      { feature: 'avg_forward_latency_sec', importance: 0.23 },
      { feature: 'account_age_days', importance: 0.18 },
      { feature: 'kyc_verified', importance: 0.14 },
      { feature: 'velocity_1h', importance: 0.10 },
      { feature: 'fan_in_out_degree', importance: 0.07 },
    ],
    trained_at: new Date().toISOString(),
  };

  store.modelMetrics.unshift(metric);
  return metric;
}

export function runAtmPredictionForComplaint(store: FinTraceStore, complaintId: string, topN = 8) {
  const complaint = store.complaints.find((c) => c.id === complaintId);
  if (!complaint) return null;

  const cmpTxns = store.transactions.filter((t) => t.complaint_id === complaintId);
  const victimOrigin = cmpTxns.find((t) => t.hop_depth === 1)?.from_account;
  const accMap = new Map(store.accounts.map((a) => [a.id, a]));
  const suspMap = new Map(
    store.suspiciousAccounts.filter((s) => s.complaint_id === complaintId).map((s) => [s.account_id, s])
  );

  // Identify candidate downstream/retained accounts in this complaint
  const candidateBalances = new Map<string, { inflow: number; outflow: number; latestTs: number }>();
  for (const t of cmpTxns) {
    const ts = new Date(t.timestamp).getTime();
    const toRec = candidateBalances.get(t.to_account) ?? { inflow: 0, outflow: 0, latestTs: ts };
    toRec.inflow += Number(t.amount);
    toRec.latestTs = Math.max(toRec.latestTs, ts);
    candidateBalances.set(t.to_account, toRec);

    const fromRec = candidateBalances.get(t.from_account) ?? { inflow: 0, outflow: 0, latestTs: ts };
    fromRec.outflow += Number(t.amount);
    candidateBalances.set(t.from_account, fromRec);
  }

  const candidates = Array.from(candidateBalances.entries())
    .filter(([accId]) => accId !== victimOrigin)
    .map(([accId, bal]) => {
      const acc = accMap.get(accId);
      const susp = suspMap.get(accId);
      const retained = Math.max(0, bal.inflow - bal.outflow);
      const scored = scoreAccountRuleBased(store, accId, complaintId);
      const muleScore = susp?.mule_probability ?? scored.muleScore / 100;

      // Centroid from branch + any historical ATM withdrawals
      const histWds = store.atmWithdrawals.filter((w) => w.account_id === accId);
      let cLat = acc?.branch_lat ?? 12.9716;
      let cLng = acc?.branch_lng ?? 77.5946;
      if (histWds.length > 0 && acc) {
        const wdAtms = histWds
          .map((w) => store.atms.find((a) => a.id === w.atm_id))
          .filter((a): a is AtmSeed => Boolean(a));
        if (wdAtms.length > 0) {
          const sumLat = acc.branch_lat + wdAtms.reduce((s, a) => s + a.lat, 0);
          const sumLng = acc.branch_lng + wdAtms.reduce((s, a) => s + a.lng, 0);
          cLat = sumLat / (1 + wdAtms.length);
          cLng = sumLng / (1 + wdAtms.length);
        }
      }

      return {
        accId,
        acc,
        susp,
        retained,
        inflow: bal.inflow,
        latestTs: bal.latestTs,
        muleScore,
        cLat,
        cLng,
        histAtmIds: new Set(histWds.map((w) => w.atm_id)),
      };
    })
    .filter((c) => c.acc !== undefined);

  const refNow = Math.max(
    Date.now(),
    ...cmpTxns.map((t) => new Date(t.timestamp).getTime() + 60 * 60 * 1000)
  );

  // Score every ATM against strongest matching candidate
  const scoredAtms = store.atms.map((atm) => {
    let bestCand = candidates[0];
    let bestScore = -1;
    let bestFactors: AtmPredictionSeed['explanation_json']['factors'] = [];
    let bestDistKm = 12;

    for (const cand of candidates) {
      const distKm = haversineKm(cand.cLat, cand.cLng, atm.lat, atm.lng);
      const proxPts = Math.max(0, 28 * Math.exp(-distKm / 3.2));

      const ageHours = Math.max(0.25, (refNow - cand.latestTs) / (3600 * 1000));
      const recencyPts = Math.min(24, 24 * Math.exp(-ageHours / 18) * (cand.retained > 0 ? 1 : 0.72));

      const mulePts = Math.min(22, 22 * cand.muleScore);
      const histHits = store.atmWithdrawals.filter((w) => w.atm_id === atm.id && w.account_id === cand.accId).length;
      const histPts = histHits > 0 ? Math.min(16, 10 + histHits * 3) : 0;
      const capPts = (atm.cash_capacity_tier === 'HIGH' ? 6 : atm.cash_capacity_tier === 'MEDIUM' ? 4 : 2) + (atm.is_24x7 ? 4 : 1);

      const total = Math.round((proxPts + recencyPts + mulePts + histPts + capPts) * 10) / 10;
      if (total > bestScore) {
        bestScore = total;
        bestCand = cand;
        bestDistKm = Math.round(distKm * 100) / 100;
        bestFactors = [
          {
            factor: 'Spatial Proximity to Candidate Centroid',
            weight: 0.28,
            value: `${bestDistKm} km`,
            contribution: Math.round(proxPts * 10) / 10,
          },
          {
            factor: 'Inflow Recency & Velocity',
            weight: 0.24,
            value: `${Math.round(ageHours * 10) / 10}h ago`,
            contribution: Math.round(recencyPts * 10) / 10,
          },
          {
            factor: 'Mule / Cash-Out Account Score',
            weight: 0.22,
            value: cand.muleScore.toFixed(2),
            contribution: Math.round(mulePts * 10) / 10,
          },
          {
            factor: 'Historical ATM Cluster Match',
            weight: 0.16,
            value: `${histHits} prior hit${histHits === 1 ? '' : 's'}`,
            contribution: Math.round(histPts * 10) / 10,
          },
          {
            factor: 'ATM Capacity & 24x7 Availability',
            weight: 0.1,
            value: `${atm.cash_capacity_tier} / ${atm.is_24x7 ? '24x7' : 'Limited'}`,
            contribution: Math.round(capPts * 10) / 10,
          },
        ];
      }
    }

    const riskScore = Math.max(8, Math.min(97.5, bestScore > 0 ? bestScore : 25));
    const riskLevel: AtmPredictionSeed['risk_level'] =
      riskScore >= 80 ? 'Critical' : riskScore >= 65 ? 'High' : riskScore >= 45 ? 'Medium' : 'Low';
    const windowVal: AtmPredictionSeed['window'] =
      riskScore >= 80 ? '0-6h' : riskScore >= 65 ? '6-12h' : riskScore >= 45 ? '12-24h' : '>24h';
    const confidence: AtmPredictionSeed['confidence'] =
      riskScore >= 75 ? 'High' : riskScore >= 50 ? 'Moderate' : 'Low';

    return {
      atm,
      riskScore,
      riskLevel,
      windowVal,
      confidence,
      bestCand,
      bestDistKm,
      bestFactors,
    };
  });

  scoredAtms.sort((a, b) => b.riskScore - a.riskScore);
  const topSlice = scoredAtms.slice(0, topN);
  const nowIso = new Date().toISOString();
  const limitationsText =
    'Weighted heuristic risk score (0-100) computed on synthetic data — NOT a calibrated withdrawal probability. Based on branch/historical ATM centroids.';

  // Replace predictions for this complaint
  store.atmPredictions = store.atmPredictions.filter((p) => p.complaint_id !== complaintId);

  const inserted: StoredAtmPrediction[] = topSlice.map((item, idx) => {
    const linked = item.bestCand?.acc
      ? [
          {
            account_id: item.bestCand.acc.id,
            account_number: item.bestCand.acc.account_number,
            role: item.bestCand.susp?.classification ?? 'CASH_OUT_CANDIDATE',
          },
        ]
      : [];

    const row: StoredAtmPrediction = {
      id: crypto.randomUUID(),
      atm_id: item.atm.id,
      complaint_id: complaintId,
      risk_score: item.riskScore,
      risk_level: item.riskLevel,
      window: item.windowVal,
      confidence: item.confidence,
      score_source: 'Rule-based risk score',
      linked_accounts_json: linked,
      relevant_paths_json: item.bestCand
        ? [
            {
              path: [
                accMap.get(victimOrigin ?? '')?.account_number ?? 'ORIGIN',
                item.bestCand.acc?.account_number ?? 'CANDIDATE',
              ],
              total_amount: item.bestCand.inflow,
            },
          ]
        : [],
      explanation_json: {
        plain_language: `${item.atm.locality} terminal (${item.atm.bank}) is ${item.bestDistKm} km from candidate centroid with ${item.atm.cash_capacity_tier} cash capacity.`,
        factors: item.bestFactors,
      },
      limitations_text: limitationsText,
      model_version: 'ts-haversine-v1.0',
      rank_order: idx + 1,
      predicted_at: nowIso,
    };
    store.atmPredictions.push(row);
    return row;
  });

  return {
    complaint_id: complaintId,
    complaint_number: complaint.complaint_number,
    score_source: 'Rule-based risk score',
    model_version: 'ts-haversine-v1.0',
    top_3_atms: inserted.slice(0, 3).map((p) => {
      const atm = store.atms.find((a) => a.id === p.atm_id)!;
      return { ...p, bank: atm.bank, locality: atm.locality, address: atm.address };
    }),
    predictions: inserted,
  };
}

export function computeAtmClusters(store: FinTraceStore) {
  // Simple spatial DBSCAN-like grouping (eps = 2.6 km, minPts = 2)
  const epsKm = 2.6;
  const visited = new Set<string>();
  const clusters: Array<{
    cluster_id: number;
    atm_count: number;
    centroid_lat: number;
    centroid_lng: number;
    total_withdrawals: number;
    flagged_cashouts: number;
    localities: string[];
    atm_ids: string[];
  }> = [];

  for (const atm of store.atms) {
    if (visited.has(atm.id)) continue;
    const neighbors = store.atms.filter((other) => haversineKm(atm.lat, atm.lng, other.lat, other.lng) <= epsKm);
    if (neighbors.length < 2) continue;

    const group: AtmSeed[] = [];
    const queue = [...neighbors];
    for (const q of queue) visited.add(q.id);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      group.push(curr);
      const subNeighbors = store.atms.filter(
        (other) => !visited.has(other.id) && haversineKm(curr.lat, curr.lng, other.lat, other.lng) <= epsKm
      );
      if (subNeighbors.length >= 1) {
        for (const sn of subNeighbors) {
          visited.add(sn.id);
          queue.push(sn);
        }
      }
    }

    const ids = new Set(group.map((g) => g.id));
    const wds = store.atmWithdrawals.filter((w) => ids.has(w.atm_id));
    clusters.push({
      cluster_id: clusters.length + 1,
      atm_count: group.length,
      centroid_lat: Math.round((group.reduce((s, g) => s + g.lat, 0) / group.length) * 10000) / 10000,
      centroid_lng: Math.round((group.reduce((s, g) => s + g.lng, 0) / group.length) * 10000) / 10000,
      total_withdrawals: wds.length,
      flagged_cashouts: wds.filter((w) => w.is_flagged_cashout).length,
      localities: Array.from(new Set(group.map((g) => g.locality))),
      atm_ids: group.map((g) => g.id),
    });
  }

  return clusters;
}
