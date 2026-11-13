-- =============================================================================
-- Migration 002: Performance Indexes & Operational Views
-- =============================================================================

-- Required transaction indexes
CREATE INDEX IF NOT EXISTS idx_transactions_from_ts
    ON transactions (from_account, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_to_ts
    ON transactions (to_account, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_complaint_ts
    ON transactions (complaint_id, timestamp ASC);

CREATE INDEX IF NOT EXISTS idx_transactions_flagged
    ON transactions (is_flagged_fraud, timestamp DESC);

-- Required ATM geographic indexes
CREATE INDEX IF NOT EXISTS idx_atms_geo
    ON atms (city, lat, lng);

CREATE INDEX IF NOT EXISTS idx_atms_lat_lng
    ON atms (lat, lng);

-- Required alert status index
CREATE INDEX IF NOT EXISTS idx_alerts_status
    ON alerts (status, severity, created_at DESC);

-- Supporting operational indexes
CREATE INDEX IF NOT EXISTS idx_atm_withdrawals_account_ts
    ON atm_withdrawals (account_id, withdrawn_at DESC);

CREATE INDEX IF NOT EXISTS idx_atm_withdrawals_atm_ts
    ON atm_withdrawals (atm_id, withdrawn_at DESC);

CREATE INDEX IF NOT EXISTS idx_atm_pred_complaint_rank
    ON atm_predictions (complaint_id, risk_score DESC, rank_order ASC);

CREATE INDEX IF NOT EXISTS idx_atm_pred_window_level
    ON atm_predictions ("window", risk_level);

CREATE INDEX IF NOT EXISTS idx_suspicious_account_status
    ON suspicious_accounts (account_id, status);

CREATE INDEX IF NOT EXISTS idx_fraud_results_complaint
    ON fraud_detection_results (complaint_id, mule_score DESC);

CREATE INDEX IF NOT EXISTS idx_ml_predictions_account
    ON ml_predictions (account_id, predicted_at DESC);

CREATE INDEX IF NOT EXISTS idx_complaints_status_priority
    ON complaints (status, priority, reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
    ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
    ON audit_logs (actor_user_id, created_at DESC);

-- View: Latest ATM predictions joined with ATM metadata and complaint info
CREATE OR REPLACE VIEW v_atm_prediction_summary AS
SELECT
    ap.id AS prediction_id,
    ap.complaint_id,
    c.complaint_number,
    c.fraud_type,
    c.reported_amount,
    ap.atm_id,
    a.bank AS atm_bank,
    a.address AS atm_address,
    a.locality AS atm_locality,
    a.city AS atm_city,
    a.lat,
    a.lng,
    ap.risk_score,
    ap.risk_level,
    ap."window",
    ap.confidence,
    ap.score_source,
    ap.rank_order,
    ap.model_version,
    ap.predicted_at
FROM atm_predictions ap
JOIN atms a ON a.id = ap.atm_id
JOIN complaints c ON c.id = ap.complaint_id;
