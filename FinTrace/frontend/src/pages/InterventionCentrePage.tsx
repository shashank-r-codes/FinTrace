import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  Fingerprint,
  Lock,
  PauseCircle,
  Play,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { ScoreSourceBadge } from '../components/common/ScoreSourceBadge';
import { CommandLayout } from '../components/layout/CommandLayout';
import {
  ApiSuccessResponse,
  HashChainVerificationReport,
  InterventionDetail,
  InterventionItem,
  InterventionMetrics,
  InterventionReviewStatus,
  RecommendedAction,
} from '../types';
import { formatInr, formatTimestamp } from '../utils/formatters';

const DISCLAIMER =
  'FinTrace returns RECOMMENDATIONS. Simulated intervention only. No actual banking freeze or fund blocking is executed on live financial rails.';

export function InterventionCentrePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const [interventions, setInterventions] = useState<InterventionItem[]>([]);
  const [metrics, setMetrics] = useState<InterventionMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<{ path?: string; status?: number; code?: string } | undefined>();

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>(initialSearch);

  // Review Modal
  const [selectedIntervention, setSelectedIntervention] = useState<InterventionDetail | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState<boolean>(false);
  const [reviewDecision, setReviewDecision] = useState<'APPROVED' | 'REJECTED' | 'ESCALATED' | 'FALSE_POSITIVE'>('APPROVED');
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [submittingReview, setSubmittingReview] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Audit Chain Verification Modal
  const [chainModalOpen, setChainModalOpen] = useState<boolean>(false);
  const [chainReport, setChainReport] = useState<HashChainVerificationReport | null>(null);
  const [chainVerifying, setChainVerifying] = useState<boolean>(false);
  const [chainError, setChainError] = useState<string | null>(null);

  // Bridge to Forensics Modal
  const [bridgeModalOpen, setBridgeModalOpen] = useState<boolean>(false);
  const [bridgeCaseTitle, setBridgeCaseTitle] = useState<string>('');
  const [bridgeGenEvidence, setBridgeGenEvidence] = useState<boolean>(true);
  const [bridgeFlagConfirmed, setBridgeFlagConfirmed] = useState<boolean>(true);
  const [bridging, setBridging] = useState<boolean>(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  const handleExecuteBridge = async () => {
    if (!selectedIntervention) return;
    setBridging(true);
    setBridgeError(null);
    try {
      const res = await apiRequest<
        ApiSuccessResponse<{
          investigation: { id: string; case_number: string };
          complaint: { id: string; complaint_number: string };
          evidence_record?: { id: string; sha256_hash: string } | null;
          message: string;
        }>
      >(`/interventions/${selectedIntervention.id}/bridge-to-forensics`, {
        method: 'POST',
        body: JSON.stringify({
          caseTitle: bridgeCaseTitle.trim() || undefined,
          generateEvidenceRecord: bridgeGenEvidence,
          flagAccountAsConfirmed: bridgeFlagConfirmed,
        }),
      });

      if (res?.data) {
        setActionMessage({
          type: 'success',
          text: `Intervention bridged to Forensic Investigation (${res.data.investigation.case_number}) with Section 91 CrPC evidence record.`,
        });
        setBridgeModalOpen(false);
        setReviewModalOpen(false);
        fetchMetrics();
        fetchInterventions();
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setBridgeError(apiErr.message || 'Failed to bridge intervention to forensics.');
    } finally {
      setBridging(false);
    }
  };

  // Fetch metrics
  const fetchMetrics = async () => {
    try {
      const res = await apiRequest<ApiSuccessResponse<InterventionMetrics>>('/interventions/metrics');
      if (res?.data) {
        setMetrics(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch intervention metrics', err);
    }
  };

  // Fetch list
  const fetchInterventions = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorDetails(undefined);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter !== 'ALL') {
        params.append('status', statusFilter);
      }
      if (actionFilter !== 'ALL') {
        params.append('action', actionFilter);
      }
      if (search.trim()) {
        params.append('search', search.trim());
      }

      const res = await apiRequest<
        ApiSuccessResponse<{
          interventions: InterventionItem[];
          total: number;
        }>
      >(`/interventions?${params.toString()}`);

      if (res?.data) {
        setInterventions(res.data.interventions || []);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        let msg = err.message;
        if (err.status === 404) {
          msg = `API endpoint not found: ${err.path || '/interventions'}. Please verify backend route mounting.`;
        } else if (err.status === 403) {
          msg = 'Access denied: Your account role does not have permission to view Transaction Interventions.';
        } else if (err.status >= 500) {
          msg = `Internal server error (${err.status}): FinTrace intervention service encountered an error.`;
        }
        setError(msg);
        setErrorDetails({ path: err.path || '/interventions', status: err.status, code: err.code });
      } else {
        const netErr = err as Error;
        setError(netErr?.message || 'Network error: Failed to connect to FinTrace API service.');
        setErrorDetails({ path: '/interventions', code: 'NETWORK_ERROR' });
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, actionFilter, search]);

  useEffect(() => {
    fetchMetrics();
    fetchInterventions();
  }, [fetchInterventions]);

  // Open item detail
  const handleOpenDetail = async (item: InterventionItem) => {
    setReviewModalOpen(true);
    setReviewError(null);
    setReviewNotes('');
    try {
      const res = await apiRequest<ApiSuccessResponse<InterventionDetail>>(`/interventions/${item.id}`);
      if (res?.data) {
        setSelectedIntervention(res.data);
        if (res.data.recommended_action === 'REJECT_BLOCK') {
          setReviewDecision('APPROVED');
        } else if (res.data.review_status === 'APPROVED') {
          setReviewDecision('APPROVED');
        } else if (res.data.review_status === 'REJECTED') {
          setReviewDecision('REJECTED');
        }
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setReviewError(apiErr.message || 'Failed to load intervention details.');
    }
  };

  // Auto-open if query param is set
  useEffect(() => {
    if (initialSearch && interventions.length > 0 && !selectedIntervention && !reviewModalOpen) {
      const match = interventions.find(
        (i) => i.screening_id.includes(initialSearch) || i.id.includes(initialSearch),
      );
      if (match) {
        handleOpenDetail(match);
      }
    }
  }, [initialSearch, interventions]);

  // Submit officer review
  const handleSubmitReview = async () => {
    if (!selectedIntervention) return;
    setReviewError(null);

    if (!reviewNotes.trim()) {
      setReviewError('An officer justification note is strictly mandatory for immutable audit logging.');
      return;
    }

    setSubmittingReview(true);
    try {
      const res = await apiRequest<
        ApiSuccessResponse<{
          intervention: InterventionItem;
          auditRecord: any;
          message: string;
        }>
      >(`/interventions/${selectedIntervention.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision: reviewDecision,
          notes: reviewNotes.trim(),
        }),
      });

      if (res?.data) {
        setActionMessage({
          type: 'success',
          text: `Intervention review recorded. Action: ${reviewDecision}. Cryptographic audit hash generated.`,
        });
        setReviewModalOpen(false);
        fetchMetrics();
        fetchInterventions();
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setReviewError(apiErr.message || 'Failed to record intervention review.');
    } finally {
      setSubmittingReview(false);
    }
  };

  // Run cryptographic chain verification
  const handleVerifyChain = async () => {
    setChainModalOpen(true);
    setChainVerifying(true);
    setChainError(null);
    try {
      const res = await apiRequest<ApiSuccessResponse<HashChainVerificationReport>>(
        '/interventions/verify-chain',
      );
      if (res?.data) {
        setChainReport(res.data);
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setChainError(apiErr.message || 'Verification endpoint failed.');
    } finally {
      setChainVerifying(false);
    }
  };

  const getStatusBadge = (s: InterventionReviewStatus) => {
    switch (s) {
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border-subtle bg-subtle text-heading">
            <Clock className="w-3 h-3 text-muted" /> Pending review
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border-subtle bg-subtle text-heading">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Confirmed / blocked
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border-subtle bg-subtle text-heading">
            <Play className="w-3 h-3 text-muted" /> Overridden / released
          </span>
        );
      case 'ESCALATED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border-subtle bg-subtle text-heading">
            <ShieldAlert className="w-3 h-3 text-red-600 dark:text-red-400" /> Escalated (LEA)
          </span>
        );
      case 'FALSE_POSITIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border-subtle bg-subtle text-heading">
            <FileCheck2 className="w-3 h-3 text-muted" /> False positive
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border-subtle bg-subtle text-heading">
            {s}
          </span>
        );
    }
  };

  const getActionBadge = (a: RecommendedAction) => {
    switch (a) {
      case 'REJECT_BLOCK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border-subtle bg-subtle text-heading">
            <Lock className="w-3 h-3 text-red-600 dark:text-red-400" /> Reject / Block
          </span>
        );
      case 'HOLD_FOR_REVIEW':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border-subtle bg-subtle text-heading">
            <PauseCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" /> Hold for review
          </span>
        );
      case 'ADDITIONAL_VERIFICATION':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border-subtle bg-subtle text-heading">
            <ShieldAlert className="w-3 h-3 text-muted" /> Additional verification
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium border border-border-subtle bg-subtle text-heading">
            Allow
          </span>
        );
    }
  };

  return (
    <CommandLayout
      title="Transaction intervention centre"
      section="Fraud prevention"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleVerifyChain}
            className="flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
          >
            <Fingerprint className="h-3.5 w-3.5 text-accent-strong" />
            <span>Verify audit chain</span>
          </button>
          <button
            type="button"
            onClick={() => {
              fetchMetrics();
              fetchInterventions();
            }}
            className="flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-muted ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh queue</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Safety Disclaimer Banner */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-3.5 text-xs text-body flex items-start gap-2.5">
          <Shield className="h-4 w-4 text-muted shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium text-heading">
              Pre-authorisation prevention architecture
            </p>
            <p className="text-[11px] text-muted">{DISCLAIMER}</p>
          </div>
        </section>

        {/* Global Action Message */}
        {actionMessage && (
          <div
            className={`rounded-[8px] p-3 text-xs flex items-center justify-between border ${
              actionMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800'
                : 'bg-red-50 text-red-900 border-red-300 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800'
            }`}
          >
            <span>{actionMessage.text}</span>
            <button
              type="button"
              onClick={() => setActionMessage(null)}
              className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* KPI / Metric Summary Bar */}
        {metrics && (
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-muted">Total interventions</span>
              <p className="text-xl font-semibold tabular-nums text-heading">{metrics.total_interventions}</p>
              <span className="text-[10px] text-muted">Evaluated transfers</span>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1">
              <div className="flex items-center justify-between text-muted">
                <span className="text-[11px] font-medium text-muted">Pending review</span>
                <Clock className="w-3.5 h-3.5 text-muted" />
              </div>
              <p className="text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                {metrics.pending_count}
              </p>
              <span className="text-[10px] text-muted">Officer queue</span>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-muted">
                Intercepted exposure
              </span>
              <p className="text-xl font-semibold tabular-nums text-heading">
                {formatInr(metrics.total_intercepted_amount)}
              </p>
              <span className="text-[10px] text-muted">Hold & block total</span>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-muted">
                Prevented loss
              </span>
              <p className="text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatInr(metrics.total_prevented_loss_amount)}
              </p>
              <span className="text-[10px] text-muted">Confirmed actions</span>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-muted">
                Officer override rate
              </span>
              <p className="text-xl font-semibold tabular-nums text-heading">
                {metrics.override_rate_pct}%
              </p>
              <span className="text-[10px] text-muted">
                {metrics.override_count} released transfers
              </span>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-muted">False positive rate</span>
              <p className="text-xl font-semibold tabular-nums text-heading">
                {metrics.false_positive_rate_pct}%
              </p>
              <span className="text-[10px] text-muted">
                {metrics.false_positive_count} commercial / retail
              </span>
            </div>
          </section>
        )}

        {/* Filter Toolbar */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-3.5 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Status Tabs */}
            <div className="inline-flex flex-wrap items-center gap-1 rounded-[8px] border border-border-subtle bg-subtle/50 p-0.5">
              {[
                { id: 'ALL', label: 'All interventions' },
                { id: 'PENDING', label: 'Pending review' },
                { id: 'APPROVED', label: 'Confirmed / blocked' },
                { id: 'REJECTED', label: 'Overridden / released' },
                { id: 'ESCALATED', label: 'Escalated (LEA)' },
                { id: 'FALSE_POSITIVE', label: 'False positives' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-[6px] text-xs font-medium cursor-pointer transition-colors ${
                    statusFilter === tab.id
                      ? 'bg-card text-heading font-semibold shadow-xs border border-border-strong/40'
                      : 'text-muted hover:text-heading'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Action Filter & Search */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search account, holder, screening ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs rounded-[8px] border border-border-subtle bg-app text-heading focus:outline-none focus:border-accent-strong w-64 transition-colors"
                />
              </div>

              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="text-xs rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-heading focus:outline-none transition-colors"
              >
                <option value="ALL">All actions</option>
                <option value="REJECT_BLOCK">Reject / block</option>
                <option value="HOLD_FOR_REVIEW">Hold for review</option>
                <option value="ADDITIONAL_VERIFICATION">Additional verification</option>
              </select>

              {(search || statusFilter !== 'ALL' || actionFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('ALL');
                    setActionFilter('ALL');
                    setSearchParams({});
                  }}
                  className="text-xs text-muted hover:text-heading px-2 py-1 rounded-[6px] border border-border-subtle bg-card cursor-pointer transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Interventions Queue Table */}
        <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={6} cols={9} />
            </div>
          ) : error ? (
            <div className="p-6">
              <ErrorDataState
                message={error}
                onRetry={fetchInterventions}
                technicalDetails={errorDetails}
              />
            </div>
          ) : interventions.length === 0 ? (
            <div className="p-8">
              <EmptyDataState
                title="Intervention queue clear"
                description="No transactions match current filters. All pending pre-authorisation actions are resolved."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border-subtle bg-subtle/50 text-[11px] font-medium uppercase tracking-wider text-muted">
                    <th className="py-2.5 px-3">Intercepted at / ID</th>
                    <th className="py-2.5 px-3">Recommended action</th>
                    <th className="py-2.5 px-3">Amount & rail</th>
                    <th className="py-2.5 px-3">Sender account</th>
                    <th className="py-2.5 px-3">Receiver account</th>
                    <th className="py-2.5 px-3">Risk assessment</th>
                    <th className="py-2.5 px-3">Review status</th>
                    <th className="py-2.5 px-3">Officer review</th>
                    <th className="py-2.5 px-3 text-right">Intervene</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {interventions.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-subtle/60 transition-colors duration-120"
                    >
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-medium text-heading tabular-nums">
                          {formatTimestamp(item.created_at)}
                        </div>
                        <div className="font-mono text-[10px] text-muted">
                          ID: {item.screening_id.substring(0, 8)}...
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {getActionBadge(item.recommended_action)}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-medium text-heading font-mono tabular-nums">{formatInr(item.amount)}</div>
                        <span className="font-mono text-[10px] text-muted">
                          {item.channel}
                        </span>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="font-medium text-heading">{item.sender_holder_name}</div>
                        <div className="font-mono text-[11px] text-muted">
                          {item.sender_account_number} ({item.sender_bank_name})
                        </div>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="font-medium text-heading">{item.receiver_holder_name}</div>
                        <div className="font-mono text-[11px] text-muted">
                          {item.receiver_account_number} ({item.receiver_bank_name})
                        </div>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold text-heading tabular-nums">
                            {item.composite_risk_score}
                          </span>
                          <span className="text-[10px] text-muted">({item.risk_classification})</span>
                        </div>
                        <div className="mt-0.5">
                          <ScoreSourceBadge source={item.score_source} />
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {getStatusBadge(item.review_status)}
                      </td>

                      <td className="py-2.5 px-3">
                        {item.resolved_by ? (
                          <div className="space-y-0.5">
                            <p className="text-[11px] font-medium text-heading truncate">
                              {item.resolver_name}
                            </p>
                            <p className="text-[10px] text-muted truncate">{item.resolver_role}</p>
                            {item.review_notes && (
                              <p className="text-[10px] text-muted line-clamp-1 italic">
                                "{item.review_notes}"
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted text-[11px]">Awaiting review</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(item)}
                          className="rounded-[8px] border border-border-subtle bg-card px-2.5 py-1 text-xs font-medium text-heading hover:bg-subtle cursor-pointer inline-flex items-center gap-1 transition-colors"
                        >
                          <span>Review</span>
                          <ArrowRight className="w-3 h-3 text-accent-strong" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Review & Intervene Modal */}
        {reviewModalOpen && selectedIntervention && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-[16px] border border-border-subtle bg-card p-5 shadow-2xl space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-border-subtle pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-heading">
                      Intervention decision: {selectedIntervention.screening_id.substring(0, 16)}...
                    </h3>
                    {getActionBadge(selectedIntervention.recommended_action)}
                    {getStatusBadge(selectedIntervention.review_status)}
                  </div>
                  <p className="text-xs text-muted tabular-nums">
                    Screened on {formatTimestamp(selectedIntervention.screened_at)} · Channel: {selectedIntervention.channel}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewModalOpen(false)}
                  className="rounded-[6px] p-1 text-muted hover:bg-subtle cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {reviewError && (
                <div className="rounded-[8px] border border-red-300 bg-red-50 p-2.5 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                  {reviewError}
                </div>
              )}

              {/* Transaction & Party Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* Sender */}
                <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-3 space-y-2">
                  <span className="font-semibold text-muted uppercase text-[10px]">Originating sender</span>
                  <div>
                    <p className="font-medium text-heading text-sm">{selectedIntervention.sender_holder_name}</p>
                    <p className="font-mono text-muted">{selectedIntervention.sender_account_number}</p>
                    <p className="text-muted">{selectedIntervention.sender_bank_name}</p>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-border-subtle text-[11px]">
                    <span className="text-muted">Account risk:</span>
                    <span className="font-mono font-medium text-heading tabular-nums">{selectedIntervention.sender_risk_score}/100</span>
                  </div>
                </div>

                {/* Receiver */}
                <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-3 space-y-2">
                  <span className="font-semibold text-muted uppercase text-[10px]">Beneficiary receiver</span>
                  <div>
                    <p className="font-medium text-heading text-sm">{selectedIntervention.receiver_holder_name}</p>
                    <p className="font-mono text-muted">{selectedIntervention.receiver_account_number}</p>
                    <p className="text-muted">{selectedIntervention.receiver_bank_name}</p>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-border-subtle text-[11px]">
                    <span className="text-muted">Account risk:</span>
                    <span className="font-mono font-medium text-heading tabular-nums">{selectedIntervention.receiver_risk_score}/100</span>
                  </div>
                </div>
              </div>

              {/* Transaction Amount & Risk Score */}
              <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-semibold text-muted uppercase">Intercepted transfer amount</span>
                  <p className="text-xl font-semibold text-heading font-mono tabular-nums">{formatInr(selectedIntervention.amount)}</p>
                </div>

                <div>
                  <span className="text-[10px] font-semibold text-muted uppercase">Composite risk score</span>
                  <p className="text-xl font-semibold text-heading font-mono tabular-nums">
                    {selectedIntervention.composite_risk_score} / 100
                  </p>
                </div>

                <div>
                  <span className="text-[10px] font-semibold text-muted uppercase">Score source</span>
                  <div className="mt-1">
                    <ScoreSourceBadge source={selectedIntervention.score_source} />
                  </div>
                </div>
              </div>

              {/* Triggered Factors */}
              {selectedIntervention.rules_triggered && selectedIntervention.rules_triggered.length > 0 && (
                <div className="space-y-1.5 text-xs">
                  <span className="font-semibold text-muted uppercase text-[10px]">Triggered risk rules</span>
                  <div className="space-y-1">
                    {selectedIntervention.rules_triggered.map((rule, idx) => (
                      <div
                        key={idx}
                        className="flex items-start justify-between rounded-[8px] border border-border-subtle bg-subtle/30 p-2 text-xs"
                      >
                        <span className="font-medium text-heading">{rule.name}</span>
                        <span className="font-mono font-medium text-heading tabular-nums">
                          +{rule.contribution} pts
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Immutable Audit Log Chain for this Intervention */}
              {selectedIntervention.audit_trail && selectedIntervention.audit_trail.length > 0 && (
                <div className="space-y-1.5 text-xs">
                  <span className="font-semibold text-muted uppercase text-[10px] flex items-center gap-1">
                    <Fingerprint className="w-3.5 h-3.5 text-accent-strong" />
                    <span>Cryptographic audit entries ({selectedIntervention.audit_trail.length})</span>
                  </span>
                  <div className="rounded-[8px] border border-border-subtle bg-subtle/30 p-2.5 max-h-32 overflow-y-auto space-y-1.5">
                    {selectedIntervention.audit_trail.map((al) => (
                      <div key={al.id} className="text-[11px] font-mono border-b border-border-subtle/50 pb-1">
                        <div className="flex justify-between text-muted">
                          <span>Seq #{al.sequence_number} · {al.action}</span>
                          <span className="tabular-nums">{formatTimestamp(al.created_at)}</span>
                        </div>
                        <p className="text-heading truncate text-[10px]">
                          Hash: {al.entry_hash}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Officer Decision Form */}
              <div className="space-y-3 pt-2 border-t border-border-subtle text-xs">
                <div>
                  <label className="block font-medium text-body mb-1">
                    Select officer intervention action
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setReviewDecision('APPROVED')}
                      className={`p-2 rounded-[8px] border text-center font-medium cursor-pointer transition-colors ${
                        reviewDecision === 'APPROVED'
                          ? 'border-border-strong bg-card text-heading font-semibold shadow-xs'
                          : 'border-border-subtle bg-subtle/50 text-muted hover:text-heading'
                      }`}
                    >
                      Confirm hold/block
                    </button>

                    <button
                      type="button"
                      onClick={() => setReviewDecision('REJECTED')}
                      className={`p-2 rounded-[8px] border text-center font-medium cursor-pointer transition-colors ${
                        reviewDecision === 'REJECTED'
                          ? 'border-border-strong bg-card text-heading font-semibold shadow-xs'
                          : 'border-border-subtle bg-subtle/50 text-muted hover:text-heading'
                      }`}
                    >
                      Override & release
                    </button>

                    <button
                      type="button"
                      onClick={() => setReviewDecision('ESCALATED')}
                      className={`p-2 rounded-[8px] border text-center font-medium cursor-pointer transition-colors ${
                        reviewDecision === 'ESCALATED'
                          ? 'border-border-strong bg-card text-heading font-semibold shadow-xs'
                          : 'border-border-subtle bg-subtle/50 text-muted hover:text-heading'
                      }`}
                    >
                      Escalate to LEA
                    </button>

                    <button
                      type="button"
                      onClick={() => setReviewDecision('FALSE_POSITIVE')}
                      className={`p-2 rounded-[8px] border text-center font-medium cursor-pointer transition-colors ${
                        reviewDecision === 'FALSE_POSITIVE'
                          ? 'border-border-strong bg-card text-heading font-semibold shadow-xs'
                          : 'border-border-subtle bg-subtle/50 text-muted hover:text-heading'
                      }`}
                    >
                      False positive
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-body mb-1">
                    Officer justification note (required for audit trail)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter factual rationale for confirming, overriding, or escalating this transaction intervention..."
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app p-2.5 text-xs text-heading focus:outline-none focus:border-accent-strong transition-colors"
                  />
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => {
                    setBridgeCaseTitle(
                      `Section 91 CrPC: Intercept on ${selectedIntervention.screening_id.slice(0, 8)}`
                    );
                    setBridgeModalOpen(true);
                  }}
                  className="rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer flex items-center gap-1.5 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 text-accent-strong" />
                  <span>Bridge to forensics (Section 91 CrPC)</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setReviewModalOpen(false)}
                    className="rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submittingReview}
                    onClick={handleSubmitReview}
                    className="rounded-[8px] bg-accent-strong text-white px-4 py-1.5 text-xs font-medium hover:bg-accent-strong-hover disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {submittingReview ? 'Recording decision...' : 'Commit officer decision'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bridge to Forensics Modal */}
        {bridgeModalOpen && selectedIntervention && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
            <div className="relative w-full max-w-lg rounded-[16px] border border-border-subtle bg-card p-5 shadow-2xl space-y-4">
              <div className="flex items-start justify-between border-b border-border-subtle pb-2.5">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-accent-strong" />
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-heading">
                      Bridge to forensic investigation (Section 91 CrPC)
                    </h3>
                    <p className="text-[11px] text-muted">
                      Transition from pre-authorisation to police casework
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBridgeModalOpen(false)}
                  className="rounded-[6px] p-1 text-muted hover:bg-subtle cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {bridgeError && (
                <div className="rounded-[8px] border border-red-300 bg-red-50 p-2.5 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                  {bridgeError}
                </div>
              )}

              <div className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-medium text-body mb-1">
                    Investigation case title
                  </label>
                  <input
                    type="text"
                    value={bridgeCaseTitle}
                    onChange={(e) => setBridgeCaseTitle(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:outline-none focus:border-accent-strong transition-colors"
                  />
                </div>

                <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-3 space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bridgeGenEvidence}
                      onChange={(e) => setBridgeGenEvidence(e.target.checked)}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="font-medium text-heading block">
                        Generate immutable Section 91 CrPC evidence record
                      </span>
                      <span className="text-[11px] text-muted block">
                        Deposits pre-authorisation screening metrics and SHA-256 hash directly into the Evidence Vault.
                      </span>
                    </div>
                  </label>
                </div>

                <div className="rounded-[12px] border border-border-subtle bg-subtle/30 p-3 space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bridgeFlagConfirmed}
                      onChange={(e) => setBridgeFlagConfirmed(e.target.checked)}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="font-medium text-heading block">
                        Flag beneficiary as confirmed fraud-linked
                      </span>
                      <span className="text-[11px] text-muted block">
                        Upgrades beneficiary account in the Risk Registry and invalidates screening cache so subsequent inflows are blocked.
                      </span>
                    </div>
                  </label>
                </div>

                <div className="rounded-[8px] border border-border-subtle bg-subtle/40 p-2.5 text-[11px] text-body">
                  <strong>Statutory basis:</strong> Creates an official FIR/case record linking the intercepted amount ({formatInr(selectedIntervention.amount)}) directly to downstream money trails and ATM surveillance.
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setBridgeModalOpen(false)}
                  className="rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={bridging}
                  onClick={handleExecuteBridge}
                  className="rounded-[8px] bg-accent-strong text-white px-4 py-1.5 text-xs font-medium hover:bg-accent-strong-hover disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {bridging ? 'Creating case & evidence...' : 'Bridge to forensic case'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Audit Chain Verification Modal */}
        {chainModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="relative w-full max-w-lg rounded-[16px] border border-border-subtle bg-card p-5 shadow-2xl space-y-4">
              <div className="flex items-start justify-between border-b border-border-subtle pb-3">
                <div className="flex items-center gap-2">
                  <Fingerprint className="w-5 h-5 text-accent-strong" />
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-heading">
                      Cryptographic audit trail verification
                    </h3>
                    <p className="text-[11px] text-muted">
                      SHA-256 sequential hash-chain integrity audit
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setChainModalOpen(false)}
                  className="rounded-[6px] p-1 text-muted hover:bg-subtle cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {chainVerifying ? (
                <div className="py-8 text-center space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-accent-strong mx-auto" />
                  <p className="text-xs text-muted">Verifying sequential cryptographic hashes...</p>
                </div>
              ) : chainError ? (
                <div className="rounded-[8px] border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                  {chainError}
                </div>
              ) : chainReport ? (
                <div className="space-y-3.5 text-xs">
                  {/* Status Card */}
                  <div className="rounded-[12px] p-3.5 border border-border-subtle bg-subtle/30 flex items-center gap-3">
                    {chainReport.status === 'VALID' ? (
                      <ShieldCheck className="w-8 h-8 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <ShieldAlert className="w-8 h-8 text-red-600 shrink-0" />
                    )}
                    <div>
                      <h4 className="font-semibold text-heading">
                        {chainReport.status === 'VALID'
                          ? 'Audit chain verified: Intact & tamper-evident'
                          : 'Integrity alert: Broken hash link detected'}
                      </h4>
                      <p className="text-[11px] text-muted mt-0.5">
                        {chainReport.status === 'VALID'
                          ? `All ${chainReport.total_entries_verified} sequential log entries are cryptographically linked without omission or modification.`
                          : chainReport.broken_details || 'Hash mismatch identified.'}
                      </p>
                    </div>
                  </div>

                  {/* Hash Details */}
                  <div className="rounded-[8px] border border-border-subtle bg-app p-3 space-y-2 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-muted">Total verified records:</span>
                      <span className="font-medium text-heading tabular-nums">{chainReport.total_entries_verified}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Sequence range:</span>
                      <span className="font-medium text-heading tabular-nums">
                        Seq #{chainReport.first_sequence} → Seq #{chainReport.last_sequence}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted block">Genesis block hash:</span>
                      <span className="text-heading truncate block">{chainReport.genesis_hash}</span>
                    </div>
                    <div>
                      <span className="text-muted block">Latest head hash:</span>
                      <span className="text-heading truncate block">{chainReport.latest_hash}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-border-subtle text-[10px]">
                      <span className="text-muted">Verified timestamp:</span>
                      <span className="text-muted tabular-nums">{formatTimestamp(chainReport.verified_at)}</span>
                    </div>
                  </div>

                  <div className="rounded-[8px] border border-border-subtle bg-subtle/40 p-2.5 text-[11px] text-body">
                    <strong>Statutory compliance:</strong> Continuous hash-chain satisfies Section 65B of the Indian Evidence Act for electronic forensic admissibility.
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-end pt-3 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setChainModalOpen(false)}
                  className="rounded-[8px] bg-accent-strong text-white px-4 py-1.5 text-xs font-medium hover:bg-accent-strong-hover cursor-pointer transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </CommandLayout>
  );
}
