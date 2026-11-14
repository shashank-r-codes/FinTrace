import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Lock,
  PauseCircle,
  RefreshCw,
  Settings,
  Shield,
  ShieldAlert,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, TableSkeleton } from '../components/common/DataState';
import { ScoreSourceBadge } from '../components/common/ScoreSourceBadge';
import { CommandLayout } from '../components/layout/CommandLayout';
import {
  AccountIntelligenceProfile,
  ApiSuccessResponse,
  RecommendedAction,
  RiskClassification,
  ScreeningDecision,
  ScreeningResult,
  ScreeningThresholds,
} from '../types';
import { formatInr, formatTimestamp } from '../utils/formatters';

const DISCLAIMER =
  'FinTrace returns RECOMMENDATIONS. Simulated intervention only. No actual banking freeze or fund blocking is executed on live financial rails.';

interface RecentScreeningItem {
  id: string;
  idempotency_key: string;
  amount: number;
  currency: string;
  channel: string;
  client_id?: string;
  decision: ScreeningDecision;
  risk_score: number;
  risk_classification: RiskClassification;
  latency_ms: number;
  applied_fail_mode: string;
  screened_at: string;
  sender_id: string;
  sender_account_number: string;
  sender_holder_name: string;
  sender_bank: string;
  receiver_id: string;
  receiver_account_number: string;
  receiver_holder_name: string;
  receiver_bank: string;
  recommended_action?: RecommendedAction;
  review_status?: string;
}

const PRESET_SCENARIOS = [
  {
    id: 'A',
    label: 'Scenario A: Retail P2P (Low Risk)',
    description: 'Legitimate peer-to-peer transfer between known retail accounts.',
    expected: 'Allow (Score ~15)',
    channel: 'UPI' as const,
    amount: 2450,
  },
  {
    id: 'B',
    label: 'Scenario B: First-Time Beneficiary Spike',
    description: 'Transfer exceeds 3x typical peer-to-peer volume for newly added payee.',
    expected: 'Verify (Score ~58)',
    channel: 'IMPS' as const,
    amount: 48000,
  },
  {
    id: 'C',
    label: 'Scenario C: Rapid Pass-Through Mule Burst',
    description: 'Receiver exhibits 6 fan-in receipts in 30m followed by rapid outflow.',
    expected: 'Hold (Score ~78)',
    channel: 'IMPS' as const,
    amount: 185000,
  },
  {
    id: 'D',
    label: 'Scenario D: Flagged Network Node',
    description: 'Transfer directed into an account with direct links to known mule rings.',
    expected: 'Hold (Score ~81)',
    channel: 'NEFT' as const,
    amount: 220000,
  },
  {
    id: 'E',
    label: 'Scenario E: Dormant Account Sudden Outflow',
    description: 'Account dormant for 180+ days suddenly initiating high-value RTGS transfer.',
    expected: 'Hold (Score ~75)',
    channel: 'RTGS' as const,
    amount: 475000,
  },
  {
    id: 'F',
    label: 'Scenario F: Confirmed Cybercrime Link (Critical)',
    description: 'Transfer directly targeting an account linked to an active police FIR.',
    expected: 'Block (Score ~95)',
    channel: 'RTGS' as const,
    amount: 950000,
  },
  {
    id: 'G',
    label: 'Scenario G: High-Value Commercial Payroll',
    description: 'Corporate high-velocity batch settlement candidate for false-positive review.',
    expected: 'Hold -> Review (Score ~72)',
    channel: 'RTGS' as const,
    amount: 1200000,
  },
];

