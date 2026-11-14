import {
  BellRing,
  Check,
  CheckCircle2,
  MapPin,
  Plus,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { ScoreSourceBadge } from '../components/common/ScoreSourceBadge';
import { StatusSignal } from '../components/common/StatusSignal';
import { CommandLayout } from '../components/layout/CommandLayout';
import { useAuth } from '../context/AuthContext';
import {
  AlertRow,
  AlertSeverity,
  AlertStatus,
  ApiSuccessResponse,
  ComplaintSummary,
  ScoreSource,
} from '../types';
import { formatTimestamp } from '../utils/formatters';

export function AlertsCentrePage() {
  const { hasRole } = useAuth();
  const canCreate = hasRole('Administrator', 'Senior Investigator', 'Investigator');
  const canUpdateStatus = hasRole(
    'Administrator',
    'Senior Investigator',
    'Investigator',
    'Bank Nodal Officer'
  );

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | ''>('');
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | ''>('');
  const [complaintFilter, setComplaintFilter] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formComplaintId, setFormComplaintId] = useState('');
  const [formAlertType, setFormAlertType] = useState<
    'CASH_OUT_IMMINENT' | 'MULE_BURST' | 'LAYERING_CYCLE' | 'HIGH_VALUE_HOP' | 'ANOMALY_DETECTED'
  >('CASH_OUT_IMMINENT');
  const [formSeverity, setFormSeverity] = useState<AlertSeverity>('High');
  const [formAtmId, setFormAtmId] = useState('');
  const [formScoreSource, setFormScoreSource] = useState<ScoreSource>('Rule-based risk score');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter) params.set('status', statusFilter);
      if (severityFilter) params.set('severity', severityFilter);
      if (complaintFilter) params.set('complaintId', complaintFilter);

      const res = await apiRequest<ApiSuccessResponse<AlertRow[]>>(`/alerts?${params.toString()}`);
      setAlerts(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load early warning alerts.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter, complaintFilter]);

  useEffect(() => {
    apiRequest<ApiSuccessResponse<ComplaintSummary[]>>('/complaints?limit=50')
      .then((res) => {
        setComplaints(res.data);
        if (res.data[0] && !formComplaintId) {
          setFormComplaintId(res.data[0].id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const handleStatusChange = async (alertId: string, nextStatus: AlertStatus) => {
    setUpdatingId(alertId);
    setError(null);
    try {
      await apiRequest(`/alerts/${alertId}`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      await loadAlerts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update alert status.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCreateAlert = async (e: FormEvent) => {
    e.preventDefault();
    if (!formComplaintId) {
      setError('Select a complaint before raising an alert.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/alerts', {
        method: 'POST',
        body: {
          complaintId: formComplaintId,
          atmId: formAtmId.trim() || null,
          alertType: formAlertType,
          severity: formSeverity,
          scoreSource: formScoreSource,
          title: formTitle.trim(),
          description: formDescription.trim(),
        },
      });
      setShowCreateModal(false);
      setFormAtmId('');
      setFormTitle('');
      setFormDescription('');
      await loadAlerts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create alert.');
    } finally {
      setSubmitting(false);
    }
  };

  const summary = useMemo(() => {
    const open = alerts.filter((a) => a.status === 'OPEN').length;
    const critical = alerts.filter((a) => a.severity === 'Critical' && a.status !== 'RESOLVED').length;
    const dispatched = alerts.filter((a) => a.status === 'DISPATCHED').length;
    const resolved = alerts.filter((a) => a.status === 'RESOLVED').length;
    return { open, critical, dispatched, resolved };
  }, [alerts]);

  return (
    <CommandLayout
      title="Early warning alerts centre"
      section="Casework and intelligence"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAlerts()}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-120"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh queue</span>
          </button>
          {canCreate ? (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-120"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Raise operational alert</span>
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-6">
        {error ? <ErrorDataState message={error} onRetry={() => void loadAlerts()} /> : null}

        {/* Framing Banner */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-heading">
              Active cash-out & citizen intake warnings
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              Coordinate bank nodal account freezes, ATM patrol dispatches, and newly filed citizen cybercrime alerts.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold text-heading tabular-nums">
            {summary.open} open · {summary.critical} critical
          </span>
        </section>

        {/* KPI Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-[12px] border border-border-subtle bg-card p-4">
            <p className="text-[11px] font-medium text-muted">Open alerts</p>
            <p className="mt-1 font-mono text-2xl font-bold text-rose-700 dark:text-rose-400 tabular-nums">
              {summary.open}
            </p>
          </div>
          <div className="rounded-[12px] border border-border-subtle bg-card p-4">
            <p className="text-[11px] font-medium text-muted">Unresolved critical</p>
            <p className="mt-1 font-mono text-2xl font-bold text-heading tabular-nums">
              {summary.critical}
            </p>
          </div>
          <div className="rounded-[12px] border border-border-subtle bg-card p-4">
            <p className="text-[11px] font-medium text-muted">Field teams dispatched</p>
            <p className="mt-1 font-mono text-2xl font-bold text-amber-800 dark:text-amber-300 tabular-nums">
              {summary.dispatched}
            </p>
          </div>
          <div className="rounded-[12px] border border-border-subtle bg-card p-4">
            <p className="text-[11px] font-medium text-muted">Resolved interventions</p>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {summary.resolved}
            </p>
          </div>
        </section>

        {/* Filters */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select
              value={complaintFilter}
              onChange={(e) => setComplaintFilter(e.target.value)}
              aria-label="Filter alerts by complaint"
              className="rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs text-heading focus:outline-none"
            >
              <option value="">All complaints</option>
              {complaints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.complaint_number} · {c.victim_name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AlertStatus | '')}
              aria-label="Filter alerts by status"
              className="rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs text-heading focus:outline-none"
            >
              <option value="">All statuses</option>
              <option value="OPEN">OPEN</option>
              <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
              <option value="DISPATCHED">DISPATCHED</option>
              <option value="RESOLVED">RESOLVED</option>
              <option value="FALSE_POSITIVE">FALSE_POSITIVE</option>
            </select>

            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as AlertSeverity | '')}
              aria-label="Filter alerts by severity"
              className="rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs text-heading focus:outline-none"
            >
              <option value="">All severities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </section>

        {/* Alerts Queue */}
        <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
          <div className="border-b border-border-subtle bg-subtle px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-accent-strong" aria-hidden="true" />
              <h2 className="text-xs font-semibold text-heading">Active operational alert queue</h2>
            </div>
            <span className="font-mono text-xs text-muted tabular-nums">
              {alerts.length} alerts
            </span>
          </div>

          {loading ? (
            <TableSkeleton rows={6} cols={4} />
          ) : alerts.length === 0 ? (
            <EmptyDataState
              title="No alerts match current filters"
              description="Alerts appear automatically when ATM cash-out forecasting flags Critical/High risk terminals or when raised manually."
            />
          ) : (
            <div className="divide-y border-border-subtle">
              {alerts.map((alert) => (
                <div key={alert.id} className="p-4 space-y-3 hover:bg-subtle transition-colors duration-120">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <StatusSignal level={alert.severity} />
                        <span className="text-muted">·</span>
                        <span className="font-mono text-[11px] font-semibold text-accent-strong">
                          {alert.complaint_number ?? 'System'}
                        </span>
                        <span className="text-muted">·</span>
                        <span className="font-mono text-[11px] text-muted">
                          {alert.alert_type}
                        </span>
                        {alert.atm_id ? (
                          <>
                            <span className="text-muted">·</span>
                            <Link
                              to={`/map?complaintId=${encodeURIComponent(alert.complaint_id)}`}
                              className="inline-flex items-center gap-1 font-mono text-[11px] text-amber-800 dark:text-amber-300 hover:underline"
                            >
                              <MapPin className="h-3 w-3" aria-hidden="true" />
                              <span>{alert.atm_id} ({alert.atm_locality ?? alert.atm_bank})</span>
                            </Link>
                          </>
                        ) : null}
                      </div>
                      <h3 className="text-xs font-semibold text-heading">{alert.title}</h3>
                      <p className="text-xs text-body leading-relaxed">{alert.description}</p>
                    </div>

                    <div className="text-right shrink-0 space-y-1">
                      <StatusSignal level={alert.status} />
                      <p className="font-mono text-[11px] text-muted tabular-nums">
                        Created: {formatTimestamp(alert.created_at)}
                      </p>
                      {alert.acknowledged_by_name ? (
                        <p className="text-[11px] text-muted">
                          By: {alert.acknowledged_by_name}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-3">
                      <ScoreSourceBadge source={alert.score_source} />
                      {alert.account_number ? (
                        <span className="font-mono text-[11px] text-muted">
                          Account: {alert.account_number} ({alert.holder_name})
                        </span>
                      ) : null}
                    </div>

                    {canUpdateStatus && alert.status !== 'RESOLVED' && alert.status !== 'FALSE_POSITIVE' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {alert.status === 'OPEN' ? (
                          <button
                            type="button"
                            disabled={updatingId === alert.id}
                            onClick={() => void handleStatusChange(alert.id, 'ACKNOWLEDGED')}
                            className="inline-flex items-center gap-1 rounded-[6px] border border-border-subtle bg-card px-2.5 py-1 text-[11px] font-medium text-heading hover:bg-highlight disabled:opacity-50 cursor-pointer transition-colors duration-120"
                          >
                            <Check className="h-3 w-3 text-accent-strong" aria-hidden="true" />
                            <span>Acknowledge</span>
                          </button>
                        ) : null}
                        {alert.status !== 'DISPATCHED' ? (
                          <button
                            type="button"
                            disabled={updatingId === alert.id}
                            onClick={() => void handleStatusChange(alert.id, 'DISPATCHED')}
                            className="inline-flex items-center gap-1 rounded-[6px] border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:opacity-90 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-200 disabled:opacity-50 cursor-pointer transition-colors duration-120"
                          >
                            <Send className="h-3 w-3" aria-hidden="true" />
                            <span>Dispatch team</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={updatingId === alert.id}
                          onClick={() => void handleStatusChange(alert.id, 'RESOLVED')}
                          className="inline-flex items-center gap-1 rounded-[6px] border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-900 hover:opacity-90 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-200 disabled:opacity-50 cursor-pointer transition-colors duration-120"
                        >
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          <span>Mark resolved</span>
                        </button>
                        <button
                          type="button"
                          disabled={updatingId === alert.id}
                          onClick={() => void handleStatusChange(alert.id, 'FALSE_POSITIVE')}
                          className="inline-flex items-center gap-1 rounded-[6px] border border-border-subtle bg-subtle px-2.5 py-1 text-[11px] font-medium text-muted hover:text-heading disabled:opacity-50 cursor-pointer transition-colors duration-120"
                        >
                          <XCircle className="h-3 w-3" aria-hidden="true" />
                          <span>False positive</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Create Alert Modal */}
        {showCreateModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-[16px] border border-border-subtle bg-card p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                <h2 className="text-xs font-semibold text-heading">Raise early warning alert</h2>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="text-xs text-muted hover:text-heading cursor-pointer"
                >
                  Close
                </button>
              </div>

              <form onSubmit={(e) => void handleCreateAlert(e)} className="space-y-3 text-xs">
                <div>
                  <label className="block text-[11px] font-medium text-body mb-1">Complaint case</label>
                  <select
                    required
                    value={formComplaintId}
                    onChange={(e) => setFormComplaintId(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-heading focus:outline-none"
                  >
                    {complaints.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.complaint_number} · {c.victim_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-body mb-1">Alert type</label>
                    <select
                      value={formAlertType}
                      onChange={(e) =>
                        setFormAlertType(
                          e.target.value as
                            | 'CASH_OUT_IMMINENT'
                            | 'MULE_BURST'
                            | 'LAYERING_CYCLE'
                            | 'HIGH_VALUE_HOP'
                            | 'ANOMALY_DETECTED'
                        )
                      }
                      className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-heading focus:outline-none"
                    >
                      <option value="CASH_OUT_IMMINENT">CASH_OUT_IMMINENT</option>
                      <option value="MULE_BURST">MULE_BURST</option>
                      <option value="LAYERING_CYCLE">LAYERING_CYCLE</option>
                      <option value="HIGH_VALUE_HOP">HIGH_VALUE_HOP</option>
                      <option value="ANOMALY_DETECTED">ANOMALY_DETECTED</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-body mb-1">Severity</label>
                    <select
                      value={formSeverity}
                      onChange={(e) => setFormSeverity(e.target.value as AlertSeverity)}
                      className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-heading focus:outline-none"
                    >
                      <option value="Critical">Critical</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-body mb-1">ATM terminal ID (optional)</label>
                    <input
                      type="text"
                      value={formAtmId}
                      onChange={(e) => setFormAtmId(e.target.value)}
                      placeholder="e.g. ATM-BLR-001"
                      className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 font-mono text-heading focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-body mb-1">Score attribution</label>
                    <select
                      value={formScoreSource}
                      onChange={(e) => setFormScoreSource(e.target.value as ScoreSource)}
                      className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-heading focus:outline-none"
                    >
                      <option value="Rule-based risk score">Rule-based risk score</option>
                      <option value="Trained ML prediction">Trained ML prediction</option>
                      <option value="Synthetic demo result">Synthetic demo result</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-body mb-1">Alert title</label>
                  <input
                    type="text"
                    required
                    minLength={5}
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="Imminent withdrawal risk at Koramangala 4th Block ATM"
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-heading focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-body mb-1">Operational briefing</label>
                  <textarea
                    required
                    minLength={10}
                    rows={3}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Describe suspected mule account, route, and field containment instructions."
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-heading focus:outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="rounded-[8px] border border-border-subtle px-3.5 py-1.5 text-body hover:bg-highlight cursor-pointer transition-colors duration-120"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-[8px] bg-accent-strong px-4 py-1.5 font-medium text-white hover:bg-accent-strong-hover disabled:opacity-50 cursor-pointer transition-colors duration-120"
                  >
                    {submitting ? 'Submitting...' : 'Create alert'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </CommandLayout>
  );
}
