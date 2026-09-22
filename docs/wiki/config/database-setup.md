# Database Setup

**Last Updated**: 2026-09-07

## Overview

Jump uses PostgreSQL with Prisma ORM. The schema lives in the shared `@jump/db` package at `packages/db/prisma/schema.prisma`. Both backend and frontend import the Prisma client from this package.

## Local Development

### 1. Create Database

```bash
psql -U postgres
CREATE DATABASE jump;
CREATE USER jump WITH PASSWORD 'jump';
GRANT ALL PRIVILEGES ON DATABASE jump TO jump;
\q
```

### 2. Configure Connection

Set `DATABASE_URL` in three places:
- `packages/db/.env`
- `backend/.env`
- `frontend/.env.local`

```
DATABASE_URL="postgresql://jump:jump@localhost:5432/jump?schema=public"
```

### 3. Run Migrations

```bash
npm run db:migrate    # Apply all pending migrations
npm run db:generate   # Regenerate Prisma client (usually automatic)
```

### 4. Seed Data

```bash
npm run db:seed       # Creates sample orgs, venues, events, tiers, users
```

### 5. Browse Data

```bash
npm run db:studio     # Opens Prisma Studio at http://localhost:5555
```

## Commands Reference

| Command | What it does |
|---------|-------------|
| `npm run db:generate` | Generate Prisma client from schema |
| `npm run db:migrate` | Run pending migrations (dev mode) |
| `npm run db:seed` | Seed sample data |
| `npm run db:reset` | Drop everything, re-migrate, re-seed |
| `npm run db:studio` | Open Prisma Studio GUI |

All commands run from the repository root.

## Schema Modifications

1. Edit `packages/db/prisma/schema.prisma`
2. Run `npm run db:migrate` — creates migration file in `packages/db/prisma/migrations/`
3. Prisma client regenerates automatically
4. Update seed file if new models/fields need sample data

## Production (Railway)

- PostgreSQL provisioned as Railway service
- Connection string set via `DATABASE_URL` env var on all services
- Migrations applied automatically on container start (see `railpack.backend.json`):
  `npx prisma migrate deploy` — when it fails the container logs the recovery steps below and exits instead of crash-looping silently
- Or via SSH tunnel:
  ```bash
  railway run npx prisma migrate deploy
  ```

### Failed migration recovery

If the backend enters a crash-loop with a P3009 error ("migration failed to apply"), the previous migration is broken and must be resolved manually before the backend can start.

**Recovery procedure** (run each command from `packages/db`):

1. **Connect to a running container that ships `packages/db`** — the backend is crash-looping, so use the frontend (this is what fixed the 2026-09-12 incident):
   ```bash
   railway ssh --service frontend
   ```

2. **Identify the failed migration** from the error log — it appears as `20260910025837_add_tier_presets` or similar.

3. **Roll back the failed migration** in the `_prisma_migrations` table:
   ```bash
   npx prisma migrate resolve --rolled-back "<migration-name>"
   ```
   This marks the migration as rolled back in the migration history, clearing the P3009 lock.

4. **Apply the rest of the migration by hand** — the migration SQL minus the statement that failed (in the 2026-09-12 incident, minus a `DROP INDEX` for an index production never had):
   ```bash
   npx prisma db execute --stdin <<SQL
   -- paste the surviving statements of prisma/migrations/<migration-name>/migration.sql
   SQL
   ```

5. **Mark the corrected migration as applied**:
   ```bash
   npx prisma migrate resolve --applied "<migration-name>"
   ```

6. **Verify and redeploy**:
   ```bash
   npx prisma migrate status   # "Database schema is up to date"
   railway redeploy --service backend
   ```

Never edit an applied migration afterwards — the `migration safety` CI job fails any PR that modifies or deletes an existing file under `packages/db/prisma/migrations/`, and the replay check fails when the migration history no longer produces `schema.prisma`. Fix forward with a new migration.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | Single source of truth for data model |
| `packages/db/src/index.ts` | Singleton PrismaClient export |
| `packages/db/prisma/migrations/` | Migration history (9 migrations, Feb-Sep 2026) |
| `packages/db/prisma/seed.js` | Sample data for development |
