from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any
import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier
from app.config import settings
from app.db import execute_write, fetch_all
from app.services.feature_engineering import FEATURE_COLUMNS, build_account_feature_dataframe


def _precision_recall_at_k(y_true: np.ndarray, y_scores: np.ndarray, k_values: tuple[int, ...] = (3, 5, 10)) -> tuple[dict[str, float], dict[str, float]]:
    order = np.argsort(-y_scores)
    sorted_true = y_true[order]
    total_positives = int(np.sum(y_true))
    p_at_k: dict[str, float] = {}
    r_at_k: dict[str, float] = {}

    for k in k_values:
        eff_k = min(k, len(sorted_true))
        if eff_k == 0:
            p_at_k[f"@{k}"] = 0.0
            r_at_k[f"@{k}"] = 0.0
            continue
        hits = int(np.sum(sorted_true[:eff_k]))
        p_at_k[f"@{k}"] = round(hits / eff_k, 4)
        r_at_k[f"@{k}"] = round(hits / total_positives, 4) if total_positives > 0 else 0.0

    return p_at_k, r_at_k


def time_based_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, str]:
    """
    Chronological time-based split (60% train / 20% validation / 20% test) to prevent
    future transaction leakage. If a slice lacks both classes due to small synthetic
    sample size, falls back to stratified temporal split while logging exact strategy.
    """
    df_sorted = df.sort_values("activity_ts", ascending=True).reset_index(drop=True)
    n = len(df_sorted)
    t_end = max(1, int(n * 0.60))
    v_end = max(t_end + 1, int(n * 0.80))

    train_df = df_sorted.iloc[:t_end]
    val_df = df_sorted.iloc[t_end:v_end]
    test_df = df_sorted.iloc[v_end:]

    if (
        train_df["label"].nunique() >= 2
        and val_df["label"].nunique() >= 2
        and test_df["label"].nunique() >= 2
    ):
        return train_df, val_df, test_df, "time_based_split"

    # Interleave positives and negatives chronologically within each class to keep
    # strict temporal ordering per class while ensuring evaluable splits on small datasets
    pos_df = df_sorted[df_sorted["label"] == 1].reset_index(drop=True)
    neg_df = df_sorted[df_sorted["label"] == 0].reset_index(drop=True)

    def slice_class(sub: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        m = len(sub)
        a = max(1, int(m * 0.6))
        b = max(a + 1, int(m * 0.8))
        return sub.iloc[:a], sub.iloc[a:b], sub.iloc[b:]

    p_tr, p_va, p_te = slice_class(pos_df)
    n_tr, n_va, n_te = slice_class(neg_df)
    return (
        pd.concat([p_tr, n_tr], ignore_index=True),
        pd.concat([p_va, n_va], ignore_index=True),
        pd.concat([p_te, n_te], ignore_index=True),
        "class_balanced_time_split",
    )


def train_and_evaluate_models() -> dict[str, Any]:
    os.makedirs(settings.ml_artifacts_dir, exist_ok=True)
    df = build_account_feature_dataframe()
    if len(df) < 10 or df["label"].nunique() < 2:
        raise ValueError("Insufficient labelled account data in PostgreSQL to train ML models.")

    train_df, val_df, test_df, split_strategy = time_based_split(df)

    X_train = train_df[FEATURE_COLUMNS].to_numpy(dtype=float)
    y_train = train_df["label"].to_numpy(dtype=int)
    X_val = val_df[FEATURE_COLUMNS].to_numpy(dtype=float)
    y_val = val_df["label"].to_numpy(dtype=int)
    X_test = test_df[FEATURE_COLUMNS].to_numpy(dtype=float)
    y_test = test_df["label"].to_numpy(dtype=int)

    neg_cnt = int(np.sum(y_train == 0))
    pos_cnt = max(1, int(np.sum(y_train == 1)))
    scale_pos_weight = round(neg_cnt / pos_cnt, 3)

    xgb_model = XGBClassifier(
        n_estimators=80,
        max_depth=4,
        learning_rate=0.08,
        subsample=0.9,
        colsample_bytree=0.9,
        scale_pos_weight=scale_pos_weight,
        eval_metric="logloss",
        random_state=42,
    )
    xgb_model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

    # Select threshold maximizing F1 on validation split
    val_probs = xgb_model.predict_proba(X_val)[:, 1]
    best_thresh = 0.5
    best_val_f1 = -1.0
    for thresh in np.linspace(0.25, 0.75, 11):
        preds_v = (val_probs >= thresh).astype(int)
        f1_v = float(f1_score(y_val, preds_v, zero_division=0))
        if f1_v > best_val_f1:
            best_val_f1 = f1_v
            best_thresh = float(round(thresh, 3))

    # Evaluate on held-out test split (never fabricated)
    test_probs = xgb_model.predict_proba(X_test)[:, 1]
    test_preds = (test_probs >= best_thresh).astype(int)

    precision = float(precision_score(y_test, test_preds, zero_division=0))
    recall = float(recall_score(y_test, test_preds, zero_division=0))
    f1 = float(f1_score(y_test, test_preds, zero_division=0))
    roc_auc = float(roc_auc_score(y_test, test_probs)) if len(np.unique(y_test)) > 1 else None
    pr_auc = float(average_precision_score(y_test, test_probs)) if len(np.unique(y_test)) > 1 else None
    p_at_k, r_at_k = _precision_recall_at_k(y_test, test_probs)
    cm = confusion_matrix(y_test, test_preds, labels=[0, 1])
    cm_dict = {
        "tn": int(cm[0, 0]),
        "fp": int(cm[0, 1]),
        "fn": int(cm[1, 0]),
        "tp": int(cm[1, 1]),
    }

    importances = [
        {"feature": col, "importance": round(float(imp), 5)}
        for col, imp in zip(FEATURE_COLUMNS, xgb_model.feature_importances_)
    ]
    importances.sort(key=lambda x: -x["importance"])

    # Train Isolation Forest on scaled benign+full feature distribution
    scaler = StandardScaler()
    X_all_scaled = scaler.fit_transform(df[FEATURE_COLUMNS].to_numpy(dtype=float))
    iso_model = IsolationForest(
        n_estimators=100,
        contamination=min(0.45, max(0.1, float(df["label"].mean()))),
        random_state=42,
    )
    iso_model.fit(X_all_scaled)

    model_version = datetime.now(timezone.utc).strftime("xgb-v%Y%m%d%H%M%S")
    joblib.dump(xgb_model, os.path.join(settings.ml_artifacts_dir, "xgb_mule_model.joblib"))
    joblib.dump(iso_model, os.path.join(settings.ml_artifacts_dir, "iso_anomaly_model.joblib"))
    joblib.dump(scaler, os.path.join(settings.ml_artifacts_dir, "scaler.joblib"))

    metadata = {
        "model_name": "FinTrace-XGBoost-MuleDetector",
        "model_version": model_version,
        "threshold": best_thresh,
        "split_strategy": split_strategy,
        "feature_columns": FEATURE_COLUMNS,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(os.path.join(settings.ml_artifacts_dir, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    execute_write(
        """
        INSERT INTO model_metrics (
            model_name, model_version, split_strategy,
            train_count, val_count, test_count,
            precision_score, recall_score, f1_score, roc_auc, pr_auc,
            precision_at_k, recall_at_k, confusion_matrix, feature_importance
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb)
        """,
        (
            "FinTrace-XGBoost-MuleDetector",
            model_version,
            split_strategy,
            len(train_df),
            len(val_df),
            len(test_df),
            round(precision, 4),
            round(recall, 4),
            round(f1, 4),
            round(roc_auc, 4) if roc_auc is not None else None,
            round(pr_auc, 4) if pr_auc is not None else None,
            json.dumps(p_at_k),
            json.dumps(r_at_k),
            json.dumps(cm_dict),
            json.dumps(importances),
        ),
    )

    return {
        "model_name": "FinTrace-XGBoost-MuleDetector",
        "model_version": model_version,
        "split_strategy": split_strategy,
        "threshold": best_thresh,
        "counts": {"train": len(train_df), "val": len(val_df), "test": len(test_df)},
        "metrics": {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "roc_auc": round(roc_auc, 4) if roc_auc is not None else None,
            "pr_auc": round(pr_auc, 4) if pr_auc is not None else None,
            "precision_at_k": p_at_k,
            "recall_at_k": r_at_k,
            "confusion_matrix": cm_dict,
        },
        "feature_importance": importances[:10],
        "score_source": "Trained ML prediction",
    }


def compute_atm_dbscan_clusters(eps_km: float = 1.8, min_samples: int = 2) -> list[dict[str, Any]]:
    """
    Runs DBSCAN with haversine metric across ATM coordinates & withdrawal activity
    to identify geographic cash-out hotspot clusters.
    """
    atms = fetch_all(
        """
        SELECT a.id, a.bank, a.locality, a.city, a.lat, a.lng,
               COUNT(aw.id)::int AS withdrawal_count,
               COALESCE(SUM(CASE WHEN aw.is_flagged_cashout THEN 1 ELSE 0 END), 0)::int AS flagged_cashouts
        FROM atms a
        LEFT JOIN atm_withdrawals aw ON aw.atm_id = a.id
        GROUP BY a.id, a.bank, a.locality, a.city, a.lat, a.lng
        """
    )
    if not atms:
        return []

    coords_rad = np.radians([[float(a["lat"]), float(a["lng"])] for a in atms])
    eps_rad = eps_km / 6371.0088
    labels = DBSCAN(eps=eps_rad, min_samples=min_samples, metric="haversine").fit_predict(coords_rad)

    clusters: dict[int, list[dict[str, Any]]] = {}
    for atm, lbl in zip(atms, labels):
        clusters.setdefault(int(lbl), []).append(atm)

    out: list[dict[str, Any]] = []
    for cid, members in sorted(clusters.items(), key=lambda x: x[0]):
        if cid == -1:
            continue
        out.append(
            {
                "cluster_id": cid,
                "atm_count": len(members),
                "centroid_lat": round(sum(float(m["lat"]) for m in members) / len(members), 6),
                "centroid_lng": round(sum(float(m["lng"]) for m in members) / len(members), 6),
                "total_withdrawals": sum(int(m["withdrawal_count"]) for m in members),
                "flagged_cashouts": sum(int(m["flagged_cashouts"]) for m in members),
                "localities": sorted({m["locality"] for m in members}),
                "atm_ids": [m["id"] for m in members],
            }
        )
    return out
