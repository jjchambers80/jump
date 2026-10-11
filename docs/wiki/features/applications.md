# Applications

**Status**: Implemented — phase 1 (FREE forms end to end), phase 2 (card on file at submission, off-session charge at approval, pay-now, refunds, overdue sweep) and phase 3 (CSV photo URLs, saved views, bulk waitlist/reject on PAID, applicant profile self-service, price-changed notice, organizer daily digest, event duplication) 2026-09-17. **Spec 037 phase 5 (2026-09-26) replaced the PAID-form money flow with apply-then-choose** — see [Apply-then-choose](#apply-then-choose-spec-037-phase-5); the phase 2 card-on-file sections below describe rows from before it. Paid forms run behind `APPLICATIONS_PAYMENTS_ENABLED`. Specs: `specs/011-applications/`, `specs/037-event-workspace/plan.md` (decisions D4–D7).
**Last Updated**: 2026-09-26

## Overview

Per-event **application forms** for people who are not ticket buyers: vendors and sponsors (PAID forms with priced, capacity-limited tiers — the *categories*) and press, content creators, panelists (FREE forms). Applicants fill in a business profile (reused across the organization's events), answer the organizer's questions (10 types incl. photo upload), and get a status page link by email. Organizers review in an admin list, **approve / reject / waitlist / withdraw** with a templated, editable email, keep notes and a booth label, bulk-act on free forms, and export CSV. Review `status` and `paymentStatus` are independent columns.

Since spec 037 phase 5 every PAID form is **apply-then-choose**: applying is free and asks for no category, space, add-ons or card; approving assigns the category (and, by default, reserves a slot in it); the approved vendor then chooses their space — from a list, or on the floor map — holds it for 15 minutes and pays. Capacity is never consumed by submission, so waitlisting works.

Derived from the 2026-09-15 Eventeny organizer interview (`docs/research/`).

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`ApplicationForm`, `ApplicationTier`, `ApplicationQuestion`, `ApplicantProfile(+Image)`, `Application`, `ApplicationAnswer`, `ApplicationDecision`, `ApplicationRefund`, `ApplicationMessageTemplate`, `Contact.stripeCustomerId`) | Model; migration `20260916200000_applications` |
| `backend/src/config/applications.js` | Limits, question types, merge fields, default templates |
| `backend/src/services/ApplicationFormService.js` | Forms / tiers / questions CRUD with value validation, public read shape, `tierAmounts` (fee mode PASS/ABSORB), acceptance window, `paymentsEnabled()` |
| `backend/src/services/ApplicantProfileService.js` | Profile upsert per org + contact, photos via `ImageService` (`usageType: applicant_profile`) |
| `backend/src/services/ApplicationTemplateService.js` | Templates (defaults, edit, reset), `renderTemplate` (`{{field}}`, `{{#section}}…{{/section}}`), send via `EmailService.sendApplicationMessage` |
| `backend/src/services/ApplicationService.js` | Submit (JSON or multipart), applicant views, resume / pay-now, organizer list/summary/detail/notes/preview/decide/retry charge/refund/bulk/export, capacity |
| `backend/src/services/ApplicationPaymentService.js` | Stripe: customer per contact, setup / payment / update-card Checkout sessions, off-session charge at approval (Connect routing via `checkoutOptionsFor`), webhook handlers, refunds, overdue sweep |
| `backend/src/services/applicationSelection.js`, `applicationOrderStatus.js` (`hasLiveOrder`) | Spec 037 phase 5: the approval payment clock (`selectionDueAt`) and the live-order rule every money read uses |
| `backend/src/scripts/backfill-037-applications.js` (`npm run db:backfill:037-applications`) | Spec 037 phase 5 (D6): moves in-flight PAID applications onto apply-then-choose; dry run unless `DRY_RUN=false` |
| `frontend/src/components/applications/ChooseSpace.tsx` | Spec 037 phase 5: choose your space (TIERS category or tier pick, MAP spot via `SpotWorkspace`, extras, how to pay, held state) on the status page and in the buyer account |
| `backend/src/services/applicationLinks.js` | Derived guest status token (HMAC of the id under `AUTH_SECRET`) + `statusUrlFor` |
| `backend/src/services/ApplicationDigestService.js` | Organizer daily digest: once-a-day window per organization (`Organization.applicationDigestAt`), members emailed through `sendApplicationMessage`; settings `GET/PATCH /admin/settings/application-digest` |
| `backend/src/services/EventService.js` `duplicateEvent` + `ApplicationFormService.copyForms` | `POST /organizations/:orgId/events/:eventId/duplicate` — DRAFT copy with tiers and forms |
| `backend/src/utils/publicUrl.js` | `backendPublicUrl` / `absoluteAssetUrl` (moved out of `EmailService`) for absolute image links in emails and CSV |
| `backend/src/services/stripeRefund.js` | `createStripeRefund` shared by `RefundService` (orders) and applications |
| `backend/src/api/routes/applications.js` | Public routes (forms, submit, status, resume, pay) |
| `backend/src/api/routes/webhooks.js` | `POST /webhooks/stripe` dispatches events with `metadata.applicationId` to `ApplicationPaymentService.handleEvent` before the order switch |
| `backend/src/api/routes/admin.js` (Applications block), `routes/buyerAuth.js` (Applications block), `validators/applicationValidators.js` | Admin + buyer routes |
| `frontend/src/lib/applications.ts` | Shared types, labels, helpers |
| `frontend/src/app/events/[eventId]/apply/*` | Public index, form, status page; `GetInvolved.tsx` on the event page |
| `frontend/src/app/organizations/[orgId]/account/ApplicationsSection.tsx`, `ApplicantProfileSection.tsx` + `frontend/src/app/api/buyer/me/applications*`, `applicant-profile[/photos]` | Applicant account view and business-profile editor (proxied through Next route handlers; the photo upload route forwards multipart) |
| `frontend/src/app/admin/events/[eventId]/applications/*` | Admin list page (since spec 019 it mounts the shared `components/applications/SubmissionsTable` with `eventId`; saved views in `localStorage`, bulk bar), detail (payment card with price-changed note, retry charge, `RefundDialog`, Stripe link), `DecisionDialog`, forms list, form editor, `useApplicationsApi` |
| `frontend/src/app/admin/settings/applications/page.tsx` | Settings › Applications (daily digest toggle, email templates) |
| `frontend/src/app/admin/events/DuplicateEventDialog.tsx` | Duplicate button on the admin events list |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `APPLICATIONS_PAYMENTS_ENABLED` | No (default off) | `true` lets PAID forms OPEN, accept (free) submissions, approve vendors into a category and let them choose a space and pay. Off: PAID forms stay configurable but `PATCH status=OPEN` → 409, submissions → 409, PAID approvals and space selections → 409 |
| `APPLICATION_SWEEP_INTERVAL_MS` | No (default 1 h) | How often the application sweep runs (first run 30 s after boot): `sweepOverdue`, then `ApplicationDigestService.sendDue` |
| `BOOTH_HOLD_MS`, `BOOTH_SWEEP_INTERVAL_MS` | No (15 min / 1 min) | Spec 037 phase 5: how long a chosen space is held, and how often `sweepExpiredSelections` (then the booth sweep) runs |
| `BACKEND_URL` | No | Makes photo URLs in the CSV export and emails absolute (falls back to `https://$RAILWAY_PUBLIC_DOMAIN`, then `http://localhost:$PORT`) |
| `STRIPE_WEBHOOK_SECRET` | With Stripe | Same platform endpoint as orders; add `checkout.session.completed`, `checkout.session.expired` (releases a held space), `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded` to the endpoint's events |

Application charges use the organization's Settings › Payments as-is (statement descriptor suffix, Connect destination when active) — nothing extra to configure.

Photos use the existing image storage (bucket or local `uploads/`), max 6 profile photos + one per PHOTO question, 5 MB each, JPG/PNG/GIF/WebP.

## How It Works

### Apply-then-choose (spec 037 phase 5)

> **Spec 039**: what the vendor chooses is now set per form. `spaceSelection` is TIERS (a tier: the organizer's, or the vendor's own pick when approved with `tierId: null`) or MAP (a spot of the approved category, priced per spot). See [Vendor Space Selection](vendor-space-selection.md).

One flow for every PAID form (decision D6 — there is no per-form switch; `chargeTiming` stays in the schema for legacy rows and the form editor no longer shows it).

| Step | What happens | States |
|---|---|---|
| **Apply** (storefront) | Contact, business profile, answers, consent. No category, no booth, no add-ons, no total, no Stripe step, no order, no card. `tierId` / `addOns` sent by an old tab are ignored on PAID forms. Opt-ins apply and the RECEIVED email goes out at once. FREE forms are unchanged (D7: no application fee). | `SUBMITTED` + `NOT_DUE` |
| **Approve** (admin) | The Approve dialog picks the **category** (`ApplicationTier`): required when the form has more than one active tier, preselected when it has one (or the application already has one). `ApplicationForm.reserveOnApproval` (D5, default `true`) takes a slot in it — a full category is 409 `… is full` with `suggestion: 'WAITLIST'`, so an approved vendor always has a space; `false` takes nothing (first come at selection). Nothing is charged. The vendor gets the **CHOOSE_SPACE** email. The payment clock (`paymentDueDays`) starts now. | `APPROVED` + `AWAITING_SELECTION`, `capacitySlot` `RESERVED` or `NONE` |
| **Choose** (status page / buyer account) | "Choose your space": the space type when the vendor picks, extras as their own step when the type offers add-ons, then review and pay — how to pay (a card saved before apply-then-choose is offered as "Pay with Visa ending 4242"), then the space: on TIERS forms the category (staff place them later); on MAP forms a spot of the vendor's category in the [Spot Chooser](spot-chooser.md) (map + synced list, extras and payment as step 2; `BoothService.chooseBooth` enforces the tier). `POST …/select` holds the space 15 minutes (`Application.selectionHeldUntil`, the booth's `holdExpiresAt`), takes the category slot when the approval did not (409 `SOLD_OUT`), reserves the add-ons (409 `ADD_ON_SOLD_OUT`), and creates the application's `Order` — or reopens its cancelled one, keeping the order number and organizer adjustments — through `OrderLineService.applicationOrderData` / `OrderService.createApplicationOrder`. `order.dueAt` = approval + `paymentDueDays`. | `PAYMENT_DUE`, order `PENDING` |
| **Pay** | `useSavedCard` charges the saved card off-session (the spec 011 `chargeOnApproval` path); otherwise `POST …/pay` opens hosted Checkout in payment mode (`PROCESSING` protects the hold while the vendor is on Stripe). The webhook's `_markPaid` commits the slot and add-ons, sells the held booth and sends the receipt + APPROVED emails. | `PAID`, order `COMPLETED` |
| **Lapse** | A decline, an expired Checkout session, "Change my choice" (`POST …/release`) or the hold running out (`ApplicationPaymentService.sweepExpiredSelections`, on the booth-hold timer) calls `releaseSelection`: booth hold, add-on reservations and — on a first-come form — the category slot go back, the order is `CANCELLED` (a declined attempt stays on its payment row), the vendor chooses again. Backing out of Checkout while the hold still runs keeps it (`PAYMENT_DUE`). A `PROCESSING` hold whose Checkout never reported back is reconciled with Stripe by the same sweep once the session must have ended (paid → settled, unpaid → released). | back to `AWAITING_SELECTION` |
| **Overdue** | `sweepOverdue` also finds `AWAITING_SELECTION` rows whose `decidedAt + paymentDueDays` has passed (compared in UTC): `WITHDRAW` policy withdraws and frees the slot, `HOLD` flags `overdue` (the vendor can still choose). Held selections are left to the hold sweep. | |

