from fastapi import APIRouter, HTTPException
from app.db import fetch_all
from app.schemas import ScreeningPredictRequest, ScreeningPredictResponse
from app.services.explainer import detect_fraud_for_complaint, predict_screening_ml
from app.services.trainer import compute_atm_dbscan_clusters, train_and_evaluate_models

router = APIRouter(prefix="/ml", tags=["ml"])


@router.post("/train")
def train_models() -> dict:
    try:
        return train_and_evaluate_models()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/metrics")
def get_model_metrics() -> dict:
    rows = fetch_all(
        """
        SELECT *
        FROM model_metrics
        ORDER BY trained_at DESC
        LIMIT 10
        """
    )
    return {"metrics": rows}


@router.post("/detect/{complaint_id}")
def detect_complaint_fraud(complaint_id: str) -> dict:
    return detect_fraud_for_complaint(complaint_id)


@router.post("/screen/predict", response_model=ScreeningPredictResponse)
def predict_screening(request: ScreeningPredictRequest) -> dict:
    return predict_screening_ml(request)


@router.get("/clusters/atms")
def atm_clusters() -> dict:
    clusters = compute_atm_dbscan_clusters()
    return {"clusters": clusters, "count": len(clusters)}
