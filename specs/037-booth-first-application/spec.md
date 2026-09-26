# Spec 037 — Booth-first vendor application: pick the spot, then apply

Status: **Proposed** · Written 2026-09-25 · Owner: Bench · Tracking: EVE-16 (spec), EVE-23 (build)

> **Numbering.** This document was asked for as `036-booth-first-application`. The number 036
> is already in use in the tree by the in-flight vendor door check-in feature
> (`feat/vendor-door-check-in`: `CheckInMethod` in `packages/db/prisma/schema.prisma`,
> `VendorCheckInService.js`, `frontend/.../check-in/`, `docs/wiki/features/vendor-door-check-in.md`,
> migration `20261009100000_vendor_door_check_in` — all say "spec 036"). Renumbering that branch
> would touch ~15 files in review; renumbering this document costs nothing. Booth-first is **037**.
> See `specs/STATUS.md`.

Builds directly on **spec 014 phase 2** (self-serve booth purchase) and the hold hardening in
**EVE-4** (migration `20261009100000_booth_hold_uniqueness`). Read `specs/014-floor-map/spec.md`
§4.2 and §6 first — this spec changes the *order* of that flow, not its locking model.

`file:line` references are against `main` at `6e7c4ce`. Treat the symbol name as authoritative and
the line as a hint.

---

## 1. What Jump does today — approve first, pick second

For a PAID application form whose tier is bound to a floor map (`ApplicationTier.mapBound`), the
live flow is:

| # | Step | Code |
|---|---|---|
| 1 | Vendor submits the apply form. A PAID form creates the row as `DRAFT` / `AWAITING_CARD`, with the amount snapshot written as an `Order` (spec 024). | `ApplicationService.submit` — `backend/src/services/ApplicationService.js:243`, create at `:349` |
| 2 | Vendor is sent to Stripe Checkout in setup mode to save a card. The webhook moves the row to `SUBMITTED` / `CARD_ON_FILE`. | `ApplicationPaymentService.checkoutForSubmission` |
| 3 | Organizer approves. For a `mapBound` tier this takes a tier slot as `RESERVED`, sets `paymentStatus = PAYMENT_DUE` and `order.dueAt`, and **does not charge**. | `ApplicationService.decide` — `:786`, map-bound branch `:823` |
| 4 | Vendor opens the status page (guest token) or the buyer account, sees the map, picks a booth. The booth goes `AVAILABLE → HELD` for `BOOTH_HOLD_MS` (15 min) under a row lock. | `POST /applications/:id/booth` (`backend/src/api/routes/applications.js:130`), `POST /buyer/me/applications/:id/booth` (`backend/src/api/routes/buyerAuth.js:246`) → `ApplicationService._chooseBooth:542` → `BoothService.chooseBooth:23` |
| 5 | The saved card is charged off-session, or a hosted Checkout is minted. `beginPayment` re-locks and marks `PROCESSING`. | `BoothService.beginPayment:104` |
| 6 | Stripe confirms. `_confirmHeldSlot` turns the tier slot `RESERVED → APPROVED` and `claimBooth` turns the booth `HELD → SOLD`, writing `Application.boothLabel`. | `ApplicationService._confirmHeldSlot:1382`, `BoothService.claimBooth:148` |
| 7 | Failure, abandonment or expiry releases the hold. `sweepExpiredHolds` runs every `BOOTH_SWEEP_INTERVAL_MS` and never releases a booth whose application is `PROCESSING` or `PAID`. | `BoothService.releaseHoldOnFailure:174`, `sweepExpiredHolds:212`, wired at `backend/src/api/server.js:235` |

Two guarantees already hold and this spec must not weaken either:

- **Lock order is always Application → Booth**, one transaction, `SELECT … FOR UPDATE`. `move` sorts
  booth ids to avoid deadlock (`BoothService.move:366`).
- **Postgres holds the invariant** independently of caller discipline: `Booth.applicationId @unique`
  (SOLD), `Booth.holdApplicationId @unique` (HELD), and
  `Booth_hold_state_check` pinning `status = 'HELD' ⇔ (holdApplicationId AND holdExpiresAt are set)`.
  That constraint arrives with EVE-4 and this spec **depends on it**.

## 2. Problem

The vendor cannot see, let alone reserve, the thing they are actually buying until the organizer has
approved them — which can be days. Three consequences the founder sees in the field:

1. **Vendors shop for a spot, not for permission.** "Can I have the corner by the entrance?" is the
   first question, and today the answer is "apply and we'll see."
2. **The good booths are a lottery decided by inbox speed.** Step 4 is a race that starts when the
   approval email lands, so the vendor who happens to be at their phone wins the corner, not the
   vendor the organizer wanted.
3. **Approval is a promise the organizer cannot keep.** An organizer approves 40 vendors for 32
   booths (nothing stops them), and 8 of them discover at step 4 that there is nothing left.

Spec 014 recorded this as deliberately deferred, not overlooked:

> `specs/014-floor-map/spec.md:211` — "Choose a booth **at submission** (Ticketmaster order: pick,
> then pay, then organizer review) — needs multi-week holds and a hold-per-contact cap. Revisit
> after phase 2 data shows whether organizers want it."

and `:193` lists "choosing a booth at submission" as an explicit phase-2 non-goal. This spec picks up
that deferred item. The two blockers named there — **multi-week holds** and a **hold-per-contact
cap** — are §4.3 and §4.6 below.

