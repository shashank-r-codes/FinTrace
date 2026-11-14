import { ArrowLeft, ArrowRight, CheckCircle2, FileText, PhoneCall, Plus, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/client';
import { ErrorDataState } from '../../components/common/DataState';
import { CitizenLayout } from '../../components/layout/CitizenLayout';
import { ApiSuccessResponse, CitizenComplaintSummary } from '../../types';
import { formatInr } from '../../utils/formatters';

interface DisputedTxnDraft {
  txnId: string;
  date: string;
  amount: string;
  beneficiaryAccount: string;
  beneficiaryBank: string;
  channel: 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'CARD' | 'WALLET';
}

const INCIDENT_OPTIONS = [
  { value: 'UPI_FRAUD', label: 'UPI Fraud (Unauthorized debit or fake collect request)' },
  { value: 'PHISHING', label: 'Phishing / Fake Link (SMS, email, or suspicious webpage)' },
  { value: 'INVESTMENT_SCAM', label: 'Investment Scam (Stock trading or crypto scheme)' },
  { value: 'OTP_VISHING', label: 'Phone Call / OTP Scam (Impersonating bank or utility staff)' },
  { value: 'CARD_FRAUD', label: 'Card Fraud / Skimming (Unauthorized card charge)' },
  { value: 'SEXTORTION_OTHER', label: 'Other Cyber Fraud or Extortion' },
] as const;

const STEPS = [
  '1. Incident details',
  '2. Loss & account',
  '3. Disputed transfers',
  '4. Supporting evidence',
  '5. Review & submit',
];

function maskForPreview(raw: string): string {
  const clean = raw.trim();
  if (clean.length <= 4) return 'XXXX';
  return `${'X'.repeat(Math.max(4, clean.length - 4))}${clean.slice(-4)}`;
}

export function FileComplaintPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Incident
  const [incidentType, setIncidentType] = useState<string>('UPI_FRAUD');
  const [incidentTimestamp, setIncidentTimestamp] = useState(() =>
    new Date().toISOString().slice(0, 16)
  );
  const [city, setCity] = useState('Bengaluru');
  const [description, setDescription] = useState('');

  // Step 2: Victim account & amount
  const [amountLost, setAmountLost] = useState('');
  const [victimBankName, setVictimBankName] = useState('');
  const [victimAccountNumber, setVictimAccountNumber] = useState('');

  // Step 3: Disputed transactions
  const [disputedTxns, setDisputedTxns] = useState<DisputedTxnDraft[]>([
    {
      txnId: '',
      date: new Date().toISOString().slice(0, 16),
      amount: '',
      beneficiaryAccount: '',
      beneficiaryBank: '',
      channel: 'UPI',
    },
  ]);

  // Step 4: Files
  const [files, setFiles] = useState<File[]>([]);

  const addTxnRow = () => {
    setDisputedTxns((prev) => [
      ...prev,
      {
        txnId: '',
        date: new Date().toISOString().slice(0, 16),
        amount: '',
        beneficiaryAccount: '',
        beneficiaryBank: '',
        channel: 'UPI',
      },
    ]);
  };

  const removeTxnRow = (idx: number) => {
    setDisputedTxns((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const updateTxnRow = (idx: number, field: keyof DisputedTxnDraft, value: string) => {
    setDisputedTxns((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
    );
  };

  const validateCurrentStep = (): boolean => {
    setError(null);
    if (step === 0) {
      if (!incidentTimestamp) {
        setError('Please select the date and time when the incident occurred.');
        return false;
      }
      if (description.trim().length < 10) {
        setError('Please describe what happened in at least 10 characters.');
        return false;
      }
      return true;
    }
    if (step === 1) {
      if (!(Number(amountLost) > 0)) {
        setError('Please enter the total amount lost in INR.');
        return false;
      }
      if (victimBankName.trim().length < 2) {
        setError('Please enter your bank name.');
        return false;
      }
      if (victimAccountNumber.trim().length < 4) {
        setError('Please enter your bank account number.');
        return false;
      }
      return true;
    }
    if (step === 2) {
      for (let i = 0; i < disputedTxns.length; i++) {
        const tx = disputedTxns[i];
        if (
          tx.txnId.trim().length < 4 ||
          !(Number(tx.amount) > 0) ||
          tx.beneficiaryAccount.trim().length < 4 ||
          tx.beneficiaryBank.trim().length < 2
        ) {
          setError(`Please fill in all fields for disputed transaction #${i + 1}.`);
          return false;
        }
      }
      return true;
    }
    return true;
  };

  const handleNext = () => {
    if (validateCurrentStep()) {
      setStep((s) => Math.min(STEPS.length - 1, s + 1));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validateCurrentStep()) return;

    setSubmitting(true);
    setError(null);
    try {
      const createRes = await apiRequest<ApiSuccessResponse<CitizenComplaintSummary>>(
        '/citizen/complaints',
        {
          method: 'POST',
          body: {
            incidentType,
            incidentTimestamp: new Date(incidentTimestamp).toISOString(),
            description: description.trim(),
            amountLost: Number(amountLost),
            victimBankName: victimBankName.trim(),
            victimAccountNumber: victimAccountNumber.trim(),
            city: city.trim() || 'Bengaluru',
            disputedTransactions: disputedTxns.map((tx) => ({
              txnId: tx.txnId.trim(),
              date: new Date(tx.date).toISOString(),
              amount: Number(tx.amount),
              beneficiaryAccount: tx.beneficiaryAccount.trim(),
              beneficiaryBank: tx.beneficiaryBank.trim(),
              channel: tx.channel,
            })),
          },
        }
      );

      const complaintId = createRes.data.id;
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name);
        await apiRequest(`/citizen/complaints/${complaintId}/evidence`, {
          method: 'POST',
          body: fd,
        });
      }

      navigate(`/citizen/complaints/${complaintId}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit your complaint.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CitizenLayout
      title="File a complaint"
      subtitle="Report unauthorized transactions to cybercrime investigators and bank nodal officers"
    >
      <div className="space-y-6">
        {/* Reassuring Guidance Banner */}
        <section className="rounded-[12px] border border-border-subtle bg-card p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-accent-strong shrink-0" aria-hidden="true" />
            <p className="text-body">
              Take your time. Filing quickly gives bank nodal desks the best opportunity to freeze fraudulent transfers.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 font-medium text-heading">
            <PhoneCall className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
            <span>National Cybercrime Helpline:</span>
            <strong className="font-mono text-accent-strong">1930</strong>
          </span>
        </section>

        {/* 5-Step Stepper */}
        <nav aria-label="Complaint filing steps" className="rounded-[12px] border border-border-subtle bg-card p-4">
          <ol className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {STEPS.map((label, idx) => {
              const active = idx === step;
              const done = idx < step;
              return (
                <li
                  key={label}
                  className={`flex items-center gap-2 rounded-[8px] border px-3 py-2 text-xs transition-colors duration-120 ${
                    active
                      ? 'border-accent-strong bg-highlight text-heading font-semibold'
                      : done
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-200 font-medium'
                        : 'border-border-subtle bg-subtle text-muted'
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-mono shrink-0">
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
                  </span>
                  <span className="truncate">{label}</span>
                </li>
              );
            })}
          </ol>
        </nav>

        {error ? <ErrorDataState message={error} /> : null}

        <form
          onSubmit={handleSubmit}
          className="rounded-[12px] border border-border-subtle bg-card p-6 space-y-6"
        >
          {/* Step 1: Incident Details */}
          {step === 0 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-heading">Step 1: What happened?</h2>
                <p className="text-xs text-muted mt-0.5">Tell us about the incident and how it took place.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-body mb-1.5">Type of cyber fraud</label>
                  <select
                    value={incidentType}
                    onChange={(e) => setIncidentType(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-2 text-xs text-heading focus:outline-none"
                  >
                    {INCIDENT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1.5">
                    Date and time of incident
                  </label>
                  <input
                    type="datetime-local"
                    value={incidentTimestamp}
                    onChange={(e) => setIncidentTimestamp(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-2 text-xs font-mono text-heading focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1.5">Your city or location</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-2 text-xs text-heading focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-body mb-1.5">
                  Describe what occurred
                </label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain in simple words how the fraud happened (such as phone calls received, links clicked, apps downloaded, or QR codes scanned)..."
                  className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-2 text-xs text-heading placeholder:text-muted focus:outline-none leading-relaxed"
                />
              </div>
            </div>
          ) : null}

          {/* Step 2: Loss & Victim Account */}
          {step === 1 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-heading">Step 2: Financial loss & your bank account</h2>
                <p className="text-xs text-muted mt-0.5">Provide details of the bank account from which funds were debited.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-body mb-1.5">Total amount lost (INR)</label>
                  <input
                    type="number"
                    min={1}
                    value={amountLost}
                    onChange={(e) => setAmountLost(e.target.value)}
                    placeholder="e.g. 85000"
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-2 text-xs font-mono text-heading focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1.5">Your bank name</label>
                  <input
                    type="text"
                    value={victimBankName}
                    onChange={(e) => setVictimBankName(e.target.value)}
                    placeholder="e.g. State Bank of India"
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-2 text-xs text-heading focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1.5">
                    Your debited account number
                  </label>
                  <input
                    type="text"
                    value={victimAccountNumber}
                    onChange={(e) => setVictimAccountNumber(e.target.value)}
                    placeholder="e.g. 309812349981"
                    className="w-full rounded-[8px] border border-border-subtle bg-subtle px-3 py-2 text-xs font-mono text-heading focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-[8px] border border-border-subtle bg-subtle p-3 text-[11px] text-muted flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-heading">Privacy protection:</strong> Your full bank account number is stored securely and shared only with bank nodal officers for verification. Only the last 4 digits are visible in public investigation logs.
                </span>
              </div>
            </div>
          ) : null}

          {/* Step 3: Disputed Transactions */}
          {step === 2 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-heading">Step 3: Disputed transactions</h2>
                  <p className="text-xs text-muted mt-0.5">
                    Add each unauthorized transfer. You can find the UTR or Transaction ID in your banking SMS or app.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addTxnRow}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-3 py-1.5 text-xs font-semibold text-heading hover:bg-highlight cursor-pointer transition-colors duration-120"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add another transaction</span>
                </button>
              </div>

              <div className="space-y-3">
                {disputedTxns.map((tx, idx) => (
                  <div
                    key={idx}
                    className="rounded-[8px] border border-border-subtle bg-subtle p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                      <span className="text-xs font-semibold text-heading">Transaction #{idx + 1}</span>
                      {disputedTxns.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeTxnRow(idx)}
                          className="inline-flex items-center gap-1 text-xs text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Remove</span>
                        </button>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-body mb-1">
                          Transaction ID / UTR
                        </label>
                        <input
                          type="text"
                          value={tx.txnId}
                          onChange={(e) => updateTxnRow(idx, 'txnId', e.target.value)}
                          placeholder="e.g. UTR6102998812"
                          className="w-full rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-mono text-heading focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-body mb-1">Date & time</label>
                        <input
                          type="datetime-local"
                          value={tx.date}
                          onChange={(e) => updateTxnRow(idx, 'date', e.target.value)}
                          className="w-full rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-mono text-heading focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-body mb-1">Amount (INR)</label>
                        <input
                          type="number"
                          min={1}
                          value={tx.amount}
                          onChange={(e) => updateTxnRow(idx, 'amount', e.target.value)}
                          placeholder="45000"
                          className="w-full rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-mono text-heading focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-body mb-1">
                          Beneficiary account / UPI ID
                        </label>
                        <input
                          type="text"
                          value={tx.beneficiaryAccount}
                          onChange={(e) => updateTxnRow(idx, 'beneficiaryAccount', e.target.value)}
                          placeholder="e.g. 998100221104 or user@upi"
                          className="w-full rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-mono text-heading focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-body mb-1">
                          Beneficiary bank name
                        </label>
                        <input
                          type="text"
                          value={tx.beneficiaryBank}
                          onChange={(e) => updateTxnRow(idx, 'beneficiaryBank', e.target.value)}
                          placeholder="e.g. Axis Bank"
                          className="w-full rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs text-heading focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-body mb-1">Transfer channel</label>
                        <select
                          value={tx.channel}
                          onChange={(e) => updateTxnRow(idx, 'channel', e.target.value as any)}
                          className="w-full rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs text-heading focus:outline-none"
                        >
                          <option value="UPI">UPI</option>
                          <option value="IMPS">IMPS</option>
                          <option value="NEFT">NEFT</option>
                          <option value="RTGS">RTGS</option>
                          <option value="CARD">Debit / Credit Card</option>
                          <option value="WALLET">Digital Wallet</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Step 4: Supporting Evidence */}
          {step === 3 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-heading">Step 4: Attach supporting evidence (Optional)</h2>
                <p className="text-xs text-muted mt-0.5">
                  Attach screenshots of debit SMS messages, banking app receipts, or bank statement PDFs.
                </p>
              </div>

              <label className="flex flex-col items-center justify-center rounded-[8px] border-2 border-dashed border-border-subtle bg-subtle/50 p-6 text-center cursor-pointer hover:bg-highlight transition-colors duration-120">
                <Upload className="h-6 w-6 text-accent-strong mb-2" aria-hidden="true" />
                <span className="text-xs font-semibold text-heading">
                  Click to select screenshots or PDF documents
                </span>
                <span className="mt-1 text-[11px] text-muted">PNG, JPG, WEBP, or PDF up to 5 MB each</span>
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={(e) => {
                    const chosen = Array.from(e.target.files ?? []);
                    setFiles((prev) => [...prev, ...chosen]);
                  }}
                  className="sr-only"
                />
              </label>

              {files.length > 0 ? (
                <ul className="divide-y border-border-subtle rounded-[8px] border border-border-subtle bg-subtle">
                  {files.map((f, idx) => (
                    <li key={`${f.name}-${idx}`} className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-accent-strong shrink-0" />
                        <div>
                          <p className="font-medium text-heading">{f.name}</p>
                          <p className="font-mono text-[11px] text-muted">
                            {(f.size / 1024).toFixed(1)} KB · {f.type || 'document'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-xs text-rose-700 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* Step 5: Review & Submit */}
          {step === 4 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-heading">Step 5: Review and submit</h2>
                <p className="text-xs text-muted mt-0.5">Please check all details before sending to the cybercrime response team.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-[8px] border border-border-subtle bg-subtle p-4 text-xs">
                <div>
                  <p className="text-muted">Incident type</p>
                  <p className="font-semibold text-heading mt-0.5">
                    {INCIDENT_OPTIONS.find((o) => o.value === incidentType)?.label ?? incidentType}
                  </p>
                </div>
                <div>
                  <p className="text-muted">Total amount lost</p>
                  <p className="font-mono font-bold text-heading mt-0.5 tabular-nums">
                    {formatInr(Number(amountLost || 0))}
                  </p>
                </div>
                <div>
                  <p className="text-muted">Your bank & account</p>
                  <p className="font-semibold text-heading mt-0.5">
                    {victimBankName} · <span className="font-mono">{maskForPreview(victimAccountNumber)}</span>
                  </p>
                </div>
                <div>
                  <p className="text-muted">Disputed transfers & attachments</p>
                  <p className="font-semibold text-heading mt-0.5">
                    {disputedTxns.length} transaction(s) · {files.length} document(s)
                  </p>
                </div>
                <div className="sm:col-span-2 border-t border-border-subtle pt-2">
                  <p className="text-muted">Description</p>
                  <p className="text-body mt-0.5 leading-relaxed">{description}</p>
                </div>
              </div>

              <div className="rounded-[8px] border border-border-subtle bg-highlight p-3 text-xs text-body leading-relaxed">
                By submitting this complaint, you confirm that the above financial and incident details are accurate. An official FinTrace reference number will be generated immediately for tracking.
              </div>
            </div>
          ) : null}

          {/* Navigation Controls */}
          <div className="flex items-center justify-between border-t border-border-subtle pt-4">
            <button
              type="button"
              disabled={step === 0 || submitting}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-4 py-2 text-xs font-medium text-heading hover:bg-subtle disabled:opacity-40 cursor-pointer transition-colors duration-120"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Previous</span>
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-4 py-2 text-xs font-semibold text-white hover:bg-accent-strong-hover cursor-pointer transition-colors duration-120"
              >
                <span>Continue</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer transition-colors duration-120"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{submitting ? 'Submitting complaint...' : 'Submit official complaint'}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </CitizenLayout>
  );
}
