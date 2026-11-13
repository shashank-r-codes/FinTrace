from fastapi import APIRouter, HTTPException
from app.schemas import PathsRequest, TraceRequest
from app.services.graph_engine import (
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
