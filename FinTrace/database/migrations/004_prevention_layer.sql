-- =============================================================================
-- Migration: 004_prevention_layer.sql
-- Description: Real-Time Fraud Prevention Layer Schema
-- Includes:
--   1. screening_thresholds (versioned cutoff boundaries)
--   2. system_settings (configurable fail-open/closed policy & timeouts)
--   3. fraud_indicators (prevention indicator dictionary)
--   4. account_intelligence_profiles (continuous pre-fraud account registry)
--   5. account_risk_history (audit of score/classification shifts)
--   6. transaction_screening_requests (real-time pre-auth screenings with idempotency)
--   7. transaction_risk_assessments (detailed factors, weights, and explanations)
--   8. transaction_interventions (recommended actions & human review lifecycle)
--   9. suspicious_account_relationships (risk propagation edges)
--  10. intervention_audit_logs (cryptographic SHA-256 tamper-evident hash chain)
--  11. Tamper-evident immutability triggers (disallows UPDATE and DELETE)
-- =============================================================================

-- Ensure pgcrypto extension is active
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. screening_thresholds
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS screening_thresholds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version             INT NOT NULL UNIQUE,
    low_max             NUMERIC(5, 2) NOT NULL CHECK (low_max > 0 AND low_max < medium_max),
    medium_max          NUMERIC(5, 2) NOT NULL CHECK (medium_max > low_max AND medium_max < high_max),
    high_max            NUMERIC(5, 2) NOT NULL CHECK (high_max > medium_max AND high_max <= 100),
    is_active           BOOLEAN NOT NULL DEFAULT FALSE,
    modified_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    reason_for_change   TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. system_settings
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key         VARCHAR(80) PRIMARY KEY,
    setting_value       TEXT NOT NULL,
    description         TEXT NOT NULL,
    is_audited          BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. fraud_indicators
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_indicators (
    id                  VARCHAR(60) PRIMARY KEY,
    category            VARCHAR(40) NOT NULL CHECK (category IN (
                            'VELOCITY',
                            'NETWORK',
                            'BEHAVIORAL',
                            'DEVICE_LOCATION',
                            'INTELLIGENCE'
                        )),
    name                VARCHAR(120) NOT NULL,
    description         TEXT NOT NULL,
    default_weight      NUMERIC(5, 2) NOT NULL CHECK (default_weight BETWEEN 0 AND 100),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. account_intelligence_profiles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_intelligence_profiles (
    account_id                      UUID PRIMARY KEY REFERENCES bank_accounts(id) ON DELETE CASCADE,
    risk_score                      NUMERIC(5, 2) NOT NULL DEFAULT 10.00 CHECK (risk_score BETWEEN 0 AND 100),
    risk_classification             VARCHAR(30) NOT NULL DEFAULT 'Low' CHECK (risk_classification IN (
                                        'Low',
                                        'Medium',
                                        'High',
                                        'Critical',
                                        'Under Investigation'
                                    )),
    account_status                  VARCHAR(40) NOT NULL DEFAULT 'NORMAL' CHECK (account_status IN (
                                        'NORMAL',
                                        'SUSPICIOUS_ACCOUNT',
                                        'SUSPECTED_MULE_ACCOUNT',
                                        'CONFIRMED_FRAUD_LINKED'
                                    )),
    incoming_frequency_24h          INT NOT NULL DEFAULT 0 CHECK (incoming_frequency_24h >= 0),
    outgoing_frequency_24h          INT NOT NULL DEFAULT 0 CHECK (outgoing_frequency_24h >= 0),
    incoming_volume_24h             NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (incoming_volume_24h >= 0),
    outgoing_volume_24h             NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (outgoing_volume_24h >= 0),
    avg_incoming_amount             NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    avg_outgoing_amount             NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    velocity_score                  NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (velocity_score BETWEEN 0 AND 100),
    pass_through_ratio              NUMERIC(6, 4) NOT NULL DEFAULT 0.0000 CHECK (pass_through_ratio >= 0),
    rapid_forward_count_24h         INT NOT NULL DEFAULT 0 CHECK (rapid_forward_count_24h >= 0),
    connected_accounts_count        INT NOT NULL DEFAULT 0 CHECK (connected_accounts_count >= 0),
    suspicious_counterparties_count INT NOT NULL DEFAULT 0 CHECK (suspicious_counterparties_count >= 0),
    prior_complaints_count          INT NOT NULL DEFAULT 0 CHECK (prior_complaints_count >= 0),
    mule_indicators                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_reasons                    JSONB NOT NULL DEFAULT '[]'::jsonb,
    score_source                    VARCHAR(40) NOT NULL DEFAULT 'Rule-based risk score' CHECK (score_source IN (
                                        'Trained ML prediction',
                                        'Rule-based risk score',
                                        'Synthetic demo result'
                                    )),
    last_assessed_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_synthetic                    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. account_risk_history
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_risk_history (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id              UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    previous_score          NUMERIC(5, 2),
    new_score               NUMERIC(5, 2) NOT NULL CHECK (new_score BETWEEN 0 AND 100),
    previous_classification VARCHAR(30),
    new_classification      VARCHAR(30) NOT NULL,
    trigger_event           VARCHAR(60) NOT NULL,
    trigger_reference_id    VARCHAR(64),
    reasons_json            JSONB NOT NULL DEFAULT '[]'::jsonb,
    assessed_by             VARCHAR(80) NOT NULL DEFAULT 'SYSTEM',
    recorded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. transaction_screening_requests
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transaction_screening_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key         VARCHAR(128) NOT NULL UNIQUE,
    sender_account_id       UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
    receiver_account_id     UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
    amount                  NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    currency                CHAR(3) NOT NULL DEFAULT 'INR',
    channel                 VARCHAR(30) NOT NULL CHECK (channel IN ('UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET')),
    client_id               VARCHAR(80) NOT NULL DEFAULT 'BANK_CORE_SWITCH',
    status                  VARCHAR(30) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'TIMED_OUT')),
    decision                VARCHAR(30) NOT NULL CHECK (decision IN ('ALLOW', 'VERIFY', 'HOLD', 'BLOCK')),
    risk_score              NUMERIC(5, 2) NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    risk_classification     VARCHAR(20) NOT NULL CHECK (risk_classification IN ('Low', 'Medium', 'High', 'Critical')),
    latency_ms              INT NOT NULL CHECK (latency_ms >= 0),
    applied_fail_mode       VARCHAR(20) NOT NULL DEFAULT 'NONE' CHECK (applied_fail_mode IN ('NONE', 'FAIL_OPEN', 'FAIL_CLOSED')),
    scenario_id             VARCHAR(40),
    is_synthetic            BOOLEAN NOT NULL DEFAULT TRUE,
    screened_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_screening_distinct_accounts CHECK (sender_account_id <> receiver_account_id)
);

