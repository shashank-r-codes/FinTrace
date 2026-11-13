/**
 * Dedicated Citizen DTO Serializer & Status Mapper
 *
 * Strictly whitelists ONLY citizen-safe fields so internal intelligence
 * (mule scores, ML predictions, suspicious accounts, ATM forecasts, network graphs,
 * internal officer notes, investigator PII, and audit logs) is never leaked.
 */

export type CitizenStatus =
  | 'Submitted'
  | 'Under Review'
  | 'Assigned to Investigator'
  | 'Investigation in Progress'
  | 'Action Taken / Closed';

export type OfficerComplaintStatus =
  | 'REGISTERED'
  | 'TRACING'
  | 'MULE_IDENTIFIED'
  | 'ATM_ALERTED'
  | 'CONTAINED'
  | 'CLOSED';

export function mapOfficerStatusToCitizenStatus(
  status: OfficerComplaintStatus,
  hasAssignedInvestigator: boolean
): CitizenStatus {
  if (status === 'CONTAINED' || status === 'CLOSED') {
    return 'Action Taken / Closed';
  }
  if (status === 'MULE_IDENTIFIED' || status === 'ATM_ALERTED') {
    return 'Investigation in Progress';
  }
  if (status === 'TRACING') {
    return hasAssignedInvestigator ? 'Assigned to Investigator' : 'Under Review';
  }
  return hasAssignedInvestigator ? 'Assigned to Investigator' : 'Submitted';
}

export function maskAccountNumber(raw: string | null | undefined): string {
  if (!raw) return 'Not provided';
  const clean = raw.trim();
  if (clean.length <= 4) return 'XXXX';
  return `${'X'.repeat(Math.max(4, clean.length - 4))}${clean.slice(-4)}`;
}

export function maskPhoneNumber(raw: string | null | undefined): string {
  if (!raw) return 'N/A';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4) {
    return `+91-${digits.slice(0, 2) || '9X'}XXX-XX${digits.slice(-3)}`;
  }
  return raw;
}

export interface CitizenComplaintSummaryDto {
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

export interface CitizenDisputedTxnDto {
  txn_id: string;
  date: string;
  amount: number;
  channel: string;
  beneficiary_account_masked: string;
  beneficiary_bank: string | null;
}

export interface CitizenStatusHistoryDto {
  id: string;
  citizen_status: CitizenStatus;
  public_remark: string | null;
  changed_at: string;
}

export interface CitizenDocumentDto {
  id: string;
  title: string;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  uploaded_at: string;
}

export interface CitizenComplaintDetailDto extends CitizenComplaintSummaryDto {
  disputed_transactions: CitizenDisputedTxnDto[];
  status_history: CitizenStatusHistoryDto[];
  documents: CitizenDocumentDto[];
}

export function toCitizenComplaintSummaryDto(row: {
  id: string;
  reference_no: string;
  fraud_type: string;
  reported_amount: number | string;
  currency?: string;
  incident_timestamp: Date | string;
  reported_at: Date | string;
  citizen_status: CitizenStatus | string;
  summary: string;
  city: string;
  victim_bank_name?: string | null;
  victim_account_masked?: string | null;
  assigned_to?: string | null;
  transaction_count?: number;
  document_count?: number;
  updated_at?: Date | string;
}): CitizenComplaintSummaryDto {
  const assigned = Boolean(row.assigned_to);
  const toIso = (d: Date | string | undefined) =>
    d instanceof Date ? d.toISOString() : String(d ?? new Date().toISOString());

  return {
    id: String(row.id),
    reference_no: String(row.reference_no),
    fraud_type: String(row.fraud_type),
    reported_amount: Number(row.reported_amount),
    currency: row.currency ?? 'INR',
    incident_timestamp: toIso(row.incident_timestamp),
    reported_at: toIso(row.reported_at),
    citizen_status: (row.citizen_status as CitizenStatus) ?? 'Submitted',
    summary: String(row.summary),
    city: String(row.city),
    victim_bank_name: row.victim_bank_name ?? null,
    victim_account_masked: row.victim_account_masked ?? null,
    is_investigator_assigned: assigned,
    assignment_label: assigned ? 'Assigned to an investigator' : 'Pending investigator assignment',
    transaction_count: Number(row.transaction_count ?? 0),
    document_count: Number(row.document_count ?? 0),
    updated_at: toIso(row.updated_at ?? row.reported_at),
  };
}

export function toCitizenComplaintDetailDto(
  row: Parameters<typeof toCitizenComplaintSummaryDto>[0],
  txns: Array<{
    txn_id: string;
    timestamp: Date | string;
    amount: number | string;
    channel: string;
    to_account_number?: string;
    beneficiary_account_masked?: string;
    beneficiary_bank?: string | null;
  }>,
  history: Array<{
    id: string;
    citizen_status: CitizenStatus | string;
    public_remark?: string | null;
    changed_at: Date | string;
  }>,
  documents: Array<{
    id: string;
    title: string;
    file_name: string | null;
    mime_type?: string | null;
    file_size?: number | null;
    recorded_at: Date | string;
  }>
): CitizenComplaintDetailDto {
  const base = toCitizenComplaintSummaryDto(row);
  const toIso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d));

  return {
    ...base,
    transaction_count: txns.length,
    document_count: documents.length,
    disputed_transactions: txns.map((t) => ({
      txn_id: String(t.txn_id),
      date: toIso(t.timestamp),
      amount: Number(t.amount),
      channel: String(t.channel),
      beneficiary_account_masked:
        t.beneficiary_account_masked ?? maskAccountNumber(t.to_account_number ?? ''),
      beneficiary_bank: t.beneficiary_bank ?? null,
    })),
    status_history: history.map((h) => ({
      id: String(h.id),
      citizen_status: (h.citizen_status as CitizenStatus) ?? 'Submitted',
      public_remark: h.public_remark ?? null,
      changed_at: toIso(h.changed_at),
    })),
    documents: documents.map((d) => ({
      id: String(d.id),
      title: String(d.title),
      file_name: d.file_name ?? null,
      mime_type: d.mime_type ?? null,
      file_size: d.file_size !== null && d.file_size !== undefined ? Number(d.file_size) : null,
      uploaded_at: toIso(d.recorded_at),
    })),
  };
}
