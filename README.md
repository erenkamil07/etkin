# Etkin

[![CI](https://github.com/erenkamil07/etkin/actions/workflows/ci.yml/badge.svg)](https://github.com/erenkamil07/etkin/actions/workflows/ci.yml)

Event ticketing, dynamic-QR check-in and loyalty for university communities.

- **Organizers** create events and ticket types, scan tickets at the door and see attendance analytics.
- **Students** claim tickets, show a rotating QR code at the door, and earn club points and badges for showing up.
- **Loyal members** get priority access or better lottery odds for limited events.

> Status: the backend is feature-complete for weeks 1 and 2 and load-tested. The Expo app has
> sign-in, the event feed, event pages with ticket claims, the live QR ticket, a profile with
> club points and badge progress, and the club team's door scanner and live attendee list.
> See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and the 4-week roadmap.

## Highlights

- **Screenshot-proof tickets.** QR codes are HMAC-signed and rotate every 15 s. They are
  generated offline on the phone from a device-bound key that is never stored in the database.
- **No double check-ins.** Two gates scanning the same ticket at the same moment cannot both
  succeed. A conditional row update decides the winner, and a unique constraint backs it up.
- **Tamper-proof points.** Points live in an append-only ledger. Balances are maintained by a trigger in the same transaction.
- **Load-tested** ([report](docs/load-test.md)). A door rush of 5,000+ people at 60 scans/s, about 30
  times a real event's peak, ran at p95 22 to 35 ms with zero errors. A ticket drop of 1,000
  students for 300 seats sold exactly 300, and every student had an answer at p95 under 1.4 s.
- **Proven under real concurrency.** Integration tests race real PostgreSQL connections, and
  mutation tests show that each guard is what stops its race. Without the claim lock, 29 of 30
  tickets survived an event cancellation. Without the outbox row lock, four workers handled 40
  events 150 times.

## Repository layout

```
db/migrations/   SQL migrations (dbmate, up + down)
db/tests/        schema invariant tests (PGlite, no Docker needed)
docs/            architecture, decisions, load test report
loadtest/        k6 scenarios and their runner
apps/api/        Fastify API (TypeScript, Kysely, zod, OpenAPI)
apps/mobile/     Expo app (Expo Router, React Query, typed client generated from the API's OpenAPI)
packages/shared/ dynamic QR tokens, shared by the API and the mobile app
infra/           Terraform for AWS        (later; the API runs on Railway now)
```

## Getting started

Prerequisites: Node.js 22+, Docker Desktop.

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm infra:up       # PostgreSQL 18 + Redis
pnpm db:migrate     # apply migrations
pnpm dev            # API with hot reload on http://localhost:3000
pnpm dev:worker     # outbox worker (badges), in a second terminal
```

API docs (Swagger UI) are served at <http://localhost:3000/docs>.

| Command | What it does |
|---|---|
| `pnpm test` | Schema invariant tests + API tests (no Docker needed) |
| `pnpm test:integration` | Concurrency tests on the compose PostgreSQL (uses a separate `etkin_test` database) |
| `pnpm loadtest` | k6 door-rush and ticket-drop scenarios against the production image ([report](docs/load-test.md)) |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm lint` / `pnpm lint:fix` | Biome lint + format check / apply fixes |
| `pnpm db:codegen` | Regenerate Kysely types from the live schema after a migration |
| `pnpm app:up` | Build and run the production API image in Docker (stop `pnpm dev` first, both use port 3000) |
| `pnpm infra:down` | Stop every container |

### Continuous integration

Every push and pull request runs three jobs ([ci.yml](.github/workflows/ci.yml)):

1. **Lint, typecheck, test** on Node 22 and 24. The tests need no services, because PostgreSQL runs
   in-process via PGlite.
2. **Migrations and concurrency on PostgreSQL 18:** up → rollback → up, a check that the
   generated Kysely types (`schema.ts`) still match the migrated schema, and the integration tests.
   Those race real concurrent requests: 50 students for 10 seats, a double-tapped "claim", claims
   arriving while the event is being cancelled, and one ticket scanned 50 times at once across
   5 gates (exactly one admission, one point).
3. **Docker smoke test:** builds the production image, checks that it runs as a non-root user,
   starts it against PostgreSQL and Redis, waits for `/health/ready` and registers a user through it.

Actions are pinned to commit SHAs, and Dependabot proposes updates weekly.

### Mobile app

```bash
pnpm dev                              # the API, in one terminal
pnpm --filter @etkin/mobile start     # Metro, in another; scan its QR code with Expo Go
```

The phone must be on the same Wi-Fi as the laptop. In development the app calls the API on the
laptop that serves the bundle (`http://<laptop-ip>:3000`); set `EXPO_PUBLIC_API_URL` to point it
elsewhere. Pressing `w` in Metro opens the web build, which is handy for quick UI checks; there,
tokens live in localStorage instead of the keystore.

- **Typed API client.** `pnpm api:types` exports the API's OpenAPI document and generates
  `apps/mobile/src/api/schema.ts`. CI fails if either file is stale, so an API change that breaks
  the app breaks the build.
- **Sessions.** Tokens live in the Android Keystore through `expo-secure-store`. The access token is
  refreshed a minute before it expires, one refresh at a time, because the API revokes a session
  whose refresh token is used twice.
- **Live QR ticket.** The phone fetches its ticket key once, keeps it in the keystore and draws a new
  code every 15 s with the same `@etkin/shared` code the API verifies with. The code still renders
  with no signal at the door, and the server's clock offset corrects a phone set to the wrong
  time. While the code is on screen, screenshots and recordings are blocked and the screen goes to
  full brightness. A running clock under the code shows the door team it is live, and the screen
  turns to "Giriş yapıldı" by itself after the scan.
- **Door scanner.** Club team members reach their club's events from the profile. The scanner reads
  codes with `expo-camera` and answers with a full-width green, amber or red verdict and a haptic.
  Each physical scan sends a fresh `Idempotency-Key`, reused on a network retry, so a dropped
  response never turns into "already used". A ticket counts as one scan until it leaves the frame,
  even though its code rotates. Organizers also get live numbers, a searchable attendee list and
  manual admission for a holder whose phone died; door scanners see only the camera.
- **Event creation.** Organizers create an event with its ticket types from the club page, as a
  draft or published straight away, with an optional early-access window for members with enough
  club points. Dates are typed as digits and formatted as you go, so the number pad works on every
  phone. If a step fails, trying again resumes where it stopped instead of leaving a second draft.

### Android builds (EAS)

The app id is `com.erengoksel.etkin`. [eas.json](apps/mobile/eas.json) has two profiles:
`preview` makes an APK to install directly on a phone, and `production` makes the Play Store
bundle (AAB). EAS keeps the version code and raises it on every production build. Neither profile
can run against a laptop: [app.config.ts](apps/mobile/app.config.ts) stops the build unless
`EXPO_PUBLIC_API_URL` is an https address, because Android release builds refuse plain http.

The release manifest asks only for camera, vibration and internet. The storage, photo,
draw-over-apps and system-settings permissions that the template and some libraries add are
blocked in `app.json`, so the Play listing doesn't have to justify them.

The Play listing links to two pages the API serves: the privacy policy at
[/privacy](https://etkin-production.up.railway.app/privacy) and the account deletion steps at
[/account-deletion](https://etkin-production.up.railway.app/account-deletion). The app links to
the policy from sign-up and the profile.

```bash
cd apps/mobile
npx eas-cli@latest login                 # your Expo account
npx eas-cli@latest init                  # links the project; adds its id to app.json
npx eas-cli@latest env:set --environment production --environment preview --name EXPO_PUBLIC_API_URL --value https://etkin-production.up.railway.app --visibility plaintext
npx eas-cli@latest build -p android --profile production
```

### Demo data

`pnpm demo:seed` sets up a club, its team, a student and three events. One of them, **Canlı Demo:
Kapı Testi**, has its door open right now; run the command again at any time to move it back to
the present. The accounts are for local development only:

| Role | Email | Password |
|---|---|---|
| Club owner | `demo.organizer@etkin.dev` | `demo-organizer-2026` |
| Door scanner | `kapi.demo@etkin.dev` | `demo-kapi-2026` |
| Student | `ayse.demo@uni.edu.tr` | `correct horse battery` |
| Second student | `mert.demo@uni.edu.tr` | `mert demo 2026` |

To try the door, open the live event's ticket as the student on one screen. On a phone signed in
as the owner or the scanner, go to Profil → the club → the event → Kapıda QR okut. Run
`pnpm dev:worker` as well, so the student's badge arrives after the scan.

### API conventions

- **Errors** are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` with a stable `code`
  (e.g. `VALIDATION_FAILED`, `ALREADY_CHECKED_IN`) and a `traceId` that matches the `x-request-id` header and the logs.
- **Health:** `GET /health/live` (process up) and `GET /health/ready` (PostgreSQL and Redis reachable, 503 otherwise).
- **Auth:** `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` and `GET /me`. Send
  `Authorization: Bearer <accessToken>`. On `401 TOKEN_EXPIRED`, call `/auth/refresh` once and retry.
  Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#3-authentication).
- **Clubs and events.** Anyone signed in can create a club and becomes its owner. The owner adds
  organizers and door scanners by email. Organizers create draft events, add ticket types and
  publish. `GET /events` is the public feed (cursor-paginated). Drafts are visible only to the
  club's team.
- **Tickets.** `POST /events/:eventId/tickets` claims a seat. Repeating the call returns the ticket
  you already hold, so retries and double taps are safe. Eligibility follows the ticket type:
  sales window, minimum club points, and an early window for loyal members. `GET /me/tickets` lists
  your tickets, and `POST /tickets/:id/cancel` gives the seat back until the event starts. Cancelling
  an event cancels its tickets.
- **Dynamic QR.** `POST /tickets/:id/qr-key {deviceId}` binds the ticket to the phone and returns
  the key the app uses to render a new code every 15 s, offline. Asking from another phone moves
  the ticket and kills the old phone's codes. The format is documented and tested in
  [packages/shared](packages/shared/src/qr.ts).
- **Check-in.** Club staff scan with `POST /orgs/:orgId/events/:eventId/check-ins {qr, gate}`, and
  organizers can admit by ticket id when a phone is dead (`.../check-ins/manual`). Every scan
  returns `200` with a verdict (`accepted`, `duplicate`, `expired_token`, ...), the attendee's name
  and photo, and the head count. Admission awards the event's club points through the ledger, and
  every scan is logged. Send an `Idempotency-Key` per physical scan, so retries don't read as
  duplicates.
- **Account deletion.** `DELETE /me` (password required) anonymises the account: name, email,
  student number, university and password are wiped and the email is free again, every session
  ends, team memberships go and seats for events that have not started are given back. Past
  attendance and points stay in the clubs' numbers, tied to nobody. In the app: Profil → Hesabımı sil.
- **Points and badges.** `GET /me/points` shows your balance per club and the latest changes,
  with the event behind each one. `GET /me/badges` lists badges such as İlk Adım, Müdavim and
  Kaşif, which the worker awards within about a second of a check-in. `GET /me/badges/progress`
  shows the ones still to earn, nearest first ("2 / 5 etkinlik"), using the same rule code the
  worker awards with.
- **Organizer analytics.** `GET /orgs/:orgId/events/:eventId/stats` reports issued, checked in,
  cancelled and no-show counts, the attendance rate, per-ticket-type numbers, the arrival curve in
  10-minute buckets, per-gate counts and scan outcomes. `.../attendees?q=` searches holders by
  name or student number.
- **Business rules live in the database** (CHECK and UNIQUE constraints). Violations come back as
  specific codes such as `CAPACITY_BELOW_ISSUED`, `INVALID_SALES_WINDOW` and `SLUG_TAKEN`.
