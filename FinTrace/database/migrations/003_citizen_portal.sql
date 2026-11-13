-- FinTrace Database Migration 003: Citizen Portal, Status History & Notifications
-- Note: Do NOT edit 001_initial_schema.sql or 002_indexes_and_views.sql.

-- 1. Extend roles CHECK constraint to include 'citizen' and seed the citizen role
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_check;
ALTER TABLE roles
  ADD CONSTRAINT roles_name_check CHECK (
    name IN (
      'Administrator',
      'Senior Investigator',
      'Investigator',
      'Bank Nodal Officer',
      'citizen'
    )
  );

INSERT INTO roles (name, description, permissions)
VALUES (
  'citizen',
  'Complainant / Citizen portal user: file cybercrime complaints, upload supporting evidence, and track sanitized status updates.',
  '["citizen:complaints:create", "citizen:complaints:read", "citizen:evidence:upload", "citizen:notifications:read"]'::jsonb
)
ON CONFLICT (name) DO UPDATE
  SET description = EXCLUDED.description,
      permissions = EXCLUDED.permissions;

-- 2. Link users -> victims and store masked phone for citizen profiles
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS victim_id UUID REFERENCES victims(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phone_masked VARCHAR(25);

CREATE INDEX IF NOT EXISTS idx_users_victim_id ON users(victim_id);

-- 3. Extend complaints for citizen ownership, server-generated reference_no, and citizen-facing status
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS filed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_no VARCHAR(40),
  ADD COLUMN IF NOT EXISTS citizen_status VARCHAR(40) NOT NULL DEFAULT 'Submitted',
  ADD COLUMN IF NOT EXISTS victim_bank_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS victim_account_masked VARCHAR(64);

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_citizen_status_check;
ALTER TABLE complaints
  ADD CONSTRAINT complaints_citizen_status_check CHECK (
    citizen_status IN (
      'Submitted',
      'Under Review',
      'Assigned to Investigator',
      'Investigation in Progress',
      'Action Taken / Closed'
    )
  );

-- Backfill unique reference_no for any pre-existing complaints
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM complaints
  WHERE reference_no IS NULL
)
UPDATE complaints c
SET reference_no = 'FT-' || EXTRACT(YEAR FROM c.reported_at)::TEXT || '-' || LPAD(n.rn::TEXT, 6, '0')
FROM numbered n
WHERE c.id = n.id;

ALTER TABLE complaints ALTER COLUMN reference_no SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'complaints_reference_no_unique'
  ) THEN
    ALTER TABLE complaints ADD CONSTRAINT complaints_reference_no_unique UNIQUE (reference_no);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_complaints_filed_by_user_id ON complaints(filed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_complaints_reference_no ON complaints(reference_no);

-- 4. Allow evidence_records directly on citizen complaints before an investigation exists
ALTER TABLE evidence_records
  ALTER COLUMN investigation_id DROP NOT NULL;

ALTER TABLE evidence_records
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(120),
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS is_citizen_visible BOOLEAN NOT NULL DEFAULT FALSE;

-- 5. Complaint status history (public remarks vs internal notes)
CREATE TABLE IF NOT EXISTS complaint_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL,
  citizen_status VARCHAR(40) NOT NULL,
  public_remark TEXT,
  internal_note TEXT,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaint_status_history_complaint
  ON complaint_status_history(complaint_id, changed_at DESC);

-- 6. In-app citizen status-change notifications
CREATE TABLE IF NOT EXISTS citizen_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  reference_no VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  citizen_status VARCHAR(40) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_citizen_notifications_user
  ON citizen_notifications(user_id, is_read, created_at DESC);
