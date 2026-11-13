from fastapi import FastAPI
from app.db import fetch_one
from app.routers import atm, graph, ml

app = FastAPI(
    title="FinTrace ML & Graph Analytics Service",
    version="1.0.0",
    description="NetworkX transaction tracing, ML fraud/mule detection, SHAP explainability, and predictive ATM cash-out engine (Synthetic Demo).",
)

app.include_router(graph.router)
app.include_router(ml.router)
app.include_router(atm.router)


@app.get("/health")
def health() -> dict:
    try:
        fetch_one("SELECT 1 AS ok")
        db_status = "connected"
    except Exception:
        db_status = "disconnected"
    return {
        "service": "fintrace-ml-service",
        "status": "healthy" if db_status == "connected" else "degraded",
        "database": db_status,
        "synthetic_demo": True,
    }
