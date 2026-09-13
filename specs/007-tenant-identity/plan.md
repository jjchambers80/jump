# Implementation Plan: Per-Organization Buyer Identity, Checkout Account Opt-In, and White-Label Custom Domains

**Branch**: `007-tenant-identity` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)
**Input**: "Organizations will point their own domain at Jump so they fully own the brand. Buyer accounts should be structurally associated with the organization so accounts at org A and org B stay separate. Checkout should offer a checkbox that automatically registers the buyer's account, checked by default unless that creates GDPR or liability exposure."

## Summary

Three deliverables, sequenced so each is independently shippable:

1. **Tenant-scoped identity foundation** — `Contact` becomes per-organization (`@@unique([organizationId, email])`), staff org affiliation moves to `OrganizationMember`. Pure data-model work; fixes the existing cross-org note/consent leak. Cheap now, expensive after custom domains exist.
2. **Checkout account opt-in + passwordless buyer login** — default-checked "Create an account" checkbox marks the org-scoped `Contact` as login-enabled; confirmation email carries a single-use magic link; buyer session is its own cookie, separate from staff Auth.js. Marketing consent becomes a separate, default-unchecked checkbox.
3. **Custom domains** — `OrganizationDomain` table, CNAME + TXT verification, host-to-org resolution in Next.js middleware, dynamic CORS, Stripe/email URL generation from the org's domain, optional per-org sending domain via Resend.

Staff never authenticate on custom domains, and buyer auth is Jump's own token flow rather than Auth.js, so no Auth.js multi-host configuration is needed at all.

## Technical Context

**Language/Version**: Node 20 (backend, ESM JavaScript), TypeScript 5.7 / Next.js 14 (frontend)
**New dependencies**: none required. Optional: `express-rate-limit` for the buyer login endpoint if not already present.
**Storage**: `Contact` +2 columns and a changed unique index; new `OrganizationMember`, `BuyerLoginToken`, `OrganizationDomain` tables; `User.organizationId` dropped in the final phase; `Contact.emailSubscribed` default flipped.
**Testing**: Jest unit tests for the backfill script and token service, supertest contract tests for buyer auth and tenant isolation, Playwright for checkout checkboxes and magic-link sign-in, dry-run of the backfill against a production snapshot.
**Constraints**: Magic-link tokens single-use, hashed at rest, 15-minute expiry for login and 7-day expiry for the post-purchase welcome link; rate limits on token issuance; no passwords; TLS per custom domain handled by Railway custom domains initially.
**Scale/Scope**: ~12 backend files, ~8 frontend files, 3 migrations + 1 backfill script, 1 email template change, 1 new admin settings page (domains).

## Constitution Check

| #    | Principle               | Applies? | Status | Notes |
| ---- | ----------------------- | -------- | ------ | ----- |
| I    | Single Source of Truth  | Yes      | PASS   | Org scoping derives from `Contact.organizationId` and `OrganizationMember`, not from joins through orders or from JWT claims alone |
| II   | API-First               | Yes      | PASS   | Buyer auth and domain routes documented in `contracts/` before implementation |
| III  | TDD                     | Yes      | PASS   | Isolation contract tests written first; backfill script has a unit test against fixture data |
| IV   | Transactional Integrity | Yes      | PASS   | Backfill runs per-contact in a transaction; checkout upsert stays inside the existing order transaction |
| V    | RBAC                    | Yes      | PASS   | `resolveOrgScope` remains the single chokepoint; buyer session is a distinct principal type that can never reach admin routes |
| VI   | Real-Time Sync          | No       | N/A    | |
| VII  | MVP Simplicity          | Yes      | PASS   | Phase 1 has no UI beyond a schema change; phase 2 adds two checkboxes and one email link; custom domains are last |
| VIII | Living Documentation    | Yes      | PASS   | `AGENTS.md` tenancy section, `docs/wiki/features/tenant-identity.md` via `/doc-feature` |

## Current-State Facts That Shape the Plan

