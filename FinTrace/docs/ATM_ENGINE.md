# FinTrace Predictive ATM Cash-Out Engine (`/docs/ATM_ENGINE.md`)

> **Important Disclaimer:** FinTrace ATM predictions produce a **weighted composite risk score (0–100)** on synthetic demonstration data. This score is **NOT a calibrated statistical probability** of a future withdrawal and must never be treated as certainty.

---

## 1. End-to-End Prediction Pipeline

1. **Suspicious Network Extraction**: Query all directed transactions associated with `complaint_id` from PostgreSQL and construct a NetworkX `DiGraph`.
2. **Cash-Out Candidate Account Selection**:
   - Exclude the origin victim account(s).
   - Score every downstream account using either the trained **XGBoost + SHAP** mule detector (`"Trained ML prediction"`) or the deterministic rule-based heuristic (`"Rule-based risk score"`).
   - Prioritize unfrozen accounts that retain net positive stolen funds (`total_inflow - total_outflow > 0`) or sit at terminal/sink positions (`out_degree == 0` or `CASH_OUT_CANDIDATE` / `SUSPECTED_MULE`).
   - Trace shortest/highest-value transaction paths from the victim origin to each candidate account.
3. **Candidate ATM Discovery**:
   - Compute each candidate account's **effective spatial centroid**: if historical ATM withdrawals exist for the account, blend 65% historical ATM centroid + 35% account branch coordinates; otherwise use branch coordinates.
   - Select ATMs within a 12 km Haversine radius (falling back to top-10 nearest city ATMs if sparse) and map DBSCAN geographic withdrawal clusters.
4. **Feature Scoring & Ranking**: Score every `(candidate_account, atm)` pair, keep the highest-scoring account link per ATM, and rank ATMs in descending `risk_score` order (`rank_order = 1, 2, 3, ...`), highlighting the **Top 3 ATMs**.

---

## 2. Exact Weighted Scoring Formula

$$\text{RiskScore} = \text{clip}\!\left(S_{\text{dist}} + S_{\text{recency}} + S_{\text{mule}} + S_{\text{history}} + S_{\text{atm}},\ 0,\ 100\right)$$

| Component | Weight | Exact Formula | Rationale |
|---|---:|---|---|
| **1. Spatial Proximity** ($S_{\text{dist}}$) | **28%** | $28 \cdot \exp(-0.35 \cdot d_{\text{km}})$ | Suspects typically cash out near known branch/home/prior ATM centroids. |
| **2. Inflow Recency & Velocity** ($S_{\text{recency}}$) | **24%** | $16 \cdot \exp(-0.08 \cdot \Delta t_h) + 8 \cdot \min(1, \frac{\text{vel}_{1\text{h}}}{4})$ | Fresh inflows ($\Delta t_h < 6\text{h}$) and burst transfers indicate imminent cash-out urgency. |
| **3. Mule & Network Risk** ($S_{\text{mule}}$) | **22%** | $22 \cdot \left(0.70 \cdot p_{\text{mule}} + 0.30 \cdot r_{\text{retain}}\right)$ | Combines XGBoost/rule mule likelihood with net funds retained ready for withdrawal. |
| **4. Historical ATM & Cluster Match** ($S_{\text{history}}$) | **16%** | $\min(10, 5 \cdot n_{\text{hits}}) + 6 \cdot I_{\text{cluster}}$ | Rewards exact prior withdrawals by the candidate account or proximity to DBSCAN hotspots. |
| **5. ATM Capacity & 24x7 Fit** ($S_{\text{atm}}$) | **10%** | $\text{tier\_pts} \in \{5, 3, 1.5\} + \text{avail\_pts} \in \{5, 2, 0.5\}$ | High-capacity 24x7 terminals support rapid, larger structured cash withdrawals. |

Where:
- $d_{\text{km}}$: Haversine distance between the ATM and the candidate account's effective spatial centroid.
- $\Delta t_h$: Hours elapsed between the candidate account's most recent flagged inflow and prediction reference time (latest network timestamp or current UTC time).
- $r_{\text{retain}} = \text{clip}\!\left(\frac{\text{inflow} - \text{outflow}}{\max(\text{inflow}, 1)}, 0, 1\right)$.
- $n_{\text{hits}}$: Prior withdrawals by the candidate account at that specific ATM.
- $I_{\text{cluster}} \in [0, 1]$: Proximity to DBSCAN geographic withdrawal hotspot clusters.

---

## 3. Risk Level, Time Window & Confidence Logic

### Risk Level
- **Critical**: `risk_score >= 80`
- **High**: `65 <= risk_score < 80`
- **Medium**: `45 <= risk_score < 65`
- **Low**: `risk_score < 45`

### Predicted Cash-Out Window
- **`0-6h`**: `risk_score >= 78` and $\Delta t_h \le 6\text{ hours}$
- **`6-12h`**: `risk_score >= 62` and $\Delta t_h \le 14\text{ hours}$
- **`12-24h`**: `risk_score >= 42` and $\Delta t_h \le 30\text{ hours}$
- **`>24h`**: Otherwise

### Confidence Tier
- **High**: Candidate has prior ATM withdrawal history OR (`p_mule >= 0.80` and $d_{\text{km}} \le 2.5\text{ km}$)
- **Moderate**: $d_{\text{km}} \le 5.0\text{ km}$ with verified traced path
- **Low**: Distance $> 5.0\text{ km}$ or sparse behavioral history

---

## 4. Known Limitations
- Assumes cash-out actors remain within ~12 km of branch or prior withdrawal centroids; cross-city travel or card-mule handoffs will reduce spatial accuracy.
- Does not incorporate real-time ATM cash-cassette telemetry, CCTV, or live NPCI switch feeds (out of scope for synthetic demo).
- Weighted scores are heuristic/ML-assisted prioritisation indices, not calibrated probabilities.
