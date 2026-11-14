import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { env } from '../../config/env.js';
import { recordAuditLog } from '../../middleware/audit.js';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { authorizeOfficer } from '../../middleware/rbac.js';
import { validate, ValidatedRequest } from '../../middleware/validate.js';

const router = Router();

const traceQuerySchema = z.object({
  accountId: z.string().min(4),
  direction: z.enum(['forward', 'reverse', 'both']).default('forward'),
  depth: z.coerce.number().int().min(1).max(6).default(3),
  complaintId: z.string().uuid().optional(),
});

const pathsQuerySchema = z.object({
  sourceAccountId: z.string().uuid(),
  targetAccountId: z.string().uuid().optional(),
  complaintId: z.string().uuid().optional(),
  maxDepth: z.coerce.number().int().min(1).max(8).default(5),
});

const subgraphQuerySchema = z.object({
  direction: z.enum(['forward', 'reverse', 'both']).default('both'),
  depth: z.coerce.number().int().min(1).max(5).default(2),
  complaintId: z.string().uuid().optional(),
});

const muleClustersQuerySchema = z.object({
  minClusterSize: z.coerce.number().int().min(2).max(20).default(2),
  minRiskScore: z.coerce.number().min(0).max(100).default(30),
});

const accountParamSchema = z.object({
  accountId: z.string().min(4),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveAccountUuid(identifier: string): Promise<string> {
  if (uuidRegex.test(identifier)) {
    const res = await query<{ id: string }>('SELECT id FROM bank_accounts WHERE id = $1 LIMIT 1', [
      identifier,
    ]);
    if (res.rows[0]) return res.rows[0].id;
  }
  const byNum = await query<{ id: string }>(
    'SELECT id FROM bank_accounts WHERE account_number = $1 LIMIT 1',
    [identifier]
  );
  if (!byNum.rows[0]) {
    throw new AppError(`Account '${identifier}' not found.`, 404, 'ACCOUNT_NOT_FOUND');
  }
  return byNum.rows[0].id;
}

async function callMlGraphService<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.ML_SERVICE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new AppError(
      `Graph analytics service error (${response.status}): ${errText}`,
      response.status >= 500 ? 502 : response.status,
      'ML_SERVICE_ERROR'
    );
  }
  return (await response.json()) as T;
}

router.use(authenticate, authorizeOfficer);

/**
 * Direct PostgreSQL Recursive CTE multi-hop trace (fast SQL graph traversal).
 */
