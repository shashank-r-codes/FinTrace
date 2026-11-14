import {
  ArrowDownLeft,
  Boxes,
  CircleDot,
  Cpu,
  Eye,
  Lock,
  Network,
  RefreshCw,
  Search,
  Share2,
  Shield,
  ShieldAlert,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { CommandLayout } from '../components/layout/CommandLayout';
import {
  AccountGraphIntelligence,
  ApiSuccessResponse,
  MuleCluster,
  MuleClusterMember,
  MuleClustersResponse,
  MuleClusterType,
} from '../types';
import { formatInr, formatTimestamp } from '../utils/formatters';

const DISCLAIMER =
  'FinTrace returns RECOMMENDATIONS. Simulated intervention only. No actual banking freeze or fund blocking is executed on live financial rails.';

export function MuleSyndicatesPage() {
  const [searchParams] = useSearchParams();
  const initialClusterId = searchParams.get('clusterId') || '';

  const [clustersData, setClustersData] = useState<MuleClustersResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<{ path?: string; status?: number; code?: string } | undefined>();

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>(initialClusterId);
  const [minRisk, setMinRisk] = useState<number>(30);

  // Selected cluster for inspection
  const [selectedCluster, setSelectedCluster] = useState<MuleCluster | null>(null);
  const [clusterModalOpen, setClusterModalOpen] = useState<boolean>(false);

  // Coordinated Freeze Action simulation
  const [actionAlert, setActionAlert] = useState<{ type: 'success' | 'info'; text: string } | null>(null);
  const [recommendingFreeze, setRecommendingFreeze] = useState<boolean>(false);

  // Single Account Graph Intelligence Deep Dive
  const [inspectedAccountId, setInspectedAccountId] = useState<string | null>(null);
  const [accountIntel, setAccountIntel] = useState<AccountGraphIntelligence | null>(null);
  const [intelLoading, setIntelLoading] = useState<boolean>(false);
  const [intelError, setIntelError] = useState<string | null>(null);

  const fetchClusters = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorDetails(undefined);
    try {
      const params = new URLSearchParams({
        minClusterSize: '2',
        minRiskScore: String(minRisk),
      });

      const res = await apiRequest<ApiSuccessResponse<MuleClustersResponse>>(
        `/graph/mule-clusters?${params.toString()}`,
      );

      if (res?.data) {
        setClustersData(res.data);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        let msg = err.message;
        if (err.status === 404) {
          msg = `API endpoint not found: ${err.path || '/graph/mule-clusters'}. Please verify backend route mounting.`;
        } else if (err.status === 403) {
          msg = 'Access denied: Your account role does not have permission to view Mule Syndicate detections.';
        } else if (err.status >= 500) {
          msg = `Internal server error (${err.status}): FinTrace graph engine encountered an error.`;
        }
        setError(msg);
        setErrorDetails({ path: err.path || '/graph/mule-clusters', status: err.status, code: err.code });
      } else {
        const netErr = err as Error;
        setError(netErr?.message || 'Network error: Failed to connect to FinTrace API service.');
        setErrorDetails({ path: '/graph/mule-clusters', code: 'NETWORK_ERROR' });
      }
    } finally {
      setLoading(false);
    }
  }, [minRisk]);

  useEffect(() => {
    fetchClusters();
  }, [fetchClusters]);

  // Open inspection drawer
  const handleInspectCluster = (cluster: MuleCluster) => {
    setSelectedCluster(cluster);
    setClusterModalOpen(true);
    setActionAlert(null);
  };

  // Auto-open if query param is set
  useEffect(() => {
    if (initialClusterId && clustersData?.clusters) {
      const match = clustersData.clusters.find((c) => c.cluster_id === initialClusterId);
      if (match) {
        handleInspectCluster(match);
      }
    }
  }, [initialClusterId, clustersData]);

  // Inspect specific account graph intelligence
  const handleInspectAccountIntel = async (accountId: string) => {
    setInspectedAccountId(accountId);
    setIntelLoading(true);
    setIntelError(null);
    try {
      const res = await apiRequest<ApiSuccessResponse<AccountGraphIntelligence>>(
        `/graph/account/${accountId}/intelligence`,
      );
      if (res?.data) {
        setAccountIntel(res.data);
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setIntelError(apiErr.message || 'Failed to fetch account graph metrics.');
    } finally {
      setIntelLoading(false);
    }
  };

  // Simulate coordinated freeze recommendation
  const handleRecommendCoordinatedFreeze = (cluster: MuleCluster) => {
    setRecommendingFreeze(true);
    setTimeout(() => {
      setRecommendingFreeze(false);
      setActionAlert({
        type: 'success',
        text: `Coordinated Pre-Authorisation Freeze recommendation issued for all ${cluster.member_count} syndicate nodes across partner banks. Total exposure protected: ${formatInr(cluster.total_flow_amount)}. (Simulated recommendation).`,
      });
    }, 600);
  };

  // Filtered clusters list
  const filteredClusters = (clustersData?.clusters || []).filter((c) => {
    if (typeFilter !== 'ALL' && c.cluster_type !== typeFilter) return false;
    if (severityFilter !== 'ALL' && c.severity !== severityFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchId = c.cluster_id.toLowerCase().includes(q);
      const matchMember = c.members.some(
        (m) =>
          m.account_number.toLowerCase().includes(q) ||
          m.holder_name.toLowerCase().includes(q),
      );
      if (!matchId && !matchMember) return false;
    }
    return true;
  });

  const getClusterTypeBadge = (t: MuleClusterType) => {
    switch (t) {
      case 'MULE_RING_CYCLE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30 whitespace-nowrap">
            <RefreshCw className="w-3 h-3 text-red-600" /> Circular Mule Ring
          </span>
        );
      case 'FAN_OUT_DISPERSAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30 whitespace-nowrap">
            <Share2 className="w-3 h-3 text-orange-600" /> Fan-Out Dispersal
          </span>
        );
      case 'RAPID_PASS_THROUGH_CHAIN':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 whitespace-nowrap">
            <Zap className="w-3 h-3 text-amber-600" /> Pass-Through Chain
          </span>
        );
      case 'FUNNEL_COLLECTION':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 whitespace-nowrap">
            <ArrowDownLeft className="w-3 h-3 text-purple-600" /> Funnel Aggregation
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 whitespace-nowrap">
            <Boxes className="w-3 h-3 text-sky-600" /> Suspicious Community
          </span>
        );
    }
  };

  const getSeverityBadge = (s: string) => {
    switch (s) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white shadow-xs">
            CRITICAL
          </span>
        );
      case 'HIGH':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-700 dark:text-orange-300 border border-orange-500/40">
            HIGH
          </span>
        );
      case 'MEDIUM':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40">
            MEDIUM
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40">
            LOW
          </span>
        );
    }
  };

  const getMemberRoleBadge = (role: MuleClusterMember['role']) => {
    switch (role) {
      case 'SOURCE':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30">
            SOURCE
          </span>
        );
      case 'INTERMEDIARY_MULE':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
            INTERMEDIARY MULE
          </span>
        );
      case 'CASH_OUT_SINK':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white shadow-xs">
            CASH-OUT SINK
          </span>
        );
      case 'COORDINATOR':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-600 text-white shadow-xs">
            COORDINATOR
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-500/15 text-slate-700 dark:text-slate-300">
            MEMBER
          </span>
        );
    }
  };

  const cycleCount = (clustersData?.clusters || []).filter((c) => c.has_cycle).length;

  return (
    <CommandLayout
      title="Mule Syndicates & Ring Detection"
      section="Fraud Prevention"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchClusters}
            className="flex items-center gap-1.5 rounded-[5px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-medium text-heading hover:bg-highlight cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Re-scan Network</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Safety Disclaimer Banner */}
        <div className="rounded-[10px] border border-border-subtle bg-subtle p-3 text-xs text-body flex items-start gap-2.5">
          <Shield className="h-4 w-4 text-muted shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium text-heading">
              Pre-Authorisation Prevention Architecture
            </p>
            <p className="text-[11px] text-muted">{DISCLAIMER}</p>
          </div>
        </div>

        {/* Global Action Message */}
        {actionAlert && (
          <div className="rounded-[8px] p-3 text-xs bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border border-emerald-500/20 flex items-center justify-between">
            <span>{actionAlert.text}</span>
            <button
              type="button"
              onClick={() => setActionAlert(null)}
              className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Summary Metric Cards */}
        {clustersData && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-muted mb-1">
                <span className="text-[11px] font-medium text-muted">Detected clusters</span>
                <Boxes className="h-4 w-4 text-muted" />
              </div>
              <p className="text-xl font-semibold tabular-nums text-heading">{clustersData.total_clusters}</p>
              <p className="text-[11px] text-muted mt-0.5">Syndicate topologies</p>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-muted mb-1">
                <span className="text-[11px] font-medium text-muted">High & critical severity</span>
                <ShieldAlert className="h-4 w-4 text-red-500" />
              </div>
              <p className="text-xl font-semibold tabular-nums text-red-600 dark:text-red-400">
                {clustersData.high_risk_clusters}
              </p>
              <p className="text-[11px] text-muted mt-0.5">
                Immediate intervention queue
              </p>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-muted mb-1">
                <span className="text-[11px] font-medium text-muted">Flagged mule accounts</span>
                <Users className="h-4 w-4 text-amber-500" />
              </div>
              <p className="text-xl font-semibold tabular-nums text-heading">
                {clustersData.total_flagged_accounts}
              </p>
              <p className="text-[11px] text-muted mt-0.5">
                Active syndicate members
              </p>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-muted mb-1">
                <span className="text-[11px] font-medium text-muted">Circular transfer rings</span>
                <RefreshCw className="h-4 w-4 text-purple-500" />
              </div>
              <p className="text-xl font-semibold tabular-nums text-heading">
                {cycleCount}
              </p>
              <p className="text-[11px] text-muted mt-0.5">
                Closed loops detected
              </p>
            </div>

            <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-muted mb-1">
                <span className="text-[11px] font-medium text-muted">Syndicate exposure</span>
                <Lock className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatInr(clustersData.total_exposure_amount)}
              </p>
              <p className="text-[11px] text-muted mt-0.5">
                Aggregated fund flow
              </p>
            </div>
          </div>
        )}

        {/* Filter Toolbar */}
        <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 shadow-xs space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
              <input
                type="text"
                placeholder="Search by cluster ID, account number, or holder name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-border-subtle bg-app text-heading focus:outline-none focus:border-accent-strong"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="text-xs rounded border border-border-subtle bg-app px-2.5 py-1.5 text-heading focus:outline-none"
              >
                <option value="ALL">All Cluster Topologies</option>
                <option value="MULE_RING_CYCLE">Circular Mule Rings</option>
                <option value="FAN_OUT_DISPERSAL">Fan-Out Dispersals</option>
                <option value="RAPID_PASS_THROUGH_CHAIN">Pass-Through Chains</option>
                <option value="FUNNEL_COLLECTION">Funnel Aggregations</option>
                <option value="SUSPICIOUS_COMMUNITY">Suspicious Communities</option>
              </select>

              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="text-xs rounded border border-border-subtle bg-app px-2.5 py-1.5 text-heading focus:outline-none"
              >
                <option value="ALL">All Severities</option>
                <option value="CRITICAL">Critical Severity</option>
                <option value="HIGH">High Severity</option>
                <option value="MEDIUM">Medium Severity</option>
              </select>

              <div className="flex items-center gap-1 text-xs text-muted">
                <span>Min Risk:</span>
                <select
                  value={minRisk}
                  onChange={(e) => setMinRisk(Number(e.target.value))}
                  className="text-xs rounded border border-border-subtle bg-app px-2 py-1 text-heading focus:outline-none"
                >
                  <option value="20">20+</option>
                  <option value="30">30+</option>
                  <option value="50">50+</option>
                  <option value="70">70+</option>
                </select>
              </div>

              {(search || typeFilter !== 'ALL' || severityFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setTypeFilter('ALL');
                    setSeverityFilter('ALL');
                  }}
                  className="text-xs text-muted hover:text-heading px-2 py-1 rounded border border-border-subtle bg-app cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Clusters List Table */}
        <div className="rounded-lg border border-border-subtle bg-card shadow-xs overflow-hidden">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={6} />
            </div>
          ) : error ? (
            <div className="p-6">
              <ErrorDataState
                message={error}
                onRetry={fetchClusters}
                technicalDetails={errorDetails}
              />
            </div>
          ) : filteredClusters.length === 0 ? (
            <div className="p-8">
              <EmptyDataState
                title="No Mule Syndicates Detected"
                description="No clusters match your search or minimum risk score criteria. Adjust the sensitivity threshold or clear search filters."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border-subtle bg-subtle/50 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    <th className="py-2.5 px-3">Cluster ID & Detection</th>
                    <th className="py-2.5 px-3">Topology Structure</th>
                    <th className="py-2.5 px-3">Severity</th>
                    <th className="py-2.5 px-3">Members & Roles</th>
                    <th className="py-2.5 px-3">Total Financial Flow</th>
                    <th className="py-2.5 px-3">Transfer Latency</th>
                    <th className="py-2.5 px-3">Recommended Intervention</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {filteredClusters.map((cluster) => {
                    const rolesPresent = Array.from(new Set(cluster.members.map((m) => m.role)));
                    return (
                      <tr
                        key={cluster.cluster_id}
                        className="hover:bg-highlight/50 transition-colors duration-150"
                      >
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-mono font-bold text-heading">
                            {cluster.cluster_id}
                          </div>
                          <div className="text-[10px] text-muted">
                            {formatTimestamp(cluster.detected_at)}
                          </div>
                        </td>

                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="space-y-1">
                            {getClusterTypeBadge(cluster.cluster_type)}
                            {cluster.has_cycle && (
                              <div className="text-[10px] text-red-600 dark:text-red-400 font-bold flex items-center gap-1">
                                <CircleDot className="w-3 h-3" />
                                <span>Closed Cycle ({cluster.cycle_nodes.length} nodes)</span>
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {getSeverityBadge(cluster.severity)}
                            <span className="font-mono font-bold text-heading">
                              {cluster.risk_score}
                            </span>
                          </div>
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="space-y-1">
                            <span className="font-semibold text-heading">
                              {cluster.member_count} Accounts
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {rolesPresent.slice(0, 3).map((r) => (
                                <span
                                  key={r}
                                  className="text-[9px] font-mono px-1 rounded bg-border-subtle/50 text-muted"
                                >
                                  {r.replace('_', ' ')}
                                </span>
                              ))}
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-bold text-heading">
                            {formatInr(cluster.total_flow_amount)}
                          </div>
                          <span className="text-[10px] text-muted">
                            {cluster.transaction_count} transfers
                          </span>
                        </td>

                        <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-muted">
                          {cluster.avg_transfer_latency_sec !== null
                            ? `${cluster.avg_transfer_latency_sec}s avg`
                            : '—'}
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="space-y-0.5">
                            <span className="text-xs font-semibold text-red-600 dark:text-red-400 truncate block max-w-xs">
                              {cluster.recommended_action.replace(/_/g, ' ')}
                            </span>
                            {cluster.identified_patterns[0] && (
                              <span className="text-[10px] text-muted truncate block max-w-xs">
                                {cluster.identified_patterns[0]}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleInspectCluster(cluster)}
                            className="rounded border border-border-subtle bg-app px-2.5 py-1 text-xs text-heading hover:bg-highlight cursor-pointer inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Inspect</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Selected Cluster Deep-Dive Drawer / Modal */}
        {clusterModalOpen && selectedCluster && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <div className="relative w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-lg border border-border-subtle bg-card p-5 shadow-2xl space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between border-b border-border-subtle pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-heading">
                      Syndicate Topology: {selectedCluster.cluster_id}
                    </h3>
                    {getClusterTypeBadge(selectedCluster.cluster_type)}
                    {getSeverityBadge(selectedCluster.severity)}
                  </div>
                  <p className="text-xs text-muted">
                    Detected on {formatTimestamp(selectedCluster.detected_at)} · Exposure: {formatInr(selectedCluster.total_flow_amount)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setClusterModalOpen(false)}
                  className="rounded p-1 text-muted hover:bg-highlight hover:text-heading cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Identified Patterns */}
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1.5">
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase">
                  Identified Graph Flow Patterns & Signatures
                </span>
                <ul className="space-y-1 text-xs">
                  {selectedCluster.identified_patterns.map((p, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-heading">
                      <span className="text-amber-500 font-bold">•</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Syndicate Member Nodes Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                    Syndicate Member Accounts ({selectedCluster.members.length} Nodes)
                  </span>
                  <span className="text-[11px] text-muted">
                    Click any account to inspect deep graph centrality metrics
                  </span>
                </div>

                <div className="overflow-x-auto rounded border border-border-subtle">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border-subtle bg-subtle/40 text-[10px] uppercase text-muted">
                        <th className="py-2 px-3">Account / Holder</th>
                        <th className="py-2 px-3">Bank</th>
                        <th className="py-2 px-3">Syndicate Role</th>
                        <th className="py-2 px-3">Risk / Mule Prob</th>
                        <th className="py-2 px-3">Degree (In / Out)</th>
                        <th className="py-2 px-3">Flow Volume</th>
                        <th className="py-2 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {selectedCluster.members.map((member) => {
                        const isCycleNode = selectedCluster.cycle_nodes.includes(member.account_id);
                        return (
                          <tr
                            key={member.account_id}
                            className={`hover:bg-highlight/50 transition-colors ${
                              isCycleNode ? 'bg-red-500/5' : ''
                            }`}
                          >
                            <td className="py-2 px-3">
                              <div className="font-mono font-medium text-heading">
                                {member.account_number}
                              </div>
                              <div className="text-[11px] text-muted">{member.holder_name}</div>
                            </td>

                            <td className="py-2 px-3 text-muted">
                              {member.bank_name || 'Partner Bank'}
                            </td>

                            <td className="py-2 px-3">
                              {getMemberRoleBadge(member.role)}
                              {isCycleNode && (
                                <span className="block text-[9px] text-red-600 font-mono mt-0.5">
                                  [Cycle Node]
                                </span>
                              )}
                            </td>

                            <td className="py-2 px-3">
                              <span className="font-mono font-bold text-heading">
                                {member.risk_score}
                              </span>
                              <span className="text-[10px] text-muted ml-1">
                                ({Math.round(member.mule_probability * 100)}% mule)
                              </span>
                            </td>

                            <td className="py-2 px-3 font-mono text-[11px]">
                              <span className="text-emerald-600">+{member.in_degree}</span> /{' '}
                              <span className="text-sky-600">-{member.out_degree}</span>
                            </td>

                            <td className="py-2 px-3 whitespace-nowrap">
                              <div className="text-[11px] space-y-0.5">
                                <span className="text-emerald-600 block">
                                  +{formatInr(member.total_inflow)}
                                </span>
                                <span className="text-sky-600 block">
                                  -{formatInr(member.total_outflow)}
                                </span>
                              </div>
                            </td>

                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleInspectAccountIntel(member.account_id)}
                                  className="rounded border border-border-subtle bg-app px-2 py-0.5 text-[11px] text-heading hover:bg-highlight cursor-pointer"
                                  title="View centrality & hop metrics"
                                >
                                  Graph Metrics
                                </button>
                                <Link
                                  to={`/graph?accountId=${member.account_id}`}
                                  className="rounded border border-border-subtle bg-app p-1 text-muted hover:text-heading cursor-pointer"
                                  title="Open in Cytoscape Network Graph"
                                >
                                  <Network className="w-3.5 h-3.5" />
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Inspected Single Node Graph Intelligence Display */}
              {inspectedAccountId && (
                <div className="rounded-lg border border-border-subtle bg-app p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-accent-strong" />
                      <h4 className="text-xs font-bold uppercase text-heading">
                        Node Graph Intelligence: {accountIntel?.account_number || inspectedAccountId}
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectedAccountId(null)}
                      className="text-xs text-muted hover:text-heading cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {intelLoading ? (
                    <div className="py-4 text-center text-xs text-muted">
                      Calculating NetworkX topological centralities...
                    </div>
                  ) : intelError ? (
                    <div className="text-xs text-red-600">{intelError}</div>
                  ) : accountIntel ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                      <div className="rounded border border-border-subtle bg-card p-2">
                        <span className="text-[10px] text-muted block">PageRank Centrality</span>
                        <span className="font-mono font-bold text-heading">
                          {(accountIntel.pagerank * 1000).toFixed(4)}
                        </span>
                      </div>
                      <div className="rounded border border-border-subtle bg-card p-2">
                        <span className="text-[10px] text-muted block">Betweenness Centrality</span>
                        <span className="font-mono font-bold text-heading">
                          {(accountIntel.betweenness_centrality * 100).toFixed(4)}%
                        </span>
                      </div>
                      <div className="rounded border border-border-subtle bg-card p-2">
                        <span className="text-[10px] text-muted block">Distance to Nearest Fraud Node</span>
                        <span className="font-mono font-bold text-red-600 dark:text-red-400">
                          {accountIntel.distance_to_nearest_fraud_account !== null
                            ? `${accountIntel.distance_to_nearest_fraud_account} Hop(s)`
                            : 'None in Subgraph'}
                        </span>
                      </div>
                      <div className="rounded border border-border-subtle bg-card p-2">
                        <span className="text-[10px] text-muted block">Propagated Risk Score</span>
                        <span className="font-mono font-bold text-heading">
                          {accountIntel.propagated_risk_score} / 100
                        </span>
                      </div>
                      <div className="rounded border border-border-subtle bg-card p-2">
                        <span className="text-[10px] text-muted block">Fan-In / Fan-Out Ratio</span>
                        <span className="font-mono text-heading">
                          {accountIntel.fan_in_ratio.toFixed(2)} / {accountIntel.fan_out_ratio.toFixed(2)}
                        </span>
                      </div>
                      <div className="rounded border border-border-subtle bg-card p-2">
                        <span className="text-[10px] text-muted block">Pass-Through Ratio</span>
                        <span className="font-mono text-heading">
                          {accountIntel.pass_through_ratio !== null
                            ? `${(accountIntel.pass_through_ratio * 100).toFixed(1)}%`
                            : 'N/A'}
                        </span>
                      </div>
                      <div className="rounded border border-border-subtle bg-card p-2">
                        <span className="text-[10px] text-muted block">1-Hour Velocity Max</span>
                        <span className="font-mono text-heading">
                          {accountIntel.max_1h_velocity} txns/hr
                        </span>
                      </div>
                      <div className="rounded border border-border-subtle bg-card p-2">
                        <span className="text-[10px] text-muted block">Unique Senders / Receivers</span>
                        <span className="font-mono text-heading">
                          {accountIntel.unique_senders} in / {accountIntel.unique_receivers} out
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Actions Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border-subtle">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/graph?accountId=${selectedCluster.members[0]?.account_id}`}
                    className="flex items-center gap-1.5 rounded border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading hover:bg-highlight cursor-pointer"
                  >
                    <Network className="w-3.5 h-3.5 text-accent-strong" />
                    <span>Open in Network Graph</span>
                  </Link>
                  <Link
                    to={`/accounts/intelligence?search=${selectedCluster.cluster_id}`}
                    className="flex items-center gap-1.5 rounded border border-border-subtle bg-app px-3 py-1.5 text-xs text-heading hover:bg-highlight cursor-pointer"
                  >
                    <User className="w-3.5 h-3.5 text-accent-strong" />
                    <span>View in Account Registry</span>
                  </Link>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={recommendingFreeze}
                    onClick={() => handleRecommendCoordinatedFreeze(selectedCluster)}
                    className="flex items-center gap-1.5 rounded bg-red-600 text-white px-4 py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer shadow-xs"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>
                      {recommendingFreeze
                        ? 'Broadcasting Coordinated Alert...'
                        : 'Recommend Coordinated Freeze'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </CommandLayout>
  );
}
