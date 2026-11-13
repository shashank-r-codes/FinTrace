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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investigationFilter, typeFilter]);

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
      title="Forensic Evidence Vault"
      section="Response & Casework"
      actions={
        <>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh Vault
          </button>
          <button
            type="button"
            disabled={investigations.length === 0}
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Log Evidence Artifact
          </button>
        </>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadData()} /> : null}

      {notice ? (
        <div className="flex items-center gap-2 rounded-[6px] border border-emerald-700/50 bg-emerald-950/30 px-4 py-2.5 text-xs font-mono text-emerald-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <span className="break-all">{notice}</span>
        </div>
      ) : null}

      {/* Filters */}
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] p-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select
            value={investigationFilter}
            onChange={(e) => setInvestigationFilter(e.target.value)}
            aria-label="Filter evidence by investigation"
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
          >
            <option value="">All Investigation Cases</option>
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
            className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
          >
            <option value="">All Evidence Types</option>
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
      <section className="rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileLock2 className="h-4 w-4 text-sky-400" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-white">Chain-of-Custody Evidence Records</h2>
          </div>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
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
              <thead className="border-b border-slate-800 bg-[#0F172A] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Case & Type</th>
                  <th className="px-4 py-2.5">Title & Custody Notes</th>
                  <th className="px-4 py-2.5">SHA-256 Digest</th>
                  <th className="px-4 py-2.5">Uploaded By</th>
                  <th className="px-4 py-2.5 text-right">Integrity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-800/35">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <p className="font-mono font-semibold text-sky-300">{rec.case_number}</p>
                      <p className="font-mono text-[11px] text-slate-400">{rec.evidence_type}</p>
                    </td>
                    <td className="px-4 py-2.5 max-w-md">
                      <p className="font-semibold text-white">{rec.title}</p>
                      <p className="text-[11px] text-slate-400 line-clamp-2">{rec.description}</p>
                      {rec.file_name ? (
                        <p className="font-mono text-[10px] text-slate-500 mt-0.5">
                          File: {rec.file_name}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-emerald-300 max-w-[200px] truncate">
                      {rec.sha256_hash ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <p className="text-slate-200">{rec.uploaded_by_name}</p>
                      <p className="font-mono text-[11px] text-slate-400 tabular-nums">
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
                        className="inline-flex items-center gap-1 rounded-[4px] border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
                      >
                        <ShieldCheck className="h-3 w-3 text-sky-400" aria-hidden="true" />
                        Verify Hash
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-[6px] border border-slate-700 bg-[#111827] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-semibold text-white">Log Chain-of-Custody Evidence</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>
            <form onSubmit={(e) => void handleAddEvidence(e)} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Investigation</label>
                  <select
                    required
                    value={formInvId}
                    onChange={(e) => setFormInvId(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-slate-100"
                  >
                    {investigations.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.case_number} · {inv.complaint_number}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Evidence Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as EvidenceType)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-slate-100"
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
                <label className="block text-slate-400 mb-1">Title</label>
                <input
                  type="text"
                  required
                  minLength={4}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="NPCI IMPS Settlement Trail Extract — Layer 1-3"
                  className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Artifact Filename (optional)</label>
                <input
                  type="text"
                  value={formFileName}
                  onChange={(e) => setFormFileName(e.target.value)}
                  placeholder="npci_utr_extract_2026.csv"
                  className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Description / Custody Provenance</label>
                <textarea
                  required
                  minLength={8}
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  Raw Payload / Reference Text to Hash (SHA-256 computed server-side)
                </label>
                <textarea
                  rows={2}
                  value={formPayload}
                  onChange={(e) => setFormPayload(e.target.value)}
                  placeholder="Optional UTR list or statement excerpt to digest..."
                  className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-[5px] border border-slate-700 px-3 py-1.5 text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-[5px] bg-sky-600 px-3.5 py-1.5 font-semibold text-white hover:bg-sky-500 cursor-pointer"
                >
                  {submitting ? 'Hashing & Storing...' : 'Record Evidence'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Verify Hash Modal */}
      {verifyingRecord ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-[6px] border border-slate-700 bg-[#111827] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-semibold text-white">
                Verify SHA-256 Integrity — {verifyingRecord.title}
              </h2>
              <button
                type="button"
                onClick={() => setVerifyingRecord(null)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>
            <form onSubmit={(e) => void handleVerifyHash(e)} className="space-y-3 text-xs">
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-200">
                  <input
                    type="radio"
                    checked={verifyMode === 'hash'}
                    onChange={() => setVerifyMode('hash')}
                  />
                  Compare SHA-256 Hex
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-200">
                  <input
                    type="radio"
                    checked={verifyMode === 'payload'}
                    onChange={() => {
                      setVerifyMode('payload');
                      setVerifyInput('');
                    }}
                  />
                  Hash Raw Payload Text
                </label>
              </div>
              <textarea
                rows={3}
                required
                value={verifyInput}
                onChange={(e) => setVerifyInput(e.target.value)}
                placeholder={
                  verifyMode === 'hash'
                    ? '64-char SHA-256 hex digest...'
                    : 'Paste exact raw artifact text to compute SHA-256...'
                }
                className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 font-mono text-slate-100"
              />
              {verifyResult ? (
                <div
                  className={`rounded-[5px] border px-3 py-2 font-mono text-[11px] flex items-start gap-2 ${
                    verifyResult.matched
                      ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-200'
                      : 'border-red-700/60 bg-red-950/30 text-red-200'
                  }`}
                >
                  {verifyResult.matched ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                  )}
                  <div className="break-all">
                    <p className="font-semibold">
                      {verifyResult.matched
                        ? 'CHECKSUM MATCHED — Integrity verified'
                        : 'CHECKSUM MISMATCH — Digest does not match stored record'}
                    </p>
                    <p className="mt-0.5 text-slate-300">Stored: {verifyResult.storedHash}</p>
                    <p className="text-slate-300">Checked: {verifyResult.candidateHash}</p>
                  </div>
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setVerifyingRecord(null)}
                  className="rounded-[5px] border border-slate-700 px-3 py-1.5 text-slate-300 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="rounded-[5px] bg-sky-600 px-3.5 py-1.5 font-semibold text-white hover:bg-sky-500 cursor-pointer"
                >
                  Run Verification
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </CommandLayout>
  );
}