router.get(
  '/cte-trace',
  validate({ query: traceQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof traceQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const accountUuid = await resolveAccountUuid(q.accountId);

      const cteSql =
        q.direction === 'reverse'
          ? `
        WITH RECURSIVE hop_trace AS (
          SELECT t.txn_id, t.from_account, t.to_account, t.amount, t.timestamp, t.channel,
                 t.complaint_id, t.is_flagged_fraud, 1 AS depth,
                 ARRAY[t.to_account, t.from_account] AS visited
          FROM transactions t
          WHERE t.to_account = $1
            AND ($3::uuid IS NULL OR t.complaint_id = $3)
          UNION ALL
          SELECT t.txn_id, t.from_account, t.to_account, t.amount, t.timestamp, t.channel,
                 t.complaint_id, t.is_flagged_fraud, ht.depth + 1,
                 ht.visited || t.from_account
          FROM transactions t
          JOIN hop_trace ht ON t.to_account = ht.from_account
          WHERE ht.depth < $2
            AND NOT (t.from_account = ANY(ht.visited))
            AND ($3::uuid IS NULL OR t.complaint_id = $3)
        )
        SELECT DISTINCT ht.txn_id, ht.from_account, ht.to_account, ht.amount, ht.timestamp,
               ht.channel, ht.complaint_id, ht.is_flagged_fraud, ht.depth,
               fa.account_number AS from_account_number, fa.holder_name AS from_holder,
               ta.account_number AS to_account_number, ta.holder_name AS to_holder
        FROM hop_trace ht
        JOIN bank_accounts fa ON fa.id = ht.from_account
        JOIN bank_accounts ta ON ta.id = ht.to_account
        ORDER BY ht.depth ASC, ht.timestamp ASC
      `
          : `
        WITH RECURSIVE hop_trace AS (
          SELECT t.txn_id, t.from_account, t.to_account, t.amount, t.timestamp, t.channel,
                 t.complaint_id, t.is_flagged_fraud, 1 AS depth,
                 ARRAY[t.from_account, t.to_account] AS visited
          FROM transactions t
          WHERE t.from_account = $1
            AND ($3::uuid IS NULL OR t.complaint_id = $3)
          UNION ALL
          SELECT t.txn_id, t.from_account, t.to_account, t.amount, t.timestamp, t.channel,
                 t.complaint_id, t.is_flagged_fraud, ht.depth + 1,
                 ht.visited || t.to_account
          FROM transactions t
          JOIN hop_trace ht ON t.from_account = ht.to_account
          WHERE ht.depth < $2
            AND NOT (t.to_account = ANY(ht.visited))
            AND ($3::uuid IS NULL OR t.complaint_id = $3)
        )
        SELECT DISTINCT ht.txn_id, ht.from_account, ht.to_account, ht.amount, ht.timestamp,
               ht.channel, ht.complaint_id, ht.is_flagged_fraud, ht.depth,
               fa.account_number AS from_account_number, fa.holder_name AS from_holder,
               ta.account_number AS to_account_number, ta.holder_name AS to_holder
        FROM hop_trace ht
        JOIN bank_accounts fa ON fa.id = ht.from_account
        JOIN bank_accounts ta ON ta.id = ht.to_account
        ORDER BY ht.depth ASC, ht.timestamp ASC
      `;

      const edgesRes = await query(cteSql, [accountUuid, q.depth, q.complaintId ?? null]);
      res.json({
        success: true,
        engine: 'postgresql-recursive-cte',
        data: {
          rootAccountId: accountUuid,
          direction: q.direction,
          depth: q.depth,
          edges: edgesRes.rows,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Full NetworkX multi-hop graph trace with centrality, velocity, latency & cycle metrics.
 */
router.get(
  '/trace',
  validate({ query: traceQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof traceQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const accountUuid = await resolveAccountUuid(q.accountId);

      const graphData = await callMlGraphService('/graph/trace', {
        method: 'POST',
        body: JSON.stringify({
          account_id: accountUuid,
          direction: q.direction,
          depth: q.depth,
          complaint_id: q.complaintId ?? null,
        }),
      });

      res.json({ success: true, data: graphData });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Full complaint flow graph + snapshot persistence in transaction_networks.
 */
router.get(
  '/complaint/:id',
  validate({ params: uuidParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { id: string }>, res, next) => {
    try {
      const { id } = req.validatedParams!;
      const cmpCheck = await query<{ id: string }>('SELECT id FROM complaints WHERE id = $1 LIMIT 1', [id]);
      if (!cmpCheck.rows[0]) {
        throw new AppError('Complaint not found.', 404, 'COMPLAINT_NOT_FOUND');
      }

      const graphData = await callMlGraphService<{
        nodes: Array<{ id: string }>;
        edges: Array<{ from_account: string }>;
        summary: {
          node_count: number;
          edge_count: number;
          total_amount: number;
          has_cycles: boolean;
        };
      }>(`/graph/complaint/${id}`);

      if (graphData.nodes.length > 0) {
        const rootId = graphData.edges[0]?.from_account ?? graphData.nodes[0].id;
        await query(
          `INSERT INTO transaction_networks (
             complaint_id, root_account_id, max_depth, node_count, edge_count,
             total_traced_amount, has_cycles, metrics_json
           )
           VALUES ($1, $2, 5, $3, $4, $5, $6, $7::jsonb)`,
          [
            id,
            rootId,
            graphData.summary.node_count,
            graphData.summary.edge_count,
            graphData.summary.total_amount,
            graphData.summary.has_cycles,
            JSON.stringify(graphData.summary),
          ]
        );
      }

      await recordAuditLog({
        req,
        action: 'COMPLAINT_GRAPH_TRACED',
        resourceType: 'TRANSACTION_NETWORK',
        resourceId: id,
        statusCode: 200,
      });

      res.json({ success: true, data: graphData });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/paths',
  validate({ query: pathsQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof pathsQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const data = await callMlGraphService('/graph/paths', {
        method: 'POST',
        body: JSON.stringify({
          source_account_id: q.sourceAccountId,
          target_account_id: q.targetAccountId ?? null,
          complaint_id: q.complaintId ?? null,
          max_depth: q.maxDepth,
        }),
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/metrics/:id',
  validate({ params: uuidParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, { id: string }>, res, next) => {
    try {
      const { id } = req.validatedParams!;
      const data = await callMlGraphService(`/graph/metrics/${id}`);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------- PHASE 5: PREVENTION GRAPH INTELLIGENCE & MULE SYNDICATE ENDPOINTS ----------------

/**
 * Enriched account subgraph with risk propagation and intersecting mule syndicate clusters.
 */
router.get(
  '/account/:accountId/subgraph',
  validate({ params: accountParamSchema, query: subgraphQuerySchema }),
  async (
    req: ValidatedRequest<unknown, z.infer<typeof subgraphQuerySchema>, z.infer<typeof accountParamSchema>>,
    res,
    next
  ) => {
    try {
      const { accountId } = req.validatedParams!;
      const q = req.validatedQuery!;
      const accountUuid = await resolveAccountUuid(accountId);

      const data = await callMlGraphService(
        `/graph/account/${accountUuid}/subgraph?depth=${q.depth}&direction=${q.direction}`
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Mule syndicate cluster detection across cycles, fan-out dispersals, and funnel accumulators.
 */
router.get(
  '/mule-clusters',
  validate({ query: muleClustersQuerySchema }),
  async (req: ValidatedRequest<unknown, z.infer<typeof muleClustersQuerySchema>>, res, next) => {
    try {
      const q = req.validatedQuery!;
      const data = await callMlGraphService(
        `/graph/mule-clusters?min_cluster_size=${q.minClusterSize}&min_risk_score=${q.minRiskScore}`
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Graph-derived account intelligence (centrality, distance to fraud, cycle status, counterparties).
 */
router.get(
  '/account/:accountId/intelligence',
  validate({ params: accountParamSchema }),
  async (req: ValidatedRequest<unknown, Record<string, unknown>, z.infer<typeof accountParamSchema>>, res, next) => {
    try {
      const { accountId } = req.validatedParams!;
      const accountUuid = await resolveAccountUuid(accountId);
      const data = await callMlGraphService(`/graph/account/${accountUuid}/graph-intelligence`);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
