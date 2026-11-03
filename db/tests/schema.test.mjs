// Schema invariant tests. Runs every migration against PGlite (PostgreSQL 18 compiled
// to WASM), so it needs no Docker and finishes in seconds in CI.
// Concurrency (two gates scanning at once) needs real connections and lives in the
// API's Testcontainers suite instead.
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';

const dir = new URL('../migrations/', import.meta.url);
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => {
    const [up, down] = readFileSync(new URL(f, dir), 'utf8').split('-- migrate:down');
    return { up: up.replace('-- migrate:up', ''), down };
  });

const db = new PGlite({ extensions: { citext } });
const migrateUp = async () => {
  for (const m of migrations) await db.exec(m.up);
};
const migrateDown = async () => {
  for (const m of [...migrations].reverse()) await db.exec(m.down);
};

let pass = 0,
  fail = 0;
const ok = (cond, label) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
};
// `expect` pins the failure to the intended constraint so a test can't pass for the wrong reason.
const rejects = async (q, label, params = [], expect) => {
  try {
    await db.query(q, params);
    ok(false, `${label} (was accepted)`);
  } catch (e) {
    const msg = e.message.split('\n')[0];
    ok(!expect || msg.includes(expect), `${label} -> ${msg}`);
  }
};
const one = async (q, params = []) => (await db.query(q, params)).rows[0];

await migrateUp();
ok(true, 'up migrations applied');

// --- identity & organizations ---------------------------------------------
const u = await one(`INSERT INTO users (email, full_name) VALUES ('Eren@Uni.edu.tr', 'Eren') RETURNING id`);
const scanner = await one(`INSERT INTO users (email, full_name) VALUES ('gate@uni.edu.tr', 'Gate Staff') RETURNING id`);
await rejects(
  `INSERT INTO users (email, full_name) VALUES ('eren@uni.edu.tr', 'Dup')`,
  'email is case-insensitive unique',
  [],
  'users_email_key',
);

const org = await one(`INSERT INTO organizations (slug, name) VALUES ('ieee-kulubu', 'IEEE') RETURNING id`);
await rejects(
  `INSERT INTO organizations (slug, name) VALUES ('Bad Slug', 'x')`,
  'slug format enforced',
  [],
  'organizations_slug_check',
);

// --- events & ticket types ------------------------------------------------
const newEvent = (title, offset) =>
  one(
    `INSERT INTO events (organization_id, title, starts_at, ends_at, checkin_opens_at, checkin_closes_at, created_by)
   VALUES ($1, $2, now() + $3::interval, now() + $3::interval + interval '2 hours',
           now() + $3::interval - interval '1 hour', now() + $3::interval + interval '2 hours', $4) RETURNING id`,
    [org.id, title, offset, u.id],
  );
const ev = await newEvent('Cloud 101', '1 day');
const ev2 = await newEvent('Other', '2 days');
await rejects(
  `INSERT INTO events (organization_id, title, starts_at, ends_at, checkin_opens_at, checkin_closes_at, created_by)
   VALUES ($1, 'Bad', now(), now() - interval '1 hour', now(), now() + interval '1 hour', $2)`,
  'event must end after it starts',
  [org.id, u.id],
  'events_time_order',
);

const tt = await one(
  `INSERT INTO ticket_types (event_id, name, capacity, sales_ends_at) VALUES ($1, 'Standart', 1, now() + interval '1 day')
   RETURNING id`,
  [ev.id],
);
await rejects(
  `INSERT INTO ticket_types (event_id, name, capacity, sales_ends_at, allocation_mode)
   VALUES ($1, 'VIP', 10, now() + interval '1 day', 'priority')`,
  'priority mode requires threshold + early window',
  [ev.id],
  'ticket_types_priority_config',
);
await rejects(
  `INSERT INTO ticket_types (event_id, name, capacity, sales_ends_at, priority_points_threshold)
   VALUES ($1, 'VIP', 10, now() + interval '1 day', 5)`,
  'fcfs mode rejects priority fields',
  [ev.id],
  'ticket_types_priority_config',
);
const vip = await one(
  `INSERT INTO ticket_types (event_id, name, capacity, sales_starts_at, sales_ends_at, allocation_mode,
                             priority_points_threshold, priority_sales_starts_at)
   VALUES ($1, 'VIP', 10, now() + interval '2 hours', now() + interval '1 day', 'priority', 5, now()) RETURNING id`,
  [ev.id],
);
ok(!!vip.id, 'valid priority ticket type accepted');

