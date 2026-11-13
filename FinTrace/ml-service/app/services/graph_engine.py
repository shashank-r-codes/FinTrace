from __future__ import annotations

from collections import deque
from datetime import datetime
from typing import Any
import networkx as nx
from app.db import fetch_all, fetch_one


def _parse_ts(val: Any) -> datetime:
    if isinstance(val, datetime):
        return val
    return datetime.fromisoformat(str(val).replace("Z", "+00:00"))


def compute_receive_and_forward_latency(
    inflows: list[dict[str, Any]],
    outflows: list[dict[str, Any]],
) -> tuple[float | None, float | None]:
    """
    Computes (avg_latency_sec, min_latency_sec) between each outflow and the most recent
    preceding inflow on the same account. Returns (None, None) if no causal pair exists.
    """
    if not inflows or not outflows:
        return None, None

    in_times = sorted(_parse_ts(tx["timestamp"]) for tx in inflows)
    out_times = sorted(_parse_ts(tx["timestamp"]) for tx in outflows)

    latencies: list[float] = []
    for ot in out_times:
        preceding = [it for it in in_times if it <= ot]
        if preceding:
            delta = (ot - preceding[-1]).total_seconds()
            latencies.append(max(0.0, delta))

    if not latencies:
        return None, None
    return round(sum(latencies) / len(latencies), 2), round(min(latencies), 2)


def compute_max_1h_velocity(txs: list[dict[str, Any]]) -> int:
    """Sliding 3600-second window max transaction count for an account."""
    if not txs:
        return 0
    times = sorted(_parse_ts(tx["timestamp"]).timestamp() for tx in txs)
    best = 0
    left = 0
    for right in range(len(times)):
        while times[right] - times[left] > 3600:
            left += 1
        best = max(best, right - left + 1)
    return best


def build_networkx_graph(
    accounts_rows: list[dict[str, Any]],
    tx_rows: list[dict[str, Any]],
    suspicious_rows: list[dict[str, Any]],
) -> tuple[nx.MultiDiGraph, nx.DiGraph]:
    """
    Constructs both a MultiDiGraph (every real DB transaction edge preserved)
    and a simple aggregated DiGraph (for PageRank, betweenness, and cycles).
    """
    susp_map: dict[str, dict[str, Any]] = {}
    for sa in suspicious_rows:
        acc_id = str(sa["account_id"])
        existing = susp_map.get(acc_id)
        prob = float(sa["mule_probability"]) if sa.get("mule_probability") is not None else 0.0
        if not existing or prob >= float(existing.get("mule_probability") or 0.0):
            susp_map[acc_id] = sa

    mg = nx.MultiDiGraph()
    dg = nx.DiGraph()

    for acc in accounts_rows:
        acc_id = str(acc["id"])
        sa = susp_map.get(acc_id)
        node_attrs = {
            "id": acc_id,
            "account_number": acc["account_number"],
            "holder_name": acc["holder_name"],
            "account_type": acc["account_type"],
            "branch_city": acc["branch_city"],
            "is_frozen": bool(acc["is_frozen"]),
            "suspicious_classification": sa["classification"] if sa else None,
            "mule_probability": float(sa["mule_probability"]) if sa and sa.get("mule_probability") is not None else None,
        }
        mg.add_node(acc_id, **node_attrs)
        dg.add_node(acc_id, **node_attrs)

    for tx in tx_rows:
        u = str(tx["from_account"])
        v = str(tx["to_account"])
        amt = float(tx["amount"])
        ts_str = _parse_ts(tx["timestamp"]).isoformat()

        mg.add_edge(
            u,
            v,
            key=tx["txn_id"],
            txn_id=tx["txn_id"],
            amount=amt,
            timestamp=ts_str,
            channel=tx["channel"],
            complaint_id=str(tx["complaint_id"]) if tx.get("complaint_id") else None,
            hop_depth=tx.get("hop_depth"),
            is_flagged_fraud=bool(tx.get("is_flagged_fraud")),
        )

        if dg.has_edge(u, v):
            dg[u][v]["weight"] += amt
            dg[u][v]["count"] += 1
        else:
            dg.add_edge(u, v, weight=amt, count=1)

    return mg, dg


