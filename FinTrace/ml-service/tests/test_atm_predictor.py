from app.services import atm_predictor


def test_haversine_distance_bengaluru_landmarks():
    # Majestic to Indiranagar is ~7-8 km
    dist = atm_predictor.haversine_km(12.9767, 77.5713, 12.9784, 77.6408)
    assert 6.5 <= dist <= 9.0
    assert atm_predictor.haversine_km(12.97, 77.59, 12.97, 77.59) == 0.0


def test_risk_level_window_and_confidence_helpers():
    assert atm_predictor.classify_risk_level(84.5) == "Critical"
    assert atm_predictor.classify_risk_level(70.0) == "High"
    assert atm_predictor.classify_risk_level(50.0) == "Medium"
    assert atm_predictor.classify_risk_level(25.0) == "Low"

    assert atm_predictor.assign_time_window(82.0, 2.0) == "0-6h"
    assert atm_predictor.assign_time_window(68.0, 10.0) == "6-12h"
    assert atm_predictor.assign_time_window(50.0, 20.0) == "12-24h"
    assert atm_predictor.assign_time_window(30.0, 2.0) == ">24h"

    assert atm_predictor.assign_confidence(True, 0.4, 8.0) == "High"
    assert atm_predictor.assign_confidence(False, 0.85, 1.5) == "High"
    assert atm_predictor.assign_confidence(False, 0.5, 4.0) == "Moderate"
    assert atm_predictor.assign_confidence(False, 0.5, 9.0) == "Low"


def test_limitations_text_clarifies_weighted_score_not_calibrated_probability():
    text = atm_predictor.LIMITATIONS_TEXT.lower()
    assert "weighted risk score" in text
    assert "not a calibrated probability" in text


def test_predict_atms_for_complaint_with_mocked_db(monkeypatch):
    complaint_row = {
        "id": "cmp-1",
        "complaint_number": "NCRP-2026-001",
        "fraud_type": "UPI_PHISHING",
        "reported_amount": 120000,
        "status": "TRACING",
        "city": "Bengaluru",
    }
    tx_rows = [
        {
            "txn_id": "TXN-100",
            "from_account": "acc-victim",
            "to_account": "acc-mule",
            "amount": 120000,
            "timestamp": "2026-03-10T10:00:00+00:00",
            "channel": "UPI",
            "complaint_id": "cmp-1",
            "hop_depth": 1,
            "is_flagged_fraud": True,
        }
    ]
    accounts_rows = [
        {
            "id": "acc-victim",
            "account_number": "VIC001",
            "holder_name": "Victim One",
            "account_type": "SAVINGS",
            "branch_city": "Bengaluru",
            "branch_lat": 12.9716,
            "branch_lng": 77.5946,
            "kyc_verified": True,
            "account_age_days": 800,
            "is_frozen": False,
            "created_at": "2024-01-01T00:00:00+00:00",
        },
        {
            "id": "acc-mule",
            "account_number": "MULE001",
            "holder_name": "Mule One",
            "account_type": "CURRENT",
            "branch_city": "Bengaluru",
            "branch_lat": 12.9352,
            "branch_lng": 77.6245,
            "kyc_verified": False,
            "account_age_days": 20,
            "is_frozen": False,
            "created_at": "2026-02-01T00:00:00+00:00",
        },
    ]
    atms_rows = [
        {
            "id": "ATM-BLR-NEAR",
            "bank": "HDFC Bank",
            "address": "Koramangala 4th Block",
            "locality": "Koramangala",
            "city": "Bengaluru",
            "lat": 12.9360,
            "lng": 77.6250,
            "cash_capacity_tier": "HIGH",
            "is_24x7": True,
        },
        {
            "id": "ATM-BLR-FAR",
            "bank": "ICICI Bank",
            "address": "Yelahanka",
            "locality": "Yelahanka",
            "city": "Bengaluru",
            "lat": 13.1007,
            "lng": 77.5963,
            "cash_capacity_tier": "LOW",
            "is_24x7": False,
        },
    ]

    monkeypatch.setattr(atm_predictor, "fetch_one", lambda sql, params=None: complaint_row)

    def fake_fetch_all(sql, params=None):
        if "FROM transactions" in sql:
            return tx_rows
        if "FROM bank_accounts" in sql:
            return accounts_rows
        if "FROM suspicious_accounts" in sql:
            return []
        if "FROM atm_withdrawals" in sql:
            return []
        if "FROM atms" in sql:
            return atms_rows
        return []

    import pandas as pd

    monkeypatch.setattr(atm_predictor, "fetch_all", fake_fetch_all)
    monkeypatch.setattr(
        atm_predictor,
        "build_account_feature_dataframe",
        lambda account_ids=None: pd.DataFrame(
            [
                {
                    "account_id": "acc-mule",
                    "account_age_days": 20.0,
                    "kyc_verified": 0.0,
                    "pass_through_ratio": 0.0,
                    "min_forward_latency_sec": 999999.0,
                    "velocity_1h": 1.0,
                }
            ]
        ),
    )
    monkeypatch.setattr(atm_predictor, "_load_artifacts", lambda: None)
    monkeypatch.setattr(atm_predictor, "compute_atm_dbscan_clusters", lambda: [])
    writes = []
    monkeypatch.setattr(atm_predictor, "execute_write", lambda sql, params=None: writes.append(sql))

    res = atm_predictor.predict_atms_for_complaint("cmp-1", top_n=5)
    assert res["score_source"] == "Rule-based risk score"
    assert len(res["predictions"]) == 1  # Yelahanka > 15 km filtered out
    top = res["predictions"][0]
    assert top["atm_id"] == "ATM-BLR-NEAR"
    assert top["rank_order"] == 1
    assert 0.0 <= top["risk_score"] <= 100.0
    assert len(writes) >= 2
