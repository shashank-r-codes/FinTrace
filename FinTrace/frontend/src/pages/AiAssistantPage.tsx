import { AlertTriangle, Bot, Database, Send, ShieldCheck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/client';
import { ErrorDataState } from '../components/common/DataState';
import { CommandLayout } from '../components/layout/CommandLayout';
import {
  ApiSuccessResponse,
  AssistantQueryResponse,
  AssistantStatus,
  ComplaintSummary,
} from '../types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  groundedScope?: string;
  recordCounts?: Record<string, number>;
  model?: string;
}

const SUGGESTED_PROMPTS = [
  'Summarize the highest-risk ATM cash-out predictions, time windows, and score provenance.',
  'Identify suspected mule accounts, their freeze status, and money pass-through trails.',
  'List all open early warning alerts and recommended next actions for investigators.',
];

export function AiAssistantPage() {
  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [selectedComplaintId, setSelectedComplaintId] = useState<string>('');
  const [statusInfo, setStatusInfo] = useState<AssistantStatus | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<ApiSuccessResponse<ComplaintSummary[]>>('/complaints?limit=50'),
      apiRequest<ApiSuccessResponse<AssistantStatus>>('/assistant/status'),
    ])
      .then(([cmpRes, statusRes]) => {
        setComplaints(cmpRes.data);
        if (cmpRes.data[0]) {
          setSelectedComplaintId(cmpRes.data[0].id);
        }
        setStatusInfo(statusRes.data);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load assistant workspace.');
      });
  }, []);

  const submitQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (trimmed.length < 3 || sending) return;

    const userMsg: ChatMessage = {
      id: `${Date.now()}-u`,
      role: 'user',
      text: trimmed,
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const res = await apiRequest<ApiSuccessResponse<AssistantQueryResponse>>('/assistant/query', {
        method: 'POST',
        body: {
          question: trimmed,
          complaintId: selectedComplaintId || undefined,
          history: nextHistory.slice(-6).map((m) => ({ role: m.role, text: m.text })),
        },
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-a`,
          role: 'assistant',
          text: res.data.answer,
          groundedScope: res.data.groundedScope,
          recordCounts: res.data.recordCounts,
          model: res.data.model,
        },
      ]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Investigative AI assistant request failed.'
      );
    } finally {
      setSending(false);
    }
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitQuestion(input);
  };

  return (
    <CommandLayout title="AI Case Assistant" section="Governance & AI">
      {error ? <ErrorDataState message={error} /> : null}

      {statusInfo && !statusInfo.configured ? (
        <section className="rounded-[6px] border border-amber-300 bg-[#FEF3C7] px-4 py-3 flex items-start gap-2.5 text-xs text-[#92400E] dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">Backend Gemini Service Not Configured</p>
            <p className="mt-0.5 opacity-90">
              Set <span className="font-mono">GEMINI_API_KEY</span> in the backend server environment to activate live database-grounded briefings. No placeholder or fabricated responses will be generated.
            </p>
          </div>
        </section>
      ) : null}

      <section className="rounded-[6px] border border-border-subtle bg-grad-ai p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Database className="h-4 w-4 text-accent-strong" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-heading">PostgreSQL Grounding Scope</h2>
            <p className="text-xs text-body">
              Backend retrieves verified case records before querying Gemini ({statusInfo?.model ?? 'gemini-4-hydrogen'}).
            </p>
          </div>
        </div>

        <select
          value={selectedComplaintId}
          onChange={(e) => setSelectedComplaintId(e.target.value)}
          aria-label="Select complaint grounding scope"
          className="rounded-[5px] border border-border-subtle bg-card px-3 py-1.5 text-xs text-heading min-w-[260px]"
        >
          <option value="">Global Command Queue (Cross-Case Summary)</option>
          {complaints.map((c) => (
            <option key={c.id} value={c.id}>
              {c.complaint_number} · {c.victim_name}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-[6px] border border-border-subtle bg-card flex flex-col min-h-[480px] overflow-hidden">
        <div className="border-b border-border-subtle bg-grad-ai px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-accent-strong" aria-hidden="true" />
            <span className="text-sm font-semibold text-heading">Investigative Briefing Console</span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-[#065F46] dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Strict DB-Citation Mode
          </span>
        </div>

        <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[520px]">
          {messages.length === 0 ? (
            <div className="py-8 max-w-2xl mx-auto space-y-4">
              <p className="text-xs text-body text-center">
                Ask questions about traced transactions, mule accounts, SHAP fraud detections, or predicted cash-out ATM windows. Every reply cites stored PostgreSQL IDs.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sending || statusInfo?.configured === false}
                    onClick={() => void submitQuestion(prompt)}
                    className="rounded-[5px] border border-border-subtle bg-subtle px-3.5 py-2.5 text-left text-xs text-heading hover:border-accent-strong hover:bg-highlight disabled:opacity-45 cursor-pointer"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-[6px] border p-3.5 text-xs space-y-2 ${
                  msg.role === 'user'
                    ? 'border-accent-strong/40 bg-highlight ml-8'
                    : 'border-border-subtle bg-ai/50 dark:bg-subtle mr-8'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-mono text-muted">
                  <span>{msg.role === 'user' ? 'Investigator Query' : 'FinTrace AI Briefing'}</span>
                  {msg.groundedScope ? (
                    <span className="text-accent-strong font-semibold">
                      Scope: {msg.groundedScope}
                    </span>
                  ) : null}
                </div>
                <div className="text-heading whitespace-pre-wrap leading-relaxed">
                  {msg.text}
                </div>
                {msg.recordCounts ? (
                  <div className="border-t border-border-subtle pt-2 flex flex-wrap gap-3 font-mono text-[10px] text-muted tabular-nums">
                    {Object.entries(msg.recordCounts).map(([k, v]) => (
                      <span key={k}>
                        {k}: <strong className="text-heading">{v}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={handleFormSubmit}
          className="border-t border-border-subtle p-3 flex items-center gap-2 bg-subtle"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending || statusInfo?.configured === false}
            placeholder="Ask a grounded question about this complaint, mule trail, or ATM forecast..."
            className="flex-1 rounded-[5px] border border-border-subtle bg-card px-3 py-2 text-xs text-heading placeholder:text-muted focus:border-accent-strong focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || input.trim().length < 3 || statusInfo?.configured === false}
            className="inline-flex items-center gap-1.5 rounded-[5px] bg-accent-strong px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-45 cursor-pointer"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            {sending ? 'Analyzing...' : 'Query Case'}
          </button>
        </form>
      </section>
    </CommandLayout>
  );
}
