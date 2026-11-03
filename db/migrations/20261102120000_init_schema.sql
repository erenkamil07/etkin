-- migrate:up

-- Requires PostgreSQL 18+ (native uuidv7()).
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE platform_role      AS ENUM ('user', 'admin');
CREATE TYPE org_role           AS ENUM ('owner', 'organizer', 'scanner');
CREATE TYPE event_status       AS ENUM ('draft', 'published', 'cancelled', 'completed');
CREATE TYPE allocation_mode    AS ENUM ('fcfs', 'priority', 'lottery');
CREATE TYPE ticket_status      AS ENUM ('active', 'checked_in', 'cancelled');
CREATE TYPE checkin_method     AS ENUM ('qr', 'manual');
CREATE TYPE scan_result        AS ENUM ('accepted', 'duplicate', 'invalid_token', 'expired_token',
                                        'wrong_event', 'ticket_cancelled', 'outside_window');
CREATE TYPE ledger_reason      AS ENUM ('checkin', 'bonus', 'redemption', 'adjustment', 'reversal');
CREATE TYPE application_status AS ENUM ('pending', 'won', 'waitlisted', 'withdrawn');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; write a compensating row instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  email             citext NOT NULL UNIQUE CHECK (position('@' IN email) > 1),
  email_verified_at timestamptz,
  password_hash     text,                      -- argon2id; NULL for SSO-only accounts
  full_name         text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
  student_number    text,
  university        text,
  avatar_url        text,
  platform_role     platform_role NOT NULL DEFAULT 'user',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz                -- KVKK: rows are anonymised, never hard-deleted
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,                   -- reuse of a rotated token revokes the whole family
  token_hash  bytea NOT NULL UNIQUE,           -- sha256 of the opaque token; raw value never stored
  device_id   text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_tokens (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_active_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ---------------------------------------------------------------------------
-- Communities (clubs). Roles are per organization, so a student can organise
-- one club's events and attend another's with the same account.
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  slug        text NOT NULL UNIQUE
              CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 60),
  name        text NOT NULL,
  description text,
  logo_url    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            org_role NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX organization_members_user_idx ON organization_members (user_id);

-- ---------------------------------------------------------------------------
-- Events & ticket types
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organizations (id),
  title             text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description       text,
  location_name     text,
  cover_image_url   text,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  checkin_opens_at  timestamptz NOT NULL,
  checkin_closes_at timestamptz NOT NULL,
  checkin_points    integer NOT NULL DEFAULT 1 CHECK (checkin_points BETWEEN 0 AND 100),
  status            event_status NOT NULL DEFAULT 'draft',
  published_at      timestamptz,
  created_by        uuid NOT NULL REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_time_order    CHECK (ends_at > starts_at),
  CONSTRAINT events_checkin_order CHECK (checkin_closes_at > checkin_opens_at)
);
CREATE INDEX events_org_starts_idx ON events (organization_id, starts_at DESC);
CREATE INDEX events_published_starts_idx ON events (starts_at) WHERE status = 'published';