- `backend/src/services/OrderService.js:146` upserts `Contact` by global email inside the checkout transaction. This is the one write path for buyers.
- `backend/src/middleware/orgScope.js` `resolveOrgScope(userId, role)` reads `User.organizationId`. Five files consume the result or the column directly: `api/routes/venues.js`, `api/routes/tierPresets.js`, `api/routes/organizations.js`, `services/UserService.js`, `services/OrganizationService.js`.
- `backend/src/services/CustomerService.js` scopes contacts by joining `orders -> event -> venue -> organizationId`. `note` and `emailSubscribed` are returned unscoped.
- `backend/src/api/routes/orders.js:65` `getMyOrders(req.user.email)` authorizes buyer order history by email equality against the Auth.js `User`. This is the only buyer "account" surface today.
- `frontend/src/app/checkout/[eventId]/page.tsx` collects `firstName`, `lastName`, `email`. No consent checkbox. `Contact.emailSubscribed` defaults `true`.
- `Organization` has `name` and `nickname`, no `slug` and no domain fields. Public org page is `/organizations/[orgId]`.
- `frontend/src/auth.ts` session callback mints a backend `accessToken` JWT with `AUTH_SECRET`; role is in the token, organization is not.

## Phases

### Phase 1 — Tenant-scoped identity foundation (schema + backfill, no UI)

**Data model** (`packages/db/prisma/schema.prisma`):

```prisma
model Contact {
  id               String    @id @default(cuid())
  organizationId   String
  email            String
  firstName        String
  lastName         String
  location         String?
  note             String?
  emailSubscribed  Boolean   @default(false)   // was true; see D5
  accountCreatedAt DateTime?                   // null = guest, set = login-enabled (phase 2)
  userId           String?                     // legacy link, dropped in phase 4
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  organization     Organization @relation(fields: [organizationId], references: [id])
  user             User?     @relation(fields: [userId], references: [id], onDelete: SetNull)
  orders           Order[]
  tickets          Ticket[]

  @@unique([organizationId, email])
  @@index([email])
  @@index([userId])
}

model OrganizationMember {
  id             String       @id @default(cuid())
  userId         String
  organizationId String
  role           MemberRole   // ADMIN | ORGANIZER
  createdAt      DateTime     @default(now())

  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])
  @@index([organizationId])
}

enum MemberRole {
  ADMIN
  ORGANIZER
}
```

`User.role` keeps `SYSTEM_ADMIN` and `CUSTOMER` for now; `ADMIN`/`ORGANIZER` semantics move to `OrganizationMember.role`. `User.organizationId` stays nullable and unused after this phase, dropped in phase 4.

**Migration** — implemented 2026-09-13 as **one SQL migration**, `20260913000000_contact_per_org_and_membership`, not the three-step script plan originally written here. Reason: Railway runs `prisma migrate deploy` at container start, so a manual backfill script between two migrations would leave a window where the NOT NULL migration fails and the backend crash-loops (the P3009 incident of 2026-09-12). Prisma wraps a Postgres migration in one transaction, so the single file is all-or-nothing:

1. Create `MemberRole` + `OrganizationMember`; copy every ADMIN/ORGANIZER `User.organizationId` into a membership row.
2. Add `Contact.organizationId` (nullable), `Contact.accountCreatedAt`; flip `emailSubscribed` default to `false`.
3. Backfill: per contact, collect distinct orgs across **all** orders (any status) via `order.event.venue.organizationId`. Primary org = earliest order; the existing row keeps its id. Contacts with zero orders are deleted (nothing references them). Drop the global `Contact_email_key`, insert one clone per additional org (`note`/`emailSubscribed` copied since they cannot be attributed), repoint `Order.contactId` by org, then `Ticket.contactId = order.contactId`.
4. `DO $$` guard raises (rolling everything back) if any contact is unscoped, any order points at a contact of another org, or any ticket disagrees with its order.
5. `organizationId` NOT NULL, unique `(organizationId, email)`, FK to `Organization`.

