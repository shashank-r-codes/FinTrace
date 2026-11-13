import {
  ArrowRight,
  BellRing,
  Check,
  Landmark,
  RefreshCw,
  Send,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { ScoreSourceBadge } from '../components/common/ScoreSourceBadge';
import { StatusSignal } from '../components/common/StatusSignal';
import { CommandLayout } from '../components/layout/CommandLayout';
import { useAuth } from '../context/AuthContext';
import {
  AlertRow,
  AlertStatus,
  ApiSuccessResponse,
  AtmPredictionRow,
  ComplaintSummary,
  TransactionRow,
} from '../types';
import { formatFraudType, formatInr, formatShortTime } from '../utils/formatters';

export function DashboardPage() {
  const { hasRole } = useAuth();
  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [predictions, setPredictions] = useState<AtmPredictionRow[]>([]);
  const [txnTotal, setTxnTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingAlertId, setUpdatingAlertId] = useState<string | null>(null);

  const canActOnAlerts = hasRole(
    'Administrator',
    'Senior Investigator',
    'Investigator',
    'Bank Nodal Officer'
  );

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cmpRes, alertRes, predRes, txnRes] = await Promise.all([
        apiRequest<ApiSuccessResponse<ComplaintSummary[]>>('/complaints?limit=50'),
        apiRequest<ApiSuccessResponse<AlertRow[]>>('/alerts?limit=25'),
        apiRequest<ApiSuccessResponse<{ top3: AtmPredictionRow[]; predictions: AtmPredictionRow[] }>>(
          '/predictions/atm?limit=30'
        ),
        apiRequest<ApiSuccessResponse<TransactionRow[]>>('/transactions?limit=1'),
      ]);

      setComplaints(cmpRes.data);
      setAlerts(alertRes.data);
      setPredictions(predRes.data.predictions);
      setTxnTotal(txnRes.pagination?.total ?? txnRes.data.length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load command overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleAlertStatus = async (alertId: string, status: AlertStatus) => {
    setUpdatingAlertId(alertId);
    try {
      await apiRequest(`/alerts/${alertId}`, {
        method: 'PATCH',
        body: { status },
      });
      await loadDashboard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update alert status.');
    } finally {
      setUpdatingAlertId(null);
    }
  };

  const metrics = useMemo(() => {
    const activeComplaints = complaints.filter((c) => c.status !== 'CLOSED').length;
    const totalReportedLoss = complaints.reduce((acc, c) => acc + Number(c.reported_amount || 0), 0);
    const openAlerts = alerts.filter((a) => a.status === 'OPEN');
    const criticalAlerts = openAlerts.filter((a) => a.severity === 'Critical').length;
    const imminentAtms = predictions.filter(
      (p) => p.window === '0-6h' || p.window === '6-12h'
    ).length;

    return {
      activeComplaints,
      totalReportedLoss,
      openAlertCount: openAlerts.length,
      criticalAlerts,
      imminentAtms,
      totalPredictions: predictions.length,
    };
  }, [complaints, alerts, predictions]);

  const chartData = useMemo(() => {
    const grouped = new Map<string, { fraudType: string; complaints: number; lossLakhs: number }>();
    for (const cmp of complaints) {
      const key = formatFraudType(cmp.fraud_type);
      const curr = grouped.get(key) ?? { fraudType: key, complaints: 0, lossLakhs: 0 };
      curr.complaints += 1;
      curr.lossLakhs = Number((curr.lossLakhs + Number(cmp.reported_amount || 0) / 100000).toFixed(2));
      grouped.set(key, curr);
    }
    return Array.from(grouped.values());
  }, [complaints]);

  const priorityAtms = useMemo(() => predictions.slice(0, 4), [predictions]);

  return (
    <CommandLayout
      title="Command Overview"
      section="Core Operations"
      actions={
        <>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="inline-flex items-center gap-1.5 rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <Link
            to="/complaints"
            className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 whitespace-nowrap shrink-0"
          >
            Open Complaints Registry
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadDashboard()} /> : null}

      {/* Top 4-metric single-elevation KPI strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-label="Key operational metrics">
        <div className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
          <p className="text-xs font-medium text-slate-400">Active Cybercrime Cases</p>
          <p className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {loading ? '—' : metrics.activeComplaints}
          </p>
          <p className="mt-1 text-xs text-slate-400 tabular-nums">
            Total reported loss: <span className="font-mono text-slate-200">{formatInr(metrics.totalReportedLoss)}</span>
          </p>
        </div>

        <div className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
          <p className="text-xs font-medium text-slate-400">Open Early Warning Alerts</p>
          <p className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {loading ? '—' : metrics.openAlertCount}
          </p>
          <p className="mt-1 text-xs text-slate-400 tabular-nums">
            Critical priority: <span className="font-mono text-red-400">{metrics.criticalAlerts}</span>
          </p>
        </div>

        <div className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
          <p className="text-xs font-medium text-slate-400">Imminent ATM Windows (0–12h)</p>
          <p className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {loading ? '—' : metrics.imminentAtms}
          </p>
          <p className="mt-1 text-xs text-slate-400 tabular-nums">
            Scored terminal forecasts: <span className="font-mono text-sky-300">{metrics.totalPredictions}</span>
          </p>
        </div>

        <div className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
          <p className="text-xs font-medium text-slate-400">Tracked Ledger Transactions</p>
          <p className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
            {loading ? '—' : txnTotal}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            PostgreSQL verified edges only
          </p>
        </div>
      </section>

      {/* Main Analytics + Priority Cash-Out ATMs */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7 rounded-[6px] border border-slate-800 bg-[#111827] flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Reported Loss by Fraud Typology</h2>
              <p className="text-xs text-slate-400">Aggregated from active database complaint records (INR Lakhs)</p>
            </div>
            <span className="font-mono text-[11px] text-slate-400">n = {complaints.length}</span>
          </div>

          <div className="p-4 h-72">
            {loading ? (
              <div className="h-full rounded bg-slate-800/40 animate-pulse" />
            ) : chartData.length === 0 ? (
              <EmptyDataState
                title="No complaint data recorded"
                description="Register a complaint to visualize fraud typology exposure."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis
                    dataKey="fraudType"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={false}
                    unit="L"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#334155',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: '#F1F5F9',
                    }}
                    formatter={(value) => [`₹${Number(value ?? 0)} Lakhs`, 'Reported Loss']}
                  />
                  <Bar dataKey="lossLakhs" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="xl:col-span-5 rounded-[6px] border border-slate-800 bg-[#111827] flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-amber-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-white">Priority Cash-Out Forecast Queue</h2>
            </div>
            <Link to="/atm-predictions" className="text-xs font-medium text-sky-400 hover:text-sky-300">
              Full Engine
            </Link>
          </div>

          <div className="divide-y divide-slate-800/80 flex-1">
            {loading ? (
              <TableSkeleton rows={4} cols={3} />
            ) : priorityAtms.length === 0 ? (
              <EmptyDataState
                title="No ATM cash-out predictions yet"
                description="Run the ATM Predictive Engine on an active complaint to surface likely cash-out terminals."
              />
            ) : (
              priorityAtms.map((pred) => (
                <div key={pred.id ?? `${pred.atm_id}-${pred.rank_order}`} className="px-4 py-3 space-y-1.5 hover:bg-slate-800/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">
                        {pred.atm_id} · {pred.bank} ({pred.locality})
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {pred.complaint_number ?? 'Linked Case'} · Window{' '}
                        <span className="font-mono text-amber-300">{pred.window}</span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-sm font-bold text-white tabular-nums">
                        {Number(pred.risk_score).toFixed(1)}/100
                      </p>
                      <StatusSignal level={pred.risk_level} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <ScoreSourceBadge source={pred.score_source} />
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      Confidence:{' '}
                      {typeof pred.confidence === 'number'
                        ? `${(pred.confidence * 100).toFixed(0)}%`
                        : String(pred.confidence)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          {priorityAtms[0]?.limitations_text ? (
            <div className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-400">
              Note: {priorityAtms[0].limitations_text}
            </div>
          ) : null}
        </div>
      </section>

      {/* Bottom: Alert Triage & Recent Complaints */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-6 rounded-[6px] border border-slate-800 bg-[#111827]">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-red-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-white">Early Warning Alerts</h2>
            </div>
            <Link to="/alerts" className="text-xs font-medium text-sky-400 hover:text-sky-300">
              View All
            </Link>
          </div>

          {loading ? (
            <TableSkeleton rows={5} cols={4} />
          ) : alerts.length === 0 ? (
            <EmptyDataState
              title="No active alerts"
              description="Alerts are generated automatically when critical ATM cash-out hotspots or mule bursts are detected."
            />
          ) : (
            <div className="divide-y divide-slate-800/80">
              {alerts.slice(0, 6).map((alert) => (
                <div key={alert.id} className="px-4 py-3 space-y-2 hover:bg-slate-800/25">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusSignal level={alert.severity} />
                        <span className="text-slate-600">·</span>
                        <span className="font-mono text-[11px] text-slate-400">
                          {alert.complaint_number ?? 'System'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-100">{alert.title}</p>
                      <p className="mt-0.5 text-xs text-slate-400 line-clamp-2">{alert.description}</p>
                    </div>
                    <div className="shrink-0 text-right space-y-1">
                      <StatusSignal level={alert.status} />
                      <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {formatShortTime(alert.created_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <ScoreSourceBadge source={alert.score_source} />
                    {canActOnAlerts && alert.status === 'OPEN' ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={updatingAlertId === alert.id}
                          onClick={() => void handleAlertStatus(alert.id, 'ACKNOWLEDGED')}
                          className="inline-flex items-center gap-1 rounded-[4px] border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                        >
                          <Check className="h-3 w-3 text-sky-400" aria-hidden="true" />
                          Acknowledge
                        </button>
                        <button
                          type="button"
                          disabled={updatingAlertId === alert.id}
                          onClick={() => void handleAlertStatus(alert.id, 'DISPATCHED')}
                          className="inline-flex items-center gap-1 rounded-[4px] border border-amber-500/40 bg-amber-950/50 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-900/50 disabled:opacity-50 cursor-pointer"
                        >
                          <Send className="h-3 w-3 text-amber-400" aria-hidden="true" />
                          Dispatch Team
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="xl:col-span-6 rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Recent Cybercrime Complaints</h2>
            <Link to="/complaints" className="text-xs font-medium text-sky-400 hover:text-sky-300">
              Manage Cases
            </Link>
          </div>

          {loading ? (
            <TableSkeleton rows={5} cols={4} />
          ) : complaints.length === 0 ? (
            <EmptyDataState
              title="No complaints registered"
              description="Register a cybercrime complaint to start tracing stolen funds."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-[#0F172A] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">Case ID</th>
                    <th className="px-4 py-2.5">Victim & Typology</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {complaints.slice(0, 6).map((cmp) => (
                    <tr key={cmp.id} className="hover:bg-slate-800/35">
                      <td className="px-4 py-2.5 font-mono font-medium text-sky-300 whitespace-nowrap">
                        {cmp.complaint_number}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-100">{cmp.victim_name}</p>
                        <p className="text-[11px] text-slate-400">{formatFraudType(cmp.fraud_type)}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-100 tabular-nums whitespace-nowrap">
                        {formatInr(cmp.reported_amount)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <StatusSignal level={cmp.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </CommandLayout>
  );
}
