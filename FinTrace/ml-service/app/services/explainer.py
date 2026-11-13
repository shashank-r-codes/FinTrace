from __future__ import annotations

import json
import os
from typing import Any
import joblib
import numpy as np
import shap
from app.config import settings
from app.db import execute_write, fetch_all
from app.services.feature_engineering import (
    FEATURE_COLUMNS,
    build_account_feature_dataframe,
    compute_rule_based_mule_score,
)


def _load_artifacts() -> tuple[Any, Any, Any, dict[str, Any]] | None:
    xgb_path = os.path.join(settings.ml_artifacts_dir, "xgb_mule_model.joblib")
    iso_path = os.path.join(settings.ml_artifacts_dir, "iso_anomaly_model.joblib")
    scaler_path = os.path.join(settings.ml_artifacts_dir, "scaler.joblib")
    meta_path = os.path.join(settings.ml_artifacts_dir, "metadata.json")

    if not (
        os.path.exists(xgb_path)
        and os.path.exists(iso_path)
        and os.path.exists(scaler_path)
        and os.path.exists(meta_path)
    ):
        return None

    xgb_model = joblib.load(xgb_path)
    iso_model = joblib.load(iso_path)
    scaler = joblib.load(scaler_path)
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    return xgb_model, iso_model, scaler, meta


def detect_fraud_for_complaint(complaint_id: str) -> dict[str, Any]:
    tx_rows = fetch_all(
        """
        SELECT DISTINCT from_account, to_account
        FROM transactions
        WHERE complaint_id = %s
        """,
        (complaint_id,),
    )
    acc_ids = list(
        {str(r["from_account"]) for r in tx_rows} | {str(r["to_account"]) for r in tx_rows}
    )
    if not acc_ids:
        return {"complaint_id": complaint_id, "predictions": [], "score_source": "Rule-based risk score"}

    df = build_account_feature_dataframe(account_ids=acc_ids)
    artifacts = _load_artifacts()

    results: list[dict[str, Any]] = []

    if artifacts is not None:
        xgb_model, iso_model, scaler, meta = artifacts
        X = df[FEATURE_COLUMNS].to_numpy(dtype=float)
        probs = xgb_model.predict_proba(X)[:, 1]
        X_scaled = scaler.transform(X)
        iso_preds = iso_model.predict(X_scaled)
        iso_scores = -iso_model.decision_function(X_scaled)

        explainer = shap.TreeExplainer(xgb_model)
        shap_matrix = explainer.shap_values(X)
        if isinstance(shap_matrix, list):
            shap_matrix = shap_matrix[1]

        threshold = float(meta.get("threshold", 0.5))
        model_version = str(meta.get("model_version", "xgb-v1"))
        model_name = str(meta.get("model_name", "FinTrace-XGBoost-MuleDetector"))
        score_source = "Trained ML prediction"

        for idx, row in df.iterrows():
            prob = float(probs[idx])
            is_anom = bool(iso_preds[idx] == -1)
            anom_score = round(float(iso_scores[idx]), 4)
            predicted_label = "SUSPECTED_MULE" if prob >= threshold else ("ANOMALY_REVIEW" if is_anom else "LOW_RISK")

            row_shaps = shap_matrix[idx]
            shap_list = [
                {
                    "feature": col,
                    "value": round(float(row[col]), 4),
                    "shap_value": round(float(sv), 5),
                    "direction": "increases_risk" if float(sv) >= 0 else "decreases_risk",
                }
                for col, sv in zip(FEATURE_COLUMNS, row_shaps)
            ]
            shap_list.sort(key=lambda s: -abs(s["shap_value"]))
            top_shaps = shap_list[:6]

            features_dict = {col: round(float(row[col]), 4) for col in FEATURE_COLUMNS}
            mule_score_100 = round(prob * 100.0, 2)

            execute_write(
                """
                INSERT INTO ml_predictions (
                    account_id, complaint_id, model_name, model_version,
                    predicted_label, raw_score, score_source, shap_values_json, features_json
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
                """,
                (
                    row["account_id"],
                    complaint_id,
                    model_name,
                    model_version,
                    predicted_label,
                    round(prob, 4),
                    score_source,
                    json.dumps(top_shaps),
                    json.dumps(features_dict),
                ),
            )

            execute_write(
                """
                INSERT INTO fraud_detection_results (
                    complaint_id, account_id, is_anomaly, anomaly_score, mule_score,
                    score_source, velocity_1h, pass_through_ratio, avg_forward_latency_sec, explanation_json
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    complaint_id,
                    row["account_id"],
                    is_anom,
                    anom_score,
                    mule_score_100,
                    score_source,
                    int(row["velocity_1h"]),
                    round(float(row["pass_through_ratio"]), 4),
                    None if row["avg_forward_latency_sec"] >= 999999 else float(row["avg_forward_latency_sec"]),
                    json.dumps({"top_shap_factors": top_shaps, "model_version": model_version}),
                ),
            )

            results.append(
                {
                    "account_id": row["account_id"],
                    "account_number": row["account_number"],
                    "holder_name": row["holder_name"],
                    "predicted_label": predicted_label,
                    "mule_probability": round(prob, 4),
                    "mule_score": mule_score_100,
                    "is_anomaly": is_anom,
                    "anomaly_score": anom_score,
                    "score_source": score_source,
                    "model_version": model_version,
                    "top_shap_factors": top_shaps,
                }
            )
    else:
        score_source = "Rule-based risk score"
        for _, row in df.iterrows():
            prob, reasons = compute_rule_based_mule_score(row)
            mule_score_100 = round(prob * 100.0, 2)
            predicted_label = "SUSPECTED_MULE" if prob >= 0.55 else "LOW_RISK"

            execute_write(
                """
                INSERT INTO fraud_detection_results (
                    complaint_id, account_id, is_anomaly, anomaly_score, mule_score,
                    score_source, velocity_1h, pass_through_ratio, avg_forward_latency_sec, explanation_json
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    complaint_id,
                    row["account_id"],
                    prob >= 0.55,
                    prob,
                    mule_score_100,
                    score_source,
                    int(row["velocity_1h"]),
                    round(float(row["pass_through_ratio"]), 4),
                    None if row["avg_forward_latency_sec"] >= 999999 else float(row["avg_forward_latency_sec"]),
                    json.dumps({"rule_factors": reasons}),
                ),
            )

            results.append(
                {
                    "account_id": row["account_id"],
                    "account_number": row["account_number"],
                    "holder_name": row["holder_name"],
                    "predicted_label": predicted_label,
                    "mule_probability": prob,
                    "mule_score": mule_score_100,
                    "is_anomaly": prob >= 0.55,
                    "anomaly_score": prob,
                    "score_source": score_source,
                    "model_version": "rule-heuristic-v1",
                    "top_shap_factors": reasons,
                }
            )

    results.sort(key=lambda r: -r["mule_score"])
    return {
        "complaint_id": complaint_id,
        "score_source": score_source,
        "predictions": results,
    }
