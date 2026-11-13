-- =============================================================================
-- Migration 001: FinTrace Initial Normalized PostgreSQL 16 Schema
-- All seeded records are synthetic demonstration data for SIH PS 26184.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Migration tracking table (used by migrate.ts when run outside docker init)
CREATE TABLE IF NOT EXISTS schema_migrations (
    version         VARCHAR(255) PRIMARY KEY,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. roles
CREATE TABLE roles (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(50) NOT NULL UNIQUE
                    CHECK (name IN (
                        'Administrator',
                        'Senior Investigator',
                        'Investigator',
                        'Bank Nodal Officer'
                    )),
    description     TEXT NOT NULL,
    permissions     JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. financial_institutions
CREATE TABLE financial_institutions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,
    ifsc_prefix     VARCHAR(11) NOT NULL UNIQUE,
    bank_code       VARCHAR(20) NOT NULL UNIQUE,
    nodal_email     VARCHAR(150),
    headquarters    VARCHAR(120),
    is_synthetic    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. users
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(150) NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    full_name           VARCHAR(150) NOT NULL,
    role_id             INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    institution_id      UUID REFERENCES financial_institutions(id) ON DELETE SET NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. investigators
CREATE TABLE investigators (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    badge_number    VARCHAR(50) NOT NULL UNIQUE,
    unit_name       VARCHAR(120) NOT NULL,
    jurisdiction    VARCHAR(120) NOT NULL,
    specialization  VARCHAR(120),
    active_caseload INT NOT NULL DEFAULT 0 CHECK (active_caseload >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. victims
CREATE TABLE victims (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       VARCHAR(150) NOT NULL,
    phone_masked    VARCHAR(20) NOT NULL,
    email           VARCHAR(150),
    city            VARCHAR(100) NOT NULL,
    state           VARCHAR(100) NOT NULL,
    home_lat        DOUBLE PRECISION CHECK (home_lat IS NULL OR (home_lat BETWEEN -90 AND 90)),
    home_lng        DOUBLE PRECISION CHECK (home_lng IS NULL OR (home_lng BETWEEN -180 AND 180)),
    is_synthetic    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. complaints
CREATE TABLE complaints (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_number    VARCHAR(40) NOT NULL UNIQUE,
    victim_id           UUID NOT NULL REFERENCES victims(id) ON DELETE RESTRICT,
    assigned_to         UUID REFERENCES investigators(id) ON DELETE SET NULL,
    fraud_type          VARCHAR(80) NOT NULL CHECK (fraud_type IN (
                            'UPI_PHISHING',
                            'INVESTMENT_SCAM',
                            'DIGITAL_ARREST',
                            'OTP_HIJACK',
                            'CARD_SKIMMING',
                            'LOAN_APP_FRAUD',
                            'OTHER'
                        )),
    reported_amount     NUMERIC(15, 2) NOT NULL CHECK (reported_amount > 0),
    currency            CHAR(3) NOT NULL DEFAULT 'INR',
    incident_timestamp  TIMESTAMPTZ NOT NULL,
    reported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status              VARCHAR(30) NOT NULL DEFAULT 'REGISTERED' CHECK (status IN (
                            'REGISTERED',
                            'TRACING',
                            'MULE_IDENTIFIED',
                            'ATM_ALERTED',
                            'CONTAINED',
                            'CLOSED'
                        )),
    priority            VARCHAR(20) NOT NULL DEFAULT 'HIGH' CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    summary             TEXT NOT NULL,
    city                VARCHAR(100) NOT NULL,
    is_synthetic        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. bank_accounts
CREATE TABLE bank_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_number      VARCHAR(34) NOT NULL UNIQUE,
    institution_id      UUID NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
    holder_name         VARCHAR(150) NOT NULL,
    account_type        VARCHAR(30) NOT NULL CHECK (account_type IN ('SAVINGS', 'CURRENT', 'WALLET', 'MERCHANT')),
    ifsc_code           VARCHAR(11) NOT NULL,
    branch_city         VARCHAR(100) NOT NULL,
    branch_lat          DOUBLE PRECISION NOT NULL CHECK (branch_lat BETWEEN -90 AND 90),
    branch_lng          DOUBLE PRECISION NOT NULL CHECK (branch_lng BETWEEN -180 AND 180),
    kyc_verified        BOOLEAN NOT NULL DEFAULT TRUE,
    account_age_days    INT NOT NULL DEFAULT 365 CHECK (account_age_days >= 0),
    is_frozen           BOOLEAN NOT NULL DEFAULT FALSE,
    is_synthetic        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. transactions
CREATE TABLE transactions (
    txn_id              VARCHAR(64) PRIMARY KEY,
    from_account        UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
    to_account          UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
    amount              NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    currency            CHAR(3) NOT NULL DEFAULT 'INR',
    timestamp           TIMESTAMPTZ NOT NULL,
    channel             VARCHAR(30) NOT NULL CHECK (channel IN ('UPI', 'IMPS', 'NEFT', 'RTGS', 'CARD', 'WALLET')),
    complaint_id        UUID REFERENCES complaints(id) ON DELETE SET NULL,
    hop_depth           INT CHECK (hop_depth IS NULL OR hop_depth >= 0),
    is_flagged_fraud    BOOLEAN NOT NULL DEFAULT FALSE,
    remarks             TEXT,
    is_synthetic        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_distinct_accounts CHECK (from_account <> to_account)
);

-- 9. beneficiary_accounts
CREATE TABLE beneficiary_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_account_id   UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    beneficiary_id      UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    added_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_transferred   NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_transferred >= 0),
    transfer_count      INT NOT NULL DEFAULT 0 CHECK (transfer_count >= 0),
    UNIQUE (source_account_id, beneficiary_id),
    CHECK (source_account_id <> beneficiary_id)
);

-- 10. suspicious_accounts
CREATE TABLE suspicious_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    complaint_id        UUID REFERENCES complaints(id) ON DELETE SET NULL,
    classification      VARCHAR(40) NOT NULL CHECK (classification IN (
                            'SUSPECTED_MULE',
                            'LAYERING_NODE',
                            'CASH_OUT_CANDIDATE',
                            'ORIGIN_COMPROMISED',
                            'CLEARED'
                        )),
    mule_probability    NUMERIC(5, 4) CHECK (mule_probability IS NULL OR (mule_probability BETWEEN 0 AND 1)),
    score_source        VARCHAR(40) NOT NULL CHECK (score_source IN (
                            'Trained ML prediction',
                            'Rule-based risk score',
                            'Synthetic demo result'
                        )),
    reason              TEXT NOT NULL,
    flagged_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    status              VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FROZEN', 'CLEARED')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, complaint_id)
);

-- 11. atms
CREATE TABLE atms (
    id                  VARCHAR(40) PRIMARY KEY,
    bank                VARCHAR(120) NOT NULL,
    institution_id      UUID REFERENCES financial_institutions(id) ON DELETE SET NULL,
    address             TEXT NOT NULL,
    locality            VARCHAR(120) NOT NULL,
    city                VARCHAR(100) NOT NULL,
    state               VARCHAR(100) NOT NULL,
    lat                 DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng                 DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    cash_capacity_tier  VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' CHECK (cash_capacity_tier IN ('HIGH', 'MEDIUM', 'LOW')),
    is_24x7             BOOLEAN NOT NULL DEFAULT TRUE,
    is_synthetic        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. atm_withdrawals
CREATE TABLE atm_withdrawals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atm_id              VARCHAR(40) NOT NULL REFERENCES atms(id) ON DELETE RESTRICT,
    account_id          UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
    complaint_id        UUID REFERENCES complaints(id) ON DELETE SET NULL,
    amount              NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    withdrawn_at        TIMESTAMPTZ NOT NULL,
    card_last4          CHAR(4),
    is_flagged_cashout  BOOLEAN NOT NULL DEFAULT FALSE,
    is_synthetic        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. transaction_networks
CREATE TABLE transaction_networks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id        UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    root_account_id     UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
    max_depth           INT NOT NULL CHECK (max_depth BETWEEN 1 AND 10),
    node_count          INT NOT NULL CHECK (node_count >= 1),
    edge_count          INT NOT NULL CHECK (edge_count >= 0),
    total_traced_amount NUMERIC(15, 2) NOT NULL CHECK (total_traced_amount >= 0),
    has_cycles          BOOLEAN NOT NULL DEFAULT FALSE,
    metrics_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. fraud_detection_results
CREATE TABLE fraud_detection_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id        UUID REFERENCES complaints(id) ON DELETE CASCADE,
    account_id          UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    txn_id              VARCHAR(64) REFERENCES transactions(txn_id) ON DELETE SET NULL,
    is_anomaly          BOOLEAN NOT NULL,
    anomaly_score       NUMERIC(6, 4) NOT NULL,
    mule_score          NUMERIC(5, 2) NOT NULL CHECK (mule_score BETWEEN 0 AND 100),
    score_source        VARCHAR(40) NOT NULL CHECK (score_source IN (
                            'Trained ML prediction',
                            'Rule-based risk score',
                            'Synthetic demo result'
                        )),
    velocity_1h         INT NOT NULL DEFAULT 0 CHECK (velocity_1h >= 0),
    pass_through_ratio  NUMERIC(6, 4) CHECK (pass_through_ratio IS NULL OR pass_through_ratio >= 0),
    avg_forward_sec     DOUBLE PRECISION CHECK (avg_forward_sec IS NULL OR avg_forward_sec >= 0),
    explanation_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. model_metrics
CREATE TABLE model_metrics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name          VARCHAR(80) NOT NULL,
    model_version       VARCHAR(40) NOT NULL,
    split_strategy      VARCHAR(60) NOT NULL DEFAULT 'time_based_split',
    train_count         INT NOT NULL CHECK (train_count >= 0),
    val_count           INT NOT NULL CHECK (val_count >= 0),
    test_count          INT NOT NULL CHECK (test_count >= 0),
    precision_score     NUMERIC(5, 4) NOT NULL CHECK (precision_score BETWEEN 0 AND 1),
    recall_score        NUMERIC(5, 4) NOT NULL CHECK (recall_score BETWEEN 0 AND 1),
    f1_score            NUMERIC(5, 4) NOT NULL CHECK (f1_score BETWEEN 0 AND 1),
    roc_auc             NUMERIC(5, 4) CHECK (roc_auc IS NULL OR (roc_auc BETWEEN 0 AND 1)),
    pr_auc              NUMERIC(5, 4) CHECK (pr_auc IS NULL OR (pr_auc BETWEEN 0 AND 1)),
    precision_at_k      JSONB NOT NULL DEFAULT '{}'::jsonb,
    recall_at_k         JSONB NOT NULL DEFAULT '{}'::jsonb,
    confusion_matrix    JSONB NOT NULL DEFAULT '{}'::jsonb,
    feature_importance  JSONB NOT NULL DEFAULT '[]'::jsonb,
    trained_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_name, model_version)
);

-- 16. ml_predictions
CREATE TABLE ml_predictions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    complaint_id        UUID REFERENCES complaints(id) ON DELETE SET NULL,
    model_name          VARCHAR(80) NOT NULL,
    model_version       VARCHAR(40) NOT NULL,
    predicted_label     VARCHAR(40) NOT NULL,
    raw_score           NUMERIC(6, 4) NOT NULL,
    score_source        VARCHAR(40) NOT NULL CHECK (score_source IN (
                            'Trained ML prediction',
                            'Rule-based risk score',
                            'Synthetic demo result'
                        )),
    shap_values_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
    features_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
    predicted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. atm_predictions
CREATE TABLE atm_predictions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atm_id                  VARCHAR(40) NOT NULL REFERENCES atms(id) ON DELETE CASCADE,
    complaint_id            UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    risk_score              NUMERIC(5, 2) NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    risk_level              VARCHAR(20) NOT NULL CHECK (risk_level IN ('Critical', 'High', 'Medium', 'Low')),
    "window"                VARCHAR(16) NOT NULL CHECK ("window" IN ('0-6h', '6-12h', '12-24h', '>24h')),
    confidence              VARCHAR(20) NOT NULL CHECK (confidence IN ('High', 'Moderate', 'Low')),
    score_source            VARCHAR(40) NOT NULL CHECK (score_source IN (
                                'Trained ML prediction',
                                'Rule-based risk score',
                                'Synthetic demo result'
                            )),
    linked_accounts_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
    relevant_paths_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
    explanation_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
    limitations_text        TEXT NOT NULL,
    model_version           VARCHAR(40) NOT NULL,
    rank_order              INT NOT NULL CHECK (rank_order >= 1),
    predicted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18. risk_scores
CREATE TABLE risk_scores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         VARCHAR(20) NOT NULL CHECK (entity_type IN ('ACCOUNT', 'COMPLAINT', 'ATM')),
    entity_id           VARCHAR(64) NOT NULL,
    composite_score     NUMERIC(5, 2) NOT NULL CHECK (composite_score BETWEEN 0 AND 100),
    risk_level          VARCHAR(20) NOT NULL CHECK (risk_level IN ('Critical', 'High', 'Medium', 'Low')),
    score_source        VARCHAR(40) NOT NULL CHECK (score_source IN (
                            'Trained ML prediction',
                            'Rule-based risk score',
                            'Synthetic demo result'
                        )),
    factors_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. alerts
CREATE TABLE alerts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id        UUID REFERENCES complaints(id) ON DELETE CASCADE,
    account_id          UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
    atm_id              VARCHAR(40) REFERENCES atms(id) ON DELETE SET NULL,
    alert_type          VARCHAR(50) NOT NULL CHECK (alert_type IN (
                            'CASH_OUT_IMMINENT',
                            'MULE_BURST',
                            'LAYERING_CYCLE',
                            'HIGH_VALUE_HOP',
                            'ANOMALY_DETECTED'
                        )),
    severity            VARCHAR(20) NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low')),
    status              VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN (
                            'OPEN',
                            'ACKNOWLEDGED',
                            'DISPATCHED',
                            'RESOLVED',
                            'FALSE_POSITIVE'
                        )),
    title               VARCHAR(200) NOT NULL,
    description         TEXT NOT NULL,
    score_source        VARCHAR(40) NOT NULL CHECK (score_source IN (
                            'Trained ML prediction',
                            'Rule-based risk score',
                            'Synthetic demo result'
                        )),
    acknowledged_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 20. investigations
CREATE TABLE investigations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_number         VARCHAR(40) NOT NULL UNIQUE,
    complaint_id        UUID NOT NULL UNIQUE REFERENCES complaints(id) ON DELETE CASCADE,
    lead_investigator   UUID REFERENCES investigators(id) ON DELETE SET NULL,
    status              VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN (
                            'OPEN',
                            'ACTIVE_TRACE',
                            'FREEZE_REQUESTED',
                            'ATM_SURVEILLANCE',
                            'CLOSED'
                        )),
    findings_summary    TEXT,
    recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    opened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 21. evidence_records
CREATE TABLE evidence_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id    UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    complaint_id        UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    uploaded_by         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    evidence_type       VARCHAR(50) NOT NULL CHECK (evidence_type IN (
                            'BANK_STATEMENT_CSV',
                            'CDR_EXTRACT',
                            'ATM_CCTV_NOTE',
                            'NPCI_REF',
                            'FREEZE_ORDER',
                            'OTHER'
                        )),
    title               VARCHAR(200) NOT NULL,
    description         TEXT NOT NULL,
    file_name           VARCHAR(255),
    sha256_hash         CHAR(64),
    metadata_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 22. audit_logs
CREATE TABLE audit_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role          VARCHAR(50),
    action              VARCHAR(100) NOT NULL,
    resource_type       VARCHAR(60) NOT NULL,
    resource_id         VARCHAR(100),
    http_method         VARCHAR(10),
    endpoint            VARCHAR(255),
    ip_address          VARCHAR(64),
    status_code         INT,
    details_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
