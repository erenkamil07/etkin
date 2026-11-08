-- migrate:up

-- Event posters ("afiş"), uploaded by the club. They live in the database:
-- the app shrinks them to about 1200 px and 150-300 KB before upload, so a
-- campus's worth of events stays small, and there is no file store to run.
CREATE TABLE event_covers (
  event_id   uuid PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  data       bytea   NOT NULL CHECK (octet_length(data) <= 1572864),
  width      integer NOT NULL CHECK (width BETWEEN 1 AND 8000),
  height     integer NOT NULL CHECK (height BETWEEN 1 AND 8000),
  -- Part of the poster's URL, so a new poster is never served from a cache.
  version    text    NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);


-- migrate:down

DROP TABLE IF EXISTS event_covers;
