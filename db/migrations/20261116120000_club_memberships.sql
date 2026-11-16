-- migrate:up

-- Students can join a club: they ask, and the club's organizers approve or
-- refuse. This is club membership, not the club team (organization_members),
-- which runs the club and always counts as members.
CREATE TYPE membership_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE club_memberships (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status          membership_status NOT NULL DEFAULT 'pending',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  decided_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT club_memberships_decided CHECK ((status = 'pending') = (decided_at IS NULL))
);

-- The organizers' inbox, oldest request first.
CREATE INDEX club_memberships_pending_idx ON club_memberships (organization_id, requested_at)
  WHERE status = 'pending';
-- "My clubs" on the profile.
CREATE INDEX club_memberships_user_idx ON club_memberships (user_id);

-- Who can get an event's tickets. Replaces university_only:
--   everyone   - anyone signed in (events from before this change),
--   university - students of the club's university,
--   members    - the club's approved members and its team.
CREATE TYPE event_audience AS ENUM ('everyone', 'university', 'members');

ALTER TABLE events ADD COLUMN audience event_audience NOT NULL DEFAULT 'everyone';
UPDATE events SET audience = 'university' WHERE university_only;
ALTER TABLE events DROP COLUMN university_only;


-- migrate:down

ALTER TABLE events ADD COLUMN university_only boolean NOT NULL DEFAULT false;
-- Members-only events become university-only: the closest rule that still exists.
UPDATE events SET university_only = true WHERE audience IN ('university', 'members');
ALTER TABLE events DROP COLUMN IF EXISTS audience;
DROP TYPE IF EXISTS event_audience;

DROP TABLE IF EXISTS club_memberships;
DROP TYPE IF EXISTS membership_status;
