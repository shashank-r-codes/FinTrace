from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any
import networkx as nx
from app.db import execute_write, fetch_all, fetch_one
from app.services.explainer import _load_artifacts
from app.services.feature_engineering import (
    FEATURE_COLUMNS,
    build_account_feature_dataframe,
    compute_rule_based_mule_score,
)
from app.services.graph_engine import build_networkx_graph
from app.services.trainer import compute_atm_dbscan_clusters

LIMITATIONS_TEXT = (
    "Weighted risk score (0-100) on synthetic data — NOT a calibrated probability of withdrawal. "
    "Accuracy depends on branch and historical ATM centroids; cross-city travel or physical card handoffs are unobserved."
)


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0088
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _parse_ts(val: Any) -> datetime:
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(val).replace("Z", "+00:00"))


def classify_risk_level(score: float) -> str:
    if score >= 80.0:
        return "Critical"
    if score >= 65.0:
        return "High"
    if score >= 45.0:
        return "Medium"
    return "Low"


def assign_time_window(score: float, hours_since_inflow: float) -> str:
    if score >= 78.0 and hours_since_inflow <= 6.0:
        return "0-6h"
    if score >= 62.0 and hours_since_inflow <= 14.0:
        return "6-12h"
    if score >= 42.0 and hours_since_inflow <= 30.0:
        return "12-24h"
    return ">24h"


def assign_confidence(has_prior_wd: bool, mule_prob: float, distance_km: float) -> str:
    if has_prior_wd or (mule_prob >= 0.80 and distance_km <= 2.5):
        return "High"
    if distance_km <= 5.0:
        return "Moderate"
    return "Low"