-- -----------------------------------------------------------------------------
-- 7. transaction_risk_assessments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transaction_risk_assessments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    screening_id            UUID NOT NULL UNIQUE REFERENCES transaction_screening_requests(id) ON DELETE CASCADE,
    account_risk_score      NUMERIC(5, 2) NOT NULL CHECK (account_risk_score BETWEEN 0 AND 100),
    transaction_risk_score  NUMERIC(5, 2) NOT NULL CHECK (transaction_risk_score BETWEEN 0 AND 100),
    network_risk_score      NUMERIC(5, 2) NOT NULL CHECK (network_risk_score BETWEEN 0 AND 100),
    composite_score         NUMERIC(5, 2) NOT NULL CHECK (composite_score BETWEEN 0 AND 100),
    score_source            VARCHAR(40) NOT NULL CHECK (score_source IN (
                                'Trained ML prediction',
                                'Rule-based risk score',
                                'Synthetic demo result'
                            )),
    thresholds_version      INT NOT NULL,
    model_version           VARCHAR(50) NOT NULL DEFAULT 'v1.0-rules-xgb',
    rules_triggered         JSONB NOT NULL DEFAULT '[]'::jsonb,
    ml_factors              JSONB NOT NULL DEFAULT '[]'::jsonb,
    plain_language_explanation TEXT NOT NULL,
    limitations_disclaimer  TEXT NOT NULL DEFAULT 'FinTrace returns RECOMMENDATIONS. Simulated intervention only.',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 8. transaction_interventions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transaction_interventions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    screening_id            UUID NOT NULL UNIQUE REFERENCES transaction_screening_requests(id) ON DELETE CASCADE,
    recommended_action      VARCHAR(30) NOT NULL CHECK (recommended_action IN (
                                'ALLOW',
                                'ADDITIONAL_VERIFICATION',
                                'HOLD_FOR_REVIEW',
                                'REJECT_BLOCK'
                            )),
    review_status           VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (review_status IN (
                                'PENDING',
                                'APPROVED',
                                'REJECTED',
                                'ESCALATED',
                                'AUTO_RESOLVED',
                                'FALSE_POSITIVE'
                            )),
    resolved_by             UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at             TIMESTAMPTZ,
    review_notes            TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 9. suspicious_account_relationships
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suspicious_account_relationships (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_account_id       UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    target_account_id       UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    relationship_type       VARCHAR(40) NOT NULL CHECK (relationship_type IN (
                                'BENEFICIARY',
                                'SHARED_DEVICE',
                                'COMMON_IDENTIFIER',
                                'REPEATED_BURST',
                                'SUSPECTED_SYNDICATE'
                            )),
    hops_to_confirmed_fraud INT NOT NULL DEFAULT 99,
    risk_weight             NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
    first_observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_observed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_rel_distinct_accounts CHECK (source_account_id <> target_account_id),
    UNIQUE (source_account_id, target_account_id, relationship_type)
);

