import { AlertTriangle, Clock, Landmark, MapPin, Play } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { ScoreSourceBadge } from '../components/common/ScoreSourceBadge';
import { StatusSignal } from '../components/common/StatusSignal';
import { CommandLayout } from '../components/layout/CommandLayout';
import { useAuth } from '../context/AuthContext';
import {
  ApiSuccessResponse,
  AtmPredictionRow,
  ComplaintSummary,
  PredictionWindow,
  RiskLevel,
} from '../types';
import { formatInr } from '../utils/formatters';

export function AtmPredictionPage() {
  const { hasRole } = useAuth();
  const canRun = hasRole('Administrator', 'Senior Investigator', 'Investigator');

  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [selectedComplaintId, setSelectedComplaintId] = useState<string>('');
  const [riskFilter, setRiskFilter] = useState<RiskLevel | ''>('');
  const [windowFilter, setWindowFilter] = useState<PredictionWindow | ''>('');
  const [topN, setTopN] = useState<number>(8);
  const [autoAlert, setAutoAlert] = useState<boolean>(true);

  const [top3, setTop3] = useState<AtmPredictionRow[]>([]);
  const [predictions, setPredictions] = useState<AtmPredictionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPredictions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (selectedComplaintId) params.set('complaintId', selectedComplaintId);
      if (riskFilter) params.set('riskLevel', riskFilter);
      if (windowFilter) params.set('window', windowFilter);

      const res = await apiRequest<
        ApiSuccessResponse<{ top3: AtmPredictionRow[]; predictions: AtmPredictionRow[] }>
      >(`/predictions/atm?${params.toString()}`);

      setTop3(res.data.top3);
      setPredictions(res.data.predictions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load ATM cash-out forecasts.');
    } finally {
      setLoading(false);
    }
  }, [selectedComplaintId, riskFilter, windowFilter]);

  useEffect(() => {
    apiRequest<ApiSuccessResponse<ComplaintSummary[]>>('/complaints?limit=50')
      .then((res) => {
        setComplaints(res.data);
      })
      .catch(() => {
        // Handled on main fetch
      });
  }, []);

  useEffect(() => {
    void loadPredictions();
  }, [loadPredictions]);

  const handleRunEngine = async () => {
    if (!selectedComplaintId) {
      setError('Select a specific complaint before running ATM Cash-Out Forecasting.');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      await apiRequest(
        `/predictions/atm/run/${selectedComplaintId}?topN=${topN}&autoAlert=${autoAlert ? 'true' : 'false'}`,
        { method: 'POST' }
      );
      await loadPredictions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ATM prediction execution failed.');
    } finally {
      setRunning(false);
    }
  };

  const limitationsNotice =
    predictions[0]?.limitations_text ??
    'Weighted risk score (0-100) on synthetic data — NOT a calibrated probability of withdrawal.';

  return (
    <CommandLayout
      title="Predictive ATM Cash-Out Engine"
      section="Intelligence Engines"
      actions={
        <>
          <Link
            to={selectedComplaintId ? `/map?complaintId=${encodeURIComponent(selectedComplaintId)}` : '/map'}
            className="inline-flex items-center gap-1.5 rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <MapPin className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            Open GIS Map
          </Link>
          {canRun ? (
            <button
              type="button"
              disabled={running || !selectedComplaintId}
              onClick={() => void handleRunEngine()}
              className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {running ? 'Scoring Candidate ATMs...' : 'Run ATM Forecast'}
            </button>
          ) : null}
        </>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadPredictions()} /> : null}

      {/* Controls */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Complaint Case
            </label>
            <select
              value={selectedComplaintId}
              onChange={(e) => setSelectedComplaintId(e.target.value)}
              className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="">All Complaints (Global Priority Queue)</option>
              {complaints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.complaint_number} · {c.victim_name} ({formatInr(c.reported_amount)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Risk Level</label>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value as RiskLevel | '')}
              className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
            >
              <option value="">All Risk Levels</option>
              <option value="Critical">Critical (80–100)</option>
              <option value="High">High (65–79)</option>
              <option value="Medium">Medium (45–64)</option>
              <option value="Low">Low (&lt;45)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Time Window</label>
            <select
              value={windowFilter}
              onChange={(e) => setWindowFilter(e.target.value as PredictionWindow | '')}
              className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
            >
              <option value="">All Time Windows</option>
              <option value="0-6h">0-6h (Imminent)</option>
              <option value="6-12h">6-12h</option>
              <option value="12-24h">12-24h</option>
              <option value=">24h">&gt;24h</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-2">
            <select
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              aria-label="Top N ATMs to score"
              className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2 py-1.5 text-xs font-mono text-slate-100"
            >
              <option value={3}>Top 3</option>
              <option value={5}>Top 5</option>
              <option value={8}>Top 8</option>
              <option value={12}>Top 12</option>
            </select>

            <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAlert}
                onChange={(e) => setAutoAlert(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-[#0B1120]"
              />
              Auto-alert
            </label>
          </div>
        </div>
      </section>

      {/* Prominent Top-3 Cash-Out ATMs */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-white">
              Top 3 Likely Cash-Out ATM Locations
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">
            Ranked by 5-factor composite risk score (0–100)
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={3} cols={3} />
        ) : top3.length === 0 ? (
          <div className="rounded-[6px] border border-slate-800 bg-[#111827]">
            <EmptyDataState
              title="No ATM cash-out predictions available"
              description="Select a complaint with downstream cash-out candidates and click Run ATM Forecast."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {top3.map((atm, idx) => (
              <div
                key={atm.id ?? `${atm.atm_id}-${idx}`}
                className="rounded-[6px] border border-slate-800 bg-[#111827] p-4 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-[11px] font-semibold text-amber-300">
                        RANK #{atm.rank_order || idx + 1} · {atm.atm_id}
                      </p>
                      <h3 className="text-sm font-bold text-white mt-0.5">
                        {atm.bank} · {atm.locality}
                      </h3>
                      <p className="text-[11px] text-slate-400">{atm.address}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-xl font-bold text-white tabular-nums">
                        {Number(atm.risk_score).toFixed(1)}
                        <span className="text-xs font-normal text-slate-400">/100</span>
                      </p>
                      <StatusSignal level={atm.risk_level} />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 border-y border-slate-800/80 py-2 text-[11px] font-mono">
                    <span className="flex items-center gap-1 text-amber-300">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      Window: {atm.window}
                    </span>
                    <span className="text-slate-300">Confidence: {String(atm.confidence)}</span>
                    {atm.complaint_number ? (
                      <span className="text-sky-300">{atm.complaint_number}</span>
                    ) : null}
                  </div>

                  {atm.explanation_json?.plain_language ? (
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {atm.explanation_json.plain_language}
                    </p>
                  ) : null}

                  {atm.explanation_json?.factors ? (
                    <div className="space-y-1.5 pt-1">
                      {atm.explanation_json.factors.map((f) => (
                        <div key={f.factor} className="space-y-0.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-300 truncate pr-2">{f.factor}</span>
                            <span className="font-mono text-sky-300 tabular-nums shrink-0">
                              +{Number(f.contribution).toFixed(1)} ({f.value})
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded bg-slate-900 overflow-hidden">
                            <div
                              className="h-full bg-sky-500 rounded"
                              style={{
                                width: `${Math.min(100, (Number(f.contribution) / (f.weight * 100)) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
                  <ScoreSourceBadge source={atm.score_source} />
                  {atm.linked_accounts_json?.[0] ? (
                    <span className="font-mono text-[11px] text-slate-400 truncate">
                      Candidate: {atm.linked_accounts_json[0].account_number}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Honest Model Limitations Callout */}
      <section className="rounded-[6px] border border-amber-500/30 bg-amber-950/20 px-4 py-3 flex items-start gap-2.5 text-xs text-amber-200">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <span className="font-semibold">Model Scope & Limitations: </span>
          <span>{limitationsNotice}</span>
        </div>
      </section>

      {/* Full Ranked ATM Table */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">All Ranked ATM Forecasts</h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {predictions.length} terminals
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : predictions.length === 0 ? (
          <EmptyDataState
            title="No ranked terminal rows"
            description="Adjust filters or run the predictive ATM engine for a complaint."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#0F172A] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Rank / ATM ID</th>
                  <th className="px-4 py-2.5">Bank & Locality</th>
                  <th className="px-4 py-2.5">Case & Linked Candidate</th>
                  <th className="px-4 py-2.5">Time Window</th>
                  <th className="px-4 py-2.5 text-right">Risk Score (0–100)</th>
                  <th className="px-4 py-2.5">Risk Level</th>
                  <th className="px-4 py-2.5">Attribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {predictions.map((p, idx) => (
                  <tr key={p.id ?? `${p.atm_id}-${idx}`} className="hover:bg-slate-800/35">
                    <td className="px-4 py-2.5 font-mono text-sky-300 whitespace-nowrap">
                      #{p.rank_order} · {p.atm_id}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-100">
                        {p.bank} ({p.locality})
                      </p>
                      <p className="text-[11px] text-slate-400 truncate max-w-xs">{p.address}</p>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-300">
                      <p>{p.complaint_number ?? '—'}</p>
                      <p className="text-slate-400">
                        {p.linked_accounts_json?.[0]?.account_number ?? '—'}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-amber-300 whitespace-nowrap">
                      {p.window} · {String(p.confidence)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-white tabular-nums whitespace-nowrap">
                      {Number(p.risk_score).toFixed(1)}/100
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StatusSignal level={p.risk_level} />
                    </td>
                    <td className="px-4 py-2.5">
                      <ScoreSourceBadge source={p.score_source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </CommandLayout>
  );
}
