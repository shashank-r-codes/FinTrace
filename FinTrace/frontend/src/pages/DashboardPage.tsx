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
import { useTheme } from '../context/ThemeContext';
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
  const { theme } = useTheme();
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

  const chartPalette = useMemo(
    () =>
      theme === 'light'
        ? {
            grid: '#E2E8F0',
            tick: '#64748B',
            axis: '#CBD5E1',
            tooltipBg: '#FFFFFF',
            tooltipBorder: '#CBD5E1',
            tooltipText: '#172B4D',
            bar: '#3489E8',
          }
        : {
            grid: '#1E293B',
            tick: '#94A3B8',
            axis: '#334155',
            tooltipBg: '#0F172A',
            tooltipBorder: '#334155',
            tooltipText: '#F1F5F9',
            bar: '#38BDF8',
          },
    [theme]
  );

  return (
    <CommandLayout
      title="Command Overview"
      section="Core Operations"
      actions={
        <>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="inline-flex items-center gap-1.5 rounded-[5px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <Link
            to="/complaints"
            className="inline-flex items-center gap-1.5 rounded-[5px] bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover whitespace-nowrap shrink-0"
          >
            Open Complaints Registry
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadDashboard()} /> : null}

      {/* Hero Operational Strip */}
      <section className="rounded-[6px] border border-border-subtle bg-grad-sky px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-strong">
            Real-Time Cyber-Financial Command Center
          </p>
          <p className="text-sm font-medium text-heading mt-0.5">
            Track multi-hop fund laundering, score mule accounts, and dispatch teams to high-risk ATMs.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link
            to="/map"
            className="rounded-[5px] border border-border-subtle bg-card/85 px-3 py-1.5 font-medium text-heading hover:bg-card"
          >
            Open Live GIS Map
          </Link>
          <Link
            to="/alerts"
            className="rounded-[5px] bg-accent-strong px-3 py-1.5 font-semibold text-white hover:bg-accent-strong-hover"
          >
            Triage Alerts ({metrics.openAlertCount})
          </Link>
        </div>
      </section>

      {/* Top 4-metric single-elevation KPI strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-label="Key operational metrics">
        <div className="rounded-[6px] border border-border-subtle bg-card p-4">
          <p className="text-xs font-medium text-muted">Active Cybercrime Cases</p>
          <p className="mt-2 font-mono text-2xl font-bold text-heading tabular-nums">
            {loading ? '—' : metrics.activeComplaints}
          </p>
          <p className="mt-1 text-xs text-muted tabular-nums">
            Total reported loss: <span className="font-mono text-heading">{formatInr(metrics.totalReportedLoss)}</span>
          </p>
        </div>

        <div className="rounded-[6px] border border-border-subtle bg-card p-4">
          <p className="text-xs font-medium text-muted">Open Early Warning Alerts</p>
          <p className="mt-2 font-mono text-2xl font-bold text-heading tabular-nums">
            {loading ? '—' : metrics.openAlertCount}
          </p>
          <p className="mt-1 text-xs text-muted tabular-nums">
            Critical priority:{' '}
            <span className="font-mono font-semibold text-[#991B1B] dark:text-red-400">
              {metrics.criticalAlerts}
            </span>
          </p>
        </div>

        <div className="rounded-[6px] border border-border-subtle bg-card p-4">
          <p className="text-xs font-medium text-muted">Imminent ATM Windows (0–12h)</p>
          <p className="mt-2 font-mono text-2xl font-bold text-heading tabular-nums">
            {loading ? '—' : metrics.imminentAtms}
          </p>
          <p className="mt-1 text-xs text-muted tabular-nums">
            Scored terminal forecasts:{' '}
            <span className="font-mono font-semibold text-accent-strong">
              {metrics.totalPredictions}
            </span>
          </p>
        </div>

        <div className="rounded-[6px] border border-border-subtle bg-card p-4">
          <p className="text-xs font-medium text-muted">Tracked Ledger Transactions</p>
          <p className="mt-2 font-mono text-2xl font-bold text-heading tabular-nums">
            {loading ? '—' : txnTotal}
          </p>
          <p className="mt-1 text-xs text-muted">
            PostgreSQL verified edges only
          </p>
        </div>
      </section>

      {/* Main Analytics + Priority Cash-Out ATMs */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7 rounded-[6px] border border-border-subtle bg-card flex flex-col">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-heading">Reported Loss by Fraud Typology</h2>
              <p className="text-xs text-muted">Aggregated from active database complaint records (INR Lakhs)</p>
            </div>
            <span className="font-mono text-[11px] text-muted">n = {complaints.length}</span>
          </div>

          <div className="p-4 h-72">
            {loading ? (
              <div className="h-full rounded bg-subtle animate-pulse" />
            ) : chartData.length === 0 ? (
              <EmptyDataState
                title="No complaint data recorded"
                description="Register a complaint to visualize fraud typology exposure."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                  <XAxis
                    dataKey="fraudType"
                    tick={{ fill: chartPalette.tick, fontSize: 11 }}
                    axisLine={{ stroke: chartPalette.axis }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: chartPalette.tick, fontSize: 11 }}
                    axisLine={{ stroke: chartPalette.axis }}
                    tickLine={false}
                    unit="L"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: chartPalette.tooltipBg,
                      borderColor: chartPalette.tooltipBorder,
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: chartPalette.tooltipText,
                    }}
                    formatter={(value) => [`₹${Number(value ?? 0)} Lakhs`, 'Reported Loss']}
                  />
                  <Bar dataKey="lossLakhs" fill={chartPalette.bar} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="xl:col-span-5 rounded-[6px] border border-border-subtle bg-card flex flex-col">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-heading">Priority Cash-Out Forecast Queue</h2>
            </div>
            <Link to="/atm-predictions" className="text-xs font-medium text-accent-strong hover:underline">
              Full Engine
            </Link>
          </div>

          <div className="divide-y divide-border-subtle flex-1">
            {loading ? (
              <TableSkeleton rows={4} cols={3} />
            ) : priorityAtms.length === 0 ? (
              <EmptyDataState
                title="No ATM cash-out predictions yet"
                description="Run the ATM Predictive Engine on an active complaint to surface likely cash-out terminals."
              />
            ) : (
              priorityAtms.map((pred) => (
                <div key={pred.id ?? `${pred.atm_id}-${pred.rank_order}`} className="px-4 py-3 space-y-1.5 hover:bg-subtle">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-heading truncate">
                        {pred.atm_id} · {pred.bank} ({pred.locality})
                      </p>
                      <p className="text-[11px] text-muted truncate">
                        {pred.complaint_number ?? 'Linked Case'} · Window{' '}
                        <span className="font-mono font-semibold text-amber-700 dark:text-amber-300">
                          {pred.window}
                        </span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-sm font-bold text-heading tabular-nums">
                        {Number(pred.risk_score).toFixed(1)}/100
                      </p>
                      <StatusSignal level={pred.risk_level} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <ScoreSourceBadge source={pred.score_source} />
                    <span className="font-mono text-[11px] text-muted tabular-nums">
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
            <div className="border-t border-border-subtle bg-subtle px-4 py-2 text-[11px] text-muted">
              Note: {priorityAtms[0].limitations_text}
            </div>
          ) : null}
        </div>
      </section>

      {/* Bottom: Alert Triage & Recent Complaints */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-6 rounded-[6px] border border-border-subtle bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-[#DC2626] dark:text-red-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-heading">Early Warning Alerts</h2>
            </div>
            <Link to="/alerts" className="text-xs font-medium text-accent-strong hover:underline">
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
            <div className="divide-y divide-border-subtle">
              {alerts.slice(0, 6).map((alert) => (
                <div key={alert.id} className="px-4 py-3 space-y-2 hover:bg-subtle">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusSignal level={alert.severity} />
                        <span className="text-muted">·</span>
                        <span className="font-mono text-[11px] text-muted">
                          {alert.complaint_number ?? 'System'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-heading">{alert.title}</p>
                      <p className="mt-0.5 text-xs text-body line-clamp-2">{alert.description}</p>
                    </div>
                    <div className="shrink-0 text-right space-y-1">
                      <StatusSignal level={alert.status} />
                      <p className="font-mono text-[11px] text-muted tabular-nums">
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
                          className="inline-flex items-center gap-1 rounded-[4px] border border-border-subtle bg-card px-2 py-1 text-[11px] font-medium text-heading hover:bg-highlight disabled:opacity-50 cursor-pointer"
                        >
                          <Check className="h-3 w-3 text-accent-strong" aria-hidden="true" />
                          Acknowledge
                        </button>
                        <button
                          type="button"
                          disabled={updatingAlertId === alert.id}
                          onClick={() => void handleAlertStatus(alert.id, 'DISPATCHED')}
                          className="inline-flex items-center gap-1 rounded-[4px] border border-amber-300 bg-[#FEF3C7] px-2 py-1 text-[11px] font-semibold text-[#92400E] hover:opacity-90 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-200 disabled:opacity-50 cursor-pointer"
                        >
                          <Send className="h-3 w-3" aria-hidden="true" />
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

        <div className="xl:col-span-6 rounded-[6px] border border-border-subtle bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle px-4 py-3">
            <h2 className="text-sm font-semibold text-heading">Recent Cybercrime Complaints</h2>
            <Link to="/complaints" className="text-xs font-medium text-accent-strong hover:underline">
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
                <thead className="border-b border-border-subtle bg-highlight text-[11px] font-semibold uppercase tracking-wider text-heading">
                  <tr>
                    <th className="px-4 py-2.5">Case ID</th>
                    <th className="px-4 py-2.5">Victim & Typology</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {complaints.slice(0, 6).map((cmp) => (
                    <tr key={cmp.id} className="hover:bg-subtle">
                      <td className="px-4 py-2.5 font-mono font-medium text-accent-strong whitespace-nowrap">
                        {cmp.complaint_number}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-heading">{cmp.victim_name}</p>
                        <p className="text-[11px] text-muted">{formatFraudType(cmp.fraud_type)}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-heading tabular-nums whitespace-nowrap">
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