Without a published map (or when staff already placed the vendor with the assign flow), the list is the only option: the vendor pays for the category and staff place them. A tier is **map-bound** when the event's published map has booths bound to it — derived (`BoothService.mapBoundTierIds` / `isMapBound`, `attachMapBound` in `ApplicationService`); the old `ApplicationTier.mapBound` column is no longer read and goes in phase 6. Publishing a map still sets every bound tier's `quantityTotal` to its booth count, and no longer checks `chargeTiming`.

Money rules (spec 024) are unchanged: `Order.status` is derived by `orderStatusFor` (`NOT_DUE` and `AWAITING_SELECTION` → `CANCELLED`) and written in the same transaction; money reads go through `moneyOf`, which — like every list, CSV, digest and add-on report — treats a `CANCELLED` order on an application still in play (`SUBMITTED` / `WAITLISTED` / `APPROVED`) as not live (`hasLiveOrder`); rejected / withdrawn rows keep theirs as history.

Admin corrections: before a space is chosen the category moves freely with its slot (`tierEditable`, `POST …/tier`; a vendor already choosing is re-sent CHOOSE_SPACE); adjustments and add-on edits need the live order (a held space), and a category change is refused while a space is held. ADMIN can record an offline payment or waive the balance on an `AWAITING_SELECTION` row too — the order is opened for the category alone. Admin list: an **Awaiting space** chip (`?status=APPROVED&payment=AWAITING_SELECTION`, count in `awaitingSpace`), the detail page shows the state, the reserved slot and the choose-by date. The daily digest counts vendors awaiting a space.

