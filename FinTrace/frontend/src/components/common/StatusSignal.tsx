import { AlertOctagon, AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';

interface StatusSignalProps {
  level: string;
  label?: string;
}

export function StatusSignal({ level, label }: StatusSignalProps) {
  const normalized = level.toUpperCase();
  const display = label ?? level.replaceAll('_', ' ');

  if (normalized === 'CRITICAL' || normalized === 'OPEN' || normalized === 'FROZEN') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-red-300 bg-[#FEE2E2] px-2 py-0.5 text-xs font-semibold text-[#991B1B] dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-300 whitespace-nowrap">
        <AlertOctagon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  if (
    normalized === 'HIGH' ||
    normalized === 'ATM_ALERTED' ||
    normalized === 'MULE_IDENTIFIED' ||
    normalized === 'DISPATCHED' ||
    normalized === 'FREEZE_REQUESTED' ||
    normalized === 'ATM_SURVEILLANCE'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-amber-300 bg-[#FEF3C7] px-2 py-0.5 text-xs font-semibold text-[#92400E] dark:border-amber-500/40 dark:bg-amber-950/45 dark:text-amber-300 whitespace-nowrap">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  if (normalized === 'CONTAINED' || normalized === 'RESOLVED' || normalized === 'CLOSED' || normalized === 'CLEARED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-emerald-300 bg-[#D8F8EC] px-2 py-0.5 text-xs font-semibold text-[#065F46] dark:border-emerald-500/40 dark:bg-emerald-950/45 dark:text-emerald-300 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  if (
    normalized === 'TRACING' ||
    normalized === 'ACKNOWLEDGED' ||
    normalized === 'MEDIUM' ||
    normalized === 'ACTIVE_TRACE'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-blue-300 bg-[#DCEEFF] px-2 py-0.5 text-xs font-semibold text-[#1E40AF] dark:border-sky-500/40 dark:bg-sky-950/50 dark:text-sky-300 whitespace-nowrap">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-border-subtle bg-subtle px-2 py-0.5 text-xs font-medium text-heading whitespace-nowrap">
      <Info className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
      <span>{display}</span>
    </span>
  );
}
