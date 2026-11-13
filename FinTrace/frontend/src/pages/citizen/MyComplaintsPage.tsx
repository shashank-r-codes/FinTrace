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
      title="My Complaints"
      subtitle="Search and track every complaint you have submitted"
      actions={
        <Link
          to="/citizen/file"
          className="inline-flex items-center gap-1.5 rounded-[6px] bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover"
        >
          <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
          File a Complaint
        </Link>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void fetchComplaints()} /> : null}

      <section className="rounded-[8px] border border-border-subtle bg-card p-3.5">
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
              placeholder="Search by reference number (FT-2026-...) or description..."
              className="w-full rounded-[6px] border border-border-subtle bg-app pl-8 pr-3 py-2 text-xs text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by complaint status"
            className="rounded-[6px] border border-border-subtle bg-app px-3 py-2 text-xs text-heading focus:border-accent-strong focus:outline-none"
          >
            <option value="">All Statuses</option>
            {CITIZEN_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="rounded-[8px] border border-border-subtle bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-subtle bg-highlight/60 px-4 py-3">
          <h2 className="text-sm font-semibold text-heading">Submitted Complaints</h2>
          <span className="font-mono text-xs text-muted">{complaints.length} record(s)</span>
        </div>

        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : complaints.length === 0 ? (
          <EmptyDataState
            title="No matching complaints found"
            description="Adjust your search filter or submit a new cyber fraud complaint."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border-subtle bg-highlight/40 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Reference No</th>
                  <th className="px-4 py-2.5">Incident Type</th>
                  <th className="px-4 py-2.5 text-right">Amount Lost</th>
                  <th className="px-4 py-2.5">Current Status</th>
                  <th className="px-4 py-2.5">Assignment</th>
                  <th className="px-4 py-2.5">Submitted</th>
                  <th className="px-4 py-2.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {complaints.map((cmp) => (
                  <tr key={cmp.id} className="hover:bg-subtle/60 transition-colors">
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
                      <span className="inline-flex items-center rounded-[4px] border border-border-subtle bg-highlight/70 px-2 py-0.5 text-[11px] font-semibold text-heading">
                        {cmp.citizen_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-body whitespace-nowrap">{cmp.assignment_label}</td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">
                      {formatTimestamp(cmp.reported_at)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link
                        to={`/citizen/complaints/${cmp.id}`}
                        className="inline-flex items-center gap-1 rounded-[5px] border border-border-subtle bg-subtle px-2.5 py-1 text-[11px] font-semibold text-heading hover:bg-highlight"
                      >
                        Status
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
    </CitizenLayout>
  );
}
