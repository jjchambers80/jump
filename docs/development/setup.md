# Quick Start: Jump Ticketing Platform

**Feature**: 003-schema-redesign  
**Date**: 2026-02-09  
**Tech Stack**: Node.js 20, Express.js 4, Next.js 14, PostgreSQL 15, Redis 7, Prisma 6, Auth.js v5  
**Architecture**: npm workspaces monorepo with shared `@jump/db` package

## Prerequisites

- **Node.js**: 20.x LTS ([download](https://nodejs.org/))
- **PostgreSQL**: 15+ ([download](https://www.postgresql.org/download/))
- **Redis**: 7.x ([download](https://redis.io/download/))
- **Git**: For version control
- **Stripe Account**: Test API keys ([sign up](https://stripe.com/))
- **Resend Account**: Email API key ([sign up](https://resend.com/))

**Verify Installations**:

```bash
node --version   # Should show v20.x.x
npm --version    # Should show 10.x.x
psql --version   # Should show 15.x or higher
redis-server --version  # Should show 7.x.x
```

---

## Monorepo Structure

```
jump/
  package.json          # Root — npm workspaces config
  packages/
    db/                 # @jump/db — shared Prisma client + schema
      prisma/
        schema.prisma   # Single source of truth for data model
      src/
        index.ts        # Singleton PrismaClient, re-exports types
      generated/        # Prisma-generated client (gitignored)
  backend/              # Express.js API server
    package.json        # Depends on @jump/db via workspace
  frontend/             # Next.js application
    package.json        # Depends on @jump/db via workspace
```

The root `package.json` declares npm workspaces:

```json
{
  "private": true,
  "workspaces": ["backend", "frontend", "packages/*"],
  "scripts": {
    "db:generate": "npm run generate --workspace=packages/db",
    "db:migrate": "npm run migrate:dev --workspace=packages/db",
    "db:seed": "npm run seed --workspace=packages/db",
    "db:reset": "npm run migrate:reset --workspace=packages/db",
    "dev:backend": "npm run dev --workspace=backend",
    "dev:frontend": "npm run dev --workspace=frontend"
  }
}
```

### The `@jump/db` Package

Both `backend` and `frontend` import from the shared `@jump/db` workspace package:

```javascript
// In any backend service or frontend server component
import { prisma } from "@jump/db";
```

This ensures a single Prisma client instance (singleton pattern) and shared type definitions across the monorepo.

---

## Project Setup

### 1. Clone and Install Dependencies

```bash
# Clone repository
git clone <repository-url> jump
cd jump

# Install ALL workspace dependencies from the root
npm install
```

`npm install` at the root links all workspaces (`backend`, `frontend`, `packages/db`) and installs their dependencies. The `packages/db` postinstall script automatically runs `prisma generate`.

### 2. Generate Prisma Client

If the Prisma client was not generated during install, run manually:

```bash
npm run db:generate
```

This generates the typed Prisma client into `packages/db/generated/client/`.

### 3. Environment Configuration

**Shared Database** (`packages/db/.env`):

```env
DATABASE_URL="postgresql://jump:jump@localhost:5432/jump?schema=public"
```

**Backend** (`backend/.env`):

```env
# Database (same as packages/db)
DATABASE_URL="postgresql://jump:jump@localhost:5432/jump?schema=public"

# Auth (must match frontend AUTH_SECRET)
AUTH_SECRET="your-32-char-random-secret-here"

# Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Email
RESEND_API_KEY="re_..."

# Server
PORT=3000
NODE_ENV=development
```

**Frontend** (`frontend/.env.local`):

```env
# API
NEXT_PUBLIC_API_URL="http://localhost:3000"

# Auth.js
AUTH_SECRET="your-32-char-random-secret-here"
AUTH_RESEND_KEY="re_..."
AUTH_GOOGLE_ID="your-google-client-id"
AUTH_GOOGLE_SECRET="your-google-client-secret"

# Database (same as packages/db — needed for Auth.js PrismaAdapter)
DATABASE_URL="postgresql://jump:jump@localhost:5432/jump?schema=public"
```

> **Important**: `AUTH_SECRET` must be identical in both `backend/.env` and `frontend/.env.local` for JWT verification to work across services.

### 4. Database Setup

**Create Database**:

```bash
psql -U postgres
CREATE DATABASE jump;
CREATE USER jump WITH PASSWORD 'jump';
GRANT ALL PRIVILEGES ON DATABASE jump TO jump;
\q
```

**Run Prisma Migrations**:

```bash
npm run db:migrate
```

This runs migrations from `packages/db/prisma/migrations/`.

**Seed Test Data**:

```bash
npm run db:seed
```

Creates sample organizations, venues, events with price tiers, and test users.

**Verify Database**:

```bash
cd packages/db && npx prisma studio
```

Opens GUI at `http://localhost:5555` to browse tables.

### 5. Redis Setup

```bash
# macOS (Homebrew)
brew services start redis

# Verify
redis-cli ping
# Should return: PONG
```

### 6. Stripe Webhook Setup (Local Development)

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local backend
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Copy the webhook signing secret (`whsec_...`) from the CLI output to `backend/.env` as `STRIPE_WEBHOOK_SECRET`.

---

## Running the Application

### Development Mode

**Terminal 1 — Backend**:

```bash
npm run dev:backend
```

Server starts at `http://localhost:3000`

**Terminal 2 — Frontend**:

```bash
npm run dev:frontend
```

App starts at `http://localhost:3001`

**Terminal 3 — Stripe Webhook Forwarding** (keep running):

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

### Verify Setup

1. **Backend Health**: `curl http://localhost:3000/health` -> `{"status": "ok"}`
2. **Frontend**: Visit `http://localhost:3001` -> Should see event listing
3. **Events API**: `curl http://localhost:3000/events` -> JSON list of published events

---

## Key Commands Reference

| Command               | Description                                         |
| --------------------- | --------------------------------------------------- |
| `npm install`         | Install all workspace dependencies (run from root)  |
| `npm run db:generate` | Generate Prisma client from schema                  |
| `npm run db:migrate`  | Run pending database migrations                     |
| `npm run db:seed`     | Seed database with sample data                      |
| `npm run db:reset`    | Drop DB, re-run migrations, re-seed                 |
| `npm run dev:backend` | Start backend dev server (port 3000)                |
| `npm run dev:frontend`| Start frontend dev server (port 3001)               |

---

## Testing

### Unit Tests

```bash
# Backend
cd backend && npm test

# Frontend
cd frontend && npm test
```

### Contract Tests (API Endpoints)

```bash
cd backend
npm run test:contract
```

### E2E Tests

```bash
cd frontend
npx playwright test
```

---

## Environment Variables Summary

| Variable                | Location          | Required | Description                        |
| ----------------------- | ----------------- | -------- | ---------------------------------- |
| `DATABASE_URL`          | packages/db, backend, frontend | Yes | PostgreSQL connection string |
| `AUTH_SECRET`           | backend, frontend | Yes      | Shared JWT signing secret          |
| `STRIPE_SECRET_KEY`     | backend           | Yes      | Stripe API secret key              |
| `STRIPE_WEBHOOK_SECRET` | backend           | Yes      | Stripe webhook signing secret      |
| `RESEND_API_KEY`        | backend           | Yes      | Resend email API key               |
| `NEXT_PUBLIC_API_URL`   | frontend          | Yes      | Backend API base URL               |
| `AUTH_RESEND_KEY`       | frontend          | No       | Resend key for Auth.js magic links |
| `AUTH_GOOGLE_ID`        | frontend          | No       | Google OAuth client ID             |
| `AUTH_GOOGLE_SECRET`    | frontend          | No       | Google OAuth client secret         |
| `PORT`                  | backend           | No       | Backend port (default: 3000)       |
| `NODE_ENV`              | backend           | No       | Environment (development/production)|

---

## Troubleshooting

### Cannot find module '@jump/db'

Run `npm install` from the repository root to link workspaces:

```bash
cd /path/to/jump && npm install
```

### Cannot find module '../generated/client'

The Prisma client has not been generated. Run:

```bash
npm run db:generate
```

### Database Connection Errors

```bash
# Check PostgreSQL is running
pg_isready

# macOS: brew services start postgresql@15
# Linux: sudo systemctl start postgresql
```

### Prisma Migration Errors

```bash
# Reset database (drops all data)
npm run db:reset
```

### Port Already in Use

```bash
# Find and kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Auth.js JWT Errors

Ensure `AUTH_SECRET` is identical in both `backend/.env` and `frontend/.env.local`.

---

## Architecture Overview

```
+-----------------+         +------------------+
|   Frontend      |         |     Backend      |
|   (Next.js)     |<--------|   (Express.js)   |
|   Port 3001     |  HTTP   |   Port 3000      |
+-----------------+         +------------------+
        |                            |
        |   +----------+    +-------+--------+--------+
        +-->| @jump/db |<---+       |        |        |
            | (Prisma) |    |       |        |        |
            +----+-----+ +--+---+ +-+----+ +-+------+
                 |        |Redis | |Stripe| |Resend  |
            +----+-----+  +-----+ +------+ +--------+
            |PostgreSQL|
            +----------+
```

**Key architectural change from Phase 1**: The `@jump/db` package is the single source of truth for the database schema. Both backend and frontend import the Prisma client from this shared package, eliminating schema drift between services.

---

## Resources

- **Prisma Docs**: https://www.prisma.io/docs
- **Auth.js Docs**: https://authjs.dev
- **Stripe Test Cards**: https://stripe.com/docs/testing
- **Next.js Docs**: https://nextjs.org/docs
- **Express.js Docs**: https://expressjs.com/
- **Resend Docs**: https://resend.com/docs