Rehearsed against a `pg_dump` of the dev DB plus a fixture with a second org, a buyer with orders at both, and a buyer whose first order was at the second org. Verified: correct primary selection, order/ticket repointing, membership copy, zero-order deletion, default flip.

**Deploy runbook**: take a Railway DB backup, deploy; if the migration raises, the DB is unchanged and the container will crash-loop on P3009 — run `prisma migrate resolve --rolled-back 20260913000000_contact_per_org_and_membership` and redeploy the previous image. No manual step is required on success.

**Backend changes**:

- `OrderService.createCheckoutSession`: upsert by `{ organizationId_email: { organizationId, email } }`. `organizationId` derived from the event's venue inside the same transaction (already loaded for capacity checks).
- `orgScope.resolveOrgScope(userId, role, activeOrgId?)`: SYSTEM_ADMIN unchanged. Also exports `requireOrgMembership(param)`, which replaced three duplicated `verifyOrgOwnership` guards in `venues.js`, `tierPresets.js`, `organizations.js`, and `resolveActiveMembership`, used by `OrganizationService` and `OrganizationPersonService`. Otherwise read `OrganizationMember` for `userId`; if `activeOrgId` provided and a membership exists, use it; else first membership by `createdAt`. Return shape unchanged so the five consumers need no edits beyond `UserService`/`OrganizationService`, which write `User.organizationId` on org creation and must write a membership row instead.
- `CustomerService`: filter `Contact.organizationId = scope.organizationId` directly; remove the join-through-orders filter. `note` and `emailSubscribed` are now correct by construction.
- `rbac.js` gates on `req.user.role` from the JWT claim, so no change there; instead the backend `auth.js` middleware and the frontend `auth.ts` JWT callback resolve `role` as `SYSTEM_ADMIN` from `User.role`, otherwise the `OrganizationMember.role` for the active org. `requireRole('ADMIN')` keeps working unchanged.
- `packages/db/prisma/seed.ts` creates two contacts directly (`seed.ts:246`, `:255`); add `organizationId` and create membership rows for the seeded ADMIN/ORGANIZER users.
- `frontend/src/auth.ts`: JWT callback adds `organizationId` (first membership) and `orgRole`; session exposes both. Org switcher UI is deferred to phase 3 unless a multi-org user exists sooner.

**Tests**:

- Unit: backfill script against fixtures covering 1-org, 3-org, and pending-only contacts; asserts order/ticket repointing and idempotency.
- Contract: `GET /customers` as org A ADMIN returns no row, note, or consent flag for an email that only bought at org B; the same email at both orgs returns two distinct rows to SYSTEM_ADMIN.
- Contract: every existing admin route contract test passes unchanged for a single-membership user.

**Status (2026-09-13)**: implemented on branch `worktree-plan-tenant-identity`. `tests/contract/tenantIsolation.test.js` (13 tests) covers schema uniqueness, customer list/detail/patch isolation, membership guards, JWT org claim, legacy-column independence, and the composite-key checkout upsert. Existing `organizations`, `organizationPeople`, `users` contract suites and the `organizationService`/`organizationPersonService` unit suites pass. `analytics`, `tickets`, `qrGeneration` suites were already failing before this work (they sign JWTs for users that do not exist in the DB); their contact fixtures were updated to the new shape but they remain red for that unrelated reason.

### Phase 2 — Checkout account opt-in + passwordless buyer login

**Data model**:

```prisma
model BuyerLoginToken {
  id             String    @id @default(cuid())
  contactId      String
  organizationId String
  tokenHash      String    @unique      // sha256(base64url(32 random bytes))
  purpose        BuyerTokenPurpose      // WELCOME | LOGIN
  expiresAt      DateTime
  usedAt         DateTime?
  createdAt      DateTime  @default(now())

  contact        Contact   @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@index([contactId])
  @@index([expiresAt])
}

enum BuyerTokenPurpose {
  WELCOME   // issued at purchase when the account box was checked; 7-day expiry
  LOGIN     // issued on request from the storefront; 15-minute expiry
}
```

**Checkout UI** (`frontend/src/app/checkout/[eventId]/page.tsx`):

