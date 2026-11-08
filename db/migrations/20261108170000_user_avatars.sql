-- migrate:up

-- Profile photos, so the door can see who a ticket belongs to. Stored like
-- event posters (small JPEG, metadata removed). users.avatar_url points at
-- /users/<id>/avatar?v=<version>, and the photo is served only with the
-- current version, which only the club teams that see the person learn.
CREATE TABLE user_avatars (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data       bytea NOT NULL CHECK (octet_length(data) <= 524288),
  version    text  NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);


-- migrate:down

DROP TABLE IF EXISTS user_avatars;