-- issued_count is a counter kept in the same transaction as ticket inserts:
--   UPDATE ticket_types SET issued_count = issued_count + 1
--    WHERE id = $1 AND issued_count < capacity RETURNING ...
-- The row lock serialises concurrent claims, so capacity can never be oversold.
CREATE TABLE ticket_types (
  id                        uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id                  uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name                      text NOT NULL,
  description               text,
  capacity                  integer NOT NULL CHECK (capacity > 0),
  issued_count              integer NOT NULL DEFAULT 0,
  price_cents               integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency                  char(3) NOT NULL DEFAULT 'TRY',
  allocation_mode           allocation_mode NOT NULL DEFAULT 'fcfs',
  min_points_required       integer NOT NULL DEFAULT 0 CHECK (min_points_required >= 0),
  priority_points_threshold integer CHECK (priority_points_threshold > 0),
  priority_sales_starts_at  timestamptz,
  sales_starts_at           timestamptz NOT NULL DEFAULT now(),
  sales_ends_at             timestamptz NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_types_name_unique   UNIQUE (event_id, name),
  CONSTRAINT ticket_types_id_event      UNIQUE (id, event_id),   -- target of tickets' composite FK
  CONSTRAINT ticket_types_capacity      CHECK (issued_count BETWEEN 0 AND capacity),
  CONSTRAINT ticket_types_sales_window  CHECK (sales_ends_at > sales_starts_at),
  -- 'priority' opens an early sales window for members above a points threshold
  CONSTRAINT ticket_types_priority_config CHECK (
    (allocation_mode =  'priority' AND priority_points_threshold IS NOT NULL
                                   AND priority_sales_starts_at < sales_starts_at)
    OR
    (allocation_mode <> 'priority' AND priority_points_threshold IS NULL
                                   AND priority_sales_starts_at IS NULL)
  )
);

-- ---------------------------------------------------------------------------
-- Tickets & check-ins
-- ---------------------------------------------------------------------------
-- The QR secret is never stored: it is derived as
--   HMAC(master_key, ticket_id || qr_key_version)
-- so a database leak does not leak live QR codes. Bumping qr_key_version
-- (device change, suspected sharing) invalidates every code issued before.
CREATE TABLE tickets (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  ticket_type_id  uuid NOT NULL,
  event_id        uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES users (id),
  status          ticket_status NOT NULL DEFAULT 'active',
  qr_key_version  integer NOT NULL DEFAULT 1 CHECK (qr_key_version > 0),
  bound_device_id text,
  checked_in_at   timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tickets_type_event_fk FOREIGN KEY (ticket_type_id, event_id)
    REFERENCES ticket_types (id, event_id),
  CONSTRAINT tickets_id_event_user  UNIQUE (id, event_id, user_id), -- target of check_ins' composite FK
  CONSTRAINT tickets_checked_in_consistency CHECK ((status = 'checked_in') = (checked_in_at IS NOT NULL)),
  CONSTRAINT tickets_cancelled_consistency  CHECK ((status = 'cancelled')  = (cancelled_at  IS NOT NULL))
);
-- One live ticket per user per event; cancelled tickets free the slot.
CREATE UNIQUE INDEX tickets_one_live_per_user_event ON tickets (event_id, user_id)
  WHERE status <> 'cancelled';
CREATE INDEX tickets_user_created_idx ON tickets (user_id, created_at DESC);
CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);

-- Double check-in protection is layered:
--   1. UPDATE tickets SET status = 'checked_in' ... WHERE id = $1 AND status = 'active'
--      (row lock: of two concurrent scans exactly one sees status = 'active')
--   2. UNIQUE (ticket_id) below as a backstop if any code path skips step 1.
CREATE TABLE check_ins (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  ticket_id         uuid NOT NULL,
  event_id          uuid NOT NULL,
  user_id           uuid NOT NULL,
  scanned_by        uuid NOT NULL REFERENCES users (id),
  method            checkin_method NOT NULL DEFAULT 'qr',
  gate              text,
  scanner_device_id text,
  idempotency_key   uuid UNIQUE,               -- lets a retried scan return the original success
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_ins_one_per_ticket UNIQUE (ticket_id),
  CONSTRAINT check_ins_ticket_fk FOREIGN KEY (ticket_id, event_id, user_id)
    REFERENCES tickets (id, event_id, user_id)
);
CREATE INDEX check_ins_event_created_idx ON check_ins (event_id, created_at);
CREATE INDEX check_ins_user_created_idx ON check_ins (user_id, created_at DESC);

-- Every scan, including rejected ones, for gate analytics and fraud review.
CREATE TABLE scan_attempts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id          uuid NOT NULL REFERENCES events (id),
  ticket_id         uuid,                      -- no FK: forged payloads must still be loggable
  scanned_by        uuid NOT NULL REFERENCES users (id),
  result            scan_result NOT NULL,
  gate              text,
  scanner_device_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scan_attempts_event_created_idx ON scan_attempts (event_id, created_at);
