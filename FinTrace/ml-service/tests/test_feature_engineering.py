import pandas as pd
from app.services.feature_engineering import FEATURE_COLUMNS, compute_rule_based_mule_score
from app.services.trainer import time_based_split


def test_feature_columns_count_and_expected_features():
    assert len(FEATURE_COLUMNS) == 21
    for col in (
        "account_age_days",
        "pass_through_ratio",
        "avg_forward_latency_sec",
        "velocity_1h",
        "pagerank",
        "betweenness_centrality",
        "prior_atm_withdrawals",
    ):
        assert col in FEATURE_COLUMNS


def test_rule_based_mule_score_triggers_for_high_risk_profile():
    high_risk_row = pd.Series(
        {
            "account_age_days": 22.0,
            "kyc_verified": 0.0,
            "pass_through_ratio": 0.92,
            "min_forward_latency_sec": 240.0,
            "velocity_1h": 5.0,
        }
    )
    score, reasons = compute_rule_based_mule_score(high_risk_row)
    assert score == 0.99
    assert len(reasons) == 5

    low_risk_row = pd.Series(
        {
            "account_age_days": 900.0,
            "kyc_verified": 1.0,
            "pass_through_ratio": 0.15,
            "min_forward_latency_sec": 72000.0,
            "velocity_1h": 1.0,
        }
    )
    low_score, low_reasons = compute_rule_based_mule_score(low_risk_row)
    assert low_score == 0.0
    assert low_reasons == []


def test_time_based_split_preserves_temporal_order():
    rows = []
    for i in range(30):
        rows.append(
            {
                "account_id": f"acc-{i}",
                "activity_ts": 1700000000 + i * 3600,
                "label": 1 if i % 3 == 0 else 0,
                "account_age_days": 100.0,
            }
        )
    df = pd.DataFrame(rows)
    train_df, val_df, test_df, strategy = time_based_split(df)

    assert strategy == "time_based_split"
    assert len(train_df) + len(val_df) + len(test_df) == 30
    assert train_df["activity_ts"].max() <= val_df["activity_ts"].min()
    assert val_df["activity_ts"].max() <= test_df["activity_ts"].min()
