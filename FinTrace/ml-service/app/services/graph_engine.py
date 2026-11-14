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


def _fetch_intelligence_rows(node_ids: list[str]) -> list[dict[str, Any]]:
    if not node_ids:
        return []
    try:
        return fetch_all(
            """
            SELECT account_id, bank_name, risk_score, risk_classification,
                   investigation_status, mule_probability, rapid_forward_count,
                   pass_through_ratio
            FROM account_intelligence_profiles
            WHERE account_id = ANY(%s::uuid[])
            """,
            (node_ids,),
        )
    except Exception:
        return []


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
    intelligence_rows: list[dict[str, Any]] | None = None,
) -> tuple[nx.MultiDiGraph, nx.DiGraph]:
    """
    Constructs both a MultiDiGraph (every real DB transaction edge preserved)
    and a simple aggregated DiGraph (for PageRank, betweenness, and cycles),
    enriched with account risk scores, classifications and intelligence flags.
    """
    susp_map: dict[str, dict[str, Any]] = {}
    for sa in suspicious_rows:
        acc_id = str(sa["account_id"])
        existing = susp_map.get(acc_id)
        prob = float(sa["mule_probability"]) if sa.get("mule_probability") is not None else 0.0
        if not existing or prob >= float(existing.get("mule_probability") or 0.0):
            susp_map[acc_id] = sa

    intel_map: dict[str, dict[str, Any]] = {}
    if intelligence_rows:
        for ir in intelligence_rows:
            intel_map[str(ir["account_id"])] = ir

    mg = nx.MultiDiGraph()
    dg = nx.DiGraph()

    for acc in accounts_rows:
        acc_id = str(acc["id"])
        sa = susp_map.get(acc_id)
        ir = intel_map.get(acc_id)

        mule_prob = None
        if ir and ir.get("mule_probability") is not None:
            mule_prob = float(ir["mule_probability"])
        elif sa and sa.get("mule_probability") is not None:
            mule_prob = float(sa["mule_probability"])

        risk_score = 10.0
        if ir and ir.get("risk_score") is not None:
            risk_score = float(ir["risk_score"])
        elif sa:
            cls = sa.get("classification")
            if cls in ("CONFIRMED_FRAUD_LINKED", "FRAUD_RING_LEADER"):
                risk_score = 95.0
            elif cls in ("SUSPECTED_MULE", "CASH_OUT_CANDIDATE"):
                risk_score = 75.0
            elif cls == "SUSPICIOUS":
                risk_score = 55.0

        classification = "LOW"
        if ir and ir.get("risk_classification"):
            classification = ir["risk_classification"]
        elif sa and sa.get("classification"):
            classification = sa["classification"]

        is_confirmed = classification in ("CONFIRMED_FRAUD_LINKED", "FRAUD_RING_LEADER")

        node_attrs = {
            "id": acc_id,
            "account_number": acc["account_number"],
            "holder_name": acc["holder_name"],
            "account_type": acc["account_type"],
            "branch_city": acc.get("branch_city", "Unknown"),
            "bank_name": ir.get("bank_name") if ir else acc.get("bank_name", "FinTrace Bank"),
            "is_frozen": bool(acc.get("is_frozen", False)),
            "suspicious_classification": classification,
            "mule_probability": mule_prob,
            "risk_score": round(risk_score, 1),
            "risk_classification": classification,
            "is_confirmed_fraud": is_confirmed,
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


def propagate_graph_risk(
    dg: nx.DiGraph,
    fraud_nodes: dict[str, float] | None = None,
    max_depth: int = 3,
    attenuation: float = 0.65,
) -> tuple[dict[str, float], list[dict[str, Any]]]:
    """
    Propagates risk outward from known fraud or high-risk nodes across graph connections.
    Returns (node_id -> propagated_score, list_of_propagation_edges).
    """
    if fraud_nodes is None:
        fraud_nodes = {}
        for n, d in dg.nodes(data=True):
            if d.get("is_confirmed_fraud") or d.get("suspicious_classification") in (
                "CONFIRMED_FRAUD_LINKED",
                "FRAUD_RING_LEADER",
            ):
                fraud_nodes[n] = float(d.get("risk_score", 95.0))
            elif (d.get("mule_probability") or 0.0) >= 0.8:
                fraud_nodes[n] = float(d.get("risk_score", 85.0))

    propagated_scores: dict[str, float] = {}
    propagation_links: list[dict[str, Any]] = []

    if not fraud_nodes:
        return propagated_scores, propagation_links

    try:
        undirected = dg.to_undirected(as_view=True)
    except Exception:
        undirected = dg.to_undirected()

    for f_node, base_risk in fraud_nodes.items():
        if f_node not in undirected:
            continue
        try:
            lengths = nx.single_source_shortest_path_length(undirected, f_node, cutoff=max_depth)
        except Exception:
            continue

        for target_node, dist in lengths.items():
            if target_node == f_node:
                continue
            factor = round(attenuation ** dist, 4)
            prop_val = round(base_risk * factor, 2)
            if prop_val > propagated_scores.get(target_node, 0.0):
                propagated_scores[target_node] = prop_val

            propagation_links.append({
                "source_account_id": f_node,
                "target_account_id": target_node,
                "hop_distance": dist,
                "attenuation_factor": factor,
                "base_risk": base_risk,
                "propagated_risk": prop_val,
            })

    return propagated_scores, propagation_links


def analyze_subgraph(
    mg: nx.MultiDiGraph,
    dg: nx.DiGraph,
    tx_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Computes node-level graph metrics, centrality, cycles, risk propagation, and chronological timeline."""
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
        betweenness = (
            nx.betweenness_centrality(dg, normalized=True) if dg.number_of_nodes() > 2 else {n: 0.0 for n in dg.nodes}
        )
    except Exception:
        betweenness = {n: 0.0 for n in dg.nodes}

    # Bound cycle detection to avoid combinatorial explosion on dense graphs
    cycles: list[list[str]] = []
    try:
        for idx, cyc in enumerate(nx.simple_cycles(dg)):
            if idx >= 15:
                break
            if len(cyc) <= 6:
                cycles.append(cyc)
    except Exception:
        cycles = []

    # Risk propagation
    propagated_scores, _ = propagate_graph_risk(dg)

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

        base_score = float(attrs.get("risk_score", 10.0))
        prop_score = float(propagated_scores.get(node_id, 0.0))
        effective_risk = max(base_score, prop_score)

        nodes_out.append(
            {
                "id": node_id,
                "account_number": attrs.get("account_number", node_id),
                "holder_name": attrs.get("holder_name", "Unknown"),
                "account_type": attrs.get("account_type", "SAVINGS"),
                "branch_city": attrs.get("branch_city", "Unknown"),
                "bank_name": attrs.get("bank_name", "FinTrace Bank"),
                "is_frozen": bool(attrs.get("is_frozen", False)),
                "suspicious_classification": attrs.get("suspicious_classification"),
                "mule_probability": attrs.get("mule_probability"),
                "risk_score": round(effective_risk, 1),
                "risk_classification": attrs.get("risk_classification", "LOW"),
                "is_confirmed_fraud": bool(attrs.get("is_confirmed_fraud", False)),
                "propagated_risk": round(prop_score, 1),
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


def detect_mule_clusters(
    min_cluster_size: int = 2,
    min_risk_score: float = 40.0,
) -> dict[str, Any]:
    """
    Detects mule syndicate rings, layering cycles, fan-out dispersal hubs,
    and funnel accumulator networks across the entire transaction graph.
    """
    tx_rows = fetch_all(
        """
        SELECT txn_id, from_account, to_account, amount, timestamp, channel,
               complaint_id, hop_depth, is_flagged_fraud
        FROM transactions
        ORDER BY timestamp ASC
        """
    )
    if not tx_rows:
        return {
            "clusters": [],
            "total_clusters": 0,
            "high_risk_clusters": 0,
            "total_flagged_accounts": 0,
            "total_exposure_amount": 0.0,
        }

    node_ids = list({str(t["from_account"]) for t in tx_rows} | {str(t["to_account"]) for t in tx_rows})
    accounts_rows = fetch_all(
        "SELECT id, account_number, holder_name, account_type, branch_city, is_frozen FROM bank_accounts WHERE id = ANY(%s::uuid[])",
        (node_ids,),
    )
    suspicious_rows = fetch_all(
        "SELECT account_id, classification, mule_probability, score_source, status FROM suspicious_accounts WHERE account_id = ANY(%s::uuid[]) AND status <> 'CLEARED'",
        (node_ids,),
    )
    intelligence_rows = _fetch_intelligence_rows(node_ids)

    mg, dg = build_networkx_graph(accounts_rows, tx_rows, suspicious_rows, intelligence_rows)

    clusters: list[dict[str, Any]] = []
    seen_cluster_signatures: set[str] = set()

    # A. Cycle Detection (MULE_RING_CYCLE)
    try:
        cycles = list(nx.simple_cycles(dg))
    except Exception:
        cycles = []

    for idx, cycle in enumerate(cycles):
        if len(cycle) < 2 or len(cycle) > 6:
            continue
        sig = "-".join(sorted(cycle))
        if sig in seen_cluster_signatures:
            continue
        seen_cluster_signatures.add(sig)

        cycle_txs = [t for t in tx_rows if str(t["from_account"]) in cycle and str(t["to_account"]) in cycle]
        total_amt = sum(float(t["amount"]) for t in cycle_txs)
        has_fraud = any(dg.nodes[n].get("is_confirmed_fraud") for n in cycle)

        avg_lat, _ = compute_receive_and_forward_latency(
            [t for t in cycle_txs if str(t["to_account"]) in cycle],
            [t for t in cycle_txs if str(t["from_account"]) in cycle],
        )

        members = []
        for n in cycle:
            d = dg.nodes[n]
            ins = [t for t in cycle_txs if str(t["to_account"]) == n]
            outs = [t for t in cycle_txs if str(t["from_account"]) == n]
            members.append({
                "account_id": n,
                "account_number": d.get("account_number", n),
                "holder_name": d.get("holder_name", "Unknown"),
                "bank_name": d.get("bank_name", "FinTrace Bank"),
                "role": "INTERMEDIARY_MULE",
                "risk_score": d.get("risk_score", 75.0),
                "risk_classification": d.get("risk_classification", "HIGH"),
                "mule_probability": d.get("mule_probability") or 0.85,
                "in_degree": dg.in_degree(n),
                "out_degree": dg.out_degree(n),
                "total_inflow": round(sum(float(t["amount"]) for t in ins), 2),
                "total_outflow": round(sum(float(t["amount"]) for t in outs), 2),
                "is_frozen": d.get("is_frozen", False),
            })

        cluster_score = max(m["risk_score"] for m in members) if members else 80.0
        if has_fraud:
            cluster_score = max(cluster_score, 92.0)

        severity = "CRITICAL" if cluster_score >= 85.0 or total_amt >= 300000 else "HIGH"
        clusters.append({
            "cluster_id": f"RING-{len(clusters)+1:03d}",
            "cluster_type": "MULE_RING_CYCLE",
            "severity": severity,
            "member_count": len(members),
            "members": members,
            "total_flow_amount": round(total_amt, 2),
            "transaction_count": len(cycle_txs),
            "avg_transfer_latency_sec": avg_lat,
            "has_cycle": True,
            "cycle_nodes": cycle,
            "risk_score": round(cluster_score, 1),
            "identified_patterns": [
                f"Circular fund layering loop across {len(cycle)} interconnected nodes",
                "Near-zero economic balance retention across participants",
                "High-velocity cross-account pass-through",
            ],
            "recommended_action": "Execute simultaneous preventive lien across all ring accounts to prevent capital dispersal.",
            "detected_at": datetime.utcnow().isoformat() + "Z",
        })

    # B. Fan-Out Dispersal Detection (1-to-many smurfing)
    for node_id in dg.nodes:
        out_neighbors = list(dg.successors(node_id))
        if len(out_neighbors) >= 3:
            sig = f"FANOUT-{node_id}"
            if sig in seen_cluster_signatures:
                continue
            seen_cluster_signatures.add(sig)

            out_txs = [t for t in tx_rows if str(t["from_account"]) == node_id and str(t["to_account"]) in out_neighbors]
            total_amt = sum(float(t["amount"]) for t in out_txs)

            src_node = dg.nodes[node_id]
            members = [{
                "account_id": node_id,
                "account_number": src_node.get("account_number", node_id),
                "holder_name": src_node.get("holder_name", "Unknown"),
                "bank_name": src_node.get("bank_name", "FinTrace Bank"),
                "role": "SOURCE",
                "risk_score": src_node.get("risk_score", 75.0),
                "risk_classification": src_node.get("risk_classification", "HIGH"),
                "mule_probability": src_node.get("mule_probability") or 0.75,
                "in_degree": dg.in_degree(node_id),
                "out_degree": dg.out_degree(node_id),
                "total_inflow": 0.0,
                "total_outflow": round(total_amt, 2),
                "is_frozen": src_node.get("is_frozen", False),
            }]

            for tgt in out_neighbors:
                tgt_node = dg.nodes[tgt]
                tgt_in_txs = [t for t in out_txs if str(t["to_account"]) == tgt]
                members.append({
                    "account_id": tgt,
                    "account_number": tgt_node.get("account_number", tgt),
                    "holder_name": tgt_node.get("holder_name", "Unknown"),
                    "bank_name": tgt_node.get("bank_name", "FinTrace Bank"),
                    "role": "CASH_OUT_SINK" if dg.out_degree(tgt) == 0 else "INTERMEDIARY_MULE",
                    "risk_score": tgt_node.get("risk_score", 60.0),
                    "risk_classification": tgt_node.get("risk_classification", "MEDIUM"),
                    "mule_probability": tgt_node.get("mule_probability") or 0.6,
                    "in_degree": dg.in_degree(tgt),
                    "out_degree": dg.out_degree(tgt),
                    "total_inflow": round(sum(float(t["amount"]) for t in tgt_in_txs), 2),
                    "total_outflow": 0.0,
                    "is_frozen": tgt_node.get("is_frozen", False),
                })

            max_score = max(m["risk_score"] for m in members)
            if max_score >= min_risk_score:
                clusters.append({
                    "cluster_id": f"DISPERSAL-{len(clusters)+1:03d}",
                    "cluster_type": "FAN_OUT_DISPERSAL",
                    "severity": "CRITICAL" if max_score >= 80 else "HIGH",
                    "member_count": len(members),
                    "members": members,
                    "total_flow_amount": round(total_amt, 2),
                    "transaction_count": len(out_txs),
                    "avg_transfer_latency_sec": 300.0,
                    "has_cycle": False,
                    "cycle_nodes": [],
                    "risk_score": round(max_score, 1),
                    "identified_patterns": [
                        f"1-to-{len(out_neighbors)} fan-out dispersal pattern (smurfing/layering)",
                        "Rapid fund dispersion below standard reporting thresholds",
                    ],
                    "recommended_action": "Halt outbound clearing on source hub and inspect linked beneficiary endpoints.",
                    "detected_at": datetime.utcnow().isoformat() + "Z",
                })

    # C. Funnel Collection Detection (many-to-1 accumulator)
    for node_id in dg.nodes:
        in_neighbors = list(dg.predecessors(node_id))
        if len(in_neighbors) >= 3:
            sig = f"FUNNEL-{node_id}"
            if sig in seen_cluster_signatures:
                continue
            seen_cluster_signatures.add(sig)

            in_txs = [t for t in tx_rows if str(t["to_account"]) == node_id and str(t["from_account"]) in in_neighbors]
            total_amt = sum(float(t["amount"]) for t in in_txs)
            center_node = dg.nodes[node_id]

            members = [{
                "account_id": node_id,
                "account_number": center_node.get("account_number", node_id),
                "holder_name": center_node.get("holder_name", "Unknown"),
                "bank_name": center_node.get("bank_name", "FinTrace Bank"),
                "role": "COORDINATOR",
                "risk_score": center_node.get("risk_score", 75.0),
                "risk_classification": center_node.get("risk_classification", "HIGH"),
                "mule_probability": center_node.get("mule_probability") or 0.8,
                "in_degree": dg.in_degree(node_id),
                "out_degree": dg.out_degree(node_id),
                "total_inflow": round(total_amt, 2),
                "total_outflow": 0.0,
                "is_frozen": center_node.get("is_frozen", False),
            }]

            for src in in_neighbors:
                src_node = dg.nodes[src]
                src_txs = [t for t in in_txs if str(t["from_account"]) == src]
                members.append({
                    "account_id": src,
                    "account_number": src_node.get("account_number", src),
                    "holder_name": src_node.get("holder_name", "Unknown"),
                    "bank_name": src_node.get("bank_name", "FinTrace Bank"),
                    "role": "SOURCE",
                    "risk_score": src_node.get("risk_score", 45.0),
                    "risk_classification": src_node.get("risk_classification", "MEDIUM"),
                    "mule_probability": src_node.get("mule_probability") or 0.4,
                    "in_degree": dg.in_degree(src),
                    "out_degree": dg.out_degree(src),
                    "total_inflow": 0.0,
                    "total_outflow": round(sum(float(t["amount"]) for t in src_txs), 2),
                    "is_frozen": src_node.get("is_frozen", False),
                })

            max_score = max(m["risk_score"] for m in members)
            if max_score >= min_risk_score:
                clusters.append({
                    "cluster_id": f"FUNNEL-{len(clusters)+1:03d}",
                    "cluster_type": "FUNNEL_COLLECTION",
                    "severity": "HIGH" if max_score >= 70 else "MEDIUM",
                    "member_count": len(members),
                    "members": members,
                    "total_flow_amount": round(total_amt, 2),
                    "transaction_count": len(in_txs),
                    "avg_transfer_latency_sec": 600.0,
                    "has_cycle": False,
                    "cycle_nodes": [],
                    "risk_score": round(max_score, 1),
                    "identified_patterns": [
                        f"{len(in_neighbors)}-to-1 funnel collection (consolidation node)",
                        "Multiple unrelated accounts feeding into single collection point",
                    ],
                    "recommended_action": "Freeze collector account withdrawals; trace and notify originator banks.",
                    "detected_at": datetime.utcnow().isoformat() + "Z",
                })

    # Sort by risk_score desc
    clusters.sort(key=lambda c: (-c["risk_score"], -c["total_flow_amount"]))

    flagged_acc_ids: set[str] = set()
    total_exposure = 0.0
    high_risk_count = 0
    for cl in clusters:
        total_exposure += cl["total_flow_amount"]
        if cl["risk_score"] >= 75.0 or cl["severity"] in ("CRITICAL", "HIGH"):
            high_risk_count += 1
        for m in cl["members"]:
            flagged_acc_ids.add(m["account_id"])

    return {
        "clusters": clusters,
        "total_clusters": len(clusters),
        "high_risk_clusters": high_risk_count,
        "total_flagged_accounts": len(flagged_acc_ids),
        "total_exposure_amount": round(total_exposure, 2),
    }


def extract_account_graph_intelligence(account_id: str) -> dict[str, Any] | None:
    """
    Computes graph-derived intelligence features for an individual account:
    centrality, cycle participation, mule cluster linkages, counterparty concentration,
    distance to confirmed fraud, and propagated risk score.
    """
    acc = fetch_one(
        "SELECT id, account_number, holder_name, account_type, branch_city, is_frozen FROM bank_accounts WHERE id = %s",
        (account_id,),
    )
    if not acc:
        return None

    # Load 2-hop local neighborhood
    sub = trace_from_db(account_id, direction="both", depth=2)
    node_stats = next((n for n in sub["nodes"] if n["id"] == account_id), None)

    # Calculate distance to nearest confirmed fraud node
    nearest_fraud_id = None
    min_dist_to_fraud = None
    fraud_nodes_map: dict[str, float] = {}

    for n in sub["nodes"]:
        if n.get("is_confirmed_fraud") or n.get("suspicious_classification") in (
            "CONFIRMED_FRAUD_LINKED",
            "FRAUD_RING_LEADER",
        ):
            fraud_nodes_map[n["id"]] = float(n.get("risk_score", 95.0))

    if fraud_nodes_map:
        local_dg = nx.DiGraph()
        for e in sub["edges"]:
            local_dg.add_edge(e["from_account"], e["to_account"])
        undirected_local = local_dg.to_undirected(as_view=True)

        for f_id, f_score in fraud_nodes_map.items():
            if f_id == account_id:
                min_dist_to_fraud = 0
                nearest_fraud_id = f_id
                break
            try:
                dist = nx.shortest_path_length(undirected_local, account_id, f_id)
                if min_dist_to_fraud is None or dist < min_dist_to_fraud:
                    min_dist_to_fraud = dist
                    nearest_fraud_id = f_id
            except Exception:
                pass

    # Propagated risk calculation
    propagated_risk = 0.0
    if min_dist_to_fraud is not None and nearest_fraud_id:
        base_risk = fraud_nodes_map.get(nearest_fraud_id, 95.0)
        propagated_risk = round(base_risk * (0.65 ** min_dist_to_fraud), 1)

    # Check cycles
    cycles_with_account = [c for c in sub.get("cycles", []) if account_id in c]

    # Find if member of any mule cluster
    all_clusters = detect_mule_clusters(min_cluster_size=2, min_risk_score=30.0)
    matched_cluster = None
    member_role = None
    for cl in all_clusters.get("clusters", []):
        for m in cl.get("members", []):
            if m["account_id"] == account_id:
                matched_cluster = cl
                member_role = m.get("role")
                break
        if matched_cluster:
            break

    # Counterparties
    counterparties: list[dict[str, Any]] = []
    in_edges = [e for e in sub["edges"] if e["to_account"] == account_id]
    out_edges = [e for e in sub["edges"] if e["from_account"] == account_id]

    inflow_by_src: dict[str, list[dict[str, Any]]] = {}
    for e in in_edges:
        inflow_by_src.setdefault(e["from_account"], []).append(e)

    for src_id, tx_list in inflow_by_src.items():
        src_node = next((n for n in sub["nodes"] if n["id"] == src_id), None)
        counterparties.append({
            "account_id": src_id,
            "account_number": src_node["account_number"] if src_node else src_id,
            "holder_name": src_node["holder_name"] if src_node else "Unknown",
            "direction": "INFLOW",
            "total_amount": round(sum(float(t["amount"]) for t in tx_list), 2),
            "tx_count": len(tx_list),
            "risk_classification": src_node.get("risk_classification", "LOW") if src_node else "LOW",
        })

    outflow_by_tgt: dict[str, list[dict[str, Any]]] = {}
    for e in out_edges:
        outflow_by_tgt.setdefault(e["to_account"], []).append(e)

    for tgt_id, tx_list in outflow_by_tgt.items():
        tgt_node = next((n for n in sub["nodes"] if n["id"] == tgt_id), None)
        counterparties.append({
            "account_id": tgt_id,
            "account_number": tgt_node["account_number"] if tgt_node else tgt_id,
            "holder_name": tgt_node["holder_name"] if tgt_node else "Unknown",
            "direction": "OUTFLOW",
            "total_amount": round(sum(float(t["amount"]) for t in tx_list), 2),
            "tx_count": len(tx_list),
            "risk_classification": tgt_node.get("risk_classification", "LOW") if tgt_node else "LOW",
        })

    counterparties.sort(key=lambda cp: -cp["total_amount"])

    in_deg = len(in_edges)
    out_deg = len(out_edges)
    total_deg = in_deg + out_deg
    fan_in_ratio = round(in_deg / total_deg, 3) if total_deg > 0 else 0.0
    fan_out_ratio = round(out_deg / total_deg, 3) if total_deg > 0 else 0.0

    return {
        "account_id": account_id,
        "account_number": acc["account_number"],
        "holder_name": acc["holder_name"],
        "subgraph_node_count": len(sub["nodes"]),
        "subgraph_edge_count": len(sub["edges"]),
        "in_degree": in_deg,
        "out_degree": out_deg,
        "unique_senders": len(inflow_by_src),
        "unique_receivers": len(outflow_by_tgt),
        "pagerank": node_stats["pagerank"] if node_stats else 0.0,
        "betweenness_centrality": node_stats["betweenness_centrality"] if node_stats else 0.0,
        "distance_to_nearest_fraud_account": min_dist_to_fraud,
        "nearest_fraud_account_id": nearest_fraud_id,
        "propagated_risk_score": propagated_risk,
        "is_part_of_cycle": len(cycles_with_account) > 0,
        "cycle_count": len(cycles_with_account),
        "mule_cluster_id": matched_cluster["cluster_id"] if matched_cluster else None,
        "mule_cluster_type": matched_cluster["cluster_type"] if matched_cluster else None,
        "mule_cluster_role": member_role,
        "cluster_risk_score": matched_cluster["risk_score"] if matched_cluster else None,
        "fan_in_ratio": fan_in_ratio,
        "fan_out_ratio": fan_out_ratio,
        "pass_through_ratio": node_stats.get("pass_through_ratio") if node_stats else None,
        "avg_forward_latency_sec": node_stats.get("avg_forward_latency_sec") if node_stats else None,
        "max_1h_velocity": node_stats.get("velocity_1h", 0) if node_stats else 0,
        "top_counterparties": counterparties[:10],
    }


def extract_account_subgraph(
    account_id: str,
    direction: str = "both",
    depth: int = 2,
    complaint_id: str | None = None,
) -> dict[str, Any]:
    """
    Extracts an enriched account subgraph including multi-hop neighborhood,
    propagated risk links, mule syndicate clusters, and graph intelligence.
    """
    sub = trace_from_db(account_id, direction=direction, depth=depth, complaint_id=complaint_id)

    # Risk propagation links
    local_dg = nx.DiGraph()
    for e in sub["edges"]:
        local_dg.add_edge(e["from_account"], e["to_account"])

    fraud_map = {
        n["id"]: float(n.get("risk_score", 95.0))
        for n in sub["nodes"]
        if n.get("is_confirmed_fraud") or n.get("suspicious_classification") in (
            "CONFIRMED_FRAUD_LINKED",
            "FRAUD_RING_LEADER",
        )
    }
    _, prop_links = propagate_graph_risk(local_dg, fraud_nodes=fraud_map, max_depth=depth)

    # Intersecting mule clusters
    all_clusters = detect_mule_clusters(min_cluster_size=2, min_risk_score=30.0)
    sub_node_ids = {n["id"] for n in sub["nodes"]}
    intersecting_clusters = [
        cl for cl in all_clusters.get("clusters", [])
        if any(m["account_id"] in sub_node_ids for m in cl.get("members", []))
    ]

    # Graph intelligence for root account
    intel = extract_account_graph_intelligence(account_id)

    return {
        "nodes": sub["nodes"],
        "edges": sub["edges"],
        "timeline": sub["timeline"],
        "cycles": sub["cycles"],
        "summary": sub["summary"],
        "root_account_id": account_id,
        "propagated_risks": prop_links,
        "mule_clusters": intersecting_clusters,
        "graph_intelligence": intel,
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
    intelligence_rows = _fetch_intelligence_rows(node_ids)

    sub_txs = list(collected_txns.values())
    mg, dg = build_networkx_graph(accounts_rows, sub_txs, suspicious_rows, intelligence_rows)
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
    intelligence_rows = _fetch_intelligence_rows(node_ids)

    mg, dg = build_networkx_graph(accounts_rows, tx_rows, suspicious_rows, intelligence_rows)
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
    intelligence_rows = _fetch_intelligence_rows(node_ids)

    mg, dg = build_networkx_graph(accounts_rows, tx_rows, suspicious_rows, intelligence_rows)
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