// The conditional increment is the oversell guard.
const claim = `UPDATE ticket_types SET issued_count = issued_count + 1
                WHERE id = $1 AND issued_count < capacity RETURNING issued_count`;
ok((await db.query(claim, [tt.id])).rows.length === 1, 'first claim takes the last seat');
ok((await db.query(claim, [tt.id])).rows.length === 0, 'second claim finds no seat (no oversell)');
await rejects(
  `UPDATE ticket_types SET issued_count = 5 WHERE id = $1`,
  'issued_count can never exceed capacity',
  [tt.id],
  'ticket_types_capacity',
);

// --- tickets & check-ins --------------------------------------------------
const t = await one(`INSERT INTO tickets (ticket_type_id, event_id, user_id) VALUES ($1, $2, $3) RETURNING id`, [
  tt.id,
  ev.id,
  u.id,
]);
await rejects(
  `INSERT INTO tickets (ticket_type_id, event_id, user_id) VALUES ($1, $2, $3)`,
  'one live ticket per user per event',
  [vip.id, ev.id, u.id],
  'tickets_one_live_per_user_event',
);
await rejects(
  `INSERT INTO tickets (ticket_type_id, event_id, user_id) VALUES ($1, $2, $3)`,
  'ticket event must match its ticket type',
  [tt.id, ev2.id, scanner.id],
  'tickets_type_event_fk',
);
await rejects(
  `UPDATE tickets SET status = 'checked_in' WHERE id = $1`,
  'checked_in requires checked_in_at',
  [t.id],
  'tickets_checked_in_consistency',
);

// Only one of two scans can move the ticket out of 'active'.
const checkin = `UPDATE tickets SET status = 'checked_in', checked_in_at = now()
                  WHERE id = $1 AND event_id = $2 AND status = 'active' RETURNING user_id`;
ok((await db.query(checkin, [t.id, ev.id])).rows.length === 1, 'first scan checks the ticket in');
ok((await db.query(checkin, [t.id, ev.id])).rows.length === 0, 'second scan is rejected (status no longer active)');

const ci = await one(
  `INSERT INTO check_ins (ticket_id, event_id, user_id, scanned_by) VALUES ($1, $2, $3, $4) RETURNING id`,
  [t.id, ev.id, u.id, scanner.id],
);
await rejects(
  `INSERT INTO check_ins (ticket_id, event_id, user_id, scanned_by) VALUES ($1, $2, $3, $4)`,
  'UNIQUE(ticket_id) backstop blocks a second check-in row',
  [t.id, ev.id, u.id, scanner.id],
  'check_ins_one_per_ticket',
);

const t2 = await one(`INSERT INTO tickets (ticket_type_id, event_id, user_id) VALUES ($1, $2, $3) RETURNING id`, [
  vip.id,
  ev.id,
  scanner.id,
]);
await rejects(
  `INSERT INTO check_ins (ticket_id, event_id, user_id, scanned_by) VALUES ($1, $2, $3, $4)`,
  'check-in user must match the ticket holder',
  [t2.id, ev.id, u.id, scanner.id],
  'check_ins_ticket_fk',
);
await rejects(
  `INSERT INTO check_ins (ticket_id, event_id, user_id, scanned_by) VALUES ($1, $2, $3, $4)`,
  'check-in event must match the ticket',
  [t2.id, ev2.id, scanner.id, scanner.id],
  'check_ins_ticket_fk',
);

// --- points ledger & balances ---------------------------------------------
const bal = () =>
  one(`SELECT balance, lifetime_earned FROM point_balances WHERE user_id = $1 AND organization_id = $2`, [
    u.id,
    org.id,
  ]);
