-- migrate:up

-- Events show a few attendees' faces next to "N kişi katılıyor". A profile photo
-- was private to its owner and the clubs' teams, so it appears there only when
-- its owner turns this on; it starts off for everyone.
ALTER TABLE users ADD COLUMN show_photo_at_events boolean NOT NULL DEFAULT false;


-- migrate:down

ALTER TABLE users DROP COLUMN IF EXISTS show_photo_at_events;
