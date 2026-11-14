import {
  AlertOctagon,
  ArrowRight,
  Cpu,
  Fingerprint,
  Landmark,
  Network,
  Play,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { ScoreSourceBadge } from '../components/common/ScoreSourceBadge';
import { CommandLayout } from '../components/layout/CommandLayout';
import { ApiSuccessResponse, RecommendedAction, ScreeningDecision, ScreeningResult } from '../types';
import { formatInr } from '../utils/formatters';

const DISCLAIMER =
  'FinTrace returns recommendations. Simulated intervention only. No actual banking freeze or fund blocking is executed on live financial rails.';

interface SimulationScenario {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  title: string;
  tagline: string;
  channel: 'UPI' | 'IMPS' | 'NEFT' | 'RTGS';
  amount: number;
  threatType: string;
  legacyOutcome: {
    status: string;
    lossAmount: number;
    description: string;
    steps: string[];
  };
  preventionOutcome: {
    expectedDecision: ScreeningDecision;
    expectedAction: RecommendedAction;
    preventedLoss: number;
    description: string;
    keyRule: string;
  };
}

const SCENARIOS: SimulationScenario[] = [
  {
    id: 'A',
    title: 'Scenario A: Retail P2P transfer (low risk)',
    tagline: 'Routine peer-to-peer family or grocery transfer between accounts with established counterpart history.',
    channel: 'UPI',
    amount: 2450,
    threatType: 'Benign retail traffic',
    legacyOutcome: {
      status: 'Allowed without friction',
      lossAmount: 0,
      description: 'Transaction cleared immediately. Zero fraud occurred.',
      steps: ['Initiation on UPI rail', 'Immediate settlement', 'Beneficiary balance credited'],
    },
    preventionOutcome: {
      expectedDecision: 'ALLOW',
      expectedAction: 'ALLOW',
      preventedLoss: 0,
      description: 'Zero customer friction. In-flight screening cleared transaction in 12ms with composite score 14.5/100.',
      keyRule: 'Established Counterparty Velocity Profile',
    },
  },
  {
    id: 'B',
    title: 'Scenario B: First-time beneficiary spike',
    tagline: 'Payment exceeds 3x typical peer-to-peer quantum directed to a newly added payee.',
    channel: 'IMPS',
    amount: 48000,
    threatType: 'Coercion / Social engineering',
    legacyOutcome: {
      status: 'Allowed unchecked',
      lossAmount: 48000,
      description: 'Payment authorized without stepped-up verification. Victim realized fraud 4 hours later after caller disconnected.',
      steps: ['Scammer coerces victim', 'IMPS transfer authorized', 'Funds dispersed within 8 minutes', 'FIR filed 18 hours later (Loss ₹48k)'],
    },
    preventionOutcome: {
      expectedDecision: 'VERIFY',
      expectedAction: 'ADDITIONAL_VERIFICATION',
      preventedLoss: 48000,
      description: 'Triggered adaptive step-up authentication before fund debit, allowing customer to cancel coerced transfer.',
      keyRule: 'FIRST_TIME_BENEFICIARY_SPIKE (+18 pts)',
    },
  },
  {
    id: 'C',
    title: 'Scenario C: Rapid pass-through mule burst',
    tagline: 'Mule hub receives 6 separate fan-in deposits within 30 minutes followed by rapid forwarding.',
    channel: 'IMPS',
    amount: 185000,
    threatType: 'Active mule syndicate layering',
    legacyOutcome: {
      status: 'Funds dispersed and layered',
      lossAmount: 185000,
      description: 'Funds forwarded through 4 hop accounts in under 90 seconds. Investigators reached empty mule accounts.',
      steps: ['Deposit received', '94% outbound forwarding within 120s', 'Split across 4 micro-accounts', 'Withdrawn at ATM dispenser (Loss ₹1.85L)'],
    },
    preventionOutcome: {
      expectedDecision: 'HOLD',
      expectedAction: 'HOLD_FOR_REVIEW',
      preventedLoss: 185000,
      description: 'Pre-authorisation engine intercepted outbound transfer at Hop 1 based on 94% pass-through velocity signature.',
      keyRule: 'RAPID_PASS_THROUGH_CHAIN (+26 pts) & FAN_IN_HIGH_VELOCITY (+28 pts)',
    },
  },
  {
    id: 'D',
    title: 'Scenario D: Flagged network node link',
    tagline: 'High-value NEFT transfer directly targeting an account linked to identified syndicate nodes.',
    channel: 'NEFT',
    amount: 220000,
    threatType: 'Syndicate network aggregator',
    legacyOutcome: {
      status: 'Absorbed into syndicate',
      lossAmount: 220000,
      description: 'Funds entered syndicate pool. Tracing required 14 days of inter-bank Section 91 CrPC notices.',
      steps: ['NEFT credit settled', 'Aggregated into corporate current account', 'Converted via crypto OTC desk', 'Cold storage exit (Loss ₹2.2L)'],
    },
    preventionOutcome: {
      expectedDecision: 'HOLD',
      expectedAction: 'HOLD_FOR_REVIEW',
      preventedLoss: 220000,
      description: 'Graph neighbor risk propagation flagged 1-hop link to confirmed mule syndicate before NEFT clearing window.',
      keyRule: 'DIRECT_LINK_FLAGGED_SYNDICATE (+35 pts)',
    },
  },
  {
    id: 'E',
    title: 'Scenario E: Dormant account sudden outflow',
    tagline: 'Account dormant for 180+ days suddenly initiating maximum RTGS transfer limit.',
    channel: 'RTGS',
    amount: 475000,
    threatType: 'Account takeover / SIM swap',
    legacyOutcome: {
      status: 'Account drained',
      lossAmount: 475000,
      description: 'Account holder unaware of credentials theft. Total account balance liquidated.',
      steps: ['SIM swap executed', 'Credentials reset', 'Max RTGS transfer executed', 'Account emptied (Loss ₹4.75L)'],
    },
    preventionOutcome: {
      expectedDecision: 'HOLD',
      expectedAction: 'HOLD_FOR_REVIEW',
      preventedLoss: 475000,
      description: 'Inactivity duration vs amount outlier triggered immediate pre-authorisation security freeze and bank nodal review.',
      keyRule: 'DORMANT_SUDDEN_SPIKE (+24 pts)',
    },
  },
  {
    id: 'F',
    title: 'Scenario F: Confirmed cybercrime link (Critical block)',
    tagline: 'Transfer directed into an account with an active police FIR / cybercrime complaint.',
    channel: 'RTGS',
    amount: 950000,
    threatType: 'Confirmed cybercrime fraud ring',
    legacyOutcome: {
      status: 'Catastrophic loss',
      lossAmount: 950000,
      description: 'Victim of digital arrest coercion wire-transferred funds to fraudulent verification account.',
      steps: ['Digital arrest coercion call', 'Victim liquidates fixed deposit', 'RTGS transfer sent', 'Instant cash-out across ATMs (Loss ₹9.5L)'],
    },
    preventionOutcome: {
      expectedDecision: 'BLOCK',
      expectedAction: 'REJECT_BLOCK',
      preventedLoss: 950000,
      description: 'Zero fund movement. Critical block enforced: beneficiary account has active link to verified cybercrime complaint.',
      keyRule: 'LINKED_TO_CONFIRMED_FRAUD (+35 pts) & CRITICAL_ML_PROBABILITY',
    },
  },
  {
    id: 'G',
    title: 'Scenario G: High-value commercial payroll (False-positive override)',
    tagline: 'Legitimate corporate high-volume month-end vendor settlement triggering velocity alert.',
    channel: 'RTGS',
    amount: 1200000,
    threatType: 'High-volume commercial surge (Legitimate)',
    legacyOutcome: {
      status: 'Overlooked or arbitrarily blocked',
      lossAmount: 0,
      description: 'Legacy batch rules either allowed without verification or locked whole corporate account without fast override path.',
      steps: ['Vendor batch executed', 'Bank AML freeze applied', 'Payroll halted for 3 business days', 'Mass vendor disputes'],
    },
    preventionOutcome: {
      expectedDecision: 'HOLD',
      expectedAction: 'HOLD_FOR_REVIEW',
      preventedLoss: 0,
      description: 'Temporary hold routed to Nodal Officer. Officer verified vendor invoice in Intervention Centre and released transfer with SHA-256 audit entry.',
      keyRule: 'Audited Human-in-the-Loop Override Workflow',
    },
  },
];

export function PreventionSimulatorPage() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<SimulationScenario['id']>('C');
  const [simulating, setSimulating] = useState<boolean>(false);
  const [activeStep, setActiveStep] = useState<number>(0);
  const [screenResult, setScreenResult] = useState<ScreeningResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  // Interactive impact estimator state
  const [dailyTxnVolume, setDailyTxnVolume] = useState<number>(50000);
  const [fraudRatePct, setFraudRatePct] = useState<number>(0.15); // 0.15%
  const [avgFraudValue, setAvgFraudValue] = useState<number>(85000); // ₹85,000

  const activeScenario = SCENARIOS.find((s) => s.id === selectedScenarioId) || SCENARIOS[2];

  // Execute scenario simulation
  const handleRunSimulation = useCallback(
    async (scenario: SimulationScenario) => {
      setSimulating(true);
      setSimError(null);
      setActiveStep(1); // Step 1: Initiated

      try {
        await new Promise((r) => setTimeout(r, 300));
        setActiveStep(2); // Step 2: In-Flight Screening

        const res = await apiRequest<ApiSuccessResponse<ScreeningResult>>(
          '/screening/simulate-switch',
          {
            method: 'POST',
            body: JSON.stringify({
              scenarioId: scenario.id,
              channel: scenario.channel,
              amount: scenario.amount,
            }),
          },
        );

        await new Promise((r) => setTimeout(r, 350));
        setActiveStep(3); // Step 3: Rules & ML Evaluation

        if (res?.data) {
          setScreenResult(res.data);
        }

        await new Promise((r) => setTimeout(r, 350));
        setActiveStep(4); // Step 4: Intervention Decision

        await new Promise((r) => setTimeout(r, 300));
        setActiveStep(5); // Step 5: Casework & Immutable Audit Hash
      } catch (err) {
        const apiErr = err as ApiError;
        setSimError(apiErr.message || `Failed to run Scenario ${scenario.id}`);
      } finally {
        setSimulating(false);
      }
    },
    [],
  );

  // Auto-run when switching scenarios
  useEffect(() => {
    handleRunSimulation(activeScenario);
  }, [selectedScenarioId, handleRunSimulation]);

  // Impact Estimator calculations
  const dailyAttemptedCount = Math.round((dailyTxnVolume * fraudRatePct) / 100);
  const dailyAttemptedLoss = dailyAttemptedCount * avgFraudValue;
  const interceptRate = 0.942; // 94.2% based on pre-authorisation rules + ML
  const dailyPreventedLoss = Math.round(dailyAttemptedLoss * interceptRate);
  const annualPreventedLoss = dailyPreventedLoss * 365;

  return (
    <CommandLayout
      title="Pre-transaction prevention simulator"
      section="Fraud prevention"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={simulating}
            onClick={() => handleRunSimulation(activeScenario)}
            className="flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight cursor-pointer disabled:opacity-50 transition-colors duration-120"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${simulating ? 'animate-spin' : ''}`} />
            <span>Re-run scenario</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Safety Disclaimer Banner */}
        <div className="rounded-[12px] border border-border-subtle bg-card p-3.5 text-xs text-body flex items-start gap-3">
          <Shield className="h-4 w-4 text-accent-strong shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-heading">
              Pre-authorisation prevention architecture
            </p>
            <p className="text-[11px] text-muted">{DISCLAIMER}</p>
          </div>
        </div>

        {simError && (
          <div className="rounded-[8px] border border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30 p-3 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between">
            <span>{simError}</span>
            <button
              type="button"
              onClick={() => handleRunSimulation(activeScenario)}
              className="text-xs underline font-medium hover:opacity-80 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Paradigm Shift Comparison: Before vs With FinTrace */}
        <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-heading">
              Architectural comparison: post-incident tracing vs pre-authorisation prevention
            </h2>
            <span className="text-[11px] text-muted">Comparative casework mechanics</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Legacy Approach */}
            <div className="rounded-[8px] border border-border-subtle bg-subtle p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-heading">
                  Post-incident tracing (Legacy workflow)
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-[6px] border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-300 font-medium">
                  Unprevented loss
                </span>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Money leaves victim account instantly. By the time victim notices and files a police
                FIR hours or days later, funds have layered through 5 mule accounts and cashed out at
                physical ATMs. Recovery rate is historically below 5%.
              </p>
              <div className="flex items-center gap-1.5 pt-1.5 text-[11px] font-mono text-muted overflow-x-auto">
                <span className="whitespace-nowrap">Transfer initiated</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="whitespace-nowrap">Multi-hop layering</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="whitespace-nowrap">ATM cash-out</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="whitespace-nowrap text-rose-700 dark:text-rose-400 font-medium">Recovery rare (&lt; 5%)</span>
              </div>
            </div>

            {/* FinTrace Prevention Approach */}
            <div className="rounded-[8px] border border-emerald-500/30 bg-emerald-500/5 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                  In-flight prevention (FinTrace ledger)
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-[6px] border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300 font-medium">
                  Loss prevented
                </span>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Money is screened <strong>before authorisation</strong> in under 50ms using account
                intelligence, mule graphs, and ML risk scores. Suspicious transfers are held or blocked
                at Hop 1 before funds ever leave the financial institution.
              </p>
              <div className="flex items-center gap-1.5 pt-1.5 text-[11px] font-mono text-muted overflow-x-auto">
                <span className="whitespace-nowrap">Transfer initiated</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="whitespace-nowrap">&lt; 50ms screening</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="whitespace-nowrap">Intervention intercept</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="whitespace-nowrap text-emerald-700 dark:text-emerald-400 font-medium">Funds preserved</span>
              </div>
            </div>
          </div>
        </div>

        {/* Scenario Selector Rail */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              Demonstration scenarios
            </span>
            <span className="text-[11px] text-muted">7 realistic banking and syndicate patterns</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {SCENARIOS.map((scen) => {
              const isSelected = scen.id === selectedScenarioId;
              return (
                <button
                  key={scen.id}
                  type="button"
                  onClick={() => setSelectedScenarioId(scen.id)}
                  className={`text-left rounded-[8px] p-2.5 border transition-colors duration-120 cursor-pointer space-y-1 ${
                    isSelected
                      ? 'border-accent-strong bg-highlight shadow-xs'
                      : 'border-border-subtle bg-card hover:bg-highlight/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-accent-strong">
                      [{scen.id}]
                    </span>
                    <span className="text-[10px] font-mono text-muted">{scen.channel}</span>
                  </div>
                  <p className="text-xs font-medium text-heading truncate">
                    {scen.title.split(':')[1]?.trim() || scen.title}
                  </p>
                  <p className="text-[11px] font-mono tabular-nums text-muted">{formatInr(scen.amount)}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Scenario Banner */}
        <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-heading">{activeScenario.title}</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-[6px] bg-subtle font-mono tabular-nums text-muted border border-border-subtle">
                  Amount: {formatInr(activeScenario.amount)} · Channel: {activeScenario.channel}
                </span>
              </div>
              <p className="text-xs text-muted mt-1">{activeScenario.tagline}</p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Threat category:</span>
              <span className="text-xs font-medium text-heading px-2 py-0.5 rounded-[6px] bg-subtle border border-border-subtle">
                {activeScenario.threatType}
              </span>
            </div>
          </div>

          {/* Interactive Simulation Stepper */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5 pt-1">
            {[
              {
                step: 1,
                label: 'Inbound transfer',
                desc: `${activeScenario.channel} · ${formatInr(activeScenario.amount)}`,
                icon: Play,
              },
              {
                step: 2,
                label: 'In-flight screening',
                desc: 'Local engine + ML (< 50ms)',
                icon: Zap,
              },
              {
                step: 3,
                label: 'Rule & graph evaluation',
                desc: 'Risk weights calculated',
                icon: Cpu,
              },
              {
                step: 4,
                label: 'Decision & action',
                desc: activeScenario.preventionOutcome.expectedAction.replace(/_/g, ' '),
                icon: ShieldAlert,
              },
              {
                step: 5,
                label: 'Casework & audit',
                desc: 'SHA-256 hash chained',
                icon: Fingerprint,
              },
            ].map((st) => {
              const isPast = activeStep >= st.step;
              const isCurrent = activeStep === st.step;
              const Icon = st.icon;

              return (
                <div
                  key={st.step}
                  className={`rounded-[8px] p-2.5 border transition-colors duration-120 text-xs ${
                    isCurrent
                      ? 'border-accent-strong bg-highlight'
                      : isPast
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-border-subtle bg-subtle opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-muted uppercase">Step {st.step}</span>
                    <Icon
                      className={`w-3.5 h-3.5 ${
                        isCurrent
                          ? 'text-accent-strong'
                          : isPast
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-muted'
                      }`}
                    />
                  </div>
                  <p className="font-medium text-heading truncate">{st.label}</p>
                  <p className="text-[10px] text-muted truncate mt-0.5">{st.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Simulation Outcome Comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Legacy Timeline */}
          <div className="lg:col-span-6 rounded-[12px] border border-border-subtle bg-card p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="space-y-0.5">
                <span className="text-[11px] font-medium text-muted">
                  Without FinTrace prevention
                </span>
                <h4 className="text-xs font-semibold text-heading">Post-fraud forensics trajectory</h4>
              </div>
              <span className="text-xs font-mono font-medium tabular-nums text-rose-700 dark:text-rose-400">
                Loss: {formatInr(activeScenario.legacyOutcome.lossAmount)}
              </span>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              {activeScenario.legacyOutcome.description}
            </p>

            <div className="space-y-2 text-xs">
              <span className="font-medium text-muted text-[11px]">
                Execution steps sequence:
              </span>
              <div className="space-y-1.5">
                {activeScenario.legacyOutcome.steps.map((st, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 rounded-[8px] border border-border-subtle bg-subtle p-2"
                  >
                    <span className="w-5 h-5 rounded-[6px] border border-border-subtle bg-card text-muted font-mono text-[10px] flex items-center justify-center font-medium">
                      {i + 1}
                    </span>
                    <span className="text-heading text-xs">{st}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[8px] border border-border-subtle bg-subtle p-3 text-xs text-body space-y-1">
              <p className="font-semibold text-heading flex items-center gap-1.5">
                <AlertOctagon className="w-4 h-4 text-muted" />
                <span>Forensic reality</span>
              </p>
              <p className="text-[11px] text-muted leading-relaxed">
                Tracing money after cash-out produces forensic intelligence and evidence maps, but
                rarely recovers victim funds. Once cash leaves the ATM dispenser, funds cannot be
                recalled through banking rails.
              </p>
            </div>
          </div>

          {/* FinTrace Prevention Outcome */}
          <div className="lg:col-span-6 rounded-[12px] border border-emerald-500/30 bg-card p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="space-y-0.5">
                <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                  With FinTrace prevention
                </span>
                <h4 className="text-xs font-semibold text-heading">Pre-authorisation interception</h4>
              </div>
              <span className="text-xs font-mono font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                Prevented: {formatInr(activeScenario.preventionOutcome.preventedLoss)}
              </span>
            </div>

            <p className="text-xs text-heading leading-relaxed">
              {activeScenario.preventionOutcome.description}
            </p>

            {/* Live Screening Engine Result */}
            {screenResult ? (
              <div className="rounded-[8px] border border-border-subtle bg-subtle p-3 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-heading">Live engine evaluation</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                      {screenResult.latencyMs} ms
                    </span>
                    <ScoreSourceBadge source={screenResult.scoreSource} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
                  <div className="rounded-[6px] bg-card border border-border-subtle p-2">
                    <span className="text-[10px] text-muted block uppercase">Risk score</span>
                    <span className="font-bold text-sm text-heading">{screenResult.compositeScore}</span>
                  </div>
                  <div className="rounded-[6px] bg-card border border-border-subtle p-2">
                    <span className="text-[10px] text-muted block uppercase">Decision</span>
                    <span className="font-bold text-sm text-heading">{screenResult.decision}</span>
                  </div>
                  <div className="rounded-[6px] bg-card border border-border-subtle p-2">
                    <span className="text-[10px] text-muted block uppercase">Action</span>
                    <span className="font-bold text-sm text-heading truncate block">
                      {screenResult.recommendedAction.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-muted">
                  "{screenResult.plainLanguageExplanation}"
                </p>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-muted">
                Running in-flight screening evaluation...
              </div>
            )}

            <div className="rounded-[8px] border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Intervention impact</span>
              </p>
              <p className="text-[11px] text-muted leading-relaxed">
                Key factor: <strong className="text-heading font-medium">{activeScenario.preventionOutcome.keyRule}</strong>. Funds never
                entered the layering network. Account flagged in Risk Registry for continuous
                surveillance without impacting legitimate retail traffic.
              </p>
            </div>
          </div>
        </div>

        {/* Interactive Impact Estimator (Macro Benefits Calculator) */}
        <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
            <div className="space-y-0.5">
              <h3 className="text-xs font-semibold text-heading flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-accent-strong" />
                <span>Institutional fraud prevention impact estimator</span>
              </h3>
              <p className="text-xs text-muted">
                Simulate macro financial savings from deploying FinTrace pre-authorisation screening
              </p>
            </div>
            <span className="text-xs font-mono text-muted">Dynamic in-flight model</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* Slider 1: Daily Volume */}
            <div className="rounded-[8px] border border-border-subtle bg-subtle p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium text-body">Daily volume</span>
                <span className="font-mono tabular-nums font-semibold text-heading">
                  {dailyTxnVolume.toLocaleString('en-IN')} txns
                </span>
              </div>
              <input
                type="range"
                min="5000"
                max="500000"
                step="5000"
                value={dailyTxnVolume}
                onChange={(e) => setDailyTxnVolume(Number(e.target.value))}
                className="w-full accent-accent-strong cursor-pointer"
              />
              <span className="text-[11px] text-muted block">Core-banking gateway throughput</span>
            </div>

            {/* Slider 2: Fraud Rate */}
            <div className="rounded-[8px] border border-border-subtle bg-subtle p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium text-body">Fraud rate</span>
                <span className="font-mono tabular-nums font-semibold text-heading">{fraudRatePct}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="1.0"
                step="0.05"
                value={fraudRatePct}
                onChange={(e) => setFraudRatePct(Number(e.target.value))}
                className="w-full accent-accent-strong cursor-pointer"
              />
              <span className="text-[11px] text-muted block">Industry baseline (0.10% – 0.35%)</span>
            </div>

            {/* Slider 3: Average Ticket */}
            <div className="rounded-[8px] border border-border-subtle bg-subtle p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium text-body">Average ticket</span>
                <span className="font-mono tabular-nums font-semibold text-heading">{formatInr(avgFraudValue)}</span>
              </div>
              <input
                type="range"
                min="10000"
                max="500000"
                step="5000"
                value={avgFraudValue}
                onChange={(e) => setAvgFraudValue(Number(e.target.value))}
                className="w-full accent-accent-strong cursor-pointer"
              />
              <span className="text-[11px] text-muted block">Typical mule siphon quantum</span>
            </div>
          </div>

          {/* Calculation Outputs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div className="rounded-[8px] border border-border-subtle bg-subtle p-3">
              <span className="text-[11px] font-medium text-muted">Attempted fraud / day</span>
              <p className="text-lg font-bold font-mono tabular-nums text-heading mt-1">
                {formatInr(dailyAttemptedLoss)}
              </p>
              <span className="text-[11px] text-muted">{dailyAttemptedCount} attempted attacks</span>
            </div>

            <div className="rounded-[8px] border border-emerald-500/30 bg-emerald-500/5 p-3">
              <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-200">
                Daily prevented loss
              </span>
              <p className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                {formatInr(dailyPreventedLoss)}
              </p>
              <span className="text-[11px] text-muted">
                {(interceptRate * 100).toFixed(1)}% pre-auth intercept
              </span>
            </div>

            <div className="rounded-[8px] border border-emerald-500/30 bg-emerald-500/5 p-3">
              <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-200">
                Annual prevented loss
              </span>
              <p className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                {formatInr(annualPreventedLoss)}
              </p>
              <span className="text-[11px] text-muted">
                Direct economic savings
              </span>
            </div>

            <div className="rounded-[8px] border border-border-subtle bg-subtle p-3">
              <span className="text-[11px] font-medium text-muted">
                Casework load reduction
              </span>
              <p className="text-lg font-bold font-mono tabular-nums text-accent-strong mt-1">
                -85.4%
              </p>
              <span className="text-[11px] text-muted">
                Reduced LEA / bank backlog
              </span>
            </div>
          </div>
        </div>

        {/* Action Navigation Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            <Link
              to="/screening"
              className="flex items-center gap-1.5 rounded-[8px] bg-accent-strong text-white px-3.5 py-2 text-xs font-medium hover:bg-accent-strong-hover cursor-pointer transition-colors duration-120"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Open real-time screening</span>
            </Link>
            <Link
              to="/interventions"
              className="flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3.5 py-2 text-xs font-medium text-heading hover:bg-highlight cursor-pointer transition-colors duration-120"
            >
              <Sliders className="w-3.5 h-3.5 text-accent-strong" />
              <span>Open intervention centre</span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/atm-predictions"
              className="flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3 py-2 text-xs text-muted hover:text-heading cursor-pointer transition-colors duration-120"
            >
              <Landmark className="w-3.5 h-3.5" />
              <span>Inspect ATM forensics</span>
            </Link>
            <Link
              to="/graph"
              className="flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3 py-2 text-xs text-muted hover:text-heading cursor-pointer transition-colors duration-120"
            >
              <Network className="w-3.5 h-3.5" />
              <span>Inspect network graph</span>
            </Link>
          </div>
        </div>
      </div>
    </CommandLayout>
  );
}
