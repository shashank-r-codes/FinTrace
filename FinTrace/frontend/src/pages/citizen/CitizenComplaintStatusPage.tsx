import { ArrowLeft, CheckCircle2, Clock, FileCheck2, Shield, Upload } from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { ErrorDataState, TableSkeleton } from '../../components/common/DataState';
import { CitizenLayout } from '../../components/layout/CitizenLayout';
import { ApiSuccessResponse, CitizenComplaintDetail, CitizenStatus } from '../../types';
import { formatFraudType, formatInr, formatTimestamp } from '../../utils/formatters';

const STEP_TRACKER: CitizenStatus[] = [
  'Submitted',
  'Under Review',
  'Assigned to Investigator',
  'Investigation in Progress',
  'Action Taken / Closed',
];

export function CitizenComplaintStatusPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CitizenComplaintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<ApiSuccessResponse<CitizenComplaintDetail>>(
        `/citizen/complaints/${id}`
      );
      setDetail(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load complaint status.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleUploadEvidence = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    setUploadMsg(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', file.name);
      await apiRequest(`/citizen/complaints/${id}/evidence`, {
        method: 'POST',
        body: fd,
      });
      setUploadMsg(`Uploaded '${file.name}' successfully.`);
      await loadDetail();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to upload document.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const currentStepIdx = detail
    ? Math.max(0, STEP_TRACKER.indexOf(detail.citizen_status))
    : 0;

  return (
    <CitizenLayout
      title={detail ? `Complaint ${detail.reference_no}` : 'Complaint Status'}
      subtitle="Live progress, official remarks, and uploaded documents"
      actions={
        <Link
          to="/citizen/complaints"
          className="inline-flex items-center gap-1.5 rounded-[6px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-subtle"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to My Complaints
        </Link>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadDetail()} /> : null}
      {uploadMsg ? (
        <div className="rounded-[6px] border border-emerald-300 bg-[#D8F8EC] px-4 py-2.5 text-xs font-medium text-[#065F46] dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          {uploadMsg}
        </div>
      ) : null}

      {loading || !detail ? (
        <div className="rounded-[8px] border border-border-subtle bg-card p-5">
          <TableSkeleton rows={5} cols={4} />
        </div>
      ) : (
        <>
          {/* Step Progress Tracker */}
          <section className="rounded-[8px] border border-border-subtle bg-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted">Reference Number</p>
                <p className="font-mono text-lg font-bold text-accent-strong">
                  {detail.reference_no}
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs text-muted">Investigator Assignment</p>
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-heading">
                  <Shield className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
                  {detail.assignment_label}
                </p>
              </div>
            </div>

            <ol className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 pt-1">
              {STEP_TRACKER.map((label, idx) => {
                const completed = idx < currentStepIdx || detail.citizen_status === 'Action Taken / Closed';
                const current = idx === currentStepIdx && detail.citizen_status !== 'Action Taken / Closed';
                return (
                  <li
                    key={label}
                    className={`rounded-[6px] border p-3 text-xs transition-colors ${
                      completed
                        ? 'border-emerald-300 bg-[#D8F8EC] text-[#065F46] dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : current
                          ? 'border-accent-strong bg-highlight text-heading font-semibold'
                          : 'border-border-subtle bg-subtle/40 text-muted'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      {completed ? (
                        <CheckCircle2 className="h-4 w-4 text-[#10B981] shrink-0" aria-hidden="true" />
                      ) : (
                        <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <span>Step {idx + 1}</span>
                    </div>
                    <p className="mt-1 leading-snug">{label}</p>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Summary Card */}
          <section className="grid grid-cols-1 sm:grid-cols-4 gap-4 rounded-[8px] border border-border-subtle bg-card p-5 text-xs">
            <div>
              <p className="text-muted">Incident Type</p>
              <p className="mt-1 font-semibold text-heading">{formatFraudType(detail.fraud_type)}</p>
            </div>
            <div>
              <p className="text-muted">Amount Lost</p>
              <p className="mt-1 font-mono text-sm font-bold text-heading tabular-nums">
                {formatInr(detail.reported_amount)}
              </p>
            </div>
            <div>
              <p className="text-muted">Your Bank Account</p>
              <p className="mt-1 font-semibold text-heading">
                {detail.victim_bank_name ?? 'Reported Bank'}
              </p>
              <p className="font-mono text-[11px] text-muted">
                {detail.victim_account_masked ?? 'Masked'}
              </p>
            </div>
            <div>
              <p className="text-muted">Submitted On</p>
              <p className="mt-1 font-mono text-heading">{formatTimestamp(detail.reported_at)}</p>
            </div>
            <div className="sm:col-span-4 border-t border-border-subtle pt-3">
              <p className="text-muted mb-1">Description</p>
              <p className="text-body leading-relaxed">{detail.summary}</p>
            </div>
          </section>

          {/* Status Timeline & Public Remarks */}
          <section className="rounded-[8px] border border-border-subtle bg-card overflow-hidden">
            <div className="border-b border-border-subtle bg-highlight/50 px-4 py-3">
              <h2 className="text-sm font-semibold text-heading">Official Status Updates & Remarks</h2>
            </div>
            {detail.status_history.length === 0 ? (
              <p className="p-4 text-xs text-muted">No status updates posted yet.</p>
            ) : (
              <div className="divide-y divide-border-subtle">
                {detail.status_history.map((item) => (
                  <div key={item.id} className="px-4 py-3.5 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center rounded-[4px] border border-border-subtle bg-highlight/60 px-2 py-0.5 text-[11px] font-semibold text-heading">
                        {item.citizen_status}
                      </span>
                      <span className="font-mono text-[11px] text-muted">
                        {formatTimestamp(item.changed_at)}
                      </span>
                    </div>
                    <p className="text-xs text-body">
                      {item.public_remark || `Status updated to ${item.citizen_status}.`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Disputed Transactions */}
          <section className="rounded-[8px] border border-border-subtle bg-card overflow-hidden">
            <div className="border-b border-border-subtle bg-highlight/50 px-4 py-3">
              <h2 className="text-sm font-semibold text-heading">
                Disputed Transactions ({detail.disputed_transactions.length})
              </h2>
            </div>
            {detail.disputed_transactions.length === 0 ? (
              <p className="p-4 text-xs text-muted">No disputed transactions recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border-subtle bg-subtle text-[11px] font-semibold uppercase text-muted">
                    <tr>
                      <th className="px-4 py-2">TXN / UTR</th>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Channel</th>
                      <th className="px-4 py-2">Beneficiary</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {detail.disputed_transactions.map((tx) => (
                      <tr key={tx.txn_id}>
                        <td className="px-4 py-2.5 font-mono font-semibold text-accent-strong">
                          {tx.txn_id}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-muted">
                          {formatTimestamp(tx.date)}
                        </td>
                        <td className="px-4 py-2.5 text-heading">{tx.channel}</td>
                        <td className="px-4 py-2.5 text-body">
                          {tx.beneficiary_bank ?? 'Beneficiary Bank'} ·{' '}
                          <span className="font-mono">{tx.beneficiary_account_masked}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-heading tabular-nums">
                          {formatInr(tx.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Uploaded Documents */}
          <section className="rounded-[8px] border border-border-subtle bg-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-highlight/50 px-4 py-3">
              <h2 className="text-sm font-semibold text-heading">
                Uploaded Evidence Documents ({detail.documents.length})
              </h2>
              <label className="inline-flex items-center gap-1.5 rounded-[5px] bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover cursor-pointer">
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {uploading ? 'Uploading...' : 'Upload Additional Document'}
                <input
                  type="file"
                  disabled={uploading}
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={handleUploadEvidence}
                  className="sr-only"
                />
              </label>
            </div>
            {detail.documents.length === 0 ? (
              <p className="p-4 text-xs text-muted">
                No documents uploaded yet. You may attach screenshots or bank statements (PNG, JPG, WEBP, PDF up to 5 MB).
              </p>
            ) : (
              <div className="divide-y divide-border-subtle">
                {detail.documents.map((doc) => (
                  <div key={doc.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      <FileCheck2 className="h-4 w-4 text-[#10B981] shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-semibold text-heading">{doc.file_name ?? doc.title}</p>
                        <p className="text-[11px] text-muted">
                          {doc.mime_type ?? 'document'}
                          {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(1)} KB` : ''}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-muted">
                      {formatTimestamp(doc.uploaded_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </CitizenLayout>
  );
}
