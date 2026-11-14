import { CheckCircle2, FileLock2, Plus, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { CommandLayout } from '../components/layout/CommandLayout';
import {
  ApiSuccessResponse,
  EvidenceRecordRow,
  EvidenceType,
  InvestigationRow,
} from '../types';
import { formatTimestamp } from '../utils/formatters';

export function EvidencePage() {
  const [searchParams] = useSearchParams();
  const initialInvId = searchParams.get('investigationId') || '';

  const [records, setRecords] = useState<EvidenceRecordRow[]>([]);
  const [investigations, setInvestigations] = useState<InvestigationRow[]>([]);
  const [investigationFilter, setInvestigationFilter] = useState<string>(initialInvId);
  const [typeFilter, setTypeFilter] = useState<EvidenceType | ''>('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formInvId, setFormInvId] = useState(initialInvId);
  const [formType, setFormType] = useState<EvidenceType>('BANK_STATEMENT_CSV');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formFileName, setFormFileName] = useState('');
  const [formPayload, setFormPayload] = useState('');

  const [verifyingRecord, setVerifyingRecord] = useState<EvidenceRecordRow | null>(null);
  const [verifyInput, setVerifyInput] = useState('');
  const [verifyMode, setVerifyMode] = useState<'hash' | 'payload'>('hash');
  const [verifyResult, setVerifyResult] = useState<{
    matched: boolean;
    storedHash: string;
    candidateHash: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '80' });
      if (investigationFilter) params.set('investigationId', investigationFilter);
      if (typeFilter) params.set('evidenceType', typeFilter);

      const [evRes, invRes] = await Promise.all([
        apiRequest<ApiSuccessResponse<EvidenceRecordRow[]>>(`/evidence?${params.toString()}`),
        apiRequest<ApiSuccessResponse<InvestigationRow[]>>('/investigations?limit=50'),
      ]);

      setRecords(evRes.data);
      setInvestigations(invRes.data);
      if (!formInvId && invRes.data[0]) {
        setFormInvId(invRes.data[0].id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load evidence vault.');
    } finally {
      setLoading(false);
    }
  }, [investigationFilter, typeFilter, formInvId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAddEvidence = async (e: FormEvent) => {
    e.preventDefault();
    const targetInv = investigations.find((i) => i.id === formInvId);
    if (!targetInv) {
      setError('Select a valid investigation case.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<ApiSuccessResponse<{ sha256_hash: string }>>('/evidence', {
        method: 'POST',
        body: {
          investigationId: targetInv.id,
          complaintId: targetInv.complaint_id,
          evidenceType: formType,
          title: formTitle.trim(),
          description: formDescription.trim(),
          fileName: formFileName.trim() || null,
          contentPayload: formPayload.trim() || undefined,
        },
      });
      setShowAddModal(false);
      setFormTitle('');
      setFormDescription('');
      setFormFileName('');
      setFormPayload('');
      setNotice(`Evidence recorded with SHA-256 digest ${res.data.sha256_hash}`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record evidence artifact.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyHash = async (e: FormEvent) => {
    e.preventDefault();
    if (!verifyingRecord || !verifyInput.trim()) return;
    setError(null);
    try {
      const res = await apiRequest<
        ApiSuccessResponse<{ matched: boolean; storedHash: string; candidateHash: string }>
      >(`/evidence/${verifyingRecord.id}/verify`, {
        method: 'POST',
        body:
          verifyMode === 'hash'
            ? { sha256Hash: verifyInput.trim() }
            : { contentPayload: verifyInput.trim() },
      });
      setVerifyResult(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Checksum verification failed.');
    }
  };

  return (
    <CommandLayout
      title="Forensic evidence vault & chain of custody"
      section="Casework and intelligence"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-medium text-heading hover:bg-highlight whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-120"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh vault</span>
          </button>
          <button
            type="button"
            disabled={investigations.length === 0}
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-120"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Log evidence artifact</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {error ? <ErrorDataState message={error} onRetry={() => void loadData()} /> : null}

        {notice ? (
          <div className="flex items-center gap-2 rounded-[8px] border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-mono text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <span className="break-all">{notice}</span>
          </div>
        ) : null}

        {/* Filters */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={investigationFilter}
              onChange={(e) => setInvestigationFilter(e.target.value)}
              aria-label="Filter evidence by investigation"
              className="rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs text-heading focus:outline-none"
            >
              <option value="">All investigation cases</option>
              {investigations.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.case_number} · {inv.complaint_number} ({inv.victim_name})
                </option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as EvidenceType | '')}
              aria-label="Filter evidence by type"
              className="rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-xs text-heading focus:outline-none"
            >
              <option value="">All evidence types</option>
              <option value="BANK_STATEMENT_CSV">BANK_STATEMENT_CSV</option>
              <option value="CDR_EXTRACT">CDR_EXTRACT</option>
              <option value="ATM_CCTV_NOTE">ATM_CCTV_NOTE</option>
              <option value="NPCI_REF">NPCI_REF</option>
              <option value="FREEZE_ORDER">FREEZE_ORDER</option>
              <option value="OTHER">OTHER</option>
            </select>
          </div>
        </section>

        {/* Records Table */}
        <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
          <div className="border-b border-border-subtle bg-subtle px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileLock2 className="h-4 w-4 text-accent-strong" aria-hidden="true" />
              <h2 className="text-xs font-semibold text-heading">Chain-of-custody evidence records</h2>
            </div>
            <span className="font-mono text-xs text-muted tabular-nums">
              {records.length} artifacts
            </span>
          </div>

          {loading ? (
            <TableSkeleton rows={5} cols={5} />
          ) : records.length === 0 ? (
            <EmptyDataState
              title="No evidence artifacts recorded"
              description="Log bank statements, NPCI UTR extracts, ATM CCTV logs, or Section 91 CrPC freeze orders with SHA-256 checksums."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border-subtle bg-subtle text-[11px] font-medium uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2.5">Case & type</th>
                    <th className="px-4 py-2.5">Title & custody notes</th>
                    <th className="px-4 py-2.5">SHA-256 digest</th>
                    <th className="px-4 py-2.5">Uploaded by</th>
                    <th className="px-4 py-2.5 text-right">Integrity</th>
                  </tr>
                </thead>
                <tbody className="divide-y border-border-subtle">
                  {records.map((rec) => (
                    <tr key={rec.id} className="hover:bg-subtle transition-colors duration-120">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <p className="font-mono font-medium text-accent-strong">{rec.case_number}</p>
                        <p className="font-mono text-[11px] text-muted">{rec.evidence_type}</p>
                      </td>
                      <td className="px-4 py-2.5 max-w-md">
                        <p className="font-semibold text-heading">{rec.title}</p>
                        <p className="text-[11px] text-muted line-clamp-2 mt-0.5">{rec.description}</p>
                        {rec.file_name ? (
                          <p className="font-mono text-[10px] text-muted mt-0.5">
                            File: {rec.file_name}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-emerald-800 dark:text-emerald-300 max-w-[200px] truncate">
                        {rec.sha256_hash ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <p className="text-heading font-medium">{rec.uploaded_by_name}</p>
                        <p className="font-mono text-[11px] text-muted tabular-nums">
                          {formatTimestamp(rec.recorded_at)}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setVerifyingRecord(rec);
                            setVerifyInput(rec.sha256_hash ?? '');
                            setVerifyMode('hash');
                            setVerifyResult(null);
                          }}
                          className="inline-flex items-center gap-1 rounded-[6px] border border-border-subtle bg-subtle px-2.5 py-1 text-[11px] font-medium text-heading hover:bg-highlight cursor-pointer transition-colors duration-120"
                        >
                          <ShieldCheck className="h-3 w-3 text-accent-strong" aria-hidden="true" />
                          <span>Verify hash</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Log Evidence Modal */}
        {showAddModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-[16px] border border-border-subtle bg-card p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                <h2 className="text-xs font-semibold text-heading">Log chain-of-custody evidence</h2>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="text-xs text-muted hover:text-heading cursor-pointer"
                >
                  Close
                </button>
              </div>
              <form onSubmit={(e) => void handleAddEvidence(e)} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-body mb-1">Investigation</label>
                    <select
                      required
                      value={formInvId}
                      onChange={(e) => setFormInvId(e.target.value)}
                      className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-heading focus:outline-none"
                    >
                      {investigations.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.case_number} · {inv.complaint_number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-body mb-1">Evidence type</label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as EvidenceType)}
                      className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-heading focus:outline-none"
                    >
                      <option value="BANK_STATEMENT_CSV">BANK_STATEMENT_CSV</option>
                      <option value="CDR_EXTRACT">CDR_EXTRACT</option>
                      <option value="ATM_CCTV_NOTE">ATM_CCTV_NOTE</option>
                      <option value="NPCI_REF">NPCI_REF</option>
                      <option value="FREEZE_ORDER">FREEZE_ORDER</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-body mb-1">Title</label>
                  <input
                    type="text"
                    required
                    minLength={4}
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="NPCI IMPS settlement trail extract — Layer 1-3"
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-heading focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-body mb-1">Artifact filename (optional)</label>
                  <input
                    type="text"
                    value={formFileName}
                    onChange={(e) => setFormFileName(e.target.value)}
                    placeholder="npci_utr_extract_2026.csv"
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 font-mono text-heading focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-body mb-1">Description / Custody provenance</label>
                  <textarea
                    required
                    minLength={8}
                    rows={2}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Evidentiary provenance, collecting officer, source gateway."
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 text-heading focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-body mb-1">
                    Raw payload text to digest (SHA-256 computed server-side)
                  </label>
                  <textarea
                    rows={2}
                    value={formPayload}
                    onChange={(e) => setFormPayload(e.target.value)}
                    placeholder="Optional UTR list or statement excerpt to digest..."
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 font-mono text-heading focus:outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="rounded-[8px] border border-border-subtle px-3.5 py-1.5 text-body hover:bg-highlight cursor-pointer transition-colors duration-120"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-[8px] bg-accent-strong px-4 py-1.5 font-medium text-white hover:bg-accent-strong-hover disabled:opacity-50 cursor-pointer transition-colors duration-120"
                  >
                    {submitting ? 'Hashing & storing...' : 'Record evidence'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {/* Verify Hash Modal */}
        {verifyingRecord ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-[16px] border border-border-subtle bg-card p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                <h2 className="text-xs font-semibold text-heading">
                  Verify SHA-256 integrity — {verifyingRecord.title}
                </h2>
                <button
                  type="button"
                  onClick={() => setVerifyingRecord(null)}
                  className="text-xs text-muted hover:text-heading cursor-pointer"
                >
                  Close
                </button>
              </div>
              <form onSubmit={(e) => void handleVerifyHash(e)} className="space-y-3 text-xs">
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-heading">
                    <input
                      type="radio"
                      checked={verifyMode === 'hash'}
                      onChange={() => setVerifyMode('hash')}
                      className="accent-accent-strong cursor-pointer"
                    />
                    <span>Compare SHA-256 hex</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-heading">
                    <input
                      type="radio"
                      checked={verifyMode === 'payload'}
                      onChange={() => {
                        setVerifyMode('payload');
                        setVerifyInput('');
                      }}
                      className="accent-accent-strong cursor-pointer"
                    />
                    <span>Hash raw payload text</span>
                  </label>
                </div>
                <textarea
                  rows={3}
                  required
                  value={verifyInput}
                  onChange={(e) => setVerifyInput(e.target.value)}
                  placeholder={
                    verifyMode === 'hash'
                      ? '64-character SHA-256 hex digest...'
                      : 'Paste exact raw artifact text to compute SHA-256...'
                  }
                  className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-1.5 font-mono text-heading focus:outline-none"
                />
                {verifyResult ? (
                  <div
                    className={`rounded-[8px] border px-3 py-2 font-mono text-[11px] flex items-start gap-2 ${
                      verifyResult.matched
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                        : 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200'
                    }`}
                  >
                    {verifyResult.matched ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 text-rose-700 dark:text-rose-400 mt-0.5" />
                    )}
                    <div className="break-all space-y-0.5">
                      <p className="font-semibold">
                        {verifyResult.matched
                          ? 'Checksum matched — Integrity verified'
                          : 'Checksum mismatch — Digest does not match stored record'}
                      </p>
                      <p className="opacity-90">Stored: {verifyResult.storedHash}</p>
                      <p className="opacity-90">Checked: {verifyResult.candidateHash}</p>
                    </div>
                  </div>
                ) : null}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setVerifyingRecord(null)}
                    className="rounded-[8px] border border-border-subtle px-3.5 py-1.5 text-body hover:bg-highlight cursor-pointer transition-colors duration-120"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    className="rounded-[8px] bg-accent-strong px-4 py-1.5 font-medium text-white hover:bg-accent-strong-hover cursor-pointer transition-colors duration-120"
                  >
                    Run verification
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </CommandLayout>
  );
}