## 3. Goals and non-goals

**Goals**

- G1 A vendor sees live booth availability and reserves a specific booth **as the first step of
  applying**, before they have typed anything else.
- G2 That booth is theirs — invisible and unpickable to every other vendor — for the whole review
  window, not for 15 minutes.
- G3 A rejection or a waitlist returns the booth to the pool promptly and tells the vendor so.
- G4 An approval charges the card the vendor already authorised and turns the booth `SOLD`, with no
  second vendor action and no window in which two vendors can hold the same booth.
- G5 Abandonment at any step reclaims the booth automatically. No hold is immortal.
- G6 The existing approve-first flow keeps working, unchanged, for every form that does not opt in.

**Non-goals**

- N1 **Charging at submission.** See decision D1 — deferred, with the reason.
- N2 Multiple booths per application. One application = one tier slot = one booth, as today.
- N3 Booth *preferences* ("any corner booth") or an organizer-run allocation round. Booth-first is
  first-come, first-held.
- N4 Changing the floor-plan builder, the public map renderer, or `MapService.publicMap`.
- N5 Sponsors, programming markers, or non-`mapBound` tiers.
- N6 Anything inside Stripe: Connect, Tax, webhooks, refunds and Orders↔Stripe reconciliation stay
  with spec 010/018 and Ledger. This spec reuses the existing charge paths and adds no new ones.

## 4. Decisions

### D1 — Card on file at submission; the charge happens at approval. Not pay-at-submit.

The vendor authorises a card at step 1 (setup-mode Checkout, exactly as today) and is charged only
when the organizer approves.

*Why not take the money at selection?* Because every rejection would then be a refund. Refunds are
spec 018 / Ledger territory, they cost the organizer Stripe fees on a vendor they never wanted, and
a refund path that runs automatically on a review decision is the single most likely place in this
product to double-refund or strand money. `ApplicationFormService` already refuses
`chargeTiming = SUBMIT` on a form with a `mapBound` tier
(`backend/src/services/ApplicationFormService.js:363`) — that guard stays.

This also means **booth-first reuses the existing money path end to end**: the same setup-mode
Checkout, the same `chargeOnApproval`, the same `_confirmHeldSlot` / `claimBooth` settlement, the
same `orderStatusFor` mapping. No new Stripe surface. Pay-at-submit stays deferred (§12 Q1).

### D2 — The `DRAFT` application is the cart. No new hold table.

The hold hangs off `Booth.holdApplicationId`, which means an `Application` row must exist *before*
the booth is picked. It already can: `submit()` creates PAID applications as `DRAFT` and the status
page can resume them (`resumeCheckout:420`). Booth-first moves that `DRAFT` creation earlier — to the
moment the vendor picks a booth — instead of inventing a session-keyed hold.

*Why this and not a `BoothHold` table keyed on a guest session?* Because EVE-4 makes
`Booth.holdApplicationId @unique` plus a CHECK constraint the database's own answer to "one
application, one hold". A parallel hold table would have to re-derive that invariant, and the two
would drift. Reusing the column keeps one source of truth for "who holds this booth", keeps
`sweepExpiredHolds`, `releaseHoldOnFailure`, `releaseForApplication` and `claimBooth` working
unmodified, and inherits the existing "an abandoned DRAFT is withdrawn, never deleted, so its order
stays in the ledger as `CANCELLED`" behaviour (`ApplicationService.submit:319`–`:333`).

### D3 — Two hold classes on one column, derived from the application, not stored.

`Booth.holdExpiresAt` carries two very different deadlines now:

| Hold class | Set when | Deadline | On expiry |
|---|---|---|---|
| **Selection hold** | vendor picks a booth, application is still `DRAFT` | `now + BOOTH_HOLD_MS` (15 min) | release booth, leave the `DRAFT` (resumable) |
| **Review hold** | application reaches `SUBMITTED` | §4.3 rule | release booth **and** notify; the application survives without a booth |
| **Checkout hold** *(existing)* | `paymentStatus = PROCESSING` / `PAID` | — | never swept; waits for Stripe |

The class is **derived from `Application.status` / `paymentStatus`**, not stored in a new column:

```
DRAFT                                  → selection hold
SUBMITTED | WAITLISTED                 → review hold
APPROVED + PROCESSING | PAID           → protected (existing rule, BoothService.js:225)
anything else with a hold              → invariant violation; release
```

*Why derive rather than add `Booth.holdKind`?* `sweepExpiredHolds` already loads the holder
application to check `paymentStatus` (`BoothService.js:224`). A stored discriminator would be a
second copy of a fact the row already knows, and the failure mode of a stale copy — a review hold
swept as if it were a 15-minute selection hold — silently gives a paying vendor's booth away. The
derivation above is the enumerable state machine; it lives in one exported function
(`boothHoldClass(application)`) so it is testable and greppable rather than scattered.

### D4 — `WAITLISTED` releases the booth. `REJECTED` releases the booth. `APPROVED` keeps it.

