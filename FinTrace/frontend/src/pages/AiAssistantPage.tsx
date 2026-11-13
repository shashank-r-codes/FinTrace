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
        <section className="rounded-[6px] border border-amber-500/40 bg-amber-950/20 px-4 py-3 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">Backend Gemini Service Not Configured</p>
            <p className="mt-0.5 text-amber-300/90">
              Set <span className="font-mono">GEMINI_API_KEY</span> in the backend server environment to activate live database-grounded briefings. No placeholder or fabricated responses will be generated.
            </p>
          </div>
        </section>
      ) : null}

      <section className="rounded-[6px] border border-slate-800 bg-[#111827] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Database className="h-4 w-4 text-sky-400" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-white">PostgreSQL Grounding Scope</h2>
            <p className="text-xs text-slate-400">
              Backend retrieves verified case records before querying Gemini ({statusInfo?.model ?? 'gemini-4-hydrogen'}).
            </p>
          </div>
        </div>

        <select
          value={selectedComplaintId}
          onChange={(e) => setSelectedComplaintId(e.target.value)}
          aria-label="Select complaint grounding scope"
          className="rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs text-slate-100 min-w-[260px]"
        >
          <option value="">Global Command Queue (Cross-Case Summary)</option>
          {complaints.map((c) => (
            <option key={c.id} value={c.id}>
              {c.complaint_number} · {c.victim_name}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-[6px] border border-slate-800 bg-[#111827] flex flex-col min-h-[480px]">
        <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-sky-400" aria-hidden="true" />
            <span className="text-sm font-semibold text-white">Investigative Briefing Console</span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Strict DB-Citation Mode
          </span>
        </div>

        <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[520px]">
          {messages.length === 0 ? (
            <div className="py-8 max-w-2xl mx-auto space-y-4">
              <p className="text-xs text-slate-300 text-center">
                Ask questions about traced transactions, mule accounts, SHAP fraud detections, or predicted cash-out ATM windows. Every reply cites stored PostgreSQL IDs.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sending || statusInfo?.configured === false}
                    onClick={() => void submitQuestion(prompt)}
                    className="rounded-[5px] border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-left text-xs text-slate-200 hover:border-sky-600/60 hover:bg-slate-900 disabled:opacity-45 cursor-pointer"
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
                    ? 'border-sky-800/60 bg-sky-950/30 ml-8'
                    : 'border-slate-800 bg-[#0B1120] mr-8'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>{msg.role === 'user' ? 'Investigator Query' : 'FinTrace AI Briefing'}</span>
                  {msg.groundedScope ? (
                    <span className="text-sky-300">Scope: {msg.groundedScope}</span>
                  ) : null}
                </div>
                <div className="text-slate-100 whitespace-pre-wrap leading-relaxed">
                  {msg.text}
                </div>
                {msg.recordCounts ? (
                  <div className="border-t border-slate-800 pt-2 flex flex-wrap gap-3 font-mono text-[10px] text-slate-400 tabular-nums">
                    {Object.entries(msg.recordCounts).map(([k, v]) => (
                      <span key={k}>
                        {k}: <strong className="text-slate-200">{v}</strong>
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
          className="border-t border-slate-800 p-3 flex items-center gap-2 bg-[#0F172A]"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending || statusInfo?.configured === false}
            placeholder="Ask a grounded question about this complaint, mule trail, or ATM forecast..."
            className="flex-1 rounded-[5px] border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || input.trim().length < 3 || statusInfo?.configured === false}
            className="inline-flex items-center gap-1.5 rounded-[5px] bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-45 cursor-pointer"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            {sending ? 'Analyzing...' : 'Query Case'}
          </button>
        </form>
      </section>
    </CommandLayout>
  );
}