def analyze_subgraph(
    mg: nx.MultiDiGraph,
    dg: nx.DiGraph,
    tx_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Computes node-level graph metrics, centrality, cycles, and chronological timeline."""
    if dg.number_of_nodes() == 0:
        return {
            "nodes": [],
            "edges": [],
            "timeline": [],
            "cycles": [],
            "summary": {
                "node_count": 0,
                "edge_count": 0,
                "total_amount": 0.0,
                "has_cycles": False,
                "cycle_count": 0,
            },
        }

    try:
        pagerank_scores = nx.pagerank(dg, weight="weight") if dg.number_of_edges() > 0 else {n: 0.0 for n in dg.nodes}
    except Exception:
        pagerank_scores = {n: 0.0 for n in dg.nodes}

    try:
        betweenness = nx.betweenness_centrality(dg, normalized=True) if dg.number_of_nodes() > 2 else {n: 0.0 for n in dg.nodes}
    except Exception:
        betweenness = {n: 0.0 for n in dg.nodes}

    # Bound cycle detection to avoid combinatorial explosion on dense graphs
    cycles: list[list[str]] = []
    for idx, cyc in enumerate(nx.simple_cycles(dg)):
        if idx >= 15:
            break
        if len(cyc) <= 6:
            cycles.append(cyc)

    inflows_by_acc: dict[str, list[dict[str, Any]]] = {n: [] for n in dg.nodes}
    outflows_by_acc: dict[str, list[dict[str, Any]]] = {n: [] for n in dg.nodes}
    for tx in tx_rows:
        u = str(tx["from_account"])
        v = str(tx["to_account"])
        if u in outflows_by_acc:
            outflows_by_acc[u].append(tx)
        if v in inflows_by_acc:
            inflows_by_acc[v].append(tx)

    nodes_out: list[dict[str, Any]] = []
    for node_id, attrs in dg.nodes(data=True):
        ins = inflows_by_acc.get(node_id, [])
        outs = outflows_by_acc.get(node_id, [])
        total_in = round(sum(float(t["amount"]) for t in ins), 2)
        total_out = round(sum(float(t["amount"]) for t in outs), 2)
        pass_through = round(total_out / total_in, 4) if total_in > 0 else None
        avg_lat, min_lat = compute_receive_and_forward_latency(ins, outs)
        velocity_1h = compute_max_1h_velocity(ins + outs)

        nodes_out.append(
            {
                "id": node_id,
                "account_number": attrs.get("account_number", node_id),
                "holder_name": attrs.get("holder_name", "Unknown"),
                "account_type": attrs.get("account_type", "SAVINGS"),
                "branch_city": attrs.get("branch_city", "Unknown"),
                "is_frozen": bool(attrs.get("is_frozen", False)),
                "suspicious_classification": attrs.get("suspicious_classification"),
                "mule_probability": attrs.get("mule_probability"),
                "in_degree": len(ins),
                "out_degree": len(outs),
                "fan_in": dg.in_degree(node_id),
                "fan_out": dg.out_degree(node_id),
                "total_inflow": total_in,
                "total_outflow": total_out,
                "pass_through_ratio": pass_through,
                "avg_forward_latency_sec": avg_lat,
                "min_forward_latency_sec": min_lat,
                "velocity_1h": velocity_1h,
                "pagerank": round(float(pagerank_scores.get(node_id, 0.0)), 6),
                "betweenness_centrality": round(float(betweenness.get(node_id, 0.0)), 6),
            }
        )

    edges_out: list[dict[str, Any]] = []
    for u, v, data in mg.edges(data=True):
        edges_out.append(
            {
                "txn_id": data["txn_id"],
                "from_account": u,
                "to_account": v,
                "amount": data["amount"],
                "timestamp": data["timestamp"],
                "channel": data["channel"],
                "complaint_id": data.get("complaint_id"),
                "hop_depth": data.get("hop_depth"),
                "is_flagged_fraud": data.get("is_flagged_fraud", False),
            }
        )

    node_lookup = {n["id"]: n for n in nodes_out}
    sorted_txs = sorted(tx_rows, key=lambda x: _parse_ts(x["timestamp"]))
    timeline: list[dict[str, Any]] = []
    prev_ts: datetime | None = None
    for tx in sorted_txs:
        cur_ts = _parse_ts(tx["timestamp"])
        delta_sec = round((cur_ts - prev_ts).total_seconds(), 1) if prev_ts else 0.0
        prev_ts = cur_ts
        u = str(tx["from_account"])
        v = str(tx["to_account"])
        timeline.append(
            {
                "txn_id": tx["txn_id"],
                "timestamp": cur_ts.isoformat(),
                "delta_from_prev_sec": delta_sec,
                "from_account": u,
                "from_account_number": node_lookup.get(u, {}).get("account_number", u),
                "from_holder": node_lookup.get(u, {}).get("holder_name", ""),
                "to_account": v,
                "to_account_number": node_lookup.get(v, {}).get("account_number", v),
                "to_holder": node_lookup.get(v, {}).get("holder_name", ""),
                "amount": float(tx["amount"]),
                "channel": tx["channel"],
                "hop_depth": tx.get("hop_depth"),
                "is_flagged_fraud": bool(tx.get("is_flagged_fraud")),
            }
        )

    total_amount = round(sum(float(t["amount"]) for t in tx_rows), 2)
    return {
        "nodes": nodes_out,
        "edges": edges_out,
        "timeline": timeline,
        "cycles": cycles,
        "summary": {
            "node_count": len(nodes_out),
            "edge_count": len(edges_out),
            "total_amount": total_amount,
            "has_cycles": len(cycles) > 0,
            "cycle_count": len(cycles),
        },
    }


def trace_from_db(
    account_id: str,
    direction: str = "forward",
    depth: int = 3,
    complaint_id: str | None = None,
) -> dict[str, Any]:
    """
    Loads real transactions from PostgreSQL and performs BFS traversal up to `depth` hops
    in forward, reverse, or both directions. Every returned edge is a real DB row.
    """
    if complaint_id:
        tx_rows = fetch_all(
            """
            SELECT txn_id, from_account, to_account, amount, timestamp, channel,
                   complaint_id, hop_depth, is_flagged_fraud
            FROM transactions
            WHERE complaint_id = %s
            ORDER BY timestamp ASC
            """,
            (complaint_id,),
        )
    else:
        tx_rows = fetch_all(
            """
            SELECT txn_id, from_account, to_account, amount, timestamp, channel,
                   complaint_id, hop_depth, is_flagged_fraud
            FROM transactions
            ORDER BY timestamp ASC
            """
        )

    forward_adj: dict[str, list[dict[str, Any]]] = {}
    reverse_adj: dict[str, list[dict[str, Any]]] = {}
    for tx in tx_rows:
        u = str(tx["from_account"])
        v = str(tx["to_account"])
        forward_adj.setdefault(u, []).append(tx)
        reverse_adj.setdefault(v, []).append(tx)

    visited_nodes: set[str] = {account_id}
    collected_txns: dict[str, dict[str, Any]] = {}

    def bfs(start: str, adj: dict[str, list[dict[str, Any]]], is_forward: bool) -> None:
        queue: deque[tuple[str, int]] = deque([(start, 0)])
        seen_at_depth: dict[str, int] = {start: 0}
        while queue:
            cur, d = queue.popleft()
            if d >= depth:
                continue
            for tx in adj.get(cur, []):
                collected_txns[tx["txn_id"]] = tx
                nxt = str(tx["to_account"]) if is_forward else str(tx["from_account"])
                visited_nodes.add(nxt)
                if nxt not in seen_at_depth or seen_at_depth[nxt] > d + 1:
                    seen_at_depth[nxt] = d + 1
                    queue.append((nxt, d + 1))

    if direction in ("forward", "both"):
        bfs(account_id, forward_adj, True)
    if direction in ("reverse", "both"):
        bfs(account_id, reverse_adj, False)

    node_ids = list(visited_nodes)
    accounts_rows = fetch_all(
        """
        SELECT id, account_number, holder_name, account_type, branch_city, is_frozen
        FROM bank_accounts
        WHERE id = ANY(%s::uuid[])
        """,
        (node_ids,),
    )
    suspicious_rows = fetch_all(
        """
        SELECT account_id, classification, mule_probability, score_source, status
        FROM suspicious_accounts
        WHERE account_id = ANY(%s::uuid[]) AND status <> 'CLEARED'
        """,
        (node_ids,),
    )

    sub_txs = list(collected_txns.values())
    mg, dg = build_networkx_graph(accounts_rows, sub_txs, suspicious_rows)
    result = analyze_subgraph(mg, dg, sub_txs)
    result["summary"]["root_account_id"] = account_id
    result["summary"]["direction"] = direction
    result["summary"]["max_depth"] = depth
    return result


def trace_complaint_graph(complaint_id: str) -> dict[str, Any]:
    tx_rows = fetch_all(
        """
        SELECT txn_id, from_account, to_account, amount, timestamp, channel,
               complaint_id, hop_depth, is_flagged_fraud
        FROM transactions
        WHERE complaint_id = %s
        ORDER BY timestamp ASC
        """,
        (complaint_id,),
    )
    node_ids_set: set[str] = set()
    for tx in tx_rows:
        node_ids_set.add(str(tx["from_account"]))
        node_ids_set.add(str(tx["to_account"]))

    if not node_ids_set:
        return analyze_subgraph(nx.MultiDiGraph(), nx.DiGraph(), [])

    node_ids = list(node_ids_set)
    accounts_rows = fetch_all(
        """
        SELECT id, account_number, holder_name, account_type, branch_city, is_frozen
        FROM bank_accounts
        WHERE id = ANY(%s::uuid[])
        """,
        (node_ids,),
    )
    suspicious_rows = fetch_all(
        """
        SELECT account_id, classification, mule_probability, score_source, status
        FROM suspicious_accounts
        WHERE account_id = ANY(%s::uuid[]) AND status <> 'CLEARED'
        """,
        (node_ids,),
    )

    mg, dg = build_networkx_graph(accounts_rows, tx_rows, suspicious_rows)
    return analyze_subgraph(mg, dg, tx_rows)


def find_suspicious_paths(
    source_account_id: str,
    target_account_id: str | None = None,
    complaint_id: str | None = None,
    max_depth: int = 5,
) -> list[dict[str, Any]]:
    if complaint_id:
        tx_rows = fetch_all(
            """
            SELECT txn_id, from_account, to_account, amount, timestamp, channel,
                   complaint_id, hop_depth, is_flagged_fraud
            FROM transactions
            WHERE complaint_id = %s
            ORDER BY timestamp ASC
            """,
            (complaint_id,),
        )
    else:
        tx_rows = fetch_all(
            """
            SELECT txn_id, from_account, to_account, amount, timestamp, channel,
                   complaint_id, hop_depth, is_flagged_fraud
            FROM transactions
            ORDER BY timestamp ASC
            """
        )

    node_ids = list({str(t["from_account"]) for t in tx_rows} | {str(t["to_account"]) for t in tx_rows})
    if not node_ids:
        return []

    accounts_rows = fetch_all(
        "SELECT id, account_number, holder_name, account_type, branch_city, is_frozen FROM bank_accounts WHERE id = ANY(%s::uuid[])",
        (node_ids,),
    )
    suspicious_rows = fetch_all(
        "SELECT account_id, classification, mule_probability, score_source, status FROM suspicious_accounts WHERE account_id = ANY(%s::uuid[]) AND status <> 'CLEARED'",
        (node_ids,),
    )

    mg, dg = build_networkx_graph(accounts_rows, tx_rows, suspicious_rows)
    if source_account_id not in dg:
        return []

    targets: list[str]
    if target_account_id:
        targets = [target_account_id] if target_account_id in dg else []
    else:
        # Target all sink nodes or suspicious cash-out nodes reachable from source
        targets = [
            n
            for n in dg.nodes
            if n != source_account_id
            and (
                dg.out_degree(n) == 0
                or dg.nodes[n].get("suspicious_classification") in ("CASH_OUT_CANDIDATE", "SUSPECTED_MULE")
            )
        ]

    paths_out: list[dict[str, Any]] = []
    for tgt in targets:
        for idx, path_nodes in enumerate(nx.all_simple_paths(dg, source_account_id, tgt, cutoff=max_depth)):
            if idx >= 10:
                break
            hop_edges: list[dict[str, Any]] = []
            bottleneck_amount = float("inf")
            for i in range(len(path_nodes) - 1):
                u, v = path_nodes[i], path_nodes[i + 1]
                edge_bundle = list(mg.get_edge_data(u, v).values())
                edge_total = sum(float(e["amount"]) for e in edge_bundle)
                bottleneck_amount = min(bottleneck_amount, edge_total)
                hop_edges.append(
                    {
                        "from": u,
                        "to": v,
                        "txn_ids": [e["txn_id"] for e in edge_bundle],
                        "amount": round(edge_total, 2),
                    }
                )
            paths_out.append(
                {
                    "path_ids": path_nodes,
                    "path_account_numbers": [dg.nodes[n].get("account_number", n) for n in path_nodes],
                    "hop_count": len(path_nodes) - 1,
                    "bottleneck_amount": round(bottleneck_amount, 2) if bottleneck_amount != float("inf") else 0.0,
                    "edges": hop_edges,
                }
            )

    paths_out.sort(key=lambda p: (-p["bottleneck_amount"], p["hop_count"]))
    return paths_out[:25]


def get_account_graph_metrics(account_id: str) -> dict[str, Any] | None:
    acc = fetch_one(
        "SELECT id, account_number, holder_name, account_type, branch_city, is_frozen FROM bank_accounts WHERE id = %s",
        (account_id,),
    )
    if not acc:
        return None

    tx_rows = fetch_all(
        """
        SELECT txn_id, from_account, to_account, amount, timestamp, channel,
               complaint_id, hop_depth, is_flagged_fraud
        FROM transactions
        WHERE from_account = %s OR to_account = %s
        ORDER BY timestamp ASC
        """,
        (account_id, account_id),
    )
    inflows = [t for t in tx_rows if str(t["to_account"]) == account_id]
    outflows = [t for t in tx_rows if str(t["from_account"]) == account_id]
    total_in = round(sum(float(t["amount"]) for t in inflows), 2)
    total_out = round(sum(float(t["amount"]) for t in outflows), 2)
    avg_lat, min_lat = compute_receive_and_forward_latency(inflows, outflows)

    # Local 2-hop neighborhood centrality
    sub = trace_from_db(account_id, direction="both", depth=2)
    node_stats = next((n for n in sub["nodes"] if n["id"] == account_id), None)

    return {
        "account": acc,
        "in_degree": len(inflows),
        "out_degree": len(outflows),
        "unique_senders": len({str(t["from_account"]) for t in inflows}),
        "unique_receivers": len({str(t["to_account"]) for t in outflows}),
        "total_inflow": total_in,
        "total_outflow": total_out,
        "pass_through_ratio": round(total_out / total_in, 4) if total_in > 0 else None,
        "avg_forward_latency_sec": avg_lat,
        "min_forward_latency_sec": min_lat,
        "velocity_1h": compute_max_1h_velocity(tx_rows),
        "pagerank": node_stats["pagerank"] if node_stats else 0.0,
        "betweenness_centrality": node_stats["betweenness_centrality"] if node_stats else 0.0,
        "cycles_involving_account": [c for c in sub["cycles"] if account_id in c],
    }