- Checkbox A, **default checked**: "Create an account with `<Org name>` to manage your tickets." Helper text: "No password. We'll email you a sign-in link."
- Checkbox B, **default unchecked**: "Email me about future events from `<Org name>`."
- Both posted as `createAccount` and `emailSubscribed` booleans. Neither implies the other. Copy uses `Organization.name`.

**Backend**:

- `OrderService.createCheckoutSession`: accept `createAccount`, `emailSubscribed`. On upsert, `accountCreatedAt: createAccount ? (existing ?? now) : existing`, `emailSubscribed` set only if `true` on this request (never flip an existing `true` to `false` from checkout; unsubscribe is its own flow).
- `BuyerAuthService` (new, `backend/src/services/BuyerAuthService.js`):
  - `issueToken(contactId, purpose)` — random token, store hash, return raw token once.
  - `consumeToken(rawToken)` — hash, lookup, check `usedAt IS NULL AND expiresAt > now()`, mark used in the same transaction, return `{ contactId, organizationId }`.
  - `signSession({ contactId, organizationId })` — JWT with `AUTH_SECRET`, `typ: 'buyer'`, 30-day expiry.
  - `verifySession(jwt)` — rejects staff tokens (no `typ: 'buyer'`).
- Routes (`backend/src/api/routes/buyerAuth.js`, mounted at `/buyer`):
  - `POST /buyer/auth/request` `{ organizationId, email }` — always 202. If a login-enabled contact exists, issue LOGIN token and email the link. Rate limit: 3 per email per 15 min, 20 per IP per hour.
  - `POST /buyer/auth/verify` `{ token }` — consume, return session JWT.
  - `GET /buyer/me/orders`, `GET /buyer/me/tickets` — authorize by buyer session `contactId`; replaces `getMyOrders(req.user.email)` for buyers.
- `buyerAuth` middleware — separate from `auth.js`; sets `req.buyer = { contactId, organizationId }`. Admin routes never accept it.
- Stripe webhook completion handler: if `contact.accountCreatedAt` is set and no WELCOME token has been issued for this order, issue one and pass the URL to the confirmation email.
- `EmailService` confirmation template: when a WELCOME link is present, add a "Manage your tickets" button. Otherwise unchanged (guest lookup link).

**Frontend**:

- Next route handlers `frontend/src/app/api/buyer/*` proxy the three buyer auth calls and set/clear an `httpOnly`, `SameSite=Lax`, `Secure` cookie `jump_buyer`. Keeping the cookie first-party is what makes phase 3 custom domains work without cross-site cookies.
- `/organizations/[orgId]/account` (storefront account page): email form to request a link, orders and tickets list once signed in. `/organizations/[orgId]/account/verify?token=...` consumes the token.
- Existing `/my-orders` (Auth.js) stays for staff-who-are-also-buyers until phase 4.

**Tests**:

- Unit: token hashing, single-use, expiry, purpose-specific TTLs, staff JWT rejected by `verifySession`.
- Contract: request endpoint returns 202 for unknown email and issues nothing; rate limit trips; `GET /buyer/me/orders` with an org A session never returns org B orders for the same email.
- Playwright: checkout with box checked, complete Stripe test payment, read the WELCOME token via a test-only `GET /__test/buyer-token?email=` route enabled when `NODE_ENV=test` (no mail capture exists today; `backend/tests/setup.js` only stubs `RESEND_API_KEY`), follow link, land on account page with the order visible; repeat with box unchecked and confirm no account link in email.

**Status (2026-09-13)**: implemented on branch `worktree-plan-tenant-identity`. Deviations from the sketch above: per-email rate limiting is a count over `BuyerLoginToken` rows (3 LOGIN tokens per 15 min), per-IP is `express-rate-limit` (20/hour) with `trust proxy = 1` in production; `GET /buyer/me` added for the account page; `getMyOrders`/`getMyTickets` were refactored into shared `listOrders`/`listTickets` helpers rather than removed (removal is phase 4). Tests: `tests/unit/buyerAuthService.test.js` (14) and `tests/contract/buyerAuth.test.js` (17) green, the latter driving the real webhook completion path and reading the welcome token out of the mocked Resend payload. The cookie round-trip through the Next route handlers and both pages were smoke-tested in a browser against a seeded DB (verify link → account page with orders/tickets; checkout shows account box pre-checked and marketing unchecked). No Playwright spec was added; the existing Playwright harness has pre-existing type errors.

