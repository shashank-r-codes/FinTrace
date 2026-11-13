# FinTrace System Architecture (`/docs/ARCHITECTURE.md`)

**Smart India Hackathon — Problem Statement PS 26184**  
*Development of a Predictive Analytics Framework for Cybercrime Complaints to Forecast Likely Cash Withdrawal Locations in Advance, Enabling Actionable Intelligence for Timely and Proactive Cybercrime Intervention.*

> **Synthetic Data Disclosure**: All seeded victims, bank accounts, transactions, ATM terminals, withdrawals, and fraud complaints in FinTrace are 100% synthetic demonstration records marked with `is_synthetic = TRUE`.

---

## 1. Container & Service Topology

FinTrace runs as a 4-service architecture orchestrated by `/FinTrace/docker-compose.yml`:

| Service | Tech Stack | Port | Responsibilities |
|---|---|---:|---|
| **`frontend`** | React 19, TypeScript, Vite 6, Tailwind CSS v4, Recharts, Leaflet, Cytoscape.js | `5173` | 12 protected command-centre workspaces + `/login`, RBAC-aware UI, network canvas, Leaflet geospatial hotspot map, SHAP explanations, and PDF/CSV downloads. |
| **`backend`** | Node.js 22, Express 4, TypeScript, Zod, Helmet, Pino, JWT, `pdfkit`, `@google/genai` | `4000` | REST API (`/api/v1/*`), JWT access + rotating refresh tokens, 4-role RBAC enforcement, parameterized `pg` queries, CSV/JSON transaction ingestion, SHA-256 evidence integrity, PDF dossier generation, immutable `audit_logs`, and grounded Gemini proxy. |
| **`ml-service`** | Python 3.10+, FastAPI, NetworkX, scikit-learn, XGBoost, SHAP, pandas, joblib | `8000` | Multi-hop graph traversal, cycle detection, 21 behavioral/graph features, Isolation Forest + XGBoost training (chronological split), TreeExplainer SHAP values, DBSCAN ATM clustering, and weighted ATM risk scoring. |
| **`postgres`** | PostgreSQL 16 (Alpine) | `5432` | Single source of truth across 22 normalized domain tables + `refresh_tokens` + `schema_migrations`, indexed views, recursive CTE money-trail tracing, and foreign-key constraints. |

---

## 2. End-to-End 9-Step Investigative Pipeline

1. **Complaint Registration (`/complaints`)**: Investigators register cybercrime complaints (`NCRP-YYYY-NNN`), victim context, reported loss (INR), and priority.
2. **Transaction Ingestion (`/transactions`)**: Operators ingest bank-statement CSV batches (`POST /api/v1/transactions/upload-csv`, up to 5,000 rows/batch) or single hops with `beneficiary_accounts` aggregation.
3. **Graph Money-Trail Tracing (`/graph`)**: Recursive SQL CTEs (`WITH RECURSIVE`) and Python NetworkX `MultiDiGraph` / `DiGraph` trace 1–5+ forward/reverse hops, compute receive-and-forward latency, 1-hour burst velocity, PageRank, betweenness centrality, and circular layering cycles.
4. **Mule & Anomaly Detection (`/fraud-ml`)**: Feature engineering computes 21 features per account from PostgreSQL. Training runs chronological `time_based_split` (with class-balanced temporal fallback when classes are skewed), trains **XGBoost** + **Isolation Forest**, persists `.joblib` artifacts, records real held-out test metrics (`Precision`, `Recall`, `F1`, `ROC-AUC`, `PR-AUC`, `Precision@K`, confusion matrix) in `model_metrics`, and generates **SHAP** attributions.
5. **Predictive ATM Cash-Out Ranking (`/atm-predictions`)**: Identifies downstream unfrozen candidate accounts retaining stolen funds, computes spatial centroids (65% historical ATM withdrawals + 35% branch coordinates), intersects DBSCAN hotspot clusters, and scores ATMs within 15 km on a 0–100 weighted scale (`score_source` tracked explicitly). See `/FinTrace/docs/ATM_ENGINE.md`.
6. **Geospatial Hotspot Visualization (`/map`)**: Renders ranked ATM risk markers, DBSCAN cluster centroids, historical flagged cash-outs, and candidate account markers over OpenStreetMap via Leaflet.
7. **Early Warning Alerts & Account Freeze (`/alerts`)**: Creates and triages alerts (`OPEN` -> `ACKNOWLEDGED` -> `DISPATCHED` -> `RESOLVED` / `FALSE_POSITIVE`). Investigators and Bank Nodal Officers execute account freeze/unfreeze actions (`PATCH /api/v1/accounts/:id/freeze`) with mandatory audit logging.
8. **Case Management, Evidence & Dossiers (`/investigations`, `/evidence`, `/reports`)**: Tracks investigation milestones, records SHA-256 chain-of-custody digests (including client/server verification), and exports RFC-4180 CSVs and multi-section `pdfkit` investigative PDF dossiers.
9. **AI Case Briefing & Governance (`/assistant`, `/settings`)**: Executes Gemini (`gemini-4-hydrogen`) strictly from the backend pre-loaded with verified PostgreSQL case records (`503 GEMINI_NOT_CONFIGURED` if unconfigured), while administrators manage RBAC roles and inspect the immutable `audit_logs` table.

---

## 3. Database Schema Overview (`/FinTrace/database/migrations/001_initial_schema.sql`)

- **Identity & Governance**: `roles`, `users`, `refresh_tokens`, `investigators`, `financial_institutions`, `audit_logs`
- **Complaints & Ledger**: `victims`, `complaints`, `bank_accounts`, `transactions`, `beneficiary_accounts`, `suspicious_accounts`
- **ATM Infrastructure**: `atms`, `atm_withdrawals`
- **Analytics, ML & Risk**: `transaction_networks`, `fraud_detection_results`, `model_metrics`, `ml_predictions`, `atm_predictions`, `risk_scores`
- **Operations & Custody**: `alerts`, `investigations`, `evidence_records`
- **Operational Tracking**: `schema_migrations` plus 3 summary views and performance indexes in `002_indexes_and_views.sql`.

---

## 4. Security & Provenance Guarantees

- **Strict Score Provenance**: Every ML, fraud, alert, and ATM prediction payload carries `score_source` restricted by SQL `CHECK` constraint to `'Trained ML prediction'`, `'Rule-based risk score'`, or `'Synthetic demo result'`.
- **No Unauthenticated Access & Least-Privilege RBAC**: Every `/api/v1/*` route (except `/health`, `/auth/login`, and `/auth/refresh`) requires a valid Bearer JWT and passes `authorizeRoles(...)` checks matching the 4-role matrix (`Administrator`, `Senior Investigator`, `Investigator`, `Bank Nodal Officer`).
- **Backend-Only AI Keys**: `GEMINI_API_KEY` never leaves the Express backend (`backend/src/modules/assistant/assistant.routes.ts`).
