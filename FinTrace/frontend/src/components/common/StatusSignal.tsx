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
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 whitespace-nowrap">
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
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  if (normalized === 'CONTAINED' || normalized === 'RESOLVED' || normalized === 'CLOSED' || normalized === 'CLEARED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
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
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 whitespace-nowrap">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 whitespace-nowrap">
      <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      <span>{display}</span>
    </span>
  );
}
