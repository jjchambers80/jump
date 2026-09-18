# Implementation Plan: Organization onboarding (spec 022)

**Status**: Planned 2026-09-18. Phase 1 built 2026-09-18 (`feat/022-onboarding-phase-1`); phases 2–3 not built. Phase 1 deviations: the `PlatformCustomer` row is created at step 1 (with `source`) rather than lazily at survey/complete, so there is one write path; `Organization.onboardingCompletedAt` defaults to `now()` and only the signup flow writes `null`; there is no Navbar **Start selling** link because `Navbar.tsx` is not rendered anywhere — the sign-in page carries a **Create your organization** link instead.
**Input**: Organizer request 2026-09-18 (session [01158zLwVnUE4g159VJBFE7w](https://claude.ai/code/session_01158zLwVnUE4g159VJBFE7w)): clicking **Create organization** in the org switcher opens a new tab with a Shopify-style flow — a subscription screen (skippable), a short survey adjusted to ticketing and event management (skippable), a **Jump customer record** separate from the organization's own customer records, then the new organization in the switcher and an empty dashboard that prompts the organizer to create an event, choose a store design, and so on.
**Reference screenshots** (Shopify admin, captured 2026-09-18): `docs/research/shopify-onboarding-subscribe.png` (`/signup/<id>/subscribe/checkout?from_admin=true`), `docs/research/shopify-onboarding-survey.png` ("What can we help you do?"), `docs/research/shopify-onboarding-setup-guide.png` (empty-dashboard setup cards).
**Builds on**: spec 007 (`OrganizationMember`, `X-Jump-Org`, org switcher), spec 008 (Domains), spec 010 (Payments / Stripe Connect), spec 011 (application forms), the uncommitted 2026-09-18 **Online store** work (`Organization.slug`, `/admin/online-store`, `OnlineStoreSettings`), and the 2026-09-15 organizer interview (`docs/research/2026-09-15-eventeny-organizer-interview.md`) for pricing intelligence.
**Supersedes**: spec 005 User Story 2 (modal onboarding wizard) and FR-009 (one organization per account). Spec 005 was never implemented; the multi-org switcher shipped in spec 007 and this plan keeps it.
**Branches**: plan on `plan/022-organization-onboarding`; phases on `feat/022-onboarding-phase-1` → `-phase-2` → `-phase-3`, each merged to `main` alone (spec 012 lesson: never merge a phase branch that contains an unmerged earlier phase). The Online store working-tree changes must land before phase 1 branches (they add `Organization.slug`, which the signup flow shows).

---

## 0. What the codebase does today (and why the flow cannot be bolted on)

| Fact | Where | Consequence |
|---|---|---|
| `POST /organizations` requires `ADMIN` or `SYSTEM_ADMIN`, and creates the row **without** an `OrganizationMember` for the caller | `routes/organizations.js:26`, `OrganizationService.createOrganization` | An ADMIN who creates a second org from the switcher never sees it (the switcher lists memberships). Only SYSTEM_ADMIN (lists every org) sees it. This is the bug the user hit on 2026-09-18 (claude-mem S631). |
| New users are `UNASSIGNED` and `AdminRoute` shows **Access Denied** for them | `schema.prisma` `User.role @default(UNASSIGNED)`, `AdminRoute.tsx` | There is no self-serve path from "signed in" to "has an organization". Staff are promoted by hand in Settings › Users. |
| The JWT carries `role` and `organizationId`; claims are re-read from the DB at most every 60 s (`CLAIMS_REFRESH_MS`) | `auth.ts` `jwt` callback, `lib/sessionClaims.ts` | Promoting a user during onboarding does not reach the client for up to a minute; the `jwt` callback ignores `trigger === 'update'`, so `useSession().update()` cannot force it. |
| The switcher's **Create organization** is an inline form (name → `POST /organizations` → `refresh()`) | `OrgSwitcher.tsx` `handleCreate` | Replaced by a new-tab link to `/signup`. |
| `OrgProvider` fetches `GET /organizations` once on mount | `OrgContext.tsx` | The original tab needs a signal to re-fetch when the new tab finishes. |
| Buyers and applicants are `Contact` rows scoped to one organization | `schema.prisma` `Contact @@unique([organizationId, email])` | These are the *organization's* customers. The Jump customer record this plan adds is a different thing and must not reuse `Contact` or the Auth.js `Account` model (already taken by Auth.js). |
| Stripe: platform account, hosted Checkout for orders, `stripe` v17 on the backend, `@stripe/stripe-js` on the frontend, no Elements integration | `config/stripe.js`, `OrderService`, `PaymentForm.tsx` (email only) | A subscription screen can use Stripe Checkout in **embedded** mode without introducing Elements. Webhook endpoint `POST /webhooks/stripe` dispatches on `metadata`. |
| Revenue today is the 5 % platform fee on tickets (`config/fees.js`); there is no plan or subscription concept anywhere | `FeeService` | Pricing for a subscription is an open decision (§9). The subscribe step ships dark behind a flag, like Connect and application payments. |
| Dashboard empty state is one "No events yet — Create Event" box | `admin/dashboard/page.tsx` | Replaced by the setup guide when the org is new. |
| Env-flag pattern for dark features | `STRIPE_CONNECT_ENABLED`, `APPLICATIONS_PAYMENTS_ENABLED` | `BILLING_ENABLED` follows it. |

---

## 1. Vocabulary

- **Organization** — the tenant (unchanged).
- **Jump customer** — the person/company that owns an organization's relationship with Jump: who signed up, what plan they are on, their Stripe *Billing* customer, and what they told us in the survey. New model `PlatformCustomer` (§3.1). "Platform" makes the scope obvious next to `Contact` (the organization's customers) and avoids the Auth.js `Account` name. Never shown to organizers as "customer"; the UI says **Your Jump account** / **Plan**.
- **Onboarding** — the `/signup` flow: name → subscribe → survey → done.
- **Setup guide** — the card grid on an empty dashboard (screenshot 3).

---

## 2. Flow

```
Org switcher › Create organization        UNASSIGNED user opens /admin        Navbar › Start selling (signed out)
        │ window.open('/signup?from_admin=1')      │ redirect                        │ /auth/signin?callbackUrl=/signup
        ▼                                          ▼                                 ▼
/signup                 ── name + handle preview ──►  POST /signup            (creates Organization[pending] + OrganizationMember ADMIN)
/signup/[orgId]/subscribe  (only when BILLING_ENABLED; Skip top-right)  ──► embedded Stripe Checkout, subscription mode, trial
/signup/[orgId]/survey     3–5 steps, Continue / ← / Skip                   ──► PATCH answers per step
/signup/[orgId]/done       POST /signup/:orgId/complete                     ──► PlatformCustomer upserted, onboardingCompletedAt set,
                                                                                 User.role UNASSIGNED → ADMIN, session refreshed
        │
        ▼
/admin?org=<orgId>   OrgProvider selects the new org; dashboard renders the setup guide.
Original tab: BroadcastChannel('jump-org') message → OrgProvider.refresh() → new org appears in the switcher.
```

Resume: `GET /signup/current` returns the caller's newest pending organization (one they are a member of, `onboardingCompletedAt IS NULL`). `/signup` redirects to that org's current step (`subscribe` if billing is on and no decision was recorded, else `survey`). A pending org is never listed by `GET /organizations`, so an abandoned signup does not pollute the switcher; phase 3 sweeps pending orgs older than 7 days that have no events.

The subscribe step and the survey are both skippable with one click. Skipping records the decision (`subscribeSkippedAt` / `surveySkippedAt` in the onboarding JSON) so resume does not re-ask.

---

## 3. Data model

### 3.1 `PlatformCustomer` (new)

```prisma
// Spec 022: the organization's relationship with Jump — who signed up, which
// plan, the Stripe Billing customer, and onboarding survey answers. Distinct
// from Contact (the organization's own buyers/applicants) and from the Auth.js
// Account model. One row per organization, created when onboarding completes
// or when the organizer starts a subscription, whichever comes first.
model PlatformCustomer {
  id                    String             @id @default(cuid())
  organizationId        String             @unique
  ownerUserId           String
  plan                  PlatformPlan       @default(FREE)
  stripeCustomerId      String?            @unique   // Stripe Billing customer on the platform account
  stripeSubscriptionId  String?            @unique
  subscriptionStatus    String?                      // mirror of Stripe: trialing | active | past_due | canceled | incomplete
  trialEndsAt           DateTime?
  currentPeriodEndsAt   DateTime?
  onboarding            Json?                        // { version: 1, goals: [], eventTypes: [], eventsPerYear, attendance, movingFrom, surveySkippedAt, subscribeSkippedAt, source: 'admin'|'public' }
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  owner        User         @relation(fields: [ownerUserId], references: [id])

  @@index([ownerUserId])
}

enum PlatformPlan {
  FREE      // no subscription; platform fee only (today's model)
  STARTER   // phase 2: the single paid plan; price id from JUMP_STARTER_PRICE_ID
}
```

`Organization` gains:

```prisma
  // Spec 022: null until the /signup flow finishes; pending orgs are hidden
  // from the switcher and swept if abandoned.
  onboardingCompletedAt DateTime?
  // Spec 022: organizer dismissed the dashboard setup guide.
  setupGuideDismissedAt DateTime?
  platformCustomer      PlatformCustomer?
```

`User` gains `platformCustomers PlatformCustomer[]`.

Migration `20260926100000_organization_onboarding`: adds the columns and table; backfills `onboardingCompletedAt = createdAt` for every existing organization so nothing disappears from the switcher on deploy. No `PlatformCustomer` rows are backfilled — existing orgs are `FREE` by absence, and the Plan page (phase 2) treats a missing row as FREE.

### 3.2 Why the organization row is created at step 1, not at the end

The user's description has the record created "once this information is collected". The organization itself must exist first: the Shopify URL carries the store id from the subscribe step onward, the Stripe Checkout session needs an id in `metadata` to attach the subscription to, and resume needs somewhere to store progress. So: `Organization` (pending) + `OrganizationMember` at step 1; **`PlatformCustomer` at completion** (or at subscribe, upserted). The organization is invisible until completion, which is what the user asked for ("once onboarding is completed a new Org is shown under the org menu").

### 3.3 Stripe accounts: Jump's, and one per organization

Production has two kinds of Stripe account, and test mirrors them with two Stripe Sandboxes (confirmed 2026-09-18):

| Account | Owns | Test | Client in code | Keys | Webhooks |
|---|---|---|---|---|---|
| **Jump's Stripe account** | Everything Jump earns: subscriptions (`PlatformCustomer`), and the platform fee on every ticket / application charge (`application_fee_amount`). It is also the Connect **platform** that organizations' accounts connect to | **Jump sandbox** | existing `stripe` (`config/stripe.js`) | existing `STRIPE_SECRET_KEY`; new `STRIPE_BILLING_WEBHOOK_SECRET` | existing `POST /webhooks/stripe` (orders, applications) and `/webhooks/stripe/connect` (connected-account events); new `POST /webhooks/stripe/billing` (subscription events) |
| **The organization's own Stripe account**, one per store | Ticket and application revenue, refunds, payouts to the organizer's bank | **Client sandbox**, connected to the Jump sandbox through Connect | none — reached through `stripe` with the connected account id (`OrganizationStripeAccount.stripeAccountId`) | none in Jump | none in Jump beyond `/webhooks/stripe/connect` |

Consequences:

- One Stripe client and one secret key. Billing and Connect are two products of the same Jump account, so there is no second `Stripe` instance; `BillingService` uses `stripe` like every other service. Only the webhook endpoint is separate: Stripe lets one account register several endpoints with their own event lists and signing secrets, so subscription events go to `/webhooks/stripe/billing` (`STRIPE_BILLING_WEBHOOK_SECRET`) and the order webhook's dispatch is untouched.
- `PlatformCustomer.stripeCustomerId` is a Customer in Jump's account, created for the *organization* (`metadata.organizationId`, email = the owner's). It is unrelated to the organization's connected account and to the per-buyer Customers that spec 011 creates for saved cards.
- Nothing in this plan changes how buyer money moves. It does narrow spec 010 §11.1: "the organizer provides their own Stripe account" rules out option A (Express accounts created by Jump). B (Standard account linked by OAuth, destination charges) is the smallest change — onboarding only; C (direct charges on the organizer's account) makes the organizer merchant of record and moves Checkout, refunds, tax and statement descriptors to the connected account. Recommendation: B now, C as its own spec. Either way the setup guide's **payments** card becomes **Connect your Stripe account** (done when `OrganizationStripeAccount.chargesEnabled`). Recorded in `specs/010-payments-settings/plan-phase-2.md` §11.1.
- Test setup (`docs/wiki/config/stripe-setup.md`): Jump sandbox keys in `backend/.env`; the client sandbox is connected to the Jump sandbox through the Connect OAuth flow (or, until §11.1 lands, an Express account created in the Jump sandbox). Two `stripe listen` processes against the Jump sandbox: `--forward-to localhost:3000/webhooks/stripe` and `--forward-to localhost:3000/webhooks/stripe/billing` (plus the existing `--forward-connect-to … /webhooks/stripe/connect`). Contract tests keep mocking `stripe`; no test ever needs a client-sandbox key.
- `BILLING_ENABLED=true` requires `JUMP_STARTER_PRICE_ID` and `STRIPE_BILLING_WEBHOOK_SECRET`; the server logs and disables billing at startup when either is missing (the `STRIPE_CONNECT_ENABLED` pattern).

---

## 4. Backend

### 4.1 Routes — `backend/src/api/routes/signup.js`, mounted at `/signup`

All routes `requireAuth`. No role requirement: `UNASSIGNED` users are exactly who this is for. Every `/:orgId` route checks the caller is an `OrganizationMember` with role `ADMIN` of a **pending** org (`requirePendingOrg`); SYSTEM_ADMIN is allowed through (they may create orgs too, and get a membership like anyone else — see §9).

| Method | Path | Body / result |
|---|---|---|
| `GET` | `/signup/current` | `{ organization: { id, name, slug, step } \| null, billingEnabled }` — the caller's newest pending org and where to resume |
| `POST` | `/signup` | `{ name, source?: 'admin'\|'public' }` → 201 `{ id, slug, step: 'subscribe'\|'survey' }`. Validates name 1–100 chars (reuse `validateCreateOrganization` rules). Creates org with `uniqueSlug(name)`, `onboardingCompletedAt: null`; creates `OrganizationMember { role: 'ADMIN' }` for the caller. Cap: 3 pending orgs per user (409 `You have unfinished organizations; finish or discard one first`) — spec 020 will layer rate limits on top. |
| `POST` | `/signup/:orgId/subscribe` | Phase 2. `{}` → `{ clientSecret }` for embedded Checkout, or 409 when `BILLING_ENABLED` is off |
| `POST` | `/signup/:orgId/subscribe/skip` | Records `subscribeSkippedAt` |
| `PATCH` | `/signup/:orgId/survey` | Partial `{ goals?, eventTypes?, eventsPerYear?, attendance?, movingFrom? }`; each value validated against the option allowlists in `backend/src/config/onboarding.js`; merged into `onboarding` JSON on the org's `PlatformCustomer` (upsert) |
| `POST` | `/signup/:orgId/survey/skip` | Records `surveySkippedAt` |
| `POST` | `/signup/:orgId/complete` | Upserts `PlatformCustomer` (`ownerUserId` = caller), sets `onboardingCompletedAt`, promotes `User.role` from `UNASSIGNED` to `ADMIN` (never downgrades; ORGANIZER stays ORGANIZER but the membership is ADMIN — see §9), returns the organization in the `GET /organizations` shape |
| `DELETE` | `/signup/:orgId` | Discard a pending org (cascade deletes the membership; refuses once `onboardingCompletedAt` is set) |

The survey JSON is stored on `PlatformCustomer.onboarding`, so `PATCH …/survey` upserts the row early with `plan: FREE`. `complete` then only fills `ownerUserId` if missing and stamps the org. This keeps one write path for the record while matching "created once collected" from the organizer's point of view (nothing reads the row before completion).

### 4.2 `OnboardingService` (new, `backend/src/services/OnboardingService.js`)

`start(userId, { name, source })`, `current(userId)`, `saveSurvey(orgId, patch)`, `skipSurvey`, `skipSubscribe`, `complete(userId, orgId)`, `discard(userId, orgId)`, `sweepAbandoned(olderThanMs)` (phase 3). `complete` runs in one transaction: upsert `PlatformCustomer`, update org, update user role. Logs `organization_onboarding_completed` with `{ organizationId, plan, source, surveySkipped, subscribeSkipped }` — the funnel metric.

### 4.3 Existing endpoints that change

- `GET /organizations` (`listOrganizations` / `listOrganizationsForUser`): add `where: { onboardingCompletedAt: { not: null } }`. The SYSTEM_ADMIN Organizations list page keeps showing everything but gets a **Pending setup** pill for `null` rows (they can discard from there).
- `POST /organizations` (legacy, ADMIN+): now also creates the caller's `OrganizationMember` ADMIN row and sets `onboardingCompletedAt: now()`. This fixes the invisible-org bug for the seed/e2e path and for SYSTEM_ADMIN tooling without routing them through the wizard. The switcher stops calling it.
- `resolveActiveMembership` / `activeOrgFor`: unchanged — a pending org is a real membership, so `X-Jump-Org: <pendingId>` works during onboarding (the survey pages do not need it; `complete` returns the org so the client can select it).
- `POST /webhooks/stripe/billing` (phase 2, new route in `routes/webhooks.js`, verified with `STRIPE_BILLING_WEBHOOK_SECRET` via the existing `readStripeEvent` helper): `customer.subscription.created|updated|deleted`, `invoice.payment_failed`, `checkout.session.completed` (`mode === 'subscription'`) → `BillingService.handleEvent`. Dispatch key: `subscription.metadata.organizationId` (set on the Checkout session's `subscription_data.metadata`), falling back to a `stripeSubscriptionId` lookup. `POST /webhooks/stripe` (orders) is not changed — see §3.3.

### 4.4 `GET /admin/setup-guide` (new, in `routes/admin.js`)

Returns the setup-guide tasks for `activeOrgFor(req)`:

```json
{
  "dismissedAt": null,
  "tasks": [
    { "id": "event",    "done": false, "href": "/admin/create-event" },
    { "id": "design",   "done": false, "href": "/admin/online-store" },
    { "id": "payments", "done": false, "href": "/admin/settings/payments", "state": "platform" },
    { "id": "business", "done": false, "href": "/admin/settings" },
    { "id": "domain",   "done": false, "href": "/admin/settings/domains" },
    { "id": "applications", "done": false, "href": "/admin/participants/applications", "shown": true }
  ],
  "onboarding": { "goals": ["sell_online", "vendor_applications"] }
}
```

`done` rules, all one query each and cheap: `event` = any event in the org's venues; `design` = `brandColor` or `logoImageId` set, or `themeMode !== SYSTEM`; `payments` = Connect account `chargesEnabled` when `STRIPE_CONNECT_ENABLED`, else `paymentSettingsUpdatedAt` set (the organizer reviewed the page); `business` = `companyName` and `addressLine1` set; `domain` = any `OrganizationDomain` with status `ACTIVE`; `applications` = any `ApplicationForm`. `shown` on `applications` is true when the survey `goals` include `vendor_applications` or `press_applications`, false otherwise (the card is the "we'll tailor your setup" payoff). `PATCH /admin/setup-guide { dismissed: true }` stamps `setupGuideDismissedAt`.

Copy lives on the frontend; the API only says what is done.

### 4.5 `backend/src/config/onboarding.js`

Single source of truth for the survey option ids (the frontend imports the same ids through `frontend/src/lib/onboarding.ts`, which mirrors the file like `lib/fees.ts` mirrors `FeeService`):

```js
export const ONBOARDING_SURVEY = {
  goals: ['sell_online', 'sell_at_door', 'vendor_applications', 'press_applications', 'add_ons_merch', 'move_platform'],
  eventTypes: ['convention_expo', 'festival', 'concert', 'conference', 'sports', 'community_nonprofit', 'other'],
  eventsPerYear: ['one', 'two_to_five', 'six_to_twenty', 'twenty_plus'],
  attendance: ['under_100', '100_500', '500_2000', '2000_10000', '10000_plus'],
  movingFrom: ['eventeny', 'eventbrite', 'ticketmaster_universe', 'etix', 'square', 'spreadsheets', 'other'],
};
```

---

## 5. Frontend

### 5.1 Routes — `frontend/src/app/signup/`

Outside `/admin` (no sidebar, no `OrgProvider`); its own dark full-bleed layout matching the screenshots (near-black radial background, centred white card, **Skip** pill top-right, **←** circle to the left of the card). Guarded by `ProtectedRoute` (signed in, any role); the edge middleware already leaves non-`/admin` paths alone, so `UNASSIGNED` users can reach it.

| Path | Screen |
|---|---|
| `/signup` | **Name your organization**: one input (`Organization name`), live handle preview `jump.com/<slug>` from `slugify` (the same rules as `backend/src/utils/slug.js`; the server's `uniqueSlug` wins if it appends `-2`), **Continue**. If `GET /signup/current` returns a pending org, redirect to its step instead of showing the form. Reads `?from_admin=1` to set `source: 'admin'` and to know it is a second tab. |
| `/signup/[orgId]/subscribe` | Phase 2 (§7). Two-column card like screenshot 1: left "Get over 90 days to explore" ledger (Today: 30 days free · <date>: $X/mo · Always: Cancel anytime), right: embedded Stripe Checkout mounted via `@stripe/stripe-js` `initEmbeddedCheckout({ clientSecret })`. **Skip** top-right → `POST …/subscribe/skip` → survey. When `billingEnabled` is false the route redirects straight to the survey. |
| `/signup/[orgId]/survey` | Screens 1–5 below; one URL, step in component state, `?step=n` for back/refresh. Continue → `PATCH …/survey` with that step's keys; **←** goes back without saving; **Skip** (top-right) → `POST …/survey/skip` → done. |
| `/signup/[orgId]/done` | Calls `POST …/complete`, then `useSession().update()` (forces the claims refresh, §5.4), posts `{ type: 'org-created', id }` on `BroadcastChannel('jump-org')`, and `router.replace('/admin?org=<id>')`. Shows a spinner and "Setting up <name>…" for the second this takes. |

### 5.2 Survey screens (screenshot 2, adjusted to ticketing)

Headline · sub-headline · pill choices (`✓` when selected, `+` when not) · **Continue**. Multi-select unless noted.

1. **What can we help you do?** — *Select all that apply. We'll tailor your setup.*
   `Sell tickets online` · `Sell tickets at the door` · `Manage vendor & sponsor applications` · `Accept press & panel applications` · `Sell add-ons and merch` · `Move from another platform`
2. **What kind of events do you run?** — *Pick the closest matches.*
   `Conventions & expos` · `Festivals` · `Concerts & live music` · `Conferences & workshops` · `Sports & tournaments` · `Community & nonprofit` · `Other`
3. **How many events do you run a year?** (single) — `Just one` · `2–5` · `6–20` · `More than 20`
4. **How many people come to a typical event?** (single) — `Under 100` · `100–500` · `500–2,000` · `2,000–10,000` · `10,000+`
5. **Where are you moving from?** (single; shown only when `Move from another platform` was picked) — `Eventeny` · `Eventbrite` · `Ticketmaster / Universe` · `Etix` · `Square` · `Spreadsheets or nothing yet` · `Somewhere else`

Shopify's remaining screens (revenue band, "are you a developer/agency", business name & address) are dropped: revenue is inferable from sales, Jump has no agency programme, and business details already have a Settings › General home (the setup guide points there). Every screen's **Continue** is enabled with zero selections (Shopify's is); an empty step saves `[]`.

### 5.3 Org switcher and the original tab

- `OrgSwitcher.tsx`: **Create organization** becomes `window.open('/signup?from_admin=1', '_blank', 'noopener')`. The inline form, `creating`, `newName`, `createError` state and `handleCreate` are deleted.
- `OrgContext.tsx`: subscribe to `BroadcastChannel('jump-org')` (guarded for browsers without it; fall back to a `storage` event on `jump.org.created`). On `org-created`, `refresh()` and — because the user's intent was to create *and use* the org — `setSelectedOrgId(id)` once it is in the list. Also read `?org=<id>` from the URL on mount so the new tab lands on the right org; strip the param afterwards.
- `/admin/organizations` (SYSTEM_ADMIN list): its create form keeps calling `POST /organizations` (now membership-creating and completed). Pending rows get a **Pending setup** pill and a **Discard** action (`DELETE /signup/:orgId`).

### 5.4 Session refresh

`auth.ts` `jwt` callback: add `trigger` to the destructured args and refresh claims when `trigger === 'update'` regardless of `claimsRefreshedAt`. `sessionClaims.ts` gains nothing; the change is two lines and a unit test in `lib/sessionClaims.test.ts` is not needed (the helper is unchanged). The `/signup/[orgId]/done` page awaits `update()` before navigating so `AdminRoute` sees `ADMIN` on first render. `applyUserClaims` picks `organizationId` from the oldest membership; for a first-time organizer that is the new org.

### 5.5 Redirects for users without an organization

- `AdminRoute.tsx`: when the role is `UNASSIGNED`, `router.replace('/signup')` instead of Access Denied. (Access Denied stays for a role the enum does not know.)
- `Navbar.tsx`: signed-out visitors and `UNASSIGNED` users get a **Start selling** link → `/auth/signin?callbackUrl=%2Fsignup` / `/signup`. Staff keep the **Admin** link. This is spec 005 US1's entry point, resolved.
- `auth/signin`: honour `callbackUrl` (the magic-link and Google calls hard-code `/events` today).

### 5.6 Setup guide on the dashboard (screenshot 3)

`frontend/src/app/admin/dashboard/SetupGuide.tsx`, rendered by `dashboard/page.tsx` **above** the stats when `GET /admin/setup-guide` has `dismissedAt === null` and at least one task is not done. When every shown task is done the guide shows a one-line "You're all set" with **Dismiss**; dismissing stamps the org. Stats and the event list render underneath as today, so an organizer who already has events still sees the numbers; the `No events yet` box is removed (the guide's first card replaces it).

Cards (2 wide on desktop, 1 on mobile; each: title, one sentence, illustration slot, one button; a green check replaces the button when done):

| id | Title | Sentence | Button | Illustration |
|---|---|---|---|---|
| `event` | **Create your first event** | A name, a date and a venue are enough to start selling. Add tiers and details later. | Create event | three ticket stubs, middle one dashed `+` |
| `design` | **Choose your store design** | Pick a theme mode and brand colour. You can refine it once you're selling. | Choose design | three stacked storefront cards, `Aa` swatch |
| `payments` | **You're ready to accept payments** (Connect off) / **Connect your Stripe account** (when `STRIPE_CONNECT_ENABLED`) | Review payment methods and your statement descriptor. / Ticket revenue is paid into your own Stripe account. Connect it to start selling. | Review payments / Connect Stripe | card + Apple Pay tiles |
| `business` | **Add your business details** | Your legal name and address appear on receipts and tax reports. | Add details | name-tag ("HELLO my name is") |
| `domain` | **Claim your web address** | Give your store a branded URL that's easy to find, trust, and remember. | Set up domain | browser bar `.com`, cursor |
| `applications` (shown per survey) | **Open vendor & sponsor applications** | Start from a template: booths, sponsorships, press, panels. | Set up applications | form + booth cards |

Illustrations are inline SVG in the component (no image uploads, theme-aware via `currentColor`). `Name your store` from Shopify is folded into step 1 of the signup (the name is required there), so it is not a card.

### 5.7 `frontend/src/services/signupService.ts`

Thin wrappers over `api` for the routes in §4.1; `adminService.getSetupGuide()` / `dismissSetupGuide()` for §4.4.

### 5.8 Everything in the admin is per organization

Every admin page — Dashboard, Venues, Events, Tickets, Orders, Customers, Participants, Check In, Analytics, Online store, Settings — shows only the organization picked in the switcher. That is spec 007's `X-Jump-Org` → `resolveOrgScope` / `activeOrgFor(req)` contract and `tests/contract/tenantIsolation.test.js` guards it. This plan keeps the contract and adds to it:

| Surface | Scope today | Spec 022 |
|---|---|---|
| Dashboard stats, Events, Orders, Tickets, Customers, Analytics (`routes/admin.js`, `events.js`, `venues.js`) | `resolveOrgScope` venue filter | Setup guide (`GET /admin/setup-guide`) uses `activeOrgFor(req)`; a new org has zero events, so the guide is what an organizer sees first |
| Participants, application forms, templates | `scopedOrgFor(req)` | Phase 3 seeds templates into the new org only |
| Online store, Settings (General, People, Payments, Domains, Tax, Applications) | `activeOrgFor(req)` / `requireOrgMembership` | Settings › **Plan** (phase 2) reads the active org's `PlatformCustomer`; each organization has its own subscription, like one Shopify store has its own plan. An owner with three organizations has up to three subscriptions |
| Org switcher | memberships (`listOrganizationsForUser`) | Pending orgs hidden; a completed org appears for its creator only (membership), never for members of the owner's other organizations |
| **Check In** (`POST /tickets/scan`, `/tickets/:barcode/redeem`) | **Not scoped**: `requireScannerOrStaff` checks role only; `ticketService.lookupByBarcode(barcode, null)` passes no org, so staff of organization A can preview and redeem organization B's tickets | **Gap, fixed in phase 1**: staff sessions resolve `resolveOrgScope` and the lookup takes the org's venue filter (404 outside it). `X-Scanner-Key` readers stay platform-wide because `SCANNER_API_KEY` is one shared key; per-org scanner keys are a follow-up noted in `docs/wiki/features/` |

The survey answers and plan are visible only to SYSTEM_ADMIN (phase 3, §8.4) and to the organization's own ADMINs on the Plan page; an ORGANIZER-role member sees neither.

---

## 6. Phase 1 — Signup flow, Jump customer record, setup guide (no billing)

Branch `feat/022-onboarding-phase-1`.

**Backend**
1. Migration + `PlatformCustomer`, `PlatformPlan`, `Organization.onboardingCompletedAt` / `setupGuideDismissedAt` (backfill completed = createdAt). `npm run db:generate`; dev DB uses `db push` (spec 012 note).
2. `config/onboarding.js`, `OnboardingService`, `routes/signup.js`, mounted in `api/server.js`.
3. `GET /organizations` hides pending; `POST /organizations` adds membership + completed stamp.
4. `GET|PATCH /admin/setup-guide`.
5. Check In scoping (§5.8): `POST /tickets/scan` and `POST /tickets/:barcode/redeem` pass the caller's org scope to `ticketService.lookupByBarcode`; contract test in `tenantIsolation.test.js` (staff of org A scanning org B's barcode → 404).
6. Contract tests `tests/contract/signup.test.js`: UNASSIGNED user can start; org hidden from `GET /organizations` until complete; survey values outside the allowlist → 400; `complete` promotes role, creates `PlatformCustomer` with `ownerUserId`, returns org; second `complete` is idempotent; non-member → 404; pending cap → 409; discard removes org and membership; `POST /organizations` by ADMIN now yields a membership. `tests/contract/setupGuide.test.js`: each `done` rule flips on the matching write; `applications.shown` follows survey goals; dismiss stamps.

**Frontend**
7. `app/signup/*` pages + layout, `lib/onboarding.ts` (option ids + labels), `services/signupService.ts`.
8. `OrgSwitcher` new-tab link; `OrgContext` BroadcastChannel + `?org=` selection; `AdminRoute` UNASSIGNED redirect; `Navbar` **Start selling**; sign-in `callbackUrl`.
9. `auth.ts` `trigger === 'update'` refresh.
10. `SetupGuide.tsx` + dashboard wiring; `/admin/organizations` pending pill + discard.
11. E2E `e2e/signup.spec.ts` (mock `/signup*` like `admin-online-store.spec.ts` mocks `/organizations`): name → survey (select two pills, Continue ×4) → done → lands on `/admin?org=…` with the guide showing; **Skip** on the first survey screen goes straight to done; `UNASSIGNED` session at `/admin` lands on `/signup`. `e2e/admin-setup-guide.spec.ts`: cards render, done state shows the check, dismiss hides the guide, 375 px stacks to one column. Update `admin-navbar.spec.ts` for the switcher's new-tab button (assert `popup` event, not navigation).
12. Docs: `docs/wiki/features/organization-onboarding.md`, update `multi-tenant-architecture.md` (pending orgs, `PlatformCustomer` vs `Contact`), `docs/user-guides/organizers/getting-started.md` (new), `CLAUDE.md` env table (`BILLING_ENABLED`, `STRIPE_BILLING_WEBHOOK_SECRET`, `JUMP_STARTER_PRICE_ID` — documented now, used in phase 2), `specs/STATUS.md`.

**Exit**: a brand-new magic-link user reaches a working, scoped dashboard with the guide in under a minute without anyone touching Settings › Users.

---

## 7. Phase 2 — Subscribe step and Plan page (Stripe Billing, dark)

Branch `feat/022-onboarding-phase-2`. Everything behind `BILLING_ENABLED=true`; with it off, phase 1 behaviour is unchanged.

1. `BillingService` (`backend/src/services/BillingService.js`) on the existing `stripe` client (Jump's account, §3.3): `createCheckout(orgId, userId)` → ensures a Stripe Billing customer (`stripe.customers.create({ email, name: org.name, metadata: { organizationId } })`, saved on `PlatformCustomer.stripeCustomerId`), then `stripe.checkout.sessions.create({ mode: 'subscription', ui_mode: 'embedded', customer, line_items: [{ price: JUMP_STARTER_PRICE_ID, quantity: 1 }], subscription_data: { trial_period_days: TRIAL_DAYS, metadata: { organizationId } }, return_url: '<FRONTEND_URL>/signup/<orgId>/survey?subscribed=1' })`. `handleEvent` mirrors `subscription.status`, `trial_end`, `current_period_end`, `plan` onto `PlatformCustomer`. `portalLink(orgId)` → Stripe Billing customer portal session for cancel / card update.
2. Routes: `POST /signup/:orgId/subscribe`, `GET /admin/settings/plan`, `POST /admin/settings/plan/portal`, `POST /webhooks/stripe/billing` (§4.3). Contract tests mock `stripe` as `connect.test.js` does; one test posts a subscription event to `/webhooks/stripe` and asserts it is ignored, and an order event to `/webhooks/stripe/billing` and asserts the same.
3. Frontend: `/signup/[orgId]/subscribe` (§5.1) with the ledger copied from the screenshot but Jump's numbers (`TRIAL_DAYS` free · then `$X/mo` · Cancel anytime; no "$1 for 3 months" promo unless §9.1 decides one); **Settings › Plan** page (`/admin/settings/plan`, `SettingsNav` entry): current plan, trial end, next invoice, **Manage billing** (portal), and for `FREE`: **Start trial** (same Checkout, `return_url` back to the page). `PayoutsBanner`-style banner on the dashboard when `subscriptionStatus === 'past_due'`.
4. Nothing in phase 2 gates functionality on the plan. A subscription changes what the organizer pays Jump, not what they can do — until §9.2 decides otherwise.
5. Launch checklist entries: in Jump's Stripe account create the Product/Price (sandbox + live), set `STRIPE_BILLING_WEBHOOK_SECRET` and `JUMP_STARTER_PRICE_ID`, register `https://<backend>/webhooks/stripe/billing` for `customer.subscription.*`, `invoice.payment_failed`, `checkout.session.completed`, and enable the customer portal. `docs/wiki/config/stripe-setup.md` and `environment-variables.md` document the Jump / client account split and the `stripe listen` processes.

---

## 8. Phase 3 — Tailoring, sweep, funnel

Branch `feat/022-onboarding-phase-3`.

1. **Tailored setup**: when survey `goals` include `vendor_applications` or `press_applications`, `complete` seeds two `ApplicationFormTemplate` rows for the org (`Vendor booth` PAID template with one tier and the standard questions; `Press & media` FREE) via `ApplicationFormTemplateService`, so the `applications` card's **Set up applications** lands on a non-empty Templates tab. `eventTypes` picks the default `Event.category` in the create-event form (query param). `sell_at_door` adds a **Check-in** hint card pointing at `/admin/orders/scan`.
2. **Abandoned pending orgs**: `OnboardingService.sweepAbandoned(7 days)` on the existing sweep timer pattern (`DOMAIN_SWEEP_INTERVAL_MS` / `APPLICATION_SWEEP_INTERVAL_MS`): deletes pending orgs with no events and no `PlatformCustomer.stripeSubscriptionId`; logs `organization_onboarding_abandoned` with the last step reached.
3. **Funnel**: `organization_onboarding_started` / `_step` / `_completed` / `_abandoned` log events with `source` and `step`; a **Onboarding** section on the SYSTEM_ADMIN Organizations page (started / completed / subscribed counts for 7 / 30 days, from `PlatformCustomer` + org timestamps — no new table).
4. Survey answers surface for SYSTEM_ADMIN on the organization row (`/admin/organizations`): goals, event types, size, moving-from. Never shown to the organization's own staff.

---

## 9. Open decisions (do not block phase 1)

1. **Plan and price.** Shopify's offer is $1/mo for 3 months, then $39/mo. Jump's only revenue today is the 5 % platform fee; the Eventeny organizer paid ~$3,260/yr in subscription *plus* per-ticket fees and called it double dipping. Recommendation: phase 1 ships with no subscription; phase 2's `STARTER` price is set by the founder in Stripe and `JUMP_STARTER_PRICE_ID`, defaulting to a 30-day trial. Whether a subscription lowers the platform fee (the honest way to avoid the double-dip complaint) is a `FeeService` change scoped in a later spec.
2. **Does the plan gate anything?** Recommendation: no gating in 022. Publishing an event, custom domains and Connect stay available on `FREE`. Revisit once there are paying organizations.
3. **Role on completion.** The creator's membership is `ADMIN` (they own the org). Their global `User.role` is promoted only from `UNASSIGNED`; an existing `ORGANIZER` of another org who creates a second org is `ADMIN` there via the membership but stays `ORGANIZER` globally, and `requireAdmin` (global-role check) would still refuse them on ADMIN-only routes for their own org. Recommendation: promote `ORGANIZER → ADMIN` as well on completion; the global role is a ceiling that the memberships already refine (spec 007 left global role in place for exactly this reason). Flagged, not assumed — the plan promotes only `UNASSIGNED` until confirmed.
4. **SYSTEM_ADMIN in the flow.** They can run `/signup` (gets a membership like anyone else — harmless; they already see every org) or keep using the Organizations list form. Recommendation: switcher opens `/signup` for everyone; the list form stays for bulk/ops.
5. **Trial length and copy.** Screenshot says "Get over 90 days to explore" (3 days free + 3 months at $1). Jump copy in the plan: "30 days free"; number is `TRIAL_DAYS` in `config/billing.js`.
6. **Two tabs.** The user asked for a new tab (Shopify does it because the signup host differs). Jump's signup is same-origin, so a same-tab flow with a return to `/admin` is simpler and avoids the BroadcastChannel step. The plan follows the request (new tab) and notes that `?from_admin=1` is the only thing that would change.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Pending orgs leak into scoped queries (`resolveOrgScope` picks the oldest membership) | A first-time user's oldest membership *is* the pending org during onboarding, which is correct; for an existing staff member, the pending org is newer so never auto-selected. `GET /organizations` hides pending orgs so the switcher cannot select one. Phase 3 sweep bounds the lifetime. |
| Role promotion + JWT staleness leaves the user at Access Denied after `done` | `update()` trigger refresh (§5.4) plus `AdminRoute` redirecting `UNASSIGNED` to `/signup`, which resumes and shows "You're all set — Go to dashboard" if the org is already complete. |
| Billing and order Stripe events get mixed up | Same account, but separate endpoints with separate event lists and signing secrets (§3.3); a subscription event never reaches `/webhooks/stripe` because that endpoint is not subscribed to it, and one posted there by hand is ignored by the dispatch. Contract test posts each kind to the wrong endpoint. |
| Survey allowlist drift between backend and frontend | Contract test asserts `lib/onboarding.ts` ids equal `config/onboarding.js` ids (the `fees.ts` mirror test pattern). |
| `window.open` blocked by popup blockers | Called synchronously in the click handler (allowed); fall back to `router.push('/signup')` when `window.open` returns `null`. |
| Uncommitted Online store work on `main` | Land it first (it introduces `slug`, which the signup shows); this plan branches from that commit. |

---

## 11. Files

**Backend (new)**: `src/api/routes/signup.js`, `src/services/OnboardingService.js`, `src/services/BillingService.js` (P2), `src/config/onboarding.js`, `src/config/billing.js` (P2), `tests/contract/signup.test.js`, `tests/contract/setupGuide.test.js`, `tests/contract/billing.test.js` (P2).
**Backend (changed)**: `src/api/server.js` (mount + sweep timer), `src/api/routes/organizations.js`, `src/api/routes/admin.js`, `src/api/routes/webhooks.js` (P2), `src/api/routes/tickets.js` (scan scope), `src/services/TicketService.js` (scan scope), `src/services/OrganizationService.js`, `src/api/validators/organizationValidators.js`.
**DB**: `packages/db/prisma/schema.prisma`, `migrations/20260926100000_organization_onboarding/`.
**Frontend (new)**: `src/app/signup/layout.tsx`, `src/app/signup/page.tsx`, `src/app/signup/[orgId]/subscribe/page.tsx` (P2), `src/app/signup/[orgId]/survey/page.tsx`, `src/app/signup/[orgId]/done/page.tsx`, `src/app/signup/SurveyStep.tsx`, `src/app/admin/dashboard/SetupGuide.tsx`, `src/app/admin/settings/plan/page.tsx` (P2), `src/lib/onboarding.ts`, `src/services/signupService.ts`, `e2e/signup.spec.ts`, `e2e/admin-setup-guide.spec.ts`.
**Frontend (changed)**: `src/components/OrgSwitcher.tsx`, `src/components/OrgContext.tsx`, `src/components/AdminRoute.tsx`, `src/components/Navbar.tsx`, `src/app/auth/signin/page.tsx`, `src/auth.ts`, `src/app/admin/dashboard/page.tsx`, `src/app/admin/organizations/page.tsx`, `src/app/admin/settings/SettingsNav.tsx` (P2), `src/services/adminService.ts`, `e2e/admin-navbar.spec.ts`.
**Docs**: `docs/wiki/features/organization-onboarding.md`, `docs/wiki/config/stripe-setup.md` (Jump vs client sandbox, P2), `docs/wiki/config/environment-variables.md` (P2), `docs/wiki/features/multi-tenant-architecture.md`, `docs/user-guides/organizers/getting-started.md`, `docs/wiki/config/production-launch-checklist.md` (P2 Stripe Billing steps), `CLAUDE.md`, `specs/STATUS.md`, `docs/roadmap.md` (005 → superseded by 022 for onboarding).
