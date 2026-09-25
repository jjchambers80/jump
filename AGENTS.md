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
./scripts/bootstrap-worktree.sh     # In a fresh worktree (.worktrees/<id>): copies the gitignored env files from the primary checkout, installs, generates Prisma
cd backend && npm test              # All backend tests (creates + migrates jump_test on your Postgres automatically)
cd backend && npm run test:unit     # Unit tests only
cd backend && npm run test:contract # Contract tests
cd frontend && npm run test         # Playwright E2E
cd frontend && npm run test:unit    # Vitest unit tests (lib/color.ts)
```

## Core Constraints

- **Worktrees**: run `./scripts/bootstrap-worktree.sh` before anything else in a fresh worktree — without `backend/.env` the test suite falls back to `postgres:postgres@localhost:5432` and every contract test fails with `P1000`
- **CI is the completion gate**: `.github/workflows/ci.yml` (backend unit + contract + integration on a Postgres service, frontend typecheck + vitest, migration safety) and `.github/workflows/e2e.yml` (Playwright, 3 shards, skips `frontend/e2e/quarantine.txt`) are required checks on `main`; a Kanban card with a PR completion contract only closes once it is green. Keep the suite deterministic — no network, no Stripe

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
| `STRIPE_WEBHOOK_ALLOW_UNSIGNED` | backend | Optional, **local development only**. Without a signing secret every `/webhooks/stripe*` endpoint refuses the event with 500; `true` restores the old permissive parse so `stripe trigger` works without `stripe listen`. Only `backend/tests/setup.js` and a developer's own `backend/.env` may set it — never a deployed service |
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
| `SECURITY_CONTACT_EMAIL` | frontend | Optional. Serves RFC 9116 `/.well-known/security.txt` with this `Contact:` address (spec 023 phase 0); unset → 404 until the `security@` mailbox exists (launch checklist) |
| `LEGAL_IP_SALT` | backend | Optional. Salt for the hashed IP on `LegalAcceptance` rows (spec 024 phase 3); falls back to `AUTH_SECRET`. The raw IP is never stored |
| `TWO_STEP_TRUST_DAYS` | backend + frontend | Optional. "Remember this device" lifetime for two-step (default 30) (spec 030 C) |
| `HIBP_CHECK` | backend | Optional. `false` skips the Have I Been Pwned range check when a password is set (default on, fail-open) (spec 030 B) |
| `WEBAUTHN_RP_ID` | backend | Optional. Passkey relying-party id (default: host of the first `FRONTEND_URL`) |
| `GEOIP_ENABLED` / `NEXT_PUBLIC_GEOIP_ENABLED` | backend / frontend | Optional. City/region/country on Account › Security › Devices via `geoip-lite` (install it in the backend workspace; MaxMind GeoLite2 attribution shown). Default off → "Location unavailable" (spec 030 D) |
| `SESSION_SWEEP_INTERVAL_MS` | backend | Optional. Deletes revoked / 30-day-idle `UserSession` rows (default 24 h) |
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
3. Stripe webhooks locally need: `stripe listen --forward-to localhost:3000/webhooks/stripe` (add `--forward-connect-to localhost:3000/webhooks/stripe/connect` when `STRIPE_CONNECT_ENABLED=true`). Without a signing secret every webhook endpoint now **refuses** the event with 500 — set the `whsec_…` the CLI prints, or `STRIPE_WEBHOOK_ALLOW_UNSIGNED=true` for hand-rolled local posts. An unexpected handler error is also a 500 so Stripe retries; only deliberately ignored events answer 200
4. Capacity is per-tier, not per-event
5. Railway services need explicit PORT env var
6. Public org/venue/event pages use `brand` Tailwind tokens (CSS vars set by `BrandScope`), not raw blue classes — see `docs/wiki/features/organization-branding.md`
7. Org-scoped public pages must pass `themeMode` to `BrandScope`; never force a theme via `setTheme` (it overwrites the visitor's stored choice) — see `docs/wiki/features/organization-theme-mode.md`
8. Tenancy (spec 007): buyers are `Contact` rows scoped by `organizationId` (unique on `organizationId + email`); the same email at two orgs is two rows. Never look up a Contact by email alone — use `organizationId_email`. Staff org affiliation is `OrganizationMember`, resolved through `resolveOrgScope` / `requireOrgMembership` in `backend/src/middleware/orgScope.js`; `User.organizationId` and `Contact.userId` no longer exist. `UserRole.UNASSIGNED` is the default for fresh sign-ins and grants nothing. The admin org switcher sends `X-Jump-Org`; the backend honors it only for real memberships (SYSTEM_ADMIN, who has none, gets it via `activeOrgFor(req)`). The Auth.js `jwt` callback re-reads role/membership claims from the DB every 60 s (`frontend/src/lib/sessionClaims.ts`), so role changes do not need a re-login — see `docs/wiki/features/org-switcher.md`. Buyers sign in passwordlessly via `/buyer/*` + the `jump_buyer` httpOnly cookie set by `frontend/src/app/api/buyer/*`; never put buyers in `User` or Auth.js
9. Next middleware lives at `frontend/src/middleware.ts` (the `src/` layout ignores a root `frontend/middleware.ts`). It does tenant-host routing for custom domains and redirects unauthenticated `/admin*` requests to sign-in on the edge. The session cookie is a plain HS256 JWT encoded/decoded with `jose` in `frontend/src/lib/authJwt.ts` (wired through `auth.config.ts`), so it verifies on the edge and in the Express backend alike. The email provider is filtered out of the middleware's Auth.js config because it requires a database adapter — see `docs/wiki/features/custom-domains.md`
10. Backend CORS (`backend/src/api/server.js`): `FRONTEND_URL` is a comma-separated allowlist; outside production any `localhost`/`127.0.0.1` port is also allowed, so worktree previews on other ports work without env changes. A running backend must be restarted to pick up the change. ACTIVE organization custom domains are also allowed dynamically (`DomainService.isActiveOrigin`)
11. Admin Playwright specs must sign in with `frontend/e2e/helpers/session.ts` (`signInAsStaff`): the edge middleware decodes the HS256 session cookie itself, so mocking `GET /api/auth/session` alone redirects to sign-in. Run Playwright with `PLAYWRIGHT_PORT=<free port>` when another checkout's dev server holds 3001. CI runs every spec on Chromium in `.github/workflows/e2e.yml` (3 shards, required) with no backend: new specs must mock the API with `page.route` and scope assertions to visible elements (several pages mount mobile + desktop copies)
12. Tax (spec 009): `Event.taxRate` is resolved from the organization's `TaxRegion` for the venue's state — not collecting → 0, `MANUAL` → flat rate, `STRIPE` → Stripe Tax lookup. Stripe Tax registrations belong to the platform Stripe account, so a 0% from Stripe may mean "not registered", not "tax-free"; `TaxService.getTaxRateForVenue` throws instead of returning 0 and the region row records `lastError`. `frontend/src/lib/fees.ts` must stay identical to `backend/src/services/FeeService.js` (both support `taxInclusive`) — change both plus both fixture files. See `docs/wiki/features/tax-settings.md`
13. Payments (spec 010): `OrderService.createOrder` spreads `PaymentSettingsService.checkoutOptionsFor(organization)` into the Checkout Session — never hardcode `payment_method_types` or `payment_intent_data` there. The service validates against the live platform account (descriptor prefix, capabilities) on save and re-filters at checkout, so it never throws; a suffix that stops fitting is dropped, not sent. Contract tests pin `paymentSettingsService._statusCache` instead of mocking Stripe. See `docs/wiki/features/payments-settings.md`
14. Running `next build` inside `frontend/` while `next dev` is up replaces `.next/` under the live server (`Cannot find module './vendor-chunks/next-auth.js'` on every page) — restart the dev server afterwards, or typecheck with `npx tsc --noEmit -p .` instead
15. Applications (spec 011): Stripe card-on-file / charge events are routed on `metadata.applicationId`, tier capacity moves only on approval, PAID forms need `APPLICATIONS_PAYMENTS_ENABLED`, and the hourly application sweep also sends the organizer daily digest. See `backend/AGENTS.md` and `docs/wiki/features/applications.md`
16. Add-ons (spec 012): order add-on lines are `OrderAddOn` rows, not `OrderItem`s — they never create tickets or count in `Order.quantity`. Fee math takes per-item `taxable` in both fee libraries; every path that releases tier reservations must also release add-on reservations (`AddOnService.release`). Applications: approval reserves the tier then the add-ons (409 rolls both back); lines are edited only through `updateAddOns` before payment. See `backend/AGENTS.md`
17. One ledger (spec 024): a PAID-form application **is an `Order`** (`kind: APPLICATION`) from submission on — its lines, `PaymentTransaction` and `Refund` rows are the only record of its money; `Application` keeps review state, capacity and the card on file. `Order.status` is derived from `paymentStatus` through `orderStatusFor()` and written in the same transaction (`ApplicationService._transition`); serializers read money through `moneyOf(application)`. `PAID_ORDER_STATUSES` (`backend/src/services/paidStatuses.js`) is the one definition of money collected for customers, analytics, dashboard and the tax report; refunds of every kind go through `RefundService.refundOrder` (ADMIN). `/admin/orders` is the one money surface: order-level rows for both kinds with a **Tickets** toggle for the ticket-row view — there is no org-wide transactions list and there must never be one beside Orders. Consent (spec 023 via 024 phase 3): the apply form and checkout echo `GET /legal/versions` as `acceptances`; the backend validates them (`LegalAcceptanceService`) and writes the append-only `LegalAcceptance` trail itself; apply-form opt-ins apply only once an application is SUBMITTED (`ContactOptInService`). See `backend/AGENTS.md`
18. Participants (spec 019): the org-wide submissions list and the per-event Applications tab are one component (`frontend/src/components/applications/SubmissionsTable.tsx`, `eventId` optional) over one set of scoped service methods (`ApplicationService.*InScope`); rows link to the per-event detail page and there is no Participants detail route. Extend the scope or the table — never fork either. Form templates (`ApplicationFormTemplate`) are JSON snapshots validated by the form validators and materialised through `ApplicationFormService._materialise` (shared with event duplication) — never a form with a null `eventId`. See `docs/wiki/features/participants.md`
19. Content › Files (spec 025): `StoreFile` is an org-scoped row over the shared content-addressed `File` table — never add `organizationId` to `File`. Public URLs `GET /files/:id/:hash/:name` are hash-protected and **not** gated by private store mode. MIME is sniffed server-side; SVG is rejected. `activeOrgFor(req)` lives in `backend/src/api/routes/adminScope.js` for every Content router. Content records that embed file URLs must call `StoreFileService.syncReferences` on save so *Used in* stays correct. See `docs/wiki/features/content-files.md`
20. Content › Blog posts (spec 026): organizer HTML (blog posts, excerpts, pages, event descriptions) is sanitised **on write** with `backend/src/utils/sanitizeHtml.js` and rendered only through `frontend/src/components/storefront/ContentHtml.tsx` — never store or inject unsanitised HTML elsewhere. `sanitize-html` stays on 2.16.x (2.17 is ESM-only under Jest). Public content routes use `gateByOrgParam` and return the organization identity for the storefront shell; hidden / scheduled records are 404, never "hidden". Tiptap mounts only through `RichTextEditorField` (`ssr: false`). Event descriptions stored before the editor (plain text) are converted once with `npm run db:backfill:event-descriptions` (dry run unless `DRY_RUN=false`). See `docs/wiki/features/blog-posts.md`
21. Content › Menus (spec 027): `MenuItem.targetId` has no foreign key on purpose — targets resolve at read time (`MenuService._describeTarget`), so never cascade-delete or "clean up" menu items from other services. Menus save as one tree (`PUT /admin/menus/:id`); there are no per-item endpoints. `OrganizationHeader nav` + `StorefrontFooter` mount on org, event, page and blog pages only — not checkout, confirmation, apply or account. Menu hrefs are platform paths; `lib/storefrontPath.ts` shortens them on custom domains. See `docs/wiki/features/menus.md`
22. Content › URL redirects (spec 028): redirects are consulted **only** on the storefront 404 path (tenant middleware `notFound` branch, platform `organizations/[orgId]/[...rest]` catch-all) and fail open to the 404. `backend/src/utils/redirectPath.js` `isReservedPath` mirrors the live routes in `frontend/src/lib/storefrontHost.ts` — extend both when adding a public storefront route. Targets are storefront paths or `https://` URLs; `hostifyRedirectTarget` prefixes org-relative paths on the platform host. See `docs/wiki/features/url-redirects.md`
23. Customer accounts (spec 031): self-serve ticket refunds go through `RefundPolicyService.evaluateRefundPolicy` (org policy on top of the tier's `isRefundable`) in **both** the buyer refund route and `TicketService.getTicketsForContact` — never re-implement the eligibility check elsewhere. Staff refunds (`/admin/orders`) never apply the policy or fee. A retained fee lives on `Refund.feeAmount` and keeps the order `PARTIALLY_REFUNDED` so staff can return it with `refundOrder`. See `docs/wiki/features/customer-accounts-settings.md`
23. Account settings (spec 030): `/admin/account*` is the signed-in user's own profile (photo, name, verified email change, phone, language, time zone) — routed from the org-menu name/email block, not under `/admin/settings` (organization settings) and not on the sidebar. Backend `/account/*` acts only on `req.user.id`. `locale` / `timeZone` / `picture` are JWT claims (`session.user.locale` etc.); format admin dates with `useAccountFormat()`. `AdminRoute` treats a session as authenticated while `useSession().update()` reports `'loading'` — do not gate on `status === 'authenticated'` in admin shells. See `docs/wiki/features/account-settings.md`
24. Devices (spec 030 D): staff sessions are `UserSession` rows; the JWT carries `sid`. Backend `requireAuth` refuses a revoked `sid` at once (401 `SESSION_REVOKED`, `api.ts` signs the browser out); the cookie of an idle device drops at the next 60 s claims refresh. `req.user.sid` can be `null` for legacy tokens — never require it. Redis connects lazily through `utils/cache.js` and never under test. See `docs/wiki/features/devices-sessions.md`
25. Sign-in methods (spec 030 B): security mutations need a step-up proof — wrap client calls in `withReauth` (`app/admin/account/useReauth.tsx`) and backend handlers in `requireRecentAuth`. Password sign-in and passkey/recovery ceremonies end in the backend; sessions come only from Auth.js providers (`password`, `token-bridge`). Root `package.json` `overrides` pin `next` (14.2.21) and `@auth/core` — npm otherwise hoists next-auth's peer as next 16 and breaks `middleware.ts` types; change them with any Next upgrade. See `docs/wiki/features/account-security.md`
26. Two-step (spec 030 C): a session with `mfa: 'pending'` can reach only `/auth/two-step` and `/account/two-step/{verify,passkey-options,trusted-check}` — the edge middleware redirects `/admin*`, `requireAuth` returns 401 `TWO_STEP_REQUIRED`, `api.ts` follows it. Never mount a new page a mid-challenge session needs anywhere else. `resolveMfaState` in `frontend/src/lib/staffAuth.ts` is the one state machine; proofs are single use. See `docs/wiki/features/two-step-authentication.md`
27. Venue time zones (spec 033): **event times are the venue's wall clock, never the viewer's** — format every event date with `formatEventDateTime` / `formatEventDate` / `formatEventTime` and the venue's `timezone`, and read/write every `datetime-local` (event date, tier sale windows) through `instantToZonedInput` / `zonedInputToInstant`. The zone abbreviation is always rendered, on every surface: the "hide it when it matches the viewer" variant needs a browser-only fact on server-rendered pages. Operational timestamps (created at, paid at, last seen) stay on the viewer's account zone via `useAccountFormat()` (spec 030) — three zones, three jobs (`Venue.timezone` = when the show starts, `Organization.timezone` = when the org's day ends, `User.timeZone` = when it happened to me). **Two parity pairs** must stay behaviourally identical and are asserted from both Jest and Vitest against one shared fixture each in `backend/tests/fixtures/`: `eventTime.js` ↔ `eventTime.ts` and `usTimeZones.js` ↔ `usTimeZones.ts`. The venue form has no time-zone input: the zone is derived from the address (`resolveVenueTimeZone`) and shown read-only by `VenueTimeZoneField`, with `TimeZoneSelect` behind **Change**. `Venue.timezoneSource` decides whether an address edit may re-derive — `MANUAL` never is, and an explicit `timezone: null` on a PATCH clears the override. `VenueService.defaultTimeZoneFor` is the one fallback point (spec 021 `Organization.timezone` plugs in there). Any new payload carrying an event date must carry the venue zone with it. See `docs/wiki/features/venue-time-zones.md`
28. RSVP ≠ Order. An RSVP event uses `EventRsvp` rows, never Orders. When a task touches `Event.admissionMode`, branch on it — never on `priceTiers.length === 0`. RSVPs never count in revenue, analytics or the tax report; the customers list default predicate still requires paid orders (the RSVP'd filter is separate). See `docs/wiki/features/rsvp-events.md`.

## Project workflow

Hermes Kanban is the operational project-management source of truth for Jump. Use [`docs/development/kanban-workflow.md`](docs/development/kanban-workflow.md) for the lifecycle: triage → specify/decompose → Claude Code implementation → PR review → merge → done. GitHub remains authoritative for diffs, CI, reviews, and merge records. A coding worker must return the PR URL/number, changed files, tests/results, migrations, commit SHA, and remaining risks before requesting review; local edits alone are never done.
