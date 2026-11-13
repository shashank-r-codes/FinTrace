import {
  Briefcase,
  CheckCircle2,
  FileDown,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDownloadBlob, apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState, TableSkeleton } from '../components/common/DataState';
import { StatusSignal } from '../components/common/StatusSignal';
import { CommandLayout } from '../components/layout/CommandLayout';
import {
  ApiSuccessResponse,
  ComplaintSummary,
  InvestigationRow,
  InvestigationStatus,
  InvestigatorOption,
  RecommendedActionItem,
} from '../types';
import { formatFraudType, formatInr, formatTimestamp } from '../utils/formatters';

export function InvestigationsPage() {
  const [investigations, setInvestigations] = useState<InvestigationRow[]>([]);
  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [investigators, setInvestigators] = useState<InvestigatorOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<InvestigationStatus | ''>('');

  const [selectedInv, setSelectedInv] = useState<InvestigationRow | null>(null);
  const [editStatus, setEditStatus] = useState<InvestigationStatus>('OPEN');
  const [editLeadId, setEditLeadId] = useState<string>('');
  const [editFindings, setEditFindings] = useState<string>('');
  const [editActions, setEditActions] = useState<RecommendedActionItem[]>([]);
  const [newActionText, setNewActionText] = useState('');
  const [newActionPriority, setNewActionPriority] =
    useState<RecommendedActionItem['priority']>('HIGH');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showOpenModal, setShowOpenModal] = useState(false);
  const [newComplaintId, setNewComplaintId] = useState('');
  const [newLeadId, setNewLeadId] = useState('');
  const [newFindings, setNewFindings] = useState('');

  const syncEditorFromRow = (row: InvestigationRow | null) => {
    setSelectedInv(row);
    if (!row) return;
    setEditStatus(row.status);
    setEditLeadId(row.lead_investigator ?? '');
    setEditFindings(row.findings_summary ?? '');
    setEditActions(Array.isArray(row.recommended_actions) ? row.recommended_actions : []);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter) params.set('status', statusFilter);

      const [invRes, cmpRes, staffRes] = await Promise.all([
        apiRequest<ApiSuccessResponse<InvestigationRow[]>>(`/investigations?${params.toString()}`),
        apiRequest<ApiSuccessResponse<ComplaintSummary[]>>('/complaints?limit=50'),
        apiRequest<ApiSuccessResponse<InvestigatorOption[]>>('/users/investigators'),
      ]);

      setInvestigations(invRes.data);
      setComplaints(cmpRes.data);
      setInvestigators(staffRes.data);

      const nextSelected = selectedInv
        ? invRes.data.find((i) => i.id === selectedInv.id) ?? invRes.data[0] ?? null
        : invRes.data[0] ?? null;
      syncEditorFromRow(nextSelected);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load investigations.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const unlinkedComplaints = complaints.filter(
    (c) => !investigations.some((inv) => inv.complaint_id === c.id)
  );

  const handleSaveCase = async () => {
    if (!selectedInv) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/investigations/${selectedInv.id}`, {
        method: 'PATCH',
        body: {
          status: editStatus,
          leadInvestigator: editLeadId || null,
          findingsSummary: editFindings,
          recommendedActions: editActions,
        },
      });
      setNotice(`Saved investigation updates for ${selectedInv.case_number}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save investigation casework.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenInvestigation = async (e: FormEvent) => {
    e.preventDefault();
    if (!newComplaintId) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/investigations', {
        method: 'POST',
        body: {
          complaintId: newComplaintId,
          leadInvestigator: newLeadId || null,
          findingsSummary: newFindings.trim() || undefined,
        },
      });
      setShowOpenModal(false);
      setNewComplaintId('');
      setNewLeadId('');
      setNewFindings('');
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open investigation.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddAction = () => {
    const trimmed = newActionText.trim();
    if (trimmed.length < 3) return;
    setEditActions((prev) => [
      ...prev,
      { action: trimmed, priority: newActionPriority, done: false },
    ]);
    setNewActionText('');
  };

  const handleExportPdf = async () => {
    if (!selectedInv) return;
    setExportingPdf(true);
    setError(null);
    try {
      await apiDownloadBlob(
        `/reports/export/pdf/${selectedInv.complaint_id}`,
        `fintrace-dossier-${selectedInv.complaint_number}.pdf`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to download case dossier PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <CommandLayout
      title="Investigations & Casework"
      section="Response & Casework"
      actions={
        <>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            disabled={unlinkedComplaints.length === 0}
            onClick={() => {
              setNewComplaintId(unlinkedComplaints[0]?.id ?? '');
              setShowOpenModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Initialize Case File
          </button>
        </>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void loadData()} /> : null}

      {notice ? (
        <div className="flex items-center gap-2 rounded-[6px] border border-emerald-700/50 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Case List */}
        <div className="xl:col-span-5 rounded-[6px] border border-slate-800 bg-[#111827] overflow-hidden flex flex-col">
          <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-sky-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-white">Active Case Dossiers</h2>
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as InvestigationStatus | '')}
              aria-label="Filter investigations by status"
              className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2 py-1 text-[11px] text-slate-200"
            >
              <option value="">All Statuses</option>
              <option value="OPEN">OPEN</option>
              <option value="ACTIVE_TRACE">ACTIVE_TRACE</option>
              <option value="FREEZE_REQUESTED">FREEZE_REQUESTED</option>
              <option value="ATM_SURVEILLANCE">ATM_SURVEILLANCE</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </div>

          {loading ? (
            <TableSkeleton rows={6} cols={3} />
          ) : investigations.length === 0 ? (
            <EmptyDataState
              title="No investigations found"
              description="Open an investigation from a registered cybercrime complaint."
            />
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-[640px] overflow-y-auto">
              {investigations.map((inv) => {
                const isSelected = selectedInv?.id === inv.id;
                return (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => syncEditorFromRow(inv)}
                    className={`w-full text-left px-4 py-3 space-y-1.5 cursor-pointer ${
                      isSelected ? 'bg-sky-950/35' : 'hover:bg-slate-800/35'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs font-semibold text-sky-300">
                          {inv.case_number} · {inv.complaint_number}
                        </p>
                        <p className="text-xs font-medium text-white mt-0.5">
                          {inv.victim_name} · {formatFraudType(inv.fraud_type)}
                        </p>
                      </div>
                      <StatusSignal level={inv.status} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Lead: {inv.lead_investigator_name ?? 'Unassigned'}</span>
                      <span className="font-mono tabular-nums">
                        {formatInr(inv.reported_amount)} · {inv.evidence_count} evid.
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Case Editor */}
        <div className="xl:col-span-7 rounded-[6px] border border-slate-800 bg-[#111827] p-5 space-y-4">
          {!selectedInv ? (
            <EmptyDataState
              title="Select an investigation case"
              description="Choose a case from the left panel to assign leads, log findings, and export intelligence dossiers."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <p className="font-mono text-xs text-sky-300">
                    {selectedInv.case_number} · Linked {selectedInv.complaint_number}
                  </p>
                  <h2 className="text-base font-bold text-white mt-0.5">
                    {selectedInv.victim_name} ({formatInr(selectedInv.reported_amount)})
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Opened {formatTimestamp(selectedInv.opened_at)} · {selectedInv.atm_prediction_count} ATM forecasts · {selectedInv.open_alert_count} open alerts
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/evidence?investigationId=${encodeURIComponent(selectedInv.id)}`}
                    className="rounded-[5px] border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    Evidence ({selectedInv.evidence_count})
                  </Link>
                  <button
                    type="button"
                    disabled={exportingPdf}
                    onClick={() => void handleExportPdf()}
                    className="inline-flex items-center gap-1.5 rounded-[5px] border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800 cursor-pointer"
                  >
                    <FileDown className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                    {exportingPdf ? 'Building PDF...' : 'Export PDF Dossier'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Case Workflow Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as InvestigationStatus)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-slate-100"
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="ACTIVE_TRACE">ACTIVE_TRACE</option>
                    <option value="FREEZE_REQUESTED">FREEZE_REQUESTED</option>
                    <option value="ATM_SURVEILLANCE">ATM_SURVEILLANCE</option>
                    <option value="CLOSED">CLOSED</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Lead Investigator
                  </label>
                  <select
                    value={editLeadId}
                    onChange={(e) => setEditLeadId(e.target.value)}
                    className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-slate-100"
                  >
                    <option value="">Unassigned</option>
                    {investigators.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.full_name} ({inv.badge_number})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Investigative Findings Summary
                </label>
                <textarea
                  rows={4}
                  value={editFindings}
                  onChange={(e) => setEditFindings(e.target.value)}
                  placeholder="Document verified money trail hops, bank nodal freeze confirmations, and ATM CCTV coordination..."
                  className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs text-slate-100 leading-relaxed focus:border-sky-500 focus:outline-none"
                />
              </div>

              {/* Action Checklist */}
              <div className="space-y-2.5">
                <p className="text-[11px] font-medium text-slate-400">
                  Recommended Operational Actions
                </p>

                <div className="space-y-1.5">
                  {editActions.length === 0 ? (
                    <p className="text-xs text-slate-500">No action items logged yet.</p>
                  ) : (
                    editActions.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 rounded-[5px] border border-slate-800 bg-[#0B1120] px-3 py-2 text-xs"
                      >
                        <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={item.done}
                            onChange={() =>
                              setEditActions((prev) =>
                                prev.map((a, i) => (i === idx ? { ...a, done: !a.done } : a))
                              )
                            }
                            className="h-3.5 w-3.5 rounded border-slate-600"
                          />
                          <span className={item.done ? 'line-through text-slate-500' : 'text-slate-200'}>
                            {item.action}
                          </span>
                        </label>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-[10px] text-amber-300">{item.priority}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setEditActions((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-slate-500 hover:text-red-400 cursor-pointer"
                            aria-label="Remove action"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <input
                    type="text"
                    value={newActionText}
                    onChange={(e) => setNewActionText(e.target.value)}
                    placeholder="Add next intervention task (e.g. Issue 91 CrPC notice to SBI nodal)..."
                    className="flex-1 min-w-[220px] rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <select
                    value={newActionPriority}
                    onChange={(e) =>
                      setNewActionPriority(e.target.value as RecommendedActionItem['priority'])
                    }
                    className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-2 py-1.5 text-xs font-mono text-slate-200"
                  >
                    <option value="IMMEDIATE">IMMEDIATE</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleAddAction}
                    className="rounded-[5px] border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
                  >
                    Add Task
                  </button>
                </div>
              </div>

              <div className="flex justify-end border-t border-slate-800 pt-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveCase()}
                  className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  {saving ? 'Saving Casework...' : 'Save Investigation Record'}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Open Investigation Modal */}
      {showOpenModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-[6px] border border-slate-700 bg-[#111827] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-semibold text-white">Initialize Investigation Case</h2>
              <button
                type="button"
                onClick={() => setShowOpenModal(false)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>
            <form onSubmit={(e) => void handleOpenInvestigation(e)} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Complaint Without Investigation</label>
                <select
                  required
                  value={newComplaintId}
                  onChange={(e) => setNewComplaintId(e.target.value)}
                  className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-slate-100"
                >
                  {unlinkedComplaints.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.complaint_number} · {c.victim_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Lead Investigator</label>
                <select
                  value={newLeadId}
                  onChange={(e) => setNewLeadId(e.target.value)}
                  className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-slate-100"
                >
                  <option value="">Unassigned</option>
                  {investigators.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.full_name} ({inv.badge_number})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Initial Notes</label>
                <textarea
                  rows={3}
                  value={newFindings}
                  onChange={(e) => setNewFindings(e.target.value)}
                  className="w-full rounded-[5px] border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowOpenModal(false)}
                  className="rounded-[5px] border border-slate-700 px-3 py-1.5 text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-[5px] bg-sky-600 px-3.5 py-1.5 font-semibold text-white hover:bg-sky-500 cursor-pointer"
                >
                  Create Case File
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </CommandLayout>
  );
}
