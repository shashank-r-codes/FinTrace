from typing import Any, Literal
from pydantic import BaseModel, Field


class TraceRequest(BaseModel):
    account_id: str
    direction: Literal["forward", "reverse", "both"] = "forward"
    depth: int = Field(default=3, ge=1, le=6)
    complaint_id: str | None = None


class PathsRequest(BaseModel):
    source_account_id: str
    target_account_id: str | None = None
    complaint_id: str | None = None
    max_depth: int = Field(default=5, ge=1, le=8)


class GraphNode(BaseModel):
    id: str
    account_number: str
    holder_name: str
    account_type: str
    branch_city: str
    is_frozen: bool
    suspicious_classification: str | None = None
    mule_probability: float | None = None
    in_degree: int = 0
    out_degree: int = 0
    total_inflow: float = 0.0
    total_outflow: float = 0.0
    pass_through_ratio: float | None = None
    avg_forward_latency_sec: float | None = None
    pagerank: float = 0.0
    betweenness_centrality: float = 0.0


class GraphEdge(BaseModel):
    txn_id: str
    from_account: str
    to_account: str
    amount: float
    timestamp: str
    channel: str
    complaint_id: str | None = None
    hop_depth: int | None = None
    is_flagged_fraud: bool = False


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    timeline: list[dict[str, Any]]
    cycles: list[list[str]]
    summary: dict[str, Any]
