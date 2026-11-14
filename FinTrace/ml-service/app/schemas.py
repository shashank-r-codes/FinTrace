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


class ScreeningPredictRequest(BaseModel):
    sender_account_id: str
    receiver_account_id: str
    amount: float
    channel: str = "UPI"
    sender_risk_score: float = 10.0
    receiver_risk_score: float = 10.0
    sender_pass_through: float = 0.0
    receiver_pass_through: float = 0.0
    rapid_forward_count: int = 0
    is_first_time_beneficiary: bool = True
    hops_to_confirmed_fraud: int = 99
    device_fingerprint: str | None = None
    ip_address: str | None = None


class ShapFactor(BaseModel):
    factor: str
    value: float
    shap_value: float
    direction: str
    description: str


class ScreeningPredictResponse(BaseModel):
    fraud_probability: float
    anomaly_score: float
    is_anomaly: bool
    ml_score: float
    ml_classification: str
    model_version: str
    model_name: str
    latency_ms: float
    top_shap_factors: list[ShapFactor]
    score_source: str = "Trained ML prediction"


# ---------------- PHASE 5: GRAPH SCHEMAS ----------------


class MuleClusterMember(BaseModel):
    account_id: str
    account_number: str
    holder_name: str
    bank_name: str | None = None
    role: str = "MEMBER"
    risk_score: float = 0.0
    risk_classification: str = "LOW"
    mule_probability: float = 0.0
    in_degree: int = 0
    out_degree: int = 0
    total_inflow: float = 0.0
    total_outflow: float = 0.0
    is_frozen: bool = False


class MuleCluster(BaseModel):
    cluster_id: str
    cluster_type: str
    severity: str
    member_count: int
    members: list[MuleClusterMember]
    total_flow_amount: float
    transaction_count: int
    avg_transfer_latency_sec: float | None = None
    has_cycle: bool = False
    cycle_nodes: list[str] = []
    risk_score: float
    identified_patterns: list[str]
    recommended_action: str
    detected_at: str


class MuleClustersResponse(BaseModel):
    clusters: list[MuleCluster]
    total_clusters: int
    high_risk_clusters: int
    total_flagged_accounts: int
    total_exposure_amount: float


class GraphRiskPropagation(BaseModel):
    source_account_id: str
    target_account_id: str
    hop_distance: int
    attenuation_factor: float
    base_risk: float
    propagated_risk: float


class CounterpartyInfo(BaseModel):
    account_id: str
    account_number: str
    holder_name: str
    direction: str
    total_amount: float
    tx_count: int
    risk_classification: str = "LOW"


class AccountGraphIntelligence(BaseModel):
    account_id: str
    account_number: str
    holder_name: str
    subgraph_node_count: int = 0
    subgraph_edge_count: int = 0
    in_degree: int = 0
    out_degree: int = 0
    unique_senders: int = 0
    unique_receivers: int = 0
    pagerank: float = 0.0
    betweenness_centrality: float = 0.0
    distance_to_nearest_fraud_account: int | None = None
    nearest_fraud_account_id: str | None = None
    propagated_risk_score: float = 0.0
    is_part_of_cycle: bool = False
    cycle_count: int = 0
    mule_cluster_id: str | None = None
    mule_cluster_type: str | None = None
    mule_cluster_role: str | None = None
    cluster_risk_score: float | None = None
    fan_in_ratio: float = 0.0
    fan_out_ratio: float = 0.0
    pass_through_ratio: float | None = None
    avg_forward_latency_sec: float | None = None
    max_1h_velocity: int = 0
    top_counterparties: list[CounterpartyInfo] = []


class AccountSubgraphRequest(BaseModel):
    account_id: str
    direction: Literal["forward", "reverse", "both"] = "both"
    depth: int = Field(default=2, ge=1, le=5)
    complaint_id: str | None = None


