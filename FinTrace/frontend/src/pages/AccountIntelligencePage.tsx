import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Building2,
  CheckCircle2,
  Eye,
  Layers,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
  X,
  Zap,
} from 'lucide-react';
import type { SVGProps } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { ScoreSourceBadge } from '../components/common/ScoreSourceBadge';
import { StatusSignal } from '../components/common/StatusSignal';
import { CommandLayout } from '../components/layout/CommandLayout';
import {
  AccountIntelligenceProfile,
  AccountRiskHistoryEntry,
  AccountStatusClassification,
} from '../types';
import { formatInr, formatTimestamp } from '../utils/formatters';

const DISCLAIMER =
  'FinTrace returns RECOMMENDATIONS. Simulated intervention only. No actual banking freeze or fund blocking is executed on live financial rails.';

interface IntelligenceSummary {
  totalMonitoredAccounts: number;
  highOrCriticalCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  underInvestigationCount: number;
  confirmedFraudLinkedCount: number;
  suspectedMuleCount: number;
  suspiciousAccountCount: number;
  normalCount: number;
}

export function AccountIntelligencePage() {
  const [accounts, setAccounts] = useState<AccountIntelligenceProfile[]>([]);
  const [summary, setSummary] = useState<IntelligenceSummary | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const limit = 20;

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<{ path?: string; status?: number; code?: string } | undefined>();

  // Filters
  const [search, setSearch] = useState<string>('');
  const [classificationFilter, setClassificationFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [bankFilter, setBankFilter] = useState<string>('ALL');

  // Drawer / Inspection
  const [selectedAccount, setSelectedAccount] = useState<AccountIntelligenceProfile | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [history, setHistory] = useState<AccountRiskHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Actions
  const [reEvaluating, setReEvaluating] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Classification Override Modal
  const [overrideModalOpen, setOverrideModalOpen] = useState<boolean>(false);
  const [targetStatus, setTargetStatus] = useState<AccountStatusClassification>('SUSPICIOUS_ACCOUNT');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [overrideComplaintId, setOverrideComplaintId] = useState<string>('');
  const [overrideEvidenceId, setOverrideEvidenceId] = useState<string>('');
  const [submittingOverride, setSubmittingOverride] = useState<boolean>(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorDetails(undefined);
    try {
      const offset = (page - 1) * limit;
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });

      if (search.trim()) params.set('search', search.trim());
      if (classificationFilter !== 'ALL') params.set('riskClassification', classificationFilter);
      if (statusFilter !== 'ALL') params.set('accountStatus', statusFilter);
      if (bankFilter !== 'ALL') params.set('bankName', bankFilter);

      const res = await apiRequest<{
        success: boolean;
        data: AccountIntelligenceProfile[];
        summary?: IntelligenceSummary;
        pagination?: { total: number; limit: number; offset: number };
      }>(`/accounts/intelligence?${params.toString()}`);

      setAccounts(res.data || []);
      if (res.summary) setSummary(res.summary);
      if (res.pagination) setTotal(res.pagination.total);
    } catch (err) {
      if (err instanceof ApiError) {
        let msg = err.message;
        if (err.status === 404) {
          msg = `API endpoint not found: ${err.path || '/accounts/intelligence'}. Please verify backend route mounting.`;
        } else if (err.status === 403) {
          msg = 'Access denied: Your role does not have permission to access Account Intelligence registry.';
        } else if (err.status >= 500) {
          msg = `Internal server error (${err.status}): FinTrace intelligence service encountered an error.`;
        }
        setError(msg);
        setErrorDetails({ path: err.path || '/accounts/intelligence', status: err.status, code: err.code });
      } else {
        const netErr = err as Error;
        setError(netErr?.message || 'Network error: Failed to connect to FinTrace API service.');
        setErrorDetails({ path: '/accounts/intelligence', code: 'NETWORK_ERROR' });
      }
    } finally {
      setLoading(false);
    }
  }, [page, search, classificationFilter, statusFilter, bankFilter]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const openProfile = async (account: AccountIntelligenceProfile) => {
    setSelectedAccount(account);
    setDrawerOpen(true);
    setActionMessage(null);
    setHistoryLoading(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        data: { history: AccountRiskHistoryEntry[] };
      }>(`/accounts/intelligence/${account.account_id}/history`);
      setHistory(res.data?.history || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleReEvaluate = async (accountId: string) => {
    setReEvaluating(true);
    setActionMessage(null);
    try {
      const res = await apiRequest<{
        success: boolean;
        data: AccountIntelligenceProfile;
      }>(`/accounts/intelligence/${accountId}/re-evaluate`, {
        method: 'POST',
      });

      if (res.data) {
        setSelectedAccount(res.data);
        setActionMessage({
          type: 'success',
          text: `Risk score successfully re-evaluated to ${res.data.risk_score} (${res.data.risk_classification}).`,
        });
        void fetchAccounts();
      }
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'Failed to re-evaluate account risk.',
      });
    } finally {
      setReEvaluating(false);
    }
  };

  const handleClassificationSubmit = async () => {
    if (!selectedAccount) return;
    setOverrideError(null);

    if (overrideReason.trim().length < 5) {
      setOverrideError('Justification note must be at least 5 characters for compliance audit.');
      return;
    }

    if (
      targetStatus === 'CONFIRMED_FRAUD_LINKED' &&
      !overrideComplaintId.trim() &&
      !overrideEvidenceId.trim()
    ) {
      setOverrideError(
        'Confirmed Fraud-Linked classification strictly requires an active Complaint ID or Evidence ID reference. Patterns alone cannot criminalize an account.'
      );
      return;
    }

    setSubmittingOverride(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        data: AccountIntelligenceProfile;
      }>(`/accounts/intelligence/${selectedAccount.account_id}/classification`, {
        method: 'PATCH',
        body: {
          classification: targetStatus,
          reason: overrideReason,
          complaintId: overrideComplaintId.trim() || undefined,
          evidenceId: overrideEvidenceId.trim() || undefined,
        },
      });

      if (res.data) {
        setSelectedAccount(res.data);
        setOverrideModalOpen(false);
        setOverrideReason('');
        setOverrideComplaintId('');
        setOverrideEvidenceId('');
        setActionMessage({
          type: 'success',
          text: `Account classification successfully updated to ${res.data.account_status}.`,
        });
        void fetchAccounts();
      }
    } catch (err) {
      setOverrideError(err instanceof ApiError ? err.message : 'Failed to update account classification.');
    } finally {
      setSubmittingOverride(false);
    }
  };

  const uniqueBanks = Array.from(new Set(accounts.map((a) => a.bank_name).filter(Boolean)));

  return (
    <CommandLayout title="Account intelligence & risk registry" section="Fraud prevention">
      <div className="space-y-4">
        {/* Safety Disclaimer Banner */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border-subtle bg-card px-4 py-2.5 text-xs text-body">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-muted" />
            <span>
              <strong className="text-heading font-medium">Pre-fraud prevention layer:</strong> {DISCLAIMER}
            </span>
          </div>
          <Link
            to="/screening"
            className="hidden sm:inline-flex items-center gap-1 font-medium text-accent-strong hover:underline"
          >
            Open screening engine <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </section>

        {/* Top Metric Cards */}
        {summary && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1">
              <div className="flex items-center justify-between text-muted text-xs">
                <span>Monitored accounts</span>
                <Building2 className="h-4 w-4 text-muted" />
              </div>
              <p className="text-2xl font-semibold tabular-nums text-heading">
                {summary.totalMonitoredAccounts.toLocaleString('en-IN')}
              </p>
              <p className="text-[11px] text-muted">Across banking network</p>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1">
              <div className="flex items-center justify-between text-muted text-xs">
                <span>High & critical risk</span>
                <AlertTriangle className="h-4 w-4 text-muted" />
              </div>
              <p className="text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                {summary.highOrCriticalCount}
              </p>
              <p className="text-[11px] text-muted">
                {summary.criticalCount} Critical · {summary.highCount} High
              </p>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1">
              <div className="flex items-center justify-between text-muted text-xs">
                <span>Suspected mules</span>
                <Boxes className="h-4 w-4 text-muted" />
              </div>
              <p className="text-2xl font-semibold tabular-nums text-heading">
                {summary.suspectedMuleCount}
              </p>
              <p className="text-[11px] text-muted">Layering & pass-through</p>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1">
              <div className="flex items-center justify-between text-muted text-xs">
                <span>Confirmed fraud-linked</span>
                <Lock className="h-4 w-4 text-muted" />
              </div>
              <p className="text-2xl font-semibold tabular-nums text-red-700 dark:text-red-400">
                {summary.confirmedFraudLinkedCount}
              </p>
              <p className="text-[11px] text-muted">Complaint / evidence tied</p>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1 col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between text-muted text-xs">
                <span>Under investigation</span>
                <Activity className="h-4 w-4 text-muted" />
              </div>
              <p className="text-2xl font-semibold tabular-nums text-heading">
                {summary.underInvestigationCount}
              </p>
              <p className="text-[11px] text-muted">Active forensic review</p>
            </div>
          </section>
        )}

        {/* Filter and Search Bar */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search account number, holder name, or IFSC..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-[8px] border border-border-subtle bg-app pl-9 pr-3 py-2 text-xs text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none transition-colors"
              />
            </div>

            <div>
              <select
                value={classificationFilter}
                onChange={(e) => {
                  setClassificationFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-2 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
              >
                <option value="ALL">All risk levels</option>
                <option value="Critical">Critical risk (&ge; 85)</option>
                <option value="High">High risk (70–84)</option>
                <option value="Medium">Medium risk (40–69)</option>
                <option value="Low">Low risk (&lt; 40)</option>
                <option value="Under Investigation">Under investigation</option>
              </select>
            </div>

            <div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-2 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
              >
                <option value="ALL">All account statuses</option>
                <option value="NORMAL">Normal account</option>
                <option value="SUSPICIOUS_ACCOUNT">Suspicious account</option>
                <option value="SUSPECTED_MULE_ACCOUNT">Suspected mule account</option>
                <option value="CONFIRMED_FRAUD_LINKED">Confirmed fraud-linked</option>
              </select>
            </div>

            <div>
              <select
                value={bankFilter}
                onChange={(e) => {
                  setBankFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-2 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
              >
                <option value="ALL">All banks</option>
                {uniqueBanks.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Main Accounts Table */}
        <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
          {error && (
            <ErrorDataState
              message={error}
              onRetry={fetchAccounts}
              technicalDetails={errorDetails}
            />
          )}

          {loading ? (
            <TableSkeleton rows={8} cols={7} />
          ) : accounts.length === 0 ? (
            <EmptyDataState
              title="No accounts match current filters"
              description="Adjust search parameters, risk level, or status classifications to view monitored profiles."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border-subtle bg-subtle/50 text-[11px] font-medium uppercase tracking-wider text-muted">
                    <th className="py-2.5 px-3.5">Account / Holder</th>
                    <th className="py-2.5 px-3">Bank & IFSC</th>
                    <th className="py-2.5 px-3">Risk Assessment</th>
                    <th className="py-2.5 px-3">Account Classification</th>
                    <th className="py-2.5 px-3 text-right">24h Flow (In / Out)</th>
                    <th className="py-2.5 px-3 text-center">Pass-Through</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {accounts.map((acc) => {
                    return (
                      <tr
                        key={acc.account_id}
                        onClick={() => openProfile(acc)}
                        className="hover:bg-subtle/60 cursor-pointer transition-colors duration-120"
                      >
                        <td className="py-3 px-3.5">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-subtle text-muted shrink-0">
                              <User className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <p className="font-mono font-medium text-heading">
                                {acc.account_number}
                              </p>
                              <p className="text-[11px] text-muted">{acc.holder_name}</p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <p className="font-medium text-heading">{acc.bank_name}</p>
                          <p className="text-[11px] font-mono text-muted">{acc.ifsc_code || '—'}</p>
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div className="w-12 text-right font-mono font-semibold text-xs tabular-nums">
                              <span className="text-heading">
                                {acc.risk_score}
                              </span>
                              <span className="text-[10px] text-muted">/100</span>
                            </div>
                            <StatusSignal level={acc.risk_classification} />
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <StatusSignal level={acc.account_status} />
                        </td>

                        <td className="py-3 px-3 text-right">
                          <div className="font-mono text-xs tabular-nums">
                            <span className="text-heading">
                              +{formatInr(acc.incoming_volume_24h)}
                            </span>
                            <span className="text-muted mx-1">/</span>
                            <span className="text-muted">
                              -{formatInr(acc.outgoing_volume_24h)}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted tabular-nums">
                            {acc.incoming_frequency_24h} in · {acc.outgoing_frequency_24h} out (24h)
                          </p>
                        </td>

                        <td className="py-3 px-3 text-center">
                          <span className="inline-block font-mono text-xs text-heading tabular-nums">
                            {Math.round(acc.pass_through_ratio * 100)}%
                          </span>
                          {acc.rapid_forward_count_24h > 0 && (
                            <span className="block text-[10px] text-red-600 dark:text-red-400 font-medium">
                              {acc.rapid_forward_count_24h} rapid hops
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openProfile(acc);
                            }}
                            className="inline-flex items-center gap-1 rounded-[8px] border border-border-subtle bg-card px-2.5 py-1 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors duration-120"
                          >
                            <Eye className="h-3 w-3 text-accent-strong" />
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          <div className="flex items-center justify-between border-t border-border-subtle bg-subtle/50 px-4 py-2.5 text-xs text-muted">
            <span className="tabular-nums">
              Showing {accounts.length > 0 ? (page - 1) * limit + 1 : 0} to{' '}
              {Math.min(page * limit, total)} of {total} accounts
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-[8px] border border-border-subtle bg-card px-2.5 py-1 text-xs font-medium text-heading hover:bg-subtle disabled:opacity-40 cursor-pointer transition-colors"
              >
                Previous
              </button>
              <span className="font-mono text-heading tabular-nums">
                Page {page} of {Math.ceil(total / limit) || 1}
              </span>
              <button
                type="button"
                disabled={page * limit >= total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-[8px] border border-border-subtle bg-card px-2.5 py-1 text-xs font-medium text-heading hover:bg-subtle disabled:opacity-40 cursor-pointer transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        {/* Account Profile Modal / Drawer */}
        {drawerOpen && selectedAccount && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
            <div className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-[16px] border border-border-subtle bg-card p-6 shadow-2xl space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-border-subtle pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-semibold text-heading">
                      {selectedAccount.account_number}
                    </span>
                    <span className="rounded-[6px] border border-border-subtle bg-subtle px-2 py-0.5 text-xs font-medium text-heading">
                      {selectedAccount.bank_name}
                    </span>
                    {selectedAccount.is_frozen && (
                      <span className="rounded-[6px] border border-border-subtle bg-subtle px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                        Account frozen
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-1">
                    Holder: <strong className="text-heading font-medium">{selectedAccount.holder_name}</strong> ·
                    Branch: {selectedAccount.branch_city || 'Bengaluru'} · IFSC:{' '}
                    {selectedAccount.ifsc_code || '—'}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="rounded-[6px] p-1 text-muted hover:bg-subtle hover:text-heading cursor-pointer transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Action Banner Message */}
              {actionMessage && (
                <div
                  className={`rounded-[8px] p-3 text-xs flex items-center gap-2 border ${
                    actionMessage.type === 'success'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
                  }`}
                >
                  {actionMessage.type === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  )}
                  <span>{actionMessage.text}</span>
                </div>
              )}

              {/* Overview Risk Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-4 space-y-2">
                  <p className="text-xs font-medium text-muted">Risk assessment</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-heading tabular-nums">
                      {selectedAccount.risk_score}
                    </span>
                    <span className="text-xs text-muted">/100</span>
                    <StatusSignal level={selectedAccount.risk_classification} />
                  </div>
                  <ScoreSourceBadge source={selectedAccount.score_source} />
                  <p className="text-[11px] text-muted tabular-nums">
                    Last evaluated: {formatTimestamp(selectedAccount.last_assessed_at)}
                  </p>
                </div>

                <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-4 space-y-2">
                  <p className="text-xs font-medium text-muted">Account classification</p>
                  <div>
                    <StatusSignal level={selectedAccount.account_status} />
                    <p className="text-[11px] text-muted mt-2 leading-relaxed">
                      {selectedAccount.account_status === 'CONFIRMED_FRAUD_LINKED'
                        ? 'Confirmed fraud linkage tied to verified complaint or judicial record.'
                        : selectedAccount.account_status === 'SUSPECTED_MULE_ACCOUNT'
                          ? 'Algorithmic mule profile triggered by flow velocity and pass-through patterns.'
                          : selectedAccount.account_status === 'SUSPICIOUS_ACCOUNT'
                            ? 'Suspicious transactional counterparty connections detected.'
                            : 'Standard KYC compliance profile with no active alerts.'}
                    </p>
                  </div>
                </div>

                <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-4 space-y-2">
                  <p className="text-xs font-medium text-muted">Rapid pass-through ratio</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-heading tabular-nums">
                      {Math.round(selectedAccount.pass_through_ratio * 100)}%
                    </span>
                    <span className="text-xs text-muted tabular-nums">
                      ({selectedAccount.rapid_forward_count_24h} rapid 1h forwardings)
                    </span>
                  </div>
                  <p className="text-[11px] text-muted tabular-nums">
                    Velocity score:{' '}
                    <strong className="text-heading font-mono">{selectedAccount.velocity_score}</strong>{' '}
                    / 100
                  </p>
                </div>
              </div>

              {/* Identified Patterns & Mule Indicators */}
              <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Identified behavioral patterns & indicators
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedAccount.mule_indicators && selectedAccount.mule_indicators.length > 0 ? (
                    selectedAccount.mule_indicators.map((ind, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-[6px] border border-border-subtle bg-card px-2.5 py-1 text-xs font-medium text-heading"
                      >
                        <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                        {ind}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted">No specific mule indicators triggered.</span>
                  )}
                </div>

                {selectedAccount.risk_reasons && selectedAccount.risk_reasons.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border-subtle">
                    <p className="text-[11px] text-muted font-medium mb-1.5">Score factors:</p>
                    <ul className="list-disc list-inside space-y-1 text-xs text-body">
                      {selectedAccount.risk_reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* 24-Hour Velocity & Flow Statistics */}
              <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  24-hour flow & volume breakdown
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-muted text-[11px]">Incoming frequency</span>
                    <p className="text-base font-mono font-semibold text-heading tabular-nums">
                      {selectedAccount.incoming_frequency_24h} txs
                    </p>
                  </div>
                  <div>
                    <span className="text-muted text-[11px]">Incoming volume (24h)</span>
                    <p className="text-base font-mono font-semibold text-heading tabular-nums">
                      {formatInr(selectedAccount.incoming_volume_24h)}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted text-[11px]">Outgoing frequency</span>
                    <p className="text-base font-mono font-semibold text-heading tabular-nums">
                      {selectedAccount.outgoing_frequency_24h} txs
                    </p>
                  </div>
                  <div>
                    <span className="text-muted text-[11px]">Outgoing volume (24h)</span>
                    <p className="text-base font-mono font-semibold text-heading tabular-nums">
                      {formatInr(selectedAccount.outgoing_volume_24h)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Historical Risk Trajectory */}
              <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Risk assessment trajectory & audit events
                </p>
                {historyLoading ? (
                  <p className="text-xs text-muted">Loading trajectory events...</p>
                ) : history.length === 0 ? (
                  <p className="text-xs text-muted">No historical re-evaluation records found.</p>
                ) : (
                  <div className="space-y-2">
                    {history.map((h, i) => {
                      const delta = h.previous_score !== null ? h.new_score - h.previous_score : null;
                      return (
                        <div
                          key={h.id || i}
                          className="flex items-start justify-between border-b border-border-subtle/60 pb-2 text-xs"
                        >
                          <div>
                            <p className="font-medium text-heading">{h.trigger_event || 'Risk assessment'}</p>
                            <p className="text-[11px] text-muted tabular-nums">
                              {formatTimestamp(h.recorded_at)} · By: {h.assessed_by}
                            </p>
                            {h.reasons_json && h.reasons_json.length > 0 && (
                              <p className="text-[10px] text-muted line-clamp-1 max-w-sm">{h.reasons_json.join(', ')}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="font-mono font-medium text-heading tabular-nums">{h.new_score}/100</span>
                            {delta !== null ? (
                              <span className="block text-[10px] text-muted tabular-nums">
                                Delta: {delta > 0 ? `+${delta}` : delta}
                              </span>
                            ) : (
                              <span className="block text-[10px] text-muted">Initial</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Modal Footer Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border-subtle">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={reEvaluating}
                    onClick={() => handleReEvaluate(selectedAccount.account_id)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong text-white px-3 py-1.5 text-xs font-medium hover:bg-accent-strong-hover disabled:opacity-50 cursor-pointer transition-colors duration-120"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${reEvaluating ? 'animate-spin' : ''}`} />
                    {reEvaluating ? 'Evaluating...' : 'Re-evaluate risk'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTargetStatus(selectedAccount.account_status);
                      setOverrideError(null);
                      setOverrideModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card text-heading px-3 py-1.5 text-xs font-medium hover:bg-subtle cursor-pointer transition-colors duration-120"
                  >
                    <Layers className="h-3.5 w-3.5 text-accent-strong" />
                    Update classification
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    to={`/graph?accountId=${selectedAccount.account_id}`}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card text-heading px-3 py-1.5 text-xs font-medium hover:bg-subtle transition-colors duration-120"
                  >
                    <Boxes className="h-3.5 w-3.5 text-accent-strong" />
                    View network graph
                  </Link>

                  <Link
                    to={`/screening?receiver=${selectedAccount.account_number}`}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card text-heading px-3 py-1.5 text-xs font-medium hover:bg-subtle transition-colors duration-120"
                  >
                    <Zap className="h-3.5 w-3.5 text-accent-strong" />
                    Screen pre-transaction
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Classification Override Modal */}
        {overrideModalOpen && selectedAccount && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-[16px] border border-border-subtle bg-card p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-heading">
                  Update account classification: {selectedAccount.account_number}
                </h3>
                <button
                  type="button"
                  onClick={() => setOverrideModalOpen(false)}
                  className="rounded-[6px] p-1 text-muted hover:bg-subtle cursor-pointer transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {overrideError && (
                <div className="rounded-[8px] border border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 p-2.5 text-xs flex items-center gap-2">
                  <AlertOctagon className="h-4 w-4 shrink-0" />
                  <span>{overrideError}</span>
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-body mb-1">
                    Target classification category
                  </label>
                  <select
                    value={targetStatus}
                    onChange={(e) => setTargetStatus(e.target.value as AccountStatusClassification)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-2 text-xs text-heading focus:outline-none focus:border-accent-strong transition-colors"
                  >
                    <option value="NORMAL">Normal account</option>
                    <option value="SUSPICIOUS_ACCOUNT">Suspicious account (Pattern alert)</option>
                    <option value="SUSPECTED_MULE_ACCOUNT">
                      Suspected mule account (Pass-through hub)
                    </option>
                    <option value="CONFIRMED_FRAUD_LINKED">
                      Confirmed fraud-linked (Requires complaint/evidence)
                    </option>
                  </select>
                </div>

                {targetStatus === 'CONFIRMED_FRAUD_LINKED' && (
                  <div className="rounded-[8px] border border-border-subtle bg-subtle/50 p-3 space-y-2">
                    <p className="text-[11px] font-semibold text-heading">
                      Strict legal compliance rule:
                    </p>
                    <p className="text-[11px] text-body leading-relaxed">
                      Patterns alone must never criminalize an account. Confirmed linkage requires an
                      active Complaint ID or Evidence ID.
                    </p>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <label className="block text-[10px] text-muted mb-1">Complaint ID</label>
                        <input
                          type="text"
                          placeholder="e.g. COMP-2026-..."
                          value={overrideComplaintId}
                          onChange={(e) => setOverrideComplaintId(e.target.value)}
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-muted mb-1">Evidence vault ID</label>
                        <input
                          type="text"
                          placeholder="e.g. EVID-..."
                          value={overrideEvidenceId}
                          onChange={(e) => setOverrideEvidenceId(e.target.value)}
                          className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block font-medium text-body mb-1">
                    Officer justification note (mandatory for audit trail)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter factual justification for classification update..."
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app p-2.5 text-xs text-heading focus:outline-none focus:border-accent-strong transition-colors"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setOverrideModalOpen(false)}
                  className="rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingOverride}
                  onClick={handleClassificationSubmit}
                  className="rounded-[8px] bg-accent-strong text-white px-4 py-1.5 text-xs font-medium hover:bg-accent-strong-hover disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {submittingOverride ? 'Saving...' : 'Confirm update'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </CommandLayout>
  );
}

function AlertCircle(props: SVGProps<SVGSVGElement>) {
  return <AlertTriangle {...props} />;
}
