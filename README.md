# FinTrace

**AI-powered cyber fraud prevention and financial crime investigation platform**

FinTrace helps banks and investigators stop financial cybercrime in two stages. Before a payment completes, it screens the transaction and recommends whether to allow, verify, hold or reject it. If money still moves, it traces the funds across accounts, identifies likely mule networks and forecasts the ATMs where cash is most likely to be withdrawn.

Built for **Smart India Hackathon, Problem Statement 26184**: *Predictive Analytics Framework for Cybercrime Complaints to Forecast Likely Cash Withdrawal Locations in Advance.*

> **Demo project on synthetic data.** FinTrace has no connection to real banks, UPI/NPCI, NCRP, I4C, police systems or ATM networks. It cannot freeze accounts or stop real payments. All interventions shown are simulated. See [Limitations and disclaimer](#limitations-and-disclaimer).

---

## Contents

- [How it works](#how-it-works)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Map setup (CARTO API key)](#map-setup-carto-api-key)
- [Demo accounts](#demo-accounts)
- [Prevention simulator scenarios](#prevention-simulator-scenarios)
- [Machine learning](#machine-learning)
- [ATM cash-out prediction](#atm-cash-out-prediction)
- [Security and governance](#security-and-governance)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Limitations and disclaimer](#limitations-and-disclaimer)
- [Credits and licences](#credits-and-licences)

---

## How it works

**Before fraud (prevention)**

```
Account intelligence → Transaction screening → Fraud risk assessment → Recommended intervention
```

**After fraud (investigation)**

```
Complaint → Transaction ingestion → Multi-hop tracing → Mule network detection
→ ATM cash-out prediction → GIS map → Early-warning alerts → Investigation and reports
```

If a transaction is allowed and later reported as fraud, it moves from the prevention side into the investigation pipeline, and the Intervention Centre shows it as a missed case under investigation.

---

## Features

### Fraud prevention

- **Account Intelligence and Risk Registry.** A searchable profile for every monitored account: risk score, classification, transaction velocity, fan-in and fan-out, rapid pass-through, linked accounts and plain-language reasons for the score. Accounts are labelled *suspicious*, *suspected mule* or *confirmed fraud-linked*. Only a linked complaint or recorded evidence can make an account confirmed.
- **Real-time transaction screening.** Evaluates sender, receiver, amount, behaviour and network links before authorisation. Returns a risk score, risk factors with weights, a recommended action and an explanation.
- **Configurable decisions.** Low risk: allow. Medium: additional verification. High: hold for review. Critical: reject or block recommendation. Thresholds are stored in the database, versioned and editable by administrators.
- **Transaction Intervention Centre.** Review queue with approve, escalate and override actions, notes, false-positive tracking and full decision history.
- **Tamper-evident audit trail.** Intervention actions are written to a hash-chained log, with a verify-chain check in the UI.
- **Mule ring detection.** Finds linked accounts that receive and forward funds quickly, using graph analysis and ML.
- **Prevention simulator.** Seven reproducible scenarios that run through the real screening pipeline and database.

### Post-fraud investigation

- **Complaint management** for officers and a **citizen portal** for filing complaints and tracking their status.
- **Transaction explorer and money trail.** One-hop and multi-hop, forward and reverse tracing, timelines and suspicious path detection.
- **Network graph.** Accounts as nodes, real transactions as directed edges, with centrality metrics.
- **ML fraud and mule risk.** Trained models with explainable predictions.
- **ATM cash-out engine.** Ranked candidate ATMs, risk levels and predicted time windows.
- **GIS hotspot map.** Leaflet map with ATM risk levels, DBSCAN hotspot zones and historical cash-out markers.
- **Early-warning alerts, investigations, evidence vault and reports** (PDF and CSV export).
- **AI forensic copilot.** A Gemini-powered assistant that answers only from case data supplied by the backend.

### Platform

- Role-based access control: Administrator, Senior Investigator, Investigator, Bank Nodal Officer and Citizen.
- Light and dark themes.
- Audit logging on sensitive actions.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Tailwind CSS, Recharts |
| Backend | Node.js, Express, Zod |
| Database | PostgreSQL |
| Machine learning | Python, scikit-learn, XGBoost, SHAP |
| Graph analytics | NetworkX |
| Maps | Leaflet, CARTO basemaps, OpenStreetMap data |
| AI assistant | Gemini API (backend only) |
| Authentication | JWT with role-based access control |

<!-- VERIFY: add Redis, FastAPI, Vite, Docker etc. if they are actually used in your repo -->

---

## Architecture

```
┌────────────┐    HTTPS    ┌──────────────────┐    SQL    ┌────────────┐
│  Frontend  │ ──────────▶ │  Express backend │ ────────▶ │ PostgreSQL │
│ React + TS │             │  auth, RBAC, API │           └────────────┘
└────────────┘             └───────┬──────────┘
                                   │ HTTP (localhost)
                         ┌─────────▼──────────┐
                         │    ML service      │
                         │ XGBoost, NetworkX, │
                         │ SHAP (Python)      │
                         └────────────────────┘
        Gemini API is called by the backend only, never from the browser,
        and never in the transaction screening path.
```

Design rules:

- Transaction screening uses deterministic rules and ML inference only. The Gemini assistant explains results afterwards and never approves or blocks anything.
- Every edge drawn in a graph corresponds to a real transaction row in the database.
- Screening requests are idempotent, rate-limited and time-boxed, with a configurable fail-open or fail-closed policy.

---

## Getting started

### Prerequisites

- Node.js 20 or later <!-- VERIFY -->
- Python 3.10 or later <!-- VERIFY -->
- PostgreSQL 14 or later, or Docker <!-- VERIFY -->

### 1. Clone and configure

```bash
git clone https://github.com/shashank-r-codes/FinTrace.git
cd FinTrace
cp .env.example .env
# edit .env, see "Environment variables" below
```

### 2. Run with Docker

```bash
docker compose up --build
```

### 3. Or run locally

```bash
# database migrations and seed data
<!-- VERIFY: replace with your actual migration and seed commands -->
npm run db:migrate
npm run db:seed

# backend
cd backend && npm install && npm run dev

# ML service
cd ml-service && pip install -r requirements.txt
<!-- VERIFY: start command, for example: uvicorn app.main:app --port 8001 -->

# frontend
cd frontend && npm install && npm run dev
```

Restart the frontend dev server after changing any `VITE_*` variable. Vite reads them at startup.

Open the URL printed by the frontend dev server, usually `http://localhost:5173`.

---

## Environment variables

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing access tokens (use a long random value) |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens |
| `ML_SERVICE_URL` | URL of the Python ML service |
| `GEMINI_API_KEY` | Gemini API key, used by the backend only |
| `VITE_API_BASE_URL` | Backend URL used by the frontend |
| `VITE_CARTO_API_KEY` | CARTO basemap key (see below) |
| `VITE_MAP_TILE_URL` | Optional tile URL override. Leave empty to use CARTO |

<!-- VERIFY: align this table with your real .env.example -->

`VITE_*` values are bundled into the browser build, so anyone can read them. Do not put secrets there.

---

## Map setup (CARTO API key)

The GIS map uses CARTO basemaps, which need an API key.

1. Create an account at [carto.com](https://carto.com) and generate an API key for basemaps.
2. Restrict the key to your allowed domains, for example `http://localhost:5173` and your deployed domain.
3. Put it in `.env` as `VITE_CARTO_API_KEY=...` and restart the frontend.

If the key is missing or rejected, the map falls back to OpenStreetMap tiles and shows a notice. ATM markers, hotspot zones, filters and the ATM list keep working without a basemap.

Map data © OpenStreetMap contributors © CARTO.

---

## Demo accounts

Seeded accounts for the synthetic demo. Change or remove them before any shared deployment.

Password for all demo accounts: `FinTrace@Demo2026`

| Role | Email |
|---|---|
| Administrator | `admin@fintrace.demo` |
| Senior Investigator | `kavya.rao@fintrace.demo` |
| Investigator | `rohan.menon@fintrace.demo` |
| Bank Nodal Officer | `nodal.synsbi@fintrace.demo` |
| Citizen | `citizen1@fintrace.demo`, `citizen2@fintrace.demo` |

<!-- VERIFY: confirm the citizen accounts were seeded -->

---

## Prevention simulator scenarios

The simulator runs each scenario through the real screening pipeline and writes clearly flagged synthetic records. Interventions are simulated.

| Scenario | What it shows | Expected result |
|---|---|---|
| A. Normal transfer | Customer pays a known beneficiary | Low risk, allow |
| B. Suspicious receiver | Payment to an account with prior suspicious activity | Elevated risk, verify or review |
| C. Potential mule account | Many unrelated senders, then rapid forwarding | Account flagged, later payments scrutinised more |
| D. Linked network | Receiver connected to several flagged accounts | Network risk raises the score |
| E. Abnormal behaviour | Dormant account sends a large transfer to a new beneficiary | Anomaly detected, escalated |
| F. Critical attempt | Several strong fraud indicators together | Critical, simulated hold or rejection |
| G. False positive | Legitimate payment scores high | Reviewer clears it, outcome recorded for monitoring |

---

## Machine learning

- **Models:** XGBoost for fraud and mule classification, Isolation Forest for anomaly detection, DBSCAN for ATM hotspot clustering. <!-- VERIFY against ml-service -->
- **Features:** transaction velocity, inflow and outflow ratio, receive-to-forward time, counterparty counts, amount statistics, graph centrality and suspicious neighbours.
- **Evaluation:** time-based train, validation and test splits to avoid leakage. Metrics include precision, recall, F1, ROC-AUC, PR-AUC, false-positive and false-negative rates, and confusion matrices.
- **Explainability:** SHAP explanations per prediction.

**Every score and metric is labelled by source:** *Trained ML prediction*, *Rule-based score* or *Synthetic demo result*. All metrics in this repository come from synthetic data and are **not** real-world performance figures.

---

## ATM cash-out prediction

The engine starts from a suspicious account network, selects candidate ATMs near likely cash-out accounts and historical withdrawal areas, scores them, ranks them and assigns a likely time window (0–6 h, 6–12 h, 12–24 h, or more than 24 h). Each prediction includes the ATM, coordinates, risk score, risk level, linked accounts, transaction paths, contributing factors and a plain-language explanation.

The risk score is a weighted indicator. **It is not a calibrated probability**, and the system does not know where anyone will withdraw cash. The scoring formula and window logic are documented in `docs/ATM_ENGINE.md`. <!-- VERIFY: file exists -->

---

## Security and governance

- Server-side role-based access control. Citizens cannot reach officer routes and only see their own complaints.
- Parameterised SQL, input validation with Zod, rate limiting and security headers.
- Citizen responses are whitelisted so they never include internal scores, suspicious-account data or investigator details.
- Account numbers are masked by default.
- Sensitive actions are written to audit logs. Intervention decisions use a hash-chained, tamper-evident log.
- Secrets live in environment variables and are never sent to the frontend.

---

## Project structure

<!-- VERIFY: replace with your real tree -->

```
FinTrace/
├── frontend/        React + TypeScript app
├── backend/         Express API
├── ml-service/      Python ML and graph analytics
├── database/        Migrations, seeds, synthetic data generator
├── docs/            Design and engine documentation
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Testing

```bash
# backend
cd backend && npm test

# ML service
cd ml-service && pytest
```

<!-- VERIFY: add the real test commands and any end-to-end checklist -->

---

## Limitations and disclaimer

- FinTrace is a prototype that runs on **synthetic data**.
- It does **not** integrate with real banks, payment systems, ATM networks, NCRP, I4C or police systems, and it **cannot** freeze accounts or block real payments. Holding or blocking a payment needs an authorised integration with the bank's authorisation system.
- Screening output is a **recommendation** for human review, not a final decision.
- Risk scores are not calibrated probabilities. ATM predictions are indicative and cannot guarantee where a withdrawal will happen.
- Synthetic model metrics do not reflect real-world accuracy.
- Using this approach with real data needs legal authorisation, a privacy and security review, bias and false-positive testing, and compliance with applicable law and bank policy.

---

## Credits and licences

- Built for Smart India Hackathon, Problem Statement 26184.
- Design and modelling ideas were drawn from public reference projects: [CyberTrace](https://github.com/sagr12004/cybertrace), [Feedzai bank-account-fraud](https://github.com/feedzai/bank-account-fraud), [Feedzai research-aml-elliptic](https://github.com/feedzai/research-aml-elliptic), [Feedzai FairGBM](https://github.com/feedzai/fairgbm), [Feedzai TimeSHAP](https://github.com/feedzai/timeshap) and [MuleHunter](https://github.com/thanay2007/MuleHunter). No code is copied unless noted. Check each project's licence in `docs/LICENSES.md`. <!-- VERIFY -->
- UI refinement method adapted from [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky (@heydamir), CC BY 4.0. <!-- keep only if you applied it -->
- Map data © OpenStreetMap contributors, basemap © CARTO.

**Licence:** <!-- VERIFY: choose and add a LICENSE file, for example MIT -->

**Team:** <!-- add team name and members -->
