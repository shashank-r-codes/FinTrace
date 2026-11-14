from __future__ import annotations

from typing import Literal
from fastapi import APIRouter, HTTPException, Query
from app.schemas import (
    AccountSubgraphRequest,
    PathsRequest,
    TraceRequest,
)
from app.services.graph_engine import (
    detect_mule_clusters,
    extract_account_graph_intelligence,
    extract_account_subgraph,
    find_suspicious_paths,
    get_account_graph_metrics,
    trace_complaint_graph,
    trace_from_db,
)

router = APIRouter(prefix="/graph", tags=["graph"])


@router.post("/trace")
def trace_account(payload: TraceRequest) -> dict:
    return trace_from_db(
        account_id=payload.account_id,
        direction=payload.direction,
        depth=payload.depth,
        complaint_id=payload.complaint_id,
    )


@router.get("/complaint/{complaint_id}")
def trace_complaint(complaint_id: str) -> dict:
    return trace_complaint_graph(complaint_id)


@router.post("/paths")
def suspicious_paths(payload: PathsRequest) -> dict:
    paths = find_suspicious_paths(
        source_account_id=payload.source_account_id,
        target_account_id=payload.target_account_id,
        complaint_id=payload.complaint_id,
        max_depth=payload.max_depth,
    )
    return {"paths": paths, "count": len(paths)}


@router.get("/metrics/{account_id}")
def account_metrics(account_id: str) -> dict:
    metrics = get_account_graph_metrics(account_id)
    if metrics is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return metrics


# ---------------- PHASE 5: PREVENTION GRAPH INTELLIGENCE & MULE SYNDICATE ENDPOINTS ----------------


@router.post("/account-subgraph")
def account_subgraph_post(payload: AccountSubgraphRequest) -> dict:
    try:
        return extract_account_subgraph(
            account_id=payload.account_id,
            direction=payload.direction,
            depth=payload.depth,
            complaint_id=payload.complaint_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to extract subgraph: {exc}")


@router.get("/account/{account_id}/subgraph")
def account_subgraph_get(
    account_id: str,
    depth: int = Query(default=2, ge=1, le=5),
    direction: Literal["forward", "reverse", "both"] = Query(default="both"),
) -> dict:
    try:
        return extract_account_subgraph(
            account_id=account_id,
            direction=direction,
            depth=depth,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to extract subgraph: {exc}")


@router.get("/mule-clusters")
def get_mule_clusters(
    min_cluster_size: int = Query(default=2, ge=2, le=20),
    min_risk_score: float = Query(default=30.0, ge=0.0, le=100.0),
) -> dict:
    try:
        return detect_mule_clusters(
            min_cluster_size=min_cluster_size,
            min_risk_score=min_risk_score,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to detect mule clusters: {exc}")


@router.get("/account/{account_id}/graph-intelligence")
def account_graph_intel(account_id: str) -> dict:
    data = extract_account_graph_intelligence(account_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Account '{account_id}' not found")
    return data
