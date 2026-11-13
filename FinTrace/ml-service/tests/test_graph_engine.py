from app.services.graph_engine import (
    analyze_subgraph,
    build_networkx_graph,
    compute_max_1h_velocity,
    compute_receive_and_forward_latency,
)


def test_receive_and_forward_latency_causal_matching():
    inflows = [
        {"timestamp": "2026-03-10T10:00:00Z", "amount": 100000},
        {"timestamp": "2026-03-10T10:30:00Z", "amount": 50000},
    ]
    outflows = [
        {"timestamp": "2026-03-10T10:05:00Z", "amount": 60000},  # 300s after 10:00
        {"timestamp": "2026-03-10T10:32:00Z", "amount": 50000},  # 120s after 10:30
    ]

    avg_lat, min_lat = compute_receive_and_forward_latency(inflows, outflows)
    assert avg_lat == 210.0
    assert min_lat == 120.0


def test_receive_and_forward_latency_none_when_no_causal_inflow():
    inflows = [{"timestamp": "2026-03-10T12:00:00Z", "amount": 10000}]
    outflows = [{"timestamp": "2026-03-10T11:00:00Z", "amount": 5000}]
    assert compute_receive_and_forward_latency(inflows, outflows) == (None, None)


def test_compute_max_1h_velocity():
    txs = [
        {"timestamp": "2026-03-10T09:00:00Z"},
        {"timestamp": "2026-03-10T10:05:00Z"},
        {"timestamp": "2026-03-10T10:25:00Z"},
        {"timestamp": "2026-03-10T10:50:00Z"},
        {"timestamp": "2026-03-10T12:15:00Z"},
    ]
    assert compute_max_1h_velocity(txs) == 3
    assert compute_max_1h_velocity([]) == 0


def test_build_and_analyze_subgraph_detects_cycles_and_metrics():
    accounts = [
        {
            "id": "acc-1",
            "account_number": "ACC001",
            "holder_name": "Victim",
            "account_type": "SAVINGS",
            "branch_city": "Bengaluru",
            "is_frozen": False,
        },
        {
            "id": "acc-2",
            "account_number": "ACC002",
            "holder_name": "Layer A",
            "account_type": "CURRENT",
            "branch_city": "Bengaluru",
            "is_frozen": False,
        },
        {
            "id": "acc-3",
            "account_number": "ACC003",
            "holder_name": "Layer B",
            "account_type": "WALLET",
            "branch_city": "Bengaluru",
            "is_frozen": False,
        },
    ]
    txs = [
        {
            "txn_id": "TXN-1",
            "from_account": "acc-1",
            "to_account": "acc-2",
            "amount": 100000,
            "timestamp": "2026-03-10T10:00:00Z",
            "channel": "IMPS",
            "complaint_id": "cmp-1",
            "hop_depth": 1,
            "is_flagged_fraud": True,
        },
        {
            "txn_id": "TXN-2",
            "from_account": "acc-2",
            "to_account": "acc-3",
            "amount": 95000,
            "timestamp": "2026-03-10T10:03:00Z",
            "channel": "UPI",
            "complaint_id": "cmp-1",
            "hop_depth": 2,
            "is_flagged_fraud": True,
        },
        {
            "txn_id": "TXN-3",
            "from_account": "acc-3",
            "to_account": "acc-2",
            "amount": 90000,
            "timestamp": "2026-03-10T10:08:00Z",
            "channel": "UPI",
            "complaint_id": "cmp-1",
            "hop_depth": 3,
            "is_flagged_fraud": True,
        },
    ]
    susp = [
        {
            "account_id": "acc-2",
            "classification": "SUSPECTED_MULE",
            "mule_probability": 0.91,
            "status": "ACTIVE",
        }
    ]

    mg, dg = build_networkx_graph(accounts, txs, susp)
    result = analyze_subgraph(mg, dg, txs)

    assert result["summary"]["node_count"] == 3
    assert result["summary"]["edge_count"] == 3
    assert result["summary"]["total_amount"] == 285000.0
    assert result["summary"]["has_cycles"] is True
    assert result["summary"]["cycle_count"] == 1
    assert len(result["timeline"]) == 3
    assert result["timeline"][1]["delta_from_prev_sec"] == 180.0
    acc2_node = next(n for n in result["nodes"] if n["id"] == "acc-2")
    assert acc2_node["suspicious_classification"] == "SUSPECTED_MULE"
    assert acc2_node["min_forward_latency_sec"] == 180.0
