# FinTrace Fraud Prevention Layer — Architectural & Operational Specification

**Smart India Hackathon Problem Statement PS 26184 Extension**  
*Integrated Pre-Authorisation Fraud Screening, Account Intelligence Risk Registry, Cryptographic Intervention Centre, and Section 91 CrPC Forensic Bridge.*

> **Statutory Safety Disclaimer**:  
> **"FinTrace returns RECOMMENDATIONS. Simulated intervention only. No actual banking freeze or fund blocking is executed on live financial rails."**

---

## 1. Architectural Overview: BEFORE vs. AFTER

### Before (Post-Fraud Forensics Only)
Prior to this upgrade, FinTrace operated strictly **post-incident**:
1. A cyber fraud victim loses funds and files a complaint (via NCRP / 1930 / FIR).
2. FinTrace ingests transactions, reconstructs multi-hop money trails, visualizes mule accounts in Cytoscape, and predicts likely ATM cash-out points via DBSCAN and Leaflet/OSM.
3. *Limitation*: Funds have already moved across 3 to 5 hops, and physical cash has frequently been withdrawn before law enforcement can act.

```
[Victim Transfer] ──> [Mule Layer 1] ──> [Mule Layer 2] ──> [ATM Cash-Out]
                                                                    │
                                                (Post-Facto Complaint Filed)
                                                                    │
                                                            [FinTrace Forensics]
```

### After (End-to-End Prevention & Forensic Continuum)
With the addition of the **Fraud Prevention Layer**, FinTrace operates **before money moves** without compromising any downstream forensic tracing:

```
                          ┌──────────────────────────────────────────────┐
                          │     Pre-Authorisation Screening (<50ms)      │
                          │   Rule Engine + Sub-35ms XGBoost/SHAP ML     │
                          └──────────────────────┬───────────────────────┘
                                                 │
            ┌────────────────────────────────────┼────────────────────────────────────┐
            ▼                                    ▼                                    ▼
       [ALLOW (<45)]                 [HOLD_FOR_REVIEW (65-84)]             [REJECT_BLOCK (>=85)]
            │                                    │                                    │
    (Proceed on Rails)             [Intervention Centre Queue]           [Pre-Auth Hop 1 Intercept]
                                                 │                                    │
                                                 └──────────────────┬─────────────────┘
                                                                    │
                                                  [Bridge to Forensic Casework]
                                                                    │
                                                    ┌───────────────┴───────────────┐
                                                    ▼                               ▼
                                        Section 91 CrPC Notice         Account Elevated to
                                         & Evidence Vault Deposit    CONFIRMED_FRAUD_LINKED
                                                    │                               │
                                                    ▼                               ▼
                                        Downstream Multi-Hop Tracing   All Subsequent Inflows
                                        & ATM Cash-Out Surveillance       Blocked at Hop 1
```

---

## 2. Strict Account Classification Taxonomy

FinTrace enforces a strict 4-tier taxonomy across all prevention endpoints, databases, and visual surfaces:

| Classification Status | Display Label | Risk Score Range | Criteria & Requirements | Action Protocol |
| :--- | :--- | :--- | :--- | :--- |
| `NORMAL` | Active Normal Account | $0.0 - 29.9$ | Verified KYC, typical consumer/retail velocity, no adverse syndicate links. | Automatic `ALLOW` |
| `SUSPICIOUS_ACCOUNT` | Suspicious Account | $30.0 - 64.9$ | Dormant reactivation, PEP linkage, unusual channel velocity, or single rule trigger. | `ADDITIONAL_VERIFICATION` |
| `SUSPECTED_MULE_ACCOUNT` | Suspected Mule Account | $65.0 - 84.9$ | Rapid pass-through ratio $> 0.85$, high fan-in velocity, or 2nd-degree link to flagged nodes. | `HOLD_FOR_REVIEW` (Officer Queue) |
| `CONFIRMED_FRAUD_LINKED` | Confirmed Fraud-Linked | $85.0 - 100.0$ | **Strict Requirement**: Must be directly linked to a formal FIR/complaint, verified Section 91 CrPC freeze order, or confirmed forensic evidence. | Immediate `REJECT_BLOCK` at Hop 1 |

---

## 3. Real-Time Screening Hot Path ($< 50\text{ms}$ Latency Budget)

