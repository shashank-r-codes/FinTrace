import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import { ReactNode } from 'react';

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border-subtle">
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div
          key={rIdx}
          className="grid gap-4 px-4 py-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((__, cIdx) => (
            <div key={cIdx} className="h-4 rounded bg-highlight/60 dark:bg-slate-800/70 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyDataState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <Inbox className="h-8 w-8 text-muted mb-3" aria-hidden="true" />
      <p className="text-sm font-semibold text-heading">{title}</p>
      <p className="mt-1 max-w-md text-xs text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorDataState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border border-red-300 bg-[#FEE2E2] text-[#991B1B] dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200 px-4 py-3 rounded-[6px]">
      <div className="flex items-center gap-2.5 text-xs">
        <AlertCircle className="h-4 w-4 text-[#DC2626] dark:text-red-400 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-[4px] border border-red-400 bg-card px-2.5 py-1 text-xs font-medium text-[#991B1B] hover:bg-red-50 dark:border-red-700/60 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-900/60 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      ) : null}
    </div>
  );
}
