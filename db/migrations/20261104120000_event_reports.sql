-- migrate:up

-- Anyone signed in can report an event that breaks the community rules (Google
-- Play requires a way to report user-generated content). A platform admin
-- reviews the open reports and either removes the event or dismisses them.
CREATE TYPE report_reason     AS ENUM ('inappropriate', 'spam', 'misleading', 'other');
CREATE TYPE report_resolution AS ENUM ('removed', 'dismissed');

CREATE TABLE event_reports (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id    uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users (id),
  reason      report_reason NOT NULL,
  details     text CHECK (length(details) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users (id),
  resolution  report_resolution,
  CONSTRAINT event_reports_resolution_consistency
    CHECK ((resolved_at IS NULL) = (resolution IS NULL) AND (resolved_at IS NULL) = (resolved_by IS NULL))
);
-- One open report per person per event: reporting again updates it. Also the
-- index the review queue reads (open reports, by event).
CREATE UNIQUE INDEX event_reports_open_idx ON event_reports (event_id, reporter_id) WHERE resolved_at IS NULL;


-- migrate:down

DROP TABLE IF EXISTS event_reports;
DROP TYPE IF EXISTS report_resolution, report_reason;