**Post-review fixes (2026-09-13)**: (1) opt-ins are recorded on `Order.optInAccount` / `Order.optInMarketing` and applied to the Contact only in `PaymentService.handleCheckoutCompleted`, so an abandoned or forged checkout cannot create an account or consent for someone else's email; (2) `/admin/customers*` apply the same no-membership guard as other admin routes (org-less staff see nothing, not every org); (3) the per-IP limiter keys on `X-Jump-Client-Ip` signed with `AUTH_SECRET` by the Next proxy (`clientIpForRateLimit`), since `req.ip` behind the proxy was one address for all buyers and `X-Forwarded-For` would be spoofable at the required hop depth; (4) `consumeToken` claims and loads in one transaction; (5) memberships exist only for ADMIN/ORGANIZER and are cleared on demotion; (6) attendee email edits lowercase and return 409 on a per-org collision; (7) login-email log carries `contactId`, not the address.

**Exit criteria**: buyer can complete scenario 2 and 3 from the spec end to end on the Jump domain — met.

### Phase 3 — Custom domains

**Data model**:

```prisma
model OrganizationDomain {
  id                String       @id @default(cuid())
  organizationId    String
  hostname          String       @unique       // lowercased, no scheme, no path
  status            DomainStatus @default(PENDING)
  verificationToken String                     // value for TXT _jump-verify.<hostname>
  isPrimary         Boolean      @default(false)
  verifiedAt        DateTime?
  lastCheckedAt     DateTime?
  createdAt         DateTime     @default(now())

  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
}

enum DomainStatus {
  PENDING     // records shown, not yet verified
  VERIFIED    // TXT + CNAME resolve; TLS being provisioned
  ACTIVE      // serving
  FAILED      // verification lapsed; keep serving for 72h grace then PENDING
}
```

Optional `Organization.emailFromDomain String?` + `emailFromVerifiedAt DateTime?` for per-org sending domain.

**DNS contract shown to the org** (Settings > Domains, new admin page):

```
CNAME  tickets.example.com            ->  storefront.<jump-domain>
TXT    _jump-verify.tickets.example.com   "jump-verify=<verificationToken>"
```

Verification job (`backend/src/jobs/verifyDomains.js`, cron every 10 min, plus "Verify now" button): `dns.resolveTxt` for the token and `dns.resolveCname` for the target. On success, attach the domain to the frontend service via Railway's GraphQL API (`customDomainCreate`) so Railway issues the certificate, then mark ACTIVE once Railway reports the cert. Re-check daily; after 72 h of failure mark FAILED.

**Host resolution**:

- `frontend/middleware.ts` (exists today for Auth.js route protection): if `host` is not a Jump domain, look up `OrganizationDomain` (edge-safe via a backend `GET /domains/resolve?host=` call cached 60 s in memory). Rewrite `/` and storefront paths to `/organizations/[orgId]/...`; return 404 for `/admin`, `/auth`, `/api/auth`. Set `x-jump-org-id` header for server components.
- Storefront pages (`/organizations/[orgId]`, `/events/[eventId]`, `/checkout/[eventId]`, `/confirmation`, `/organizations/[orgId]/account`) read org from the header when present and hide the Jump chrome (org brand color, logo, and theme mode already exist from specs 002 and the brand-color work).
- Backend CORS (`backend/src/api/server.js:51`): replace the static origin with a function that allows the Jump frontend origin plus any `ACTIVE` `OrganizationDomain` hostname (cached 60 s). Buyer cookie stays first-party because buyer calls go through Next route handlers.
- URL generation: `EmailService` and Stripe `success_url`/`cancel_url` use a new `storefrontBaseUrl(organizationId)` helper: primary ACTIVE domain if any, else the Jump frontend URL. Stripe redirects to the custom host work without extra configuration because they are plain redirects.