In-flight rows from before the change move with `npm run db:backfill:037-applications` (D6; dry run unless `DRY_RUN=false`): DRAFTs stuck at the card / pay step → `SUBMITTED` + `NOT_DUE`; `SUBMITTED` / `WAITLISTED` with a card → `NOT_DUE` (the card is kept and offered at selection); `APPROVED` + `PAYMENT_DUE` → `AWAITING_SELECTION` (category kept, slot kept on a reserving form, held add-ons and booth released, an open pay-now session expired); their unpaid `PENDING` orders → `CANCELLED`. Anything where money moved, rejected / withdrawn rows and in-flight charges (`PROCESSING`, reported) are left alone. Idempotent.

### Forms

- `kind` PAID (tiers required to open) or FREE (no tiers). `status` DRAFT (hidden) → OPEN → CLOSED (visible, not accepting). Optional `opensAt`/`closesAt` window; `acceptance()` reports `open` + reason.
- PAID-only settings: `feeMode` PASS|ABSORB, `taxable`, `paymentDueDays` 1–30 (days from approval to choose and pay), `overduePolicy` WITHDRAW|HOLD, `reserveOnApproval` (spec 037 D5). `chargeTiming` SUBMIT|APPROVAL is legacy since spec 037 phase 5: stored, copied by templates / duplication, not shown and not read.
- `tierAmounts(price, form, event, org)` runs `FeeService.computeOrderFees` once: PASS → applicant pays `total`, org receives `subtotal`; ABSORB → applicant pays `subtotal + tax`, org receives `subtotal − fees`. Admin sees both numbers per tier; the public form shows only the applicant price ("$303.30 incl. $28.30 fees").
- Questions are archived (`archivedAt`) instead of deleted once answered; type cannot change after answers exist. Slug unique per event, auto-derived from the name.

