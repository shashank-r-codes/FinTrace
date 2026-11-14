export type UserRole =
  | 'Administrator'
  | 'Senior Investigator'
  | 'Investigator'
  | 'Bank Nodal Officer'
  | 'citizen';

export type OfficerRole =
  | 'Administrator'
  | 'Senior Investigator'
  | 'Investigator'
  | 'Bank Nodal Officer';

export type CitizenStatus =
  | 'Submitted'
  | 'Under Review'
  | 'Assigned to Investigator'
  | 'Investigation in Progress'
  | 'Action Taken / Closed';

export type ScoreSource =
  | 'Trained ML prediction'
  | 'Rule-based risk score'
  | 'Synthetic demo result';

export type ComplaintStatus =
  | 'REGISTERED'
  | 'TRACING'
  | 'MULE_IDENTIFIED'
  | 'ATM_ALERTED'
  | 'CONTAINED'
  | 'CLOSED';

export type ComplaintPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type FraudType =
  | 'UPI_PHISHING'
  | 'INVESTMENT_SCAM'
  | 'DIGITAL_ARREST'
  | 'OTP_HIJACK'
  | 'CARD_SKIMMING'
  | 'LOAN_APP_FRAUD'
  | 'OTHER';

export type AlertSeverity = 'Critical' | 'High' | 'Medium' | 'Low';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'DISPATCHED' | 'RESOLVED' | 'FALSE_POSITIVE';
export type RiskLevel = 'Critical' | 'High' | 'Medium' | 'Low';
export type PredictionWindow = '0-6h' | '6-12h' | '12-24h' | '>24h';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  institutionId: string | null;
  phoneMasked?: string | null;
  permissions?: string[];
}

export interface InvestigatorOption {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role_name: UserRole;
  badge_number: string;
  unit_name: string;
  jurisdiction: string;
  specialization: string | null;
  active_caseload: number;
}

export interface ComplaintSummary {
  id: string;
  complaint_number: string;
  reference_no?: string;
  fraud_type: FraudType;
  reported_amount: number | string;
  currency: string;
  incident_timestamp: string;
  reported_at: string;
  status: ComplaintStatus;
  citizen_status?: CitizenStatus;
  priority: ComplaintPriority;
  summary: string;
  city: string;
  is_synthetic: boolean;
  created_at: string;
  victim_id: string;
  victim_name: string;
  victim_phone: string;
  investigator_id: string | null;
  investigator_name: string | null;
  transaction_count: number;
  atm_prediction_count: number;
  open_alert_count: number;
}

export interface ComplaintStatusHistoryRow {
  id: string;
  complaint_id: string;
  status: ComplaintStatus;
  citizen_status: CitizenStatus;
  public_remark: string | null;
  internal_note: string | null;
  changed_by: string | null;
  changed_by_name?: string | null;
  changed_at: string;
}

export interface ComplaintTransactionRow {
  id: string;
  txn_id: string;
  from_account: string;
  to_account: string;
  from_account_number: string;
  from_holder: string;
  to_account_number: string;
  to_holder: string;
  amount: number | string;
  currency: string;
  timestamp: string;
  channel: string;
  hop_depth: number | null;
  is_flagged_fraud: boolean;
  remarks: string | null;
}

export interface SuspiciousAccountRow {
  id: string;
  account_id: string;
  account_number: string;
  holder_name: string;
  branch_city: string;
  is_frozen: boolean;
  classification: string;
  mule_probability: number | null;
  score_source: ScoreSource;
  reason: string;
  status: string;
}

export interface AtmPredictionFactor {
  factor: string;
  weight: number;
  value: string;
  contribution: number;
}

export interface AtmPredictionRow {
  id?: string;
  atm_id: string;
  complaint_id?: string;
  complaint_number?: string;
  fraud_type?: FraudType;
  reported_amount?: number | string;
  bank: string;
  address: string;
  locality: string;
  city: string;
  state?: string;
  lat: number;
  lng: number;
  cash_capacity_tier?: string;
  is_24x7?: boolean;
  risk_score: number;
  risk_level: RiskLevel;
  window: PredictionWindow;
  confidence: 'High' | 'Moderate' | 'Low' | string | number;
  rank_order: number;
  score_source: ScoreSource;
  model_version: string;
  limitations_text: string;
  explanation_json: {
    plain_language?: string;
    factors?: AtmPredictionFactor[];
    top_factors?: Array<{
      feature: string;
      label: string;
      contribution: number;
      detail: string;
    }>;
    distance_km?: number;
    historical_withdrawals?: number;
  };
  linked_accounts_json?: Array<{
    account_id: string;
    account_number: string;
    holder_name: string;
    role?: string;
    retained_amount?: number;
    mule_score?: number;
  }>;
  relevant_paths_json?: Array<{
    path: string[];
    total_amount: number;
  }>;
  predicted_at?: string;
}

