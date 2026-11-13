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
        body: { status: nextStatus },
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
      title="Complaints Registry"
      section="Core Operations"
      actions={
        canCreateOrEdit ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Register Complaint
          </button>
        ) : null
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void fetchComplaints()} /> : null}

      {/* Filter Bar */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] p-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2 relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search complaint ID, victim, or summary..."
              className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by complaint status"
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Statuses</option>
            {COMPLAINT_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st.replaceAll('_', ' ')}
              </option>
            ))}
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            aria-label="Filter by priority"
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            value={fraudFilter}
            onChange={(e) => setFraudFilter(e.target.value)}
            aria-label="Filter by fraud type"
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Fraud Types</option>
            {FRAUD_TYPES.map((ft) => (
              <option key={ft} value={ft}>
                {formatFraudType(ft)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Complaints Table */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Cybercrime Complaints Ledger</h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            Showing {complaints.length} of {total}
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
                  className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Register First Complaint
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#0F172A] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Case ID</th>
                  <th className="px-4 py-2.5">Victim</th>
                  <th className="px-4 py-2.5">Fraud Typology</th>
                  <th className="px-4 py-2.5 text-right">Reported Loss</th>
                  <th className="px-4 py-2.5">Priority</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Investigator</th>
                  <th className="px-4 py-2.5 text-right">Signals</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {complaints.map((cmp) => (
                  <tr key={cmp.id} className="hover:bg-slate-800/35">
                    <td className="px-4 py-3 font-mono font-semibold text-sky-300 whitespace-nowrap">
                      {cmp.complaint_number}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-100">{cmp.victim_name}</p>
                      <p className="font-mono text-[11px] text-slate-400">
                        {cmp.victim_phone} · {cmp.city}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-200 whitespace-nowrap">
                      {formatFraudType(cmp.fraud_type)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-white tabular-nums whitespace-nowrap">
                      {formatInr(cmp.reported_amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusSignal level={cmp.priority} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusSignal level={cmp.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                      {cmp.investigator_name ?? 'Unassigned'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                      {cmp.transaction_count} tx · {cmp.atm_prediction_count} ATM · {cmp.open_alert_count} alert
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void openComplaintDetail(cmp.id)}
                        className="inline-flex items-center gap-1 rounded-[4px] border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-sky-500/50 hover:text-white cursor-pointer"
                      >
                        <Eye className="h-3 w-3 text-sky-400" aria-hidden="true" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-[8px] border border-slate-700 bg-[#111827] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-white">Register Cybercrime Complaint</h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRegister} className="p-5 space-y-4">
              {formError ? <ErrorDataState message={formError} /> : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Victim Full Name</label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={victimName}
                    onChange={(e) => setVictimName(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                    placeholder="e.g. Siddharth Hegde"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Masked Phone</label>
                  <input
                    type="text"
                    required
                    minLength={6}
                    value={victimPhone}
                    onChange={(e) => setVictimPhone(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Victim Email (optional)</label>
                  <input
                    type="email"
                    value={victimEmail}
                    onChange={(e) => setVictimEmail(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                    placeholder="victim@example.in"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">City</label>
                    <input
                      type="text"
                      required
                      value={victimCity}
                      onChange={(e) => setVictimCity(e.target.value)}
                      className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">State</label>
                    <input
                      type="text"
                      required
                      value={victimState}
                      onChange={(e) => setVictimState(e.target.value)}
                      className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Fraud Typology</label>
                  <select
                    value={fraudType}
                    onChange={(e) => setFraudType(e.target.value as FraudType)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    {FRAUD_TYPES.map((ft) => (
                      <option key={ft} value={ft}>
                        {formatFraudType(ft)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Reported Loss (INR)</label>
                  <input
                    type="number"
                    required
                    min={100}
                    value={reportedAmount}
                    onChange={(e) => setReportedAmount(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as ComplaintPriority)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Incident Timestamp</label>
                  <input
                    type="datetime-local"
                    required
                    value={incidentTimestamp}
                    onChange={(e) => setIncidentTimestamp(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Assign Lead Investigator</label>
                  <select
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
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
                <label className="block text-xs font-medium text-slate-300 mb-1">Incident Summary</label>
                <textarea
                  required
                  minLength={10}
                  rows={3}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Describe payment vectors, suspicious beneficiary identifiers, and initial timeline..."
                  className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-[5px] border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-[5px] bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Submitting...' : 'Create Complaint & Open Case'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Complaint Inspection Drawer */}
      {selectedId ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70">
          <div className="w-full max-w-3xl bg-[#0F172A] border-l border-slate-800 h-full overflow-y-auto p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Case Inspection Dossier</p>
                <h2 className="font-mono text-base font-bold text-white">
                  {detail?.complaint.complaint_number ?? 'Loading...'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setDetail(null);
                }}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                aria-label="Close dossier"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailLoading || !detail ? (
              <TableSkeleton rows={6} cols={4} />
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-[6px] border border-slate-800 bg-[#111827] p-4">
                  <div>
                    <p className="text-[11px] text-slate-400">Victim & Contact</p>
                    <p className="mt-1 text-xs font-semibold text-white">{detail.complaint.victim_name}</p>
                    <p className="font-mono text-[11px] text-slate-400">
                      {detail.complaint.victim_phone} · {detail.complaint.victim_city}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">Typology & Reported Loss</p>
                    <p className="mt-1 text-xs font-semibold text-white">
                      {formatFraudType(detail.complaint.fraud_type)}
                    </p>
                    <p className="font-mono text-xs text-sky-300 tabular-nums">
                      {formatInr(detail.complaint.reported_amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">Incident Time</p>
                    <p className="mt-1 font-mono text-xs text-slate-200 tabular-nums">
                      {formatTimestamp(detail.complaint.incident_timestamp)}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Lead: {detail.complaint.investigator_name ?? 'Unassigned'}
                    </p>
                  </div>
                  <div className="sm:col-span-3 border-t border-slate-800 pt-3">
                    <p className="text-[11px] text-slate-400 mb-1">Complaint Narrative</p>
                    <p className="text-xs text-slate-200 leading-relaxed">{detail.complaint.summary}</p>
                  </div>
                </div>

                {canCreateOrEdit ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-slate-800 bg-[#111827] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Current Stage:</span>
                      <StatusSignal level={detail.complaint.status} />
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={nextStatus}
                        onChange={(e) => setNextStatus(e.target.value as ComplaintStatus)}
                        className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1 text-xs text-slate-100"
                      >
                        {COMPLAINT_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st.replaceAll('_', ' ')}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={statusUpdateLoading}
                        onClick={() => void handleStatusUpdate()}
                        className="rounded-[5px] bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 cursor-pointer"
                      >
                        {statusUpdateLoading ? 'Updating...' : 'Update Status'}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden">
                  <div className="border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-white">
                      Linked Transactions ({detail.transactions.length})
                    </h3>
                  </div>
                  {detail.transactions.length === 0 ? (
                    <p className="p-4 text-xs text-slate-400">No transactions ingested for this complaint yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#0B1120] text-[11px] text-slate-400 border-b border-slate-800">
                          <tr>
                            <th className="px-3 py-2">TXN ID</th>
                            <th className="px-3 py-2">From → To</th>
                            <th className="px-3 py-2">Channel / Hop</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80">
                          {detail.transactions.map((tx) => (
                            <tr key={tx.id}>
                              <td className="px-3 py-2 font-mono text-sky-300">{tx.txn_id}</td>
                              <td className="px-3 py-2">
                                <span className="font-mono text-slate-200">{tx.from_account_number}</span>
                                <span className="mx-1.5 text-slate-500">→</span>
                                <span className="font-mono text-slate-200">{tx.to_account_number}</span>
                              </td>
                              <td className="px-3 py-2 text-slate-300">
                                {tx.channel} · Hop {tx.hop_depth ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-white tabular-nums">
                                {formatInr(tx.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden">
                  <div className="border-b border-slate-800 px-4 py-2.5">
                    <h3 className="text-xs font-semibold text-white">
                      Suspected Mule & Layering Accounts ({detail.suspiciousAccounts.length})
                    </h3>
                  </div>
                  {detail.suspiciousAccounts.length === 0 ? (
                    <p className="p-4 text-xs text-slate-400">No flagged accounts linked to this case yet.</p>
                  ) : (
                    <div className="divide-y divide-slate-800/80">
                      {detail.suspiciousAccounts.map((sa) => (
                        <div key={sa.id} className="px-4 py-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-xs font-semibold text-white">
                              {sa.account_number} · {sa.holder_name}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400">{sa.reason}</p>
                            <div className="mt-1.5">
                              <ScoreSourceBadge source={sa.score_source} />
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <StatusSignal level={sa.classification} />
                            {sa.mule_probability !== null ? (
                              <p className="mt-1 font-mono text-xs text-slate-200 tabular-nums">
                                Score: {(Number(sa.mule_probability) * 100).toFixed(1)}%
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden">
                  <div className="border-b border-slate-800 px-4 py-2.5">
                    <h3 className="text-xs font-semibold text-white">
                      Predicted ATM Cash-Out Locations ({detail.atmPredictions.length})
                    </h3>
                  </div>
                  {detail.atmPredictions.length === 0 ? (
                    <p className="p-4 text-xs text-slate-400">No ATM cash-out forecast generated for this complaint yet.</p>
                  ) : (
                    <div className="divide-y divide-slate-800/80">
                      {detail.atmPredictions.map((ap) => (
                        <div key={ap.id} className="px-4 py-3 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold text-white">
                              #{ap.rank_order} · {ap.atm_id} · {ap.bank} ({ap.locality})
                            </p>
                            <p className="text-[11px] text-slate-400">{ap.address}</p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <ScoreSourceBadge source={ap.score_source} />
                              <span className="font-mono text-[11px] text-amber-300">
                                Window: {ap.window}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono text-sm font-bold text-white tabular-nums">
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