### Submission (before spec 037 phase 5)

`POST /events/:eventId/applications` — JSON, or multipart with `payload` (JSON string), `profilePhotos` (≤6) and `answer:<questionId>` files. Validates window, PAID flag, tier, contact, profile, every answer against its question type/options/required. In one transaction: `Contact` upsert (org + lowercased email, marketing opt-in), duplicate check (one active application per contact per form), profile upsert + photos, answers (PHOTO → `Image`), application row. FREE → `SUBMITTED` + RECEIVED email (awaited, never throws). PAID → `DRAFT` + a Stripe Checkout URL (`next: 'checkout'`): **setup mode** for `chargeTiming: APPROVAL` (card saved, nothing charged), **payment mode** for `SUBMIT`. The response is `{ applicationId, statusUrl, next, checkoutUrl? }`. A new submission by the same contact replaces an abandoned DRAFT; `POST /applications/:id/resume?token=` mints a fresh session for one. The status token is **derived** — `HMAC-SHA256(AUTH_SECRET, "application-status:<id>")` — so every later email (decision, payment due) can carry a working link; `statusTokenHash` stores its sha256 and the page honours a 180-day TTL.

### Card on file → charge at approval (before spec 037 phase 5)

`checkout.session.completed` (mode `setup`) → `stripe.setupIntents.retrieve` → `stripePaymentMethodId` on the row, `Contact.stripeCustomerId`, `SUBMITTED` + `CARD_ON_FILE`, RECEIVED email. Approving such an application (inside the decision transaction) reserves the tier slot (`quantityReserved`), sets `PROCESSING`, bumps `chargeAttempts`, then after commit `ApplicationPaymentService.chargeOnApproval` creates a `PaymentIntent` — `off_session: true, confirm: true`, the saved customer + card, the snapshot `applicantPays` in cents, `statement_descriptor_suffix` / `transfer_data` / `application_fee_amount` from `PaymentSettingsService.checkoutOptionsFor(org, { fees: { subtotal: orgReceives }, lineItems })` (so the platform fee is exactly `applicantPays − orgReceives`), idempotency key `application:<id>:charge:<attempt>`. Outcomes:

