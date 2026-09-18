# Organization Onboarding (signup flow, Jump customer record, setup guide)

**Status:** Implemented — phases 1–3 (spec 022); phase 2 (billing) dark behind `BILLING_ENABLED`
**Last Updated:** 2026-09-18
**Spec / plan:** `specs/022-organization-onboarding/plan.md`
**Reference screenshots:** `docs/research/shopify-onboarding-subscribe.png`, `-survey.png`, `-setup-guide.png`

## Overview

The self-serve path from "signed in" to "has an organization". **Create organization** in the admin org switcher opens `/signup` in a new tab (Shopify-style); a signed-in user with no staff role (`UNASSIGNED`) who opens `/admin` is sent there too. The flow is name → subscribe (only with `BILLING_ENABLED`; skippable) → survey → done. Step 1 creates a **pending** `Organization` plus an ADMIN `OrganizationMember` for the caller; the survey (five ticketing-flavoured screens, all skippable) is stored on the organization's `PlatformCustomer`; **done** stamps `Organization.onboardingCompletedAt`, promotes the owner from `UNASSIGNED` to `ADMIN`, forces the session's JWT claims to refresh, tells the opener tab to refetch its organization list, and lands on `/admin/dashboard?org=<id>` where the **setup guide** card grid replaces the empty-state box.

