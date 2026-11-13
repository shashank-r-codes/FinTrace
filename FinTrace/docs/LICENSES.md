# FinTrace Licenses & Reference Attribution (`/docs/LICENSES.md`)

## 1. FinTrace Project License
- **FinTrace Platform Codebase**: Intended for academic and Smart India Hackathon (PS 26184) demonstration. Assign your repository's preferred open-source license (e.g., MIT or Apache-2.0) in a root `LICENSE` file before public distribution.

---

## 2. Reference Repositories Cited in Project Brief

No source code or license files from the external reference repositories listed in the brief were imported or inspected during the creation of FinTrace. Their exact upstream licenses **must be verified directly by the repository maintainer** before reusing or linking third-party code:

| Reference Repository / Asset | Purpose in Problem Context | Attribution / Status | License Status |
|---|---|---|---|
| `sagr12004/cybertrace` | Cybercrime complaint & tracing workflow reference | Conceptual inspiration only; no code copied | **Verify** |
| `feedzai/bank-account-fraud` | Synthetic tabular bank account fraud dataset methodology | Conceptual benchmark reference only | **Verify** |
| `feedzai/research-aml-elliptic` | AML graph topology & temporal evaluation split concepts | Inspired chronological split (`time_based_split`) | **Verify** |
| `feedzai/fairgbm` | Fairness-aware gradient boosting concepts | Conceptual reference only | **Verify** |
| `feedzai/timeshap` | Temporal explainability concepts | Conceptual reference only | **Verify** |
| `thanay2007/MuleHunter` | Mule account detection heuristics & graph signal framing | Conceptual reference only | **Verify** |
| Fraudulent Transaction Classifier | Transaction-level fraud feature classification concepts | Conceptual reference only | **Verify** |

---

## 3. Core Open-Source Dependencies Used by FinTrace

### Frontend (`/FinTrace/frontend/package.json`)
- **React & React DOM** (`react`, `react-dom`) — MIT
- **React Router** (`react-router-dom`) — MIT
- **Tailwind CSS & Vite Plugin** (`tailwindcss`, `@tailwindcss/vite`) — MIT
- **Recharts** (`recharts`) — MIT
- **Leaflet** (`leaflet`) — BSD-2-Clause
- **OpenStreetMap Map Tiles** — Data © OpenStreetMap contributors (ODbL)
- **Cytoscape.js** (`cytoscape`) — MIT
- **Lucide React** (`lucide-react`) — ISC

### Backend (`/FinTrace/backend/package.json`)
- **Express** (`express`), **CORS** (`cors`), **Helmet** (`helmet`), **Rate Limit** (`express-rate-limit`) — MIT
- **node-postgres** (`pg`) — MIT
- **Zod** (`zod`), **bcryptjs** (`bcryptjs`), **jsonwebtoken** (`jsonwebtoken`), **csv-parse** (`csv-parse`), **multer** (`multer`), **pdfkit** (`pdfkit`), **pino** (`pino`) — MIT
- **Google Gen AI SDK** (`@google/genai`) — Apache-2.0
- **Vitest** (`vitest`), **Supertest** (`supertest`) — MIT

### ML & Graph Service (`/FinTrace/ml-service/requirements.txt`)
- **FastAPI** (`fastapi`), **Uvicorn** (`uvicorn`), **Pydantic** (`pydantic`) — MIT
- **NetworkX** (`networkx`), **scikit-learn** (`scikit-learn`), **pandas** (`pandas`), **NumPy** (`numpy`), **joblib** (`joblib`) — BSD-3-Clause
- **XGBoost** (`xgboost`) — Apache-2.0
- **SHAP** (`shap`), **pytest** (`pytest`), **httpx** (`httpx`) — MIT / BSD
- **psycopg2-binary** (`psycopg2-binary`) — LGPL-3.0-or-later
