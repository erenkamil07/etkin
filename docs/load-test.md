# Load test

Run on 2026-11-03 with `pnpm loadtest` against the production Docker image. The runner is
[loadtest/run.mjs](../loadtest/run.mjs) and the scenarios are [gate.js](../loadtest/gate.js) and
[drop.js](../loadtest/drop.js).

**Environment.** A Windows 11 laptop running Docker Desktop (WSL 2), with 12 vCPUs and 11.6 GiB
available to containers:

- one API container: a single Node.js process with 10 database connections;
- one worker container;
- PostgreSQL 18 and Redis 8 from docker-compose;
- k6 2.3.0 in a container on the same Docker network.

All of these share one machine, so the absolute numbers are indicative; the comparisons between
runs are what matter.

The QR codes are generated in k6 with its own crypto module. Before each run, `setup()` checks that
implementation against the reference vector in `packages/shared`, and the run aborts if they differ.

## Door rush

5,200 ticket holders and 4 gates. The arrival rate ramps to **60 people per second** and holds there
for 60 s. A 500-person event peaks at 1 to 2 people per second, so this is roughly 30 times the
realistic peak. 3% of attendees first show an expired screenshot, and 10% are scanned again at a
second gate.

| | Run 1 | Run 2 | Run 3 (final) |
|---|---|---|---|
| Scans | 5,723 | 5,667 | 5,697 |
| p50 | 9.0 ms | 12.3 ms | 13.0 ms |
| **p95** (target < 250 ms) | **21.6 ms** | **34.9 ms** | **32.1 ms** |
| p99 (target < 500 ms) | 28.6 ms | 394 ms | 92.7 ms |
| Max | 244 ms | 1.84 s | 270 ms |
| Failed requests, dropped iterations | 0, 0 | 0, 0 | 0, 0 |

Every verdict matched its expectation (`accepted`, `duplicate`, `expired_token`). After each run
the database held 5,024 check-ins, 5,024 tickets marked checked in and 5,024 ledger entries. The
worker had drained the outbox to zero pending events and awarded 5,024 İlk Adım badges while
the test ran.

Run 2 had a tail that runs 1 and 3 did not: p99 394 ms and one request at 1.8 s. With the API,
worker, database and load generator sharing one laptop, occasional spikes like that are expected.
p95 stayed between 22 and 35 ms in every run.

**Decision: no Redis cache on the check-in path.** At 30 times the realistic peak, p95 is about a
tenth of the 250 ms budget. A ticket cache would save a few milliseconds per scan. It would also
add an invalidation hazard: when a ticket moves to another phone, its key version changes, and a
stale cache would turn away a valid code. Revisit this if p95 at the expected peak passes 100 ms in
production.

## Ticket drop

1,000 students (250 concurrent clients, 4 claims each) claim **300 workshop seats** the moment
sales open. Every claim updates the same `ticket_types` row.

Every run was correct: exactly 300 tickets issued, the other 700 students told `SOLD_OUT`, no
errors, no oversold seats.

| Variant | p50 | p95 | Claims/s |
|---|---|---|---|
| Initial implementation | 386 ms | 1.05 s | 421 |
| Response built after commit, plus a sold-out shortcut (run A) | 387 ms | 1.08 s | 420 |
| Same code (run B) | 436 ms | 1.38 s | 369 |
| Same code (final run) | 343 ms | **0.96 s** | 464 |
| Same code with a 30-connection pool | 403 ms | 1.55 s | 343 |
| Ticket inserted before the seat is taken | 574 ms | 2.51 s | 233 |

What the numbers show:

- **Latency follows Little's law.** 250 concurrent clients divided by about 420 claims/s gives
  roughly 0.6 s of average wait, which matches the measurements. Throughput is the limit, and the
  limit comes from claims serializing on the one row they all update.
- **More database connections made it worse** (p95 1.55 s). Extra connections only add
  transactions waiting on the same row lock, and those transactions hold their connections while
  they wait.
- **Inserting the ticket first made it much worse** (2.51 s). Before the seats run out, the
  losing claims insert a ticket, wait for the lock, lose, and roll back. That change was reverted.
- Building the response after commit and skipping the queue once the type is visibly sold out are
  both kept: they make each claim cheaper and have no downside. Their effect was within run-to-run
  noise (0.96 to 1.38 s), so no speed-up is claimed for them.

**Decision.** The target for a drop is that every student hears back within two seconds
(p95 < 2000 ms). Measured p95 was 0.96 to 1.38 s. The first target, 1 s, was missed in three of
four runs and was not product-critical. If drops grow well past 1,000 simultaneous students, the
next step is an atomic seat counter in Redis (`DECR`) in front of PostgreSQL. Losing claims would
then be refused without touching the database, while its conditional `UPDATE` stays the guard.
That would be the first request path where Redis earns its place.

## Reproduce

```bash
pnpm infra:up
docker compose --profile app build
pnpm loadtest                 # both scenarios; or: node loadtest/run.mjs gate | drop
```

The runner seeds a separate `etkin_load` database (it refuses any database not named `*_load`).
It starts the API and worker from the built image against that database, runs k6, prints what the
database recorded, and removes the containers. `LOAD_POOL_MAX=30 pnpm loadtest` repeats the pool
experiment. Raw k6 output goes to `loadtest/results/`, which is not committed.
