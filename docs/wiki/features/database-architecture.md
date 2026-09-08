# Database Architecture

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Shared `@jump/db` package (`packages/db/`) providing a singleton PrismaClient. The schema defines 13 models and 7 enums. Both the backend and frontend import from `@jump/db` for database access. Migrations are tracked in `packages/db/prisma/migrations/` with 9 migrations covering feature evolution from February to September 2026.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/src/index.ts` | Singleton PrismaClient export |
| `packages/db/prisma/schema.prisma` | Schema definition (13 models, 7 enums) |
| `packages/db/prisma/migrations/` | 9 migration files tracking schema evolution |

## How It Works

1. `packages/db` is a workspace package that both `backend` and `frontend` depend on.
2. `index.ts` exports a singleton PrismaClient instance, preventing multiple connections.
3. All services import `{ prisma }` from `@jump/db` rather than instantiating their own client.
4. Schema changes are made in `schema.prisma` and applied via Prisma migrations.
5. `prisma generate` runs automatically on `postinstall` to keep the generated client in sync.

## Gotchas

- Always import from `@jump/db` — never instantiate PrismaClient directly in backend or frontend code.
- Run `npm install` from the monorepo root to correctly link workspace packages.
- `prisma generate` runs on `postinstall`; if the generated client is stale, re-run `npm install`.
- Migrations must be applied in order; never manually edit migration files.

## Related Features

- [Railway Deployment](railway-deployment.md) — database migrations must be run via SSH tunnel in production.
- [Auth.js Integration](authjs-integration.md) — PrismaAdapter uses the shared client for user/account persistence.