def predict_atms_for_complaint(complaint_id: str, top_n: int = 8) -> dict[str, Any]:
    complaint = fetch_one(
        "SELECT id, complaint_number, fraud_type, reported_amount, status, city FROM complaints WHERE id = %s",
        (complaint_id,),
    )
    if not complaint:
        raise ValueError("Complaint not found")

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
    if not tx_rows:
        return {
            "complaint_id": complaint_id,
            "complaint_number": complaint["complaint_number"],
            "score_source": "Rule-based risk score",
            "predictions": [],
            "message": "No transactions linked to this complaint yet.",
        }

    involved_ids = list({str(t["from_account"]) for t in tx_rows} | {str(t["to_account"]) for t in tx_rows})
    accounts_rows = fetch_all(
        """
        SELECT id, account_number, holder_name, account_type, branch_city,
               branch_lat, branch_lng, is_frozen
        FROM bank_accounts
        WHERE id = ANY(%s::uuid[])
        """,
        (involved_ids,),
    )
    susp_rows = fetch_all(
        """
        SELECT account_id, classification, mule_probability, score_source, status
        FROM suspicious_accounts
        WHERE account_id = ANY(%s::uuid[]) AND status <> 'CLEARED'
        """,
        (involved_ids,),
    )
    mg, dg = build_networkx_graph(accounts_rows, tx_rows, susp_rows)

    # Identify origin victim accounts (in_degree == 0 in complaint subgraph)
    origin_ids = {n for n in dg.nodes if dg.in_degree(n) == 0}
    non_origin_ids = [n for n in dg.nodes if n not in origin_ids]
    if not non_origin_ids:
        non_origin_ids = list(dg.nodes)

    df = build_account_feature_dataframe(account_ids=non_origin_ids)
    artifacts = _load_artifacts()

    account_scores: dict[str, float] = {}
    if artifacts is not None and not df.empty:
        xgb_model, _, _, meta = artifacts
        X = df[FEATURE_COLUMNS].to_numpy(dtype=float)
        probs = xgb_model.predict_proba(X)[:, 1]
        for idx, row in df.iterrows():
            account_scores[str(row["account_id"])] = float(probs[idx])
        score_source = "Trained ML prediction"
        model_version = str(meta.get("model_version", "xgb-v1"))
    else:
        for _, row in df.iterrows():
            prob, _ = compute_rule_based_mule_score(row)
            account_scores[str(row["account_id"])] = float(prob)
        score_source = "Rule-based risk score"
        model_version = "atm-heuristic-v1.0"

    # Compute net retained funds & latest inflow timestamp per candidate account
    inflow_sum: dict[str, float] = {}
    outflow_sum: dict[str, float] = {}
    latest_inflow_ts: dict[str, datetime] = {}
    all_tx_times = [_parse_ts(t["timestamp"]) for t in tx_rows]
    ref_time = max(all_tx_times) if all_tx_times else datetime.now(timezone.utc)
    # Use slight offset (+0.5h) to model active monitoring right after latest hop
    now_ref = max(datetime.now(timezone.utc), ref_time)
    # If synthetic data is in the past relative to wall-clock, anchor recency to ref_time + 1.5h
    if (now_ref - ref_time).total_seconds() > 48 * 3600:
        eval_ref = datetime.fromtimestamp(ref_time.timestamp() + 5400, tz=timezone.utc)
    else:
        eval_ref = now_ref

    for t in tx_rows:
        u = str(t["from_account"])
        v = str(t["to_account"])
        amt = float(t["amount"])
        ts = _parse_ts(t["timestamp"])
        outflow_sum[u] = outflow_sum.get(u, 0.0) + amt
        inflow_sum[v] = inflow_sum.get(v, 0.0) + amt
        if v not in latest_inflow_ts or ts > latest_inflow_ts[v]:
            latest_inflow_ts[v] = ts

    df_map = {str(row["account_id"]): row for _, row in df.iterrows()}
    acc_map = {str(a["id"]): a for a in accounts_rows}

    # Select cash-out candidate accounts (prefer unfrozen accounts retaining stolen funds or sink nodes)
    candidates: list[dict[str, Any]] = []
    for aid in non_origin_ids:
        acc = acc_map[aid]
        inf = inflow_sum.get(aid, 0.0)
        outf = outflow_sum.get(aid, 0.0)
        retained = max(0.0, inf - outf)
        retention_ratio = min(1.0, retained / inf) if inf > 0 else 0.0
        is_sink = dg.out_degree(aid) == 0
        if retained > 0 or is_sink or dg.nodes[aid].get("suspicious_classification") == "CASH_OUT_CANDIDATE":
            candidates.append(
                {
                    "account_id": aid,
                    "account_number": acc["account_number"],
                    "holder_name": acc["holder_name"],
                    "is_frozen": bool(acc["is_frozen"]),
                    "branch_lat": float(acc["branch_lat"]),
                    "branch_lng": float(acc["branch_lng"]),
                    "retained_amount": round(retained, 2),
                    "retention_ratio": retention_ratio,
                    "inflow_amount": round(inf, 2),
                    "mule_prob": account_scores.get(aid, 0.5),
                    "velocity_1h": float(df_map[aid]["velocity_1h"]) if aid in df_map else 1.0,
                    "latest_inflow_ts": latest_inflow_ts.get(aid, ref_time),
                }
            )

    if not candidates:
        return {
            "complaint_id": complaint_id,
            "complaint_number": complaint["complaint_number"],
            "score_source": score_source,
            "predictions": [],
            "message": "No downstream cash-out candidate accounts found.",
        }

    # Load historical ATM withdrawals for candidates
    cand_ids = [c["account_id"] for c in candidates]
    hist_wds = fetch_all(
        """
        SELECT aw.account_id, aw.atm_id, a.lat, a.lng, aw.withdrawn_at
        FROM atm_withdrawals aw
        JOIN atms a ON a.id = aw.atm_id
        WHERE aw.account_id = ANY(%s::uuid[])
        """,
        (cand_ids,),
    )
    hist_by_acc: dict[str, list[dict[str, Any]]] = {}
    for wd in hist_wds:
        hist_by_acc.setdefault(str(wd["account_id"]), []).append(wd)

    # Precompute shortest path from origin to each candidate
    paths_by_acc: dict[str, list[dict[str, Any]]] = {}
    for c in candidates:
        aid = c["account_id"]
        acc_paths: list[dict[str, Any]] = []
        for orig in origin_ids:
            if nx.has_path(dg, orig, aid):
                for idx, p in enumerate(nx.all_simple_paths(dg, orig, aid, cutoff=6)):
                    if idx >= 2:
                        break
                    acc_paths.append(
                        {
                            "path": [acc_map.get(n, {}).get("account_number", n) for n in p],
                            "total_amount": c["inflow_amount"],
                        }
                    )
        paths_by_acc[aid] = acc_paths

    all_atms = fetch_all("SELECT * FROM atms")
    clusters = compute_atm_dbscan_clusters()
    cluster_atm_ids = {aid for cl in clusters for aid in cl["atm_ids"]}

    # Score every (candidate, atm) pair and take max risk per ATM
    best_by_atm: dict[str, dict[str, Any]] = {}

    for cand in candidates:
        aid = cand["account_id"]
        wds = hist_by_acc.get(aid, [])
        if wds:
            hist_lat = sum(float(w["lat"]) for w in wds) / len(wds)
            hist_lng = sum(float(w["lng"]) for w in wds) / len(wds)
            centroid_lat = 0.65 * hist_lat + 0.35 * cand["branch_lat"]
            centroid_lng = 0.65 * hist_lng + 0.35 * cand["branch_lng"]
        else:
            centroid_lat = cand["branch_lat"]
            centroid_lng = cand["branch_lng"]

        delta_h = max(0.1, (eval_ref - cand["latest_inflow_ts"]).total_seconds() / 3600.0)
        frozen_penalty = 0.55 if cand["is_frozen"] else 1.0

        for atm in all_atms:
            d_km = haversine_km(centroid_lat, centroid_lng, float(atm["lat"]), float(atm["lng"]))
            if d_km > 15.0:
                continue

            # 1. Spatial Proximity (max 28)
            s_dist = 28.0 * math.exp(-0.35 * d_km)

            # 2. Inflow Recency & Velocity (max 24)
            s_recency = 16.0 * math.exp(-0.08 * delta_h) + 8.0 * min(1.0, cand["velocity_1h"] / 4.0)

            # 3. Mule & Network Retention Risk (max 22)
            s_mule = 22.0 * (0.70 * cand["mule_prob"] + 0.30 * cand["retention_ratio"])

            # 4. Historical ATM & DBSCAN Cluster Match (max 16)
            exact_hits = sum(1 for w in wds if w["atm_id"] == atm["id"])
            cluster_pts = 6.0 if atm["id"] in cluster_atm_ids else (3.0 if wds and d_km <= 2.0 else 0.0)
            s_history = min(10.0, 5.0 * exact_hits) + cluster_pts

            # 5. ATM Operational & 24x7 Fit (max 10)
            tier_pts = {"HIGH": 5.0, "MEDIUM": 3.0, "LOW": 1.5}.get(atm["cash_capacity_tier"], 3.0)
            avail_pts = 5.0 if atm["is_24x7"] else 2.0
            s_atm = tier_pts + avail_pts

            raw_total = (s_dist + s_recency + s_mule + s_history + s_atm) * frozen_penalty
            risk_score = round(min(100.0, max(0.0, raw_total)), 2)

            existing = best_by_atm.get(atm["id"])
            if not existing or risk_score > existing["risk_score"]:
                risk_level = classify_risk_level(risk_score)
                window = assign_time_window(risk_score, delta_h)
                confidence = assign_confidence(exact_hits > 0, cand["mule_prob"], d_km)

                factors = [
                    {
                        "factor": "Spatial Proximity to Candidate Centroid",
                        "weight": 0.28,
                        "value": f"{d_km:.2f} km",
                        "contribution": round(s_dist * frozen_penalty, 2),
                    },
                    {
                        "factor": "Inflow Recency & Velocity",
                        "weight": 0.24,
                        "value": f"{delta_h:.1f}h ago (vel {int(cand['velocity_1h'])}/h)",
                        "contribution": round(s_recency * frozen_penalty, 2),
                    },
                    {
                        "factor": "Mule Score & Net Retention",
                        "weight": 0.22,
                        "value": f"mule={cand['mule_prob']:.2f}, retain={cand['retention_ratio']*100:.0f}%",
                        "contribution": round(s_mule * frozen_penalty, 2),
                    },
                    {
                        "factor": "Historical ATM & DBSCAN Cluster Match",
                        "weight": 0.16,
                        "value": f"{exact_hits} prior hits" + (" (cluster)" if atm["id"] in cluster_atm_ids else ""),
                        "contribution": round(s_history * frozen_penalty, 2),
                    },
                    {
                        "factor": "ATM Capacity & 24x7 Fit",
                        "weight": 0.10,
                        "value": f"{atm['cash_capacity_tier']} / {'24x7' if atm['is_24x7'] else 'Limited'}",
                        "contribution": round(s_atm * frozen_penalty, 2),
                    },
                ]

                plain_lang = (
                    f"{atm['locality']} ({atm['bank']}) is {d_km:.2f} km from candidate "
                    f"{cand['account_number']} ({cand['holder_name']}), which received INR {cand['inflow_amount']:,.0f} "
                    f"{delta_h:.1f}h ago. Predicted window: {window}."
                )
                if cand["is_frozen"]:
                    plain_lang += " Note: linked account is currently frozen, reducing effective cash-out risk."

                best_by_atm[atm["id"]] = {
                    "atm_id": atm["id"],
                    "bank": atm["bank"],
                    "address": atm["address"],
                    "locality": atm["locality"],
                    "city": atm["city"],
                    "lat": float(atm["lat"]),
                    "lng": float(atm["lng"]),
                    "risk_score": risk_score,
                    "risk_level": risk_level,
                    "window": window,
                    "confidence": confidence,
                    "score_source": score_source,
                    "linked_accounts_json": [
                        {
                            "account_id": cand["account_id"],
                            "account_number": cand["account_number"],
                            "holder_name": cand["holder_name"],
                            "role": "CASH_OUT_CANDIDATE",
                            "retained_amount": cand["retained_amount"],
                        }
                    ],
                    "relevant_paths_json": paths_by_acc.get(aid, []),
                    "explanation_json": {
                        "plain_language": plain_lang,
                        "factors": factors,
                    },
                    "limitations_text": LIMITATIONS_TEXT,
                    "model_version": model_version,
                }

    ranked = sorted(best_by_atm.values(), key=lambda x: -x["risk_score"])[:top_n]
    for rank_idx, item in enumerate(ranked, start=1):
        item["rank_order"] = rank_idx

    # Replace previous predictions for this complaint so results stay crisp and consistent
    execute_write("DELETE FROM atm_predictions WHERE complaint_id = %s", (complaint_id,))

    for item in ranked:
        execute_write(
            """
            INSERT INTO atm_predictions (
                atm_id, complaint_id, risk_score, risk_level, "window", confidence,
                score_source, linked_accounts_json, relevant_paths_json,
                explanation_json, limitations_text, model_version, rank_order
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, %s)
            """,
            (
                item["atm_id"],
                complaint_id,
                item["risk_score"],
                item["risk_level"],
                item["window"],
                item["confidence"],
                item["score_source"],
                json.dumps(item["linked_accounts_json"]),
                json.dumps(item["relevant_paths_json"]),
                json.dumps(item["explanation_json"]),
                item["limitations_text"],
                item["model_version"],
                item["rank_order"],
            ),
        )

    if ranked:
        top = ranked[0]
        execute_write(
            """
            INSERT INTO risk_scores (entity_type, entity_id, composite_score, risk_level, score_source, factors_json)
            VALUES ('COMPLAINT', %s, %s, %s, %s, %s::jsonb)
            """,
            (
                complaint_id,
                top["risk_score"],
                top["risk_level"],
                score_source,
                json.dumps(top["explanation_json"]["factors"]),
            ),
        )

    return {
        "complaint_id": complaint_id,
        "complaint_number": complaint["complaint_number"],
        "score_source": score_source,
        "model_version": model_version,
        "top_3_atms": ranked[:3],
        "predictions": ranked,
    }