export interface AlertRow {
  id: string;
  complaint_id: string;
  complaint_number: string | null;
  account_id: string | null;
  account_number: string | null;
  holder_name: string | null;
  atm_id: string | null;
  atm_bank: string | null;
  atm_address: string | null;
  atm_locality: string | null;
  alert_type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string;
  score_source: ScoreSource;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  txn_id: string;
  from_account: string;
  to_account: string;
  from_account_number: string;
  from_holder: string;
  from_city: string;
  to_account_number: string;
  to_holder: string;
  to_city: string;
  amount: number | string;
  currency: string;
  timestamp: string;
  channel: string;
  complaint_id: string | null;
  complaint_number: string | null;
  hop_depth: number | null;
  is_flagged_fraud: boolean;
  remarks: string | null;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface BankAccountSummary {
  id: string;
  account_number: string;
  ifsc_code: string;
  holder_name: string;
  account_type: string;
  branch_city: string;
  is_frozen: boolean;
  bank_name: string;
  bank_code: string;
  suspicious_flag_count: number;
  max_mule_prob: number | null;
  inflow_total: number | string;
  outflow_total: number | string;
}

export interface CsvUploadReport {
  totalRows: number;
  inserted: number;
  skippedDuplicates: number;
  errors: Array<{ row: number; error: string }>;
}

export interface GraphNode {
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

export interface GraphEdge {
  txn_id: string;
  from_account: string;
  to_account: string;
  amount: number;
  timestamp: string;
  channel: string;
  complaint_id: string | null;
  hop_depth: number | null;
  is_flagged_fraud: boolean;
}

export interface GraphTimelineItem {
  txn_id: string;
  timestamp: string;
  delta_from_prev_sec: number;
  from_account: string;
  from_account_number: string;
  from_holder: string;
  to_account: string;
  to_account_number: string;
  to_holder: string;
  amount: number;
  channel: string;
  hop_depth: number | null;
  is_flagged_fraud: boolean;
}

export interface GraphTraceData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  timeline: GraphTimelineItem[];
  cycles: string[][];
  summary: {
    node_count: number;
    edge_count: number;
    total_amount: number;
    has_cycles: boolean;
    cycle_count: number;
    root_account_id?: string;
    direction?: string;
    max_depth?: number;
  };
}

export interface SuspiciousPathItem {
  path_ids: string[];
  path_account_numbers: string[];
  hop_count: number;
  bottleneck_amount: number;
  edges: Array<{
    from: string;
    to: string;
    txn_ids: string[];
    amount: number;
  }>;
}

export interface CteTraceEdge {
  txn_id: string;
  from_account: string;
  to_account: string;
  amount: number | string;
  timestamp: string;
  channel: string;
  complaint_id: string | null;
  is_flagged_fraud: boolean;
  depth: number;
  from_account_number: string;
  from_holder: string;
  to_account_number: string;
  to_holder: string;
}

export interface ModelMetricsRow {
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
  confusion_matrix: {
    tn: number;
    fp: number;
    fn: number;
    tp: number;
  };
  feature_importance: Array<{ feature: string; importance: number }>;
  trained_at: string;
}

export interface ShapFactor {
  feature: string;
  value: number;
  shap_value: number;
  direction: 'increases_risk' | 'decreases_risk';
}

export interface FraudPredictionRow {
  id: string;
  complaint_id: string | null;
  complaint_number: string | null;
  account_id: string;
  account_number: string;
  holder_name: string;
  branch_city: string;
  is_frozen: boolean;
  is_anomaly: boolean;
  anomaly_score: number;
  mule_score: number;
  score_source: ScoreSource;
  velocity_1h: number;
  pass_through_ratio: number;
  avg_forward_latency_sec: number | null;
  explanation_json?: {
    top_shap_factors?: ShapFactor[];
    rule_factors?: string[];
    model_version?: string;
  };
  shap_values_json?: ShapFactor[] | null;
  model_name?: string | null;
  model_version?: string | null;
  predicted_label?: string | null;
  detected_at: string;
}

export interface AtmHeatmapRow {
  atm_id: string;
  bank: string;
  address: string;
  locality: string;
  city: string;
  lat: number;
  lng: number;
  max_risk_score: number;
  peak_risk_level: RiskLevel;
  peak_window: PredictionWindow;
  top_linked_accounts?: Array<{
    account_id: string;
    account_number: string;
    holder_name?: string;
    role?: string;
    retained_amount?: number;
    mule_score?: number;
  }>;
  top_relevant_paths?: Array<{
    path: string[];
    total_amount: number;
  }>;
  prediction_count: number;
  withdrawal_count: number;
}

export interface AtmClusterRow {
  cluster_id: number;
  atm_count: number;
  centroid_lat: number;
  centroid_lng: number;
  total_withdrawals: number;
  flagged_cashouts: number;
  localities: string[];
  atm_ids: string[];
}

export interface AtmWithdrawalRow {
  id: string;
  atm_id: string;
  account_id: string;
  complaint_id: string | null;
  complaint_number: string | null;
  amount: number | string;
  withdrawn_at: string;
  is_flagged_cashout: boolean;
  bank: string;
  address: string;
  locality: string;
  city: string;
  lat: number;
  lng: number;
  account_number: string;
  holder_name: string;
}

export type InvestigationStatus =
  | 'OPEN'
  | 'ACTIVE_TRACE'
  | 'FREEZE_REQUESTED'
  | 'ATM_SURVEILLANCE'
  | 'CLOSED';

export interface RecommendedActionItem {
  action: string;
  priority: 'IMMEDIATE' | 'HIGH' | 'MEDIUM' | 'LOW';
  done: boolean;
}

export interface InvestigationRow {
  id: string;
  case_number: string;
  complaint_id: string;
  complaint_number: string;
  fraud_type: FraudType;
  reported_amount: number | string;
  complaint_status: ComplaintStatus;
  complaint_priority: ComplaintPriority;
  complaint_city: string;
  victim_name: string;
  lead_investigator: string | null;
  lead_investigator_name: string | null;
  lead_badge_number: string | null;
  lead_unit_name: string | null;
  status: InvestigationStatus;
  findings_summary: string | null;
  recommended_actions: RecommendedActionItem[];
  opened_at: string;
  closed_at: string | null;
  updated_at: string;
  evidence_count: number;
  open_alert_count: number;
  atm_prediction_count: number;
}

export type EvidenceType =
  | 'BANK_STATEMENT_CSV'
  | 'CDR_EXTRACT'
  | 'ATM_CCTV_NOTE'
  | 'NPCI_REF'
  | 'FREEZE_ORDER'
  | 'OTHER';

export interface EvidenceRecordRow {
  id: string;
  investigation_id: string;
  case_number: string;
  complaint_id: string;
  complaint_number: string;
  uploaded_by: string;
  uploaded_by_name: string;
  uploaded_by_email: string;
  evidence_type: EvidenceType;
  title: string;
  description: string;
  file_name: string | null;
  sha256_hash: string | null;
  metadata_json: Record<string, unknown>;
  recorded_at: string;
}

export interface ReportAnalyticsData {
  summary: {
    total_complaints: number;
    total_reported_loss: number | string;
    total_transactions: number;
    flagged_accounts: number;
    frozen_accounts: number;
    total_atm_forecasts: number;
    total_evidence_records: number;
  };
  byComplaintStatus: Array<{
    status: ComplaintStatus;
    count: number;
    total_amount: number | string;
  }>;
  byFraudType: Array<{
    fraud_type: FraudType;
    count: number;
    total_amount: number | string;
  }>;
  byChannel: Array<{
    channel: string;
    txn_count: number;
    total_amount: number | string;
  }>;
  byAtmRiskLevel: Array<{
    risk_level: RiskLevel;
    count: number;
    avg_score: number | string;
  }>;
  byAlertStatus: Array<{
    status: AlertStatus;
    severity: AlertSeverity;
    count: number;
  }>;
}

export interface AssistantStatus {
  configured: boolean;
  model: string;
}

export interface AssistantQueryResponse {
  answer: string;
  model: string;
  groundedScope: string;
  recordCounts: Record<string, number>;
}

export interface UserDirectoryRow {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  role: UserRole;
  institution_id: string | null;
  institution_name: string | null;
  badge_number: string | null;
  unit_name: string | null;
  jurisdiction: string | null;
}

export interface RoleDefinitionRow {
  id: number;
  name: UserRole;
  description: string;
  permissions: string[];
}

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
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

export interface CitizenComplaintSummary {
  id: string;
  reference_no: string;
  fraud_type: string;
  reported_amount: number;
  currency: string;
  incident_timestamp: string;
  reported_at: string;
  citizen_status: CitizenStatus;
  summary: string;
  city: string;
  victim_bank_name: string | null;
  victim_account_masked: string | null;
  is_investigator_assigned: boolean;
  assignment_label: string;
  transaction_count: number;
  document_count: number;
  updated_at: string;
}

export interface CitizenComplaintDetail extends CitizenComplaintSummary {
  disputed_transactions: Array<{
    txn_id: string;
    date: string;
    amount: number;
    channel: string;
    beneficiary_account_masked: string;
    beneficiary_bank: string | null;
  }>;
  status_history: Array<{
    id: string;
    citizen_status: CitizenStatus;
    public_remark: string | null;
    changed_at: string;
  }>;
  documents: Array<{
    id: string;
    title: string;
    file_name: string | null;
    mime_type: string | null;
    file_size: number | null;
    uploaded_at: string;
  }>;
}

export interface CitizenNotificationItem {
  id: string;
  complaint_id: string;
  reference_no: string;
  title: string;
  message: string;
  citizen_status: CitizenStatus;
  is_read: boolean;
  created_at: string;
}

// =============================================================================
// PREVENTION LAYER: ACCOUNT INTELLIGENCE & RISK REGISTRY (Phase 2)
// =============================================================================

export type RiskClassification =
  | 'Low'
  | 'Medium'
  | 'High'
  | 'Critical'
  | 'Under Investigation';

export type AccountStatusClassification =
  | 'NORMAL'
  | 'SUSPICIOUS_ACCOUNT'
  | 'SUSPECTED_MULE_ACCOUNT'
  | 'CONFIRMED_FRAUD_LINKED';

export interface AccountIntelligenceProfile {
  account_id: string;
  account_number: string;
  holder_name: string;
  branch_city: string;
  ifsc_code: string;
  account_type: string;
  is_frozen: boolean;
  bank_name: string;
  bank_code: string;
  risk_score: number;
  risk_classification: RiskClassification;
  account_status: AccountStatusClassification;
  incoming_frequency_24h: number;
  outgoing_frequency_24h: number;
  incoming_volume_24h: number;
  outgoing_volume_24h: number;
  avg_incoming_amount: number;
  avg_outgoing_amount: number;
  velocity_score: number;
  pass_through_ratio: number;
  rapid_forward_count_24h: number;
  connected_accounts_count: number;
  suspicious_counterparties_count: number;
  prior_complaints_count: number;
  mule_indicators: string[];
  risk_reasons: string[];
  score_source: ScoreSource;
  last_assessed_at: string;
  is_synthetic: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountRiskHistoryEntry {
  id: string;
  account_id: string;
  previous_score: number | null;
  new_score: number;
  previous_classification: RiskClassification | string | null;
  new_classification: RiskClassification | string;
  trigger_event: string;
  trigger_reference_id?: string | null;
  reasons_json: string[];
  assessed_by: string;
  recorded_at: string;
}

export interface SuspiciousRelationship {
  id: string;
  source_account_id: string;
  target_account_id: string;
  target_account_number?: string;
  target_holder_name?: string;
  target_bank?: string;
  relationship_type:
    | 'BENEFICIARY'
    | 'SHARED_DEVICE'
    | 'COMMON_IDENTIFIER'
    | 'REPEATED_BURST'
    | 'SUSPECTED_SYNDICATE';
  hops_to_confirmed_fraud: number;
  risk_weight: number;
  first_observed_at: string;
  last_observed_at: string;
}

export interface AccountIntelligenceDetail {
  account: {
    id: string;
    account_number: string;
    holder_name: string;
    branch_city: string;
    ifsc_code: string;
    account_type: string;
    is_frozen: boolean;
    bank_name: string;
    bank_code: string;
  };
  profile: AccountIntelligenceProfile;
  relationships: SuspiciousRelationship[];
  riskHistory: AccountRiskHistoryEntry[];
  recentPatterns: {
    fanInCount: number;
    passThroughRatio: number;
    rapidForwardBursts: number;
    largeReceiptsCount: number;
    flaggedCounterparties: number;
    hourlyVelocityMax: number;
  };
  linkedComplaints: Array<{
    id: string;
    complaint_number: string;
    status: string;
    fraud_type: string;
    reported_amount: number;
  }>;
}

export interface AccountIntelligenceRegistryResponse {
  accounts: AccountIntelligenceProfile[];
  summary: {
    totalAccounts: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    underInvestigationCount: number;
    confirmedFraudLinkedCount: number;
    suspectedMuleCount: number;
    suspiciousAccountCount: number;
    normalCount: number;
  };
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

// =============================================================================
// PREVENTION LAYER: REAL-TIME TRANSACTION SCREENING (Phase 3)
// =============================================================================

export type ScreeningDecision = 'ALLOW' | 'VERIFY' | 'HOLD' | 'BLOCK';
export type RecommendedAction =
  | 'ALLOW'
  | 'ADDITIONAL_VERIFICATION'
  | 'HOLD_FOR_REVIEW'
  | 'REJECT_BLOCK';
export type ScreeningFailMode = 'NONE' | 'FAIL_OPEN' | 'FAIL_CLOSED';

export interface ScreeningRequestPayload {
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

export interface RuleTriggeredDetail {
  rule_id: string;
  name: string;
  weight: number;
  contribution: number;
  category: 'SENDER' | 'RECEIVER' | 'TRANSACTION' | 'NETWORK';
}

export interface ScreeningResult {
  screeningId: string;
  idempotencyKey: string;
  decision: ScreeningDecision;
  recommendedAction: RecommendedAction;
  riskScore: number;
  riskClassification: RiskClassification;
  accountRiskScore: number;
  transactionRiskScore: number;
  networkRiskScore: number;
  compositeScore: number;
  senderRiskScore: number;
  receiverRiskScore: number;
  latencyMs: number;
  appliedFailMode: ScreeningFailMode;
  scoreSource: ScoreSource;
  thresholdsVersion: number;
  rulesTriggered: RuleTriggeredDetail[];
  plainLanguageExplanation: string;
  limitationsDisclaimer: string;
  senderAccount: {
    id: string;
    accountNumber: string;
    holderName: string;
    bankName: string;
    accountStatus: AccountStatusClassification;
  };
  receiverAccount: {
    id: string;
    accountNumber: string;
    holderName: string;
    bankName: string;
    accountStatus: AccountStatusClassification;
  };
  idempotentReplay?: boolean;
  screenedAt: string;
}

export interface ScreeningThresholds {
  id: string;
  version: number;
  low_max: number;
  medium_max: number;
  high_max: number;
  is_active: boolean;
  modified_by?: string | null;
  reason_for_change: string;
  created_at: string;
}

export interface SystemSettingItem {
  id: string;
  key: string;
  value: string;
  description: string;
  updated_at: string;
}

// ---------------- PHASE 5: GRAPH ACCOUNT INTELLIGENCE & MULE SYNDICATE TYPES ----------------

export type MuleClusterType =
  | 'MULE_RING_CYCLE'
  | 'FAN_OUT_DISPERSAL'
  | 'RAPID_PASS_THROUGH_CHAIN'
  | 'FUNNEL_COLLECTION'
  | 'SUSPICIOUS_COMMUNITY';

export interface MuleClusterMember {
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

export interface MuleCluster {
  cluster_id: string;
  cluster_type: MuleClusterType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  member_count: number;
  members: MuleClusterMember[];
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

export interface MuleClustersResponse {
  clusters: MuleCluster[];
  total_clusters: number;
  high_risk_clusters: number;
  total_flagged_accounts: number;
  total_exposure_amount: number;
}

export interface GraphRiskPropagation {
  source_account_id: string;
  target_account_id: string;
  hop_distance: number;
  attenuation_factor: number;
  base_risk: number;
  propagated_risk: number;
}

export interface CounterpartyGraphInfo {
  account_id: string;
  account_number: string;
  holder_name: string;
  direction: 'INFLOW' | 'OUTFLOW';
  total_amount: number;
  tx_count: number;
  risk_classification: string;
}

export interface AccountGraphIntelligence {
  account_id: string;
  account_number: string;
  holder_name: string;
  subgraph_node_count: number;
  subgraph_edge_count: number;
  in_degree: number;
  out_degree: number;
  unique_senders: number;
  unique_receivers: number;
  pagerank: number;
  betweenness_centrality: number;
  distance_to_nearest_fraud_account: number | null;
  nearest_fraud_account_id: string | null;
  propagated_risk_score: number;
  is_part_of_cycle: boolean;
  cycle_count: number;
  mule_cluster_id: string | null;
  mule_cluster_type: MuleClusterType | null;
  mule_cluster_role: string | null;
  cluster_risk_score: number | null;
  fan_in_ratio: number;
  fan_out_ratio: number;
  pass_through_ratio: number | null;
  avg_forward_latency_sec: number | null;
  max_1h_velocity: number;
  top_counterparties: CounterpartyGraphInfo[];
}

export interface AccountSubgraphData extends GraphTraceData {
  root_account_id: string;
  propagated_risks: GraphRiskPropagation[];
  mule_clusters: MuleCluster[];
  graph_intelligence: AccountGraphIntelligence;
}

// =============================================================================
// PREVENTION LAYER: TRANSACTION INTERVENTION CENTRE (Phase 6)
// =============================================================================

export type InterventionReviewStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'ESCALATED'
  | 'AUTO_RESOLVED'
  | 'FALSE_POSITIVE';

export interface InterventionItem {
  id: string;
  screening_id: string;
  recommended_action: RecommendedAction;
  review_status: InterventionReviewStatus;
  resolved_by: string | null;
  resolver_name: string | null;
  resolver_role: string | null;
  resolved_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;

