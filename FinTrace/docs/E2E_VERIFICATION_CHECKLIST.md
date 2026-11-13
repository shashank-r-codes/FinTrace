# FinTrace End-to-End Verification Checklist (`/docs/E2E_VERIFICATION_CHECKLIST.md`)

Run through this checklist after booting the stack with Docker Compose (`docker compose up --build`) or local development servers to validate every module end-to-end against PostgreSQL.

---

## 1. Infrastructure & Database Boot Checks
- [ ] Copy `.env.example` to `.env` and populate secrets (`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, optional `GEMINI_API_KEY`).
- [ ] Verify PostgreSQL 16 passes healthcheck and migrations `001_initial_schema.sql` & `002_indexes_and_views.sql` are applied (`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'` returns 23 tables including `schema_migrations`, plus 3 views).
- [ ] Run synthetic seed:
  ```bash
  cd database && npm install && npm run seed:reset
  ```
- [ ] Check API health: `curl http://localhost:4000/api/v1/health` returns `database: "connected"` and `syntheticDemo: true`.
- [ ] Check ML service health: `curl http://localhost:8000/health` returns `status: "healthy"`.

---

## 2. Authentication & 4-Role RBAC Verification
- [ ] Open `http://localhost:5173/login` and verify the synthetic demo warning banner is visible.
- [ ] Sign in as `admin@fintrace.in` (`FinTrace@Demo2026`); verify redirect to `/` Command Overview dashboard.
- [ ] Reload the page (`F5`) and verify silent token restore (`/api/v1/auth/me` / `/api/v1/auth/refresh`).
- [ ] Sign in as `nodal@sbi-demo.in` (`Bank Nodal Officer`) and verify:
  - [ ] Sidebar hides `Investigations`, `Evidence`, `Reports`, `AI Assistant`, and `Users & Audit`.
  - [ ] Navigating directly to `/settings` redirects to `/`.
  - [ ] Calling `POST /api/v1/users` returns `403 FORBIDDEN`.

---

## 3. Core 9-Step Investigative Flow
1. **Complaints (`/complaints`)**:
   - [ ] Filter existing synthetic complaints (`NCRP-2026-...`), inspect a detail drawer, and register a new complaint via the intake modal.
2. **Transaction Explorer (`/transactions`)**:
   - [ ] Filter transactions by channel (`UPI`, `IMPS`, etc.) and search by account number.
   - [ ] Upload a CSV batch (`txn_id,from_account,to_account,amount,timestamp,channel,...`) and confirm insertion & duplicate counts match PostgreSQL.
3. **Money-Trail Network Graph (`/graph`)**:
   - [ ] Load `NCRP-2026-001` in Cytoscape.js, inspect node receive-and-forward latency, PageRank, and cycle badges, and toggle recursive SQL CTE trace edges.
4. **Fraud & Mule ML Detection (`/fraud-ml`)**:
   - [ ] Click **Train & Evaluate Models** (`POST /api/v1/ml/train`); confirm real split counts (`train / val / test`), `roc_auc`, `pr_auc`, confusion matrix, and feature importance populate from `model_metrics`.
   - [ ] Run **Score Complaint** (`POST /api/v1/ml/score/complaint/:id`) and confirm `score_source` switches to `"Trained ML prediction"` with SHAP factor contributions.
5. **ATM Prediction Engine (`/atm-predictions`)**:
   - [ ] Trigger **Run Predictive ATM Forecast** for a complaint; inspect Top-3 predicted ATM cards, weighted `risk_score` (0–100), predicted cash-out window (`0-6h`, `6-12h`, etc.), limitations disclaimer, and weighted factor breakdown.
6. **Geospatial Hotspot Map (`/map`)**:
   - [ ] Verify OpenStreetMap + Leaflet renders predicted ATM markers sized/colored by severity, DBSCAN hotspot circles, and candidate branch centroids.
7. **Alerts & Account Freeze (`/alerts`)**:
   - [ ] Acknowledge/dispatch an `OPEN` cash-out alert.
   - [ ] Execute **Freeze Account** on a suspected mule account and verify `is_frozen = TRUE` persists in `/transactions`, `/graph`, and `/reports`.
8. **Investigations, Evidence & Reports (`/investigations`, `/evidence`, `/reports`)**:
   - [ ] Update investigation status and toggle a recommended action checklist item.
   - [ ] Record a new evidence artifact and verify SHA-256 digest matching (`Matched = true`) and mismatch rejection (`Matched = false`).
   - [ ] Download a CSV export (`complaints`, `transactions`, `predictions`, `alerts`) and a `pdfkit` PDF Case Dossier (`/api/v1/reports/export/pdf/:complaintId`).
9. **AI Assistant & Audit Governance (`/assistant`, `/settings`)**:
   - [ ] Without `GEMINI_API_KEY`, verify `/assistant` displays the non-blocking backend configuration notice and returns `503 GEMINI_NOT_CONFIGURED` cleanly without fabricating answers.
   - [ ] With a valid `GEMINI_API_KEY`, query a complaint and verify the answer cites exact PostgreSQL IDs and `score_source`.
   - [ ] Open `/settings` -> **Immutable Audit Trail** and confirm `USER_LOGIN`, `ML_MODEL_TRAINED`, `ACCOUNT_FROZEN`, `EVIDENCE_VERIFIED`, and `REPORT_PDF_EXPORTED` events are logged chronologically.
