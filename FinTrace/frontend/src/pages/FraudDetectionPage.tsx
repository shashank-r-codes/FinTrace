import {
  BrainCircuit,
  CheckCircle2,
  Play,
  RefreshCw,
  ShieldAlert,
  Snowflake,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  ApiSuccessResponse,
  ComplaintSummary,
  FraudPredictionRow,
  ModelMetricsRow,
  ShapFactor,
} from '../types';
import { formatTimestamp } from '../utils/formatters';

export function FraudDetectionPage() {
  const { hasRole } = useAuth();
  const [searchParams] = useSearchParams();
  const initialAccountId = searchParams.get('accountId') || '';

  const canTrain = hasRole('Administrator', 'Senior Investigator');
  const canDetect = hasRole('Administrator', 'Senior Investigator', 'Investigator');
  const canFlag = hasRole(
    'Administrator',
    'Senior Investigator',
    'Investigator',
    'Bank Nodal Officer'
  );

  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [selectedComplaintId, setSelectedComplaintId] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<string>(initialAccountId);

  const [metricsList, setMetricsList] = useState<ModelMetricsRow[]>([]);
  const [predictions, setPredictions] = useState<FraudPredictionRow[]>([]);
  const [selectedPred, setSelectedPred] = useState<FraudPredictionRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [freezingId, setFreezingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const predParams = new URLSearchParams({ limit: '60' });
      if (selectedComplaintId) predParams.set('complaintId', selectedComplaintId);
      if (accountFilter) predParams.set('accountId', accountFilter);

      const [metricsRes, predsRes] = await Promise.all([
        apiRequest<ApiSuccessResponse<ModelMetricsRow[]>>('/ml/metrics'),
        apiRequest<ApiSuccessResponse<FraudPredictionRow[]>>(
          `/ml/predictions?${predParams.toString()}`
        ),
      ]);

      setMetricsList(metricsRes.data);
      setPredictions(predsRes.data);
      setSelectedPred((prev) => {
        if (!prev) return predsRes.data[0] ?? null;
        return predsRes.data.find((p) => p.id === prev.id) ?? predsRes.data[0] ?? null;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load ML detection results.');
    } finally {
      setLoading(false);
    }
  }, [selectedComplaintId, accountFilter]);

  useEffect(() => {
    apiRequest<ApiSuccessResponse<ComplaintSummary[]>>('/complaints?limit=50')
      .then((res) => {
        setComplaints(res.data);
        if (!initialAccountId && res.data[0] && !selectedComplaintId) {
          setSelectedComplaintId(res.data[0].id);
        }
      })
      .catch(() => {
        // Non-blocking selector load
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleTrainModels = async () => {
    setTraining(true);
    setError(null);
    setStatusNotice(null);
    try {
      const res = await apiRequest<
        ApiSuccessResponse<{
          model_version: string;
          split_strategy: string;
        }>
      >('/ml/train', { method: 'POST' });
      setStatusNotice(
        `Trained ${res.data.model_version} using ${res.data.split_strategy} and persisted evaluation metrics.`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Model training failed.');
    } finally {
      setTraining(false);
    }
  };

  const handleDetectFraud = async () => {
    if (!selectedComplaintId) {
      setError('Select a complaint before running ML fraud detection.');
      return;
    }
    setDetecting(true);
    setError(null);
    setStatusNotice(null);
    try {
      const res = await apiRequest<
        ApiSuccessResponse<{
          score_source: string;
          predictions: Array<{ account_id: string }>;
        }>
      >(`/ml/detect/${selectedComplaintId}`, { method: 'POST' });
      setStatusNotice(
        `Scored ${res.data.predictions.length} accounts (${res.data.score_source}).`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Fraud detection run failed.');
    } finally {
      setDetecting(false);
    }
  };

  const handleFreezeAccount = async (pred: FraudPredictionRow) => {
    setFreezingId(pred.account_id);
    setError(null);
    try {
      await apiRequest(`/accounts/${pred.account_id}/flag`, {
        method: 'POST',
        body: {
          complaintId: pred.complaint_id ?? (selectedComplaintId || null),
          classification: 'SUSPECTED_MULE',
          muleProbability: Number((Number(pred.mule_score) / 100).toFixed(4)),
          scoreSource: pred.score_source,
          reason: `Flagged and frozen from ML Fraud Console (score ${Number(pred.mule_score).toFixed(1)}/100).`,
          freezeAccount: !pred.is_frozen,
        },
      });
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update account freeze state.');
    } finally {
      setFreezingId(null);
    }
  };

  const latestMetric = metricsList[0] ?? null;

  const featureImportanceChart = useMemo(() => {
    if (!latestMetric?.feature_importance) return [];
    return latestMetric.feature_importance.slice(0, 8).map((item) => ({
      feature: item.feature,
      importance: Number((item.importance * 100).toFixed(2)),
    }));
  }, [latestMetric]);

  const activeShapFactors: ShapFactor[] = useMemo(() => {
    if (!selectedPred) return [];
    if (selectedPred.shap_values_json && selectedPred.shap_values_json.length > 0) {
      return selectedPred.shap_values_json;
    }
    if (selectedPred.explanation_json?.top_shap_factors) {
      return selectedPred.explanation_json.top_shap_factors;
    }
    return [];
  }, [selectedPred]);

  const maxAbsShap = useMemo(() => {
    if (activeShapFactors.length === 0) return 1;
    return Math.max(0.001, ...activeShapFactors.map((s) => Math.abs(s.shap_value)));
  }, [activeShapFactors]);

  return (
    <CommandLayout
      title="ML Fraud & Mule Risk Engine"
      section="Intelligence Engines"
      actions={
        <>
          {canTrain ? (
            <button
              type="button"
              disabled={training}
              onClick={() => void handleTrainModels()}
              className="inline-flex items-center gap-1.5 rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-sky-400 ${training ? 'animate-spin' : ''}`} aria-hidden="true" />
              {training ? 'Training XGBoost + IsoForest...' : 'Retrain Models (Time-Split)'}
            </button>
          ) : null}
          {canDetect ? (
            <button
              type="button"
              disabled={detecting || !selectedComplaintId}
              onClick={() => void handleDetectFraud()}
              className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {detecting ? 'Scoring Accounts...' : 'Run Fraud & Mule Detection'}
            </button>
          ) : null}
        </>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadData()} /> : null}

      {statusNotice ? (
        <div className="flex items-center gap-2 rounded-[6px] border border-emerald-700/50 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>{statusNotice}</span>
        </div>
      ) : null}

      {/* Filter Bar */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] p-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Target Complaint Case
            </label>
            <select
              value={selectedComplaintId}
              onChange={(e) => {
                setAccountFilter('');
                setSelectedComplaintId(e.target.value);
              }}
              className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              <option value="">All Complaints</option>
              {complaints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.complaint_number} · {c.victim_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Filter by Account UUID
            </label>
            <input
              type="text"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value.trim())}
              placeholder="Optional account UUID..."
              className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div className="flex items-end h-full">
            {accountFilter ? (
              <button
                type="button"
                onClick={() => setAccountFilter('')}
                className="rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Clear Account Filter
              </button>
            ) : (
              <p className="text-xs text-slate-400">
                Every score carries explicit origin attribution: Trained ML prediction, Rule-based risk score, or Synthetic demo result.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Real Model Evaluation Metrics */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-sky-400" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                Held-Out Model Evaluation Metrics
              </h2>
              <p className="text-xs text-slate-400">
                {latestMetric
                  ? `${latestMetric.model_name} · ${latestMetric.model_version} · Split: ${latestMetric.split_strategy} (${latestMetric.train_count}/${latestMetric.val_count}/${latestMetric.test_count})`
                  : 'No trained model metrics persisted in PostgreSQL yet.'}
              </p>
            </div>
          </div>
          {latestMetric ? (
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              Trained: {formatTimestamp(latestMetric.trained_at)}
            </span>
          ) : null}
        </div>

        {loading ? (
          <TableSkeleton rows={3} cols={5} />
        ) : !latestMetric ? (
          <EmptyDataState
            title="Models not trained yet"
            description="Train XGBoost + Isolation Forest on the PostgreSQL dataset to persist real time-split metrics. Until trained, scoring falls back transparently to Rule-based risk score."
            action={
              canTrain ? (
                <button
                  type="button"
                  onClick={() => void handleTrainModels()}
                  className="rounded-[5px] bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 cursor-pointer"
                >
                  Train Models Now
                </button>
              ) : null
            }
          />
        ) : (
          <div className="p-4 grid grid-cols-1 xl:grid-cols-12 gap-5">
            <div className="xl:col-span-7 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono tabular-nums">
                <div className="rounded-[5px] border border-slate-800 bg-[#0B1120] p-3">
                  <p className="text-[11px] text-slate-400">Precision</p>
                  <p className="mt-1 text-lg font-bold text-white">
                    {(Number(latestMetric.precision_score) * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-[5px] border border-slate-800 bg-[#0B1120] p-3">
                  <p className="text-[11px] text-slate-400">Recall</p>
                  <p className="mt-1 text-lg font-bold text-white">
                    {(Number(latestMetric.recall_score) * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-[5px] border border-slate-800 bg-[#0B1120] p-3">
                  <p className="text-[11px] text-slate-400">F1 Score</p>
                  <p className="mt-1 text-lg font-bold text-sky-300">
                    {(Number(latestMetric.f1_score) * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-[5px] border border-slate-800 bg-[#0B1120] p-3">
                  <p className="text-[11px] text-slate-400">ROC-AUC</p>
                  <p className="mt-1 text-lg font-bold text-white">
                    {latestMetric.roc_auc !== null ? Number(latestMetric.roc_auc).toFixed(3) : '—'}
                  </p>
                </div>
                <div className="rounded-[5px] border border-slate-800 bg-[#0B1120] p-3">
                  <p className="text-[11px] text-slate-400">PR-AUC</p>
                  <p className="mt-1 text-lg font-bold text-white">
                    {latestMetric.pr_auc !== null ? Number(latestMetric.pr_auc).toFixed(3) : '—'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-[5px] border border-slate-800 bg-[#0B1120] p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-200">Ranking Metrics (Precision@K / Recall@K)</p>
                  <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
                    {['@3', '@5', '@10'].map((k) => (
                      <div key={k} className="rounded bg-slate-900/80 p-2">
                        <p className="text-[10px] text-slate-400">K{k}</p>
                        <p className="text-slate-100">
                          P: {((latestMetric.precision_at_k?.[k] ?? 0) * 100).toFixed(0)}%
                        </p>
                        <p className="text-sky-300">
                          R: {((latestMetric.recall_at_k?.[k] ?? 0) * 100).toFixed(0)}%
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[5px] border border-slate-800 bg-[#0B1120] p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-200">Test Confusion Matrix</p>
                  <div className="grid grid-cols-2 gap-2 font-mono text-xs tabular-nums text-center">
                    <div className="rounded border border-emerald-800/40 bg-emerald-950/20 p-2">
                      <p className="text-[10px] text-slate-400">True Neg (TN)</p>
                      <p className="font-bold text-emerald-300">{latestMetric.confusion_matrix.tn}</p>
                    </div>
                    <div className="rounded border border-amber-800/40 bg-amber-950/20 p-2">
                      <p className="text-[10px] text-slate-400">False Pos (FP)</p>
                      <p className="font-bold text-amber-300">{latestMetric.confusion_matrix.fp}</p>
                    </div>
                    <div className="rounded border border-red-800/40 bg-red-950/20 p-2">
                      <p className="text-[10px] text-slate-400">False Neg (FN)</p>
                      <p className="font-bold text-red-300">{latestMetric.confusion_matrix.fn}</p>
                    </div>
                    <div className="rounded border border-sky-800/40 bg-sky-950/20 p-2">
                      <p className="text-[10px] text-slate-400">True Pos (TP)</p>
                      <p className="font-bold text-sky-300">{latestMetric.confusion_matrix.tp}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="xl:col-span-5 rounded-[5px] border border-slate-800 bg-[#0B1120] p-3 flex flex-col">
              <p className="text-xs font-semibold text-slate-200 mb-2">
                Global XGBoost Feature Importance (%)
              </p>
              <div className="h-52 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={featureImportanceChart}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 10, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis type="number" tick={{ fill: '#94A3B8', fontSize: 10 }} unit="%" />
                    <YAxis
                      type="category"
                      dataKey="feature"
                      width={135}
                      tick={{ fill: '#CBD5E1', fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderColor: '#334155',
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="importance" fill="#38BDF8" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Scored Accounts + SHAP Panel */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7 rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden">
          <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Account Fraud & Mule Risk Scores</h2>
              <p className="text-xs text-slate-400">
                Click any row to inspect local SHAP attributions or rule-based factors
              </p>
            </div>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {predictions.length} scored
            </span>
          </div>

          {loading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : predictions.length === 0 ? (
            <EmptyDataState
              title="No fraud scores recorded for this filter"
              description="Select a complaint and run ML Fraud Detection to score involved bank accounts."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-[#0F172A] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">Account</th>
                    <th className="px-4 py-2.5 text-right">Mule Score</th>
                    <th className="px-4 py-2.5">Anomaly / Velocity</th>
                    <th className="px-4 py-2.5">Attribution</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {predictions.map((pred) => {
                    const isSelected = selectedPred?.id === pred.id;
                    return (
                      <tr
                        key={pred.id}
                        onClick={() => setSelectedPred(pred)}
                        className={`cursor-pointer ${
                          isSelected ? 'bg-sky-950/35' : 'hover:bg-slate-800/35'
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <p className="font-mono font-semibold text-white">
                            {pred.account_number}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {pred.holder_name} · {pred.complaint_number ?? 'General'}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                          <p className="text-sm font-bold text-white">
                            {Number(pred.mule_score).toFixed(1)}/100
                          </p>
                          <p className="text-[11px] text-slate-400">
                            PT: {(Number(pred.pass_through_ratio) * 100).toFixed(0)}%
                          </p>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <StatusSignal
                            level={pred.is_anomaly ? 'HIGH' : 'LOW'}
                            label={pred.is_anomaly ? 'IsoForest Anomaly' : 'Normal'}
                          />
                          <p className="font-mono text-[11px] text-slate-400 tabular-nums mt-0.5">
                            {pred.velocity_1h} tx/h
                            {pred.avg_forward_latency_sec !== null
                              ? ` · ${pred.avg_forward_latency_sec}s lat`
                              : ''}
                          </p>
                        </td>
                        <td className="px-4 py-2.5">
                          <ScoreSourceBadge source={pred.score_source} />
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {canFlag ? (
                            <button
                              type="button"
                              disabled={freezingId === pred.account_id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleFreezeAccount(pred);
                              }}
                              className={`inline-flex items-center gap-1 rounded-[4px] border px-2 py-1 text-[11px] font-medium cursor-pointer ${
                                pred.is_frozen
                                  ? 'border-slate-700 bg-slate-900 text-slate-300'
                                  : 'border-red-500/40 bg-red-950/40 text-red-200 hover:bg-red-900/50'
                              }`}
                            >
                              <Snowflake className="h-3 w-3" aria-hidden="true" />
                              {pred.is_frozen ? 'Unfreeze' : 'Freeze'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Local SHAP / Rule Explainability Panel */}
        <div className="xl:col-span-5 rounded-[6px] border border-slate-800 bg-[#111827] p-4 space-y-4">
          <div className="border-b border-slate-800 pb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">Local Prediction Explainability</h2>
              <p className="text-xs text-slate-400">
                {selectedPred
                  ? `${selectedPred.account_number} · ${selectedPred.holder_name}`
                  : 'Select an account row'}
              </p>
            </div>
            {selectedPred ? <ScoreSourceBadge source={selectedPred.score_source} /> : null}
          </div>

          {!selectedPred ? (
            <EmptyDataState
              title="No account selected"
              description="Click an account in the risk table to examine SHAP feature attributions."
            />
          ) : activeShapFactors.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-300">
                TreeSHAP feature contributions pushing predicted label{' '}
                <span className="font-mono font-semibold text-sky-300">
                  {selectedPred.predicted_label ?? 'RISK_EVAL'}
                </span>
                :
              </p>
              <div className="space-y-2.5">
                {activeShapFactors.map((item) => {
                  const pct = Math.min(100, (Math.abs(item.shap_value) / maxAbsShap) * 100);
                  const increases = item.shap_value >= 0;
                  return (
                    <div key={item.feature} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-slate-200">{item.feature}</span>
                        <span
                          className={`font-mono tabular-nums ${
                            increases ? 'text-red-400' : 'text-emerald-400'
                          }`}
                        >
                          {increases ? '+' : ''}
                          {item.shap_value.toFixed(4)} (val={item.value})
                        </span>
                      </div>
                      <div className="h-2 w-full rounded bg-slate-900 overflow-hidden">
                        <div
                          className={`h-full rounded ${
                            increases ? 'bg-red-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : selectedPred.explanation_json?.rule_factors?.length ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                Rule-Based Risk Heuristic Factors
              </div>
              <ul className="space-y-1.5 text-xs text-slate-300 list-disc pl-5">
                {selectedPred.explanation_json.rule_factors.map((rf, i) => (
                  <li key={i}>{rf}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              No SHAP vector persisted for this row. Run Fraud Detection after model training to compute TreeSHAP attributions.
            </p>
          )}
        </div>
      </section>
    </CommandLayout>
  );
}
