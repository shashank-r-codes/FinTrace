import { ArrowRight, FilePlus2, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../../components/common/DataState';
import { CitizenLayout } from '../../components/layout/CitizenLayout';
import { ApiSuccessResponse, CitizenComplaintSummary, CitizenStatus } from '../../types';
import { formatFraudType, formatInr, formatTimestamp } from '../../utils/formatters';

const CITIZEN_STATUSES: CitizenStatus[] = [
  'Submitted',
  'Under Review',
  'Assigned to Investigator',
  'Investigation in Progress',
  'Action Taken / Closed',
];

const STATUS_BADGE_CLASS: Record<CitizenStatus, string> = {
  Submitted: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-200',
  'Under Review': 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200',
  'Assigned to Investigator': 'border-blue-200 bg-blue-50 text-accent-strong dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-200',
  'Investigation in Progress': 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200',
  'Action Taken / Closed': 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-200',
};

export function MyComplaintsPage() {
  const [complaints, setComplaints] = useState<CitizenComplaintSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchComplaints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('citizenStatus', statusFilter);
      const qs = params.toString();
      const res = await apiRequest<ApiSuccessResponse<CitizenComplaintSummary[]>>(
        `/citizen/complaints${qs ? `?${qs}` : ''}`
      );
      setComplaints(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to fetch your complaints.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void fetchComplaints();
  }, [fetchComplaints]);

  return (
    <CitizenLayout
      title="My complaints"
      subtitle="Search and track every complaint you have submitted"
      actions={
        <Link
          to="/citizen/file"
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover cursor-pointer transition-colors duration-120"
        >
          <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>File a complaint</span>
        </Link>
      }
    >
      <div className="space-y-6">
        {error ? <ErrorDataState message={error} onRetry={() => void fetchComplaints()} /> : null}

        {/* Filter Bar */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted"
                aria-hidden="true"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by reference number (FT-...) or description..."
                className="w-full rounded-[8px] border border-border-subtle bg-subtle pl-8 pr-3 py-1.5 text-xs text-heading placeholder:text-muted focus:outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by complaint status"
              className="rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs text-heading focus:outline-none"
            >
              <option value="">All statuses</option>
              {CITIZEN_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Complaints Table */}
        <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border-subtle bg-subtle px-4 py-3">
            <h2 className="text-xs font-semibold text-heading">Submitted complaints register</h2>
            <span className="font-mono text-xs text-muted tabular-nums">{complaints.length} record(s)</span>
          </div>

          {loading ? (
            <TableSkeleton rows={4} cols={5} />
          ) : complaints.length === 0 ? (
            <EmptyDataState
              title="No matching complaints found"
              description="Adjust your search filter or submit a new cybercrime complaint."
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border-subtle bg-subtle/50 text-[11px] font-semibold text-muted">
                    <th className="px-4 py-2.5">Reference number</th>
                    <th className="px-4 py-2.5">Incident type</th>
                    <th className="px-4 py-2.5 text-right">Amount lost</th>
                    <th className="px-4 py-2.5">Current status</th>
                    <th className="px-4 py-2.5">Assigned desk</th>
                    <th className="px-4 py-2.5">Date submitted</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y border-border-subtle font-mono">
                  {complaints.map((cmp) => (
                    <tr key={cmp.id} className="hover:bg-subtle transition-colors duration-120 font-sans">
                      <td className="px-4 py-3 font-mono font-bold text-accent-strong whitespace-nowrap">
                        {cmp.reference_no}
                      </td>
                      <td className="px-4 py-3 text-heading whitespace-nowrap">
                        {formatFraudType(cmp.fraud_type)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-heading tabular-nums whitespace-nowrap">
                        {formatInr(cmp.reported_amount)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[11px] font-semibold ${
                            STATUS_BADGE_CLASS[cmp.citizen_status] ?? 'border-border-subtle bg-subtle text-muted'
                          }`}
                        >
                          {cmp.citizen_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-body whitespace-nowrap">{cmp.assignment_label}</td>
                      <td className="px-4 py-3 font-mono text-muted tabular-nums whitespace-nowrap">
                        {formatTimestamp(cmp.reported_at)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link
                          to={`/citizen/complaints/${cmp.id}`}
                          className="inline-flex items-center gap-1 rounded-[8px] border border-border-subtle bg-subtle px-2.5 py-1 text-[11px] font-semibold text-heading hover:bg-highlight cursor-pointer transition-colors duration-120"
                        >
                          <span>Track status</span>
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </CitizenLayout>
  );
}
