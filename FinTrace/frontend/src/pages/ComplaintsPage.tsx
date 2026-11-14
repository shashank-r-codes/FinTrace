import { Eye, Plus, Search, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { ScoreSourceBadge } from '../components/common/ScoreSourceBadge';
import { StatusSignal } from '../components/common/StatusSignal';
import { CommandLayout } from '../components/layout/CommandLayout';
import { useAuth } from '../context/AuthContext';
import {
  ApiSuccessResponse,
  AtmPredictionRow,
  ComplaintPriority,
  ComplaintStatus,
  ComplaintStatusHistoryRow,
  ComplaintSummary,
  ComplaintTransactionRow,
  FraudType,
  InvestigatorOption,
  SuspiciousAccountRow,
} from '../types';
import { formatFraudType, formatInr, formatTimestamp } from '../utils/formatters';

interface ComplaintDetailData {
  complaint: ComplaintSummary & {
    victim_email: string | null;
    victim_city: string;
    victim_state: string;
    investigator_badge: string | null;
  };
  transactions: ComplaintTransactionRow[];
  suspiciousAccounts: SuspiciousAccountRow[];
  atmPredictions: AtmPredictionRow[];
  statusHistory?: ComplaintStatusHistoryRow[];
}

const FRAUD_TYPES: FraudType[] = [
  'DIGITAL_ARREST',
  'UPI_PHISHING',
  'INVESTMENT_SCAM',
  'OTP_HIJACK',
  'CARD_SKIMMING',
  'LOAN_APP_FRAUD',
  'OTHER',
];

const COMPLAINT_STATUSES: ComplaintStatus[] = [
  'REGISTERED',
  'TRACING',
  'MULE_IDENTIFIED',
  'ATM_ALERTED',
  'CONTAINED',
  'CLOSED',
];

const PRIORITIES: ComplaintPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function ComplaintsPage() {
  const { hasRole } = useAuth();
  const canCreateOrEdit = hasRole('Administrator', 'Senior Investigator', 'Investigator');

  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [investigators, setInvestigators] = useState<InvestigatorOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [fraudFilter, setFraudFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [victimName, setVictimName] = useState('');
  const [victimPhone, setVictimPhone] = useState('+91-98XXXXXX10');
  const [victimEmail, setVictimEmail] = useState('');
  const [victimCity, setVictimCity] = useState('Bengaluru');
  const [victimState, setVictimState] = useState('Karnataka');
  const [fraudType, setFraudType] = useState<FraudType>('UPI_PHISHING');
  const [reportedAmount, setReportedAmount] = useState('250000');
  const [incidentTimestamp, setIncidentTimestamp] = useState(() =>
    new Date().toISOString().slice(0, 16)
  );
  const [priority, setPriority] = useState<ComplaintPriority>('HIGH');
  const [assignedTo, setAssignedTo] = useState('');
  const [summary, setSummary] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ComplaintDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusUpdateLoading, setStatusUpdateLoading] = useState(false);
  const [nextStatus, setNextStatus] = useState<ComplaintStatus>('TRACING');
  const [nextAssignedTo, setNextAssignedTo] = useState<string>('');
  const [publicRemark, setPublicRemark] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const fetchComplaints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (fraudFilter) params.set('fraudType', fraudFilter);

      const res = await apiRequest<ApiSuccessResponse<ComplaintSummary[]>>(
        `/complaints?${params.toString()}`
      );
      setComplaints(res.data);
      setTotal(res.pagination?.total ?? res.data.length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to fetch complaints.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, priorityFilter, fraudFilter]);

  useEffect(() => {
    void fetchComplaints();
  }, [fetchComplaints]);

  useEffect(() => {
    apiRequest<ApiSuccessResponse<InvestigatorOption[]>>('/users/investigators')
      .then((res) => setInvestigators(res.data))
      .catch(() => setInvestigators([]));
  }, []);

  const openComplaintDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const res = await apiRequest<ApiSuccessResponse<ComplaintDetailData>>(`/complaints/${id}`);
      setDetail(res.data);
      setNextStatus(res.data.complaint.status);
      setNextAssignedTo(res.data.complaint.investigator_id ?? '');
      setPublicRemark('');
      setInternalNote('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load complaint detail.');
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiRequest('/complaints', {
        method: 'POST',
        body: {
          victim: {
            fullName: victimName.trim(),
            phoneMasked: victimPhone.trim(),
            email: victimEmail.trim() || undefined,
            city: victimCity.trim(),
            state: victimState.trim(),
          },
          fraudType,
          reportedAmount: Number(reportedAmount),
          incidentTimestamp: new Date(incidentTimestamp).toISOString(),
          priority,
          summary: summary.trim(),
          city: victimCity.trim(),
          assignedTo: assignedTo || null,
          openInvestigation: true,
        },
      });
      setCreateOpen(false);
      setVictimName('');
      setVictimEmail('');
      setSummary('');
      await fetchComplaints();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to register complaint.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusUpdate = async () => {
    if (!selectedId) return;
    setStatusUpdateLoading(true);
    try {
      await apiRequest(`/complaints/${selectedId}/status`, {
        method: 'PATCH',
        body: {
          status: nextStatus,
          assignedTo: nextAssignedTo || null,
          publicRemark: publicRemark.trim() || undefined,
          internalNote: internalNote.trim() || undefined,
        },
      });
      await openComplaintDetail(selectedId);
      await fetchComplaints();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Status update failed.');
    } finally {
      setStatusUpdateLoading(false);
    }
  };

  return (
    <CommandLayout
      title="Complaints registry"
      section="Core operations"
      actions={
        canCreateOrEdit ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong-hover whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-120"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Register complaint
          </button>
        ) : null
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void fetchComplaints()} /> : null}

      {/* Filter Bar */}
      <section className="rounded-[12px] border border-border-subtle bg-card p-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2 relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search case ID, victim name, or summary..."
              className="w-full rounded-[8px] border border-border-subtle bg-app pl-8 pr-3 py-1.5 text-xs text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none transition-colors"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by complaint status"
            className="rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
          >
            <option value="">All statuses</option>
            {COMPLAINT_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            aria-label="Filter by priority"
            className="rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>

          <select
            value={fraudFilter}
            onChange={(e) => setFraudFilter(e.target.value)}
            aria-label="Filter by fraud type"
            className="rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
          >
            <option value="">All fraud typologies</option>
            {FRAUD_TYPES.map((ft) => (
              <option key={ft} value={ft}>
                {formatFraudType(ft)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Complaints Table */}
      <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-subtle bg-subtle/50 px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Complaints ledger</h2>
          <span className="font-mono text-xs text-muted tabular-nums">
            Showing {complaints.length} of {total} records
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : complaints.length === 0 ? (
          <EmptyDataState
            title="No complaints match current filters"
            description="Adjust search parameters or register a new victim cybercrime complaint."
            action={
              canCreateOrEdit ? (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong-hover cursor-pointer transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Register complaint
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border-subtle bg-highlight/40 text-[11px] font-medium uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Case ID</th>
                  <th className="px-4 py-2.5">Victim</th>
                  <th className="px-4 py-2.5">Typology</th>
                  <th className="px-4 py-2.5 text-right">Reported loss</th>
                  <th className="px-4 py-2.5">Priority</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Lead investigator</th>
                  <th className="px-4 py-2.5 text-right">Linked signals</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {complaints.map((cmp) => (
                  <tr key={cmp.id} className="hover:bg-subtle/60 transition-colors duration-120">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-mono font-medium text-accent-strong dark:text-sky-300">
                        {cmp.complaint_number}
                      </p>
                      {cmp.reference_no ? (
                        <p className="font-mono text-[10px] text-muted">{cmp.reference_no}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-heading">{cmp.victim_name}</p>
                      <p className="font-mono text-[11px] text-muted">
                        {cmp.victim_phone} · {cmp.city}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-body whitespace-nowrap">
                      {formatFraudType(cmp.fraud_type)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-heading tabular-nums whitespace-nowrap">
                      {formatInr(cmp.reported_amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusSignal level={cmp.priority} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusSignal level={cmp.status} />
                    </td>
                    <td className="px-4 py-3 text-body whitespace-nowrap">
                      {cmp.investigator_name ?? 'Unassigned'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[11px] text-muted tabular-nums whitespace-nowrap">
                      {cmp.transaction_count} tx · {cmp.atm_prediction_count} ATM · {cmp.open_alert_count} alert
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void openComplaintDetail(cmp.id)}
                        className="inline-flex items-center gap-1 rounded-[8px] border border-border-subtle bg-card px-2.5 py-1 text-[11px] font-medium text-heading hover:bg-subtle cursor-pointer transition-colors duration-120"
                      >
                        <Eye className="h-3 w-3 text-accent-strong" aria-hidden="true" />
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Register Complaint Modal */}
      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-[16px] border border-border-subtle bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border-subtle bg-subtle/40 px-5 py-3.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-heading">Register cybercrime complaint</h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-[6px] p-1 text-muted hover:bg-subtle hover:text-heading cursor-pointer transition-colors"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRegister} className="p-5 space-y-4">
              {formError ? <ErrorDataState message={formError} /> : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Victim full name</label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={victimName}
                    onChange={(e) => setVictimName(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                    placeholder="e.g. Siddharth Hegde"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Masked phone</label>
                  <input
                    type="text"
                    required
                    minLength={6}
                    value={victimPhone}
                    onChange={(e) => setVictimPhone(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs font-mono text-heading focus:border-accent-strong focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Victim email (optional)</label>
                  <input
                    type="email"
                    value={victimEmail}
                    onChange={(e) => setVictimEmail(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                    placeholder="victim@example.in"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-body mb-1">City</label>
                    <input
                      type="text"
                      required
                      value={victimCity}
                      onChange={(e) => setVictimCity(e.target.value)}
                      className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-body mb-1">State</label>
                    <input
                      type="text"
                      required
                      value={victimState}
                      onChange={(e) => setVictimState(e.target.value)}
                      className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Fraud typology</label>
                  <select
                    value={fraudType}
                    onChange={(e) => setFraudType(e.target.value as FraudType)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                  >
                    {FRAUD_TYPES.map((ft) => (
                      <option key={ft} value={ft}>
                        {formatFraudType(ft)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-body mb-1">Reported loss (INR)</label>
                  <input
                    type="number"
                    required
                    min={100}
                    value={reportedAmount}
                    onChange={(e) => setReportedAmount(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs font-mono text-heading focus:border-accent-strong focus:outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-body mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as ComplaintPriority)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Incident timestamp</label>
                  <input
                    type="datetime-local"
                    required
                    value={incidentTimestamp}
                    onChange={(e) => setIncidentTimestamp(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs font-mono text-heading focus:border-accent-strong focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1">Assign lead investigator</label>
                  <select
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                  >
                    <option value="">Unassigned (Queue)</option>
                    {investigators.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.full_name} ({inv.badge_number})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-body mb-1">Incident summary</label>
                <textarea
                  required
                  minLength={10}
                  rows={3}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Describe payment vectors, suspicious beneficiary identifiers, and initial timeline..."
                  className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-2 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-[8px] border border-border-subtle bg-card px-3.5 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-[8px] bg-accent-strong px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-strong-hover disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {submitting ? 'Submitting...' : 'Create complaint & open case'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Complaint Inspection Drawer */}
      {selectedId ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
          <div className="w-full max-w-3xl bg-card border-l border-border-subtle h-full overflow-y-auto p-5 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3.5">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted">Case dossier</p>
                <h2 className="font-mono text-base font-semibold text-heading">
                  {detail?.complaint.complaint_number ?? 'Loading...'}
                  {detail?.complaint.reference_no ? (
                    <span className="ml-2 text-xs font-normal text-muted">
                      ({detail.complaint.reference_no})
                    </span>
                  ) : null}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setDetail(null);
                }}
                className="rounded-[6px] p-1.5 text-muted hover:bg-subtle hover:text-heading cursor-pointer transition-colors"
                aria-label="Close dossier"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailLoading || !detail ? (
              <TableSkeleton rows={6} cols={4} />
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-[12px] border border-border-subtle bg-subtle/30 p-4">
                  <div>
                    <p className="text-[11px] text-muted">Victim & contact</p>
                    <p className="mt-1 text-xs font-semibold text-heading">{detail.complaint.victim_name}</p>
                    <p className="font-mono text-[11px] text-muted">
                      {detail.complaint.victim_phone} · {detail.complaint.victim_city}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted">Typology & reported loss</p>
                    <p className="mt-1 text-xs font-semibold text-heading">
                      {formatFraudType(detail.complaint.fraud_type)}
                    </p>
                    <p className="font-mono text-xs font-semibold text-accent-strong tabular-nums">
                      {formatInr(detail.complaint.reported_amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted">Incident time</p>
                    <p className="mt-1 font-mono text-xs text-heading tabular-nums">
                      {formatTimestamp(detail.complaint.incident_timestamp)}
                    </p>
                    <p className="text-[11px] text-muted">
                      Lead: {detail.complaint.investigator_name ?? 'Unassigned'}
                    </p>
                  </div>
                  <div className="sm:col-span-3 border-t border-border-subtle pt-3">
                    <p className="text-[11px] text-muted mb-1">Complaint narrative</p>
                    <p className="text-xs text-body leading-relaxed">{detail.complaint.summary}</p>
                  </div>
                </div>

                {canCreateOrEdit ? (
                  <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">Current stage:</span>
                        <StatusSignal level={detail.complaint.status} />
                        {detail.complaint.citizen_status ? (
                          <span className="rounded-[6px] border border-border-subtle bg-subtle px-2 py-0.5 text-[11px] font-medium text-heading">
                            Citizen view: {detail.complaint.citizen_status}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-body mb-1">
                          Investigation stage
                        </label>
                        <select
                          value={nextStatus}
                          onChange={(e) => setNextStatus(e.target.value as ComplaintStatus)}
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                        >
                          {COMPLAINT_STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {st.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-body mb-1">
                          Assign lead investigator
                        </label>
                        <select
                          value={nextAssignedTo}
                          onChange={(e) => setNextAssignedTo(e.target.value)}
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                        >
                          <option value="">Unassigned</option>
                          {investigators.map((inv) => (
                            <option key={inv.id} value={inv.id}>
                              {inv.full_name} ({inv.badge_number})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-body mb-1">
                          Public remark (visible to citizen)
                        </label>
                        <input
                          type="text"
                          value={publicRemark}
                          onChange={(e) => setPublicRemark(e.target.value)}
                          placeholder="Optional citizen-facing status update..."
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-body mb-1">
                          Internal note (officer only)
                        </label>
                        <input
                          type="text"
                          value={internalNote}
                          onChange={(e) => setInternalNote(e.target.value)}
                          placeholder="Optional confidential investigator note..."
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none transition-colors"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={statusUpdateLoading}
                        onClick={() => void handleStatusUpdate()}
                        className="rounded-[8px] bg-accent-strong px-3.5 py-1.5 text-xs font-medium text-white hover:bg-accent-strong-hover disabled:opacity-50 cursor-pointer transition-colors duration-120"
                      >
                        {statusUpdateLoading ? 'Updating...' : 'Save status & remark'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {detail.statusHistory && detail.statusHistory.length > 0 ? (
                  <div className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
                    <div className="border-b border-border-subtle bg-subtle/50 px-4 py-2.5">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                        Status & remarks log ({detail.statusHistory.length})
                      </h3>
                    </div>
                    <div className="divide-y divide-border-subtle">
                      {detail.statusHistory.map((h) => (
                        <div key={h.id} className="px-4 py-2.5 text-xs space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-heading">
                              {h.status} · <span className="text-accent-strong">{h.citizen_status}</span>
                            </span>
                            <span className="font-mono text-[11px] text-muted tabular-nums">
                              {formatTimestamp(h.changed_at)} · {h.changed_by_name ?? 'System'}
                            </span>
                          </div>
                          {h.public_remark ? (
                            <p className="text-body">
                              <span className="font-medium text-heading">Public:</span> {h.public_remark}
                            </p>
                          ) : null}
                          {h.internal_note ? (
                            <p className="text-muted">
                              <span className="font-medium">Internal:</span> {h.internal_note}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
                  <div className="border-b border-border-subtle bg-subtle/50 px-4 py-2.5 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Linked transactions ({detail.transactions.length})
                    </h3>
                  </div>
                  {detail.transactions.length === 0 ? (
                    <p className="p-4 text-xs text-muted">No transactions ingested for this complaint yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-subtle text-[11px] font-medium uppercase tracking-wider text-muted border-b border-border-subtle">
                          <tr>
                            <th className="px-3 py-2">TXN ID</th>
                            <th className="px-3 py-2">From → To</th>
                            <th className="px-3 py-2">Channel / Hop</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                          {detail.transactions.map((tx) => (
                            <tr key={tx.id}>
                              <td className="px-3 py-2 font-mono text-accent-strong">{tx.txn_id}</td>
                              <td className="px-3 py-2">
                                <span className="font-mono text-heading">{tx.from_account_number}</span>
                                <span className="mx-1.5 text-muted">→</span>
                                <span className="font-mono text-heading">{tx.to_account_number}</span>
                              </td>
                              <td className="px-3 py-2 text-body">
                                {tx.channel} · Hop {tx.hop_depth ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-medium text-heading tabular-nums">
                                {formatInr(tx.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
                  <div className="border-b border-border-subtle bg-subtle/50 px-4 py-2.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Suspected mule & layering accounts ({detail.suspiciousAccounts.length})
                    </h3>
                  </div>
                  {detail.suspiciousAccounts.length === 0 ? (
                    <p className="p-4 text-xs text-muted">No flagged accounts linked to this case yet.</p>
                  ) : (
                    <div className="divide-y divide-border-subtle">
                      {detail.suspiciousAccounts.map((sa) => (
                        <div key={sa.id} className="px-4 py-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-xs font-medium text-heading">
                              {sa.account_number} · {sa.holder_name}
                            </p>
                            <p className="mt-0.5 text-xs text-muted">{sa.reason}</p>
                            <div className="mt-1.5">
                              <ScoreSourceBadge source={sa.score_source} />
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <StatusSignal level={sa.classification} />
                            {sa.mule_probability !== null ? (
                              <p className="mt-1 font-mono text-xs text-heading tabular-nums">
                                Score: {(Number(sa.mule_probability) * 100).toFixed(1)}%
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
                  <div className="border-b border-border-subtle bg-subtle/50 px-4 py-2.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Predicted ATM cash-out locations ({detail.atmPredictions.length})
                    </h3>
                  </div>
                  {detail.atmPredictions.length === 0 ? (
                    <p className="p-4 text-xs text-muted">No ATM cash-out forecast generated for this complaint yet.</p>
                  ) : (
                    <div className="divide-y divide-border-subtle">
                      {detail.atmPredictions.map((ap) => (
                        <div key={ap.id} className="px-4 py-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-heading">
                              #{ap.rank_order} · {ap.atm_id} · {ap.bank} ({ap.locality})
                            </p>
                            <p className="text-[11px] text-muted">{ap.address}</p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <ScoreSourceBadge source={ap.score_source} />
                              <span className="font-mono text-[11px] text-muted tabular-nums">
                                Window: {ap.window}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono text-sm font-semibold text-heading tabular-nums">
                              {Number(ap.risk_score).toFixed(1)}/100
                            </p>
                            <StatusSignal level={ap.risk_level} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </CommandLayout>
  );
}
