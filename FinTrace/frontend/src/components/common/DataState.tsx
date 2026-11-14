import { AlertCircle, ChevronDown, ChevronUp, FolderOpen, RefreshCw } from 'lucide-react';
import { ReactNode, useState } from 'react';

/* =============================================================================
   TABLE SKELETON
   Ledger-style placeholder with realistic column ratios & hairline dividers
   ============================================================================= */

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  // Proportional ledger widths: first column (ID) 20%, main column 30%, metrics 15% each
  const columnWidths = ['w-24', 'w-48', 'w-32', 'w-20', 'w-28', 'w-16'];

  return (
    <div className="divide-y divide-border-subtle" role="status" aria-label="Loading ledger data">
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div key={rIdx} className="flex items-center gap-4 px-4 py-3 sm:px-5">
          {Array.from({ length: cols }).map((__, cIdx) => (
            <div
              key={cIdx}
              className={`h-3.5 rounded-[4px] bg-subtle/80 dark:bg-white/5 animate-pulse ${
                columnWidths[cIdx % columnWidths.length]
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* =============================================================================
   EMPTY DATA STATE
   Calm, explanatory empty state with clear next-step guidance
   ============================================================================= */

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
      <div className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-border-subtle bg-subtle text-muted mb-3">
        <FolderOpen className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold tracking-tight text-heading">{title}</p>
      <p className="mt-1 max-w-md text-xs text-muted leading-relaxed">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* =============================================================================
   ERROR DATA STATE
   Redline error container with collapsible technical details & retry action
   ============================================================================= */

export interface TechnicalErrorDetails {
  path?: string;
  status?: number;
  code?: string;
}

export function ErrorDataState({
  message,
  onRetry,
  technicalDetails,
}: {
  message: string;
  onRetry?: () => void;
  technicalDetails?: TechnicalErrorDetails;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      role="alert"
      className="rounded-[10px] border border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/25 p-3.5 sm:p-4 space-y-2.5 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-red-900 dark:text-red-200">Unable to load data</p>
            <p className="mt-0.5 text-xs text-red-800/90 dark:text-red-300/90 leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {technicalDetails?.path ? (
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium text-red-800 dark:text-red-300 hover:bg-red-100/60 dark:hover:bg-red-900/40 cursor-pointer transition-colors"
            >
              <span>Details</span>
              {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          ) : null}

          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-[6px] border border-red-300 bg-card px-2.5 py-1 text-xs font-medium text-red-900 hover:bg-red-50 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-900/50 cursor-pointer transition-colors"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              <span>Retry</span>
            </button>
          ) : null}
        </div>
      </div>

      {showDetails && technicalDetails ? (
        <div className="mt-2 rounded-[6px] border border-red-200/80 bg-card/80 p-2.5 font-mono text-[11px] text-red-900 dark:border-red-900/40 dark:bg-black/30 dark:text-red-300 space-y-0.5">
          {technicalDetails.path ? (
            <div>
              <span className="opacity-65">Endpoint: </span>
              <span className="font-semibold">{technicalDetails.path}</span>
            </div>
          ) : null}
          {technicalDetails.status !== undefined ? (
            <div>
              <span className="opacity-65">HTTP Status: </span>
              <span>{technicalDetails.status}</span>
            </div>
          ) : null}
          {technicalDetails.code ? (
            <div>
              <span className="opacity-65">Error Code: </span>
              <span>{technicalDetails.code}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
