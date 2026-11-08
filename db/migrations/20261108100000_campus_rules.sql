-- migrate:up

-- Two rules clubs asked for, so limited seats go to people who will come.

-- 1. An event can be open to its club's university only.
ALTER TABLE events ADD COLUMN university_only boolean NOT NULL DEFAULT false;

-- ...and students can't hop universities to get round that: after choosing,
-- a free week to fix a wrong pick, then one change a year. NULL means the
-- student has never chosen, so their first pick is free.
ALTER TABLE users ADD COLUMN university_chosen_at timestamptz;

-- 2. A club can turn on a no-show rule: after no_show_limit unexcused
-- no-shows in 90 days, no tickets from that club for no_show_ban_days.
ALTER TABLE organizations
  ADD COLUMN no_show_limit    smallint CHECK (no_show_limit BETWEEN 2 AND 5),
  ADD COLUMN no_show_ban_days smallint CHECK (no_show_ban_days IN (7, 14, 30)),
  ADD CONSTRAINT organizations_no_show_rule CHECK ((no_show_limit IS NULL) = (no_show_ban_days IS NULL));

-- An organizer can mark a no-show as excused ("Mazeretli") so it doesn't count.
ALTER TABLE tickets ADD COLUMN excused_at timestamptz;


-- migrate:down

ALTER TABLE tickets DROP COLUMN IF EXISTS excused_at;
ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_no_show_rule,
  DROP COLUMN IF EXISTS no_show_ban_days,
  DROP COLUMN IF EXISTS no_show_limit;
ALTER TABLE users DROP COLUMN IF EXISTS university_chosen_at;
ALTER TABLE events DROP COLUMN IF EXISTS university_only;