CREATE INDEX scan_attempts_ticket_idx ON scan_attempts (ticket_id) WHERE ticket_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Loyalty: append-only ledger + trigger-maintained balances
-- ---------------------------------------------------------------------------
CREATE TABLE point_ledger (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES users (id),
  organization_id   uuid NOT NULL REFERENCES organizations (id),
  delta             integer NOT NULL CHECK (delta <> 0),
  reason            ledger_reason NOT NULL,
  check_in_id       uuid REFERENCES check_ins (id),
  reverses_entry_id bigint REFERENCES point_ledger (id),
  note              text,
  created_by        uuid REFERENCES users (id), -- NULL = system
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT point_ledger_checkin_source  CHECK ((reason = 'checkin')  = (check_in_id IS NOT NULL)),
  CONSTRAINT point_ledger_reversal_source CHECK ((reason = 'reversal') = (reverses_entry_id IS NOT NULL)),
  CONSTRAINT point_ledger_delta_sign CHECK (
    (reason IN ('checkin', 'bonus') AND delta > 0)
    OR (reason = 'redemption' AND delta < 0)
    OR reason IN ('adjustment', 'reversal')
  )
);
-- A check-in can award points once; an entry can be reversed once.
CREATE UNIQUE INDEX point_ledger_one_per_checkin ON point_ledger (check_in_id) WHERE check_in_id IS NOT NULL;
CREATE UNIQUE INDEX point_ledger_one_reversal ON point_ledger (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX point_ledger_user_created_idx ON point_ledger (user_id, created_at DESC);
CREATE INDEX point_ledger_org_user_idx ON point_ledger (organization_id, user_id, created_at);

CREATE TRIGGER point_ledger_append_only
  BEFORE UPDATE OR DELETE ON point_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- balance is spendable; lifetime_earned only grows with earned points and is
-- what priority / lottery eligibility looks at, so spending never hurts rank.
CREATE TABLE point_balances (
  user_id         uuid NOT NULL REFERENCES users (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  balance         integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned integer NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);
CREATE INDEX point_balances_leaderboard_idx ON point_balances (organization_id, lifetime_earned DESC);

CREATE FUNCTION apply_point_ledger_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reversed       point_ledger%ROWTYPE;
  lifetime_delta integer := NEW.delta;
BEGIN
  IF NEW.reason = 'reversal' THEN
    SELECT * INTO reversed FROM point_ledger WHERE id = NEW.reverses_entry_id;
    IF reversed.reason = 'reversal' THEN
      RAISE EXCEPTION 'cannot reverse a reversal (entry %)', reversed.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.delta <> -reversed.delta
       OR NEW.user_id <> reversed.user_id
       OR NEW.organization_id <> reversed.organization_id THEN
      RAISE EXCEPTION 'reversal must negate entry % exactly', reversed.id USING ERRCODE = 'check_violation';
    END IF;
    IF reversed.reason = 'redemption' THEN
      lifetime_delta := 0;
    END IF;
  ELSIF NEW.reason = 'redemption' THEN
    lifetime_delta := 0;
  END IF;

  -- Not a single upsert: INSERT ... ON CONFLICT checks CHECK constraints on the
  -- proposed row first, so a negative delta would fail before reaching DO UPDATE.
  -- Ensure the row exists, then apply the delta under the row lock.
  INSERT INTO point_balances (user_id, organization_id)
  VALUES (NEW.user_id, NEW.organization_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  UPDATE point_balances
     SET balance         = balance + NEW.delta,
         lifetime_earned = lifetime_earned + lifetime_delta,
         updated_at      = now()
   WHERE user_id = NEW.user_id AND organization_id = NEW.organization_id;
  RETURN NULL;
END $$;

CREATE TRIGGER point_ledger_apply_balance
  AFTER INSERT ON point_ledger
  FOR EACH ROW EXECUTE FUNCTION apply_point_ledger_entry();

-- ---------------------------------------------------------------------------
-- Badges
-- ---------------------------------------------------------------------------
CREATE TABLE badges (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid REFERENCES organizations (id) ON DELETE CASCADE, -- NULL = platform-wide
  code            text NOT NULL CHECK (code ~ '^[a-z0-9_]{2,50}$'),
  name            text NOT NULL,
  description     text,
  icon_url        text,
  criteria        jsonb NOT NULL,              -- e.g. {"type": "checkin_count", "gte": 5}
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT badges_code_unique UNIQUE NULLS NOT DISTINCT (organization_id, code),
  CONSTRAINT badges_criteria_shape CHECK (jsonb_typeof(criteria) = 'object' AND criteria ? 'type')
);

CREATE TABLE user_badges (
  user_id     uuid NOT NULL REFERENCES users (id),
  badge_id    uuid NOT NULL REFERENCES badges (id) ON DELETE CASCADE,
  check_in_id uuid REFERENCES check_ins (id),  -- the check-in that unlocked it, if any
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- Points-weighted allocation for limited events (allocation_mode = 'lottery')
-- ---------------------------------------------------------------------------
CREATE TABLE allocation_runs (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  ticket_type_id uuid NOT NULL REFERENCES ticket_types (id) ON DELETE CASCADE,
  algorithm      text NOT NULL,                -- e.g. 'weighted_lottery_v1'
  seed           bytea NOT NULL,               -- published, so anyone can replay the draw
  params         jsonb NOT NULL DEFAULT '{}',
  slots          integer NOT NULL CHECK (slots > 0),
  executed_by    uuid NOT NULL REFERENCES users (id),
  executed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX allocation_runs_type_idx ON allocation_runs (ticket_type_id, executed_at);

CREATE TABLE ticket_applications (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  ticket_type_id    uuid NOT NULL REFERENCES ticket_types (id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users (id),
  status            application_status NOT NULL DEFAULT 'pending',
  weight            numeric(12, 6),            -- snapshot taken at draw time
  allocation_run_id uuid REFERENCES allocation_runs (id),
  ticket_id         uuid REFERENCES tickets (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  CONSTRAINT ticket_applications_once UNIQUE (ticket_type_id, user_id),
  CONSTRAINT ticket_applications_won_has_ticket CHECK ((status = 'won') = (ticket_id IS NOT NULL))
);
CREATE INDEX ticket_applications_pending_idx ON ticket_applications (ticket_type_id) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Transactional outbox: side effects (badges, push, live dashboard) are written
-- in the same transaction as the check-in and processed by a worker with
-- SELECT ... FOR UPDATE SKIP LOCKED.
-- ---------------------------------------------------------------------------
CREATE TABLE outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic        text NOT NULL,                  -- e.g. 'checkin.accepted'
  payload      jsonb NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE processed_at IS NULL;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE TRIGGER users_set_updated_at         BEFORE UPDATE ON users         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER events_set_updated_at        BEFORE UPDATE ON events        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ticket_types_set_updated_at  BEFORE UPDATE ON ticket_types  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tickets_set_updated_at       BEFORE UPDATE ON tickets       FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- migrate:down

DROP TABLE IF EXISTS
  outbox, ticket_applications, allocation_runs, user_badges, badges,
  point_balances, point_ledger, scan_attempts, check_ins, tickets,
  ticket_types, events, organization_members, organizations,
  refresh_tokens, users;

DROP FUNCTION IF EXISTS apply_point_ledger_entry(), forbid_mutation(), set_updated_at();

DROP TYPE IF EXISTS
  application_status, ledger_reason, scan_result, checkin_method, ticket_status,
  allocation_mode, event_status, org_role, platform_role;

DROP EXTENSION IF EXISTS citext;
