-- migrate:up

-- Platform-wide badges (organization_id NULL). Clubs can add their own, scoped
-- to their events. Criteria types are evaluated in apps/api/src/badges.
INSERT INTO badges (code, name, description, criteria) VALUES
  ('first_checkin', 'İlk Adım',  'İlk etkinliğine katıldın.',              '{"type": "checkin_count", "gte": 1}'),
  ('regular_5',     'Müdavim',   '5 etkinliğe katıldın.',                  '{"type": "checkin_count", "gte": 5}'),
  ('regular_20',    'Efsane',    '20 etkinliğe katıldın.',                 '{"type": "checkin_count", "gte": 20}'),
  ('explorer_3',    'Kaşif',     '3 farklı kulübün etkinliğine katıldın.', '{"type": "distinct_clubs", "gte": 3}');


-- migrate:down

DELETE FROM badges
 WHERE organization_id IS NULL
   AND code IN ('first_checkin', 'regular_5', 'regular_20', 'explorer_3');
