# Jump Ticketing Platform — Agent Instructions

Multi-tenant event ticketing: Organizations → Venues → Events → PriceTiers → Tickets.
Express.js backend (port 3000), Next.js 14 frontend (port 3001), shared Prisma client (`@jump/db`).

`AGENTS.md` is the single source of truth for every AI agent (Claude Code, Codex, Cursor, Copilot, Gemini, …).
Each `CLAUDE.md` in this repo is a symlink to the `AGENTS.md` beside it — edit `AGENTS.md`, never the symlink.
Subdirectory files (`backend/`, `frontend/`, `packages/db/`) load automatically when an agent touches those paths.

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
cd backend && npm test              # All backend tests (creates + migrates jump_test on your Postgres automatically)
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
- **Capacity**: Enforced via `SELECT ... FOR UPDATE` row-level locking on PriceTier — see `backend/AGENTS.md`
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
| `BUCKET_NAME`, `BUCKET_ENDPOINT`, `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY`, `BUCKET_REGION` | backend | S3-compatible image storage (Railway Bucket). Unset → local `uploads/` disk (ephemeral on Railway) |
| `BUCKET_PUBLIC_URL` | backend | Optional. Only set for a public bucket/CDN; otherwise images are served through `GET /images/:id/:hash/:variant` |
| `BACKEND_URL` | backend | Optional. Public backend base URL for absolute image links in emails. Falls back to `https://$RAILWAY_PUBLIC_DOMAIN`, then `http://localhost:$PORT` |
| `STOREFRONT_CNAME_TARGET` | backend | Optional. Hostname organizations CNAME their storefront domain to (default: host of the first `FRONTEND_URL`). Custom domains, spec 007 phase 3 |
| `PLATFORM_HOSTS` / `NEXT_PUBLIC_PLATFORM_HOSTS` | backend / frontend | Optional. Comma-separated platform hostnames that must never resolve as a tenant storefront (localhost and `*.up.railway.app` are always platform) |
| `RAILWAY_API_TOKEN`, `RAILWAY_FRONTEND_SERVICE_ID` | backend | Optional. With Railway-injected `RAILWAY_PROJECT_ID` + `RAILWAY_ENVIRONMENT_ID`, lets the backend attach verified custom domains to the frontend service for TLS. Unset: domains activate on DNS proof and TLS must be added in the Railway dashboard |
| `DOMAIN_SWEEP_INTERVAL_MS` | backend | Optional. Custom-domain re-check interval (default 10 min) |
| `DOMAIN_VERIFY_COOLDOWN_MS` | backend | Optional. Minimum gap between user-initiated "I updated DNS records" checks (default 15 s; tests use 0) |
| `APPLICATIONS_PAYMENTS_ENABLED` | backend | Optional. `true` lets PAID application forms open: card on file at submission, off-session charge at approval, pay-now, refunds (spec 011 phase 2). Default off: only FREE forms (press, panels) run |
| `APPLICATION_SWEEP_INTERVAL_MS` | backend | Optional. Application sweep interval (default 1 h): overdue pay-now check + organizer daily digest (spec 011 phase 3) |
| `STRIPE_CONNECT_ENABLED` | backend | Optional. `true` routes charges for organizations with an active Stripe Connect account as destination charges (spec 010 phase 2). Default off; code deploys dark |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | backend | Optional. Signing secret for `POST /webhooks/stripe/connect` (connected-account events). Separate from `STRIPE_WEBHOOK_SECRET` |
| `BILLING_ENABLED` | backend | Optional. `true` inserts the subscribe step into `/signup` and opens Settings › Plan (spec 022 phase 2: Stripe Billing on Jump's own Stripe account, embedded Checkout, customer portal). Default off: name → survey → done only |
| `STRIPE_BILLING_WEBHOOK_SECRET`, `JUMP_STARTER_PRICE_ID`, `BILLING_TRIAL_DAYS` | backend | With `BILLING_ENABLED`: signing secret for `POST /webhooks/stripe/billing`, the Price id of the STARTER plan (required, else billing stays off), trial length (default 30) |
| `NEXT_PUBLIC_BILLING_ENABLED`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | frontend | With billing: shows Settings › Plan in the nav; Jump-account publishable key for embedded Checkout. Build-time |
| `ONBOARDING_SWEEP_INTERVAL_MS`, `ONBOARDING_ABANDON_AFTER_MS` | backend | Optional. Abandoned-signup sweep (default 1 h) and the age after which an unfinished signup with no events and no subscription is deleted (default 7 d) |
| `SCANNER_API_KEY` | backend | Optional. Shared key for hardware ticket readers calling `POST /tickets/scan` / `/redeem` via `X-Scanner-Key`. Unset: only staff sessions can scan |
| `RATE_LIMIT_<NAME>_LIMIT` / `_WINDOW_MS`, `RATE_LIMIT_ENFORCE_IN_TESTS` | backend | Optional. Per-IP limiter overrides (spec 020): `BASELINE`, `ORDER_CREATE`, `ORDER_LOOKUP`, `ORDER_VERIFY`, `SCANNER_AUTH`, `DOMAIN_RESOLVE`, `BUYER_AUTH_REQUEST`, `APPLICATION_SUBMIT`. Limiters are pass-throughs under test unless `RATE_LIMIT_ENFORCE_IN_TESTS=1` |
| `ORDER_MAX_PENDING_PER_CONTACT`, `ORDER_SWEEP_INTERVAL_MS`, `ORDER_SWEEP_GRACE_MS` | backend | Optional. Open checkouts one email may hold per event (default 3, then 409); abandoned-checkout sweep interval (default 5 min) and grace past the 30-minute Checkout session (default 5 min) |
| `LEGAL_IP_SALT` | backend | Optional. Salt for the hashed IP on `LegalAcceptance` rows (spec 024 phase 3); falls back to `AUTH_SECRET`. The raw IP is never stored |
| `LEGAL_ACCEPTANCE_REQUIRED` | backend | Optional. `true` makes `POST /orders` refuse a checkout without current `acceptances` (400 `LEGAL_ACCEPTANCE_REQUIRED`). Default off until the legal pages go live (spec 023 phase 1): a missing list is logged, a stale one is always refused. The apply form always requires them |
| `NEXT_PUBLIC_LEGAL_PAGES_ENABLED` | frontend | Optional. `true` renders `/legal/<slug>` from `frontend/content/legal/<slug>.md` (attorney text with front matter, spec 023 LR-01) and links the consent texts on the apply form, the checkout sentence and `PaymentForm` to `/legal/privacy` / `/legal/terms`. Off (default): every `/legal/*` path is 404 and the texts render without links, so nothing promises a 404. `/terms` and `/privacy` 308 to the new paths either way. Build-time |

## Deployment

Railway with Railpack. Both services need explicit `PORT` env var.
- `railpack.backend.json` / `railpack.frontend.json`

## Documentation

After completing a feature, run `/doc-feature` to generate wiki page at `docs/wiki/features/` and check if any `AGENTS.md` files need updates.
Wiki index: `docs/wiki/README.md`.

## Architecture

```
Organization → Venue → Event → PriceTier
                                    ↓
                    Contact → Order → OrderItem → Ticket
                                    ↓
                            PaymentTransaction (Stripe)
```

- **Contact ≠ User**: Contacts are ticket buyers (can be guests). Users are authenticated accounts.
- **Org scoping**: Events belong to orgs transitively: Event → Venue → Organization.
- **PaymentTransaction**: Append-only, no updatedAt. Immutable ledger.
- **Capacity**: Event.capacity is a ceiling; actual inventory lives on PriceTier (quantityTotal/Sold/Reserved).

## Tech Stack

Express.js 4.21 · Next.js 14 App Router · PostgreSQL via Prisma · Stripe (API v2024-11-20.acacia) ·
Auth.js v5 (JWT HS256) · Resend email · Redis caching · Railway deployment

## Backend Patterns

- **Layering**: Routes handle HTTP, validators check input, services contain business logic
- **Route registration**: New route files must be registered in `backend/src/api/server.js`
- **Auth middleware chain**: `requireAuth` → `requireRole('ORGANIZER'|'ADMIN')`
- **Public endpoints**: Event listing, guest checkout, ticket lookup — no auth required
- **Partial PATCH validators**: `validateUpdateBusinessDetails` validates only keys present in the body (whitelist + per-key rules). Follow that pattern when several UI cards save subsets of one record

## Frontend Patterns

- **App Router**: Admin pages under `/admin/`, public under `/events/`
- **API calls**: All go through `frontend/src/services/api.ts`
- **Client components**: Use `'use client'` directive; wrap `useSearchParams()` in `<Suspense>`
- **Admin pages**: Add to sidebar nav, protect with session check
- **UI/UX skill**: `ui-ux-pro-max` (`.claude/skills/`, gitignored — install with `npx ui-ux-pro-max-cli init --ai claude`) is available locally for layout, UX guidelines, accessibility, typography and chart choices when building or reviewing pages and components. It is advisory: public storefront colors always come from the org's `brand` tokens via `BrandScope` (Gotcha 6), admin pages keep the existing Tailwind/shadcn conventions, and nothing from the skill's generated design systems is hardcoded into shared components
- **Motion skill**: `design-motion-principles` (`.claude/skills/`, gitignored — install with `npx skills add kylezantos/design-motion-principles`) for transitions, hover states, micro-interactions and enter/exit animations. "add/animate" = create mode, "audit/review" = audit mode. Keep Jump's restraint: short durations, respect `prefers-reduced-motion`, no motion on storefront checkout steps that could delay or mask capacity/payment state
- **Taste skills**: `design-taste-frontend` and `redesign-existing-projects` (`.claude/skills/`, gitignored — install with `npx skills add https://github.com/Leonxlnx/taste-skill --skill design-taste-frontend --skill redesign-existing-projects`). The first shapes new pages and components so they do not look templated; the second audits existing UI first, then upgrades it without changing behavior. Same limits as the UI/UX skill: org `brand` tokens own storefront color, admin keeps its Tailwind/shadcn conventions, and a redesign never touches checkout, capacity or payment logic

## Commit Rules

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Subject ≤ 50 chars, imperative mood
- Body explains WHY, not WHAT (the diff shows what)

## Common Tasks

### New API endpoint
1. Route in `backend/src/api/routes/` → validator in `validators/` → logic in `services/`
2. Register in `server.js` if new file
3. Add auth middleware as needed

### New frontend page
1. Create `frontend/src/app/<path>/page.tsx`
2. API calls via `frontend/src/services/api.ts`

### Schema change
1. Edit `packages/db/prisma/schema.prisma`
2. `npm run db:migrate` then `npm run db:generate`
3. Update seed file if applicable

## Gotchas

1. AUTH_SECRET mismatch → silent JWT verification failure
2. Prisma client not regenerated after schema change → stale types
3. Stripe webhooks locally need: `stripe listen --forward-to localhost:3000/webhooks/stripe` (add `--forward-connect-to localhost:3000/webhooks/stripe/connect` when `STRIPE_CONNECT_ENABLED=true`)
4. Capacity is per-tier, not per-event
5. Railway services need explicit PORT env var
6. Public org/venue/event pages use `brand` Tailwind tokens (CSS vars set by `BrandScope`), not raw blue classes — see `docs/wiki/features/organization-branding.md`
7. Org-scoped public pages must pass `themeMode` to `BrandScope`; never force a theme via `setTheme` (it overwrites the visitor's stored choice) — see `docs/wiki/features/organization-theme-mode.md`
8. Tenancy (spec 007): buyers are `Contact` rows scoped by `organizationId` (unique on `organizationId + email`); the same email at two orgs is two rows. Never look up a Contact by email alone — use `organizationId_email`. Staff org affiliation is `OrganizationMember`, resolved through `resolveOrgScope` / `requireOrgMembership` in `backend/src/middleware/orgScope.js`; `User.organizationId` and `Contact.userId` no longer exist. `UserRole.UNASSIGNED` is the default for fresh sign-ins and grants nothing. The admin org switcher sends `X-Jump-Org`; the backend honors it only for real memberships (SYSTEM_ADMIN, who has none, gets it via `activeOrgFor(req)`). The Auth.js `jwt` callback re-reads role/membership claims from the DB every 60 s (`frontend/src/lib/sessionClaims.ts`), so role changes do not need a re-login — see `docs/wiki/features/org-switcher.md`. Buyers sign in passwordlessly via `/buyer/*` + the `jump_buyer` httpOnly cookie set by `frontend/src/app/api/buyer/*`; never put buyers in `User` or Auth.js
9. Next middleware lives at `frontend/src/middleware.ts` (the `src/` layout ignores a root `frontend/middleware.ts`). It does tenant-host routing for custom domains and redirects unauthenticated `/admin*` requests to sign-in on the edge. The session cookie is a plain HS256 JWT encoded/decoded with `jose` in `frontend/src/lib/authJwt.ts` (wired through `auth.config.ts`), so it verifies on the edge and in the Express backend alike. The email provider is filtered out of the middleware's Auth.js config because it requires a database adapter — see `docs/wiki/features/custom-domains.md`
10. Backend CORS (`backend/src/api/server.js`): `FRONTEND_URL` is a comma-separated allowlist; outside production any `localhost`/`127.0.0.1` port is also allowed, so worktree previews on other ports work without env changes. A running backend must be restarted to pick up the change. ACTIVE organization custom domains are also allowed dynamically (`DomainService.isActiveOrigin`)
11. Admin Playwright specs must sign in with `frontend/e2e/helpers/session.ts` (`signInAsStaff`): the edge middleware decodes the HS256 session cookie itself, so mocking `GET /api/auth/session` alone redirects to sign-in. Run Playwright with `PLAYWRIGHT_PORT=<free port>` when another checkout's dev server holds 3001
12. Tax (spec 009): `Event.taxRate` is resolved from the organization's `TaxRegion` for the venue's state — not collecting → 0, `MANUAL` → flat rate, `STRIPE` → Stripe Tax lookup. Stripe Tax registrations belong to the platform Stripe account, so a 0% from Stripe may mean "not registered", not "tax-free"; `TaxService.getTaxRateForVenue` throws instead of returning 0 and the region row records `lastError`. `frontend/src/lib/fees.ts` must stay identical to `backend/src/services/FeeService.js` (both support `taxInclusive`) — change both plus both fixture files. See `docs/wiki/features/tax-settings.md`
13. Payments (spec 010): `OrderService.createOrder` spreads `PaymentSettingsService.checkoutOptionsFor(organization)` into the Checkout Session — never hardcode `payment_method_types` or `payment_intent_data` there. The service validates against the live platform account (descriptor prefix, capabilities) on save and re-filters at checkout, so it never throws; a suffix that stops fitting is dropped, not sent. Contract tests pin `paymentSettingsService._statusCache` instead of mocking Stripe. See `docs/wiki/features/payments-settings.md`
14. Running `next build` inside `frontend/` while `next dev` is up replaces `.next/` under the live server (`Cannot find module './vendor-chunks/next-auth.js'` on every page) — restart the dev server afterwards, or typecheck with `npx tsc --noEmit -p .` instead
15. Applications (spec 011): Stripe card-on-file / charge events are routed on `metadata.applicationId`, tier capacity moves only on approval, PAID forms need `APPLICATIONS_PAYMENTS_ENABLED`, and the hourly application sweep also sends the organizer daily digest. See `backend/AGENTS.md` and `docs/wiki/features/applications.md`
16. Add-ons (spec 012): order add-on lines are `OrderAddOn` rows, not `OrderItem`s — they never create tickets or count in `Order.quantity`. Fee math takes per-item `taxable` in both fee libraries; every path that releases tier reservations must also release add-on reservations (`AddOnService.release`). Applications: approval reserves the tier then the add-ons (409 rolls both back); lines are edited only through `updateAddOns` before payment. See `backend/AGENTS.md`
17. One ledger (spec 024): a PAID-form application **is an `Order`** (`kind: APPLICATION`) from submission on — its lines, `PaymentTransaction` and `Refund` rows are the only record of its money; `Application` keeps review state, capacity and the card on file. `Order.status` is derived from `paymentStatus` through `orderStatusFor()` and written in the same transaction (`ApplicationService._transition`); serializers read money through `moneyOf(application)`. `PAID_ORDER_STATUSES` (`backend/src/services/paidStatuses.js`) is the one definition of money collected for customers, analytics, dashboard and the tax report; refunds of every kind go through `RefundService.refundOrder` (ADMIN). `/admin/orders` is the one money surface: order-level rows for both kinds with a **Tickets** toggle for the ticket-row view — there is no org-wide transactions list and there must never be one beside Orders. Consent (spec 023 via 024 phase 3): the apply form and checkout echo `GET /legal/versions` as `acceptances`; the backend validates them (`LegalAcceptanceService`) and writes the append-only `LegalAcceptance` trail itself; apply-form opt-ins apply only once an application is SUBMITTED (`ContactOptInService`). See `backend/AGENTS.md`
18. Participants (spec 019): the org-wide submissions list and the per-event Applications tab are one component (`frontend/src/components/applications/SubmissionsTable.tsx`, `eventId` optional) over one set of scoped service methods (`ApplicationService.*InScope`); rows link to the per-event detail page and there is no Participants detail route. Extend the scope or the table — never fork either. Form templates (`ApplicationFormTemplate`) are JSON snapshots validated by the form validators and materialised through `ApplicationFormService._materialise` (shared with event duplication) — never a form with a null `eventId`. See `docs/wiki/features/participants.md`
19. Content › Files (spec 025): `StoreFile` is an org-scoped row over the shared content-addressed `File` table — never add `organizationId` to `File`. Public URLs `GET /files/:id/:hash/:name` are hash-protected and **not** gated by private store mode. MIME is sniffed server-side; SVG is rejected. `activeOrgFor(req)` lives in `backend/src/api/routes/adminScope.js` for every Content router. Content records that embed file URLs must call `StoreFileService.syncReferences` on save so *Used in* stays correct. See `docs/wiki/features/content-files.md`

## Project workflow

Hermes Kanban is the operational project-management source of truth for Jump. Use [`docs/development/kanban-workflow.md`](docs/development/kanban-workflow.md) for the lifecycle: triage → specify/decompose → Claude Code implementation → PR review → merge → done. GitHub remains authoritative for diffs, CI, reviews, and merge records. A coding worker must return the PR URL/number, changed files, tests/results, migrations, commit SHA, and remaining risks before requesting review; local edits alone are never done.
