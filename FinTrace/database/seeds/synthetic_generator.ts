/**
 * FinTrace Deterministic Synthetic Data Generator (SIH PS 26184)
 *
 * Generates realistic synthetic cybercrime & banking scenarios using Bengaluru
 * city coordinates. All entities are explicitly marked synthetic (is_synthetic = true).
 *
 * Scenarios covered:
 *   1. Normal banking activity (180+ legitimate UPI/IMPS/NEFT/CARD transfers + routine ATM withdrawals)
 *   2. Fraud transfer followed by multi-account layering (CMP-2026-0001, Digital Arrest, ₹14,50,000)
 *   3. Mule account receiving and forwarding funds rapidly (CMP-2026-0002, UPI Phishing, ₹6,20,000)
 *   4. Suspicious account followed by an ATM cash-out (CMP-2026-0003, Investment Scam, ₹9,80,000)
 *   5. Multiple candidate ATMs with different risk scores (CMP-2026-0004, OTP Hijack, ₹4,75,000)
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export interface RoleSeed {
  id: number;
  name: 'Administrator' | 'Senior Investigator' | 'Investigator' | 'Bank Nodal Officer';
  description: string;
  permissions: string[];
}

export interface InstitutionSeed {
  id: string;
  name: string;
  ifsc_prefix: string;
  bank_code: string;
  nodal_email: string;
  headquarters: string;
}

export interface UserSeed {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role_name: RoleSeed['name'];
  institution_id: string | null;
  investigator?: {
    id: string;
    badge_number: string;
    unit_name: string;
    jurisdiction: string;
    specialization: string;
    active_caseload: number;
  };
}

export interface VictimSeed {
  id: string;
  full_name: string;
  phone_masked: string;
  email: string;
  city: string;
  state: string;
  home_lat: number;
  home_lng: number;
}

export interface AccountSeed {
  id: string;
  account_number: string;
  institution_id: string;
  holder_name: string;
  account_type: 'SAVINGS' | 'CURRENT' | 'WALLET' | 'MERCHANT';
  ifsc_code: string;
  branch_city: string;
  branch_lat: number;
  branch_lng: number;
  kyc_verified: boolean;
  account_age_days: number;
  is_frozen: boolean;
}

export interface AtmSeed {
  id: string;
  bank: string;
  institution_id: string;
  address: string;
  locality: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  cash_capacity_tier: 'HIGH' | 'MEDIUM' | 'LOW';
  is_24x7: boolean;
}

export interface ComplaintSeed {
  id: string;
  complaint_number: string;
  victim_id: string;
  assigned_to: string | null;
  fraud_type:
    | 'UPI_PHISHING'
    | 'INVESTMENT_SCAM'
    | 'DIGITAL_ARREST'
    | 'OTP_HIJACK'
    | 'CARD_SKIMMING'
    | 'LOAN_APP_FRAUD'
    | 'OTHER';
  reported_amount: number;
  incident_timestamp: Date;
  reported_at: Date;
  status: 'REGISTERED' | 'TRACING' | 'MULE_IDENTIFIED' | 'ATM_ALERTED' | 'CONTAINED' | 'CLOSED';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
  city: string;
}

export interface TransactionSeed {
  txn_id: string;
  from_account: string;
  to_account: string;
  amount: number;
  timestamp: Date;
  channel: 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'CARD' | 'WALLET';
  complaint_id: string | null;
  hop_depth: number | null;
  is_flagged_fraud: boolean;
  remarks: string;
}

export interface AtmWithdrawalSeed {
  id: string;
  atm_id: string;
  account_id: string;
  complaint_id: string | null;
  amount: number;
  withdrawn_at: Date;
  card_last4: string;
  is_flagged_cashout: boolean;
}

export interface SuspiciousAccountSeed {
  id: string;
  account_id: string;
  complaint_id: string;
  classification:
    | 'SUSPECTED_MULE'
    | 'LAYERING_NODE'
    | 'CASH_OUT_CANDIDATE'
    | 'ORIGIN_COMPROMISED'
    | 'CLEARED';
  mule_probability: number | null;
  score_source: 'Trained ML prediction' | 'Rule-based risk score' | 'Synthetic demo result';
  reason: string;
  flagged_by: string;
  status: 'ACTIVE' | 'FROZEN' | 'CLEARED';
}

export interface AtmPredictionSeed {
  id: string;
  atm_id: string;
  complaint_id: string;
  risk_score: number;
  risk_level: 'Critical' | 'High' | 'Medium' | 'Low';
  window: '0-6h' | '6-12h' | '12-24h' | '>24h';
  confidence: 'High' | 'Moderate' | 'Low';
  score_source: 'Trained ML prediction' | 'Rule-based risk score' | 'Synthetic demo result';
  linked_accounts_json: Array<{ account_id: string; account_number: string; role: string }>;
  relevant_paths_json: Array<{ path: string[]; total_amount: number }>;
  explanation_json: {
    plain_language: string;
    factors: Array<{ factor: string; weight: number; value: string; contribution: number }>;
  };
  limitations_text: string;
  model_version: string;
  rank_order: number;
}

export interface AlertSeed {
  id: string;
  complaint_id: string;
  account_id: string | null;
  atm_id: string | null;
  alert_type: 'CASH_OUT_IMMINENT' | 'MULE_BURST' | 'LAYERING_CYCLE' | 'HIGH_VALUE_HOP' | 'ANOMALY_DETECTED';
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'DISPATCHED' | 'RESOLVED' | 'FALSE_POSITIVE';
  title: string;
  description: string;
  score_source: 'Trained ML prediction' | 'Rule-based risk score' | 'Synthetic demo result';
}

export interface InvestigationSeed {
  id: string;
  case_number: string;
  complaint_id: string;
  lead_investigator: string;
  status: 'OPEN' | 'ACTIVE_TRACE' | 'FREEZE_REQUESTED' | 'ATM_SURVEILLANCE' | 'CLOSED';
  findings_summary: string;
  recommended_actions: string[];
}

export interface EvidenceSeed {
  id: string;
  investigation_id: string;
  complaint_id: string;
  uploaded_by: string;
  evidence_type:
    | 'BANK_STATEMENT_CSV'
    | 'CDR_EXTRACT'
    | 'ATM_CCTV_NOTE'
    | 'NPCI_REF'
    | 'FREEZE_ORDER'
    | 'OTHER';
  title: string;
  description: string;
  file_name: string;
  sha256_hash: string;
  metadata_json: Record<string, unknown>;
}

export interface SyntheticDataset {
  roles: RoleSeed[];
  institutions: InstitutionSeed[];
  users: UserSeed[];
  victims: VictimSeed[];
  accounts: AccountSeed[];
  atms: AtmSeed[];
  complaints: ComplaintSeed[];
  transactions: TransactionSeed[];
  atmWithdrawals: AtmWithdrawalSeed[];
  suspiciousAccounts: SuspiciousAccountSeed[];
  atmPredictions: AtmPredictionSeed[];
  alerts: AlertSeed[];
  investigations: InvestigationSeed[];
  evidenceRecords: EvidenceSeed[];
}

function deterministicUuid(namespace: string): string {
  const hash = crypto.createHash('sha256').update(`fintrace:${namespace}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

function createMulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSyntheticDataset(): SyntheticDataset {
  const rand = createMulberry32(2026184);
  const baseTime = new Date('2026-11-12T10:00:00.000Z').getTime();
  const hoursAgo = (h: number): Date => new Date(baseTime - h * 3600 * 1000);
  const minsAgo = (m: number): Date => new Date(baseTime - m * 60 * 1000);

  // 1. RBAC Roles
  const roles: RoleSeed[] = [
    {
      id: 1,
      name: 'Administrator',
      description: 'Full platform configuration, user management, model training, and audit oversight.',
      permissions: ['*'],
    },
    {
      id: 2,
      name: 'Senior Investigator',
      description: 'Leads multi-case cybercrime tracing, ML runs, ATM prediction dispatch, and audit review.',
      permissions: [
        'complaints:*',
        'transactions:*',
        'graph:read',
        'ml:*',
        'predictions:*',
        'investigations:*',
        'alerts:*',
        'evidence:*',
        'assistant:use',
        'audit:read',
        'reports:export',
      ],
    },
    {
      id: 3,
      name: 'Investigator',
      description: 'Registers complaints, ingests transactions, traces flows, flags mules, and runs ATM predictions.',
      permissions: [
        'complaints:read',
        'complaints:create',
        'complaints:update',
        'transactions:read',
        'transactions:create',
        'graph:read',
        'ml:detect',
        'predictions:read',
        'predictions:run',
        'investigations:read',
        'investigations:update',
        'alerts:read',
        'alerts:update',
        'evidence:read',
        'evidence:create',
        'assistant:use',
        'reports:export',
      ],
    },
    {
      id: 4,
      name: 'Bank Nodal Officer',
      description: 'Uploads bank transaction statements, verifies account freeze requests, and acknowledges alerts.',
      permissions: [
        'complaints:read',
        'transactions:read',
        'transactions:create',
        'accounts:flag',
        'alerts:read',
        'alerts:update',
        'evidence:read',
        'evidence:create',
        'reports:export',
      ],
    },
  ];

  // 2. Synthetic Financial Institutions
  const institutions: InstitutionSeed[] = [
    {
      id: deterministicUuid('inst-ssb'),
      name: 'Synthetic State Bank of India (Demo)',
      ifsc_prefix: 'SYNS0001',
      bank_code: 'SYNSBI',
      nodal_email: 'nodal.synsbi@synthetic.fintrace.local',
      headquarters: 'Bengaluru',
    },
    {
      id: deterministicUuid('inst-dub'),
      name: 'Deccan Urban Commercial Bank (Demo)',
      ifsc_prefix: 'SYND0002',
      bank_code: 'DECCAN',
      nodal_email: 'nodal.deccan@synthetic.fintrace.local',
      headquarters: 'Bengaluru',
    },
    {
      id: deterministicUuid('inst-ncb'),
      name: 'Namma Metro Cooperative Bank (Demo)',
      ifsc_prefix: 'SYNN0003',
      bank_code: 'NAMMA',
      nodal_email: 'nodal.namma@synthetic.fintrace.local',
      headquarters: 'Bengaluru',
    },
    {
      id: deterministicUuid('inst-adp'),
      name: 'Apex Digital Payments Bank (Demo)',
      ifsc_prefix: 'SYNA0004',
      bank_code: 'APEXDP',
      nodal_email: 'nodal.apex@synthetic.fintrace.local',
      headquarters: 'Mumbai',
    },
    {
      id: deterministicUuid('inst-mmb'),
      name: 'Mercantile Trust Bank (Demo)',
      ifsc_prefix: 'SYNM0005',
      bank_code: 'MERCTB',
      nodal_email: 'nodal.mercantile@synthetic.fintrace.local',
      headquarters: 'Hyderabad',
    },
  ];

  // 3. Synthetic Demo Users (password for all demo users: FinTrace@Demo2026)
  const demoPasswordHash = bcrypt.hashSync('FinTrace@Demo2026', 10);

  const users: UserSeed[] = [
    {
      id: deterministicUuid('user-admin'),
      email: 'admin@fintrace.demo',
      password_hash: demoPasswordHash,
      full_name: 'Arvind Deshmukh (Admin)',
      role_name: 'Administrator',
      institution_id: null,
    },
    {
      id: deterministicUuid('user-senior-inv'),
      email: 'kavya.rao@fintrace.demo',
      password_hash: demoPasswordHash,
      full_name: 'ACP Kavya Rao (Senior Inv)',
      role_name: 'Senior Investigator',
      institution_id: null,
      investigator: {
        id: deterministicUuid('inv-kavya'),
        badge_number: 'SYN-CC-101',
        unit_name: 'Bengaluru Cyber Financial Wing (Demo)',
        jurisdiction: 'Bengaluru Urban',
        specialization: 'Mule Layering & ATM Cash-Out Forecasting',
        active_caseload: 4,
      },
    },
    {
      id: deterministicUuid('user-inv-1'),
      email: 'rohan.menon@fintrace.demo',
      password_hash: demoPasswordHash,
      full_name: 'Insp. Rohan Menon',
      role_name: 'Investigator',
      institution_id: null,
      investigator: {
        id: deterministicUuid('inv-rohan'),
        badge_number: 'SYN-CC-204',
        unit_name: 'South-East Cyber Cell (Demo)',
        jurisdiction: 'Koramangala / HSR / Electronic City',
        specialization: 'UPI Phishing & Rapid Pass-Through',
        active_caseload: 2,
      },
    },
    {
      id: deterministicUuid('user-inv-2'),
      email: 'meera.iyer@fintrace.demo',
      password_hash: demoPasswordHash,
      full_name: 'SI Meera Iyer',
      role_name: 'Investigator',
      institution_id: null,
      investigator: {
        id: deterministicUuid('inv-meera'),
        badge_number: 'SYN-CC-219',
        unit_name: 'East Division Cyber Squad (Demo)',
        jurisdiction: 'Indiranagar / Whitefield / Marathahalli',
        specialization: 'Investment & Digital Arrest Networks',
        active_caseload: 2,
      },
    },
    {
      id: deterministicUuid('user-nodal-1'),
      email: 'nodal.synsbi@fintrace.demo',
      password_hash: demoPasswordHash,
      full_name: 'Suresh Kulkarni (Bank Nodal)',
      role_name: 'Bank Nodal Officer',
      institution_id: institutions[0].id,
    },
  ];

  // 4. Bengaluru Synthetic ATMs (18 realistic coordinates across key corridors)
  const atmCatalog: Array<{
    id: string;
    bankIdx: number;
    address: string;
    locality: string;
    lat: number;
    lng: number;
    tier: 'HIGH' | 'MEDIUM' | 'LOW';
    is24x7: boolean;
  }> = [
    { id: 'ATM-BLR-001', bankIdx: 0, address: '80 Feet Road, 4th Block, Koramangala', locality: 'Koramangala', lat: 12.9352, lng: 77.6245, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-002', bankIdx: 1, address: 'Outer Ring Road, Silk Board Junction', locality: 'Silk Board', lat: 12.9177, lng: 77.6238, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-003', bankIdx: 2, address: '27th Main Road, HSR Layout Sector 1', locality: 'HSR Layout', lat: 12.9121, lng: 77.6446, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-004', bankIdx: 0, address: '100 Feet Road, Indiranagar Metro Station', locality: 'Indiranagar', lat: 12.9784, lng: 77.6408, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-005', bankIdx: 3, address: 'CMH Road, Indiranagar 2nd Stage', locality: 'Indiranagar', lat: 12.9792, lng: 77.6384, tier: 'MEDIUM', is24x7: true },
    { id: 'ATM-BLR-006', bankIdx: 1, address: 'Mahatma Gandhi Road, Near Trinity Circle', locality: 'MG Road', lat: 12.9735, lng: 77.6194, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-007', bankIdx: 4, address: 'Brigade Road Cross, Shanthala Nagar', locality: 'MG Road', lat: 12.9718, lng: 77.6070, tier: 'MEDIUM', is24x7: false },
    { id: 'ATM-BLR-008', bankIdx: 0, address: 'ITPL Main Road, Whitefield', locality: 'Whitefield', lat: 12.9855, lng: 77.7365, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-009', bankIdx: 2, address: 'Marathahalli Bridge Junction, ORR', locality: 'Marathahalli', lat: 12.9569, lng: 77.7011, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-010', bankIdx: 1, address: 'Hosur Road, Electronic City Phase 1', locality: 'Electronic City', lat: 12.8452, lng: 77.6602, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-011', bankIdx: 0, address: '11th Main, Jayanagar 4th Block', locality: 'Jayanagar', lat: 12.9299, lng: 77.5838, tier: 'MEDIUM', is24x7: true },
    { id: 'ATM-BLR-012', bankIdx: 3, address: 'Bannerghatta Main Road, BTM 2nd Stage', locality: 'BTM Layout', lat: 12.9166, lng: 77.6101, tier: 'MEDIUM', is24x7: true },
    { id: 'ATM-BLR-013', bankIdx: 4, address: 'Sampige Road, Malleswaram', locality: 'Malleswaram', lat: 13.0031, lng: 77.5712, tier: 'MEDIUM', is24x7: false },
    { id: 'ATM-BLR-014', bankIdx: 0, address: 'Bellary Road, Hebbal Flyover', locality: 'Hebbal', lat: 13.0358, lng: 77.5970, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-015', bankIdx: 1, address: 'Chord Road, Rajajinagar 1st Block', locality: 'Rajajinagar', lat: 12.9982, lng: 77.5530, tier: 'LOW', is24x7: false },
    { id: 'ATM-BLR-016', bankIdx: 2, address: 'Kempegowda Bus Terminal, Majestic', locality: 'Majestic', lat: 12.9778, lng: 77.5713, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-017', bankIdx: 0, address: 'KR Puram Railway Station Forecourt', locality: 'KR Puram', lat: 13.0012, lng: 77.6952, tier: 'HIGH', is24x7: true },
    { id: 'ATM-BLR-018', bankIdx: 3, address: 'Yelahanka New Town Main Road', locality: 'Yelahanka', lat: 13.1007, lng: 77.5963, tier: 'LOW', is24x7: true },
  ];

  const atms: AtmSeed[] = atmCatalog.map((item) => ({
    id: item.id,
    bank: institutions[item.bankIdx].name,
    institution_id: institutions[item.bankIdx].id,
    address: item.address,
    locality: item.locality,
    city: 'Bengaluru',
    state: 'Karnataka',
    lat: item.lat,
    lng: item.lng,
    cash_capacity_tier: item.tier,
    is_24x7: item.is24x7,
  }));

  // 5. Victims
  const victims: VictimSeed[] = [
    {
      id: deterministicUuid('victim-1'),
      full_name: 'Nandini Subramanian',
      phone_masked: '+91-98XXX-XX412',
      email: 'nandini.s@synthetic.local',
      city: 'Bengaluru',
      state: 'Karnataka',
      home_lat: 12.9312,
      home_lng: 77.5844,
    },
    {
      id: deterministicUuid('victim-2'),
      full_name: 'Vikramaditya Joshi',
      phone_masked: '+91-97XXX-XX829',
      email: 'vikram.j@synthetic.local',
      city: 'Bengaluru',
      state: 'Karnataka',
      home_lat: 12.9742,
      home_lng: 77.6412,
    },
    {
      id: deterministicUuid('victim-3'),
      full_name: 'Prashanth Hegde',
      phone_masked: '+91-99XXX-XX103',
      email: 'prashanth.h@synthetic.local',
      city: 'Bengaluru',
      state: 'Karnataka',
      home_lat: 12.9182,
      home_lng: 77.6305,
    },
    {
      id: deterministicUuid('victim-4'),
      full_name: 'Ananya Chatterjee',
      phone_masked: '+91-96XXX-XX550',
      email: 'ananya.c@synthetic.local',
      city: 'Bengaluru',
      state: 'Karnataka',
      home_lat: 12.9810,
      home_lng: 77.6420,
    },
  ];

  // 6. Bank Accounts (40 accounts: 4 victims, 16 normal citizens/merchants, 20 mule/layering/cashout nodes)
  const branchCoords: Array<{ city: string; lat: number; lng: number }> = [
    { city: 'Bengaluru - Koramangala', lat: 12.9348, lng: 77.6262 },
    { city: 'Bengaluru - Indiranagar', lat: 12.9781, lng: 77.6401 },
    { city: 'Bengaluru - HSR Layout', lat: 12.9116, lng: 77.6412 },
    { city: 'Bengaluru - Whitefield', lat: 12.9841, lng: 77.7342 },
    { city: 'Bengaluru - Jayanagar', lat: 12.9301, lng: 77.5835 },
    { city: 'Bengaluru - MG Road', lat: 12.9745, lng: 77.6140 },
    { city: 'Bengaluru - Marathahalli', lat: 12.9574, lng: 77.7008 },
    { city: 'Bengaluru - Electronic City', lat: 12.8465, lng: 77.6615 },
  ];

  const accounts: AccountSeed[] = [];
  const makeAccount = (
    key: string,
    acctNum: string,
    holder: string,
    type: AccountSeed['account_type'],
    instIdx: number,
    branchIdx: number,
    ageDays: number,
    kycVerified = true,
    isFrozen = false
  ): AccountSeed => {
    const inst = institutions[instIdx];
    const br = branchCoords[branchIdx];
    const acc: AccountSeed = {
      id: deterministicUuid(key),
      account_number: acctNum,
      institution_id: inst.id,
      holder_name: holder,
      account_type: type,
      ifsc_code: `${inst.ifsc_prefix}0${10 + branchIdx}`,
      branch_city: br.city,
      branch_lat: br.lat,
      branch_lng: br.lng,
      kyc_verified: kycVerified,
      account_age_days: ageDays,
      is_frozen: isFrozen,
    };
    accounts.push(acc);
    return acc;
  };

  // Victim accounts
  const vAcc1 = makeAccount('acc-v1', 'SYN100000101', 'Nandini Subramanian', 'SAVINGS', 0, 4, 1820);
  const vAcc2 = makeAccount('acc-v2', 'SYN100000102', 'Vikramaditya Joshi', 'SAVINGS', 1, 1, 1450);
  const vAcc3 = makeAccount('acc-v3', 'SYN100000103', 'Prashanth Hegde', 'SAVINGS', 0, 0, 980);
  const vAcc4 = makeAccount('acc-v4', 'SYN100000104', 'Ananya Chatterjee', 'SAVINGS', 2, 1, 1120);

  // Scenario 2 accounts (Multi-account layering + cycle)
  const s2Hop1A = makeAccount('acc-s2-h1a', 'SYN200001001', 'Kiran Enterprises (Shell)', 'CURRENT', 1, 2, 42, false);
  const s2Hop1B = makeAccount('acc-s2-h1b', 'SYN200001002', 'Rakesh Gowda', 'SAVINGS', 3, 6, 28, true);
  const s2Hop1C = makeAccount('acc-s2-h1c', 'SYN200001003', 'Deepak Traders', 'CURRENT', 2, 0, 55, true);
  const s2Hop2A = makeAccount('acc-s2-h2a', 'SYN200002001', 'Sonia Verma', 'WALLET', 3, 5, 19, false);
  const s2Hop2B = makeAccount('acc-s2-h2b', 'SYN200002002', 'Manoj Shetty', 'SAVINGS', 4, 3, 35, true);
  const s2Hop2C = makeAccount('acc-s2-h2c', 'SYN200002003', 'Global Tech Logistics', 'CURRENT', 1, 6, 48, true);
  const s2Hop3Cons = makeAccount('acc-s2-h3', 'SYN200003001', 'Tarun Nair (Consolidator)', 'SAVINGS', 0, 3, 25, true);

  // Scenario 3 accounts (Mule receiving and forwarding funds rapidly)
  const s3SrcAlt = makeAccount('acc-s3-src2', 'SYN300000901', 'Compromised Merchant Node', 'MERCHANT', 2, 7, 310);
  const s3MuleHub = makeAccount('acc-s3-mule', 'SYNMULE00100', 'Salim Ansari (Mule Hub)', 'SAVINGS', 3, 0, 14, false);
  const s3Out1 = makeAccount('acc-s3-out1', 'SYN300002001', 'Harish Kumar', 'SAVINGS', 1, 2, 21, true);
  const s3Out2 = makeAccount('acc-s3-out2', 'SYN300002002', 'Pooja Sharma', 'WALLET', 3, 0, 17, false);
  const s3Out3 = makeAccount('acc-s3-out3', 'SYN300002003', 'Naveen B', 'SAVINGS', 0, 6, 29, true);

  // Scenario 4 accounts (Suspicious account followed by actual ATM cash-out)
  const s4Layer = makeAccount('acc-s4-lay1', 'SYN400001001', 'Apex Crypto Desk (Unverified)', 'CURRENT', 1, 0, 62, false);
  const s4Cashout = makeAccount('acc-s4-cash', 'SYN400002001', 'Imran Pasha (Cash-Out)', 'SAVINGS', 0, 0, 18, true, true);

  // Scenario 5 accounts (Pre-cashout active threat across multiple candidate ATMs)
  const s5Layer1 = makeAccount('acc-s5-lay1', 'SYN500001001', 'Vikas Malhotra', 'WALLET', 3, 1, 23, false);
  const s5CashA = makeAccount('acc-s5-casha', 'SYN500002001', 'Arjun Reddy (Candidate A)', 'SAVINGS', 0, 1, 16, true);
  const s5CashB = makeAccount('acc-s5-cashb', 'SYN500002002', 'Farhan Khan (Candidate B)', 'SAVINGS', 1, 5, 31, true);
  const s5CashC = makeAccount('acc-s5-cashc', 'SYN500002003', 'Divya K (Candidate C)', 'SAVINGS', 2, 3, 40, true);

  // Scenario 1 normal accounts (16 normal citizens & merchants)
  const normalNames = [
    'Bengaluru Fresh Mart',
    'Aarav Krishnan',
    'Shruti Deshpande',
    'Karthik Narayan',
    'Metro Fuel Station',
    'Priya Venkat',
    'Siddharth Rao',
    'Lakshmi Bakery & Cafe',
    'Gaurav Mishra',
    'Neha Kulkarni',
    'TechPark Canteen',
    'Vivek Bhat',
    'Swathi Murthy',
    'Surya Pharmacy',
    'Rahul Verma',
    'Sneha Patil',
  ];
  const normalAccounts: AccountSeed[] = normalNames.map((name, i) =>
    makeAccount(
      `acc-norm-${i + 1}`,
      `SYNNORM00${String(i + 1).padStart(3, '0')}`,
      name,
      i % 4 === 0 ? 'MERCHANT' : 'SAVINGS',
      i % institutions.length,
      i % branchCoords.length,
      450 + i * 95,
      true,
      false
    )
  );

  // 7. Complaints (4 rich active cases mapped to Scenarios 2-5)
  const invKavyaId = users[1].investigator!.id;
  const invRohanId = users[2].investigator!.id;
  const invMeeraId = users[3].investigator!.id;

  const complaints: ComplaintSeed[] = [
    {
      id: deterministicUuid('cmp-2026-0001'),
      complaint_number: 'CMP-2026-0001',
      victim_id: victims[0].id,
      assigned_to: invKavyaId,
      fraud_type: 'DIGITAL_ARREST',
      reported_amount: 1450000,
      incident_timestamp: hoursAgo(18),
      reported_at: hoursAgo(16),
      status: 'MULE_IDENTIFIED',
      priority: 'CRITICAL',
      summary:
        'Victim coerced via fake enforcement video call into transferring INR 14.50L; funds split into 3 shell accounts and layered across 3 hops with a cyclic bounce.',
      city: 'Bengaluru',
    },
    {
      id: deterministicUuid('cmp-2026-0002'),
      complaint_number: 'CMP-2026-0002',
      victim_id: victims[1].id,
      assigned_to: invRohanId,
      fraud_type: 'UPI_PHISHING',
      reported_amount: 620000,
      incident_timestamp: hoursAgo(10),
      reported_at: hoursAgo(9),
      status: 'TRACING',
      priority: 'HIGH',
      summary:
        'Victim clicked spoofed utility KYC link; INR 6.20L routed into central mule account SYNMULE00100 alongside second compromised merchant inflow and dispersed within 15 minutes.',
      city: 'Bengaluru',
    },
    {
      id: deterministicUuid('cmp-2026-0003'),
      complaint_number: 'CMP-2026-0003',
      victim_id: victims[2].id,
      assigned_to: invRohanId,
      fraud_type: 'INVESTMENT_SCAM',
      reported_amount: 980000,
      incident_timestamp: hoursAgo(26),
      reported_at: hoursAgo(22),
      status: 'CONTAINED',
      priority: 'HIGH',
      summary:
        'Fake institutional trading portal fraud of INR 9.80L; funds layered to cash-out mule Imran Pasha followed by structured ATM withdrawals in Koramangala/Silk Board prior to freeze.',
      city: 'Bengaluru',
    },
    {
      id: deterministicUuid('cmp-2026-0004'),
      complaint_number: 'CMP-2026-0004',
      victim_id: victims[3].id,
      assigned_to: invMeeraId,
      fraud_type: 'OTP_HIJACK',
      reported_amount: 475000,
      incident_timestamp: hoursAgo(2.5),
      reported_at: hoursAgo(1.5),
      status: 'ATM_ALERTED',
      priority: 'CRITICAL',
      summary:
        'SIM-swap OTP hijack of INR 4.75L; funds arrived at 3 candidate cash-out accounts clustered near Indiranagar, MG Road, and Whitefield. No ATM withdrawal observed yet (imminent window).',
      city: 'Bengaluru',
    },
  ];

  // 8. Transactions
  const transactions: TransactionSeed[] = [];
  let txnSeq = 1000;
  const nextTxnId = (prefix: string): string => {
    txnSeq += 1;
    return `${prefix}-${txnSeq}`;
  };

  // --- Scenario 1: Normal Banking Activity (~180 transactions over 14 days) ---
  const channels: TransactionSeed['channel'][] = ['UPI', 'IMPS', 'NEFT', 'CARD', 'WALLET'];
  for (let i = 0; i < 184; i++) {
    const fromIdx = Math.floor(rand() * normalAccounts.length);
    let toIdx = Math.floor(rand() * normalAccounts.length);
    if (toIdx === fromIdx) {
      toIdx = (fromIdx + 1) % normalAccounts.length;
    }
    const dayOffsetHours = 6 + rand() * (14 * 24 - 6);
    const amount = Math.round((250 + rand() * 48500) * 100) / 100;
    transactions.push({
      txn_id: nextTxnId('TXN-NORM'),
      from_account: normalAccounts[fromIdx].id,
      to_account: normalAccounts[toIdx].id,
      amount,
      timestamp: hoursAgo(dayOffsetHours),
      channel: channels[Math.floor(rand() * channels.length)],
      complaint_id: null,
      hop_depth: null,
      is_flagged_fraud: false,
      remarks: 'Synthetic routine retail banking transfer',
    });
  }

  // --- Scenario 2: Fraud Transfer + Multi-Account Layering + Cycle (CMP-2026-0001) ---
  const c1 = complaints[0].id;
  transactions.push(
    {
      txn_id: 'TXN-C1-001',
      from_account: vAcc1.id,
      to_account: s2Hop1A.id,
      amount: 650000,
      timestamp: hoursAgo(17.9),
      channel: 'RTGS',
      complaint_id: c1,
      hop_depth: 1,
      is_flagged_fraud: true,
      remarks: 'Initial coerced tranche 1 (Digital Arrest)',
    },
    {
      txn_id: 'TXN-C1-002',
      from_account: vAcc1.id,
      to_account: s2Hop1B.id,
      amount: 450000,
      timestamp: hoursAgo(17.7),
      channel: 'NEFT',
      complaint_id: c1,
      hop_depth: 1,
      is_flagged_fraud: true,
      remarks: 'Initial coerced tranche 2',
    },
    {
      txn_id: 'TXN-C1-003',
      from_account: vAcc1.id,
      to_account: s2Hop1C.id,
      amount: 350000,
      timestamp: hoursAgo(17.5),
      channel: 'IMPS',
      complaint_id: c1,
      hop_depth: 1,
      is_flagged_fraud: true,
      remarks: 'Initial coerced tranche 3',
    },
    {
      txn_id: 'TXN-C1-004',
      from_account: s2Hop1A.id,
      to_account: s2Hop2A.id,
      amount: 320000,
      timestamp: hoursAgo(17.1),
      channel: 'IMPS',
      complaint_id: c1,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Layering hop 2 split A->2A',
    },
    {
      txn_id: 'TXN-C1-005',
      from_account: s2Hop1A.id,
      to_account: s2Hop2B.id,
      amount: 310000,
      timestamp: hoursAgo(16.9),
      channel: 'IMPS',
      complaint_id: c1,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Layering hop 2 split A->2B',
    },
    {
      txn_id: 'TXN-C1-006',
      from_account: s2Hop1B.id,
      to_account: s2Hop2B.id,
      amount: 435000,
      timestamp: hoursAgo(16.6),
      channel: 'UPI',
      complaint_id: c1,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Layering hop 2 fan-in to 2B',
    },
    {
      txn_id: 'TXN-C1-007',
      from_account: s2Hop1C.id,
      to_account: s2Hop2C.id,
      amount: 340000,
      timestamp: hoursAgo(16.3),
      channel: 'NEFT',
      complaint_id: c1,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Layering hop 2 to shell C',
    },
    {
      txn_id: 'TXN-C1-008',
      from_account: s2Hop2A.id,
      to_account: s2Hop3Cons.id,
      amount: 305000,
      timestamp: hoursAgo(15.6),
      channel: 'IMPS',
      complaint_id: c1,
      hop_depth: 3,
      is_flagged_fraud: true,
      remarks: 'Consolidation hop 3',
    },
    {
      txn_id: 'TXN-C1-009',
      from_account: s2Hop2B.id,
      to_account: s2Hop3Cons.id,
      amount: 720000,
      timestamp: hoursAgo(15.2),
      channel: 'RTGS',
      complaint_id: c1,
      hop_depth: 3,
      is_flagged_fraud: true,
      remarks: 'Consolidation hop 3 major tranche',
    },
    {
      txn_id: 'TXN-C1-010',
      from_account: s2Hop3Cons.id,
      to_account: s2Hop1C.id,
      amount: 145000,
      timestamp: hoursAgo(14.8),
      channel: 'IMPS',
      complaint_id: c1,
      hop_depth: 4,
      is_flagged_fraud: true,
      remarks: 'Cyclic wash/bounce transaction back to hop-1 shell',
    }
  );

  // --- Scenario 3: Rapid Mule Receive-and-Forward (CMP-2026-0002) ---
  const c2 = complaints[1].id;
  transactions.push(
    {
      txn_id: 'TXN-C2-001',
      from_account: vAcc2.id,
      to_account: s3MuleHub.id,
      amount: 310000,
      timestamp: minsAgo(590),
      channel: 'UPI',
      complaint_id: c2,
      hop_depth: 1,
      is_flagged_fraud: true,
      remarks: 'UPI phishing inflow 1 into mule hub',
    },
    {
      txn_id: 'TXN-C2-002',
      from_account: vAcc2.id,
      to_account: s3MuleHub.id,
      amount: 310000,
      timestamp: minsAgo(585),
      channel: 'IMPS',
      complaint_id: c2,
      hop_depth: 1,
      is_flagged_fraud: true,
      remarks: 'UPI phishing inflow 2 into mule hub',
    },
    {
      txn_id: 'TXN-C2-003',
      from_account: s3SrcAlt.id,
      to_account: s3MuleHub.id,
      amount: 190000,
      timestamp: minsAgo(582),
      channel: 'IMPS',
      complaint_id: c2,
      hop_depth: 1,
      is_flagged_fraud: true,
      remarks: 'Second compromised source fan-in to mule hub',
    },
    {
      txn_id: 'TXN-C2-004',
      from_account: s3MuleHub.id,
      to_account: s3Out1.id,
      amount: 280000,
      timestamp: minsAgo(576),
      channel: 'IMPS',
      complaint_id: c2,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Rapid pass-through (9 min latency)',
    },
    {
      txn_id: 'TXN-C2-005',
      from_account: s3MuleHub.id,
      to_account: s3Out2.id,
      amount: 265000,
      timestamp: minsAgo(572),
      channel: 'WALLET',
      complaint_id: c2,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Rapid pass-through to digital wallet (13 min latency)',
    },
    {
      txn_id: 'TXN-C2-006',
      from_account: s3MuleHub.id,
      to_account: s3Out3.id,
      amount: 235000,
      timestamp: minsAgo(566),
      channel: 'UPI',
      complaint_id: c2,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Rapid pass-through (19 min latency)',
    }
  );

  // --- Scenario 4: Suspicious Account Followed by ATM Cash-Out (CMP-2026-0003) ---
  const c3 = complaints[2].id;
  transactions.push(
    {
      txn_id: 'TXN-C3-001',
      from_account: vAcc3.id,
      to_account: s4Layer.id,
      amount: 980000,
      timestamp: hoursAgo(25.5),
      channel: 'RTGS',
      complaint_id: c3,
      hop_depth: 1,
      is_flagged_fraud: true,
      remarks: 'Investment scam deposit into unverified trading desk',
    },
    {
      txn_id: 'TXN-C3-002',
      from_account: s4Layer.id,
      to_account: s4Cashout.id,
      amount: 485000,
      timestamp: hoursAgo(24.9),
      channel: 'IMPS',
      complaint_id: c3,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Cash-out mule funding tranche 1',
    },
    {
      txn_id: 'TXN-C3-003',
      from_account: s4Layer.id,
      to_account: s4Cashout.id,
      amount: 460000,
      timestamp: hoursAgo(24.6),
      channel: 'IMPS',
      complaint_id: c3,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Cash-out mule funding tranche 2',
    }
  );

  // --- Scenario 5: Active Pre-Cashout Network with Multiple Candidate ATMs (CMP-2026-0004) ---
  const c4 = complaints[3].id;
  transactions.push(
    {
      txn_id: 'TXN-C4-001',
      from_account: vAcc4.id,
      to_account: s5Layer1.id,
      amount: 475000,
      timestamp: minsAgo(140),
      channel: 'IMPS',
      complaint_id: c4,
      hop_depth: 1,
      is_flagged_fraud: true,
      remarks: 'OTP hijack drain into intermediate wallet',
    },
    {
      txn_id: 'TXN-C4-002',
      from_account: s5Layer1.id,
      to_account: s5CashA.id,
      amount: 215000,
      timestamp: minsAgo(115),
      channel: 'IMPS',
      complaint_id: c4,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Active pre-cashout allocation to Indiranagar candidate',
    },
    {
      txn_id: 'TXN-C4-003',
      from_account: s5Layer1.id,
      to_account: s5CashB.id,
      amount: 160000,
      timestamp: minsAgo(95),
      channel: 'UPI',
      complaint_id: c4,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Active pre-cashout allocation to MG Road candidate',
    },
    {
      txn_id: 'TXN-C4-004',
      from_account: s5Layer1.id,
      to_account: s5CashC.id,
      amount: 92000,
      timestamp: minsAgo(75),
      channel: 'IMPS',
      complaint_id: c4,
      hop_depth: 2,
      is_flagged_fraud: true,
      remarks: 'Active pre-cashout allocation to Whitefield candidate',
    }
  );

  // 9. ATM Withdrawals (Normal baseline + Scenario 4 ground-truth cash-out + historical cluster for Scenario 5)
  const atmWithdrawals: AtmWithdrawalSeed[] = [];

  // Routine withdrawals for normal accounts
  for (let i = 0; i < 36; i++) {
    const acc = normalAccounts[i % normalAccounts.length];
    const atm = atms[(i * 3) % atms.length];
    atmWithdrawals.push({
      id: deterministicUuid(`wd-norm-${i}`),
      atm_id: atm.id,
      account_id: acc.id,
      complaint_id: null,
      amount: (1 + Math.floor(rand() * 8)) * 2000,
      withdrawn_at: hoursAgo(12 + rand() * 240),
      card_last4: String(4000 + (i * 137) % 5999),
      is_flagged_cashout: false,
    });
  }

  // Scenario 4 flagged ATM cash-out events in Koramangala & Silk Board
  atmWithdrawals.push(
    {
      id: deterministicUuid('wd-c3-1'),
      atm_id: 'ATM-BLR-001',
      account_id: s4Cashout.id,
      complaint_id: c3,
      amount: 100000,
      withdrawn_at: hoursAgo(23.5),
      card_last4: '8841',
      is_flagged_cashout: true,
    },
    {
      id: deterministicUuid('wd-c3-2'),
      atm_id: 'ATM-BLR-002',
      account_id: s4Cashout.id,
      complaint_id: c3,
      amount: 95000,
      withdrawn_at: hoursAgo(23.1),
      card_last4: '8841',
      is_flagged_cashout: true,
    }
  );

  // Historical baseline withdrawals for Scenario 5 cash-out candidates (used as spatial cluster signal)
  atmWithdrawals.push(
    {
      id: deterministicUuid('wd-c4-hist-1'),
      atm_id: 'ATM-BLR-004',
      account_id: s5CashA.id,
      complaint_id: null,
      amount: 25000,
      withdrawn_at: hoursAgo(96),
      card_last4: '3109',
      is_flagged_cashout: false,
    },
    {
      id: deterministicUuid('wd-c4-hist-2'),
      atm_id: 'ATM-BLR-005',
      account_id: s5CashA.id,
      complaint_id: null,
      amount: 30000,
      withdrawn_at: hoursAgo(52),
      card_last4: '3109',
      is_flagged_cashout: false,
    },
    {
      id: deterministicUuid('wd-c4-hist-3'),
      atm_id: 'ATM-BLR-006',
      account_id: s5CashB.id,
      complaint_id: null,
      amount: 20000,
      withdrawn_at: hoursAgo(72),
      card_last4: '7724',
      is_flagged_cashout: false,
    }
  );

  // 10. Suspicious Accounts
  const analystId = users[1].id;
  const suspiciousAccounts: SuspiciousAccountSeed[] = [
    {
      id: deterministicUuid('susp-s2-h1a'),
      account_id: s2Hop1A.id,
      complaint_id: c1,
      classification: 'LAYERING_NODE',
      mule_probability: 0.89,
      score_source: 'Synthetic demo result',
      reason: 'Unverified current account receiving INR 6.5L coerced RTGS and splitting within 48 min.',
      flagged_by: analystId,
      status: 'ACTIVE',
    },
    {
      id: deterministicUuid('susp-s2-h3'),
      account_id: s2Hop3Cons.id,
      complaint_id: c1,
      classification: 'CASH_OUT_CANDIDATE',
      mule_probability: 0.94,
      score_source: 'Synthetic demo result',
      reason: 'Consolidation node aggregating INR 10.25L across 3 hops with cyclic wash edge.',
      flagged_by: analystId,
      status: 'ACTIVE',
    },
    {
      id: deterministicUuid('susp-s3-mule'),
      account_id: s3MuleHub.id,
      complaint_id: c2,
      classification: 'SUSPECTED_MULE',
      mule_probability: 0.96,
      score_source: 'Synthetic demo result',
      reason: 'Account age 14 days, unverified KYC, 96.3% pass-through within 19 minutes across 3 recipients.',
      flagged_by: analystId,
      status: 'ACTIVE',
    },
    {
      id: deterministicUuid('susp-s4-cash'),
      account_id: s4Cashout.id,
      complaint_id: c3,
      classification: 'CASH_OUT_CANDIDATE',
      mule_probability: 0.98,
      score_source: 'Synthetic demo result',
      reason: 'Confirmed post-transfer structured ATM cash-outs in Koramangala & Silk Board; account frozen.',
      flagged_by: analystId,
      status: 'FROZEN',
    },
    {
      id: deterministicUuid('susp-s5-casha'),
      account_id: s5CashA.id,
      complaint_id: c4,
      classification: 'CASH_OUT_CANDIDATE',
      mule_probability: 0.91,
      score_source: 'Synthetic demo result',
      reason: 'Received INR 2.15L stolen OTP-hijack funds 115 min ago; prior ATM cluster at Indiranagar Metro.',
      flagged_by: analystId,
      status: 'ACTIVE',
    },
    {
      id: deterministicUuid('susp-s5-cashb'),
      account_id: s5CashB.id,
      complaint_id: c4,
      classification: 'CASH_OUT_CANDIDATE',
      mule_probability: 0.84,
      score_source: 'Synthetic demo result',
      reason: 'Received INR 1.60L stolen funds 95 min ago; branch & historical withdrawal near MG Road.',
      flagged_by: analystId,
      status: 'ACTIVE',
    },
    {
      id: deterministicUuid('susp-s5-cashc'),
      account_id: s5CashC.id,
      complaint_id: c4,
      classification: 'LAYERING_NODE',
      mule_probability: 0.72,
      score_source: 'Synthetic demo result',
      reason: 'Downstream Whitefield node holding INR 92,000 from active OTP hijack trace.',
      flagged_by: analystId,
      status: 'ACTIVE',
    },
  ];

  // 11. Initial ATM Predictions for Scenario 5 (Multiple Candidate ATMs with Different Risk Scores)
  const limitationsNote =
    'Weighted heuristic/ML risk score on synthetic data — NOT a calibrated probability of withdrawal. Predictions depend on observed branch/historical ATM centroids and may miss travel outside Bengaluru.';

  const atmPredictions: AtmPredictionSeed[] = [
    {
      id: deterministicUuid('atmpred-c4-1'),
      atm_id: 'ATM-BLR-004',
      complaint_id: c4,
      risk_score: 91.4,
      risk_level: 'Critical',
      window: '0-6h',
      confidence: 'High',
      score_source: 'Synthetic demo result',
      linked_accounts_json: [
        { account_id: s5CashA.id, account_number: s5CashA.account_number, role: 'CASH_OUT_CANDIDATE' },
      ],
      relevant_paths_json: [
        { path: [vAcc4.account_number, s5Layer1.account_number, s5CashA.account_number], total_amount: 215000 },
      ],
      explanation_json: {
        plain_language:
          'Highest risk cash-out terminal: 0.11 km from candidate account branch and historical withdrawal centroid in Indiranagar, 24x7 high-capacity ATM, recent inflow < 2 hours.',
        factors: [
          { factor: 'Spatial Proximity to Candidate Centroid', weight: 0.28, value: '0.11 km', contribution: 27.1 },
          { factor: 'Inflow Recency & Velocity', weight: 0.24, value: '115 min ago', contribution: 22.8 },
          { factor: 'Mule / Cash-Out Account Score', weight: 0.22, value: '0.91', contribution: 20.0 },
          { factor: 'Historical ATM Cluster Match', weight: 0.16, value: '2 prior hits', contribution: 13.5 },
          { factor: 'ATM Capacity & 24x7 Availability', weight: 0.10, value: 'HIGH / 24x7', contribution: 8.0 },
        ],
      },
      limitations_text: limitationsNote,
      model_version: 'seed-v1.0',
      rank_order: 1,
    },
    {
      id: deterministicUuid('atmpred-c4-2'),
      atm_id: 'ATM-BLR-005',
      complaint_id: c4,
      risk_score: 83.2,
      risk_level: 'Critical',
      window: '0-6h',
      confidence: 'High',
      score_source: 'Synthetic demo result',
      linked_accounts_json: [
        { account_id: s5CashA.id, account_number: s5CashA.account_number, role: 'CASH_OUT_CANDIDATE' },
      ],
      relevant_paths_json: [
        { path: [vAcc4.account_number, s5Layer1.account_number, s5CashA.account_number], total_amount: 215000 },
      ],
      explanation_json: {
        plain_language:
          'Secondary Indiranagar CMH Road ATM within 300m of candidate A centroid with prior withdrawal record.',
        factors: [
          { factor: 'Spatial Proximity to Candidate Centroid', weight: 0.28, value: '0.28 km', contribution: 25.4 },
          { factor: 'Inflow Recency & Velocity', weight: 0.24, value: '115 min ago', contribution: 22.0 },
          { factor: 'Mule / Cash-Out Account Score', weight: 0.22, value: '0.91', contribution: 19.6 },
          { factor: 'Historical ATM Cluster Match', weight: 0.16, value: '1 prior hit', contribution: 10.2 },
          { factor: 'ATM Capacity & 24x7 Availability', weight: 0.10, value: 'MEDIUM / 24x7', contribution: 6.0 },
        ],
      },
      limitations_text: limitationsNote,
      model_version: 'seed-v1.0',
      rank_order: 2,
    },
    {
      id: deterministicUuid('atmpred-c4-3'),
      atm_id: 'ATM-BLR-006',
      complaint_id: c4,
      risk_score: 76.8,
      risk_level: 'High',
      window: '6-12h',
      confidence: 'Moderate',
      score_source: 'Synthetic demo result',
      linked_accounts_json: [
        { account_id: s5CashB.id, account_number: s5CashB.account_number, role: 'CASH_OUT_CANDIDATE' },
      ],
      relevant_paths_json: [
        { path: [vAcc4.account_number, s5Layer1.account_number, s5CashB.account_number], total_amount: 160000 },
      ],
      explanation_json: {
        plain_language:
          'MG Road Trinity Circle high-capacity ATM linked to Candidate B (INR 1.60L inflow 95 min ago).',
        factors: [
          { factor: 'Spatial Proximity to Candidate Centroid', weight: 0.28, value: '0.59 km', contribution: 22.4 },
          { factor: 'Inflow Recency & Velocity', weight: 0.24, value: '95 min ago', contribution: 21.6 },
          { factor: 'Mule / Cash-Out Account Score', weight: 0.22, value: '0.84', contribution: 18.2 },
          { factor: 'Historical ATM Cluster Match', weight: 0.16, value: '1 prior hit', contribution: 6.6 },
          { factor: 'ATM Capacity & 24x7 Availability', weight: 0.10, value: 'HIGH / 24x7', contribution: 8.0 },
        ],
      },
      limitations_text: limitationsNote,
      model_version: 'seed-v1.0',
      rank_order: 3,
    },
    {
      id: deterministicUuid('atmpred-c4-4'),
      atm_id: 'ATM-BLR-008',
      complaint_id: c4,
      risk_score: 58.5,
      risk_level: 'Medium',
      window: '12-24h',
      confidence: 'Moderate',
      score_source: 'Synthetic demo result',
      linked_accounts_json: [
        { account_id: s5CashC.id, account_number: s5CashC.account_number, role: 'LAYERING_NODE' },
      ],
      relevant_paths_json: [
        { path: [vAcc4.account_number, s5Layer1.account_number, s5CashC.account_number], total_amount: 92000 },
      ],
      explanation_json: {
        plain_language:
          'Whitefield ITPL ATM near Candidate C branch; smaller tranche (INR 92k) and no prior withdrawal cluster.',
        factors: [
          { factor: 'Spatial Proximity to Candidate Centroid', weight: 0.28, value: '0.30 km', contribution: 23.0 },
          { factor: 'Inflow Recency & Velocity', weight: 0.24, value: '75 min ago', contribution: 16.5 },
          { factor: 'Mule / Cash-Out Account Score', weight: 0.22, value: '0.72', contribution: 11.0 },
          { factor: 'Historical ATM Cluster Match', weight: 0.16, value: '0 prior hits', contribution: 0.0 },
          { factor: 'ATM Capacity & 24x7 Availability', weight: 0.10, value: 'HIGH / 24x7', contribution: 8.0 },
        ],
      },
      limitations_text: limitationsNote,
      model_version: 'seed-v1.0',
      rank_order: 4,
    },
    {
      id: deterministicUuid('atmpred-c4-5'),
      atm_id: 'ATM-BLR-009',
      complaint_id: c4,
      risk_score: 36.2,
      risk_level: 'Low',
      window: '>24h',
      confidence: 'Low',
      score_source: 'Synthetic demo result',
      linked_accounts_json: [
        { account_id: s5CashC.id, account_number: s5CashC.account_number, role: 'LAYERING_NODE' },
      ],
      relevant_paths_json: [
        { path: [vAcc4.account_number, s5Layer1.account_number, s5CashC.account_number], total_amount: 92000 },
      ],
      explanation_json: {
        plain_language:
          'Peripheral ORR Marathahalli ATM along transit corridor from Whitefield; lower direct spatial weight.',
        factors: [
          { factor: 'Spatial Proximity to Candidate Centroid', weight: 0.28, value: '4.9 km', contribution: 9.2 },
          { factor: 'Inflow Recency & Velocity', weight: 0.24, value: '75 min ago', contribution: 11.0 },
          { factor: 'Mule / Cash-Out Account Score', weight: 0.22, value: '0.72', contribution: 8.0 },
          { factor: 'Historical ATM Cluster Match', weight: 0.16, value: '0 prior hits', contribution: 0.0 },
          { factor: 'ATM Capacity & 24x7 Availability', weight: 0.10, value: 'HIGH / 24x7', contribution: 8.0 },
        ],
      },
      limitations_text: limitationsNote,
      model_version: 'seed-v1.0',
      rank_order: 5,
    },
  ];

  // 12. Alerts
  const alerts: AlertSeed[] = [
    {
      id: deterministicUuid('alert-1'),
      complaint_id: c4,
      account_id: s5CashA.id,
      atm_id: 'ATM-BLR-004',
      alert_type: 'CASH_OUT_IMMINENT',
      severity: 'Critical',
      status: 'OPEN',
      title: 'Imminent Cash-Out Risk at Indiranagar Metro ATM (0-6h)',
      description:
        'CMP-2026-0004: Candidate account SYN500002001 received INR 2.15L from OTP hijack trace; ATM-BLR-004 scored 91.4/100.',
      score_source: 'Synthetic demo result',
    },
    {
      id: deterministicUuid('alert-2'),
      complaint_id: c2,
      account_id: s3MuleHub.id,
      atm_id: null,
      alert_type: 'MULE_BURST',
      severity: 'High',
      status: 'ACKNOWLEDGED',
      title: 'High-Velocity Mule Pass-Through Detected (SYNMULE00100)',
      description:
        'CMP-2026-0002: 96.3% of INR 8.10L total inflows forwarded within 19 minutes across 3 beneficiary accounts.',
      score_source: 'Synthetic demo result',
    },
    {
      id: deterministicUuid('alert-3'),
      complaint_id: c1,
      account_id: s2Hop3Cons.id,
      atm_id: null,
      alert_type: 'LAYERING_CYCLE',
      severity: 'High',
      status: 'OPEN',
      title: '3-Hop Layering & Cyclic Bounce Detected',
      description:
        'CMP-2026-0001: INR 14.50L coerced transfer consolidated into SYN200003001 with cyclic return edge TXN-C1-010.',
      score_source: 'Synthetic demo result',
    },
    {
      id: deterministicUuid('alert-4'),
      complaint_id: c3,
      account_id: s4Cashout.id,
      atm_id: 'ATM-BLR-001',
      alert_type: 'HIGH_VALUE_HOP',
      severity: 'Medium',
      status: 'RESOLVED',
      title: 'Structured ATM Cash-Out Recorded & Account Frozen',
      description:
        'CMP-2026-0003: INR 1.95L withdrawn across ATM-BLR-001 & ATM-BLR-002 before nodal freeze execution.',
      score_source: 'Synthetic demo result',
    },
  ];

  // 13. Investigations
  const investigations: InvestigationSeed[] = [
    {
      id: deterministicUuid('invst-1'),
      case_number: 'INV-BLR-2026-01',
      complaint_id: c1,
      lead_investigator: invKavyaId,
      status: 'FREEZE_REQUESTED',
      findings_summary: 'Three hop-1 shell accounts and consolidator Tarun Nair identified across 10 synthetic edges.',
      recommended_actions: [
        'Issue lien/freeze request on SYN200003001',
        'Run ML mule scoring across hop-2 beneficiaries',
        'Forecast consolidation ATM corridors in Whitefield/MG Road',
      ],
    },
    {
      id: deterministicUuid('invst-2'),
      case_number: 'INV-BLR-2026-02',
      complaint_id: c2,
      lead_investigator: invRohanId,
      status: 'ACTIVE_TRACE',
      findings_summary: 'Central mule hub SYNMULE00100 flagged for 19-minute pass-through across 3 recipient nodes.',
      recommended_actions: [
        'Trace downstream wallets SYN300002001..2003',
        'Verify KYC authenticity with Apex Digital Payments nodal officer',
      ],
    },
    {
      id: deterministicUuid('invst-3'),
      case_number: 'INV-BLR-2026-03',
      complaint_id: c3,
      lead_investigator: invRohanId,
      status: 'CLOSED',
      findings_summary: 'Post-withdrawal audit confirms Koramangala/Silk Board ATM withdrawals; remaining INR 7.5L frozen.',
      recommended_actions: ['Preserve synthetic ATM CCTV reference log', 'Close case after lien confirmation'],
    },
    {
      id: deterministicUuid('invst-4'),
      case_number: 'INV-BLR-2026-04',
      complaint_id: c4,
      lead_investigator: invMeeraId,
      status: 'ATM_SURVEILLANCE',
      findings_summary: 'Active 0-6h cash-out alert centered on Indiranagar Metro & CMH Road ATMs.',
      recommended_actions: [
        'Alert nodal officer to hold SYN500002001 & SYN500002002',
        'Monitor Indiranagar / MG Road ATM corridors for 0-6h window',
      ],
    },
  ];

  // 14. Evidence Records
  const hashOf = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

  const evidenceRecords: EvidenceSeed[] = [
    {
      id: deterministicUuid('ev-1'),
      investigation_id: investigations[0].id,
      complaint_id: c1,
      uploaded_by: users[1].id,
      evidence_type: 'NPCI_REF',
      title: 'Synthetic RTGS/IMPS Trace Log — CMP-2026-0001',
      description: 'Compiled synthetic UTR trail covering TXN-C1-001 through TXN-C1-010.',
      file_name: 'cmp_2026_0001_utr_trace.csv',
      sha256_hash: hashOf('cmp_2026_0001_utr_trace.csv'),
      metadata_json: { hops: 4, total_amount: 1450000, is_synthetic: true },
    },
    {
      id: deterministicUuid('ev-2'),
      investigation_id: investigations[2].id,
      complaint_id: c3,
      uploaded_by: users[4].id,
      evidence_type: 'ATM_CCTV_NOTE',
      title: 'Koramangala ATM-BLR-001 Synthetic Withdrawal Receipt',
      description: 'Synthetic bank nodal confirmation of INR 1,00,000 structured cash-out prior to account freeze.',
      file_name: 'atm_blr_001_nodal_note.pdf',
      sha256_hash: hashOf('atm_blr_001_nodal_note.pdf'),
      metadata_json: { atm_id: 'ATM-BLR-001', card_last4: '8841', is_synthetic: true },
    },
    {
      id: deterministicUuid('ev-3'),
      investigation_id: investigations[3].id,
      complaint_id: c4,
      uploaded_by: users[3].id,
      evidence_type: 'BANK_STATEMENT_CSV',
      title: 'Indiranagar Candidate Account Statement Extract',
      description: 'Synthetic inflow ledger confirming INR 2.15L credit to SYN500002001.',
      file_name: 'syn500002001_extract.csv',
      sha256_hash: hashOf('syn500002001_extract.csv'),
      metadata_json: { account_number: 'SYN500002001', is_synthetic: true },
    },
  ];

  return {
    roles,
    institutions,
    users,
    victims,
    accounts,
    atms,
    complaints,
    transactions,
    atmWithdrawals,
    suspiciousAccounts,
    atmPredictions,
    alerts,
    investigations,
    evidenceRecords,
  };
}