A waitlisted vendor has, by definition, no confirmed spot. Holding inventory for them starves the
vendors the organizer *does* want and makes the "booths left" number on the map a lie. So waitlist
releases, and the `WAITLISTED` email says so in plain words ("the spot you picked has gone back on
the map; we'll be in touch if space opens up").

This is a change in kind from today, where `decide` releases a booth only on `WITHDRAWN`
(`ApplicationService.js:839`). Booth-first extends the release to `REJECTED` and `WAITLISTED`.

### D5 — Per-form opt-in plus an env gate.

- `ApplicationForm.boothFirst Boolean @default(false)` — the organizer turns it on per form, in the
  form editor, only when the form has at least one `mapBound` tier and a `PUBLISHED` map.
- `APPLICATIONS_BOOTH_FIRST_ENABLED` — the deploy-dark gate, same shape as
  `APPLICATIONS_PAYMENTS_ENABLED` and `STRIPE_CONNECT_ENABLED`. Off: the new endpoints 404 and the
  form editor hides the toggle.

Every existing form keeps the approve-first flow byte for byte (G6), and the whole feature is one
env var away from being off in production.

### D6 — Push the "one active application per form per contact" rule into Postgres.

Today it is an application-level check inside `submit()`'s transaction
(`ApplicationService.js:310`–`:318`): find an active row, 409 if it is not a `DRAFT`. That is
"check then write", and booth-first makes the race real — the draft-create endpoint is now a public,
unauthenticated, double-submittable write, not the tail of a long form.

Add a partial unique index:

```sql
CREATE UNIQUE INDEX "Application_form_contact_active_key"
  ON "Application" ("formId", "contactId")
  WHERE "status" IN ('DRAFT', 'SUBMITTED', 'WAITLISTED', 'APPROVED');
```

Combined with EVE-4's `Booth_holdApplicationId_key`, the pair "one active application, and at most
one booth for it" becomes a database fact. Two simultaneous draft-creates for the same email now
produce one row and one hold; the loser gets `P2002` and is answered with the winner's draft, which
is what an idempotent create should return anyway (§4.5).

The index needs a repair step for any pre-existing duplicate — see §5.

### D7 — The hold deadline is capped three ways and always visible.

See §4.3 for the formula. The point of the decision: a review hold is long but never open-ended, the
vendor is told the date, and the organizer can see it.

## 4.1 The booth-first flow

```
 ┌─ step 1 ──────────────────────────────────────────────────────────────┐
 │ GET  /events/:eventId/map                    live availability        │
 │ POST /events/:eventId/applications/draft     { formSlug, tierId,      │
 │                                                boothId, contact }     │
 │   → Application DRAFT / AWAITING_CARD, Order created (amount snapshot) │
 │   → Booth AVAILABLE → HELD, selection hold, now + BOOTH_HOLD_MS        │
 │   → { applicationId, statusUrl, holdExpiresAt, booth }                 │
 └───────────────────────────────────────────────────────────────────────┘
                              │  15 min countdown
 ┌─ step 2 ──────────────────▼───────────────────────────────────────────┐
 │ the rest of the apply form: profile, photos, answers, add-ons,         │
 │ consents (TERMS, PRIVACY, CARD_AUTHORIZATION)                          │
 │ POST /applications/:id/submit?token=          completes the DRAFT      │
 │   → setup-mode Stripe Checkout (save card)                             │
 └───────────────────────────────────────────────────────────────────────┘
                              │  Stripe setup succeeds (webhook)
 ┌─ step 3 ──────────────────▼───────────────────────────────────────────┐
 │ Application DRAFT → SUBMITTED, paymentStatus → CARD_ON_FILE            │
 │ selection hold → REVIEW hold: holdExpiresAt := reviewHoldUntil(form)   │
 │ RECEIVED email names the booth and the hold-until date                 │
 └───────────────────────────────────────────────────────────────────────┘
                              │  organizer reviews (days)
        ┌─────────────────────┼─────────────────────┬────────────────────┐
     APPROVE                REJECT              WAITLIST            (expiry)
        │                     │                     │                   │
  tier slot RESERVED    releaseHoldOnFailure   releaseHoldOnFailure  sweep releases
  charge card on file   booth → AVAILABLE      booth → AVAILABLE     + notifies
  PROCESSING            order → CANCELLED      application stays     application
        │               no money moved         WAITLISTED, no booth   keeps its place
  Stripe confirms
        │
  _confirmHeldSlot: RESERVED → APPROVED
  claimBooth: HELD → SOLD, boothLabel written
```

The right-hand branches are all existing code (`releaseHoldOnFailure`, `sweepExpiredHolds`) and the
approve branch below the fold is *entirely* existing code (`_confirmHeldSlot`, `claimBooth`). What is
new is steps 1–3 and the release on reject/waitlist.

### 4.2 What changes in `BoothService.chooseBooth`

`chooseBooth` (`BoothService.js:23`) is the pattern this spec reuses, unchanged in shape: lock
`Application` first, lock `Booth` second, verify, single `update`, unique-index backstop. Only its
*preconditions* move, because a booth-first hold is taken on a `DRAFT` rather than on an
`APPROVED` + `PAYMENT_DUE` row:

| Guard today (`:46`–`:57`) | Booth-first |
|---|---|
| `status === 'APPROVED'` else `APPLICATION_NOT_APPROVED` | `APPROVED` **or** (`DRAFT` on a `boothFirst` form) |
| `paymentStatus === 'PAYMENT_DUE'` else `NOT_PAYMENT_DUE` | as today for `APPROVED`; `AWAITING_CARD` for `DRAFT` |
| `tierId` set, `tier.mapBound` true | unchanged |
| booth `AVAILABLE`, tier matches, map `PUBLISHED` | unchanged |
| booth's map belongs to this application's event (EVE-4) | unchanged — **this is the tenant filter, keep it** |
| one hold per application (`ALREADY_HOLDING_BOOTH`) | unchanged; plus a *move* path (§4.5) |

Implementation note for EVE-23: express this as a small `assertCanHold(application, { boothFirst })`
predicate returning the same coded errors, rather than widening the inline `if` chain. The error
codes are part of the contract (§8) and the frontend switches on them.

### 4.3 Review-hold deadline

```js
reviewHoldUntil(form, event, now) =
  min(
    form.closesAt ? form.closesAt + BOOTH_REVIEW_GRACE_MS : now + BOOTH_REVIEW_HOLD_MAX_MS,
    now + BOOTH_REVIEW_HOLD_MAX_MS,   // absolute cap, regardless of closesAt
    event.startsAt                     // never hold past the door opening
  )
```

- `BOOTH_REVIEW_GRACE_MS` default 7 days — the organizer's review window after the form closes.
- `BOOTH_REVIEW_HOLD_MAX_MS` default 30 days — the ceiling for a form with no `closesAt`.
- Both are env-overridable (`BOOTH_REVIEW_GRACE_MS`, `BOOTH_REVIEW_HOLD_MAX_MS`) in the style of
  every other sweep knob in `backend/src/config/applications.js`.

The date is shown to the vendor (confirmation screen, status page, `RECEIVED` email) and to the
organizer (submissions table **Booth** column, application detail). A hold nobody can see is a hold
nobody trusts.

**Extension.** The organizer can extend one application's review hold from the application detail
page (`POST /admin/events/:eventId/applications/:id/booth-hold/extend`, ORGANIZER). It re-locks the
booth and pushes `holdExpiresAt` forward, capped by the same formula. This is the escape hatch for
"we're running late reviewing" and it beats the alternative, which is vendors losing spots because
the organizer went on holiday.

### 4.4 Sweep changes

`sweepExpiredHolds` (`BoothService.js:212`) keeps its structure — batch of 500, per-row transaction,
re-lock and re-check inside. Two additions:

1. Branch on the hold class (D3). A swept **selection** hold is silent: the vendor is mid-form and
   will get `BOOTH_HOLD_EXPIRED` on their next request. A swept **review** hold sends the vendor a
   "your booth was released" email and writes an `ApplicationDecision` row so the organizer can see
   why a submitted application has no booth.
2. Return `{ released, protected, reviewReleased }` so the counts are distinguishable in logs and in
   the organizer digest.

The existing `PROCESSING` / `PAID` protection is untouched and remains the rule that stops a
webhook-delayed payment from losing its booth.

**Abandoned drafts.** A `DRAFT` whose selection hold has been swept and which has had no activity for
`BOOTH_DRAFT_ABANDON_MS` (default 7 days) is withdrawn as `SYSTEM` / `abandoned`, mirroring the
existing abandoned-checkout and abandoned-signup sweeps. Without this, booth-first leaves a trail of
`DRAFT` rows that each occupy the D6 unique index slot and block the vendor from ever applying again.
**This is required in phase 1, not a follow-up** — it is the reclaim path for the new index.

### 4.5 Guest and buyer sessions

Step 1 is public and unauthenticated, so the draft needs an identity from its first request.

- **Email is captured at step 1.** It is the only durable key: it dedupes against the D6 index, it
  resolves the `Contact`, it is where the resume link and the abandoned-draft notice go. The step-1
  form is therefore *email + booth*, nothing else.
- **Guest bearer: the existing status token.** `statusToken(id)` is derived from the application id
  and only `sha256` of it is stored (`Application.statusTokenHash`, `applicationLinks.js`). The
  draft-create response returns `statusUrl`; every step-2 request carries `?token=`, verified by
  `_requireByToken` (`ApplicationService.js:444`) exactly as the status page does today.
- **Plus an httpOnly cookie.** `jump_apply_draft` (httpOnly, `SameSite=Lax`, `Secure`, scoped to the
  storefront host, TTL = `BOOTH_HOLD_MS` + slack) holds `{ applicationId, token }` so a page reload,
  a tab restore, or the trip through Stripe Checkout does not lose the draft. The token is *never*
  put in `localStorage` and never appears in a URL the vendor might paste.
- **Signed-in buyer.** A buyer session (`requireBuyer`, spec 007 phase 2) resolves the draft by
  `(organizationId, contactId, formId)` — no token needed, same as `chooseBoothForContact`
  (`ApplicationService.js:529`). Step 1 prefills the email and is read-only.
- **A vendor who signs in mid-flow** keeps the draft: the guest `Contact` upsert is keyed on
  `(organizationId, email)`, so the buyer session lands on the same `Contact` and therefore the same
  draft. No merge step is needed. This is worth an explicit test.

**Idempotency.** `POST /events/:eventId/applications/draft` is idempotent on
`(formId, contactId)`:

| Situation | Response |
|---|---|
| no active application | create `DRAFT`, hold the booth, `201` |
| a `DRAFT` exists holding **the same** booth | `200` with that draft and its unchanged `holdExpiresAt` — a retry or a double-tap is not a second hold and does not extend the deadline |
| a `DRAFT` exists holding **another** booth | **move** in one transaction: release the old hold, take the new one, one `holdExpiresAt`. Never two holds, never zero. |
| a `DRAFT` exists with no booth (swept) | take the hold on the existing draft, `200` |
| `SUBMITTED` / `WAITLISTED` / `APPROVED` exists | `409 ALREADY_APPLIED` with the existing `applicationId`, as `submit()` does today |
| concurrent duplicate loses on `P2002` | re-read and return the winner's draft — not a `500` |

The move case needs both booths locked. Lock order: `Application`, then booths **sorted by id**, the
same discipline `BoothService.move:370` already uses.

### 4.6 Hold-per-contact cap

Spec 014's second named blocker. Three layers, outermost first:

1. `BOOTH_CHOOSE` rate limiter already on the choose endpoints (10/min/IP,
   `backend/src/middleware/rateLimit.js:128`) — extend it to draft-create.
2. `ORDER_MAX_PENDING_PER_CONTACT`-style cap: at most `BOOTH_MAX_DRAFTS_PER_CONTACT` (default 3)
   active booth-first drafts per `Contact` **across forms**, so one email cannot hold the three best
   booths at three different events' worth of forms in the same org.
3. The D6 index: one active application per form per contact, in the database.

## 5. Data model and migration

```prisma
model ApplicationForm {
  // …
  boothFirst Boolean @default(false) // spec 037: booth is chosen before submission
}
```

No new column on `Booth` (D3). No new enum value on `ApplicationStatus` — `DRAFT` already means
"started, not submitted", which is exactly the booth-first cart.

**Migration** `20261012100000_booth_first_application`:

```sql
-- 1. Per-form opt-in. Additive, defaulted, no backfill: every existing form
--    keeps the approve-first flow.
ALTER TABLE "ApplicationForm" ADD COLUMN "boothFirst" BOOLEAN NOT NULL DEFAULT false;

-- 2. Repair before constraining (same shape as 20261009100000_booth_hold_uniqueness).
--    Keep the newest active row per (formId, contactId); withdraw the older ones as
--    SYSTEM/'replaced' so their orders stay in the ledger as CANCELLED rather than vanishing.
--    [full repair UPDATE … FROM (row_number() OVER (PARTITION BY "formId","contactId"
--     ORDER BY "createdAt" DESC)) — see EVE-23 for the executable form]

-- 3. One active application per form per contact (D6).
CREATE UNIQUE INDEX "Application_form_contact_active_key"
  ON "Application" ("formId", "contactId")
  WHERE "status" IN ('DRAFT', 'SUBMITTED', 'WAITLISTED', 'APPROVED');
```

**Rollback**

```sql
DROP INDEX "Application_form_contact_active_key";
ALTER TABLE "ApplicationForm" DROP COLUMN "boothFirst";
```

Both are safe at any time and neither drops nor rewrites application data. Dropping `boothFirst`
returns every form to approve-first; any application already mid-booth-first-flow is a `DRAFT` with a
hold, which the existing sweep reclaims. The step-2 repair is the only non-reversible part, which is
why it withdraws rather than deletes.

**Ordering.** This migration must land *after* EVE-4's `20261009100000_booth_hold_uniqueness`
(`Booth_holdApplicationId_key` + `Booth_hold_state_check`). Booth-first relies on those constraints
as its backstop; without them the review hold rests entirely on caller discipline for days at a
time. Wire EVE-23 as blocked by EVE-4.

## 6. State machine

`Application.status` × `paymentStatus` × booth, for a `boothFirst` form. `status` and
`paymentStatus` stay two independent columns (spec 011) and `Order.status` stays derived through
`orderStatusFor` (`backend/src/services/applicationOrderStatus.js`) — booth-first adds no fourth
state column.

| Application.status | paymentStatus | Booth | holder column | Hold class | Order.status | Vendor can | Organizer can |
|---|---|---|---|---|---|---|---|
| `DRAFT` | `AWAITING_CARD` | `HELD` | `holdApplicationId` | selection (15 min) | `PENDING` | finish the form, move booth, abandon | — (invisible in submissions) |
| `DRAFT` | `AWAITING_CARD` | `AVAILABLE` | — | none (swept) | `PENDING` | re-pick a booth, or resume and be told it's gone | — |
| `SUBMITTED` | `CARD_ON_FILE` | `HELD` | `holdApplicationId` | review | `PENDING` | withdraw (releases), update card | approve, reject, waitlist, extend hold |
| `SUBMITTED` | `CARD_ON_FILE` | `AVAILABLE` | — | none (review hold expired) | `PENDING` | re-pick if the form is still open | approve → must assign manually |
| `WAITLISTED` | `CARD_ON_FILE` | `AVAILABLE` | — | none (D4) | `PENDING` | withdraw | approve → vendor re-picks, or assign |
| `APPROVED` | `PROCESSING` | `HELD` | `holdApplicationId` | protected | `PENDING` | nothing (409 on everything) | nothing (`decide` refuses `PROCESSING`) |
| `APPROVED` | `PAID` | `SOLD` | `applicationId` | — | `COMPLETED` | view booth, map link | move, unassign, refund (→ release) |
| `APPROVED` | `PAYMENT_DUE` | `HELD` | `holdApplicationId` | protected until `order.dueAt` | `PENDING` | pay now | retry charge, waive, offline-pay, extend |
| `REJECTED` | `CARD_ON_FILE` | `AVAILABLE` | — | released | `CANCELLED` | — | — |
| `WITHDRAWN` | any not-money-moved | `AVAILABLE` | — | released | `CANCELLED` | — | — |

Transitions that touch the booth:

| Event | Booth effect | Call |
|---|---|---|
| draft-create | `AVAILABLE → HELD`, selection deadline | `BoothService.chooseBooth` |
| draft-create with a different booth | old `HELD → AVAILABLE`, new `AVAILABLE → HELD` | new `BoothService.moveHold`, locks both sorted |
| submit (Stripe setup confirmed) | `holdExpiresAt := reviewHoldUntil(...)` | new `BoothService.extendHoldForReview` |
| approve | no booth change; tier slot `RESERVED`, then charge | `decide` map-bound branch, unchanged |
| Stripe success | `HELD → SOLD`, `boothLabel` written | `_confirmHeldSlot` → `claimBooth`, unchanged |
| charge declined | stays `HELD`, `paymentStatus → PAYMENT_DUE`, protected until `order.dueAt` | `_markPaymentDue` (Ledger owns this — EVE-8) |
| reject | `HELD → AVAILABLE` | `releaseHoldOnFailure` (**new call site** in `decide`) |
| waitlist | `HELD → AVAILABLE` | `releaseHoldOnFailure` (**new call site**, D4) |
| withdraw (either side) | `HELD`/`SOLD → AVAILABLE` | `releaseForApplication`, unchanged |
| full refund | `SOLD → AVAILABLE` | existing refund path, unchanged (Ledger) |
| review hold expires | `HELD → AVAILABLE` + notify | `sweepExpiredHolds`, extended |
| organizer manual assign | `AVAILABLE/RESERVED → SOLD` | `BoothService.assign`, see R5 |

## 7. Concurrency: the races, named

The default case, not the edge case. Each of these needs a test that actually races (§10), not a
test that calls the method twice in sequence.

**R1 — Two vendors, same booth, same second.** Both draft-creates lock their own `Application` row
(different rows, no contention), then contend on `SELECT … FOR UPDATE` on the one `Booth`. The loser
re-reads `status !== 'AVAILABLE'` and gets `409 BOOTH_TAKEN`. Backstop:
`Booth_holdApplicationId_key`. *Already proven by EVE-4's `boothHoldConcurrency.test.js` +
`boothRaceWorker.js` — booth-first must be added to that harness, not given a new one.*

**R2 — One vendor double-submits draft-create.** Two rows would be created today, because the
`Contact` upsert succeeds twice and nothing serialises the `Application` create. The D6 partial
unique index makes the second one `P2002`; the handler re-reads and returns the winner (§4.5). The
observable outcome is one draft and one hold, whether the vendor double-tapped, the network retried,
or both tabs posted.

**R3 — Vendor picks booth B while holding booth A.** One transaction, `Application` locked first,
then both booths locked **in id order**. The intermediate state (A released, B not yet held) is never
visible outside the transaction, so the vendor never has zero booths and never has two.
`Booth_holdApplicationId_key` refuses the two-booth outcome even if a future caller gets the order
wrong.

**R4 — Organizer approves while the sweep is releasing the same hold.** `decide` locks
`Application` first (`ApplicationService.js:795`); the sweep locks `Booth` first
(`BoothService.js:222`) and *then* reads the application. That is opposite lock order — the one real
deadlock risk booth-first introduces, because unlike today's 15-minute hold, a review hold can be
expiring at the exact moment a human clicks Approve. Fix: the sweep must take the `Application` lock
first, like every other caller (`SELECT id FROM "Application" … FOR UPDATE` before the booth
`SELECT … FOR UPDATE`), re-check the class inside, and skip if the application moved. *This is a
change to existing code and the most important correctness item in the spec.*

**R5 — Organizer manually assigns a booth that is under a review hold.** `BoothService.assign:261`
accepts only `AVAILABLE` / `RESERVED`, so a `HELD` booth is already refused — correct, and it must
stay refused. What is new is that the refusal can now last for days, so the message has to be
actionable: `409 BOOTH_HELD_BY_APPLICATION` naming the holding application and its
`holdExpiresAt`, with an organizer action to reject/waitlist that applicant (which releases) rather
than a dead end. The `existingBooth` check at `:277` already stops an application from being assigned
a second booth while holding one.

**R6 — The organizer edits or unpublishes the map under live review holds.** Today
`PUT /admin/maps/:mapId/layout` refuses to delete a `SOLD`/`HELD` booth (spec 014 FR-06) — that
covers geometry. `unpublish` must additionally refuse while any booth on the map carries a review
hold, or else the vendors who applied lose their booths to `MAP_NOT_PUBLISHED` with no recourse.
`409 MAP_HAS_REVIEW_HOLDS` with the count.

**R7 — Stripe webhook replay / double settlement.** Unchanged and already idempotent:
`claimBooth:157` returns the existing `SOLD` booth when the hold is gone,
`Booth.applicationId @unique` makes a second `SOLD` impossible, and `_payNow:484` refuses a replay
on a settled application. Booth-first adds no new webhook.

**R8 — The 15-minute selection hold expires while the vendor is inside Stripe Checkout.** This is
the window the existing `PROCESSING` protection does not cover, because a booth-first vendor is in
setup-mode Checkout (saving a card) while still `DRAFT` / `AWAITING_CARD`. Two mitigations, both
needed: the selection hold is extended to the review deadline at the *start* of the setup Checkout,
not at its return; and the Checkout return handler re-verifies the hold and, if it is gone, shows
"your booth was released" with the map rather than a generic error and a saved card the vendor never
gets to use.

## 8. API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/events/:eventId/applications/draft` | public, `BOOTH_CHOOSE` + `APPLICATION_SUBMIT` limiters, `gateByEventParam` | step 1: create/resolve the `DRAFT` and hold the booth. Idempotent (§4.5) |
| `PATCH` | `/applications/:id/draft?token=` | status token | move the hold to another booth; same handler semantics as draft-create's move case |
| `POST` | `/applications/:id/submit?token=` | status token | step 2: complete the `DRAFT` (profile, answers, add-ons, consents) and mint the setup Checkout |
| `GET` | `/applications/:id/status?token=` | status token | unchanged; now also returns the booth and `holdExpiresAt` for a `DRAFT` |
| `DELETE` | `/applications/:id/draft?token=` | status token | vendor abandons on purpose: release the hold, withdraw the draft |
| `POST` | `/buyer/me/applications/draft` | buyer JWT | step 1 for a signed-in buyer |
| `POST` | `/admin/events/:eventId/applications/:id/booth-hold/extend` | ORGANIZER | extend one review hold, capped by §4.3 |

Existing endpoints keep working unchanged: `POST /applications/:id/booth`,
`POST /buyer/me/applications/:id/booth`, `POST /applications/:id/pay`,
`POST /applications/:id/cancel-checkout`.

**Error codes** (the frontend switches on these; they are contract):

`BOOTH_TAKEN` · `BOOTH_HOLD_EXPIRED` · `BOOTH_TIER_MISMATCH` · `MAP_NOT_PUBLISHED` ·
`ALREADY_HOLDING_BOOTH` · `ALREADY_APPLIED` · `BOOTH_FIRST_NOT_ENABLED` ·
`BOOTH_HELD_BY_APPLICATION` · `MAP_HAS_REVIEW_HOLDS` · `TOO_MANY_DRAFTS`

`GET /events/:eventId/map` (`backend/src/api/routes/events.js:72`) is unchanged, including its
`no-store` + ETag headers. `HELD` is already in the public payload, so a booth-first hold is
immediately visible as taken to the next vendor — no cache to invalidate. **Do not add a read cache
here** without write invalidation (spec 014 decision 5); on the booth-first path a stale map means
a vendor picking a booth that is already gone, which is the exact experience this spec exists to fix.

## 9. UI

**Step 1 — `/events/:eventId/apply/:formSlug`, booth step.** Reuse `BoothPicker`
(`frontend/src/components/maps/BoothPicker.tsx`) and the existing `Booth` / `MapLegend` / `mapTheme`
components. No new renderer.

- Tier filter, all-in price on the booth per the spec 011 fee-mode rule, `HELD`/`SOLD` rendered as
  taken.
- Email + booth, then **Hold this booth**. A 15:00 countdown from `holdExpiresAt` with a clear
  "your booth is held until HH:MM" line, and a refetch of the map on `BOOTH_TAKEN` so the vendor sees
  reality rather than a stale selection.
- **Public-surface performance.** The map is the heaviest thing on the page and this page is now the
  *first* thing a vendor loads, on a phone, on venue wifi. Budget from spec 014 §8 applies (1,000
  booths at 60 fps pan on a mid-range phone). Load the map payload before the form fields, render the
  SVG server-side where possible, and do not block the booth step on the legal-versions fetch.

**Step 2 — the rest of today's form.** `frontend/src/app/events/[eventId]/apply/[formSlug]/page.tsx`
gains a step wrapper; the existing single-page form becomes step 2 with the chosen booth pinned in a
summary card (booth label, size, tier, all-in price, hold countdown) and a **Change booth** link back
to step 1.

**Status page** (`apply/status/[applicationId]`) shows a `DRAFT`'s held booth and a resume CTA.

**Organizer.** Submissions table **Booth** column shows the hold state and deadline, not just the
label; new filter **Booth held, awaiting review**; application detail shows the hold with **Extend**
next to the existing Move / Unassign.

Mobile and dark mode are acceptance criteria, not polish: this page renders on a phone or it does not
ship. Screenshots of step 1 and step 2 at 375 px, light and dark, belong in the PR.

## 10. Phases

**Phase 1 — backend: draft, hold, review hold, release (JUMP-037A)**
Migration + repair; `boothFirst`; draft-create / move / submit / abandon endpoints; `chooseBooth`
precondition change; `moveHold`; `extendHoldForReview`; `boothHoldClass`; sweep changes **including
the R4 lock-order fix** and the abandoned-draft withdrawal; release on reject and waitlist;
per-contact cap; `unpublish` guard (R6).

**Phase 2 — vendor UI + emails (JUMP-037B)**
Two-step apply form, hold countdown, taken-booth refetch, Change booth, guest cookie, buyer path,
Checkout-return recovery (R8); status page draft view; `RECEIVED` / `REJECTED` / `WAITLISTED` /
hold-released email copy and the new merge fields; consent text per EVE-17.

**Phase 3 — organizer surfaces + docs (JUMP-037C)**
Submissions Booth column and filter, Extend action, digest counts ("booth held, awaiting review",
"holds expiring in 48 h"); form editor `boothFirst` toggle with its preconditions; wiki page
`docs/wiki/features/booth-first-application.md`; `CLAUDE.md` env rows; `backend/AGENTS.md` gotcha for
the hold classes and the sweep lock order; `specs/STATUS.md` update.

## 11. Tests that must exist

Anything concurrent, expiring or money-adjacent. "It works" means output, not a claim.

- **Racing draft-creates on one booth from separate processes**, exactly one wins, N−1 get
  `BOOTH_TAKEN`. Extend `backend/tests/contract/boothHoldConcurrency.test.js` and
  `backend/tests/helpers/boothRaceWorker.js` (EVE-4) rather than starting a second harness.
- **Double-submit of draft-create** (same email, same instant, separate processes) → one
  `Application`, one hold, second response is the winner's draft. Proves D6.
- **Selection-hold expiry and reclaim**, and the `DRAFT` still resumable afterwards.
- **Review-hold expiry**: released, vendor notified, `ApplicationDecision` written, application
  survives.
- **Approve racing the sweep on an expiring review hold** (R4) — both orders, no deadlock, no booth
  both released and sold. This is the test that would have caught the lock-order bug.
- **Reject and waitlist each release the booth**; the booth is immediately holdable by another
  vendor in the same test.
- **Approve → charge → `SOLD`** end to end with a stubbed Stripe success, and the webhook replayed
  twice producing exactly one `SOLD`.
- **Manual assign refused** while a review hold is live, with `BOOTH_HELD_BY_APPLICATION`.
- **`unpublish` refused** with live review holds (R6).
- **Multi-tenant isolation**: a booth id from another organizer's event 404s, not 409s. EVE-4 added
  this guard; booth-first adds a new public entry point to it.
- **Guest → signed-in mid-flow** keeps one draft and one hold.
- **Playwright**: pick a booth on a phone viewport, complete the form, save a test card, organizer
  approves, map shows the booth `SOLD`. Plus reject-releases-booth.

No network, no live Stripe — CI stays deterministic (`AGENTS.md` core constraints).

## 12. Open questions

| # | Question | Why it matters | Current assumption |
|---|---|---|---|
| Q1 | Should a booth-first form be able to charge at submission (true Ticketmaster order)? | It is the flow some organizers will ask for, and it needs an automatic refund-on-reject path | **No for v1** (D1). Revisit once refunds are settled under Ledger |
| Q2 | Default review-hold length when a form has no `closesAt` | 30 days of held inventory is a lot for a one-day market | 30 days, capped at event start, organizer-extendable |
| Q3 | Should waitlisting really release the booth? | D4 is a product call the founder may disagree with; the alternative is a shorter "waitlist hold" | **Yes, release** (D4) |
| Q4 | Can an organizer *reserve* specific booths so booth-first vendors cannot take them? | `RESERVED` already exists and `chooseBooth` refuses anything non-`AVAILABLE`, so this works today — confirm the organizer knows to use it | works as-is, document it |
| Q5 | Consent wording at step 1 vs step 2 | Step 1 takes an email before the vendor has seen terms | Take `TERMS` / `PRIVACY` / `CARD_AUTHORIZATION` at **step 2**, as today; step 1 takes only the email with a one-line notice. Wording is EVE-17 (Counsel) |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Review holds lock up inventory for weeks and the event looks sold out while nobody has paid | Deadline capped three ways (§4.3), visible to both sides, organizer digest counts held-awaiting-review, waitlist and reject release immediately |
| The sweep lock-order fix (R4) regresses the existing 15-minute path | The fix makes the sweep follow the same Application→Booth order as every other caller; covered by the existing EVE-4 concurrency harness plus the new R4 test |
| The D6 unique index rejects a legitimate re-application | The index covers active statuses only; `REJECTED` / `WITHDRAWN` rows do not block, so a vendor can reapply after a rejection. The abandoned-draft sweep (§4.4) is what stops a stale `DRAFT` blocking them |
| Vendors game the flow: hold the best booth, never submit | 15-minute selection hold, per-contact draft cap (§4.6), `BOOTH_CHOOSE` limiter on draft-create |
| Two flows on one form confuse organizers | `boothFirst` is per form and mutually exclusive with nothing — the form editor states which order applies, and the flow is fixed once the form has applications |
| Scope drifts into Stripe | Booth-first adds no Stripe surface (D1). Anything that looks like a new charge, refund or webhook goes to Ledger (EVE-8, EVE-3) |

## 14. Dependencies

| Depends on | What for | Status |
|---|---|---|
| EVE-4 — booth hold uniqueness (`Booth_holdApplicationId_key`, `Booth_hold_state_check`, concurrency harness) | The database backstop a multi-day hold rests on, and the race harness phase 1 extends | in review |
| EVE-17 — apply-form legal text (Counsel) | Consent wording at step 2 and the step-1 email notice. Design is independent of the wording (Q5), so it does not block phase 1 | in progress |
| EVE-8 — decline-safe vendor payment (Ledger) | The `charge declined → PAYMENT_DUE` branch a booth-first approval lands in | blocked |

## Sources and cross-references

- `specs/014-floor-map/spec.md` — §4.2 purchase flow, §5 Deferred (`:211` booth-at-submission),
  §6 decision 3 (money moves at selection), §6 decision 5 (no public read cache), §8 risks
- `specs/011-applications/spec.md` — the review state machine, fee mode, capacity on approval
- `specs/024-application-orders/` — `Order` as the amount snapshot, `orderStatusFor`
- `specs/020-abuse-protection/` — limiter factory, per-buyer pending cap, abandoned-checkout sweep
- `docs/wiki/features/floor-maps.md` — note: it names `BoothService.holdForPurchase`, which does not
  exist; the method is `chooseBooth` (`BoothService.js:23`). Fix while touching this area.
- EVE-4 migration `20261009100000_booth_hold_uniqueness` — the repair-then-constrain pattern §5 copies
