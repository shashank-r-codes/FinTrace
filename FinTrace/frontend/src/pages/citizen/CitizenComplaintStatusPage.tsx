import { ArrowLeft, CheckCircle2, Clock, FileCheck2, PhoneCall, Shield, Upload } from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { ErrorDataState, TableSkeleton } from '../../components/common/DataState';
import { CitizenLayout } from '../../components/layout/CitizenLayout';
import { ApiSuccessResponse, CitizenComplaintDetail, CitizenStatus } from '../../types';
import { formatFraudType, formatInr, formatTimestamp } from '../../utils/formatters';

const STEP_TRACKER: { status: CitizenStatus; label: string; explanation: string }[] = [
  {
    status: 'Submitted',
    label: '1. Submitted',
    explanation: 'Your complaint was recorded in the cybercrime register.',
  },
  {
    status: 'Under Review',
    label: '2. Under review',
    explanation: 'Desk officers verify transaction details and routing.',
  },
  {
    status: 'Assigned to Investigator',
    label: '3. Assigned to officer',
    explanation: 'Dossier transferred to Cyber Cell investigating officer.',
  },
  {
    status: 'Investigation in Progress',
    label: '4. Active investigation',
    explanation: 'Notifying beneficiary banks to trace and hold funds.',
  },
  {
    status: 'Action Taken / Closed',
    label: '5. Action taken / Closed',
    explanation: 'Inter-bank lien placed or formal closing report filed.',
  },
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
      setUploadMsg(`Document '${file.name}' was uploaded and sealed with a cryptographic checksum.`);
      await loadDetail();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to upload document.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const currentStepIdx = detail
    ? Math.max(0, STEP_TRACKER.findIndex((s) => s.status === detail.citizen_status))
    : 0;

  return (
    <CitizenLayout
      title={detail ? `Complaint ${detail.reference_no}` : 'Complaint status'}
      subtitle="Live progress, official remarks, and uploaded documents"
      actions={
        <Link
          to="/citizen/complaints"
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight cursor-pointer transition-colors duration-120"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to my complaints</span>
        </Link>
      }
    >
      <div className="space-y-6">
        {error ? <ErrorDataState message={error} onRetry={() => void loadDetail()} /> : null}
        {uploadMsg ? (
          <div className="rounded-[8px] border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-200">
            {uploadMsg}
          </div>
        ) : null}

        {loading || !detail ? (
          <div className="rounded-[12px] border border-border-subtle bg-card p-5">
            <TableSkeleton rows={5} cols={4} />
          </div>
        ) : (
          <>
            {/* Step Progress Tracker */}
            <section className="rounded-[12px] border border-border-subtle bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-muted">Official reference number</p>
                  <p className="font-mono text-xl font-bold text-accent-strong tabular-nums">
                    {detail.reference_no}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs text-muted">Investigative assignment</p>
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-heading">
                    <Shield className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
                    <span>{detail.assignment_label}</span>
                  </p>
                </div>
              </div>

              <ol className="grid grid-cols-1 sm:grid-cols-5 gap-3 pt-2">
                {STEP_TRACKER.map((stepItem, idx) => {
                  const completed = idx < currentStepIdx || detail.citizen_status === 'Action Taken / Closed';
                  const current = idx === currentStepIdx && detail.citizen_status !== 'Action Taken / Closed';
                  return (
                    <li
                      key={stepItem.status}
                      className={`rounded-[8px] border p-3 text-xs transition-colors duration-120 ${
                        completed
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-200'
                          : current
                            ? 'border-accent-strong bg-highlight text-heading font-semibold'
                            : 'border-border-subtle bg-subtle text-muted'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-semibold">
                        {completed ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                        ) : (
                          <Clock className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                        )}
                        <span>{stepItem.label}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed opacity-90">{stepItem.explanation}</p>
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* Incident Summary Card */}
            <section className="rounded-[12px] border border-border-subtle bg-card p-5 text-xs space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-[11px] text-muted">Incident type</p>
                  <p className="mt-1 font-semibold text-heading">{formatFraudType(detail.fraud_type)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted">Amount reported lost</p>
                  <p className="mt-1 font-mono text-sm font-bold text-heading tabular-nums">
                    {formatInr(detail.reported_amount)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted">Your bank account</p>
                  <p className="mt-1 font-semibold text-heading">
                    {detail.victim_bank_name ?? 'Reported Bank'}
                  </p>
                  <p className="font-mono text-[11px] text-muted">
                    {detail.victim_account_masked ?? 'Masked'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted">Date submitted</p>
                  <p className="mt-1 font-mono text-heading tabular-nums">{formatTimestamp(detail.reported_at)}</p>
                </div>
              </div>

              <div className="border-t border-border-subtle pt-3">
                <p className="text-[11px] text-muted mb-1">Your description of what occurred</p>
                <p className="text-body leading-relaxed">{detail.summary}</p>
              </div>
            </section>

            {/* Official Remarks & Updates */}
            <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
              <div className="border-b border-border-subtle bg-subtle px-4 py-3">
                <h2 className="text-xs font-semibold text-heading">Official status updates and remarks</h2>
              </div>
              {detail.status_history.length === 0 ? (
                <p className="p-4 text-xs text-muted">Your complaint was received. An investigator will review your submission shortly.</p>
              ) : (
                <div className="divide-y border-border-subtle">
                  {detail.status_history.map((item) => (
                    <div key={item.id} className="px-4 py-3.5 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center rounded-[6px] border border-border-subtle bg-highlight px-2 py-0.5 text-[11px] font-semibold text-heading">
                          {item.citizen_status}
                        </span>
                        <span className="font-mono text-[11px] text-muted tabular-nums">
                          {formatTimestamp(item.changed_at)}
                        </span>
                      </div>
                      <p className="text-xs text-body leading-relaxed">
                        {item.public_remark || `Status changed to ${item.citizen_status}.`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Disputed Transactions */}
            <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
              <div className="border-b border-border-subtle bg-subtle px-4 py-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-heading">
                  Disputed transactions ({detail.disputed_transactions.length})
                </h2>
                <span className="text-[11px] text-muted">Notified to beneficiary bank nodal desks</span>
              </div>
              {detail.disputed_transactions.length === 0 ? (
                <p className="p-4 text-xs text-muted">No disputed transactions registered for this complaint.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="border-b border-border-subtle bg-subtle/50 text-[11px] font-semibold text-muted">
                      <tr>
                        <th className="px-4 py-2.5">Transaction ID / UTR</th>
                        <th className="px-4 py-2.5">Date & Time</th>
                        <th className="px-4 py-2.5">Channel</th>
                        <th className="px-4 py-2.5">Beneficiary Bank & Account</th>
                        <th className="px-4 py-2.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y border-border-subtle font-mono">
                      {detail.disputed_transactions.map((tx) => (
                        <tr key={tx.txn_id} className="hover:bg-subtle transition-colors duration-120 font-sans">
                          <td className="px-4 py-3 font-mono font-semibold text-accent-strong">
                            {tx.txn_id}
                          </td>
                          <td className="px-4 py-3 font-mono text-muted tabular-nums">
                            {formatTimestamp(tx.date)}
                          </td>
                          <td className="px-4 py-3 text-heading">{tx.channel}</td>
                          <td className="px-4 py-3 text-body">
                            {tx.beneficiary_bank ?? 'Beneficiary Bank'} ·{' '}
                            <span className="font-mono">{tx.beneficiary_account_masked}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-heading tabular-nums">
                            {formatInr(tx.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Uploaded Evidence Documents */}
            <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-subtle px-4 py-3">
                <h2 className="text-xs font-semibold text-heading">
                  Supporting evidence documents ({detail.documents.length})
                </h2>
                <label className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover cursor-pointer transition-colors duration-120">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{uploading ? 'Uploading...' : 'Upload additional document'}</span>
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
                  No documents attached yet. You may upload bank statements, transaction receipts, or SMS screenshots (PNG, JPG, WEBP, PDF up to 5 MB each).
                </p>
              ) : (
                <div className="divide-y border-border-subtle">
                  {detail.documents.map((doc) => (
                    <div key={doc.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2.5">
                        <FileCheck2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                        <div>
                          <p className="font-semibold text-heading">{doc.file_name ?? doc.title}</p>
                          <p className="text-[11px] text-muted">
                            {doc.mime_type ?? 'document'}
                            {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(1)} KB` : ''}
                          </p>
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-muted tabular-nums">
                        {formatTimestamp(doc.uploaded_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Helpline Footer */}
            <div className="rounded-[8px] border border-border-subtle bg-subtle p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <PhoneCall className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
                <span>Need urgent assistance? Call the National Cybercrime Helpline:</span>
                <strong className="font-mono text-accent-strong">1930</strong>
              </span>
              <span>Available 24 hours daily.</span>
            </div>
          </>
        )}
      </div>
    </CitizenLayout>
  );
}