| Stripe result | Row | Email |
|---|---|---|
| `succeeded` | `PAID`, `paidAt`, slot reserved → approved | APPROVED (organizer's edited message honoured) |
| `processing` | stays `PROCESSING`; UI polls | sent by the webhook (`payment_intent.succeeded` → APPROVED, `payment_failed` → PAYMENT_DUE) |
| card error (`StripeCardError`, `authentication_required`) | `PAYMENT_DUE`, `paymentDueAt = now + form.paymentDueDays`, slot stays reserved | PAYMENT_DUE with the pay-now link |
| other error (network) | back to `CARD_ON_FILE`, slot reserved, 400 to the organizer | none — retry |

`POST …/applications/:id/charge` (organizer+) retries the saved card for an `APPROVED + PAYMENT_DUE` row (e.g. after the applicant updated the card). Pay-now (`POST /applications/:id/pay?token=`, `POST /buyer/me/applications/:id/pay`) opens a payment-mode Checkout for the snapshot amount; its `checkout.session.completed` marks `PAID` and confirms the slot. `POST /buyer/me/applications/:id/update-card` opens a setup-mode session that only replaces `stripePaymentMethodId`. Other decisions are refused (409) while a charge is `PROCESSING`.

### Refunds and the overdue sweep

`POST …/applications/:id/refund { amount?, reason? }` (ADMIN) — partial or the remaining balance, a `Refund` row on the application's order (spec 024; `RefundService.refundOrder`), Stripe refund via `createStripeRefund` — on the organization's own account with `refund_application_fee` when the charge was a direct charge there (spec 047); `paymentStatus` becomes `PARTIALLY_REFUNDED` / `REFUNDED`, review status untouched (withdraw separately to free the slot). Refunds made in the Stripe dashboard arrive as `charge.refunded` and are reconciled by `stripeRefundId`.

`sweepOverdue()` (hourly, `unref`) finds `APPROVED + PAYMENT_DUE` rows past `paymentDueAt`: form policy `WITHDRAW` → `WITHDRAWN` by `SYSTEM` (`payment_overdue`), slot released, WITHDRAWN email; `HOLD` → `overdue = true`, shown in red on the admin detail; organizer decides.

### Decisions

`POST /admin/events/:eventId/applications/:id/decision { decision, note?, message?, sendEmail? }` — `DECISIONS` table: APPROVE (from SUBMITTED/WAITLISTED), REJECT (same), WAITLIST (from SUBMITTED), WITHDRAW (from SUBMITTED/WAITLISTED/APPROVED). Runs under `SELECT … FOR UPDATE` on the application; approving a tiered application does `UPDATE "ApplicationTier" SET quantityApproved+1 WHERE remaining >= 1 RETURNING` → 409 `tier is full` (details `suggestion: WAITLIST`) when it loses the race. Leaving APPROVED releases the slot (`capacitySlot` remembers which counter). Every decision writes an `ApplicationDecision` with the note and the email actually sent (subject/body). `message` overrides the rendered template for this send only; `sendEmail: false` skips it. `POST …/preview { decision }` returns the rendered template for the dialog. Bulk (`POST …/bulk`) refuses APPROVE on PAID forms.

### Templates

Per organization per action (`RECEIVED`, `APPROVED`, `CHOOSE_SPACE`, `REJECTED`, `WAITLISTED`, `WITHDRAWN`, `PAYMENT_DUE`, …), defaults from `config/applications.js`. `CHOOSE_SPACE` (spec 037 phase 5) is the approval email on a PAID form: the category, its all-in price (`{{tier.price}}`), the choose-by date (`{{space.dueDate}}`) and — when the published map sells the category (`{{#space.onMap}}`) — the map option. `APPROVED` is sent on FREE approvals and once a PAID vendor has paid. `{{amount.applicantPays}}` falls back to the category price while no order exists; `{{#booth.chooseRequired}}` now means the same as `{{#space.chooseRequired}}`. Plain text; `{{applicant.firstName}}`, `{{profile.businessName}}`, `{{event.name}}`, `{{tier.name}}`, `{{links.status}}` etc.; `{{#tier}}…{{/tier}}` sections. Values are HTML-escaped and rendered into the branded email shell (paragraphs, bare URLs become buttons). Unbalanced sections are rejected on save.

### Applicant views

Guest: `GET /applications/:id/status?token=` (+ `POST …/select`, `POST …/release`, `POST …/pay`, `POST …/cancel-checkout`; `POST …/resume` for a legacy DRAFT). The status view carries `selection` (spec 037 phase 5: `state` CHOOSE | HELD, `heldUntil`, `dueAt`, the `category` with its applicant price and `spacesLeft` / `guaranteed`, the category's `addOns`, `map { available, mapId, boothsAvailable }`, `placedBooth`, `savedCard { brand, last4 }`), rendered by `components/applications/ChooseSpace.tsx`. The status page reads `?checkout=submitted|paid|card_updated|cancelled` on return from Stripe and polls briefly until the webhook lands. Signed in (buyer magic link, spec 007): `GET /buyer/me/applications[/:id]`, `POST …/withdraw` (SUBMITTED/WAITLISTED only), `POST …/pay`, `POST …/update-card`, `GET/PATCH /buyer/me/applicant-profile`, `DELETE …/photos/:imageId`. Applicant payloads carry `canWithdraw`, `canResume`, `canPay`, `canUpdateCard`, `refundedTotal`.

### Public apply pages (layout)

Redesigned 2026-09-26 to match the event page's language (hero from PR #202, ticket stubs from `TierStub`):

- **`ApplyShell`** frames the index, form and status pages. Below the `OrganizationHeader` sits a dark hero: the event poster (`logoUrl`) blurred behind a black gradient, a kicker pill (`Get involved` / `Application`, the `kicker` prop), the title, a date tile from `lib/dateTile.ts` with date and time in the venue zone, and a venue block. A 4px `bg-brand` rule separates it from the page. `width="wide"` (`max-w-6xl`) is used only by the open form; everything else stays `max-w-3xl`.
- **Index**: each form is a torn stub (`.tier-stub` mask, `.tier-stub-shadow`): kind and name on the left; on the stub, the lowest price ("from $X" when the options differ) and an Apply pill, or the closed status. Only open forms are links.
- **Form**: numbered step cards (`Step`: Your details → Your business → A few questions → Before you submit). Spec 037 phase 5 removed the "Choose an option" step (tiers, add-ons, total) and every Stripe step: all forms submit straight to the status page. The organizer intro sits above the steps as a note with a brand edge. From `lg` up a sticky **Application summary** (`<aside aria-label="Application summary">`) holds "Cost to apply: Free", on PAID forms a three-step **What happens next** (`apply-next-steps`: apply → get approved → choose your space and pay), the error and the submit button. On phones it follows the last step.
- **Choose your space** (status page and buyer account, `ChooseSpace`): on TIERS forms and placed booths, numbered steps, each shown only when it asks something: **Choose your space type** (only when the vendor picks, `selection.categories`) → **Add extras** (only when the space type offers add-ons; `AddOnPicker`, "Skip extras" / "Continue to payment") → **Review and pay** (the `.tier-stub` card — category, description, "N spaces left" / "Your space is reserved", the all-in price — the chosen extras with Edit, how to pay when a saved card exists, the total and the hold button). A form with no extras and a fixed category lands straight on Review and pay, with no step meter. Each step's footer (total, Back, action) sticks to the bottom while the step is taller than the screen; moving between steps focuses the step heading (screen readers hear "Step 2 of 3: Review and pay"). Quantities survive Back / Edit. A `SOLD_OUT` on a vendor-picked type sends them back to the type step with fresh counts. MAP forms use the [Spot Chooser](spot-chooser.md) (spot → extras and payment). The held state shows where, the order lines, a once-a-second countdown (screen readers get the minute) and Pay / Change my choice. Motion is limited to a `motion-safe` spinner; nothing animates over capacity or payment state.
- **Status page layout**: two columns from `lg` (`ApplyShell width="wide"`, the apply form's grid): the status card and the space steps on the left, "What you told us" and the account link in a sticky aside on the right; phones stack them in that order. While the vendor is choosing, the status card shows one "Choose and pay by …" chip instead of the payment box, so "choose and pay" is not repeated. A MAP form's spot choice still takes the full width (`usesSpotWorkspace`).
- **Consents** (account opt-in, marketing, data consent) are all in the last step as bordered `has-[:checked]` choice rows. There is no card authorization any more (nothing is saved at submission).
- **Photos** preview as square thumbnails (`PhotoThumb`, local object URLs revoked on unmount) next to an "Add more" tile. The file input is visually hidden inside the dropzone label.
- The logic is unchanged: payload, validation order, legal versions, redirects and every `data-testid` stay the same. Only the receipt text changed: the last row reads `Total $X` instead of `= $X`.

### Phase 3 — scale and polish

- **CSV export** adds a `profilePhotos` column (`; `-joined absolute URLs, original variant) and makes PHOTO answers absolute via `absoluteAssetUrl` — a spreadsheet link works without the app.
- **Saved views** on the admin list are named filter sets (`form,status,payment,q,sort`) stored in `localStorage` under `jump.applications.views.<eventId>`; the URL remains the shareable form. "Save view" appears when filters are set and no view matches; picking a view rewrites the URL.
- **Bulk on PAID**: WAITLIST and REJECT run in bulk on any form; APPROVE stays per application on PAID forms (each approval charges the saved card). The bulk bar disables Approve when the selection includes a PAID row.
- **Applicant profile self-service**: `ApplicantProfileSection` on the account page edits name / description / website / socials (`PATCH /buyer/me/applicant-profile`), adds photos (`POST …/photos`, multipart `photos`, cap 6) and removes them. Changes apply to future applications only — submitted answers are not rewritten.
- **Price-changed notice**: `_serializeAdmin` adds `pricing: { currentApplicantPays, currentOrgReceives, changed }` by recomputing `tierAmounts` with today's tier price, fee mode and tax; the detail page shows an amber note while the snapshot stays the only amount charged.
- **Daily digest**: the hourly sweep calls `ApplicationDigestService.sendDue`. An organization is due when `applicationDigestAt` is null or ≥ 23 h old; the window is `(applicationDigestAt ?? now − 24 h, now]`, claimed with a conditional `updateMany` before reading so two backend instances never double-send. Submissions in the window are grouped by event → form (25 rows per form, then "…and N more") and mailed to every `OrganizationMember` (ORGANIZER and ADMIN) with an inline link per event to `/admin/events/:id/applications?status=SUBMITTED` and one **Open** button to `/admin/events` (spec 037; was the Participants list). Quiet windows still advance. Off switch: Settings › Applications → Daily digest (`applicationDigestEnabled`).
- **Event duplicate**: `POST /organizations/:orgId/events/:eventId/duplicate { date, name? }` (ORGANIZER+, `requireOrgMembership`) creates a DRAFT with the source's venue, description, image, capacity, category, cached tax rate and price tiers (inventory 0, sale windows cleared), then `copyForms` copies every form as DRAFT with no open/close window, tiers at full quantity, non-archived questions. Orders, tickets and applications are never copied. Response is the event detail plus `copiedForms`.

### Roles

ORGANIZER+ views forms/applications and decides. Configuring event forms, tiers, questions, tier add-ons and form templates is `applications.forms`, ADMIN and ORGANIZER by default (spec 050-E); refunds, waivers and offline payments stay `applications.money` (ADMIN). See `rbac.md`. Members are scoped through `resolveOrgScope` → `requireEvent(eventId, orgId)` (404 for another org's event); SYSTEM_ADMIN passes `null`.

## API Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/events/:eventId/applications/forms`, `/forms/:slug` | public |
| POST | `/events/:eventId/applications` | public, rate-limited (30/h per client IP) |
| GET | `/applications/:id/status?token=`; POST `…/resume`, `…/pay` (rate-limited) | token |
| POST | `/applications/:id/select?token=` `{ boothId?, addOns?, useSavedCard? }`, `…/release`, `…/booth` (a booth selection without add-ons), `…/cancel-checkout` — spec 037 phase 5 | token (`BOOTH_CHOOSE` limiter) |
| POST | `/buyer/me/applications/:id/select`, `…/release`, `…/booth`, `…/cancel-checkout` | buyer |
| GET/PATCH | `/buyer/me/applicant-profile`; POST `…/photos` (multipart `photos`), DELETE `…/photos/:imageId` | buyer |
| GET | `/buyer/me/applications`, `/buyer/me/applications/:id`; POST `…/withdraw`, `…/pay`, `…/update-card` | buyer |
| GET/POST | `/admin/events/:eventId/application-forms` (POST accepts `templateId`, spec 019) | organizer+ / admin |
| GET/PATCH/DELETE | `…/application-forms/:formId` | organizer+ / admin / admin |
| POST/PATCH/DELETE | `…/application-forms/:formId/tiers[/:tierId]` | admin |
| POST/PATCH/DELETE | `…/application-forms/:formId/questions[/:questionId]`, PATCH `…/questions/reorder` | admin |
| GET | `/admin/events/:eventId/applications` (`form,status,payment,tier,addOn,q,sort,page,pageSize`), `…/summary`, `…/export.csv` — org-wide twins under `/admin/applications*`, see [Participants](participants.md) | organizer+ |
| GET/PATCH | `…/applications/:id` (PATCH `boothLabel`, `internalNote`, and since spec 019 `tags`, `checkedIn`, `checkedOut`) | organizer+ |
| POST | `…/applications/:id/preview` `{ decision, tierId? }`, `…/applications/:id/decision` `{ decision, tierId?, note?, message?, sendEmail? }`, `…/applications/:id/charge`, `…/applications/bulk` | organizer+ |
| POST | `…/applications/:id/refund` `{ amount?, reason? }` | admin |
| POST | `/webhooks/stripe` — events whose `metadata.applicationId` is set (Checkout, SetupIntent, PaymentIntent) and `charge.refunded` for a known intent | Stripe |
| GET/PUT/DELETE | `/admin/settings/application-templates[/:action]` | organizer+ / admin / admin |
| GET/PATCH | `/admin/settings/application-digest` `{ enabled }` | organizer+ / admin |
| POST | `/organizations/:orgId/events/:eventId/duplicate` `{ date, name? }` | organizer+ (member of the org) |

## Testing

- `backend/tests/contract/applicationPayments.test.js` (rewritten for spec 037 phase 5) — submission without a category or order, approval with / without a category (400 `CATEGORY_REQUIRED`), CHOOSE_SPACE preview and email, reserved slot, a full category 409 + concurrent approvals, list selection → order + Checkout → webhook paid, first-come form (slot at selection, `SOLD_OUT`, hold lapse frees it, reselection reuses the order number), saved card off-session + decline → back to choosing, cancelled / expired Checkout, ABSORB refunds, Connect routing, `payment_failed`, overdue sweep on the approval clock, buyer select / pay / update-card, a legacy PAYMENT_DUE row paying through pay-now.
- `backend/tests/contract/boothPurchases.test.js` — booth selection on the new flow: hold + order, derived map binding, map / list selection view, release, one-winner race, webhook → SOLD, hold sweep vs booth sweep, decline, cancelled Checkout.
- `backend/tests/contract/applyThenChooseBackfill.test.js` + `tests/unit/applyThenChoose.test.js` — the D6 backfill (dry run writes nothing, every move, money untouched, idempotent), the planner, the approval clock and the live-order rule.
- `frontend/e2e/public-booth-purchase.spec.ts` (choose your space: map with saved card / Checkout, taken booth, decline, list + keyboard tabs + held countdown + release, placed booth, under review), `applications-approve-category.spec.ts` (Approve dialog category, full warning, preview, Awaiting space chip), `applications-add-ons.spec.ts` (apply form without tiers / add-ons / card; extras at selection).

- `backend/tests/contract/applications.test.js` — 21 cases: forms RBAC + validation, PAID cannot open, tier/question edits, tenant 404s, public read, submit validation, multipart submit with a real PNG, duplicates, status token, decisions + state machine, 3 concurrent approvals on a 1-slot tier, bulk, CSV, templates, buyer views.
- `backend/tests/contract/applicationPayments.test.js` — 16 cases with Stripe mocked: PAID form opens, setup-mode session + customer, resume / DRAFT replacement, setup webhook → CARD_ON_FILE + RECEIVED, approve → PaymentIntent params + idempotency key → PAID, decline → PAYMENT_DUE + email + due date, pay-now session + paid webhook, retry charge + outage path, 2 concurrent approvals on a 1-slot tier, SUBMIT timing, refunds (RBAC, partial/full, Stripe flags, `charge.refunded` idempotent), Connect destination + fee + `reverse_transfer`, ticket sessions never dispatched to applications, `payment_failed` idempotent + withdraw releases the slot, overdue sweep WITHDRAW/HOLD, buyer pay / update-card.
- `backend/tests/contract/applicationsPhase3.test.js` — 11 cases: CSV profile/answer photo URLs absolute under `BACKEND_URL`, `pricing.changed` after a tier price edit (snapshot untouched) and null for FREE, bulk WAITLIST/REJECT on PAID + APPROVE still refused, buyer profile PATCH/validation, photo upload/type rejection/removal/401, digest once per window + grouped body + quiet re-run + window advance, digest settings RBAC/validation/disabled skip, duplicate copies tiers + forms + questions into a DRAFT, duplicate validation/name/403/404.
- `backend/tests/unit/applicationFormService.test.js`, `applicationTemplates.test.js`, `applicationPayments.test.js` — fee modes, slug, acceptance, template rendering, derived token, `applicationFeeCents` identity per fee mode, webhook dispatch predicate.
- `frontend/e2e/applications.spec.ts` — event page strip, apply index, full press application → status page, bad token, admin list filters/search/bulk bar, detail + notes + waitlist with edited email + history, forms create/edit/add question, ORGANIZER builds forms (050-E), templates save; axe clean. Phase 3: saved views round-trip through `localStorage` + Approve disabled with a PAID row selected, price-changed note, daily digest toggle, Duplicate dialog on the events list.
- `frontend/e2e/applications-add-ons.spec.ts` — tier-scoped add-on picker, the summary's receipt (`Total $461.47`) and charge note, the "Choose an option to see your total." state before a tier is picked, and the submitted lines.
- `frontend/e2e/applications-payments.spec.ts` — status page pay-now → `checkout=paid` notice, resume an abandoned checkout, ADMIN partial + full refund from the payment card, ORGANIZER retry charge and no refund button.

## Gotchas

- **Webhook raw body**: `server.js` must not run `express.json()` on `/webhooks/*` — the route applies `express.raw` and `constructEvent` needs the bytes. Broken on main until PR #56; `tests/contract/webhookSignature.test.js` pins it with real signatures. Local flow: `stripe listen --api-key $STRIPE_SECRET_KEY --forward-to localhost:3002/webhooks/stripe`, copy the printed `whsec_…` into `backend/.env` `STRIPE_WEBHOOK_SECRET`, restart the backend (`tests/setup.js` blanks these so local values never reach the suites).
- **PAID forms need `APPLICATIONS_PAYMENTS_ENABLED=true`** — otherwise the API returns 409 on `status: OPEN`, PAID approvals and space selections, and the editor shows the warning. Tiers, fee mode and questions can be prepared before flipping it.
- **Apply-then-choose (spec 037 phase 5)**: never read `ApplicationTier.mapBound` (derive map binding from the published map); never treat a `CANCELLED` order on an application still in play as its amount (`hasLiveOrder`); `select` is the only way an approved PAID application gets a live order, and `releaseSelection` the only way a hold ends without payment. Run `npm run db:backfill:037-applications` right after deploying the two `20261011…_apply_then_choose*` migrations.
- **Synchronous `succeeded` marks PAID immediately**; the later `payment_intent.succeeded` webhook is a no-op (guarded on `paymentStatus`). Without a webhook (local dev) only the `processing` path and Checkout returns need one — run `stripe listen --forward-to localhost:3000/webhooks/stripe`.
- **Stripe Checkout `mode: setup` returns a SetupIntent id only**; the handler retrieves it for the payment method. In tests `setupIntents.retrieve` is mocked.
- **Only cards are saved** (`payment_method_types: ['card']` on setup and the off-session charge); pay-now and pay-at-submission sessions use the organization's enabled methods like ticket checkout.
- **A 3DS-required decline (`authentication_required`) becomes PAYMENT_DUE**; the hosted pay-now page handles the challenge.
- **Submissions never take capacity.** `remaining` on a tier only drops on approval; the public form shows "Full — you can still apply for the waitlist".
- **The RECEIVED email is awaited** in `submit` so tests and callers see it; `ApplicationTemplateService.send` swallows transport errors (logged as `application_email_failed`).
- **Photos inside the submit transaction**: `ImageService.processUpload` uses its own transaction, so a failed submission can leave an unreferenced `Image`; `POST /admin/images/cleanup` (existing) removes orphans.
- **Status token is single-purpose and derived from `AUTH_SECRET`**: it reads the applicant view and drives resume / pay-now; withdrawing, updating the card or editing the profile needs the buyer session. Rotating `AUTH_SECRET` invalidates every emailed status link.
- **Storefront hosts**: `/events/:id/apply/*` passes through the tenant-host middleware like the event page; the buyer account section works on `/account` there.
- **Digest cadence is anchored to the first run**, not a wall-clock hour: with the default hourly sweep it settles on the hour of the first send after deploy. `applicationDigestAt` is set even for quiet windows, so "Last checked" in Settings is the window end, not the last email.
- **Duplicate keeps the image row shared** (`imageId` copied, no new upload) — deleting the image from one event affects both. Sale windows on price tiers are cleared because they would be in the past; re-set them on the copy.
- **`requireOrgMembership` guards only the duplicate route** in `routes/events.js`; the older org event routes still rely on service-level `venue.organizationId` scoping. Worth aligning when those routes are next touched.
- Frontend `e2e` runs of unrelated specs (`theme-modes`, `admin-access`, `wcag-contrast`) fail on a clean tree in this environment too — not related to this feature.

## Related Features

- [Participants](participants.md) — the organization-wide submissions list built on the same service methods (spec 019).

- [Buyer Accounts](buyer-accounts.md) — applicant sign-in and account page
- [Fee Calculation](fee-calculation.md) — fee mode math
- [Connect Payouts](connect-payouts.md) — application charges are direct charges on the organization's account the same way ticket orders are (spec 047)
- [Payments Settings](payments-settings.md) — statement descriptor suffix and enabled methods apply to application checkouts
- [Refunds](refunds.md) — order/ticket refunds share `stripeRefund.js`
- [Email Notifications](email-notifications.md) — transport and branding shell
