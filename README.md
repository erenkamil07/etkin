# Etkin

Event ticketing, dynamic-QR check-in and loyalty for university communities.

- **Organizers** create events and ticket types, scan tickets at the door and see attendance analytics.
- **Students** claim tickets, show a rotating QR code at the door, and earn club points and badges for showing up.
- **Loyal members** get priority access or better lottery odds for limited events.

> Status: week 1. The schema and local infrastructure are in place; the API comes next.
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
apps/api/        Fastify API              (week 1)
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
pnpm test:db        # schema invariant tests (no Docker required)
```
