import { BarChart3, Download, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiDownloadBlob, apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState } from '../components/common/DataState';
import { CommandLayout } from '../components/layout/CommandLayout';
import { useTheme } from '../context/ThemeContext';
import { ApiSuccessResponse, ComplaintSummary, ReportAnalyticsData } from '../types';
import { formatFraudType, formatInr } from '../utils/formatters';

export function ReportsAnalyticsPage() {
  const { theme } = useTheme();
  const [analytics, setAnalytics] = useState<ReportAnalyticsData | null>(null);
  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [selectedComplaintId, setSelectedComplaintId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [anaRes, cmpRes] = await Promise.all([
        apiRequest<ApiSuccessResponse<ReportAnalyticsData>>('/reports/analytics'),
        apiRequest<ApiSuccessResponse<ComplaintSummary[]>>('/complaints?limit=50'),
      ]);
      setAnalytics(anaRes.data);
      setComplaints(cmpRes.data);
      if (cmpRes.data[0] && !selectedComplaintId) {
        setSelectedComplaintId(cmpRes.data[0].id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load analytics reports.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const handleCsvDownload = async (
    dataset: 'complaints' | 'transactions' | 'predictions' | 'alerts'
  ) => {
    setDownloadingKey(dataset);
    setError(null);
    try {
      const query = selectedComplaintId
        ? `?dataset=${dataset}&complaintId=${encodeURIComponent(selectedComplaintId)}`
        : `?dataset=${dataset}`;
      await apiDownloadBlob(`/reports/export/csv${query}`, `fintrace-${dataset}.csv`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to export ${dataset} CSV.`);
    } finally {
      setDownloadingKey(null);
    }
  };

  const handlePdfDownload = async () => {
    if (!selectedComplaintId) {
      setError('Select a complaint to export its PDF intelligence dossier.');
      return;
    }
    setDownloadingKey('pdf');
    setError(null);
    try {
      const cmp = complaints.find((c) => c.id === selectedComplaintId);
      const name = cmp ? `fintrace-dossier-${cmp.complaint_number}.pdf` : 'fintrace-dossier.pdf';
      await apiDownloadBlob(`/reports/export/pdf/${selectedComplaintId}`, name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate PDF dossier.');
    } finally {
      setDownloadingKey(null);
    }
  };

  const selectedComplaint = useMemo(
    () => complaints.find((c) => c.id === selectedComplaintId) ?? null,
    [complaints, selectedComplaintId]
  );

  const fraudChartData =
    analytics?.byFraudType.map((row) => ({
      name: formatFraudType(row.fraud_type),
      amountLakhs: Number((Number(row.total_amount) / 100000).toFixed(2)),
      count: row.count,
    })) ?? [];

  const channelChartData =
    analytics?.byChannel.map((row) => ({
      name: row.channel,
      amountLakhs: Number((Number(row.total_amount) / 100000).toFixed(2)),
      txns: row.txn_count,
    })) ?? [];

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
            barPrimary: '#3489E8',
            barSecondary: '#D97706',
          }
        : {
            grid: '#1E293B',
            tick: '#94A3B8',
            axis: '#334155',
            tooltipBg: '#0F172A',
            tooltipBorder: '#334155',
            tooltipText: '#F1F5F9',
            barPrimary: '#38BDF8',
            barSecondary: '#F59E0B',
          },
    [theme]
  );

  return (
    <CommandLayout
      title="Reports & evidentiary exports"
      section="Casework and intelligence"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAnalytics()}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-120"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh metrics</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {error ? <ErrorDataState message={error} onRetry={() => void loadAnalytics()} /> : null}

        {/* Summary Strip */}
        {analytics ? (
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-[12px] border border-border-subtle bg-card p-4">
              <p className="text-[11px] font-medium text-muted">Reported cybercrime loss</p>
              <p className="mt-1 font-mono text-xl font-bold text-heading tabular-nums">
                {formatInr(analytics.summary.total_reported_loss)}
              </p>
            </div>
            <div className="rounded-[12px] border border-border-subtle bg-card p-4">
              <p className="text-[11px] font-medium text-muted">Flagged / Frozen accounts</p>
              <p className="mt-1 font-mono text-xl font-bold text-amber-800 dark:text-amber-300 tabular-nums">
                {analytics.summary.flagged_accounts} / {analytics.summary.frozen_accounts} frozen
              </p>
            </div>
            <div className="rounded-[12px] border border-border-subtle bg-card p-4">
              <p className="text-[11px] font-medium text-muted">ATM forecasts logged</p>
              <p className="mt-1 font-mono text-xl font-bold text-accent-strong tabular-nums">
                {analytics.summary.total_atm_forecasts}
              </p>
            </div>
            <div className="rounded-[12px] border border-border-subtle bg-card p-4">
              <p className="text-[11px] font-medium text-muted">Evidence vault artifacts</p>
              <p className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                {analytics.summary.total_evidence_records}
              </p>
            </div>
          </section>
        ) : null}

        {/* Export Controls & Dossier Preview */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-accent-strong" aria-hidden="true" />
              <div>
                <h2 className="text-xs font-semibold text-heading">
                  Case dossier PDF & regulatory CSV exports
                </h2>
                <p className="text-[11px] text-muted">
                  All downloads are generated from verified database rows and recorded in immutable audit logs
                </p>
              </div>
            </div>

            <select
              value={selectedComplaintId}
              onChange={(e) => setSelectedComplaintId(e.target.value)}
              aria-label="Select complaint scope for exports"
              className="rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs text-heading focus:outline-none"
            >
              <option value="">All complaints (Global scope)</option>
              {complaints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.complaint_number} · {c.victim_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={downloadingKey !== null || !selectedComplaintId}
              onClick={() => void handlePdfDownload()}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-40 cursor-pointer transition-colors duration-120"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{downloadingKey === 'pdf' ? 'Rendering PDF...' : 'Download case dossier (PDF)'}</span>
            </button>

            {(['complaints', 'transactions', 'predictions', 'alerts'] as const).map((dataset) => (
              <button
                key={dataset}
                type="button"
                disabled={downloadingKey !== null}
                onClick={() => void handleCsvDownload(dataset)}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-subtle px-3 py-2 text-xs font-medium text-heading hover:bg-highlight disabled:opacity-50 cursor-pointer transition-colors duration-120"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>
                  {downloadingKey === dataset
                    ? 'Exporting...'
                    : `Export ${dataset.charAt(0).toUpperCase() + dataset.slice(1)} CSV`}
                </span>
              </button>
            ))}
          </div>

          {selectedComplaint ? (
            <div className="rounded-[8px] border border-border-subtle bg-subtle p-3.5 space-y-1 text-xs">
              <p className="font-mono text-[11px] font-semibold text-accent-strong">
                PDF dossier preview · {selectedComplaint.complaint_number}
                {selectedComplaint.reference_no ? ` (${selectedComplaint.reference_no})` : ''}
              </p>
              <p className="text-heading font-medium">
                Complainant: {selectedComplaint.victim_name} ·{' '}
                {formatFraudType(selectedComplaint.fraud_type)} ·{' '}
                {formatInr(selectedComplaint.reported_amount)}
              </p>
              <p className="text-muted text-[11px]">
                Includes verified transaction hops, flagged mule scores, candidate cash-out terminal coordinates, and chain-of-custody SHA-256 hashes.
              </p>
            </div>
          ) : null}
        </section>

        {/* Charts */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-[12px] border border-border-subtle bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-accent-strong" aria-hidden="true" />
              <h2 className="text-xs font-semibold text-heading">Loss exposure by fraud typology (INR Lakhs)</h2>
            </div>
            <div className="h-72">
              {fraudChartData.length === 0 ? (
                <EmptyDataState title="No typology metrics" description="No complaints recorded yet." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fraudChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: chartPalette.tick, fontSize: 11 }}
                      axisLine={{ stroke: chartPalette.axis }}
                    />
                    <YAxis
                      tick={{ fill: chartPalette.tick, fontSize: 11 }}
                      axisLine={{ stroke: chartPalette.axis }}
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
                      formatter={(value) => [`₹${Number(value ?? 0)} Lakhs`, 'Loss Exposure']}
                    />
                    <Bar dataKey="amountLakhs" fill={chartPalette.barPrimary} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="rounded-[12px] border border-border-subtle bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <h2 className="text-xs font-semibold text-heading">Transfer volume by payment rail (INR Lakhs)</h2>
            </div>
            <div className="h-72">
              {channelChartData.length === 0 ? (
                <EmptyDataState title="No transaction metrics" description="Ingest transactions to analyze rail volume." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={channelChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: chartPalette.tick, fontSize: 11 }}
                      axisLine={{ stroke: chartPalette.axis }}
                    />
                    <YAxis
                      tick={{ fill: chartPalette.tick, fontSize: 11 }}
                      axisLine={{ stroke: chartPalette.axis }}
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
                      formatter={(value) => [`₹${Number(value ?? 0)} Lakhs`, 'Rail Volume']}
                    />
                    <Bar dataKey="amountLakhs" fill={chartPalette.barSecondary} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>
      </div>
    </CommandLayout>
  );
}
