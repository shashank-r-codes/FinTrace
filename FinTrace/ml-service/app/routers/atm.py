from fastapi import APIRouter, HTTPException, Query
from app.db import fetch_all
from app.services.atm_predictor import predict_atms_for_complaint

router = APIRouter(prefix="/atm", tags=["atm-prediction"])


@router.post("/predict/{complaint_id}")
def run_atm_prediction(complaint_id: str, top_n: int = Query(default=8, ge=1, le=20)) -> dict:
    try:
        return predict_atms_for_complaint(complaint_id=complaint_id, top_n=top_n)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/heatmap")
def atm_heatmap() -> dict:
    rows = fetch_all(
        """
        SELECT a.id AS atm_id, a.bank, a.locality, a.city, a.lat, a.lng,
               COALESCE(MAX(ap.risk_score), 0)::float AS max_risk_score,
               COUNT(ap.id)::int AS prediction_count
        FROM atms a
        LEFT JOIN atm_predictions ap ON ap.atm_id = a.id
        GROUP BY a.id, a.bank, a.locality, a.city, a.lat, a.lng
        ORDER BY max_risk_score DESC
        """
    )
    return {"points": rows}
