from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import numpy as np
import pandas as pd
from app.db import fetch_all
from app.services.graph_engine import (
    build_networkx_graph,
    compute_max_1h_velocity,
    compute_receive_and_forward_latency,
)
import networkx as nx

FEATURE_COLUMNS: list[str] = [
    "account_age_days",
    "kyc_verified",
    "is_current_or_wallet",
    "in_degree",
    "out_degree",
    "unique_senders",
    "unique_receivers",
    "fan_in_out_ratio",
    "total_inflow",
    "total_outflow",
    "avg_inflow_amount",
    "max_inflow_amount",
    "avg_outflow_amount",
    "pass_through_ratio",
    "avg_forward_latency_sec",
    "min_forward_latency_sec",
    "velocity_1h",
    "off_hours_ratio",
    "pagerank",
    "betweenness_centrality",
    "prior_atm_withdrawals",
]


def _parse_ts(val: Any) -> datetime:
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(val).replace("Z", "+00:00"))


def build_account_feature_dataframe(account_ids: list[str] | None = None) -> pd.DataFrame:
    """
    Extracts account-level behavioral, temporal, and NetworkX graph features directly
    from PostgreSQL tables. Returns a DataFrame indexed by row with metadata columns
    (`account_id`, `account_number`, `holder_name`, `label`, `activity_ts`) plus
    `FEATURE_COLUMNS`.
    """
    accounts_rows = fetch_all(
        """
        SELECT id, account_number, holder_name, account_type, branch_city,
               branch_lat, branch_lng, kyc_verified, account_age_days, is_frozen, created_at
        FROM bank_accounts
        ORDER BY created_at ASC
        """
    )
    tx_rows = fetch_all(
        """
        SELECT txn_id, from_account, to_account, amount, timestamp, channel,
               complaint_id, hop_depth, is_flagged_fraud
        FROM transactions
        ORDER BY timestamp ASC
        """
    )
    susp_rows = fetch_all(
        """
        SELECT account_id, classification, mule_probability, status
        FROM suspicious_accounts
        WHERE status <> 'CLEARED'
        """
    )
    wd_rows = fetch_all(
        """
        SELECT account_id, atm_id, amount, withdrawn_at, is_flagged_cashout
        FROM atm_withdrawals
        """
    )

    if not accounts_rows:
        return pd.DataFrame()

    _, dg = build_networkx_graph(accounts_rows, tx_rows, susp_rows)
    try:
        pr = nx.pagerank(dg, weight="weight") if dg.number_of_edges() > 0 else {n: 0.0 for n in dg.nodes}
    except Exception:
        pr = {n: 0.0 for n in dg.nodes}

    try:
        btw = nx.betweenness_centrality(dg, normalized=True) if dg.number_of_nodes() > 2 else {n: 0.0 for n in dg.nodes}
    except Exception:
        btw = {n: 0.0 for n in dg.nodes}

    inflows_map: dict[str, list[dict[str, Any]]] = {}
    outflows_map: dict[str, list[dict[str, Any]]] = {}
    for tx in tx_rows:
        u = str(tx["from_account"])
        v = str(tx["to_account"])
        outflows_map.setdefault(u, []).append(tx)
        inflows_map.setdefault(v, []).append(tx)

    wd_count_map: dict[str, int] = {}
    for wd in wd_rows:
        aid = str(wd["account_id"])
        wd_count_map[aid] = wd_count_map.get(aid, 0) + 1

    susp_set: set[str] = {
        str(s["account_id"])
        for s in susp_rows
        if s["classification"] in ("SUSPECTED_MULE", "LAYERING_NODE", "CASH_OUT_CANDIDATE")
    }
    # Also mark accounts receiving flagged fraud inflows (excluding origin victim accounts)
    flagged_receiver_set: set[str] = {
        str(tx["to_account"]) for tx in tx_rows if bool(tx.get("is_flagged_fraud"))
    }

    target_set = set(account_ids) if account_ids else None
    records: list[dict[str, Any]] = []

    for acc in accounts_rows:
        aid = str(acc["id"])
        if target_set is not None and aid not in target_set:
            continue

        ins = inflows_map.get(aid, [])
        outs = outflows_map.get(aid, [])
        all_txs = ins + outs

        total_in = float(sum(float(t["amount"]) for t in ins))
        total_out = float(sum(float(t["amount"]) for t in outs))
        avg_in = total_in / len(ins) if ins else 0.0
        max_in = max((float(t["amount"]) for t in ins), default=0.0)
        avg_out = total_out / len(outs) if outs else 0.0
        pass_through = total_out / (total_in + 1.0) if total_in > 0 else 0.0

        avg_lat, min_lat = compute_receive_and_forward_latency(ins, outs)
        velocity_1h = compute_max_1h_velocity(all_txs)

        unique_senders = len({str(t["from_account"]) for t in ins})
        unique_receivers = len({str(t["to_account"]) for t in outs})
        fan_in_out_ratio = unique_senders / (unique_receivers + 1.0)

        # IST is UTC+5:30; off-hours defined as 22:00 - 05:59 IST
        off_hours_cnt = 0
        tx_timestamps: list[datetime] = []
        for t in all_txs:
            ts = _parse_ts(t["timestamp"])
            tx_timestamps.append(ts)
            ist_hour = (ts.hour + 5 + (ts.minute + 30) // 60) % 24
            if ist_hour >= 22 or ist_hour < 6:
                off_hours_cnt += 1
        off_hours_ratio = off_hours_cnt / len(all_txs) if all_txs else 0.0

        activity_ts = max(tx_timestamps) if tx_timestamps else _parse_ts(acc["created_at"])
        is_positive = 1 if (aid in susp_set or aid in flagged_receiver_set) else 0

        records.append(
            {
                "account_id": aid,
                "account_number": acc["account_number"],
                "holder_name": acc["holder_name"],
                "branch_lat": float(acc["branch_lat"]),
                "branch_lng": float(acc["branch_lng"]),
                "activity_ts": activity_ts.timestamp(),
                "label": is_positive,
                "account_age_days": float(acc["account_age_days"]),
                "kyc_verified": 1.0 if acc["kyc_verified"] else 0.0,
                "is_current_or_wallet": 1.0 if acc["account_type"] in ("CURRENT", "WALLET") else 0.0,
                "in_degree": float(len(ins)),
                "out_degree": float(len(outs)),
                "unique_senders": float(unique_senders),
                "unique_receivers": float(unique_receivers),
                "fan_in_out_ratio": float(round(fan_in_out_ratio, 4)),
                "total_inflow": float(round(total_in, 2)),
                "total_outflow": float(round(total_out, 2)),
                "avg_inflow_amount": float(round(avg_in, 2)),
                "max_inflow_amount": float(round(max_in, 2)),
                "avg_outflow_amount": float(round(avg_out, 2)),
                "pass_through_ratio": float(round(pass_through, 4)),
                "avg_forward_latency_sec": float(avg_lat) if avg_lat is not None else 999999.0,
                "min_forward_latency_sec": float(min_lat) if min_lat is not None else 999999.0,
                "velocity_1h": float(velocity_1h),
                "off_hours_ratio": float(round(off_hours_ratio, 4)),
                "pagerank": float(pr.get(aid, 0.0)),
                "betweenness_centrality": float(btw.get(aid, 0.0)),
                "prior_atm_withdrawals": float(wd_count_map.get(aid, 0)),
            }
        )

    df = pd.DataFrame(records)
    for col in FEATURE_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    return df


def compute_rule_based_mule_score(row: pd.Series) -> tuple[float, list[dict[str, Any]]]:
    """
    Transparent rule-based heuristic fallback used ONLY when no trained XGBoost artifact
    is available. Returns (score_0_to_1, reasons_list).
    """
    score = 0.0
    reasons: list[dict[str, Any]] = []

    if row["account_age_days"] < 60:
        score += 0.22
        reasons.append({"feature": "account_age_days", "contribution": 0.22, "note": "Recently opened account (<60 days)"})
    if row["kyc_verified"] == 0.0:
        score += 0.18
        reasons.append({"feature": "kyc_verified", "contribution": 0.18, "note": "Unverified KYC"})
    if row["pass_through_ratio"] >= 0.70:
        score += 0.25
        reasons.append({"feature": "pass_through_ratio", "contribution": 0.25, "note": "High inflow-to-outflow pass-through"})
    if row["min_forward_latency_sec"] <= 3600:
        score += 0.20
        reasons.append({"feature": "min_forward_latency_sec", "contribution": 0.20, "note": "Rapid receive-and-forward (<1h)"})
    if row["velocity_1h"] >= 3:
        score += 0.15
        reasons.append({"feature": "velocity_1h", "contribution": 0.15, "note": "Burst transaction velocity (>=3/hr)"})

    return round(min(score, 0.99), 4), reasons
