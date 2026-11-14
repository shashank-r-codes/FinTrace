import cytoscape, { Core } from 'cytoscape';
import {
  AlertTriangle,
  Database,
  GitBranch,
  Maximize2,
  Play,
  RefreshCw,
  Route,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../api/client';
import { EmptyDataState, ErrorDataState } from '../components/common/DataState';
import { StatusSignal } from '../components/common/StatusSignal';
import { CommandLayout } from '../components/layout/CommandLayout';
import { useTheme } from '../context/ThemeContext';
import {
  ApiSuccessResponse,
  BankAccountSummary,
  ComplaintSummary,
  CteTraceEdge,
  GraphEdge,
  GraphNode,
  GraphTraceData,
  SuspiciousPathItem,
} from '../types';
import { formatInr, formatTimestamp } from '../utils/formatters';

type TraceMode = 'complaint' | 'account';
type TraceDirection = 'forward' | 'reverse' | 'both';
type LayoutType = 'breadthfirst' | 'cose' | 'circle' | 'grid';

function nodeColor(
  node: GraphNode,
  isRoot: boolean,
  theme: 'light' | 'dark'
): { bg: string; border: string; text: string } {
  if (theme === 'light') {
    if (node.is_frozen) {
      return { bg: '#E2E8F0', border: '#64748B', text: '#172B4D' };
    }
    if (node.suspicious_classification === 'CASH_OUT_CANDIDATE') {
      return { bg: '#FEE2E2', border: '#DC2626', text: '#991B1B' };
    }
    if (node.suspicious_classification === 'SUSPECTED_MULE') {
      return { bg: '#FEF3C7', border: '#D97706', text: '#92400E' };
    }
    if (node.suspicious_classification === 'LAYERING_NODE') {
      return { bg: '#DCEEFF', border: '#3489E8', text: '#172B4D' };
    }
    if (isRoot) {
      return { bg: '#3489E8', border: '#1E40AF', text: '#FFFFFF' };
    }
    return { bg: '#FFFFFF', border: '#64748B', text: '#172B4D' };
  }

  if (node.is_frozen) {
    return { bg: '#334155', border: '#94A3B8', text: '#F8FAFC' };
  }
  if (node.suspicious_classification === 'CASH_OUT_CANDIDATE') {
    return { bg: '#7F1D1D', border: '#EF4444', text: '#F8FAFC' };
  }
  if (node.suspicious_classification === 'SUSPECTED_MULE') {
    return { bg: '#78350F', border: '#F59E0B', text: '#F8FAFC' };
  }
  if (node.suspicious_classification === 'LAYERING_NODE') {
    return { bg: '#0C4A6E', border: '#38BDF8', text: '#F8FAFC' };
  }
  if (isRoot) {
    return { bg: '#1E3A8A', border: '#60A5FA', text: '#F8FAFC' };
  }
  return { bg: '#1E293B', border: '#475569', text: '#F8FAFC' };
}

export function NetworkGraphPage() {
  const { theme } = useTheme();
  const [searchParams] = useSearchParams();
  const initialAccountParam = searchParams.get('accountId') || '';
  const initialComplaintParam = searchParams.get('complaintId') || '';

  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [accounts, setAccounts] = useState<BankAccountSummary[]>([]);

  const [mode, setMode] = useState<TraceMode>(initialAccountParam ? 'account' : 'complaint');
  const [selectedComplaintId, setSelectedComplaintId] = useState<string>(initialComplaintParam);
  const [accountQuery, setAccountQuery] = useState<string>(initialAccountParam);
  const [direction, setDirection] = useState<TraceDirection>('forward');
  const [depth, setDepth] = useState<number>(4);
  const [layoutName, setLayoutName] = useState<LayoutType>('breadthfirst');

  const [graphData, setGraphData] = useState<GraphTraceData | null>(null);
  const [cteEdges, setCteEdges] = useState<CteTraceEdge[] | null>(null);
  const [showCteVerify, setShowCteVerify] = useState(false);

  const [paths, setPaths] = useState<SuspiciousPathItem[]>([]);
  const [highlightedPathIdx, setHighlightedPathIdx] = useState<number | null>(null);
  const [highlightedCycleIdx, setHighlightedCycleIdx] = useState<number | null>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  const [loading, setLoading] = useState(false);
  const [pathsLoading, setPathsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cyContainerRef = useRef<HTMLDivElement | null>(null);
  const cyInstanceRef = useRef<Core | null>(null);

  // Load complaints and accounts selectors
  useEffect(() => {
    Promise.all([
      apiRequest<ApiSuccessResponse<ComplaintSummary[]>>('/complaints?limit=50'),
      apiRequest<ApiSuccessResponse<BankAccountSummary[]>>('/accounts?limit=80'),
    ])
      .then(([cmpRes, accRes]) => {
        setComplaints(cmpRes.data);
        setAccounts(accRes.data);
        if (!initialComplaintParam && cmpRes.data[0] && !selectedComplaintId) {
          setSelectedComplaintId(cmpRes.data[0].id);
        }
        if (!initialAccountParam && accRes.data[0] && !accountQuery) {
          setAccountQuery(accRes.data[0].account_number);
        }
      })
      .catch(() => {
        // Handled by main trace call
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runTrace = useCallback(async () => {
    setError(null);
    setPaths([]);
    setHighlightedPathIdx(null);
    setHighlightedCycleIdx(null);
    setSelectedNode(null);
    setSelectedEdge(null);
    setCteEdges(null);

    if (mode === 'complaint') {
      if (!selectedComplaintId) return;
      setLoading(true);
      try {
        const res = await apiRequest<ApiSuccessResponse<GraphTraceData>>(
          `/graph/complaint/${selectedComplaintId}`
        );
        setGraphData(res.data);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to trace complaint flow.');
      } finally {
        setLoading(false);
      }
    } else {
      if (!accountQuery.trim()) {
        setError('Enter an account number or UUID to run multi-hop trace.');
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({
          accountId: accountQuery.trim(),
          direction,
          depth: String(depth),
        });
        if (selectedComplaintId) {
          params.set('complaintId', selectedComplaintId);
        }
        const [traceRes, cteRes] = await Promise.all([
          apiRequest<ApiSuccessResponse<GraphTraceData>>(`/graph/trace?${params.toString()}`),
          apiRequest<{ success: boolean; data: { edges: CteTraceEdge[] } }>(
            `/graph/cte-trace?${params.toString()}`
          ).catch(() => null),
        ]);
        setGraphData(traceRes.data);
        setCteEdges(cteRes?.data.edges ?? null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to execute multi-hop trace.');
      } finally {
        setLoading(false);
      }
    }
  }, [mode, selectedComplaintId, accountQuery, direction, depth]);

  useEffect(() => {
    if (mode === 'complaint' && selectedComplaintId) {
      void runTrace();
    } else if (mode === 'account' && initialAccountParam) {
      void runTrace();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedComplaintId]);

  const handleFindPaths = async () => {
    const sourceNode =
      selectedNode?.id ||
      graphData?.summary.root_account_id ||
      graphData?.edges[0]?.from_account ||
      graphData?.nodes[0]?.id;

    if (!sourceNode) return;
    setPathsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        sourceAccountId: sourceNode,
        maxDepth: String(Math.max(depth, 4)),
      });
      if (mode === 'complaint' && selectedComplaintId) {
        params.set('complaintId', selectedComplaintId);
      }
      const res = await apiRequest<ApiSuccessResponse<{ paths: SuspiciousPathItem[]; count: number }>>(
        `/graph/paths?${params.toString()}`
      );
      setPaths(res.data.paths);
      setHighlightedPathIdx(res.data.paths.length > 0 ? 0 : null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to compute suspicious paths.');
    } finally {
      setPathsLoading(false);
    }
  };

  // Render Cytoscape graph whenever graphData, layoutName, theme, or highlight changes
  useEffect(() => {
    if (!cyContainerRef.current || !graphData || graphData.nodes.length === 0) {
      if (cyInstanceRef.current) {
        cyInstanceRef.current.destroy();
        cyInstanceRef.current = null;
      }
      return;
    }

    const rootId = graphData.summary.root_account_id ?? graphData.edges[0]?.from_account;
    const highlightedNodeIds = new Set<string>();
    const highlightedTxnIds = new Set<string>();

    if (highlightedPathIdx !== null && paths[highlightedPathIdx]) {
      const p = paths[highlightedPathIdx];
      p.path_ids.forEach((id) => highlightedNodeIds.add(id));
      p.edges.forEach((e) => e.txn_ids.forEach((tid) => highlightedTxnIds.add(tid)));
    } else if (highlightedCycleIdx !== null && graphData.cycles[highlightedCycleIdx]) {
      const cyc = graphData.cycles[highlightedCycleIdx];
      cyc.forEach((id) => highlightedNodeIds.add(id));
      const cycPairs = new Set<string>();
      for (let i = 0; i < cyc.length; i++) {
        cycPairs.add(`${cyc[i]}->${cyc[(i + 1) % cyc.length]}`);
      }
      graphData.edges.forEach((edge) => {
        if (cycPairs.has(`${edge.from_account}->${edge.to_account}`)) {
          highlightedTxnIds.add(edge.txn_id);
        }
      });
    }

    const hasHighlight = highlightedNodeIds.size > 0;
    const highlightStroke = theme === 'light' ? '#D97706' : '#FACC15';
    const flaggedEdgeColor = theme === 'light' ? '#DC2626' : '#EF4444';
    const normalEdgeColor = theme === 'light' ? '#3489E8' : '#38BDF8';
    const edgeTextColor = theme === 'light' ? '#172B4D' : '#CBD5E1';
    const edgeTextBg = theme === 'light' ? '#FFFFFF' : '#0B1120';

    const elements = [
      ...graphData.nodes.map((n) => {
        const colors = nodeColor(n, n.id === rootId, theme);
        const dimmed = hasHighlight && !highlightedNodeIds.has(n.id);
        return {
          data: {
            id: n.id,
            label: `${n.account_number}\n${n.holder_name.split(' ')[0]}`,
            bgColor: colors.bg,
            textColor: colors.text,
            borderColor: highlightedNodeIds.has(n.id) ? highlightStroke : colors.border,
            borderWidth: highlightedNodeIds.has(n.id) || n.id === rootId ? 3 : 2,
            opacity: dimmed ? 0.28 : 1,
            raw: n,
          },
        };
      }),
      ...graphData.edges.map((e) => {
        const isPathEdge = highlightedTxnIds.has(e.txn_id);
        const dimmed = hasHighlight && !isPathEdge;
        return {
          data: {
            id: e.txn_id,
            source: e.from_account,
            target: e.to_account,
            label: `${formatInr(e.amount)} · ${e.channel}`,
            lineColor: isPathEdge
              ? highlightStroke
              : e.is_flagged_fraud
                ? flaggedEdgeColor
                : normalEdgeColor,
            width: isPathEdge ? 3.5 : e.is_flagged_fraud ? 2.5 : 1.8,
            opacity: dimmed ? 0.2 : 0.95,
            raw: e,
          },
        };
      }),
    ];

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'background-color': 'data(bgColor)',
            'border-color': 'data(borderColor)',
            'border-width': 'data(borderWidth)',
            color: 'data(textColor)',
            'font-size': '10px',
            'font-family': 'JetBrains Mono, monospace',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '95px',
            width: 56,
            height: 56,
            opacity: (ele: cytoscape.NodeSingular) => Number(ele.data('opacity') ?? 1),
          },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            'curve-style': 'bezier',
            'control-point-step-size': 42,
            'target-arrow-shape': 'triangle',
            'target-arrow-color': 'data(lineColor)',
            'line-color': 'data(lineColor)',
            width: 'data(width)',
            'font-size': '9px',
            'font-family': 'JetBrains Mono, monospace',
            color: edgeTextColor,
            'text-background-color': edgeTextBg,
            'text-background-opacity': 0.9,
            'text-background-padding': '2px',
            'text-rotation': 'autorotate',
            opacity: (ele: cytoscape.EdgeSingular) => Number(ele.data('opacity') ?? 1),
          },
        },
        {
          selector: ':selected',
          style: {
            'border-color': '#3489E8',
            'border-width': 4,
          },
        },
      ],
      layout:
        layoutName === 'breadthfirst'
          ? {
              name: 'breadthfirst',
              directed: true,
              spacingFactor: 1.45,
              padding: 28,
              roots: rootId ? [rootId] : undefined,
            }
          : layoutName === 'cose'
            ? { name: 'cose', padding: 30, animate: false, nodeRepulsion: () => 8500 }
            : { name: layoutName, padding: 30 },
    });

    cy.on('tap', 'node', (evt) => {
      const nodeRaw = evt.target.data('raw') as GraphNode;
      setSelectedNode(nodeRaw);
      setSelectedEdge(null);
    });

    cy.on('tap', 'edge', (evt) => {
      const edgeRaw = evt.target.data('raw') as GraphEdge;
      setSelectedEdge(edgeRaw);
      setSelectedNode(null);
    });

    cyInstanceRef.current = cy;

    return () => {
      cy.destroy();
      cyInstanceRef.current = null;
    };
  }, [graphData, layoutName, highlightedPathIdx, highlightedCycleIdx, paths, theme]);

  const sortedNodes = useMemo(() => {
    if (!graphData) return [];
    return [...graphData.nodes].sort((a, b) => b.pagerank - a.pagerank);
  }, [graphData]);

  return (
    <CommandLayout
      title="Network flow and multi-hop trace"
      section="Core operations"
      actions={
        <button
          type="button"
          onClick={() => void runTrace()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-strong px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong-hover disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-120"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {loading ? 'Tracing...' : 'Run graph trace'}
        </button>
      }
    >
      {error ? <ErrorDataState message={error} onRetry={() => void runTrace()} /> : null}

      {/* Trace Controls */}
      <section className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-[8px] border border-border-subtle bg-subtle/50 p-0.5">
            <button
              type="button"
              onClick={() => setMode('complaint')}
              className={`rounded-[6px] px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                mode === 'complaint'
                  ? 'bg-card text-heading font-medium shadow-xs border border-border-strong/40'
                  : 'text-muted hover:text-heading'
              }`}
            >
              Complaint flow graph
            </button>
            <button
              type="button"
              onClick={() => setMode('account')}
              className={`rounded-[6px] px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                mode === 'account'
                  ? 'bg-card text-heading font-medium shadow-xs border border-border-strong/40'
                  : 'text-muted hover:text-heading'
              }`}
            >
              Account multi-hop trace
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleFindPaths()}
              disabled={!graphData || graphData.nodes.length === 0 || pathsLoading}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-medium text-heading hover:bg-subtle disabled:opacity-40 cursor-pointer transition-colors"
            >
              <Route className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
              {pathsLoading ? 'Finding paths...' : 'Detect suspicious paths'}
            </button>
            {mode === 'account' ? (
              <button
                type="button"
                onClick={() => setShowCteVerify((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-border-subtle bg-card px-2.5 py-1.5 text-xs font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
              >
                <Database className="h-3.5 w-3.5 text-accent-strong" aria-hidden="true" />
                {showCteVerify ? 'Hide SQL CTE' : 'SQL CTE cross-check'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {mode === 'complaint' ? (
            <div className="lg:col-span-3">
              <label className="block text-[11px] font-medium text-muted mb-1">
                Select complaint
              </label>
              <select
                value={selectedComplaintId}
                onChange={(e) => setSelectedComplaintId(e.target.value)}
                className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
              >
                {complaints.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.complaint_number} · {c.victim_name} ({formatInr(c.reported_amount)})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-medium text-muted mb-1">
                  Root account (number or UUID)
                </label>
                <datalist id="graph-accounts-list">
                  {accounts.map((a) => (
                    <option key={a.id} value={a.account_number}>
                      {a.holder_name} · {a.bank_code}
                    </option>
                  ))}
                </datalist>
                <input
                  type="text"
                  list="graph-accounts-list"
                  value={accountQuery}
                  onChange={(e) => setAccountQuery(e.target.value)}
                  placeholder="e.g. SYNVICT00001 or UUID"
                  className="w-full rounded-[8px] border border-border-subtle bg-app px-3 py-1.5 text-xs font-mono text-heading focus:border-accent-strong focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">
                  Direction
                </label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as TraceDirection)}
                  className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
                >
                  <option value="forward">Forward (Money flow)</option>
                  <option value="reverse">Reverse (Funding origin)</option>
                  <option value="both">Bidirectional (Both)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">
                  Hop depth (1–6)
                </label>
                <select
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs font-mono text-heading focus:border-accent-strong focus:outline-none transition-colors"
                >
                  {[1, 2, 3, 4, 5, 6].map((d) => (
                    <option key={d} value={d}>
                      {d} Hops
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-[11px] font-medium text-muted mb-1">
              Graph layout
            </label>
            <select
              value={layoutName}
              onChange={(e) => setLayoutName(e.target.value as LayoutType)}
              className="w-full rounded-[8px] border border-border-subtle bg-app px-2.5 py-1.5 text-xs text-heading focus:border-accent-strong focus:outline-none transition-colors"
            >
              <option value="breadthfirst">Layered DAG (Breadthfirst)</option>
              <option value="cose">Force-directed (CoSE)</option>
              <option value="circle">Circular</option>
              <option value="grid">Grid</option>
            </select>
          </div>
        </div>
      </section>

      {/* Main Graph Canvas + Metrics Inspector */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 rounded-[12px] border border-border-subtle bg-card flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-subtle/50 px-4 py-2.5">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium text-heading">Account flow canvas</span>
              {graphData ? (
                <span className="font-mono text-[11px] text-muted tabular-nums">
                  {graphData.summary.node_count} nodes · {graphData.summary.edge_count} ledger edges ·{' '}
                  {formatInr(graphData.summary.total_amount)}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => cyInstanceRef.current?.zoom(cyInstanceRef.current.zoom() * 1.2)}
                className="rounded-[6px] p-1.5 text-muted hover:bg-subtle hover:text-heading cursor-pointer transition-colors"
                title="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => cyInstanceRef.current?.zoom(cyInstanceRef.current.zoom() * 0.8)}
                className="rounded-[6px] p-1.5 text-muted hover:bg-subtle hover:text-heading cursor-pointer transition-colors"
                title="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => cyInstanceRef.current?.fit(undefined, 28)}
                className="rounded-[6px] p-1.5 text-muted hover:bg-subtle hover:text-heading cursor-pointer transition-colors"
                title="Fit graph"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              {(highlightedPathIdx !== null || highlightedCycleIdx !== null) ? (
                <button
                  type="button"
                  onClick={() => {
                    setHighlightedPathIdx(null);
                    setHighlightedCycleIdx(null);
                  }}
                  className="ml-1 inline-flex items-center gap-1 rounded-[6px] border border-border-subtle bg-card px-2 py-1 text-[11px] font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  Clear highlight
                </button>
              ) : null}
            </div>
          </div>

          <div className="relative h-[460px] bg-app">
            {loading ? (
              <div className="flex h-full items-center justify-center font-mono text-xs text-muted">
                Building NetworkX subgraph from database ledger...
              </div>
            ) : !graphData || graphData.nodes.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyDataState
                  title="No graph edges found"
                  description="No transactions matched this complaint or account trace query."
                />
              </div>
            ) : (
              <div ref={cyContainerRef} className="h-full w-full" />
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 border-t border-border-subtle bg-subtle/50 px-4 py-2 text-[11px] text-body">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] border border-[#DC2626] bg-[#FEE2E2] dark:border-red-500 dark:bg-red-950" />
              Cash-out candidate
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] border border-[#D97706] bg-[#FEF3C7] dark:border-amber-500 dark:bg-amber-950" />
              Suspected mule
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] border border-[#3489E8] bg-[#DCEEFF] dark:border-sky-400 dark:bg-sky-950" />
              Layering node
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px] border border-slate-500 bg-slate-200 dark:border-slate-400 dark:bg-slate-700" />
              Frozen account
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted">
              Every edge maps 1:1 to a database transaction row
            </span>
          </div>
        </div>

        {/* Right Inspector Panel */}
        <div className="xl:col-span-4 space-y-4">
          {/* Selected Node or Edge */}
          <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-border-subtle pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {selectedNode
                  ? 'Node metrics inspector'
                  : selectedEdge
                    ? 'Transaction edge inspector'
                    : 'Network topology summary'}
              </h2>
              {selectedNode ? (
                <StatusSignal
                  level={
                    selectedNode.is_frozen
                      ? 'FROZEN'
                      : selectedNode.suspicious_classification ?? 'MEDIUM'
                  }
                />
              ) : null}
            </div>

            {selectedNode ? (
              <div className="space-y-3 text-xs">
                <div>
                  <p className="font-mono text-sm font-semibold text-heading">{selectedNode.account_number}</p>
                  <p className="text-body">
                    {selectedNode.holder_name} · {selectedNode.branch_city} ({selectedNode.account_type})
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
                  <div className="rounded-[8px] border border-border-subtle bg-subtle/40 p-2">
                    <p className="text-muted">Inflow / outflow</p>
                    <p className="text-heading mt-0.5">
                      {formatInr(selectedNode.total_inflow)} / {formatInr(selectedNode.total_outflow)}
                    </p>
                  </div>
                  <div className="rounded-[8px] border border-border-subtle bg-subtle/40 p-2">
                    <p className="text-muted">Pass-through ratio</p>
                    <p className="text-amber-700 dark:text-amber-300 mt-0.5">
                      {selectedNode.pass_through_ratio !== null
                        ? `${(selectedNode.pass_through_ratio * 100).toFixed(1)}%`
                        : '—'}
                    </p>
                  </div>
                  <div className="rounded-[8px] border border-border-subtle bg-subtle/40 p-2">
                    <p className="text-muted">Avg fwd latency</p>
                    <p className="text-accent-strong mt-0.5">
                      {selectedNode.avg_forward_latency_sec !== null
                        ? `${selectedNode.avg_forward_latency_sec}s`
                        : '—'}
                    </p>
                  </div>
                  <div className="rounded-[8px] border border-border-subtle bg-subtle/40 p-2">
                    <p className="text-muted">1h Velocity / fan</p>
                    <p className="text-heading mt-0.5">
                      {selectedNode.velocity_1h} tx/h · {selectedNode.fan_in}→{selectedNode.fan_out}
                    </p>
                  </div>
                  <div className="rounded-[8px] border border-border-subtle bg-subtle/40 p-2">
                    <p className="text-muted">PageRank</p>
                    <p className="text-heading mt-0.5">{selectedNode.pagerank.toFixed(4)}</p>
                  </div>
                  <div className="rounded-[8px] border border-border-subtle bg-subtle/40 p-2">
                    <p className="text-muted">Betweenness</p>
                    <p className="text-heading mt-0.5">
                      {selectedNode.betweenness_centrality.toFixed(4)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('account');
                      setAccountQuery(selectedNode.account_number);
                      setDirection('forward');
                    }}
                    className="rounded-[8px] border border-border-subtle bg-card px-2.5 py-1 text-[11px] font-medium text-heading hover:bg-subtle cursor-pointer transition-colors"
                  >
                    Set as trace root
                  </button>
                  <Link
                    to={`/fraud-ml?accountId=${encodeURIComponent(selectedNode.id)}`}
                    className="rounded-[8px] bg-accent-strong px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-strong-hover transition-colors"
                  >
                    Score in ML engine
                  </Link>
                </div>
              </div>
            ) : selectedEdge ? (
              <div className="space-y-2 text-xs">
                <p className="font-mono font-medium text-accent-strong">{selectedEdge.txn_id}</p>
                <p className="font-mono text-heading text-sm tabular-nums">
                  {formatInr(selectedEdge.amount)} · {selectedEdge.channel}
                </p>
                <p className="font-mono text-[11px] text-muted tabular-nums">
                  {formatTimestamp(selectedEdge.timestamp)} · Hop {selectedEdge.hop_depth ?? '—'}
                </p>
                <StatusSignal
                  level={selectedEdge.is_flagged_fraud ? 'CRITICAL' : 'LOW'}
                  label={selectedEdge.is_flagged_fraud ? 'Flagged fraud edge' : 'Normal edge'}
                />
              </div>
            ) : (
              <div className="space-y-2 text-xs text-muted">
                <p>Click any account node or transaction arrow on the canvas to inspect centrality, latency, and pass-through metrics.</p>
                {sortedNodes[0] ? (
                  <div className="rounded-[8px] border border-border-subtle bg-subtle/40 p-2.5">
                    <p className="text-[11px] text-muted">Highest PageRank node</p>
                    <p className="font-mono text-xs font-medium text-heading mt-0.5">
                      {sortedNodes[0].account_number} · {sortedNodes[0].holder_name}
                    </p>
                    <p className="font-mono text-[11px] text-accent-strong tabular-nums">
                      PageRank {sortedNodes[0].pagerank.toFixed(4)} · Pass-through{' '}
                      {sortedNodes[0].pass_through_ratio !== null
                        ? `${(sortedNodes[0].pass_through_ratio * 100).toFixed(0)}%`
                        : '—'}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Cycles & Layering Detection */}
          <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <AlertTriangle
                  className={`h-4 w-4 ${graphData?.summary.has_cycles ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}
                  aria-hidden="true"
                />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Layering cycles ({graphData?.cycles.length ?? 0})
                </h3>
              </div>
            </div>

            {!graphData || graphData.cycles.length === 0 ? (
              <p className="text-xs text-muted">No closed money-laundering loops detected in current subgraph.</p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {graphData.cycles.map((cyc, idx) => {
                  const labels = cyc.map(
                    (id) => graphData.nodes.find((n) => n.id === id)?.account_number ?? id.slice(0, 8)
                  );
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setHighlightedPathIdx(null);
                        setHighlightedCycleIdx(highlightedCycleIdx === idx ? null : idx);
                      }}
                      className={`w-full rounded-[6px] border px-2.5 py-1.5 text-left font-mono text-[11px] cursor-pointer transition-colors ${
                        highlightedCycleIdx === idx
                          ? 'border-accent-strong/40 bg-accent-strong/10 text-heading'
                          : 'border-border-subtle bg-subtle/50 text-body hover:bg-highlight'
                      }`}
                    >
                      {labels.join(' → ')} → {labels[0]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Suspicious Paths */}
          {paths.length > 0 ? (
            <div className="rounded-[12px] border border-border-subtle bg-card p-4 space-y-2.5">
              <div className="flex items-center gap-1.5">
                <GitBranch className="h-4 w-4 text-accent-strong" aria-hidden="true" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Suspicious flow paths ({paths.length})
                </h3>
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {paths.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setHighlightedCycleIdx(null);
                      setHighlightedPathIdx(highlightedPathIdx === idx ? null : idx);
                    }}
                    className={`w-full rounded-[6px] border px-2.5 py-2 text-left cursor-pointer transition-colors ${
                      highlightedPathIdx === idx
                        ? 'border-accent-strong/40 bg-accent-strong/10'
                        : 'border-border-subtle bg-subtle/50 hover:bg-highlight'
                    }`}
                  >
                    <p className="font-mono text-[11px] text-heading break-all">
                      {p.path_account_numbers.join(' → ')}
                    </p>
                    <p className="font-mono text-[10px] text-muted mt-0.5 tabular-nums">
                      {p.hop_count} hops · Bottleneck {formatInr(p.bottleneck_amount)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* SQL Recursive CTE Verification Drawer */}
      {showCteVerify && cteEdges ? (
        <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
          <div className="border-b border-border-subtle bg-subtle/50 px-4 py-2.5 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Database recursive CTE verification ({cteEdges.length} hop edges)
            </h2>
            <span className="font-mono text-[11px] text-accent-strong">engine: postgresql-recursive-cte</span>
          </div>
          <div className="overflow-x-auto max-h-60">
            <table className="w-full text-left text-xs">
              <thead className="bg-highlight/40 text-[11px] font-medium uppercase tracking-wider text-muted border-b border-border-subtle">
                <tr>
                  <th className="px-4 py-2">Depth</th>
                  <th className="px-4 py-2">TXN ID</th>
                  <th className="px-4 py-2">From → To</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle font-mono text-[11px]">
                {cteEdges.map((edge) => (
                  <tr key={`${edge.txn_id}-${edge.depth}`} className="hover:bg-subtle/60 transition-colors duration-120">
                    <td className="px-4 py-2 text-muted">Hop {edge.depth}</td>
                    <td className="px-4 py-2 text-accent-strong">{edge.txn_id}</td>
                    <td className="px-4 py-2 text-heading">
                      {edge.from_account_number} → {edge.to_account_number}
                    </td>
                    <td className="px-4 py-2 text-right text-heading tabular-nums">
                      {formatInr(edge.amount)}
                    </td>
                    <td className="px-4 py-2 text-muted tabular-nums">
                      {formatTimestamp(edge.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Chronological Transaction Timeline */}
      {graphData && graphData.timeline.length > 0 ? (
        <section className="rounded-[12px] border border-border-subtle bg-card overflow-hidden">
          <div className="border-b border-border-subtle bg-subtle/50 px-4 py-3 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Chronological transaction timeline</h2>
              <p className="text-[11px] text-muted">
                Ordered hop sequence showing inter-hop receive-and-forward latency
              </p>
            </div>
            <span className="font-mono text-xs text-muted tabular-nums">
              {graphData.timeline.length} events
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border-subtle bg-highlight/40 text-[11px] font-medium uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5 text-right">Δ Prev</th>
                  <th className="px-4 py-2.5">TXN ID</th>
                  <th className="px-4 py-2.5">Source → Destination</th>
                  <th className="px-4 py-2.5">Rail</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {graphData.timeline.map((item) => (
                  <tr key={item.txn_id} className="hover:bg-subtle/60 transition-colors duration-120">
                    <td className="px-4 py-2.5 font-mono text-heading tabular-nums whitespace-nowrap">
                      {formatTimestamp(item.timestamp)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-muted tabular-nums whitespace-nowrap">
                      +{item.delta_from_prev_sec}s
                    </td>
                    <td className="px-4 py-2.5 font-mono text-accent-strong whitespace-nowrap">
                      {item.txn_id}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-heading">{item.from_account_number}</span>
                      <span className="mx-1.5 text-muted">→</span>
                      <span className="font-mono text-heading">{item.to_account_number}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-body">
                      {item.channel} · Hop {item.hop_depth ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-medium text-heading tabular-nums whitespace-nowrap">
                      {formatInr(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </CommandLayout>
  );
}
