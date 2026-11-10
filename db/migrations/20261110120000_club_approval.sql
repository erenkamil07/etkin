-- migrate:up

-- A new club is an application until a platform admin checks it is real and
-- run by the person applying. Until then it can prepare drafts but publish
-- nothing, so nobody outside the club sees it.
CREATE TYPE organization_status AS ENUM ('pending', 'approved', 'rejected');

-- The applicant's role in the club, as they state it.
CREATE TYPE applicant_role AS ENUM ('president', 'board_member', 'advisor', 'other');

-- Clubs that already exist were set up by hand, so they start approved.
ALTER TABLE organizations
  ADD COLUMN status           organization_status NOT NULL DEFAULT 'approved',
  ADD COLUMN applicant_role   applicant_role,
  -- The club's Instagram or web page, where the admin checks it.
  ADD COLUMN verification_url text CHECK (char_length(verification_url) <= 300),
  ADD COLUMN application_note text CHECK (char_length(application_note) <= 500),
  ADD COLUMN submitted_at     timestamptz,
  ADD COLUMN reviewed_at      timestamptz,
  ADD COLUMN reviewed_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Kept when the club applies again, so the admin sees what was wrong last time.
  ADD COLUMN rejection_reason text CHECK (char_length(rejection_reason) <= 500);

ALTER TABLE organizations ALTER COLUMN status SET DEFAULT 'pending';

-- The admin's queue, oldest application first.
CREATE INDEX organizations_pending_idx ON organizations (submitted_at) WHERE status = 'pending';


-- migrate:down

DROP INDEX IF EXISTS organizations_pending_idx;
ALTER TABLE organizations
  DROP COLUMN IF EXISTS rejection_reason,
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS application_note,
  DROP COLUMN IF EXISTS verification_url,
  DROP COLUMN IF EXISTS applicant_role,
  DROP COLUMN IF EXISTS status;
DROP TYPE IF EXISTS applicant_role;
DROP TYPE IF EXISTS organization_status;
