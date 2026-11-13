import { ArrowRight, Bell, CheckCircle2, Clock, FilePlus2, FileText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../../components/common/DataState';
import { CitizenLayout } from '../../components/layout/CitizenLayout';
import { useAuth } from '../../context/AuthContext';
import { ApiSuccessResponse, CitizenComplaintSummary, CitizenNotificationItem, CitizenStatus } from '../../types';
import { formatFraudType, formatInr, formatTimestamp } from '../../utils/formatters';

const STATUS_BADGE_CLASS: Record<CitizenStatus, string> = {
  Submitted: 'border-blue-300 bg-[#DCEEFF] text-[#1E40AF] dark:border-sky-500/40 dark:bg-sky-950/50 dark:text-sky-200',
  'Under Review': 'border-amber-300 bg-[#FEF3C7] text-[#92400E] dark:border-amber-500/40 dark:bg-amber-950/45 dark:text-amber-200',
  'Assigned to Investigator': 'border-violet-300 bg-[#E8E5FF] text-[#4C1D95] dark:border-violet-500/40 dark:bg-violet-950/45 dark:text-violet-200',
  'Investigation in Progress': 'border-amber-300 bg-[#FEF3C7] text-[#92400E] dark:border-amber-500/40 dark:bg-amber-950/45 dark:text-amber-200',
  'Action Taken / Closed': 'border-emerald-300 bg-[#D8F8EC] text-[#065F46] dark:border-emerald-500/40 dark:bg-emerald-950/45 dark:text-emerald-200',
};

export function CitizenDashboardPage() {
  const { user } = useAuth();
  const [complaints, setComplaints] = useState<CitizenComplaintSummary[]>([]);
  const [notifications, setNotifications] = useState<CitizenNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cmpRes, notifRes] = await Promise.all([
        apiRequest<ApiSuccessResponse<CitizenComplaintSummary[]>>('/citizen/complaints'),
        apiRequest<ApiSuccessResponse<{ unreadCount: number; notifications: CitizenNotificationItem[] }>>(
          '/citizen/notifications'
        ),
      ]);
      setComplaints(cmpRes.data);
      setNotifications(notifRes.data.notifications);
      setUnreadCount(notifRes.data.unreadCount);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load your dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const counts = {
    total: complaints.length,
    submittedOrReview: complaints.filter(
      (c) => c.citizen_status === 'Submitted' || c.citizen_status === 'Under Review'
    ).length,
    inProgress: complaints.filter(
      (c) =>
        c.citizen_status === 'Assigned to Investigator' ||
        c.citizen_status === 'Investigation in Progress'
    ).length,
    closed: complaints.filter((c) => c.citizen_status === 'Action Taken / Closed').length,
  };

  const latestUpdate = notifications[0] ?? null;

  return (
    <CitizenLayout
      title="My Dashboard"
      subtitle={`Welcome back, ${user?.fullName ?? 'Citizen'}`}
      actions={
        <Link
          to="/citizen/file"
          className="inline-flex items-center gap-1.5 rounded-[6px] bg-accent-strong px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover transition-colors whitespace-nowrap"
        >
          <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
          File a new complaint
        </Link>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadData()} /> : null}

      {/* Hero Welcome Banner */}
      <section className="rounded-[10px] border border-border-subtle bg-grad-sky p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-strong dark:text-sky-300">
            Citizen Cyber Fraud Support
          </p>
          <h2 className="text-lg font-bold text-heading">
            Report financial cyber fraud quickly and track official progress
          </h2>
          <p className="text-xs text-body max-w-2xl">
            Every complaint receives a unique reference number and enters our cybercrime response workflow. Your personal account numbers remain masked for your safety.
          </p>
        </div>
        <Link
          to="/citizen/file"
          className="inline-flex items-center justify-center gap-2 rounded-[6px] bg-accent-strong px-4 py-2.5 text-xs font-semibold text-white hover:bg-accent-strong-hover shadow-sm transition-colors shrink-0"
        >
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          File a New Complaint
        </Link>
      </section>

      {/* Status Counts */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-[8px] border border-border-subtle bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Total Complaints</span>
            <FileText className="h-4 w-4 text-accent-strong" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-heading tabular-nums">{counts.total}</p>
        </div>

        <div className="rounded-[8px] border border-border-subtle bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Submitted / Under Review</span>
            <Clock className="h-4 w-4 text-[#D97706] dark:text-amber-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-heading tabular-nums">
            {counts.submittedOrReview}
          </p>
        </div>

        <div className="rounded-[8px] border border-border-subtle bg-card p-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Investigation Active</span>
            <Bell className="h-4 w-4 text-accent-strong" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-heading tabular-nums">{counts.inProgress}</p>
        </div>

        <div className="rounded-[8px] border border-emerald-300/70 bg-grad-mint p-4 dark:border-emerald-700/50">
          <div className="flex items-center justify-between text-xs text-[#065F46] dark:text-emerald-200">
            <span>Action Taken / Closed</span>
            <CheckCircle2 className="h-4 w-4 text-[#10B981]" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-[#065F46] dark:text-emerald-100 tabular-nums">
            {counts.closed}
          </p>
        </div>
      </section>

      {/* Latest Update */}
      {latestUpdate ? (
        <section className="rounded-[8px] border border-border-subtle bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-[4px] bg-highlight px-2 py-0.5 text-[11px] font-semibold text-heading">
                Latest Update {unreadCount > 0 ? `(${unreadCount} unread)` : ''}
              </span>
              <span className="font-mono text-xs font-semibold text-accent-strong">
                {latestUpdate.reference_no}
              </span>
              <span className="text-[11px] text-muted">{formatTimestamp(latestUpdate.created_at)}</span>
            </div>
            <p className="text-sm font-semibold text-heading">{latestUpdate.title}</p>
            <p className="text-xs text-body">{latestUpdate.message}</p>
          </div>
          <Link
            to={`/citizen/complaints/${latestUpdate.complaint_id}`}
            className="inline-flex items-center gap-1.5 rounded-[6px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs font-semibold text-heading hover:bg-highlight shrink-0"
          >
            View Status
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </section>
      ) : null}

      {/* Recent Complaints */}
      <section className="rounded-[8px] border border-border-subtle bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-subtle bg-highlight/50 px-4 py-3">
          <h2 className="text-sm font-semibold text-heading">Recent Complaints</h2>
          <Link to="/citizen/complaints" className="text-xs font-semibold text-accent-strong hover:underline">
            View all complaints
          </Link>
        </div>

        {loading ? (
          <TableSkeleton rows={3} cols={5} />
        ) : complaints.length === 0 ? (
          <EmptyDataState
            title="You have not filed any complaints yet"
            description="If you experienced unauthorized UPI, bank, card, or investment transfers, file a complaint now."
            action={
              <Link
                to="/citizen/file"
                className="inline-flex items-center gap-1.5 rounded-[6px] bg-accent-strong px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-strong-hover"
              >
                <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                File a new complaint
              </Link>
            }
          />
        ) : (
          <div className="divide-y divide-border-subtle">
            {complaints.slice(0, 5).map((cmp) => (
              <div
                key={cmp.id}
                className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-subtle/60 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-accent-strong">
                      {cmp.reference_no}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-[4px] border px-2 py-0.5 text-[11px] font-semibold ${
                        STATUS_BADGE_CLASS[cmp.citizen_status]
                      }`}
                    >
                      {cmp.citizen_status}
                    </span>
                    <span className="text-xs text-muted">{formatFraudType(cmp.fraud_type)}</span>
                  </div>
                  <p className="text-xs text-body line-clamp-1">{cmp.summary}</p>
                  <p className="text-[11px] text-muted">
                    Filed {formatTimestamp(cmp.reported_at)} · {cmp.assignment_label}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold text-heading tabular-nums">
                      {formatInr(cmp.reported_amount)}
                    </p>
                    <p className="text-[11px] text-muted">
                      {cmp.transaction_count} txn · {cmp.document_count} file(s)
                    </p>
                  </div>
                  <Link
                    to={`/citizen/complaints/${cmp.id}`}
                    className="inline-flex items-center gap-1 rounded-[5px] border border-border-subtle bg-subtle px-2.5 py-1.5 text-xs font-semibold text-heading hover:bg-highlight"
                  >
                    Track
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </CitizenLayout>
  );
}
