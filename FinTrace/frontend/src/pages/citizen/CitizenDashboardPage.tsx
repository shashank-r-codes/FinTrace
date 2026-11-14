import { ArrowRight, Bell, CheckCircle2, Clock, FilePlus2, FileText, PhoneCall, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../../components/common/DataState';
import { CitizenLayout } from '../../components/layout/CitizenLayout';
import { useAuth } from '../../context/AuthContext';
import { ApiSuccessResponse, CitizenComplaintSummary, CitizenNotificationItem, CitizenStatus } from '../../types';
import { formatFraudType, formatInr, formatTimestamp } from '../../utils/formatters';

const STATUS_BADGE_CLASS: Record<CitizenStatus, string> = {
  Submitted: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-200',
  'Under Review': 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200',
  'Assigned to Investigator': 'border-blue-200 bg-blue-50 text-accent-strong dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-200',
  'Investigation in Progress': 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200',
  'Action Taken / Closed': 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-200',
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
      title="My dashboard"
      subtitle={`Welcome back, ${user?.fullName ?? 'Citizen'}`}
      actions={
        <Link
          to="/citizen/file"
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover transition-colors whitespace-nowrap cursor-pointer"
        >
          <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>File a complaint</span>
        </Link>
      }
    >
      <div className="space-y-6">
        {error ? <ErrorDataState message={error} onRetry={() => void loadData()} /> : null}

        {/* Reassuring Guidance Banner */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-accent-strong shrink-0" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-heading">
                  Report unauthorized transactions and track recovery progress
                </h2>
              </div>
              <p className="text-xs text-body leading-relaxed max-w-2xl">
                Every complaint is registered with an official FinTrace reference number and reviewed by cybercrime investigators. Bank nodal desks are alerted to trace and hold fraudulent fund transfers.
              </p>
            </div>
            <Link
              to="/citizen/file"
              className="inline-flex items-center justify-center gap-2 rounded-[8px] bg-accent-strong px-4 py-2 text-xs font-semibold text-white hover:bg-accent-strong-hover transition-colors shrink-0 cursor-pointer"
            >
              <FilePlus2 className="h-4 w-4" aria-hidden="true" />
              <span>File a complaint</span>
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border-subtle text-[11px] text-muted">
            <span className="inline-flex items-center gap-1 font-medium text-heading">
              <PhoneCall className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
              <span>National Cybercrime Helpline:</span>
              <strong className="font-mono text-accent-strong">1930</strong> (Toll-free)
            </span>
            <span>·</span>
            <span>Official portal: <strong className="font-sans font-medium text-heading">cybercrime.gov.in</strong></span>
            <span>·</span>
            <span>Your bank account details remain encrypted and masked for your safety.</span>
          </div>
        </section>

        {/* Status Count Tiles */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-[12px] border border-border-subtle bg-card p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Total complaints</span>
              <FileText className="h-4 w-4 text-accent-strong" aria-hidden="true" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-heading tabular-nums">{counts.total}</p>
          </div>

          <div className="rounded-[12px] border border-border-subtle bg-card p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Under review</span>
              <Clock className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-heading tabular-nums">
              {counts.submittedOrReview}
            </p>
          </div>

          <div className="rounded-[12px] border border-border-subtle bg-card p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Investigation active</span>
              <Bell className="h-4 w-4 text-accent-strong" aria-hidden="true" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-heading tabular-nums">{counts.inProgress}</p>
          </div>

          <div className="rounded-[12px] border border-border-subtle bg-card p-4">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Action taken / Closed</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {counts.closed}
            </p>
          </div>
        </section>

        {/* Latest Update */}
        {latestUpdate ? (
          <section className="rounded-[12px] border border-border-subtle bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-[6px] border border-border-subtle bg-highlight px-2 py-0.5 text-[11px] font-semibold text-heading">
                  Latest status update {unreadCount > 0 ? `(${unreadCount} unread)` : ''}
                </span>
                <span className="font-mono text-xs font-semibold text-accent-strong">
                  {latestUpdate.reference_no}
                </span>
                <span className="text-[11px] text-muted">{formatTimestamp(latestUpdate.created_at)}</span>
              </div>
              <p className="text-xs font-semibold text-heading">{latestUpdate.title}</p>
              <p className="text-xs text-body leading-relaxed">{latestUpdate.message}</p>
            </div>
            <Link
              to={`/citizen/complaints/${latestUpdate.complaint_id}`}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs font-semibold text-heading hover:bg-highlight shrink-0 cursor-pointer transition-colors duration-120"
            >
              <span>View status</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </section>
        ) : null}

        {/* Recent Complaints */}
        <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle px-4 py-3">
            <h2 className="text-xs font-semibold text-heading">Recent complaints</h2>
            <Link to="/citizen/complaints" className="text-xs font-semibold text-accent-strong hover:underline">
              View all complaints
            </Link>
          </div>

          {loading ? (
            <TableSkeleton rows={3} cols={5} />
          ) : complaints.length === 0 ? (
            <EmptyDataState
              title="You have not filed any complaints yet"
              description="If you experienced unauthorized UPI, bank transfer, card debit, or investment fraud, report it here."
              action={
                <Link
                  to="/citizen/file"
                  className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-strong-hover cursor-pointer transition-colors duration-120"
                >
                  <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>File a complaint</span>
                </Link>
              }
            />
          ) : (
            <div className="divide-y border-border-subtle">
              {complaints.slice(0, 5).map((cmp) => (
                <div
                  key={cmp.id}
                  className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-subtle transition-colors duration-120"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-accent-strong">
                        {cmp.reference_no}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[11px] font-semibold ${
                          STATUS_BADGE_CLASS[cmp.citizen_status]
                        }`}
                      >
                        {cmp.citizen_status}
                      </span>
                      <span className="text-xs text-muted">{formatFraudType(cmp.fraud_type)}</span>
                    </div>
                    <p className="text-xs text-body line-clamp-1">{cmp.summary}</p>
                    <p className="text-[11px] text-muted">
                      Filed on {formatTimestamp(cmp.reported_at)} · {cmp.assignment_label}
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                    <div className="text-right">
                      <p className="font-mono text-sm font-bold text-heading tabular-nums">
                        {formatInr(cmp.reported_amount)}
                      </p>
                      <p className="text-[11px] text-muted">
                        {cmp.transaction_count} transaction(s) · {cmp.document_count} file(s)
                      </p>
                    </div>
                    <Link
                      to={`/citizen/complaints/${cmp.id}`}
                      className="inline-flex items-center gap-1 rounded-[8px] border border-border-subtle bg-subtle px-2.5 py-1.5 text-xs font-semibold text-heading hover:bg-highlight cursor-pointer transition-colors duration-120"
                    >
                      <span>Track status</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </CitizenLayout>
  );
}
