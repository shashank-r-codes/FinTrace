# FinTrace — Predictive Cybercrime Intelligence & ATM Cash-Out Forecasting Platform

**Smart India Hackathon Problem Statement PS 26184**  
*Development of a Predictive Analytics Framework for Cybercrime Complaints to Forecast Likely Cash Withdrawal Locations in Advance, Enabling Actionable Intelligence for Timely and Proactive Cybercrime Intervention.*

> **Synthetic Demonstration Data Notice**: Every victim record, bank account, transaction, ATM terminal, withdrawal event, and complaint seeded into this repository is **100% synthetic demonstration data** (`is_synthetic = TRUE`). ATM cash-out forecasts compute a **weighted composite risk score (0–100)** — they are **NOT** calibrated statistical probabilities. Every prediction and fraud score displays its explicit provenance (`"Trained ML prediction"`, `"Rule-based risk score"`, or `"Synthetic demo result"`).

---

## Repository Layout

```text
FinTrace/
├── docker-compose.yml               # 4-service stack: postgres, ml-service, backend, frontend
├── .env.example                     # Environment configuration template (no real secrets)
├── README.md
├── database/
│   ├── migrate.ts                   # Idempotent SQL migration runner (schema_migrations)
│   ├── migrations/
│   │   ├── 001_initial_schema.sql   # 22 normalized tables + refresh_tokens + CHECK constraints
│   │   └── 002_indexes_and_views.sql# Performance indexes & operational summary views
│   └── seeds/
│       ├── synthetic_generator.ts   # Deterministic Bengaluru multi-hop cybercrime scenario generator
│       └── run_seed.ts              # CLI seed loader (--reset supported)
├── ml-service/                      # Python 3.10+ FastAPI ML, Graph & ATM Forecasting Engine
│   ├── app/
│   │   ├── main.py
│   │   ├── routers/                 # /health, /graph/*, /ml/*, /atm/*
│   │   └── services/                # NetworkX graph engine, 21-feature builder, XGBoost+SHAP, DBSCAN, ATM predictor
│   └── tests/                       # pytest unit tests
├── backend/                         # Node.js + Express + TypeScript API
│   ├── src/
│   │   ├── app.ts / index.ts
│   │   ├── config/                  # env (Zod), db pool (pg), Pino logger
│   │   ├── middleware/              # JWT auth, 4-role RBAC, Zod validation, audit logging
│   │   └── modules/                 # auth, users, complaints, accounts, transactions, alerts,
│   │                                # audit, graph, ml, predictions, investigations, evidence,
│   │                                # reports (CSV + pdfkit PDF), assistant (@google/genai)
│   └── src/tests/                   # Vitest + Supertest API & RBAC test suites
├── frontend/                        # React 19 + TypeScript + Vite 6 + Tailwind v4 Command Centre
│   └── src/
│       ├── api/client.ts            # Fetch wrapper with automatic refresh-token rotation & Blob downloads
│       ├── context/AuthContext.tsx  # Persistent session state & role helpers
│       └── pages/                   # All 12 protected command pages + LoginPage
└── docs/
    ├── ARCHITECTURE.md
    ├── ATM_ENGINE.md
    ├── E2E_VERIFICATION_CHECKLIST.md
    └── LICENSES.md
```

---

## Quick Start with Docker Compose

1. **Configure Environment**
   ```bash
   cd FinTrace
   cp .env.example .env
   # Update POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, and optional GEMINI_API_KEY
   ```

2. **Start All Services**
   ```bash
   docker compose up --build -d
   ```

3. **Seed Synthetic Cybercrime Data**
   ```bash
   cd database
   npm install
   npm run seed:reset
   ```

4. **Open the Command Centre**
   - **Frontend UI**: `http://localhost:5173`
   - **Backend REST API**: `http://localhost:4000/api/v1/health`
   - **Python ML & Graph Service**: `http://localhost:8000/docs`

---

## Local Development Setup (Without Docker for App Services)

Run PostgreSQL 16 (via Docker `docker compose up -d postgres` or local installation), then open three terminals:

1. **Database Migrate & Seed**
   ```bash
   cd FinTrace/database
   npm install
   npm run migrate
   npm run seed:reset
   ```

2. **Python ML & Graph Service (`:8000`)**
   ```bash
   cd FinTrace/ml-service
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

3. **Node.js / Express Backend (`:4000`)**
   ```bash
   cd FinTrace/backend
   npm install
   npm run dev
   ```

4. **React / Vite Frontend (`:5173`)**
   ```bash
   cd FinTrace/frontend
   npm install
   npm run dev
   ```

---

## Seeded Demo Operator Credentials

All seeded demo users share the password **`FinTrace@Demo2026`** (non-production demonstration credentials):

| Email | Role | Access Scope |
|---|---|---|
| `admin@fintrace.in` | `Administrator` | Full platform, RBAC user provisioning, audit logs, ML training, AI assistant |
| `sr.investigator@fintrace.in` | `Senior Investigator` | Case triage, ML training, audit logs, evidence, reports, account freezes, AI assistant |
| `investigator@fintrace.in` | `Investigator` | Complaints, transaction tracing, ML scoring, ATM forecasts, alerts, evidence, PDF dossiers, AI assistant |
| `nodal@sbi-demo.in` | `Bank Nodal Officer` | Dashboard, transactions, network graph, ML inspection, ATM maps, alerts, and bank account freeze execution |

---

## Automated Tests

```bash
# Backend unit & Supertest integration tests
cd FinTrace/backend
npm install
npm test

# Python ML & graph service unit tests
cd FinTrace/ml-service
pytest -v
```

---

## Pushing FinTrace to GitHub (`shashank-r-codes/FinTrace`)

After copying/extracting the `/FinTrace` folder to your local workstation:

```bash
cd FinTrace
git init
git add .
git status   # Confirm .env and node_modules are ignored by .gitignore
git commit -m "feat: initial FinTrace cybercrime prediction platform (SIH PS 26184)"
git branch -M main
git remote add origin https://github.com/shashank-r-codes/FinTrace.git
git push -u origin main
```

---

## Documentation Index

- **[System Architecture](/FinTrace/docs/ARCHITECTURE.md)**
- **[Predictive ATM Cash-Out Engine Formula & Limitations](/FinTrace/docs/ATM_ENGINE.md)**
- **[End-to-End Verification Checklist](/FinTrace/docs/E2E_VERIFICATION_CHECKLIST.md)**
- **[Licenses & Reference Repository Attribution](/FinTrace/docs/LICENSES.md)**