FinTrace achieves sub-50ms deterministic screening through a tiered architecture:
1. **Tier 1: In-Memory Profile Cache ($\le 1\text{ms}$)**: High-velocity account intelligence profiles are maintained in a concurrent LRU cache, bypassing database reads.
2. **Tier 2: Deterministic Rule Matrix ($\le 2\text{ms}$)**: Rapid assessment of account status, rapid pass-through ratios, and velocity thresholds.
3. **Tier 3: Asynchronous/Sub-35ms ML Inference ($\le 35\text{ms}$)**: XGBoost + Isolation Forest model with SHAP factor attribution queried via FastAPI.
4. **Tier 4: Graceful Fail-Safe Policy**: If the ML service times out or is unreachable, the engine gracefully falls back to deterministic local rule evaluation with `score_source = 'Rule-based risk score (ML Fallback)'`.
5. **Tier 5: Cryptographic Idempotency**: Pre-authorisation transfers are hashed (`sha256(client_id + sender + receiver + amount)`); duplicate transfers within 300 seconds return cached decisions instantly.

---

## 4. NetworkX Syndicate & Mule Ring Detection

The Python ML service (`FinTrace/ml-service`) and standalone store (`server/store.ts`) analyze the live transaction graph using NetworkX:
- **`MULE_RING_CYCLE`**: Strongly connected directed subgraphs detecting circular funds routing intended to obscure money trails.
- **`FAN_IN_STRUCTURING`**: High in-degree structuring nodes where multiple micro-transactions converge within short timeframes (smurfing).
- **`RAPID_DISSIPATION`**: High pass-through nodes where $> 90\%$ of received funds are dissipated within 15 minutes.
- **Risk Propagation**: Multi-hop BFS attenuation formula:
  $$\text{Risk}_{\text{hop } k} = \text{Risk}_{\text{source}} \times (0.75)^k$$

---

## 5. Transaction Intervention Centre & Cryptographic Audit Chaining

Every screening intercept generates a reviewable intervention in the **Transaction Intervention Centre**:
- **Officer Oversight**: Law enforcement officers and bank nodal officers review pending holds, inspect top SHAP factors, and record justified determinations (`APPROVED`, `REJECTED`, `ESCALATED`, `FALSE_POSITIVE`).
- **Cryptographic Tamper-Evident Chaining**: Every action appends an immutable entry to `intervention_audit_logs` using SHA-256 hash chaining:
  $$\text{Hash}_n = \text{SHA256}(\text{Hash}_{n-1} \,\|\, \text{InterventionID} \,\|\, \text{Action} \,\|\, \text{OfficerID} \,\|\, \text{Timestamp})$$
  Genesis Block: `0000000000000000000000000000000000000000000000000000000000000000`.
- **Integrity Auditing**: Built-in sequential verification endpoint (`/api/v1/interventions/verify-chain`) checks unbroken cryptographic linkage to ensure compliance with **Section 65B of the Indian Evidence Act**.

---

## 6. End-to-End Prevention-to-Forensics Bridge (Section 91 CrPC)

When an intervention is confirmed or bridged by an officer:
1. **Automated Complaint Generation**: Ingested as a Sentinel complaint in `complaints` (`CMP-PREV-...`).
2. **Formal Investigation Dossier**: Created in `investigations` (`INV-PREV-2026-...`) with pre-configured statutory actions (`SECTION_91_CRPC_NOTICE`, `COORDINATED_MULE_FREEZE`, `ATM_SURVEILLANCE_ALERT`).
3. **Section 91 CrPC Evidence Record**: Deposited in `evidence_records` with the cryptographic SHA-256 hash of the screening audit log.
4. **Beneficiary Risk Elevation**: Beneficiary account intelligence profile is upgraded to `CONFIRMED_FRAUD_LINKED` ($95.0+$ score), immediately invalidating the cache and blocking any future pre-authorisation transfers at Hop 1.

---

## 7. Operational Runbook & Verification

### Running the Full Prevention Layer Test Suite
```bash
# Execute native 16-assertion end-to-end test suite
npx tsx test_prevention_layer.ts
```
Expected output:
```
TAP version 13
# Subtest: FinTrace Comprehensive Prevention Layer Test Suite
...
# tests 16
# suites 7
# pass 16
# fail 0
# duration_ms < 30ms
```

### Standalone Demo Runner (Zero External Dependencies)
```bash
npm run dev
# Server accessible at http://localhost:3000
```

### Production Docker Stack
```bash
cd FinTrace
docker compose up --build -d
# Frontend: http://localhost:5173
# Backend:  http://localhost:4000
# ML/Graph: http://localhost:8000
```
