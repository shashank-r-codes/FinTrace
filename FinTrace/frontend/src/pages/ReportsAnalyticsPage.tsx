import { BarChart3, Download, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
import { ApiSuccessResponse, ComplaintSummary, ReportAnalyticsData } from '../types';
import { formatFraudType, formatInr } from '../utils/formatters';

export function ReportsAnalyticsPage() {
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

  return (
    <CommandLayout
      title="Reports & Investigative Analytics"
      section="Governance & AI"
      actions={
        <button
          type="button"
          onClick={() => void loadAnalytics()}
          className="inline-flex items-center gap-1.5 rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh Metrics
        </button>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadAnalytics()} /> : null}

      {/* Summary Strip */}
      {analytics ? (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
            <p className="text-xs text-slate-400">Reported Cybercrime Loss</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-white tabular-nums">
              {formatInr(analytics.summary.total_reported_loss)}
            </p>
          </div>
          <div className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
            <p className="text-xs text-slate-400">Flagged / Frozen Accounts</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-amber-300 tabular-nums">
              {analytics.summary.flagged_accounts} / {analytics.summary.frozen_accounts} frozen
            </p>
          </div>
          <div className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
            <p className="text-xs text-slate-400">ATM Forecasts Logged</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-sky-300 tabular-nums">
              {analytics.summary.total_atm_forecasts}
            </p>
          </div>
          <div className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
            <p className="text-xs text-slate-400">Evidence Vault Artifacts</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-emerald-300 tabular-nums">
              {analytics.summary.total_evidence_records}
            </p>
          </div>
        </section>
      ) : null}

      {/* Export Controls */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-sky-400" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                Case Dossier PDF & Regulatory CSV Exports
              </h2>
              <p className="text-xs text-slate-400">
                All downloads are generated live from PostgreSQL and recorded in immutable audit logs
              </p>
            </div>
          </div>

          <select
            value={selectedComplaintId}
            onChange={(e) => setSelectedComplaintId(e.target.value)}
            aria-label="Select complaint scope for exports"
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs text-slate-100"
          >
            <option value="">All Complaints (CSV Global Scope)</option>
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
            className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40 cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            {downloadingKey === 'pdf' ? 'Rendering PDF...' : 'Download Case Dossier (PDF)'}
          </button>

          {(['complaints', 'transactions', 'predictions', 'alerts'] as const).map((dataset) => (
            <button
              key={dataset}
              type="button"
              disabled={downloadingKey !== null}
              onClick={() => void handleCsvDownload(dataset)}
              className="inline-flex items-center gap-1.5 rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              {downloadingKey === dataset
                ? 'Exporting...'
                : `Export ${dataset.charAt(0).toUpperCase() + dataset.slice(1)} CSV`}
            </button>
          ))}
        </div>
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-sky-400" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-white">Loss Exposure by Fraud Typology (INR Lakhs)</h2>
          </div>
          <div className="h-72">
            {fraudChartData.length === 0 ? (
              <EmptyDataState title="No typology metrics" description="No complaints recorded yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fraudChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} unit="L" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#334155',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="amountLakhs" fill="#38BDF8" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-white">Transfer Volume by Payment Rail (INR Lakhs)</h2>
          </div>
          <div className="h-72">
            {channelChartData.length === 0 ? (
              <EmptyDataState title="No transaction metrics" description="Ingest transactions to analyze rail volume." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={channelChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} unit="L" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#334155',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="amountLakhs" fill="#F59E0B" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>
    </CommandLayout>
  );
}