  // Embedded screening transaction context
  amount: number;
  currency: string;
  channel: string;
  screened_at: string;
  client_id?: string | null;

  // Sender details
  sender_account_id: string;
  sender_account_number: string;
  sender_holder_name: string;
  sender_bank_name: string;
  sender_risk_score: number;
  sender_risk_classification: string;

  // Receiver details
  receiver_account_id: string;
  receiver_account_number: string;
  receiver_holder_name: string;
  receiver_bank_name: string;
  receiver_risk_score: number;
  receiver_risk_classification: string;

  // Risk Assessment details
  composite_risk_score: number;
  risk_classification: string;
  decision: ScreeningDecision;
  score_source: string;
  rules_triggered: RuleTriggeredDetail[];
}

export interface InterventionAuditRecord {
  id: string;
  sequence_number: number;
  screening_id: string | null;
  intervention_id: string | null;
  actor_user_id: string | null;
  actor_name?: string | null;
  actor_role: string;
  action: string;
  previous_hash: string;
  entry_hash: string;
  payload_json: Record<string, unknown>;
  ip_address: string;
  created_at: string;
}

export interface InterventionDetail extends InterventionItem {
  audit_trail: InterventionAuditRecord[];
  sender_profile?: Record<string, unknown>;
  receiver_profile?: Record<string, unknown>;
  graph_context?: Record<string, unknown>;
  limitations_disclaimer: string;
}

export interface InterventionReviewPayload {
  decision: 'APPROVED' | 'REJECTED' | 'ESCALATED' | 'FALSE_POSITIVE';
  action?: RecommendedAction;
  notes: string;
}

export interface HashChainVerificationReport {
  status: 'VALID' | 'COMPROMISED';
  total_entries_verified: number;
  first_sequence: number | null;
  last_sequence: number | null;
  genesis_hash: string | null;
  latest_hash: string | null;
  broken_link_index: number | null;
  broken_details: string | null;
  verified_at: string;
  limitations_disclaimer: string;
}

export interface InterventionMetrics {
  total_interventions: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  escalated_count: number;
  false_positive_count: number;
  auto_resolved_count: number;
  by_action: {
    ALLOW: number;
    ADDITIONAL_VERIFICATION: number;
    HOLD_FOR_REVIEW: number;
    REJECT_BLOCK: number;
  };
  total_intercepted_amount: number;
  total_prevented_loss_amount: number;
  override_count: number;
  override_rate_pct: number;
  false_positive_rate_pct: number;
  avg_review_time_sec: number;
  high_risk_queue_count: number;
}




