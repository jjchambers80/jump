# Applications

**Status**: Implemented — phase 1 (FREE forms end to end), phase 2 (card on file at submission, off-session charge at approval, pay-now, refunds, overdue sweep) and phase 3 (CSV photo URLs, saved views, bulk waitlist/reject on PAID, applicant profile self-service, price-changed notice, organizer daily digest, event duplication) 2026-09-17. Paid forms run behind `APPLICATIONS_PAYMENTS_ENABLED`. Spec: `specs/011-applications/`.
**Last Updated**: 2026-09-17

## Overview

Per-event **application forms** for people who are not ticket buyers: vendors and sponsors (PAID forms with priced, capacity-limited tiers) and press, content creators, panelists (FREE forms). Applicants fill in a business profile (reused across the organization's events), answer the organizer's questions (10 types incl. photo upload), and get a status page link by email. Organizers review in an admin list, **approve / reject / waitlist / withdraw** with a templated, editable email, keep notes and a booth label, bulk-act on free forms, and export CSV. Capacity on PAID tiers is consumed by **approval**, never by submission, so waitlisting works. Review `status` and `paymentStatus` are independent columns. PAID forms save the applicant's card at submission (or take payment up front) and charge the saved card **only when approved**; a decline leaves the application approved with a pay-now link and a due date, and the slot is recycled if it lapses.

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
| `APPLICATIONS_PAYMENTS_ENABLED` | No (default off) | `true` lets PAID forms OPEN and accept submissions. Off: PAID forms stay configurable but `PATCH status=OPEN` → 409 and submissions → 409 |
| `APPLICATION_SWEEP_INTERVAL_MS` | No (default 1 h) | How often the application sweep runs (first run 30 s after boot): `sweepOverdue`, then `ApplicationDigestService.sendDue` |
| `BACKEND_URL` | No | Makes photo URLs in the CSV export and emails absolute (falls back to `https://$RAILWAY_PUBLIC_DOMAIN`, then `http://localhost:$PORT`) |
| `STRIPE_WEBHOOK_SECRET` | With Stripe | Same platform endpoint as orders; add `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded` to the endpoint's events |

Application charges use the organization's Settings › Payments as-is (statement descriptor suffix, Connect destination when active) — nothing extra to configure.

Photos use the existing image storage (bucket or local `uploads/`), max 6 profile photos + one per PHOTO question, 5 MB each, JPG/PNG/GIF/WebP.

## How It Works

### Forms

- `kind` PAID (tiers required to open) or FREE (no tiers). `status` DRAFT (hidden) → OPEN → CLOSED (visible, not accepting). Optional `opensAt`/`closesAt` window; `acceptance()` reports `open` + reason.
- PAID-only settings: `chargeTiming` SUBMIT|APPROVAL, `feeMode` PASS|ABSORB, `taxable`, `paymentDueDays` 1–30, `overduePolicy` WITHDRAW|HOLD.
- `tierAmounts(price, form, event, org)` runs `FeeService.computeOrderFees` once: PASS → applicant pays `total`, org receives `subtotal`; ABSORB → applicant pays `subtotal + tax`, org receives `subtotal − fees`. Admin sees both numbers per tier; the public form shows only the applicant price ("$303.30 incl. $28.30 fees").
- Questions are archived (`archivedAt`) instead of deleted once answered; type cannot change after answers exist. Slug unique per event, auto-derived from the name.

### Submission

`POST /events/:eventId/applications` — JSON, or multipart with `payload` (JSON string), `profilePhotos` (≤6) and `answer:<questionId>` files. Validates window, PAID flag, tier, contact, profile, every answer against its question type/options/required. In one transaction: `Contact` upsert (org + lowercased email, marketing opt-in), duplicate check (one active application per contact per form), profile upsert + photos, answers (PHOTO → `Image`), application row. FREE → `SUBMITTED` + RECEIVED email (awaited, never throws). PAID → `DRAFT` + a Stripe Checkout URL (`next: 'checkout'`): **setup mode** for `chargeTiming: APPROVAL` (card saved, nothing charged), **payment mode** for `SUBMIT`. The response is `{ applicationId, statusUrl, next, checkoutUrl? }`. A new submission by the same contact replaces an abandoned DRAFT; `POST /applications/:id/resume?token=` mints a fresh session for one. The status token is **derived** — `HMAC-SHA256(AUTH_SECRET, "application-status:<id>")` — so every later email (decision, payment due) can carry a working link; `statusTokenHash` stores its sha256 and the page honours a 180-day TTL.

### Card on file → charge at approval

`checkout.session.completed` (mode `setup`) → `stripe.setupIntents.retrieve` → `stripePaymentMethodId` on the row, `Contact.stripeCustomerId`, `SUBMITTED` + `CARD_ON_FILE`, RECEIVED email. Approving such an application (inside the decision transaction) reserves the tier slot (`quantityReserved`), sets `PROCESSING`, bumps `chargeAttempts`, then after commit `ApplicationPaymentService.chargeOnApproval` creates a `PaymentIntent` — `off_session: true, confirm: true`, the saved customer + card, the snapshot `applicantPays` in cents, `statement_descriptor_suffix` / `transfer_data` / `application_fee_amount` from `PaymentSettingsService.checkoutOptionsFor(org, { fees: { subtotal: orgReceives }, lineItems })` (so the platform fee is exactly `applicantPays − orgReceives`), idempotency key `application:<id>:charge:<attempt>`. Outcomes:

| Stripe result | Row | Email |
|---|---|---|
| `succeeded` | `PAID`, `paidAt`, slot reserved → approved | APPROVED (organizer's edited message honoured) |
| `processing` | stays `PROCESSING`; UI polls | sent by the webhook (`payment_intent.succeeded` → APPROVED, `payment_failed` → PAYMENT_DUE) |
| card error (`StripeCardError`, `authentication_required`) | `PAYMENT_DUE`, `paymentDueAt = now + form.paymentDueDays`, slot stays reserved | PAYMENT_DUE with the pay-now link |
| other error (network) | back to `CARD_ON_FILE`, slot reserved, 400 to the organizer | none — retry |

`POST …/applications/:id/charge` (organizer+) retries the saved card for an `APPROVED + PAYMENT_DUE` row (e.g. after the applicant updated the card). Pay-now (`POST /applications/:id/pay?token=`, `POST /buyer/me/applications/:id/pay`) opens a payment-mode Checkout for the snapshot amount; its `checkout.session.completed` marks `PAID` and confirms the slot. `POST /buyer/me/applications/:id/update-card` opens a setup-mode session that only replaces `stripePaymentMethodId`. Other decisions are refused (409) while a charge is `PROCESSING`.

### Refunds and the overdue sweep

`POST …/applications/:id/refund { amount?, reason? }` (ADMIN) — partial or the remaining balance, `ApplicationRefund` row, Stripe refund via `createStripeRefund` with `reverse_transfer` + `refund_application_fee` when the charge was routed to a connected account; `paymentStatus` becomes `PARTIALLY_REFUNDED` / `REFUNDED`, review status untouched (withdraw separately to free the slot). Refunds made in the Stripe dashboard arrive as `charge.refunded` and are reconciled by `stripeRefundId`.

`sweepOverdue()` (hourly, `unref`) finds `APPROVED + PAYMENT_DUE` rows past `paymentDueAt`: form policy `WITHDRAW` → `WITHDRAWN` by `SYSTEM` (`payment_overdue`), slot released, WITHDRAWN email; `HOLD` → `overdue = true`, shown in red on the admin detail; organizer decides.

### Decisions

`POST /admin/events/:eventId/applications/:id/decision { decision, note?, message?, sendEmail? }` — `DECISIONS` table: APPROVE (from SUBMITTED/WAITLISTED), REJECT (same), WAITLIST (from SUBMITTED), WITHDRAW (from SUBMITTED/WAITLISTED/APPROVED). Runs under `SELECT … FOR UPDATE` on the application; approving a tiered application does `UPDATE "ApplicationTier" SET quantityApproved+1 WHERE remaining >= 1 RETURNING` → 409 `tier is full` (details `suggestion: WAITLIST`) when it loses the race. Leaving APPROVED releases the slot (`capacitySlot` remembers which counter). Every decision writes an `ApplicationDecision` with the note and the email actually sent (subject/body). `message` overrides the rendered template for this send only; `sendEmail: false` skips it. `POST …/preview { decision }` returns the rendered template for the dialog. Bulk (`POST …/bulk`) refuses APPROVE on PAID forms.

### Templates

Per organization per action (`RECEIVED`, `APPROVED`, `REJECTED`, `WAITLISTED`, `WITHDRAWN`, `PAYMENT_DUE`), defaults from `config/applications.js`. Plain text; `{{applicant.firstName}}`, `{{profile.businessName}}`, `{{event.name}}`, `{{tier.name}}`, `{{links.status}}` etc.; `{{#tier}}…{{/tier}}` sections. Values are HTML-escaped and rendered into the branded email shell (paragraphs, bare URLs become buttons). Unbalanced sections are rejected on save.

### Applicant views

Guest: `GET /applications/:id/status?token=` (+ `POST …/resume`, `POST …/pay`). The status page reads `?checkout=submitted|paid|card_updated|cancelled` on return from Stripe and polls briefly until the webhook lands. Signed in (buyer magic link, spec 007): `GET /buyer/me/applications[/:id]`, `POST …/withdraw` (SUBMITTED/WAITLISTED only), `POST …/pay`, `POST …/update-card`, `GET/PATCH /buyer/me/applicant-profile`, `DELETE …/photos/:imageId`. Applicant payloads carry `canWithdraw`, `canResume`, `canPay`, `canUpdateCard`, `refundedTotal`.

### Phase 3 — scale and polish

- **CSV export** adds a `profilePhotos` column (`; `-joined absolute URLs, original variant) and makes PHOTO answers absolute via `absoluteAssetUrl` — a spreadsheet link works without the app.
- **Saved views** on the admin list are named filter sets (`form,status,payment,q,sort`) stored in `localStorage` under `jump.applications.views.<eventId>`; the URL remains the shareable form. "Save view" appears when filters are set and no view matches; picking a view rewrites the URL.
- **Bulk on PAID**: WAITLIST and REJECT run in bulk on any form; APPROVE stays per application on PAID forms (each approval charges the saved card). The bulk bar disables Approve when the selection includes a PAID row.
- **Applicant profile self-service**: `ApplicantProfileSection` on the account page edits name / description / website / socials (`PATCH /buyer/me/applicant-profile`), adds photos (`POST …/photos`, multipart `photos`, cap 6) and removes them. Changes apply to future applications only — submitted answers are not rewritten.
- **Price-changed notice**: `_serializeAdmin` adds `pricing: { currentApplicantPays, currentOrgReceives, changed }` by recomputing `tierAmounts` with today's tier price, fee mode and tax; the detail page shows an amber note while the snapshot stays the only amount charged.
- **Daily digest**: the hourly sweep calls `ApplicationDigestService.sendDue`. An organization is due when `applicationDigestAt` is null or ≥ 23 h old; the window is `(applicationDigestAt ?? now − 24 h, now]`, claimed with a conditional `updateMany` before reading so two backend instances never double-send. Submissions in the window are grouped by event → form (25 rows per form, then "…and N more") and mailed to every `OrganizationMember` (ORGANIZER and ADMIN) with a link to `/admin/events/:id/applications?status=SUBMITTED`. Quiet windows still advance. Off switch: Settings › Applications → Daily digest (`applicationDigestEnabled`).
- **Event duplicate**: `POST /organizations/:orgId/events/:eventId/duplicate { date, name? }` (ORGANIZER+, `requireOrgMembership`) creates a DRAFT with the source's venue, description, image, capacity, category, cached tax rate and price tiers (inventory 0, sale windows cleared), then `copyForms` copies every form as DRAFT with no open/close window, tiers at full quantity, non-archived questions. Orders, tickets and applications are never copied. Response is the event detail plus `copiedForms`.

### Roles

ORGANIZER+ views forms/applications and decides; ADMIN/SYSTEM_ADMIN configures forms, tiers, questions, templates. Members are scoped through `resolveOrgScope` → `requireEvent(eventId, orgId)` (404 for another org's event); SYSTEM_ADMIN passes `null`.

## API Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/events/:eventId/applications/forms`, `/forms/:slug` | public |
| POST | `/events/:eventId/applications` | public, rate-limited (30/h per client IP) |
| GET | `/applications/:id/status?token=`; POST `…/resume`, `…/pay` (rate-limited) | token |
| GET/PATCH | `/buyer/me/applicant-profile`; POST `…/photos` (multipart `photos`), DELETE `…/photos/:imageId` | buyer |
| GET | `/buyer/me/applications`, `/buyer/me/applications/:id`; POST `…/withdraw`, `…/pay`, `…/update-card` | buyer |
| GET/POST | `/admin/events/:eventId/application-forms` (POST accepts `templateId`, spec 019) | organizer+ / admin |
| GET/PATCH/DELETE | `…/application-forms/:formId` | organizer+ / admin / admin |
| POST/PATCH/DELETE | `…/application-forms/:formId/tiers[/:tierId]` | admin |
| POST/PATCH/DELETE | `…/application-forms/:formId/questions[/:questionId]`, PATCH `…/questions/reorder` | admin |
| GET | `/admin/events/:eventId/applications` (`form,status,payment,tier,addOn,q,sort,page,pageSize`), `…/summary`, `…/export.csv` — org-wide twins under `/admin/applications*`, see [Participants](participants.md) | organizer+ |
| GET/PATCH | `…/applications/:id` (PATCH `boothLabel`, `internalNote`, and since spec 019 `tags`, `checkedIn`, `checkedOut`) | organizer+ |
| POST | `…/applications/:id/preview`, `…/applications/:id/decision`, `…/applications/:id/charge`, `…/applications/bulk` | organizer+ |
| POST | `…/applications/:id/refund` `{ amount?, reason? }` | admin |
| POST | `/webhooks/stripe` — events whose `metadata.applicationId` is set (Checkout, SetupIntent, PaymentIntent) and `charge.refunded` for a known intent | Stripe |
| GET/PUT/DELETE | `/admin/settings/application-templates[/:action]` | organizer+ / admin / admin |
| GET/PATCH | `/admin/settings/application-digest` `{ enabled }` | organizer+ / admin |
| POST | `/organizations/:orgId/events/:eventId/duplicate` `{ date, name? }` | organizer+ (member of the org) |

## Testing

- `backend/tests/contract/applications.test.js` — 21 cases: forms RBAC + validation, PAID cannot open, tier/question edits, tenant 404s, public read, submit validation, multipart submit with a real PNG, duplicates, status token, decisions + state machine, 3 concurrent approvals on a 1-slot tier, bulk, CSV, templates, buyer views.
- `backend/tests/contract/applicationPayments.test.js` — 16 cases with Stripe mocked: PAID form opens, setup-mode session + customer, resume / DRAFT replacement, setup webhook → CARD_ON_FILE + RECEIVED, approve → PaymentIntent params + idempotency key → PAID, decline → PAYMENT_DUE + email + due date, pay-now session + paid webhook, retry charge + outage path, 2 concurrent approvals on a 1-slot tier, SUBMIT timing, refunds (RBAC, partial/full, Stripe flags, `charge.refunded` idempotent), Connect destination + fee + `reverse_transfer`, ticket sessions never dispatched to applications, `payment_failed` idempotent + withdraw releases the slot, overdue sweep WITHDRAW/HOLD, buyer pay / update-card.
- `backend/tests/contract/applicationsPhase3.test.js` — 11 cases: CSV profile/answer photo URLs absolute under `BACKEND_URL`, `pricing.changed` after a tier price edit (snapshot untouched) and null for FREE, bulk WAITLIST/REJECT on PAID + APPROVE still refused, buyer profile PATCH/validation, photo upload/type rejection/removal/401, digest once per window + grouped body + quiet re-run + window advance, digest settings RBAC/validation/disabled skip, duplicate copies tiers + forms + questions into a DRAFT, duplicate validation/name/403/404.
- `backend/tests/unit/applicationFormService.test.js`, `applicationTemplates.test.js`, `applicationPayments.test.js` — fee modes, slug, acceptance, template rendering, derived token, `applicationFeeCents` identity per fee mode, webhook dispatch predicate.
- `frontend/e2e/applications.spec.ts` — event page strip, apply index, full press application → status page, bad token, admin list filters/search/bulk bar, detail + notes + waitlist with edited email + history, forms create/edit/add question, ORGANIZER read-only, templates save; axe clean. Phase 3: saved views round-trip through `localStorage` + Approve disabled with a PAID row selected, price-changed note, daily digest toggle, Duplicate dialog on the events list.
- `frontend/e2e/applications-payments.spec.ts` — status page pay-now → `checkout=paid` notice, resume an abandoned checkout, ADMIN partial + full refund from the payment card, ORGANIZER retry charge and no refund button.

## Gotchas

- **Webhook raw body**: `server.js` must not run `express.json()` on `/webhooks/*` — the route applies `express.raw` and `constructEvent` needs the bytes. Broken on main until PR #56; `tests/contract/webhookSignature.test.js` pins it with real signatures. Local flow: `stripe listen --api-key $STRIPE_SECRET_KEY --forward-to localhost:3002/webhooks/stripe`, copy the printed `whsec_…` into `backend/.env` `STRIPE_WEBHOOK_SECRET`, restart the backend (`tests/setup.js` blanks these so local values never reach the suites).
- **PAID forms need `APPLICATIONS_PAYMENTS_ENABLED=true`** — otherwise the API returns 409 on `status: OPEN` and the editor shows the warning. Tiers, fee mode and questions can be prepared before flipping it.
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
- [Connect Payouts](connect-payouts.md) — application charges become destination charges the same way ticket orders do
- [Payments Settings](payments-settings.md) — statement descriptor suffix and enabled methods apply to application checkouts
- [Refunds](refunds.md) — order/ticket refunds share `stripeRefund.js`
- [Email Notifications](email-notifications.md) — transport and branding shell
