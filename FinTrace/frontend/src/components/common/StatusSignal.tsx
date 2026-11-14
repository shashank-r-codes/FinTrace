import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
} from 'lucide-react';

interface StatusSignalProps {
  level: string;
  label?: string;
  className?: string;
}

// Plain human-readable labels for backend enums
const STATUS_LABEL_MAP: Record<string, string> = {
  // Complaints
  REGISTERED: 'Registered',
  TRACING: 'Tracing funds',
  MULE_IDENTIFIED: 'Mule identified',
  ATM_ALERTED: 'ATM alerted',
  CONTAINED: 'Contained',
  CLOSED: 'Closed',

  // Alerts & Severity
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  DISPATCHED: 'Dispatched',
  RESOLVED: 'Resolved',
  CLEARED: 'Cleared',

  // Interventions
  PENDING: 'Pending review',
  APPROVED: 'Confirmed / Blocked',
  REJECTED: 'Overridden / Released',
  ESCALATED: 'Escalated to LEA',
  FALSE_POSITIVE: 'False positive',
  AUTO_RESOLVED: 'Auto resolved',
  HOLD_FOR_REVIEW: 'Hold for review',
  REJECT_BLOCK: 'Block payment',
  ADDITIONAL_VERIFICATION: 'Additional verification',
  ALLOW: 'Allow payment',

  // Accounts
  NORMAL: 'Normal',
  SUSPICIOUS_ACCOUNT: 'Suspicious',
  SUSPECTED_MULE_ACCOUNT: 'Suspected mule',
  CONFIRMED_FRAUD_LINKED: 'Confirmed fraud link',
  FROZEN: 'Frozen',
  FREEZE_REQUESTED: 'Freeze requested',
};

export function StatusSignal({ level, label, className = '' }: StatusSignalProps) {
  const normalized = level.toUpperCase();
  const display = label ?? STATUS_LABEL_MAP[normalized] ?? level.replaceAll('_', ' ').toLowerCase();

  // Critical / Red
  if (
    normalized === 'CRITICAL' ||
    normalized === 'REJECT_BLOCK' ||
    normalized === 'CONFIRMED_FRAUD_LINKED' ||
    normalized === 'FROZEN'
  ) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-[6px] border border-red-200 bg-red-50/80 px-2 py-0.5 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 whitespace-nowrap ${className}`}
      >
        <AlertOctagon className="h-3 w-3 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  // Escalated / Urgent Red Alert
  if (normalized === 'ESCALATED') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-[6px] border border-red-300 bg-red-100/70 px-2 py-0.5 text-xs font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 whitespace-nowrap ${className}`}
      >
        <ShieldAlert className="h-3 w-3 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  // High / Ochre Amber
  if (
    normalized === 'HIGH' ||
    normalized === 'HOLD_FOR_REVIEW' ||
    normalized === 'ATM_ALERTED' ||
    normalized === 'SUSPECTED_MULE_ACCOUNT' ||
    normalized === 'FREEZE_REQUESTED'
  ) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-[6px] border border-amber-200 bg-amber-50/80 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300 whitespace-nowrap ${className}`}
      >
        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  // Pending / Clock
  if (normalized === 'PENDING' || normalized === 'PENDING_REVIEW' || normalized === 'OPEN') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-[6px] border border-amber-200/70 bg-amber-50/50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300 whitespace-nowrap ${className}`}
      >
        <Clock className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  // Success / Resolved / Pine Green
  if (
    normalized === 'CONTAINED' ||
    normalized === 'RESOLVED' ||
    normalized === 'APPROVED' ||
    normalized === 'ALLOW' ||
    normalized === 'CLEARED'
  ) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-[6px] border border-emerald-200 bg-emerald-50/80 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300 whitespace-nowrap ${className}`}
      >
        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  // Medium / Info Blue-Gray
  if (
    normalized === 'TRACING' ||
    normalized === 'ACKNOWLEDGED' ||
    normalized === 'MEDIUM' ||
    normalized === 'SUSPICIOUS_ACCOUNT' ||
    normalized === 'ADDITIONAL_VERIFICATION'
  ) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-[6px] border border-border-subtle bg-subtle px-2 py-0.5 text-xs font-medium text-heading whitespace-nowrap ${className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent-strong shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  // Neutral / Closed / Overridden
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[6px] border border-border-subtle bg-subtle px-2 py-0.5 text-xs font-medium text-muted whitespace-nowrap ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-muted shrink-0" aria-hidden="true" />
      <span>{display}</span>
    </span>
  );
}
