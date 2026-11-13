import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  GitFork,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { StatusSignal } from '../components/common/StatusSignal';
import { CommandLayout } from '../components/layout/CommandLayout';
import {
  ApiSuccessResponse,
  BankAccountSummary,
  ComplaintSummary,
  CsvUploadReport,
  TransactionRow,
} from '../types';
import { formatInr, formatTimestamp } from '../utils/formatters';

const CHANNELS = ['UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET'] as const;

export function TransactionExplorerPage() {
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [offset, setOffset] = useState<number>(0);
  const limit = 50;

  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [accounts, setAccounts] = useState<BankAccountSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [complaintFilter, setComplaintFilter] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  // Manual ingestion modal
  const [manualOpen, setManualOpen] = useState(false);
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [amount, setAmount] = useState('50000');
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('IMPS');
  const [timestamp, setTimestamp] = useState(() => new Date().toISOString().slice(0, 16));
  const [complaintId, setComplaintId] = useState('');
  const [hopDepth, setHopDepth] = useState('1');
  const [isFlaggedFraud, setIsFlaggedFraud] = useState(true);
  const [remarks, setRemarks] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // CSV Upload modal
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvSubmitting, setCsvSubmitting] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvReport, setCsvReport] = useState<CsvUploadReport | null>(null);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (search.trim()) params.set('search', search.trim());
      if (channelFilter) params.set('channel', channelFilter);
      if (complaintFilter) params.set('complaintId', complaintFilter);
      if (minAmount && Number(minAmount) > 0) params.set('minAmount', minAmount);
      if (flaggedOnly) params.set('flaggedOnly', 'true');

      const res = await apiRequest<ApiSuccessResponse<TransactionRow[]>>(
        `/transactions?${params.toString()}`
      );
      setTransactions(res.data);
      setTotal(res.pagination?.total ?? res.data.length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load ledger transactions.');
    } finally {
      setLoading(false);
    }
  }, [offset, search, channelFilter, complaintFilter, minAmount, flaggedOnly]);

  useEffect(() => {
    void fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    Promise.all([
      apiRequest<ApiSuccessResponse<ComplaintSummary[]>>('/complaints?limit=50'),
      apiRequest<ApiSuccessResponse<BankAccountSummary[]>>('/accounts?limit=100'),
    ])
      .then(([cmpRes, accRes]) => {
        setComplaints(cmpRes.data);
        setAccounts(accRes.data);
      })
      .catch(() => {
        // Non-blocking lookups for form autocomplete
      });
  }, []);

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setManualError(null);
    setManualSubmitting(true);
    try {
      await apiRequest('/transactions', {
        method: 'POST',
        body: {
          fromAccount: fromAccount.trim(),
          toAccount: toAccount.trim(),
          amount: Number(amount),
          channel,
          timestamp: new Date(timestamp).toISOString(),
          complaintId: complaintId || null,
          hopDepth: hopDepth ? Number(hopDepth) : null,
          isFlaggedFraud,
          remarks: remarks.trim() || undefined,
        },
      });
      setManualOpen(false);
      setFromAccount('');
      setToAccount('');
      setRemarks('');
      setOffset(0);
      await fetchTransactions();
    } catch (err) {
      setManualError(err instanceof ApiError ? err.message : 'Transaction ingestion failed.');
    } finally {
      setManualSubmitting(false);
    }
  };

  const handleCsvFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setCsvError(null);
    setCsvReport(null);
    const f = e.target.files?.[0] ?? null;
    setCsvFile(f);
  };

  const handleCsvSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!csvFile) {
      setCsvError('Select a CSV file before uploading.');
      return;
    }
    setCsvError(null);
    setCsvSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', csvFile);
      const res = await apiRequest<ApiSuccessResponse<CsvUploadReport>>('/transactions/upload-csv', {
        method: 'POST',
        body: formData,
      });
      setCsvReport(res.data);
      setOffset(0);
      await fetchTransactions();
    } catch (err) {
      setCsvError(err instanceof ApiError ? err.message : 'CSV upload failed.');
    } finally {
      setCsvSubmitting(false);
    }
  };

  const downloadCsvTemplate = () => {
    const sampleSource = accounts[0]?.account_number ?? 'SYNVICT00001';
    const sampleTarget = accounts[1]?.account_number ?? 'SYNMULE00100';
    const sampleCmp = complaints[0]?.complaint_number ?? 'CMP-2026-0001';
    const csvContent = [
      'txn_id,from_account,to_account,amount,timestamp,channel,complaint_number,hop_depth,is_flagged_fraud,remarks',
      `TXN-SAMPLE-${Date.now()},${sampleSource},${sampleTarget},125000,${new Date().toISOString()},IMPS,${sampleCmp},1,true,Sample investigator ingestion`,
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fintrace_transactions_template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <CommandLayout
      title="Transaction Explorer"
      section="Core Operations"
      actions={
        <>
          <button
            type="button"
            onClick={() => {
              setCsvReport(null);
              setCsvError(null);
              setCsvFile(null);
              setCsvOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            Upload CSV
          </button>
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add Transaction
          </button>
        </>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void fetchTransactions()} /> : null}

      {/* Filter Bar */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] p-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-center">
          <div className="lg:col-span-2 relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setOffset(0);
                setSearch(e.target.value);
              }}
              placeholder="Search TXN ID, account number, or holder..."
              className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <select
            value={complaintFilter}
            onChange={(e) => {
              setOffset(0);
              setComplaintFilter(e.target.value);
            }}
            aria-label="Filter by complaint"
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Complaints</option>
            {complaints.map((c) => (
              <option key={c.id} value={c.id}>
                {c.complaint_number} · {c.victim_name}
              </option>
            ))}
          </select>

          <select
            value={channelFilter}
            onChange={(e) => {
              setOffset(0);
              setChannelFilter(e.target.value);
            }}
            aria-label="Filter by channel"
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value="">All Channels</option>
            {CHANNELS.map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={0}
            value={minAmount}
            onChange={(e) => {
              setOffset(0);
              setMinAmount(e.target.value);
            }}
            placeholder="Min INR"
            aria-label="Minimum amount in INR"
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          />

          <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(e) => {
                setOffset(0);
                setFlaggedOnly(e.target.checked);
              }}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-[#0B1120] text-sky-500 focus:ring-sky-500"
            />
            Flagged fraud only
          </label>
        </div>
      </section>

      {/* Transactions Ledger */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Verified Fund-Transfer Ledger</h2>
            <p className="text-xs text-slate-400">
              Directed account-to-account edges stored in PostgreSQL
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {total === 0 ? '0 records' : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="rounded-[4px] border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={offset + limit >= total || loading}
                onClick={() => setOffset(offset + limit)}
                className="rounded-[4px] border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={8} cols={8} />
        ) : transactions.length === 0 ? (
          <EmptyDataState
            title="No transactions match current filters"
            description="Ingest a transaction manually or upload a CSV statement to trace fund hops."
            action={
              <button
                type="button"
                onClick={() => setManualOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Ingest Transaction
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#0F172A] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">TXN ID & Time</th>
                  <th className="px-4 py-2.5">Source Account</th>
                  <th className="px-4 py-2.5">Destination Account</th>
                  <th className="px-4 py-2.5">Rail / Hop</th>
                  <th className="px-4 py-2.5">Complaint</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">Signal</th>
                  <th className="px-4 py-2.5 text-right">Graph</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/35">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <p className="font-mono font-semibold text-sky-300">{tx.txn_id}</p>
                      <p className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {formatTimestamp(tx.timestamp)}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-mono text-slate-100">{tx.from_account_number}</p>
                      <p className="text-[11px] text-slate-400">
                        {tx.from_holder} · {tx.from_city}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-mono text-slate-100">{tx.to_account_number}</p>
                      <p className="text-[11px] text-slate-400">
                        {tx.to_holder} · {tx.to_city}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-mono text-slate-200">{tx.channel}</span>
                      <span className="mx-1.5 text-slate-600">·</span>
                      <span className="font-mono text-slate-400">
                        Hop {tx.hop_depth ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300 whitespace-nowrap">
                      {tx.complaint_number ?? 'Unlinked'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-white tabular-nums whitespace-nowrap">
                      {formatInr(tx.amount)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {tx.is_flagged_fraud ? (
                        <StatusSignal level="CRITICAL" label="Flagged" />
                      ) : (
                        <StatusSignal level="LOW" label="Normal" />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Link
                        to={`/graph?accountId=${encodeURIComponent(tx.from_account)}`}
                        className="inline-flex items-center gap-1 rounded-[4px] border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-sky-500/50 hover:text-white"
                      >
                        <GitFork className="h-3 w-3 text-sky-400" aria-hidden="true" />
                        Trace
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Manual Transaction Modal */}
      {manualOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-[8px] border border-slate-700 bg-[#111827] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-white">Ingest Single Transaction</h2>
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="p-5 space-y-4">
              {manualError ? <ErrorDataState message={manualError} /> : null}

              <datalist id="fintrace-accounts-list">
                {accounts.map((a) => (
                  <option key={a.id} value={a.account_number}>
                    {a.holder_name} ({a.bank_code})
                  </option>
                ))}
              </datalist>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Source Account (Number or UUID)
                  </label>
                  <input
                    type="text"
                    required
                    list="fintrace-accounts-list"
                    value={fromAccount}
                    onChange={(e) => setFromAccount(e.target.value)}
                    placeholder="e.g. SYNVICT00001"
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Destination Account (Number or UUID)
                  </label>
                  <input
                    type="text"
                    required
                    list="fintrace-accounts-list"
                    value={toAccount}
                    onChange={(e) => setToAccount(e.target.value)}
                    placeholder="e.g. SYNMULE00100"
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Amount (INR)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Payment Rail</label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    {CHANNELS.map((ch) => (
                      <option key={ch} value={ch}>
                        {ch}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Hop Depth</label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={hopDepth}
                    onChange={(e) => setHopDepth(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Timestamp</label>
                  <input
                    type="datetime-local"
                    required
                    value={timestamp}
                    onChange={(e) => setTimestamp(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Link Complaint</label>
                  <select
                    value={complaintId}
                    onChange={(e) => setComplaintId(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="">Unlinked / Background</option>
                    {complaints.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.complaint_number} ({c.victim_name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Remarks</label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional bank statement reference or investigator note"
                  className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFlaggedFraud}
                  onChange={(e) => setIsFlaggedFraud(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-[#0B1120] text-sky-500"
                />
                Flag transaction as part of suspected fraud chain
              </label>

              <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setManualOpen(false)}
                  className="rounded-[5px] border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={manualSubmitting}
                  className="rounded-[5px] bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 cursor-pointer"
                >
                  {manualSubmitting ? 'Recording...' : 'Record Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* CSV Upload Modal */}
      {csvOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-[8px] border border-slate-700 bg-[#111827] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-sky-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-white">Bulk CSV Transaction Ingestion</h2>
              </div>
              <button
                type="button"
                onClick={() => setCsvOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCsvSubmit} className="p-5 space-y-4">
              {csvError ? <ErrorDataState message={csvError} /> : null}

              <div className="rounded-[5px] border border-slate-800 bg-[#0B1120] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-200">Required CSV Columns</p>
                  <button
                    type="button"
                    onClick={downloadCsvTemplate}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 cursor-pointer"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    Download Template
                  </button>
                </div>
                <p className="font-mono text-[11px] text-slate-400 break-all">
                  txn_id,from_account,to_account,amount,timestamp,channel,complaint_number,hop_depth,is_flagged_fraud,remarks
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Select Statement CSV (max 5,000 rows, 5 MB)
                </label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileChange}
                  className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-[4px] file:border file:border-slate-700 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-200 hover:file:bg-slate-800"
                />
              </div>

              {csvReport ? (
                <div className="rounded-[6px] border border-slate-800 bg-[#0B1120] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Validation & Ingestion Summary
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center font-mono text-xs tabular-nums">
                    <div className="rounded bg-slate-900 p-2">
                      <p className="text-[10px] text-slate-400">Total</p>
                      <p className="font-bold text-white">{csvReport.totalRows}</p>
                    </div>
                    <div className="rounded bg-slate-900 p-2">
                      <p className="text-[10px] text-slate-400">Inserted</p>
                      <p className="font-bold text-emerald-400">{csvReport.inserted}</p>
                    </div>
                    <div className="rounded bg-slate-900 p-2">
                      <p className="text-[10px] text-slate-400">Duplicates</p>
                      <p className="font-bold text-amber-300">{csvReport.skippedDuplicates}</p>
                    </div>
                    <div className="rounded bg-slate-900 p-2">
                      <p className="text-[10px] text-slate-400">Errors</p>
                      <p className="font-bold text-red-400">{csvReport.errors.length}</p>
                    </div>
                  </div>

                  {csvReport.errors.length > 0 ? (
                    <div className="max-h-36 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded">
                      {csvReport.errors.map((errItem, idx) => (
                        <div key={idx} className="px-3 py-1.5 text-[11px] text-red-300 font-mono">
                          Row {errItem.row}: {errItem.error}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setCsvOpen(false)}
                  className="rounded-[5px] border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={!csvFile || csvSubmitting}
                  className="rounded-[5px] bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 cursor-pointer"
                >
                  {csvSubmitting ? 'Validating & Importing...' : 'Upload & Validate CSV'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </CommandLayout>
  );
}
