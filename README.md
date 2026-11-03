# Etkin

Event ticketing, dynamic-QR check-in and loyalty for university communities.

- **Organizers** create events and ticket types, scan tickets at the door and see attendance analytics.
- **Students** claim tickets, show a rotating QR code at the door, and earn club points and badges for showing up.
- **Loyal members** get priority access or better lottery odds for limited events.

> Status: week 1. Schema, local infrastructure and the API skeleton are in place; auth comes next.
> See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and the 4-week roadmap.

## Highlights

- **Screenshot-proof tickets.** QR codes are HMAC-signed and rotate every 15 s. They are
  generated offline on the phone from a device-bound key that is never stored in the database.
- **No double check-ins.** Two gates scanning the same ticket at the same moment cannot both
  succeed. A conditional row update decides the winner, and a unique constraint backs it up.
- **Tamper-proof points.** Points live in an append-only ledger. Balances are maintained by a trigger in the same transaction.

## Repository layout

```
db/migrations/   SQL migrations (dbmate, up + down)
db/tests/        schema invariant tests (PGlite, no Docker needed)
docs/            architecture and decisions
apps/api/        Fastify API (TypeScript, Kysely, zod, OpenAPI)
apps/mobile/     Expo app                 (week 3)
packages/shared/ zod schemas, QR library  (week 2)
infra/           Terraform                (week 4)
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
```

API docs (Swagger UI) are served at <http://localhost:3000/docs>.

| Command | What it does |
|---|---|
| `pnpm test` | Schema invariant tests + API tests |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm db:codegen` | Regenerate Kysely types from the live schema after a migration |
| `pnpm app:up` | Build and run the production API image in Docker (stop `pnpm dev` first, both use port 3000) |
| `pnpm infra:down` | Stop every container |

### API conventions

- **Errors** are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` with a stable `code`
  (e.g. `VALIDATION_FAILED`, `ALREADY_CHECKED_IN`) and a `traceId` that matches the `x-request-id` header and the logs.
- **Health:** `GET /health/live` (process up) and `GET /health/ready` (PostgreSQL and Redis reachable, 503 otherwise).