const earn = await one(
  `INSERT INTO point_ledger (user_id, organization_id, delta, reason, check_in_id)
                        VALUES ($1, $2, 3, 'checkin', $3) RETURNING id`,
  [u.id, org.id, ci.id],
);
let b = await bal();
ok(b.balance === 3 && b.lifetime_earned === 3, `check-in credits balance (3/3), got ${b.balance}/${b.lifetime_earned}`);
await rejects(
  `INSERT INTO point_ledger (user_id, organization_id, delta, reason, check_in_id) VALUES ($1, $2, 3, 'checkin', $3)`,
  'a check-in awards points only once',
  [u.id, org.id, ci.id],
  'point_ledger_one_per_checkin',
);
await rejects(
  `UPDATE point_ledger SET delta = 100 WHERE id = $1`,
  'ledger is append-only (UPDATE)',
  [earn.id],
  'append-only',
);
await rejects(`DELETE FROM point_ledger WHERE id = $1`, 'ledger is append-only (DELETE)', [earn.id], 'append-only');

const spend = await one(
  `INSERT INTO point_ledger (user_id, organization_id, delta, reason)
                         VALUES ($1, $2, -2, 'redemption') RETURNING id`,
  [u.id, org.id],
);
b = await bal();
ok(
  b.balance === 1 && b.lifetime_earned === 3,
  `redemption spends balance but keeps lifetime (1/3), got ${b.balance}/${b.lifetime_earned}`,
);
await rejects(
  `INSERT INTO point_ledger (user_id, organization_id, delta, reason) VALUES ($1, $2, -5, 'redemption')`,
  'cannot redeem more than the balance',
  [u.id, org.id],
  'point_balances_balance_check',
);
await rejects(
  `INSERT INTO point_ledger (user_id, organization_id, delta, reason) VALUES ($1, $2, -1, 'redemption')`,
  'cannot redeem with no balance row at all',
  [scanner.id, org.id],
  'point_balances_balance_check',
);
ok(
  (await one(`SELECT count(*)::int AS n FROM point_balances WHERE user_id = $1`, [scanner.id])).n === 0,
  'failed redemption leaves no stray balance row',
);

await rejects(
  `INSERT INTO point_ledger (user_id, organization_id, delta, reason, reverses_entry_id) VALUES ($1, $2, 5, 'reversal', $3)`,
  'reversal must exactly negate its entry',
  [u.id, org.id, spend.id],
  'must negate',
);
const rev = await one(
  `INSERT INTO point_ledger (user_id, organization_id, delta, reason, reverses_entry_id)
                       VALUES ($1, $2, 2, 'reversal', $3) RETURNING id`,
  [u.id, org.id, spend.id],
);
b = await bal();
ok(
  b.balance === 3 && b.lifetime_earned === 3,
  `refunding a redemption leaves lifetime untouched (3/3), got ${b.balance}/${b.lifetime_earned}`,
);
await rejects(
  `INSERT INTO point_ledger (user_id, organization_id, delta, reason, reverses_entry_id) VALUES ($1, $2, -2, 'reversal', $3)`,
  'a reversal cannot itself be reversed',
  [u.id, org.id, rev.id],
  'cannot reverse a reversal',
);
await rejects(
  `INSERT INTO point_ledger (user_id, organization_id, delta, reason, reverses_entry_id) VALUES ($1, $2, 2, 'reversal', $3)`,
  'an entry can be reversed only once',
  [u.id, org.id, spend.id],
  'point_ledger_one_reversal',
);

// --- badges ---------------------------------------------------------------
await db.query(
  `INSERT INTO badges (code, name, criteria) VALUES ('first_checkin', 'İlk Adım', '{"type":"checkin_count","gte":1}')`,
);
await rejects(
  `INSERT INTO badges (code, name, criteria) VALUES ('first_checkin', 'Dup', '{"type":"checkin_count","gte":1}')`,
  'platform badge codes unique (NULLS NOT DISTINCT)',
  [],
  'badges_code_unique',
);
await rejects(
  `INSERT INTO badges (code, name, criteria) VALUES ('no_type', 'x', '{}')`,
  'badge criteria needs a type',
  [],
  'badges_criteria_shape',
);

// --- reversibility --------------------------------------------------------
await migrateDown();
const left = await one(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
ok(left.n === 0, `down migrations drop every table (left: ${left.n})`);
await migrateUp();
ok(true, 'up migrations re-apply cleanly after down');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
