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
import { useTheme } from '../context/ThemeContext';
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
  const { theme } = useTheme();
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

  const chartPalette = useMemo(
    () =>
      theme === 'light'
        ? {
            grid: '#E2E8F0',
            tick: '#334155',
            axis: '#CBD5E1',
            tooltipBg: '#FFFFFF',
            tooltipBorder: '#CBD5E1',
            tooltipText: '#172B4D',
            bar: '#3489E8',
          }
        : {
            grid: '#1E293B',
            tick: '#CBD5E1',
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
      title="ML Fraud & Mule Risk Engine"
      section="Intelligence Engines"
      actions={
        <>
          {canTrain ? (
            <button
              type="button"
              disabled={training}
              onClick={() => void handleTrainModels()}
              className="inline-flex items-center gap-1.5 rounded-[5px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-accent-strong ${training ? 'animate-spin' : ''}`} aria-hidden="true" />
              {training ? 'Training XGBoost + IsoForest...' : 'Retrain Models (Time-Split)'}
            </button>
          ) : null}
          {canDetect ? (
            <button
              type="button"
              disabled={detecting || !selectedComplaintId}
              onClick={() => void handleDetectFraud()}
              className="inline-flex items-center gap-1.5 rounded-[5px] bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
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
        <div className="flex items-center gap-2 rounded-[6px] border border-emerald-300 bg-[#D8F8EC] px-4 py-2.5 text-xs text-[#065F46] dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{statusNotice}</span>
        </div>
      ) : null}

      {/* Filter Bar */}
      <section className="rounded-[6px] border border-border-subtle bg-card p-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
          <div>
            <label className="block text-[11px] font-medium text-muted mb-1">
              Target Complaint Case
            </label>
            <select
              value={selectedComplaintId}
              onChange={(e) => {
                setAccountFilter('');
                setSelectedComplaintId(e.target.value);
              }}
              className="w-full rounded-[5px] border border-border-subtle bg-subtle px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none"
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
            <label className="block text-[11px] font-medium text-muted mb-1">
              Filter by Account UUID
            </label>
            <input
              type="text"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value.trim())}
              placeholder="Optional account UUID..."
              className="w-full rounded-[5px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs font-mono text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
            />
          </div>
          <div className="flex items-end h-full">
            {accountFilter ? (
              <button
                type="button"
                onClick={() => setAccountFilter('')}
                className="rounded-[5px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs text-heading hover:bg-highlight cursor-pointer"
              >
                Clear Account Filter
              </button>
            ) : (
              <p className="text-xs text-muted">
                Every score carries explicit origin attribution: Trained ML prediction, Rule-based risk score, or Synthetic demo result.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Real Model Evaluation Metrics */}
      <section className="rounded-[6px] border border-border-subtle bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-grad-ai px-4 py-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-accent-strong" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-heading">
                Held-Out Model Evaluation Metrics
              </h2>
              <p className="text-xs text-body">
                {latestMetric
                  ? `${latestMetric.model_name} · ${latestMetric.model_version} · Split: ${latestMetric.split_strategy} (${latestMetric.train_count}/${latestMetric.val_count}/${latestMetric.test_count})`
                  : 'No trained model metrics persisted in PostgreSQL yet.'}
              </p>
            </div>
          </div>
          {latestMetric ? (
            <span className="font-mono text-[11px] text-muted tabular-nums">
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
                  className="rounded-[5px] bg-accent-strong px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover cursor-pointer"
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
                <div className="rounded-[5px] border border-border-subtle bg-subtle p-3">
                  <p className="text-[11px] text-muted">Precision</p>
                  <p className="mt-1 text-lg font-bold text-heading">
                    {(Number(latestMetric.precision_score) * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-[5px] border border-border-subtle bg-subtle p-3">
                  <p className="text-[11px] text-muted">Recall</p>
                  <p className="mt-1 text-lg font-bold text-heading">
                    {(Number(latestMetric.recall_score) * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-[5px] border border-border-subtle bg-subtle p-3">
                  <p className="text-[11px] text-muted">F1 Score</p>
                  <p className="mt-1 text-lg font-bold text-accent-strong">
                    {(Number(latestMetric.f1_score) * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-[5px] border border-border-subtle bg-subtle p-3">
                  <p className="text-[11px] text-muted">ROC-AUC</p>
                  <p className="mt-1 text-lg font-bold text-heading">
                    {latestMetric.roc_auc !== null ? Number(latestMetric.roc_auc).toFixed(3) : '—'}
                  </p>
                </div>
                <div className="rounded-[5px] border border-border-subtle bg-subtle p-3">
                  <p className="text-[11px] text-muted">PR-AUC</p>
                  <p className="mt-1 text-lg font-bold text-heading">
                    {latestMetric.pr_auc !== null ? Number(latestMetric.pr_auc).toFixed(3) : '—'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-[5px] border border-border-subtle bg-subtle p-3 space-y-2">
                  <p className="text-xs font-semibold text-heading">Ranking Metrics (Precision@K / Recall@K)</p>
                  <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
                    {['@3', '@5', '@10'].map((k) => (
                      <div key={k} className="rounded border border-border-subtle bg-card p-2">
                        <p className="text-[10px] text-muted">K{k}</p>
                        <p className="text-heading">
                          P: {((latestMetric.precision_at_k?.[k] ?? 0) * 100).toFixed(0)}%
                        </p>
                        <p className="text-accent-strong font-semibold">
                          R: {((latestMetric.recall_at_k?.[k] ?? 0) * 100).toFixed(0)}%
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[5px] border border-border-subtle bg-subtle p-3 space-y-2">
                  <p className="text-xs font-semibold text-heading">Test Confusion Matrix</p>
                  <div className="grid grid-cols-2 gap-2 font-mono text-xs tabular-nums text-center">
                    <div className="rounded border border-emerald-300 bg-[#D8F8EC] p-2 dark:border-emerald-800/40 dark:bg-emerald-950/20">
                      <p className="text-[10px] text-[#065F46] dark:text-slate-400">True Neg (TN)</p>
                      <p className="font-bold text-[#065F46] dark:text-emerald-300">{latestMetric.confusion_matrix.tn}</p>
                    </div>
                    <div className="rounded border border-amber-300 bg-[#FEF3C7] p-2 dark:border-amber-800/40 dark:bg-amber-950/20">
                      <p className="text-[10px] text-[#92400E] dark:text-slate-400">False Pos (FP)</p>
                      <p className="font-bold text-[#92400E] dark:text-amber-300">{latestMetric.confusion_matrix.fp}</p>
                    </div>
                    <div className="rounded border border-red-300 bg-[#FEE2E2] p-2 dark:border-red-800/40 dark:bg-red-950/20">
                      <p className="text-[10px] text-[#991B1B] dark:text-slate-400">False Neg (FN)</p>
                      <p className="font-bold text-[#991B1B] dark:text-red-300">{latestMetric.confusion_matrix.fn}</p>
                    </div>
                    <div className="rounded border border-blue-300 bg-[#DCEEFF] p-2 dark:border-sky-800/40 dark:bg-sky-950/20">
                      <p className="text-[10px] text-[#1E40AF] dark:text-slate-400">True Pos (TP)</p>
                      <p className="font-bold text-[#1E40AF] dark:text-sky-300">{latestMetric.confusion_matrix.tp}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="xl:col-span-5 rounded-[5px] border border-border-subtle bg-subtle p-3 flex flex-col">
              <p className="text-xs font-semibold text-heading mb-2">
                Global XGBoost Feature Importance (%)
              </p>
              <div className="h-52 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={featureImportanceChart}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 10, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.grid} />
                    <XAxis type="number" tick={{ fill: chartPalette.tick, fontSize: 10 }} unit="%" />
                    <YAxis
                      type="category"
                      dataKey="feature"
                      width={135}
                      tick={{ fill: chartPalette.tick, fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: chartPalette.tooltipBg,
                        borderColor: chartPalette.tooltipBorder,
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: chartPalette.tooltipText,
                      }}
                    />
                    <Bar dataKey="importance" fill={chartPalette.bar} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Scored Accounts + SHAP Panel */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7 rounded-[6px] border border-border-subtle bg-card overflow-hidden">
          <div className="border-b border-border-subtle bg-subtle px-4 py-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-heading">Account Fraud & Mule Risk Scores</h2>
              <p className="text-xs text-muted">
                Click any row to inspect local SHAP attributions or rule-based factors
              </p>
            </div>
            <span className="font-mono text-xs text-muted tabular-nums">
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
                <thead className="border-b border-border-subtle bg-highlight text-[11px] font-semibold uppercase tracking-wider text-heading">
                  <tr>
                    <th className="px-4 py-2.5">Account</th>
                    <th className="px-4 py-2.5 text-right">Mule Score</th>
                    <th className="px-4 py-2.5">Anomaly / Velocity</th>
                    <th className="px-4 py-2.5">Attribution</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {predictions.map((pred) => {
                    const isSelected = selectedPred?.id === pred.id;
                    return (
                      <tr
                        key={pred.id}
                        onClick={() => setSelectedPred(pred)}
                        className={`cursor-pointer ${
                          isSelected ? 'bg-highlight' : 'hover:bg-subtle'
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <p className="font-mono font-semibold text-heading">
                            {pred.account_number}
                          </p>
                          <p className="text-[11px] text-muted">
                            {pred.holder_name} · {pred.complaint_number ?? 'General'}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                          <p className="text-sm font-bold text-heading">
                            {Number(pred.mule_score).toFixed(1)}/100
                          </p>
                          <p className="text-[11px] text-muted">
                            PT: {(Number(pred.pass_through_ratio) * 100).toFixed(0)}%
                          </p>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <StatusSignal
                            level={pred.is_anomaly ? 'HIGH' : 'LOW'}
                            label={pred.is_anomaly ? 'IsoForest Anomaly' : 'Normal'}
                          />
                          <p className="font-mono text-[11px] text-muted tabular-nums mt-0.5">
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
                              className={`inline-flex items-center gap-1 rounded-[4px] border px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                                pred.is_frozen
                                  ? 'border-border-subtle bg-subtle text-body'
                                  : 'border-red-300 bg-[#FEE2E2] text-[#991B1B] hover:opacity-90 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200'
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
        <div className="xl:col-span-5 rounded-[6px] border border-border-subtle bg-card overflow-hidden">
          <div className="border-b border-border-subtle bg-grad-ai p-4 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-heading">Local Prediction Explainability</h2>
              <p className="text-xs text-body">
                {selectedPred
                  ? `${selectedPred.account_number} · ${selectedPred.holder_name}`
                  : 'Select an account row'}
              </p>
            </div>
            {selectedPred ? <ScoreSourceBadge source={selectedPred.score_source} /> : null}
          </div>

          <div className="p-4">
            {!selectedPred ? (
              <EmptyDataState
                title="No account selected"
                description="Click an account in the risk table to examine SHAP feature attributions."
              />
            ) : activeShapFactors.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-body">
                  TreeSHAP feature contributions pushing predicted label{' '}
                  <span className="font-mono font-semibold text-accent-strong">
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
                          <span className="font-mono text-heading">{item.feature}</span>
                          <span
                            className={`font-mono tabular-nums font-medium ${
                              increases
                                ? 'text-[#991B1B] dark:text-red-400'
                                : 'text-[#065F46] dark:text-emerald-400'
                            }`}
                          >
                            {increases ? '+' : ''}
                            {item.shap_value.toFixed(4)} (val={item.value})
                          </span>
                        </div>
                        <div className="h-2 w-full rounded bg-subtle overflow-hidden border border-border-subtle/50">
                          <div
                            className={`h-full rounded ${
                              increases ? 'bg-[#DC2626] dark:bg-red-500' : 'bg-[#10B981]'
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
                <div className="flex items-center gap-2 text-xs font-semibold text-[#92400E] dark:text-amber-300">
                  <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                  Rule-Based Risk Heuristic Factors
                </div>
                <ul className="space-y-1.5 text-xs text-body list-disc pl-5">
                  {selectedPred.explanation_json.rule_factors.map((rf, i) => (
                    <li key={i}>{rf}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-muted">
                No SHAP vector persisted for this row. Run Fraud Detection after model training to compute TreeSHAP attributions.
              </p>
            )}
          </div>
        </div>
      </section>
    </CommandLayout>
  );
}