`PlatformCustomer` is the *organization's relationship with Jump*: owner, plan (`FREE` or `STARTER`), the Stripe Billing customer and subscription **in Jump's own Stripe account** (never the organization's connected account), survey answers. It is not a `Contact` (those are the organization's own buyers) and not the Auth.js `Account` model.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | `PlatformCustomer`, `PlatformPlan`, `Organization.onboardingCompletedAt` (`@default(now())`, set to `null` only by the signup flow), `Organization.setupGuideDismissedAt` |
| `backend/src/config/onboarding.js` | Survey option ids (the allowlist), `APPLICATION_GOALS`, `MAX_PENDING_ORGANIZATIONS = 3`, `SIGNUP_SOURCES` |
| `backend/src/services/OnboardingService.js` | `start`, `current`, `getPending`, `saveSurvey`, `skipSurvey`, `skipSubscribe`, `complete`, `discard`; `stepFor(onboarding)` decides where a pending org resumes; `billingEnabled()` |
| `backend/src/api/routes/signup.js` | `/signup*` routes (any signed-in user) |
| `backend/src/services/SetupGuideService.js` + `routes/admin.js` | `GET|PATCH /admin/setup-guide` for `activeOrgFor(req)` |
| `backend/src/services/OrganizationService.js` | `listOrganizations` / `listOrganizationsForUser` hide pending orgs; `createOrganization(data, creatorUserId)` adds the creator as ADMIN member |
| `backend/src/middleware/scannerAuth.js`, `services/TicketService.js`, `routes/tickets.js` | Check-in scan/redeem scoped to the staff caller's organization (`scannerOrgScope`, `_inScope`) |
| `frontend/src/app/signup/*` | `layout.tsx` + `SignupGuard` (session required, `callbackUrl` back), `SignupShell` (dark stage, Skip / back), `page.tsx` (name + handle preview, resume), `[orgId]/subscribe` (trial ledger + embedded Checkout; 409 → survey), `[orgId]/subscribe/return` (confirms `?session_id`), `[orgId]/survey`, `[orgId]/done` |
| `backend/src/config/billing.js`, `services/BillingService.js` | `billingEnabled()` (needs `JUMP_STARTER_PRICE_ID`), `trialDays()`; `offer()` (Price cached 10 min), `createCheckout` (embedded, subscription mode, trial, `metadata.organizationId`), `confirmCheckout` (on return, idempotent), `statusFor`, `portalLink`, `isBillingEvent` / `handleEvent`, `subscriptionToRow` |
| `backend/src/api/routes/webhooks.js` | `POST /webhooks/stripe/billing` (`STRIPE_BILLING_WEBHOOK_SECRET`); the platform endpoint ignores billing events |
| `frontend/src/components/billing/EmbeddedCheckout.tsx`, `lib/billing.ts` | Mounts `stripe.initEmbeddedCheckout` with `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; plan types, `formatOfferPrice`, `SUBSCRIPTION_LABEL` |
| `frontend/src/app/admin/settings/plan/*`, `settings/SettingsNav.tsx` | Settings › **Plan** (`usePlanApi`): plan, status pill, trial end / renewal, **Start N-day free trial** (inline Checkout card), **Manage billing** (portal); nav entry only with `NEXT_PUBLIC_BILLING_ENABLED` |
| `frontend/src/app/admin/dashboard/PlanBanner.tsx` | `past_due` / `unpaid` banner → Settings › Plan |
| `backend/src/config/onboarding.js` `SEED_TEMPLATES`, `CHECKIN_GOAL`, `ABANDON_AFTER_MS` | Phase 3: the two starter form templates, the door-sales goal, the abandon threshold |
| `OnboardingService.seedTemplates / sweepAbandoned / funnel` | Phase 3: seed on complete (409 on a name clash = no-op), hourly sweep from `server.js` (`ONBOARDING_SWEEP_INTERVAL_MS`), SYSTEM_ADMIN funnel counts |
| `GET /organizations/onboarding/funnel`, `OrganizationService.listOrganizations({ withOnboarding })` | SYSTEM_ADMIN: started / completed / subscribed for 7 and 30 days + pending now; each org row carries `plan`, `subscriptionStatus`, `onboarding` (survey summary) |
| `frontend/src/app/admin/organizations/page.tsx` | Funnel card (SYSTEM_ADMIN), survey chips + plan pill per row |
| `frontend/src/lib/onboarding.ts` | Survey steps, labels, `visibleSteps(answers)`, `signupPathFor(org)` — ids mirror the backend config (contract test) |
| `frontend/src/lib/orgChannel.ts` | `announceOrganizationCreated` / `onOrganizationCreated`: `BroadcastChannel('jump-org')` + `localStorage` fallback |
| `frontend/src/services/signupService.ts` | API wrappers |
| `frontend/src/components/OrgSwitcher.tsx` | **Create organization** → `window.open('/signup?from_admin=1')` (falls back to same-tab navigation when blocked) |
| `frontend/src/components/OrgContext.tsx` | Honors `?org=<id>` on first load and cross-tab announcements: refetch + select the new org |
| `frontend/src/components/AdminRoute.tsx` | `UNASSIGNED` → `router.replace('/signup')` |
| `frontend/src/auth.ts` | `jwt` callback refreshes claims on `trigger === 'update'` (the done page calls `useSession().update()`) |
| `frontend/src/app/auth/signin/page.tsx` | Honors `?callbackUrl=` (same-origin paths only); footer link **Create your organization** |
| `frontend/src/app/admin/dashboard/SetupGuide.tsx` | The card grid; copy and inline SVG art live here |
| `frontend/src/app/admin/organizations/page.tsx` | SYSTEM_ADMIN list: `?includePending=1`, **Pending setup** pill, **Discard** |

## Configuration

| Variable | Notes |
|---|---|
| `BILLING_ENABLED` | `true` inserts the subscribe step and opens Settings › Plan; unset/false: the step is skipped and `POST /signup/:orgId/subscribe` returns 409. Requires `JUMP_STARTER_PRICE_ID` or it stays off (startup warning) |
| `JUMP_STARTER_PRICE_ID`, `BILLING_TRIAL_DAYS` (30), `STRIPE_BILLING_WEBHOOK_SECRET` | The STARTER Price in Jump's account, trial length, signing secret for `POST /webhooks/stripe/billing` |
| `NEXT_PUBLIC_BILLING_ENABLED`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Frontend: nav entry; Jump-account publishable key for embedded Checkout |
| `ONBOARDING_SWEEP_INTERVAL_MS` (1 h), `ONBOARDING_ABANDON_AFTER_MS` (7 d) | Phase 3 sweep: unfinished signups older than the threshold with no events and no subscription are deleted |

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/signup/current` | `{ organization: pending \| null, billingEnabled }` — newest pending org the caller administers |
| `POST` | `/signup` | `{ name, source?: 'admin'\|'public' }` → 201 pending org `{ id, name, slug, step, onboarding }`. 409 at 3 pending orgs |
| `GET` | `/signup/:orgId` | One pending org (404 once completed, or for non-members) |
| `PATCH` | `/signup/:orgId/survey` | Partial `{ goals?, eventTypes?, eventsPerYear?, attendance?, movingFrom? }`; ids validated against `config/onboarding.js` |
| `POST` | `/signup/:orgId/survey/skip`, `/subscribe/skip` | Record the decision in the onboarding JSON |
| `POST` | `/signup/:orgId/subscribe` | `{ clientSecret, sessionId, offer }` for embedded Checkout; 409 while billing is off or the org already has a subscription |
| `POST` | `/signup/:orgId/subscribe/confirm` | `{ sessionId }` → `{ subscribed, organization }`; records the subscription from the Checkout session (the webhook may lag) |
| `GET` | `/admin/settings/plan` | `{ enabled, plan, subscriptionStatus, trialEndsAt, currentPeriodEndsAt, hasSubscription, canManage, offer, canEdit }` |
| `POST` | `/admin/settings/plan/checkout`, `/confirm`, `/portal` | ADMIN: start the trial from Settings, confirm on return, Stripe customer portal URL |
| `POST` | `/webhooks/stripe/billing` | Subscription events → `PlatformCustomer` |
| `POST` | `/signup/:orgId/complete` | Stamps, upserts `PlatformCustomer`, promotes `UNASSIGNED → ADMIN`; idempotent; returns the org in the `GET /organizations` shape |
| `DELETE` | `/signup/:orgId` | Discard a pending org (cascade) |
| `GET` | `/admin/setup-guide` | `{ dismissedAt, tasks: [{ id, done, href, shown, state? }], onboarding: { goals } }` |
| `PATCH` | `/admin/setup-guide` | `{ dismissed: true }` |
| `GET` | `/organizations?includePending=1` | SYSTEM_ADMIN only: also lists pending orgs; SYSTEM_ADMIN rows carry `plan`, `subscriptionStatus`, `onboarding` (survey summary) |
| `GET` | `/organizations/onboarding/funnel` | SYSTEM_ADMIN: `{ windows: { 7: { started, completed, subscribed }, 30: … }, pending }` |

Setup-guide `done` rules: `event` = any event under the org's venues; `design` = brand colour, logo or non-SYSTEM theme; `payments` = Connect `active` when `STRIPE_CONNECT_ENABLED`, else `paymentSettingsUpdatedAt` set (`state` = `connect` / `platform` drives the card copy); `business` = `companyName` + `addressLine1`; `domain` = an ACTIVE `OrganizationDomain`; `applications` = any `ApplicationForm`, **shown** only when the survey goals include `vendor_applications` or `press_applications`; `checkin` (phase 3) = any REDEEMED ticket, **shown** only with the `sell_at_door` goal.

## How It Works

1. **Start.** `POST /signup` runs one transaction: `Organization { onboardingCompletedAt: null }`, `OrganizationMember { role: ADMIN }`, `PlatformCustomer { ownerUserId, onboarding: { version, source } }`. The slug comes from `OrganizationService.uniqueSlug`.
2. **Pending is invisible.** `GET /organizations` (both branches) filters `onboardingCompletedAt IS NOT NULL`, so the switcher never lists a half-finished org. `resolveOrgScope` still sees the membership, which is harmless: a brand-new user has no other membership, and an existing member's newer pending org is never auto-selected.
3. **Resume.** `/signup` calls `GET /signup/current` and redirects to `signupPathFor(org)`; `stepFor` returns `subscribe` only when billing is on and no decision was recorded, `survey` until skipped or completed, else `done`.
4. **Survey.** One screen per key; Continue PATCHes that key only; the fifth screen (moving-from) appears only when `move_platform` was chosen. Empty answers save `[]`.
5. **Done.** `complete` stamps `onboardingCompletedAt`, merges `surveyCompletedAt` unless the survey was skipped, and `updateMany({ role: 'UNASSIGNED' } → ADMIN)` — never a downgrade. The page then awaits `useSession().update()` (forces the claims refresh — without it the client keeps `UNASSIGNED` for up to 60 s and `AdminRoute` would bounce back to `/signup`), announces on the channel, and navigates to `/admin/dashboard?org=<id>`.
6. **Opener tab.** `OrgProvider` subscribes to the channel; on `org-created` it sets the preferred id, refetches, and selects the new organization.
7. **Subscribe (phase 2).** `stepFor` resumes at `subscribe` while billing is on and neither `subscribeSkippedAt` nor `subscribedAt` is set. `createCheckout` creates the Stripe customer once (`PlatformCustomer.stripeCustomerId`, `metadata.organizationId`), then an embedded Checkout session (`mode: subscription`, `trial_period_days`, `subscription_data.metadata.organizationId`, `return_url` = `/signup/:orgId/subscribe/return?session_id={CHECKOUT_SESSION_ID}`). The return page calls `confirm`, which retrieves the session, checks its `metadata.organizationId`, and mirrors the subscription (`subscriptionToRow`: `plan = STARTER` when the status is trialing/active/past_due/unpaid/incomplete and the price is the STARTER price, else `FREE`) plus `onboarding.subscribedAt`. Later changes (past due, cancel) arrive on the billing webhook and overwrite the mirror. Settings › Plan reuses the same Checkout with `return_url` back to the page. Nothing is gated on the plan.
8. **Tailoring (phase 3).** `complete` calls `seedTemplates` when the goals include an application goal: **Vendor booth** (PAID, two tiers, four questions, one pinned) and **Press & media** (FREE) are created through `ApplicationFormTemplateService.create`, so they pass the same validation as the editor; a name clash (re-run) is a silent no-op and a seed failure never fails the signup. `sell_at_door` adds the **Check tickets in at the door** card.
9. **Sweep (phase 3).** `sweepAbandoned` deletes pending organizations older than `ABANDON_AFTER_MS` that have no events and no `stripeSubscriptionId`, logging `organization_onboarding_abandoned` with the step reached. Started 45 s after boot, then every `ONBOARDING_SWEEP_INTERVAL_MS`.
10. **Funnel (phase 3).** "Started" = organizations that have a `PlatformCustomer` (created at step 1), "completed" = those with `onboardingCompletedAt` in the window, "subscribed" = those with a subscription id, plus `pending` now. Rendered on `/admin/organizations` for SYSTEM_ADMIN next to a survey summary per row (goals, event types, size, moving-from; "Survey skipped" when nothing was answered). Log events: `organization_onboarding_started` / `_step` / `_completed` / `_templates_seeded` / `_abandoned` / `_discarded`.
11. **Legacy create.** `POST /organizations` (ADMIN+, the SYSTEM_ADMIN Organizations page) now creates the membership for a non-SYSTEM_ADMIN caller and the org is onboarded at once (`@default(now())`).

## Check-in scope (fixed in this phase)

`POST /tickets/scan` and `POST /tickets/redeem` used to check only the role: staff of organization A could preview and redeem organization B's tickets. `scannerOrgScope(req)` now resolves the staff caller's organization (honouring `X-Jump-Org`), and `TicketService.lookupByBarcode / redeemByBarcode / redeemTicket` take `{ organizationId }` and answer `INVALID` (400) for a ticket outside it. Hardware readers (`X-Scanner-Key`) and `SYSTEM_ADMIN` stay unscoped; a staff user with no membership matches nothing. Per-organization scanner keys are a follow-up.

## Gotchas

- `onboardingCompletedAt` defaults to `now()`: only `OnboardingService.start` writes `null`. Direct `prisma.organization.create` in tests and seeds produces an onboarded org.
- `POST /organizations` now needs a real user for non-SYSTEM_ADMIN callers (membership FK). Contract tests must use `staffToken`, not a fabricated ADMIN JWT.
- `window.open(url, '_blank', 'noopener')` returns `null` even on success; the switcher severs `popup.opener` by hand so the fallback fires only when the popup is actually blocked.
- Playwright: the popup is a new page in the same context, so the session mock must be registered with `context.route`, and after `complete` the mocked `/api/auth/session` must report `ADMIN` (see `e2e/signup.spec.ts` `promoteSession`).
- Stripe.js: `EmbeddedCheckout` renders an error (`embedded-checkout-error`) instead of mounting when `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is unset — that is what the e2e tests assert; they never load js.stripe.com.
- `subscriptionToRow` compares the price id with `JUMP_STARTER_PRICE_ID`; a subscription on any other price mirrors as `FREE`.
- `useSession().update()` only works because `auth.ts` checks `trigger === 'update'`; do not remove that branch.
- SYSTEM_ADMIN can run `/signup` too (gets a membership like anyone; they see every org regardless).

## Tests

- `backend/tests/contract/signup.test.js` — flow, validation, cap, discard, SYSTEM_ADMIN, legacy create membership, frontend/backend option-id mirror, check-in scope.
- `frontend/e2e/signup.spec.ts` — name → survey → done, skip, conditional step, resume, signed-out redirect, switcher popup + opener refresh.
- `frontend/e2e/admin-setup-guide.spec.ts` — cards, done state, Connect vs platform copy, dismiss, all-done heading, 375 px.
- `frontend/e2e/admin-access.spec.ts` T106 — `UNASSIGNED` at `/admin` lands on `/signup`.
- `backend/tests/contract/billing.test.js` — off → 409 + step skipped; customer created once; Checkout params; confirm (open / complete / foreign session); already-subscribed 409; Plan status roles + portal; webhook mirror (updated, deleted by subscription id, unknown org); wrong-endpoint events ignored both ways.
- `backend/tests/contract/onboardingPhase3.test.js` — seeded templates (listed, no-op re-seed, validator), no seed without the goal, sweep keeps fresh / with-event / subscribed / completed orgs, funnel counts + 403, survey summary for SYSTEM_ADMIN only.
- `frontend/e2e/admin-organizations-onboarding.spec.ts` — funnel card, survey chips, plan pill, ADMIN sees none, check-in setup card.
- `frontend/e2e/billing.spec.ts` — subscribe ledger + Skip, billing-off redirect, return confirm (complete / open), Settings › Plan FREE → checkout card, STARTER status + portal, return notice, billing-off note, dashboard banner.

## Not built

`eventTypes` does not preselect an event category: the create-event form has no category field. Open decisions in the plan §9 (price, gating, promoting `ORGANIZER → ADMIN`). Launch steps for billing: `docs/wiki/config/production-launch-checklist.md` › Jump subscriptions.

## Related Features

- [Org Switcher](org-switcher.md) — `X-Jump-Org`, `activeOrgFor`, claims refresh
- [Multi-tenant Architecture](multi-tenant-architecture.md) — `Contact` vs `PlatformCustomer`, memberships
- [Payments Settings](payments-settings.md) — the `payments` card reads Connect status
- [Custom Domains](custom-domains.md), [Organization Branding](organization-branding.md), [Participants](participants.md) — the other cards
