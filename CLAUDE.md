# Jump Ticketing Platform

Multi-tenant event ticketing: Organizations → Venues → Events → PriceTiers → Tickets.
Express.js backend (port 3000), Next.js 14 frontend (port 3001), shared Prisma client (`@jump/db`).

> Cross-agent standards, architecture, and gotchas live in [`AGENTS.md`](./AGENTS.md).
> Subdirectory `CLAUDE.md` files load automatically when you touch those paths.

## Commands

```bash
npm install                 # Install all workspaces (run from root, never from a subdir)
npm run dev:backend         # Backend dev server
npm run dev:frontend        # Frontend dev server
npm run db:generate         # Regenerate Prisma client (required after schema changes)
npm run db:migrate          # Run pending migrations
npm run db:seed             # Seed sample data
npm run db:studio           # Prisma Studio GUI
```

## Testing

```bash
cd backend && npm test              # All backend tests
cd backend && npm run test:unit     # Unit tests only
cd backend && npm run test:contract # Contract tests
cd frontend && npm run test         # Playwright E2E
cd frontend && npm run test:unit    # Vitest unit tests (lib/color.ts)
```

## Core Constraints

- **DB import**: Always `import { prisma } from "@jump/db"` — never instantiate PrismaClient directly
- **AUTH_SECRET**: Must be identical in `backend/.env` and `frontend/.env.local` — JWT verification fails silently on mismatch
- **Workspace installs**: Always `npm install` from repo root to link workspaces. Never install from subdirs
- **Stripe webhooks**: Never trust client-side payment status. All payment state changes flow through `POST /webhooks/stripe`
- **Capacity**: Enforced via `SELECT ... FOR UPDATE` row-level locking on PriceTier — see `backend/CLAUDE.md`
- **Suspense**: Any component using `useSearchParams()` must be wrapped in `<Suspense>`

## Environment Variables

| Variable | Location | Notes |
|----------|----------|-------|
| `DATABASE_URL` | packages/db, backend, frontend | Same DB for all |
| `AUTH_SECRET` | backend + frontend | **Must match** |
| `STRIPE_SECRET_KEY` | backend | |
| `STRIPE_WEBHOOK_SECRET` | backend | |
| `RESEND_API_KEY` | backend | |
| `NEXT_PUBLIC_API_URL` | frontend | Points to backend URL |

## Deployment

Railway with Railpack. Both services need explicit `PORT` env var.
- `railpack.backend.json` / `railpack.frontend.json`

## Documentation

After completing a feature, run `/doc-feature` to generate wiki page at `docs/wiki/features/` and check if any `AGENTS.md`/`CLAUDE.md` files need updates.
Wiki index: `docs/wiki/README.md`.