**Per-org sending domain** (optional, same settings page):

- Org enters `example.com`; backend calls Resend `POST /domains`, shows returned DKIM/SPF records, polls status. Once verified, confirmation and login emails send from `tickets@example.com` with `reply-to` the org's contact email. Until then, send from the Jump domain with display name `<Org name> via Jump`.

**Tests**:

- Unit: hostname normalization, DNS verification against a mocked resolver, `storefrontBaseUrl` fallback order.
- Contract: `GET /domains/resolve` for unknown host returns 404; admin routes on a custom host return 404 via middleware test.
- Manual: real domain end to end on Railway staging, including certificate issuance time and the buyer magic link round-trip on the custom host.

**Status (2026-09-13)**: implemented on branch `feat/007-custom-domains`. Deviations from the sketch above:
- `OrganizationDomain` also carries `cnameTarget`, `railwayDomainId`, `failingSince`, `lastError`. Hostnames must be subdomains (no apex; CNAME cannot live at an apex on most providers).
- Railway integration is optional (`lib/railwayDomains.js`, gated on `RAILWAY_API_TOKEN` + `RAILWAY_FRONTEND_SERVICE_ID`). Without it a DNS-verified domain goes straight to ACTIVE and the operator attaches it in the Railway dashboard for TLS. The GraphQL field names in that client were written from Railway's public schema and have not been exercised against a live token yet.
- Verification sweep is an in-process `setInterval` in `server.js` (10 min; active domains re-checked daily), not a separate cron. 72h grace before FAILED.
- Host resolution: `frontend/src/middleware.ts` calls `GET /domains/resolve` (60s cache on both sides). Middleware had to move into `src/` — the root `frontend/middleware.ts` was never loaded by Next in this layout, so the Auth.js protection it contained never ran. The new middleware does tenant routing only; staff protection stays client-side because `auth.config.ts` cannot decode the custom HS256 session cookie on the edge.
- `/orders/:id` now accepts a buyer session (needed on custom hosts where there is no staff sign-in); `ProtectedRoute` remains the fallback.
- Storefront URL helpers are async and per organization; on a custom host the org page is `/` and the account page `/account`.
- Per-org Resend sending domain: **not implemented** (emails still send from `RESEND_FROM_EMAIL`). Deferred to a follow-up.
- Cross-org event URLs on a tenant host (`tickets.a.com/events/<org-b-event>`) render org B's public event; the page is public anyway on the platform host. Tightening this needs the event page to compare `organizationId` with the tenant header — follow-up.

Tests: `tests/unit/domainService.test.js` (15), `tests/contract/domains.test.js` (10, DNS stubbed via `domainService._dns`), `frontend/tests/unit/storefrontHost.test.ts` (11). Smoke: tenant routing via spoofed `Host` header (root/account/admin/auth/other-org/unknown-host), CORS preflight from a tenant origin, Settings › Domains add + verify in a browser.

**Exit criteria**: scenario 8 in the spec passes on a real domain; buyer login works on that host; no admin surface reachable from it — routing, resolution, CORS, and URL generation verified locally; a real domain + Railway certificate still needs a live run.

### Phase 4 — Cleanup

- Drop `User.organizationId`, `Contact.userId`, and the `CUSTOMER` value from `UserRole` (after confirming no `User` rows depend on it).
- Remove `getMyOrders(email)` and `/my-orders`; staff who buy tickets use the buyer flow like everyone else.
- Org switcher in the admin shell if not already shipped; `activeOrgId` persisted in the Auth.js JWT via a `POST /auth/switch-org` route.
- `/doc-feature` for `docs/wiki/features/tenant-identity.md` and `custom-domains.md`; `AGENTS.md` gains a "Tenancy" section stating: buyers are `Contact` scoped by org, staff are `User` + `OrganizationMember`, never query `Contact` without `organizationId`.

