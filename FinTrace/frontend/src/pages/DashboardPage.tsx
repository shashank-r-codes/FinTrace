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
      setError(err instanceof ApiError ? err.message : 'Unable to load casework overview.');
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
      theme === 'dark'
        ? {
            grid: 'rgba(241, 245, 249, 0.08)',
            tick: '#94A3B8',
            axis: 'rgba(241, 245, 249, 0.16)',
            tooltipBg: '#111827',
            tooltipBorder: 'rgba(241, 245, 249, 0.16)',
            tooltipText: '#F1F5F9',
            bar: '#38BDF8',
          }
        : {
            grid: 'rgba(23, 43, 77, 0.08)',
            tick: '#64748B',
            axis: 'rgba(23, 43, 77, 0.16)',
            tooltipBg: '#FFFFFF',
            tooltipBorder: 'rgba(23, 43, 77, 0.16)',
            tooltipText: '#172B4D',
            bar: '#3489E8',
          },
    [theme]
  );

  return (
    <CommandLayout
      title="Casework overview"
      section="Core operations"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors duration-120 shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-muted ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <Link
            to="/complaints"
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong-hover transition-colors duration-120 shrink-0"
          >
            <span>Open complaints ledger</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadDashboard()} /> : null}

      {/* Operational Scope Bar */}
      <section className="rounded-[12px] border border-border-subtle bg-card p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-heading">
            Live investigative status
          </h2>
          <p className="mt-0.5 text-xs text-muted leading-relaxed">
            Active cyber-financial complaints, early warning alerts, and forecast cash-out hotspots across Bengaluru jurisdiction.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link
            to="/map"
            className="rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 font-medium text-heading hover:bg-highlight transition-colors"
          >
            Open GIS hotspot map
          </Link>
          <Link
            to="/alerts"
            className="rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 font-medium text-heading hover:bg-highlight transition-colors"
          >
            Triage alerts ({metrics.openAlertCount})
          </Link>
        </div>
      </section>

      {/* 4-Metric Primary Dossier Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-label="Key casework metrics">
        <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-1.5">
          <p className="text-xs font-medium text-muted">Active complaints</p>
          <p className="font-mono text-2xl font-semibold tracking-tight text-heading tabular-nums">
            {loading ? '—' : metrics.activeComplaints}
          </p>
          <p className="text-xs text-muted tabular-nums">
            Total reported loss: <span className="font-mono text-heading font-medium">{formatInr(metrics.totalReportedLoss)}</span>
          </p>
        </div>

        <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-1.5">
          <p className="text-xs font-medium text-muted">Early warning alerts</p>
          <p className="font-mono text-2xl font-semibold tracking-tight text-heading tabular-nums">
            {loading ? '—' : metrics.openAlertCount}
          </p>
          <p className="text-xs text-muted tabular-nums">
            Critical priority:{' '}
            <span className="font-mono font-medium text-red-700 dark:text-red-400">
              {metrics.criticalAlerts}
            </span>
          </p>
        </div>

        <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-1.5">
          <p className="text-xs font-medium text-muted">Imminent ATM windows (0–12h)</p>
          <p className="font-mono text-2xl font-semibold tracking-tight text-heading tabular-nums">
            {loading ? '—' : metrics.imminentAtms}
          </p>
          <p className="text-xs text-muted tabular-nums">
            Forecast terminals:{' '}
            <span className="font-mono font-medium text-accent-strong">
              {metrics.totalPredictions}
            </span>
          </p>
        </div>

        <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-1.5">
          <p className="text-xs font-medium text-muted">Ledger transfers</p>
          <p className="font-mono text-2xl font-semibold tracking-tight text-heading tabular-nums">
            {loading ? '—' : txnTotal}
          </p>
          <p className="text-xs text-muted font-mono">
            Verified database records
          </p>
        </div>
      </section>

      {/* Analytics & Priority ATM Queue */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Fraud Typology Bar Chart */}
        <div className="xl:col-span-7 rounded-[12px] border border-border-subtle bg-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle/50 px-4 py-3 sm:px-5">
            <div>
              <h3 className="text-xs font-semibold tracking-tight text-heading uppercase">
                Reported loss by fraud typology
              </h3>
              <p className="text-[11px] text-muted">Aggregated loss exposure across registered complaints (₹ Lakhs)</p>
            </div>
            <span className="font-mono text-[11px] text-muted tabular-nums">
              n = {complaints.length}
            </span>
          </div>

          <div className="p-4 sm:p-5 h-72">
            {loading ? (
              <div className="h-full rounded-[8px] bg-subtle/50 animate-pulse" />
            ) : chartData.length === 0 ? (
              <EmptyDataState
                title="No complaint data recorded"
                description="Register cybercrime complaints to visualize fraud typology distributions."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 8 }}>
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
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: chartPalette.tooltipText,
                    }}
                    formatter={(value) => [`₹${Number(value ?? 0)} Lakhs`, 'Reported loss']}
                  />
                  <Bar dataKey="lossLakhs" fill={chartPalette.bar} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Priority ATM Forecast Queue */}
        <div className="xl:col-span-5 rounded-[12px] border border-border-subtle bg-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle/50 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-muted" aria-hidden="true" />
              <h3 className="text-xs font-semibold tracking-tight text-heading uppercase">
                Priority cash-out forecast queue
              </h3>
            </div>
            <Link to="/atm-predictions" className="text-xs font-medium text-accent-strong hover:underline">
              View all
            </Link>
          </div>

          <div className="divide-y divide-border-subtle flex-1">
            {loading ? (
              <TableSkeleton rows={4} cols={3} />
            ) : priorityAtms.length === 0 ? (
              <EmptyDataState
                title="No ATM forecasts available"
                description="Run the ATM predictive engine on active complaints to calculate cash-out probability."
              />
            ) : (
              priorityAtms.map((pred) => (
                <div key={pred.id ?? `${pred.atm_id}-${pred.rank_order}`} className="px-4 py-3 space-y-1.5 hover:bg-subtle/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-heading truncate">
                        {pred.atm_id} · {pred.bank} ({pred.locality})
                      </p>
                      <p className="text-[11px] text-muted truncate mt-0.5">
                        {pred.complaint_number ?? 'Linked case'} · Window{' '}
                        <span className="font-mono font-medium text-amber-800 dark:text-amber-300">
                          {pred.window}
                        </span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-xs font-semibold text-heading tabular-nums">
                        {Number(pred.risk_score).toFixed(0)}/100
                      </p>
                      <StatusSignal level={pred.risk_level} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <ScoreSourceBadge source={pred.score_source} />
                    <span className="font-mono text-[10px] text-muted tabular-nums">
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
            <div className="border-t border-border-subtle bg-subtle/40 px-4 py-2 text-[11px] text-muted">
              Note: {priorityAtms[0].limitations_text}
            </div>
          ) : null}
        </div>
      </section>

      {/* Alert Triage & Recent Complaints Tables */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Early Warning Alerts Queue */}
        <div className="xl:col-span-6 rounded-[12px] border border-border-subtle bg-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle/50 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-muted" aria-hidden="true" />
              <h3 className="text-xs font-semibold tracking-tight text-heading uppercase">
                Early warning alerts
              </h3>
            </div>
            <Link to="/alerts" className="text-xs font-medium text-accent-strong hover:underline">
              View queue
            </Link>
          </div>

          {loading ? (
            <TableSkeleton rows={4} cols={3} />
          ) : alerts.length === 0 ? (
            <EmptyDataState
              title="No open alerts"
              description="Alerts are automatically triggered when high-velocity mule bursts or cash-out hotspots emerge."
            />
          ) : (
            <div className="divide-y divide-border-subtle flex-1">
              {alerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className="px-4 py-3 space-y-2 hover:bg-subtle/40 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusSignal level={alert.severity} />
                        <span className="text-muted">·</span>
                        <span className="font-mono text-[11px] text-muted">
                          {alert.complaint_number ?? 'System'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-heading">{alert.title}</p>
                      <p className="mt-0.5 text-xs text-muted line-clamp-1">{alert.description}</p>
                    </div>
                    <div className="shrink-0 text-right space-y-1">
                      <StatusSignal level={alert.status} />
                      <p className="font-mono text-[10px] text-muted tabular-nums">
                        {formatShortTime(alert.created_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <ScoreSourceBadge source={alert.score_source} />
                    {canActOnAlerts && alert.status === 'OPEN' ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={updatingAlertId === alert.id}
                          onClick={() => void handleAlertStatus(alert.id, 'ACKNOWLEDGED')}
                          className="inline-flex items-center gap-1 rounded-[6px] border border-border-subtle bg-card px-2.5 py-1 text-[11px] font-medium text-heading hover:bg-subtle disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          <Check className="h-3 w-3 text-muted" aria-hidden="true" />
                          <span>Acknowledge</span>
                        </button>
                        <button
                          type="button"
                          disabled={updatingAlertId === alert.id}
                          onClick={() => void handleAlertStatus(alert.id, 'DISPATCHED')}
                          className="inline-flex items-center gap-1 rounded-[6px] bg-accent-strong px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-strong-hover disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          <Send className="h-3 w-3" aria-hidden="true" />
                          <span>Dispatch team</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Cybercrime Complaints Ledger */}
        <div className="xl:col-span-6 rounded-[12px] border border-border-subtle bg-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle/50 px-4 py-3 sm:px-5">
            <h3 className="text-xs font-semibold tracking-tight text-heading uppercase">
              Recent complaints registry
            </h3>
            <Link to="/complaints" className="text-xs font-medium text-accent-strong hover:underline">
              Open ledger
            </Link>
          </div>

          {loading ? (
            <TableSkeleton rows={4} cols={4} />
          ) : complaints.length === 0 ? (
            <EmptyDataState
              title="No complaints registered"
              description="Register a cybercrime complaint to begin tracing stolen fund trajectories."
            />
          ) : (
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border-subtle bg-subtle/30 text-[11px] font-medium text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-normal">Case reference</th>
                    <th className="px-4 py-2.5 font-normal">Victim & typology</th>
                    <th className="px-4 py-2.5 font-normal text-right">Reported loss</th>
                    <th className="px-4 py-2.5 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {complaints.slice(0, 5).map((cmp) => (
                    <tr key={cmp.id} className="hover:bg-subtle/40 transition-colors">
                      <td className="px-4 py-2.5 font-mono font-medium text-heading whitespace-nowrap">
                        <Link to={`/complaints`} className="hover:text-accent-strong transition-colors">
                          {cmp.complaint_number}
                        </Link>
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
