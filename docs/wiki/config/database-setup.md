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
  `npx prisma migrate status && npx prisma migrate deploy`
- Or via SSH tunnel:
  ```bash
  railway run npx prisma migrate deploy
  ```

### Failed migration recovery

If the backend enters a crash-loop with a P3009 error ("migration failed to apply"), the previous migration is broken and must be resolved manually before the backend can start.

**Recovery procedure** (run each command from `packages/db`):

1. **Connect to the Railway environment**:
   ```bash
   railway ssh --service backend
   ```

2. **Identify the failed migration** from the error log — it appears as `20260910025837_add_tier_presets` or similar.

3. **Roll back the failed migration** in the `_prisma_migrations` table:
   ```bash
   npx prisma migrate resolve --rolled-back "<migration-name>"
   ```
   This marks the migration as rolled back in the migration history, clearing the P3009 lock.

4. **Apply a corrective SQL fix** (create a fix script locally and upload it):
   ```bash
   npx prisma db execute --file /tmp/fix.sql
   ```
   Or pipe the SQL directly:
   ```bash
   npx prisma db execute --stdin <<SQL
   ALTER TABLE "PriceTier" ADD COLUMN "presetId" TEXT;
   SQL
   ```

5. **Mark the corrected migration as applied**:
   ```bash
   npx prisma migrate resolve --applied "<migration-name>"
   ```

6. **Verify** — restart the backend service:
   ```bash
   npx prisma migrate status
   ```
   This should show "Database schema is up to date." If so, the backend starts normally on next deploy.

After recovery, create a **new clean migration** locally (`npm run db:migrate`) that drops the broken one and applies the intended schema in one atomic step, so the same failure cannot recur on a fresh deploy.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | Single source of truth for data model |
| `packages/db/src/index.ts` | Singleton PrismaClient export |
| `packages/db/prisma/migrations/` | Migration history (9 migrations, Feb-Sep 2026) |
| `packages/db/prisma/seed.js` | Sample data for development |