## Project Structure

```
packages/db/prisma/schema.prisma
packages/db/prisma/migrations/2026XXXX_add_contact_org_and_membership/
packages/db/prisma/migrations/2026XXXX_contact_org_not_null_composite_unique/
packages/db/scripts/backfill-contact-org.js

backend/src/services/BuyerAuthService.js          (new)
backend/src/services/OrderService.js               (upsert key, createAccount, emailSubscribed)
backend/src/services/CustomerService.js            (direct org filter)
backend/src/services/UserService.js                (membership writes)
backend/src/services/OrganizationService.js        (membership writes)
backend/src/services/EmailService.js               (welcome link, storefrontBaseUrl)
backend/src/middleware/orgScope.js                 (membership-based)
backend/src/middleware/rbac.js                     (membership role)
backend/src/middleware/buyerAuth.js                (new)
backend/src/api/routes/buyerAuth.js                (new)
backend/src/api/routes/domains.js                  (new, phase 3)
backend/src/jobs/verifyDomains.js                  (new, phase 3)
backend/src/lib/storefrontUrl.js                   (new, phase 3)
backend/tests/contract/tenant-isolation.test.js    (new)
backend/tests/contract/buyer-auth.test.js          (new)
backend/tests/unit/backfill-contact-org.test.js    (new)

frontend/src/auth.ts                               (organizationId + orgRole in JWT)
frontend/middleware.ts                             (host resolution, phase 3)
frontend/src/app/checkout/[eventId]/page.tsx       (two checkboxes)
frontend/src/app/api/buyer/*/route.ts              (new, cookie proxy)
frontend/src/app/organizations/[orgId]/account/    (new)
frontend/src/app/admin/settings/domains/           (new, phase 3)

specs/007-tenant-identity/contracts/buyer-auth.yaml
specs/007-tenant-identity/contracts/domains.yaml
```

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Backfill splits a contact incorrectly or orphans orders | Data loss in customer history | Script-based (not SQL) with dry-run, per-contact transaction, reconciliation counts, tested against production snapshot before Railway run; migration 1.3 refuses to apply if any `Contact.organizationId IS NULL` |
| Railway P3009-style failed migration crash loop (seen 2026-09-12) | Backend down | Three small migrations; 1.2 is a script outside `prisma migrate`; runbook in wiki |
| Pre-checked account box challenged under GDPR | Compliance | Box creates only the account and triggers only transactional email; marketing is separate and unchecked; copy reviewed; keep the decision rationale (Art. 6(1)(b)) in the vault note |
| Magic-link endpoint abused for email bombing or enumeration | Abuse, deliverability | Always 202; rate limit per email and IP; tokens hashed; 15-min TTL |
| Buyer cookie on custom domains | Auth breaks cross-site | Cookie set by Next route handler on the same host; backend never sets buyer cookies |
| Railway custom-domain limits or slow cert issuance | Onboarding friction | Status shown in settings; Cloudflare for SaaS as the scale path once past a few dozen domains |
| Emails from org domain land in spam before DKIM verifies | Deliverability | Send from Jump domain with org display name until Resend reports verified |
| Stripe Checkout `success_url` on a host that later loses its domain | Broken redirect | `storefrontBaseUrl` falls back to Jump domain when no ACTIVE domain; 72 h grace before FAILED |
| Multi-org staff hit code paths that assume one org | Wrong data shown | `resolveOrgScope` remains the sole scoping entry point; contract tests run with a two-membership fixture |

## Recommended Sequencing

1. **Phase 1 now-ish, regardless of when custom domains ship.** It fixes a live cross-org data leak and gets cheaper the fewer contacts exist.
2. **Phase 2 immediately after.** Small UI surface, clear buyer value, exercises the per-org model before any domain work.
3. **Phase 3 when the first org asks for it.** Everything before it is domain-agnostic by design.
4. **Phase 4 after phase 3 has been in production for a release.**

Nothing here blocks or is blocked by the wallet passes work (spec 006); the wallet token model is per-ticket and unaffected by contact scoping.
