# Research: Schema Redesign — MVP Data Architecture

**Feature**: 003-schema-redesign  
**Date**: 2026-02-08

## R1 — Auth.js v5 Prisma Adapter Schema Requirements

**Decision**: Use Auth.js v5 with Prisma Adapter, JWT session strategy, custom HS256 encode/decode for Express compatibility.

**Rationale**: Auth.js is the constitution-mandated authentication provider (Principle V). JWT strategy avoids database sessions and enables stateless Express verification. Custom HS256 encoding replaces the default JWE encryption so the Express backend can verify tokens with a shared `AUTH_SECRET` using standard `jsonwebtoken`.

**Alternatives considered**:

- Default JWE tokens: Rejected — Express cannot decrypt Auth.js v5 encrypted JWTs without the `@auth/core` internals
- `@auth/express` package: Rejected — adds Auth.js to Express, complicating the architecture (Auth.js belongs in Next.js per constitution)
- Database session strategy: Rejected — requires Prisma in edge middleware (incompatible with Next.js edge runtime)

**Key findings**:

- Prisma Adapter requires: User, Account, Session, VerificationToken models with specific fields
- Custom fields on User (role, organizationId, firstName, lastName, isActive, deletedAt) are **ignored by the adapter** — safe to add
- VerificationToken is **required** for Resend magic links even with JWT session strategy
- Session model is **not required** with JWT strategy but is harmless to keep
- **Split-config pattern** is mandatory: `auth.config.ts` (edge-safe, no Prisma) + `auth.ts` (full config with Prisma Adapter)
- Role propagation: `jwt` callback reads role from DB on sign-in, `session` callback exposes `session.user.role`
- Express verification: Override `jwt.encode`/`jwt.decode` in auth.ts to use HS256, then Express uses `jsonwebtoken.verify(token, AUTH_SECRET, { algorithms: ['HS256'] })`
- JWT token structure: `{ sub: userId, email, role, name, iat, exp }`

---

## R2 — Monorepo Shared packages/db Setup

**Decision**: Create `packages/db` as an npm workspace package (`@jump/db`) housing the Prisma schema, client generation, and singleton export.

**Rationale**: Both the Next.js frontend (Auth.js Prisma Adapter) and Express backend need access to the same Prisma schema and generated types. A shared package provides a single source of truth per Constitution Principle IX.

**Alternatives considered**:

- Symlinked schema file: Rejected — fragile, doesn't share generated types
- Duplicate schemas: Rejected — violates single source of truth
- Schema in backend only, frontend imports from backend: Rejected — circular dependency, doesn't work with npm workspaces cleanly

**Key findings**:

- **Root package.json** must have `"private": true` and `"workspaces": ["backend", "frontend", "packages/*"]`
- Prisma generator `output` must be set to `"../generated/client"` (relative to schema) — default `node_modules/.prisma/client` is unreliable in monorepos due to hoisting
- `packages/db/src/index.ts` exports a `globalThis` singleton PrismaClient (prevents connection exhaustion in Next.js hot reload)
- Consumer usage: `import { prisma } from '@jump/db'` (both frontend and backend)
- Backend and frontend add `"@jump/db": "*"` to dependencies; remove direct `prisma` and `@prisma/client` deps
- `postinstall` script in packages/db runs `prisma generate` automatically
- `.env` with `DATABASE_URL` must live in `packages/db/` or `packages/db/prisma/` (Prisma resolves relative to schema)
- `tsup` builds dual ESM/CJS output for compatibility with both apps
- Existing migrations in `backend/prisma/migrations/` must be moved to `packages/db/prisma/migrations/` — but since we're wiping data, we can start fresh migrations

---

## R3 — Resend SDK Integration

**Decision**: Replace SendGrid with Resend for both transactional emails and Auth.js magic links.

**Rationale**: Constitution v2.0.1 pins Resend as the sole email provider.

**Alternatives considered**:

- Keep SendGrid alongside Resend: Rejected — constitution explicitly removes SendGrid
- Use Auth.js built-in email sending: Rejected — lacks customization for branded templates

**Key findings**:

- Auth.js has a first-party `Resend` provider: `import Resend from "next-auth/providers/resend"`
- Configuration: `Resend({ apiKey: process.env.AUTH_RESEND_KEY, from: "Jump <noreply@jump.events>" })`
- Custom `sendVerificationRequest` function available for branded magic link emails
- Backend EmailService for transactional emails (order confirmations, cancellation notifications) uses the Resend REST API or `resend` npm SDK directly
- Remove `backend/src/config/sendgrid.js` and update `backend/src/services/EmailService.js`

---

## R4 — Prisma Migration Strategy (Pre-Launch Wipe)

**Decision**: Drop all existing tables, create fresh migrations from the new schema.

**Rationale**: Platform is pre-launch with no real customer data. Starting fresh eliminates migration complexity and ensures a clean schema.

**Alternatives considered**:

- Incremental migrations: Rejected — would require complex data transformations for Admin→User, Customer→Contact
- Backward-compatible views: Rejected — unnecessary complexity for pre-launch

**Key findings**:

- Run `prisma migrate reset` to wipe the database (drops all tables, re-runs all migrations, re-seeds)
- Alternatively, delete the existing `migrations/` directory entirely and run `prisma migrate dev --name init_schema_redesign` to create a single clean migration
- Seed script (`prisma/seed.ts`) should create: 1 organization, 2 venues, 1 admin user, sample events with price tiers
- The fresh migration approach means no migration history is carried forward — this is intentional