-- -----------------------------------------------------------------------------
-- 10. intervention_audit_logs (Tamper-Evident SHA-256 Hash Chain)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intervention_audit_logs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_number         BIGSERIAL NOT NULL UNIQUE,
    screening_id            UUID REFERENCES transaction_screening_requests(id) ON DELETE SET NULL,
    intervention_id         UUID REFERENCES transaction_interventions(id) ON DELETE SET NULL,
    actor_user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role              VARCHAR(50) NOT NULL,
    action                  VARCHAR(80) NOT NULL,
    previous_hash           CHAR(64) NOT NULL,
    entry_hash              CHAR(64) NOT NULL,
    payload_json            JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address              VARCHAR(64),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 11. Tamper-Evident Immutability Trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_audit_log_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Tamper-evident audit log entries are immutable. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON intervention_audit_logs;
CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON intervention_audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_tampering();

-- -----------------------------------------------------------------------------
-- 12. Strategic Performance Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_screening_sender ON transaction_screening_requests(sender_account_id);
CREATE INDEX IF NOT EXISTS idx_screening_receiver ON transaction_screening_requests(receiver_account_id);
CREATE INDEX IF NOT EXISTS idx_screening_screened_at ON transaction_screening_requests(screened_at DESC);
CREATE INDEX IF NOT EXISTS idx_screening_decision ON transaction_screening_requests(decision);
CREATE INDEX IF NOT EXISTS idx_screening_scenario ON transaction_screening_requests(scenario_id);

CREATE INDEX IF NOT EXISTS idx_intel_risk_class ON account_intelligence_profiles(risk_classification);
CREATE INDEX IF NOT EXISTS idx_intel_account_status ON account_intelligence_profiles(account_status);
CREATE INDEX IF NOT EXISTS idx_intel_score ON account_intelligence_profiles(risk_score DESC);

CREATE INDEX IF NOT EXISTS idx_interventions_status ON transaction_interventions(review_status);
CREATE INDEX IF NOT EXISTS idx_interventions_action ON transaction_interventions(recommended_action);

CREATE INDEX IF NOT EXISTS idx_audit_sequence ON intervention_audit_logs(sequence_number ASC);
CREATE INDEX IF NOT EXISTS idx_audit_screening ON intervention_audit_logs(screening_id);
CREATE INDEX IF NOT EXISTS idx_audit_entry_hash ON intervention_audit_logs(entry_hash);

CREATE INDEX IF NOT EXISTS idx_risk_hist_account ON account_risk_history(account_id, recorded_at DESC);