export function RealTimeScreeningPage() {
  // Form state
  const [senderAccountId, setSenderAccountId] = useState<string>('');
  const [receiverAccountId, setReceiverAccountId] = useState<string>('');
  const [amount, setAmount] = useState<number>(25000);
  const [channel, setChannel] = useState<'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'CARD' | 'WALLET'>('UPI');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => `FINT-SCR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`);
  const [clientId, setClientId] = useState<string>('CORE_BANKING_BLR_01');
  const [ipAddress, setIpAddress] = useState<string>('49.207.195.42');

  // Evaluation & Results
  const [screening, setScreening] = useState<boolean>(false);
  const [screenResult, setScreenResult] = useState<ScreeningResult | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [rawJsonOpen, setRawJsonOpen] = useState<boolean>(false);

  // Monitored accounts list for dropdown selection
  const [accounts, setAccounts] = useState<AccountIntelligenceProfile[]>([]);
  const [accountsLoading, setAccountsLoading] = useState<boolean>(false);

  // Recent screening activity feed
  const [recentRequests, setRecentRequests] = useState<RecentScreeningItem[]>([]);
  const [recentLoading, setRecentLoading] = useState<boolean>(false);
  const [recentTotal, setRecentTotal] = useState<number>(0);
  const [filterDecision, setFilterDecision] = useState<string>('ALL');

  // Thresholds Modal
  const [thresholdModalOpen, setThresholdModalOpen] = useState<boolean>(false);
  const [thresholds, setThresholds] = useState<ScreeningThresholds | null>(null);
  const [thresholdLoading, setThresholdLoading] = useState<boolean>(false);
  const [lowMax, setLowMax] = useState<number>(40);
  const [medMax, setMedMax] = useState<number>(65);
  const [highMax, setHighMax] = useState<number>(80);
  const [reasonForChange, setReasonForChange] = useState<string>('');
  const [savingThresholds, setSavingThresholds] = useState<boolean>(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [thresholdSuccess, setThresholdSuccess] = useState<string | null>(null);

  // Load account intelligence options
  useEffect(() => {
    async function loadAccounts() {
      setAccountsLoading(true);
      try {
        const res = await apiRequest<
          ApiSuccessResponse<{
            accounts: AccountIntelligenceProfile[];
            total: number;
          }>
        >('/accounts/intelligence?limit=50');
        if (res?.data?.accounts) {
          setAccounts(res.data.accounts);
          if (res.data.accounts.length >= 2) {
            setSenderAccountId(res.data.accounts[0].account_id);
            setReceiverAccountId(res.data.accounts[1].account_id);
          }
        }
      } catch (err) {
        console.error('Failed to load accounts for screening form', err);
      } finally {
        setAccountsLoading(false);
      }
    }
    loadAccounts();
  }, []);

  // Fetch recent screenings
  const fetchRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const params = new URLSearchParams({ limit: '15' });
      if (filterDecision !== 'ALL') {
        params.append('decision', filterDecision);
      }
      const res = await apiRequest<
        ApiSuccessResponse<{
          requests: RecentScreeningItem[];
          total: number;
        }>
      >(`/screening/requests?${params.toString()}`);
      if (res?.data) {
        setRecentRequests(res.data.requests || []);
        setRecentTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load recent screenings', err);
    } finally {
      setRecentLoading(false);
    }
  }, [filterDecision]);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  // Load active thresholds
  const loadThresholds = async () => {
    setThresholdLoading(true);
    setThresholdError(null);
    setThresholdSuccess(null);
    try {
      const res = await apiRequest<ApiSuccessResponse<ScreeningThresholds>>('/screening/thresholds');
      if (res?.data) {
        setThresholds(res.data);
        setLowMax(res.data.low_max);
        setMedMax(res.data.medium_max);
        setHighMax(res.data.high_max);
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setThresholdError(apiErr.message || 'Failed to fetch thresholds.');
    } finally {
      setThresholdLoading(false);
    }
  };

  const handleOpenThresholds = () => {
    setThresholdModalOpen(true);
    loadThresholds();
  };

  const handleSaveThresholds = async () => {
    setThresholdError(null);
    setThresholdSuccess(null);
    if (!reasonForChange.trim()) {
      setThresholdError('An administrative justification note is mandatory for audit compliance.');
      return;
    }
    if (lowMax >= medMax || medMax >= highMax) {
      setThresholdError('Thresholds must strictly follow: Low < Medium < High.');
      return;
    }

    setSavingThresholds(true);
    try {
      const res = await apiRequest<ApiSuccessResponse<ScreeningThresholds>>('/screening/thresholds', {
        method: 'PUT',
        body: JSON.stringify({
          low_max: Number(lowMax),
          medium_max: Number(medMax),
          high_max: Number(highMax),
          reason_for_change: reasonForChange.trim(),
        }),
      });
      if (res?.data) {
        setThresholds(res.data);
        setThresholdSuccess(`Thresholds updated to Version ${res.data.version}.`);
        setReasonForChange('');
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setThresholdError(apiErr.message || 'Failed to save updated thresholds.');
    } finally {
      setSavingThresholds(false);
    }
  };

  // Submit screening evaluation
  const handleExecuteScreening = async () => {
    setScreenError(null);
    setScreenResult(null);

    if (!senderAccountId || !receiverAccountId) {
      setScreenError('Both sender and receiver accounts must be selected.');
      return;
    }
    if (senderAccountId === receiverAccountId) {
      setScreenError('Sender and receiver accounts cannot be identical.');
      return;
    }
    if (amount <= 0) {
      setScreenError('Transfer amount must be greater than zero.');
      return;
    }

    setScreening(true);
    try {
      const res = await apiRequest<ApiSuccessResponse<ScreeningResult>>('/screening/screen', {
        method: 'POST',
        headers: {
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({
          senderAccountId,
          receiverAccountId,
          amount: Number(amount),
          currency: 'INR',
          channel,
          clientId,
          ipAddress,
        }),
      });

      if (res?.data) {
        setScreenResult(res.data);
        fetchRecent();
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setScreenError(apiErr.message || 'Screening engine returned an evaluation error.');
    } finally {
      setScreening(false);
    }
  };

  // Quick-run preset scenario
  const handleSelectScenario = async (scen: typeof PRESET_SCENARIOS[0]) => {
    setScreenError(null);
    setScreenResult(null);
    setChannel(scen.channel);
    setAmount(scen.amount);
    const newIdemp = `FINT-IDEMP-${Date.now().toString(36).toUpperCase()}-SCEN-${scen.id}`;
    setIdempotencyKey(newIdemp);

    setScreening(true);
    try {
      const res = await apiRequest<ApiSuccessResponse<ScreeningResult>>('/screening/simulate-switch', {
        method: 'POST',
        body: JSON.stringify({
          scenarioId: scen.id,
          channel: scen.channel,
          amount: scen.amount,
        }),
      });

      if (res?.data) {
        setScreenResult(res.data);
        if (res.data.senderAccount?.id) {
          setSenderAccountId(res.data.senderAccount.id);
        }
        if (res.data.receiverAccount?.id) {
          setReceiverAccountId(res.data.receiverAccount.id);
        }
        fetchRecent();
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setScreenError(apiErr.message || `Failed to run Scenario ${scen.id}.`);
    } finally {
      setScreening(false);
    }
  };

  const getDecisionBadge = (d: ScreeningDecision) => {
    switch (d) {
      case 'ALLOW':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] text-xs font-medium border border-border-subtle bg-subtle text-heading">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Allow
          </span>
        );
      case 'VERIFY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] text-xs font-medium border border-border-subtle bg-subtle text-heading">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> Additional verification
          </span>
        );
      case 'HOLD':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] text-xs font-medium border border-border-subtle bg-subtle text-heading">
            <PauseCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> Hold for review
          </span>
        );
      case 'BLOCK':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] text-xs font-medium border border-border-subtle bg-subtle text-heading">
            <Lock className="w-3.5 h-3.5 text-red-600 dark:text-red-400" /> Block recommended
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <CommandLayout
      title="Real-time transaction screening engine"
      section="Fraud prevention"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenThresholds}
            className="flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
          >
            <Settings className="h-3.5 w-3.5 text-muted" />
            <span>Threshold rules</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIdempotencyKey(`FINT-SCR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`);
            }}
            className="flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
            title="Generate new idempotency key"
          >
            <RefreshCw className="h-3.5 w-3.5 text-muted" />
            <span>New key</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Safety Disclaimer Banner */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-3.5 text-xs text-body flex items-start gap-2.5">
          <Shield className="h-4 w-4 text-muted shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium text-heading">
              Pre-authorisation prevention architecture
            </p>
            <p className="text-[11px] text-muted">{DISCLAIMER}</p>
          </div>
        </section>

        {/* Quick Scenario Runner Bar */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Instant scenario quick-loader
            </h2>
            <span className="text-[11px] font-mono text-muted">Evaluation latency &lt; 50ms</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-2">
            {PRESET_SCENARIOS.map((scen) => (
              <button
                key={scen.id}
                type="button"
                disabled={screening}
                onClick={() => handleSelectScenario(scen)}
                className="text-left rounded-[8px] border border-border-subtle bg-subtle/40 p-2.5 hover:bg-subtle hover:border-border-strong transition-colors cursor-pointer disabled:opacity-50 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold text-accent-strong">
                    [{scen.id}]
                  </span>
                  <span className="text-[10px] font-mono text-muted">{scen.channel}</span>
                </div>
                <p className="text-[11px] font-medium text-heading truncate">{scen.label.split(':')[1] || scen.label}</p>
                <p className="text-[10px] font-mono text-muted tabular-nums truncate">{formatInr(scen.amount)}</p>
                <div className="pt-0.5">
                  <span className="text-[9px] font-mono text-muted">{scen.expected}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Main Grid: Screening Form & Live Results */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Screening Input Form */}
          <div className="lg:col-span-5 rounded-[12px] border border-border-subtle bg-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Screening request</h3>
              <span className="rounded-[6px] border border-border-subtle bg-subtle px-2 py-0.5 text-[10px] font-mono text-muted">
                POST /screening/screen
              </span>
            </div>

            {screenError && (
              <div className="rounded-[8px] border border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 p-2.5 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{screenError}</span>
              </div>
            )}

            <div className="space-y-3.5 text-xs">
              {/* Sender Account */}
              <div>
                <label className="block font-medium text-body mb-1">
                  Sender (originating account)
                </label>
                {accountsLoading ? (
                  <div className="h-8 rounded-[8px] bg-subtle animate-pulse" />
                ) : (
                  <select
                    value={senderAccountId}
                    onChange={(e) => setSenderAccountId(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-2 text-xs text-heading focus:outline-none focus:border-accent-strong transition-colors"
                  >
                    <option value="">Select originating account...</option>
                    {accounts.map((acc) => (
                      <option key={acc.account_id} value={acc.account_id}>
                        {acc.account_number} — {acc.holder_name} ({acc.bank_name}) [Risk: {acc.risk_score}]
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Receiver Account */}
              <div>
                <label className="block font-medium text-body mb-1">
                  Receiver (beneficiary account)
                </label>
                {accountsLoading ? (
                  <div className="h-8 rounded-[8px] bg-subtle animate-pulse" />
                ) : (
                  <select
                    value={receiverAccountId}
                    onChange={(e) => setReceiverAccountId(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-2 text-xs text-heading focus:outline-none focus:border-accent-strong transition-colors"
                  >
                    <option value="">Select beneficiary account...</option>
                    {accounts.map((acc) => (
                      <option key={acc.account_id} value={acc.account_id}>
                        {acc.account_number} — {acc.holder_name} ({acc.bank_name}) [{acc.account_status}]
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Amount & Channel */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-body mb-1">Amount (INR)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-2 text-xs font-mono text-heading focus:outline-none focus:border-accent-strong transition-colors"
                  />
                </div>

                <div>
                  <label className="block font-medium text-body mb-1">Payment rail</label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as any)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-2 text-xs text-heading focus:outline-none focus:border-accent-strong transition-colors"
                  >
                    <option value="UPI">UPI</option>
                    <option value="IMPS">IMPS</option>
                    <option value="NEFT">NEFT</option>
                    <option value="RTGS">RTGS</option>
                    <option value="CARD">CARD</option>
                    <option value="WALLET">WALLET</option>
                  </select>
                </div>
              </div>

              {/* Idempotency Key & Client ID */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-body mb-1">Idempotency key</label>
                  <input
                    type="text"
                    value={idempotencyKey}
                    onChange={(e) => setIdempotencyKey(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2 py-1.5 text-[11px] font-mono text-heading focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-body mb-1">Client / Node ID</label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2 py-1.5 text-[11px] font-mono text-heading focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-body mb-1">Origin IP address</label>
                  <input
                    type="text"
                    value={ipAddress}
                    onChange={(e) => setIpAddress(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app px-2 py-1.5 text-[11px] font-mono text-heading focus:outline-none"
                  />
                </div>
              </div>

              {/* Submit CTA */}
              <button
                type="button"
                disabled={screening || accountsLoading}
                onClick={handleExecuteScreening}
                className="w-full rounded-[8px] bg-accent-strong text-white py-2.5 px-4 text-xs font-medium hover:bg-accent-strong-hover disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer transition-colors duration-120"
              >
                {screening ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Evaluating risk signals (&lt; 50ms)...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>Evaluate transaction (pre-authorisation)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Screening Evaluation Result Panel */}
          <div className="lg:col-span-7 rounded-[12px] border border-border-subtle bg-card p-5 flex flex-col justify-between">
            {screenResult ? (
              <div className="space-y-4">
                {/* Result Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">Screening decision:</span>
                      {getDecisionBadge(screenResult.decision)}
                    </div>
                    <p className="text-[11px] font-mono text-muted tabular-nums">
                      ID: {screenResult.screeningId} · {formatTimestamp(screenResult.screenedAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 rounded-[6px] border border-border-subtle bg-subtle px-2 py-1 text-xs font-mono text-muted tabular-nums">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{screenResult.latencyMs} ms</span>
                    </div>
                    <ScoreSourceBadge source={screenResult.scoreSource} />
                  </div>
                </div>

                {/* Score Summary Banner */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="rounded-[8px] border border-border-subtle bg-subtle/30 p-3">
                    <span className="text-[10px] font-medium text-muted uppercase">Composite score</span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-2xl font-semibold text-heading tabular-nums">
                        {screenResult.compositeScore}
                      </span>
                      <span className="text-xs text-muted">/ 100</span>
                    </div>
                    <span className="text-[10px] text-muted">
                      Risk: <strong>{screenResult.riskClassification}</strong>
                    </span>
                  </div>

                  <div className="rounded-[8px] border border-border-subtle bg-subtle/30 p-3">
                    <span className="text-[10px] font-medium text-muted uppercase">Sender risk</span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-xl font-semibold text-heading tabular-nums">
                        {screenResult.senderRiskScore}
                      </span>
                      <span className="text-xs text-muted">/ 100</span>
                    </div>
                    <span className="text-[10px] text-muted truncate block">
                      {screenResult.senderAccount?.holderName || 'Sender'}
                    </span>
                  </div>

                  <div className="rounded-[8px] border border-border-subtle bg-subtle/30 p-3">
                    <span className="text-[10px] font-medium text-muted uppercase">Receiver risk</span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-xl font-semibold text-heading tabular-nums">
                        {screenResult.receiverRiskScore}
                      </span>
                      <span className="text-xs text-muted">/ 100</span>
                    </div>
                    <span className="text-[10px] text-muted truncate block">
                      {screenResult.receiverAccount?.holderName || 'Receiver'}
                    </span>
                  </div>

                  <div className="rounded-[8px] border border-border-subtle bg-subtle/30 p-3">
                    <span className="text-[10px] font-medium text-muted uppercase">Recommended action</span>
                    <div className="mt-1">
                      <span className="text-xs font-medium text-heading">
                        {screenResult.recommendedAction.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted">
                      FailMode: {screenResult.appliedFailMode}
                    </span>
                  </div>
                </div>

                {/* Plain-Language Explanation */}
                <div className="rounded-[8px] border border-border-subtle bg-subtle/30 p-3 space-y-1">
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                    Officer forensic summary
                  </span>
                  <p className="text-xs text-body leading-relaxed">
                    {screenResult.plainLanguageExplanation}
                  </p>
                </div>

                {/* Triggered Rules & Contributing Factors */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                      Triggered rules & risk factors
                    </span>
                    <span className="text-[11px] text-muted">
                      {screenResult.rulesTriggered.length} factors evaluated
                    </span>
                  </div>

                  {screenResult.rulesTriggered.length === 0 ? (
                    <div className="rounded-[8px] border border-border-subtle bg-subtle/40 p-3 text-xs text-muted flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>No anomalous risk rules or suspicious deviations triggered for this transaction.</span>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {screenResult.rulesTriggered.map((rule, idx) => (
                        <div
                          key={rule.rule_id || idx}
                          className="flex items-start justify-between rounded-[8px] border border-border-subtle bg-subtle/30 p-2.5 text-xs"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-heading">{rule.name}</span>
                              <span className="px-1.5 py-0.5 rounded-[4px] bg-subtle text-[10px] font-mono text-muted">
                                {rule.category}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted">
                              {(rule as { description?: string }).description || rule.name}
                            </p>
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <span className="font-mono font-medium text-heading tabular-nums">
                              +{rule.contribution} pts
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action CTAs */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border-subtle">
                  <button
                    type="button"
                    onClick={() => setRawJsonOpen(!rawJsonOpen)}
                    className="text-xs text-muted hover:text-heading cursor-pointer transition-colors"
                  >
                    {rawJsonOpen ? 'Hide raw JSON' : 'Inspect raw response'}
                  </button>

                  <div className="flex items-center gap-2">
                    {(screenResult.decision === 'HOLD' || screenResult.decision === 'BLOCK') && (
                      <Link
                        to={`/interventions?search=${screenResult.screeningId}`}
                        className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong text-white px-3 py-1.5 text-xs font-medium hover:bg-accent-strong-hover cursor-pointer transition-colors"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Open in intervention centre</span>
                      </Link>
                    )}
                  </div>
                </div>

                {/* Raw JSON viewer */}
                {rawJsonOpen && (
                  <pre className="rounded-[8px] bg-app border border-border-subtle p-3 text-[11px] font-mono text-heading overflow-x-auto max-h-56">
                    {JSON.stringify(screenResult, null, 2)}
                  </pre>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-subtle border border-border-subtle flex items-center justify-center text-muted">
                  <Zap className="w-5 h-5 text-accent-strong" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Engine standby</h4>
                  <p className="text-xs text-muted max-w-sm">
                    Select originating and beneficiary accounts or click any scenario preset above to run real-time pre-authorisation risk screening.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Recent Screening Activity Feed */}
        <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border-subtle bg-subtle/50">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-accent-strong" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Recent screening evaluations</h3>
              <span className="text-xs text-muted font-mono tabular-nums">({recentTotal} records)</span>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filterDecision}
                onChange={(e) => setFilterDecision(e.target.value)}
                className="text-xs rounded-[8px] border border-border-subtle bg-app px-2.5 py-1 text-heading focus:outline-none transition-colors"
              >
                <option value="ALL">All decisions</option>
                <option value="ALLOW">Allow</option>
                <option value="VERIFY">Verify</option>
                <option value="HOLD">Hold</option>
                <option value="BLOCK">Block</option>
              </select>

              <button
                type="button"
                onClick={fetchRecent}
                className="rounded-[6px] border border-border-subtle bg-card p-1 text-muted hover:text-heading cursor-pointer transition-colors"
                title="Refresh requests"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${recentLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {recentLoading ? (
            <div className="p-4">
              <TableSkeleton rows={5} />
            </div>
          ) : recentRequests.length === 0 ? (
            <div className="p-6">
              <EmptyDataState
                title="No screening requests"
                description="No pre-authorisation transactions match the selected filter."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border-subtle bg-highlight/40 text-[11px] font-medium uppercase tracking-wider text-muted">
                    <th className="py-2.5 px-3">Screened at</th>
                    <th className="py-2.5 px-3">Sender account</th>
                    <th className="py-2.5 px-3">Receiver account</th>
                    <th className="py-2.5 px-3">Amount & rail</th>
                    <th className="py-2.5 px-3">Risk assessment</th>
                    <th className="py-2.5 px-3">Decision</th>
                    <th className="py-2.5 px-3">Latency</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {recentRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-subtle/60 transition-colors duration-120">
                      <td className="py-2 px-3 text-muted whitespace-nowrap">
                        <div className="tabular-nums">{formatTimestamp(req.screened_at)}</div>
                        <div className="font-mono text-[10px] text-muted">{req.id.substring(0, 8)}...</div>
                      </td>

                      <td className="py-2 px-3">
                        <div className="font-medium text-heading">{req.sender_holder_name}</div>
                        <div className="font-mono text-[11px] text-muted">
                          {req.sender_account_number} ({req.sender_bank})
                        </div>
                      </td>

                      <td className="py-2 px-3">
                        <div className="font-medium text-heading">{req.receiver_holder_name}</div>
                        <div className="font-mono text-[11px] text-muted">
                          {req.receiver_account_number} ({req.receiver_bank})
                        </div>
                      </td>

                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="font-medium text-heading font-mono tabular-nums">{formatInr(req.amount)}</div>
                        <span className="font-mono text-[10px] text-muted">
                          {req.channel}
                        </span>
                      </td>

                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold text-heading tabular-nums">
                            {req.risk_score}
                          </span>
                          <span className="text-[10px] text-muted">({req.risk_classification})</span>
                        </div>
                      </td>

                      <td className="py-2 px-3">
                        {getDecisionBadge(req.decision)}
                      </td>

                      <td className="py-2 px-3 font-mono text-[11px] text-muted tabular-nums">
                        {req.latency_ms} ms
                      </td>

                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {(req.decision === 'HOLD' || req.decision === 'BLOCK') && (
                          <Link
                            to={`/interventions?search=${req.id}`}
                            className="rounded-[8px] border border-border-subtle bg-card px-2 py-1 text-[11px] font-medium text-heading hover:bg-subtle cursor-pointer inline-flex items-center gap-1 transition-colors"
                          >
                            <span>Intervene</span>
                            <ArrowRight className="w-3 h-3 text-accent-strong" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Threshold Rules Modal */}
        {thresholdModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="relative w-full max-w-lg rounded-[16px] border border-border-subtle bg-card p-5 shadow-2xl space-y-4">
              <div className="flex items-start justify-between border-b border-border-subtle pb-3">
                <div className="space-y-0.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-heading">Screening risk thresholds</h3>
                  <p className="text-xs text-muted">
                    Configurable decision boundaries (Version: {thresholds?.version || 1})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setThresholdModalOpen(false)}
                  className="rounded-[6px] p-1 text-muted hover:bg-subtle cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {thresholdError && (
                <div className="rounded-[8px] border border-red-300 bg-red-50 p-2 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                  {thresholdError}
                </div>
              )}

              {thresholdSuccess && (
                <div className="rounded-[8px] border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                  {thresholdSuccess}
                </div>
              )}

              <div className="space-y-4 text-xs">
                {/* Sliders */}
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="font-medium text-body">
                        Allow (low risk max cutoff)
                      </span>
                      <span className="font-mono font-medium text-heading tabular-nums">0 to {lowMax}</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="60"
                      value={lowMax}
                      onChange={(e) => setLowMax(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="font-medium text-body">
                        Additional verification (medium cutoff)
                      </span>
                      <span className="font-mono font-medium text-heading tabular-nums">{lowMax} to {medMax}</span>
                    </div>
                    <input
                      type="range"
                      min="30"
                      max="80"
                      value={medMax}
                      onChange={(e) => setMedMax(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="font-medium text-body">
                        Hold for review (high cutoff)
                      </span>
                      <span className="font-mono font-medium text-heading tabular-nums">{medMax} to {highMax}</span>
                    </div>
                    <input
                      type="range"
                      min="60"
                      max="95"
                      value={highMax}
                      onChange={(e) => setHighMax(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="font-medium text-body">
                        Reject / block (critical range)
                      </span>
                      <span className="font-mono font-medium text-heading tabular-nums">{highMax} to 100</span>
                    </div>
                  </div>
                </div>

                {/* Reason for change */}
                <div>
                  <label className="block font-medium text-body mb-1">
                    Administrative reason for change (audited)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Enter policy or institutional rationale for threshold tuning..."
                    value={reasonForChange}
                    onChange={(e) => setReasonForChange(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-app p-2 text-xs text-heading focus:outline-none focus:border-accent-strong transition-colors"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setThresholdModalOpen(false)}
                  className="rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={savingThresholds || thresholdLoading}
                  onClick={handleSaveThresholds}
                  className="rounded-[8px] bg-accent-strong text-white px-4 py-1.5 text-xs font-medium hover:bg-accent-strong-hover disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {savingThresholds ? 'Updating...' : 'Save & publish rules'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </CommandLayout>
  );
}
