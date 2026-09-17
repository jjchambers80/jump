# Implementation Plan: Applications (spec 011)

**Status**: Planned 2026-09-16. Phase 1 built 2026-09-17 (PR #53). Phase 2 built 2026-09-17 on top of the spec 010 phase 2 stack (#49–#51), which it depends on for Connect routing on application charges. Phase 3 not started.
**Spec**: [spec.md](./spec.md). Research: [Eventeny organizer interview](../../docs/research/2026-09-15-eventeny-organizer-interview.md).
**Estimate**: phase 1 ~5 days, phase 2 ~6 days, phase 3 ~3 days.

---

## 1. What exists and is reused

| Piece | Location | Reuse |
|---|---|---|
| `PriceTier` capacity: `UPDATE … WHERE quantityTotal − quantitySold − quantityReserved >= $1 RETURNING *` | `OrderService.createOrder` | Same statement shape on `ApplicationTier` at approval |
| `Contact` upsert per org + lowercased email; never linked to `User` | `OrderService.createOrder` step 3 | Applicants are Contacts |
| Buyer magic link (`BuyerAuthService`, `requireBuyer`, `/buyer/me/*`) | `backend/src/api/routes/buyerAuth.js` | Applicant account view |
| `FeeService.computeOrderFees(items, taxRate, { taxInclusive })` | `backend/src/services/FeeService.js` | Amount snapshot per application |
| `PaymentSettingsService.checkoutOptionsFor(org, { fees, lineItems })` + `applicationFeeCents` | spec 010 | Payment-mode Checkout for `SUBMIT` timing and pay-now |
| `ConnectService.destinationFor(orgId)` | spec 010 phase 2 | Off-session PaymentIntent routing |
| `RefundService._createStripeRefund(pi, amount, reason, { connected })` | spec 010 phase 2 | Application refunds (extract to a shared helper) |
| `ImageService.processUpload` + `uploadImage` multer middleware, `GET /images/:id/:hash/:variant` | | Profile photos and PHOTO answers |
| `EmailService` (Resend, retry, org branding header) | | Template rendering + send |
| Platform webhook `POST /webhooks/stripe` | `routes/webhooks.js` | New cases keyed on `metadata.applicationId` |
| Domain sweep pattern (`setInterval(...).unref()`) | `server.js` | Overdue sweep |
| Settings/admin UI shells: `SettingsDialog`, `SummaryRow`, list + drawer patterns in `admin/customers`, `admin/orders` | frontend | Admin list/detail |
| Storefront routing on custom domains (`storefrontFor`, `middleware.ts`) | spec 007 | Public apply pages must work on tenant hosts |

Not reused: `Order`/`OrderItem`/`Ticket` — an application is not an order (no tickets, different lifecycle, one line). `PaymentTransaction` is 1:1 with `Order`; applications carry their own Stripe ids.

---

## 2. Design

### 2.1 Lifecycle

```
                     free form                      paid form (chargeTiming)
DRAFT ──submit──▶ SUBMITTED                DRAFT ──Checkout setup ok──▶ SUBMITTED / CARD_ON_FILE     (APPROVAL)
                                            DRAFT ──Checkout payment ok─▶ SUBMITTED / PAID            (SUBMIT)
SUBMITTED | WAITLISTED ──approve──▶ APPROVED      (+ charge if CARD_ON_FILE → PROCESSING → PAID | PAYMENT_DUE)
SUBMITTED | WAITLISTED ──reject───▶ REJECTED
SUBMITTED ──waitlist──▶ WAITLISTED
SUBMITTED | WAITLISTED | APPROVED ──withdraw──▶ WITHDRAWN   (organizer; applicant only from SUBMITTED/WAITLISTED)
APPROVED + PAYMENT_DUE ──pay-now──▶ PAID     ──overdue sweep──▶ WITHDRAWN (policy WITHDRAW) | flagged (HOLD)
APPROVED + PAID ──refund──▶ REFUNDED | PARTIALLY_REFUNDED (status stays APPROVED unless withdrawn)
```

`status` (review) and `paymentStatus` (money) are independent columns; the UI composes them ("Approved · Payment due by Oct 3").

### 2.2 Capacity

Two counters on `ApplicationTier`: `quantityApproved` (paid or free approvals that hold a space) and `quantityReserved` (approved, charge in flight or due). Approval runs:

```sql
UPDATE "ApplicationTier" SET "quantityReserved" = "quantityReserved" + 1
WHERE id = $1 AND ("quantityTotal" - "quantityApproved" - "quantityReserved") >= 1 RETURNING *
```

Free form or `PAID` already paid at submission: move straight to `quantityApproved`. `PAID` via webhook: reserved → approved. Withdraw / overdue / reject-after-approve: decrement whichever counter holds it (the application records `capacitySlot: NONE|RESERVED|APPROVED`). Submissions never consume capacity — waitlisting is the point.

### 2.3 Money

Amount snapshot at submission via `FeeService.computeOrderFees([{ unitPrice: tier.price, quantity: 1 }], taxable ? event.taxRate : 0, { taxInclusive })`:

| feeMode | applicant pays | organization receives (Connect) | platform keeps |
|---|---|---|---|
| `PASS` | `total` | `subtotal` | `platformFee + processingFee + tax` |
| `ABSORB` | `subtotal + tax` | `subtotal − platformFee − processingFee` | same |

`ABSORB` recomputes fees on the listed price so the applicant sees the listed number; `applicantPays` and `orgReceives` are both stored. Application fee cents for Connect = `applicantPaysCents − orgReceivesCents` (same subtraction principle as spec 010).

Charge paths:
- **Setup at submission** (`APPROVAL`): Checkout `mode: 'setup'`, `payment_method_types: ['card']`, `customer` (create/reuse `Contact.stripeCustomerId`), `metadata: { applicationId }`, `success_url` → application status page, `expires_at` 30 min. `checkout.session.completed` (mode setup) → `setup_intent` → `payment_method` stored on the application, `paymentStatus = CARD_ON_FILE`, `status = SUBMITTED`, RECEIVED email.
- **Charge at approval**: `paymentIntents.create({ amount: applicantPaysCents, currency, customer, payment_method, off_session: true, confirm: true, payment_method_types: ['card'], statement_descriptor_suffix, transfer_data?, application_fee_amount?, metadata: { applicationId, organizationId } })` with an idempotency key `application:<id>:charge:<attempt>`. Result `succeeded` → `PROCESSING` (webhook → `PAID`); `requires_action` / card error → `PAYMENT_DUE`. Stripe's `authentication_required` decline is treated as a failure → pay-now (hosted page handles 3DS).
- **Payment at submission** (`SUBMIT`) and **pay-now**: Checkout `mode: 'payment'`, one line item at `applicantPaysCents`, `...checkoutOptionsFor(org, { fees: { subtotal: orgReceives }, lineItems })` so spec 010 routing applies unchanged, `metadata: { applicationId }`. Completed with `payment_status = paid` → `PAID`.
- **Refund**: shared helper `stripeRefund({ paymentIntentId, amountCents, connected })` extracted from `RefundService`; `ApplicationRefund` row; pro-rata Connect flags.

### 2.4 Webhook dispatch

`routes/webhooks.js` gains a first branch: if `event.data.object.metadata?.applicationId` (Checkout Session, PaymentIntent, SetupIntent) or a `charge.refunded` whose `payment_intent.metadata.applicationId` is set → `ApplicationPaymentService.handleEvent(event)`; else existing ticket handling. All handlers idempotent on the stored Stripe ids and current `paymentStatus`.

### 2.5 Templates

`ApplicationMessageTemplate` per organization + action; seeded lazily with defaults (`config/applicationTemplates.js`). Rendering: `{{path}}` replacement over a whitelisted context (`applicant`, `profile`, `event`, `form`, `tier`, `amount`, `payment`, `links`), HTML-escaped, unknown keys left blank. The decision endpoint takes `{ action, note?, message?: { subject, body } }`; when `message` is absent the template is rendered server-side. The sent subject/body are stored on `ApplicationDecision` for the audit trail.

### 2.6 Public form

Route on the storefront: `/events/[eventId]/apply` (list) and `/events/[eventId]/apply/[formSlug]`; on a tenant host the same paths rewrite like the event page. Client flow: load form → (optional) buyer session prefill (`GET /buyer/me/applicant-profile`) → fill → `POST /events/:eventId/applications` multipart (answers JSON + photos) → response `{ applicationId, next: 'done' | 'checkout', checkoutUrl? }` → redirect. Status page `/events/[eventId]/apply/status/[applicationId]?token=` uses a signed short token issued at submission (like order confirmation UUID lookup) so guests can see the result without an account; the RECEIVED email carries the same link and a magic-link CTA.

### 2.7 Admin

- `/admin/events/[eventId]/applications` — tabs per form; table: business/contact, tier, submitted, status pill, payment pill, amount; filters; search; bulk bar; Export CSV.
- Row → drawer/page `/admin/events/[eventId]/applications/[applicationId]`: profile + photos, answers, payment timeline (events from Stripe ids), decision actions with `DecisionDialog` (template preview, editable, internal note), refund dialog (ADMIN), booth label field.
- `/admin/events/[eventId]/applications/forms` (ADMIN): form list, `FormEditor` (settings, tiers table, questions builder with drag order, templates tab).
- Event page sidebar/nav gains "Applications" with a count badge of `SUBMITTED`.

---

## 3. Data model

```prisma
enum ApplicationFormKind   { PAID FREE }
enum ApplicationFormStatus { DRAFT OPEN CLOSED }
enum ChargeTiming          { SUBMIT APPROVAL }
enum FeeMode               { PASS ABSORB }
enum OverduePolicy         { WITHDRAW HOLD }
enum ApplicationStatus     { DRAFT SUBMITTED WAITLISTED APPROVED REJECTED WITHDRAWN }
enum ApplicationPayment    { NOT_REQUIRED AWAITING_CARD CARD_ON_FILE PROCESSING PAID PAYMENT_DUE REFUNDED PARTIALLY_REFUNDED }
enum CapacitySlot          { NONE RESERVED APPROVED }
enum QuestionType          { SHORT_TEXT LONG_TEXT SINGLE_CHOICE MULTI_CHOICE CHECKBOX URL EMAIL PHONE NUMBER PHOTO }
enum ApplicationAction     { RECEIVED APPROVED REJECTED WAITLISTED WITHDRAWN PAYMENT_DUE }
enum WithdrawnBy           { ORGANIZER APPLICANT SYSTEM }

model ApplicationForm {
  id              String   @id @default(cuid())
  eventId         String
  kind            ApplicationFormKind
  name            String
  slug            String
  intro           String?
  status          ApplicationFormStatus @default(DRAFT)
  opensAt         DateTime?
  closesAt        DateTime?
  chargeTiming    ChargeTiming  @default(APPROVAL)
  feeMode         FeeMode       @default(PASS)
  taxable         Boolean       @default(false)
  paymentDueDays  Int           @default(7)
  overduePolicy   OverduePolicy @default(WITHDRAW)
  displayOrder    Int           @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  event        Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  tiers        ApplicationTier[]
  questions    ApplicationQuestion[]
  applications Application[]
  @@unique([eventId, slug])
  @@index([eventId, status])
}

model ApplicationTier {
  id               String  @id @default(cuid())
  formId           String
  name             String
  description      String?
  price            Decimal @db.Decimal(10, 2)
  quantityTotal    Int
  quantityApproved Int     @default(0)
  quantityReserved Int     @default(0)
  displayOrder     Int     @default(0)
  isActive         Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  form         ApplicationForm @relation(fields: [formId], references: [id], onDelete: Cascade)
  applications Application[]
  @@index([formId])
}

model ApplicationQuestion {
  id           String       @id @default(cuid())
  formId       String
  label        String
  helpText     String?
  type         QuestionType
  required     Boolean      @default(false)
  options      String[]     @default([])
  displayOrder Int          @default(0)
  archivedAt   DateTime?
  form    ApplicationForm     @relation(fields: [formId], references: [id], onDelete: Cascade)
  answers ApplicationAnswer[]
  @@index([formId])
}

model ApplicantProfile {
  id             String  @id @default(cuid())
  organizationId String
  contactId      String
  businessName   String
  description    String?
  website        String?
  socials        Json?            // { instagram, tiktok, facebook, x, youtube, other }
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  contact      Contact      @relation(fields: [contactId], references: [id], onDelete: Cascade)
  images       ApplicantProfileImage[]
  applications Application[]
  @@unique([organizationId, contactId])
}

model ApplicantProfileImage {
  id           String @id @default(cuid())
  profileId    String
  imageId      String
  displayOrder Int    @default(0)
  profile ApplicantProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  image   Image            @relation(fields: [imageId], references: [id])
  @@unique([profileId, imageId])
}

model Application {
  id                    String            @id @default(cuid())
  formId                String
  eventId               String
  organizationId        String
  contactId             String
  profileId             String
  tierId                String?
  status                ApplicationStatus @default(DRAFT)
  paymentStatus         ApplicationPayment @default(NOT_REQUIRED)
  capacitySlot          CapacitySlot      @default(NONE)
  // amount snapshot (dollars) at submission
  subtotal              Decimal @db.Decimal(10, 2) @default(0)
  platformFee           Decimal @db.Decimal(10, 2) @default(0)
  processingFee         Decimal @db.Decimal(10, 2) @default(0)
  tax                   Decimal @db.Decimal(10, 2) @default(0)
  applicantPays         Decimal @db.Decimal(10, 2) @default(0)
  orgReceives           Decimal @db.Decimal(10, 2) @default(0)
  feeMode               FeeMode @default(PASS)
  currency              String  @default("usd")
  // Stripe (platform account objects)
  stripeCheckoutSessionId String? @unique
  stripePaymentMethodId   String?
  stripePaymentIntentId   String? @unique
  stripeAccountId         String?          // destination account when routed
  applicationFee          Decimal? @db.Decimal(10, 2)
  chargeAttempts          Int      @default(0)
  paidAt                  DateTime?
  paymentDueAt            DateTime?
  overdue                 Boolean  @default(false)
  // review
  submittedAt   DateTime?
  decidedAt     DateTime?
  decidedById   String?
  internalNote  String?
  withdrawnBy   WithdrawnBy?
  withdrawReason String?
  boothLabel    String?
  statusToken   String   @unique          // guest status-page token (hashed)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  form      ApplicationForm  @relation(fields: [formId], references: [id])
  event     Event            @relation(fields: [eventId], references: [id])
  contact   Contact          @relation(fields: [contactId], references: [id])
  profile   ApplicantProfile @relation(fields: [profileId], references: [id])
  tier      ApplicationTier? @relation(fields: [tierId], references: [id])
  answers   ApplicationAnswer[]
  decisions ApplicationDecision[]
  refunds   ApplicationRefund[]
  @@index([eventId, status])
  @@index([formId, status])
  @@index([contactId])
  @@index([paymentStatus, paymentDueAt])
}

model ApplicationAnswer {
  id            String @id @default(cuid())
  applicationId String
  questionId    String
  valueText     String?
  valueJson     Json?             // MULTI_CHOICE
  imageId       String?           // PHOTO
  application Application         @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  question    ApplicationQuestion @relation(fields: [questionId], references: [id])
  image       Image?              @relation(fields: [imageId], references: [id])
  @@unique([applicationId, questionId])
}

model ApplicationDecision {
  id            String            @id @default(cuid())
  applicationId String
  action        ApplicationAction
  byUserId      String?           // null = system (overdue sweep) or applicant
  note          String?
  emailSubject  String?
  emailBody     String?
  createdAt     DateTime          @default(now())
  application Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  @@index([applicationId])
}

model ApplicationRefund {
  id             String       @id @default(cuid())
  applicationId  String
  amount         Decimal      @db.Decimal(10, 2)
  reason         String?
  status         RefundStatus @default(PENDING)
  stripeRefundId String?      @unique
  initiatedBy    String?
  createdAt      DateTime     @default(now())
  application Application @relation(fields: [applicationId], references: [id])
  @@index([applicationId])
}

model ApplicationMessageTemplate {
  id             String            @id @default(cuid())
  organizationId String
  action         ApplicationAction
  subject        String
  body           String            // plain text with {{merge}} fields; rendered into the branded email shell
  updatedAt      DateTime          @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([organizationId, action])
}

// existing models
model Contact      { … stripeCustomerId String? @unique … applicantProfiles ApplicantProfile[] }
model Event        { … applicationForms ApplicationForm[]  applications Application[] }
model Organization { … applicantProfiles ApplicantProfile[]  applicationTemplates ApplicationMessageTemplate[] }
model Image        { … profileUses ApplicantProfileImage[]  answerUses ApplicationAnswer[] }
```

One migration per phase (phase 1 without the Stripe/amount columns is possible but not worth the churn — ship the whole model in phase 1, leave payment columns unused).

---

## 4. Backend

### 4.1 Services

| Service | Responsibilities |
|---|---|
| `ApplicationFormService` | CRUD forms/tiers/questions with validation (PAID needs ≥1 active tier to OPEN; FREE cannot have tiers; slug unique per event; question archive not delete); public read shape (`forms`, `tiers` with `remaining`, `questions` unarchived, computed `applicantPrice` per tier per fee mode) |
| `ApplicantProfileService` | upsert per org + contact; photos (max 6, via `ImageService` with `usageType: 'applicant_profile'`); prefill payload |
| `ApplicationService` | submit (validate window, duplicates, required answers, choice options, photo types), amount snapshot, status token, decisions (`approve`, `reject`, `waitlist`, `withdraw`) with capacity transaction, applicant withdraw, list/filter/search, CSV export, bulk actions |
| `ApplicationPaymentService` | Checkout setup/payment sessions, off-session charge, pay-now session, `handleEvent(stripeEvent)`, refunds, overdue sweep, Stripe dashboard links |
| `ApplicationTemplateService` | defaults, get/update per org, `render(action, application)` → `{ subject, html, text }`, send via `EmailService.sendApplicationMessage` |

`RefundService._createStripeRefund` → move to `backend/src/services/stripeRefund.js` (`createStripeRefund({ paymentIntentId, amount, reason, connected })`), keep the method as a thin wrapper so existing tests pass.

### 4.2 Routes

Public (`routes/applications.js`, mounted at `/events/:eventId/applications`):

| Method | Path | Notes |
|---|---|---|
| GET | `/events/:eventId/applications/forms` | open + upcoming forms, tiers, questions |
| GET | `/events/:eventId/applications/forms/:slug` | one form |
| POST | `/events/:eventId/applications` | multipart; body `{ formSlug, tierId?, contact, profile, answers, optInAccount?, optInMarketing? }` + `photos[]`; rate-limited; → `{ applicationId, statusUrl, next, checkoutUrl? }` |
| GET | `/applications/:id/status?token=` | guest status view (masked) |
| POST | `/applications/:id/resume?token=` | new Checkout URL for a `DRAFT`/`AWAITING_CARD` |

Buyer (`routes/buyerAuth.js`, `requireBuyer`):

| Method | Path |
|---|---|
| GET | `/buyer/me/applicant-profile` |
| GET | `/buyer/me/applications` |
| GET | `/buyer/me/applications/:id` |
| POST | `/buyer/me/applications/:id/pay` → `{ url }` |
| POST | `/buyer/me/applications/:id/update-card` → `{ url }` (setup mode) |
| POST | `/buyer/me/applications/:id/withdraw` |

Admin (`routes/admin.js`, org-scoped, event ownership checked):

| Method | Path | Role |
|---|---|---|
| GET/POST | `/admin/events/:eventId/application-forms` | GET organizer+, POST admin |
| GET/PATCH/DELETE | `/admin/events/:eventId/application-forms/:formId` | admin (DELETE only when no applications) |
| POST/PATCH/DELETE | `…/application-forms/:formId/tiers[/:tierId]` | admin |
| POST/PATCH/DELETE | `…/application-forms/:formId/questions[/:questionId]` | admin (DELETE = archive) |
| GET | `/admin/events/:eventId/applications?form=&status=&payment=&tier=&q=&sort=&page=` | organizer+ |
| GET | `/admin/events/:eventId/applications/export.csv` (same filters) | organizer+ |
| GET | `/admin/events/:eventId/applications/:id` | organizer+ |
| POST | `/admin/events/:eventId/applications/:id/decision` `{ action, note?, message? }` | organizer+ |
| POST | `/admin/events/:eventId/applications/bulk` `{ ids, action, message? }` (FREE forms only for approve) | organizer+ |
| POST | `/admin/events/:eventId/applications/:id/refund` `{ amount?, reason? }` | admin |
| PATCH | `/admin/events/:eventId/applications/:id` `{ boothLabel?, internalNote? }` | organizer+ |
| GET/PUT | `/admin/settings/application-templates[/:action]` | GET organizer+, PUT admin |
| POST | `/admin/settings/application-templates/:action/preview` `{ applicationId? }` | organizer+ |

Validators in `validators/applicationValidators.js` (shape only; values in services).

### 4.3 Webhooks

In `routes/webhooks.js` before the existing switch:

```js
if (ApplicationPaymentService.isApplicationEvent(event)) {
  await ApplicationPaymentService.handleEvent(event);
  return res.json({ received: true });
}
```

`isApplicationEvent`: `checkout.session.*` with `metadata.applicationId`; `setup_intent.*` / `payment_intent.*` with `metadata.applicationId`; `charge.refunded` with `payment_intent` whose stored id matches an application (DB lookup by `stripePaymentIntentId`). Handlers:

| Event | Effect |
|---|---|
| `checkout.session.completed` (mode `setup`) | store payment method → `CARD_ON_FILE`, `SUBMITTED`, RECEIVED email |
| `checkout.session.completed` (mode `payment`, `paid`) | `PAID`, `paidAt`, capacity reserved → approved if `APPROVED`; RECEIVED (SUBMIT timing) or receipt (pay-now) |
| `checkout.session.expired` | `DRAFT` stays resumable; pay-now: nothing (due date governs) |
| `payment_intent.succeeded` | `PAID`, move capacity, email receipt |
| `payment_intent.processing` | `PROCESSING` (should not occur with cards; logged) |
| `payment_intent.payment_failed` / `canceled` | `PAYMENT_DUE` (+ due date if unset), PAYMENT_DUE email, organizer alert |
| `charge.refunded` | reconcile `ApplicationRefund` rows (external refunds from the dashboard) |

### 4.4 Overdue sweep

`ApplicationPaymentService.sweepOverdue()` every hour (`APPLICATION_SWEEP_INTERVAL_MS`, `unref`): `paymentStatus = PAYMENT_DUE AND paymentDueAt < now AND overdue = false` → policy `WITHDRAW`: withdraw with `withdrawnBy: SYSTEM`, reason `payment_overdue`, release capacity, WITHDRAWN email + organizer notice; `HOLD`: `overdue = true`, organizer notice only.

### 4.5 Config / env

`config/applications.js`: `MAX_PROFILE_PHOTOS = 6`, `MAX_PHOTO_MB = 5`, `STATUS_TOKEN_TTL_DAYS = 180`, default templates. Env: `APPLICATION_SWEEP_INTERVAL_MS` (optional).

---

## 5. Frontend

### 5.1 Storefront

- `src/app/events/[eventId]/page.tsx` — "Get involved" section listing open forms with tier price ranges and "Opens <date>" for future ones.
- `src/app/events/[eventId]/apply/page.tsx` (list) and `apply/[formSlug]/page.tsx` (form): tier picker (radio cards with all-in price and remaining), profile section (prefilled when signed in), questions renderer (per `QuestionType`), photo dropzone (client-side type/size checks), consent line ("your card will only be charged if accepted"), submit → redirect.
- `src/app/events/[eventId]/apply/status/[applicationId]/page.tsx` — status, payment state, pay-now / resume buttons, magic-link CTA.
- Account page (spec 007, `/account`) gains an **Applications** section: list, detail, pay-now, update card, withdraw.
- Tenant-host rewrites in `frontend/middleware.ts` / `lib/storefrontHost.ts` for `/apply*` paths.

### 5.2 Admin

- `src/app/admin/events/[eventId]/applications/page.tsx` — list (table, filters in the URL, bulk bar, export).
- `…/applications/[applicationId]/page.tsx` — detail: profile card, answers, payment timeline, `DecisionDialog`, `RefundDialog`, booth label, internal note.
- `…/applications/forms/page.tsx` and `forms/[formId]/page.tsx` — `FormEditor` (settings, tiers, questions builder, preview link).
- `src/app/admin/settings/applications/page.tsx` — message templates (one card per action, `TemplateDialog` with merge-field chips and live preview); `SettingsNav` gains **Applications** after Payments.
- Event admin nav: "Applications (n)" badge from a lightweight `GET …/applications/summary`.

### 5.3 Types / hooks

`src/app/admin/events/[eventId]/applications/types.ts`, `useApplicationsApi.ts`; storefront `src/lib/applications.ts` for the public shapes and price display (`applicantPrice(tier, feeMode)` mirrored from the backend like `lib/fees.ts`).

---

## 6. Phases

### Phase 1 — Forms and free applications (no money)

1. Migration (full model), `npm run db:generate`.
2. `ApplicationFormService`, `ApplicantProfileService`, `ApplicationService` (submit, decisions without charge, list, export, bulk), `ApplicationTemplateService` + defaults, `EmailService.sendApplicationMessage`.
3. Public routes (forms, submit, status, resume-less), admin routes (forms CRUD, list, detail, decision, bulk, export, templates), buyer routes (profile, list, detail, withdraw).
4. Storefront apply pages + status page; account Applications section; admin list/detail/forms/templates pages.
5. Tests: unit (validation, capacity transaction with parallel approvals, template rendering, CSV flattening); contract (public read cache-safe, submit rate limit + duplicates, RBAC matrix, tenant isolation, decision state machine, bulk on FREE only); e2e (organizer builds a form → vendor applies → organizer approves with edited message → applicant sees status).
6. Docs: `docs/wiki/features/applications.md`; `/doc-feature`.

Deliverable: press / panel / creator applications usable end to end; paid forms can be configured but stay `DRAFT` (API refuses to OPEN a PAID form until phase 2 ships — feature flag `APPLICATIONS_PAYMENTS_ENABLED`).

### Phase 2 — Paid tiers and the payment engine

1. `Contact.stripeCustomerId`; `ApplicationPaymentService` (setup session, off-session charge with Connect routing, pay-now, refunds via the extracted `stripeRefund` helper, webhook handlers, overdue sweep); amount snapshot in submit; capacity slot moves.
2. Webhook branch; `server.js` sweep; `APPLICATION_SWEEP_INTERVAL_MS`.
3. Storefront: Stripe redirect on submit, status page pay-now / resume, account update-card and pay-now; admin: payment pill + timeline, "View in Stripe", refund dialog, PAYMENT_DUE template.
4. Tests: unit (amount snapshot per fee mode incl. tax-inclusive, application fee cents identity, state machine on every webhook, overdue policies); contract (setup-mode session params, approve → PaymentIntent params incl. `transfer_data` for a connected org and none for an unconnected one, decline → `PAYMENT_DUE`, concurrent approvals on a 1-slot tier, pay-now session, refund flags, webhook idempotency); e2e with mocked API (vendor flow with card-on-file copy, organizer approve with instant paid/failed states).
5. Docs update; launch-checklist note (application charges use the same Stripe account/Connect settings; nothing new to configure).

### Phase 3 — Scale and polish

CSV export with photos as URLs, saved filters, bulk waitlist/reject for PAID, applicant profile edit from the account page, "price changed since submission" notice, organizer daily digest of new submissions, event duplicate copies forms. Hand-offs: add-ons (spec 012), messaging segments (013), booth assignment + public directory/map (014).

Built 2026-09-17 (`feat/011-applications-phase-3`). Decisions taken while building:

- Saved filters live in the browser (`localStorage`, per event) — the URL already carries the shareable form; no server table.
- Bulk WAITLIST / REJECT on PAID forms needed no backend change (only APPROVE was guarded); the UI now disables Approve when a PAID row is selected and the contract test pins the behaviour.
- The digest is a per-organization 24 h window claimed with a conditional update (`applicationDigestAt`), sent from the existing hourly application sweep to every member; opt-out toggle under Settings › Applications. No new env var.
- Event duplication did not exist; `POST /organizations/:orgId/events/:eventId/duplicate` was added (DRAFT copy with tiers + forms; membership-guarded) with a Duplicate button on the admin events list.
- The price-changed notice recomputes today's `tierAmounts` (price, fee mode, tax) and compares `applicantPays` with the snapshot — so a fee-mode or tax edit also surfaces, not only a price edit.
- Profile self-service edits future applications only; a buyer photo upload route (`POST /buyer/me/applicant-profile/photos`) was added since submissions were the only upload path.

### Explicitly out of scope

Bank debit / ACH for applications, invoices as a standalone product (pay-now covers the failed-charge case; general invoicing is a later spec), multi-event applications, applicant-to-applicant visibility, contracts/e-signature, scheduling of panels, badge printing.

---

## 7. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 7.1 | Default `feeMode` for new PAID forms | `PASS` (matches tickets); expose the toggle prominently with the "vendor sees $X / you receive $Y" preview so ABSORB is a one-click choice |
| 7.2 | Tax on booths | Off by default (`taxable = false`, the organizer's practice); on = event's tax rate via the same `FeeService` path |
| 7.3 | Who may decide | ORGANIZER+ decides, ADMIN configures and refunds (mirrors events vs settings) |
| 7.4 | Default `paymentDueDays` | 7; organizer can set 1–30 |
| 7.5 | Overdue default | `WITHDRAW` — the 160-vendor case needs slots to recycle; `HOLD` for small shows |
| 7.6 | Guest status page vs forced account | Guest page with a signed token + magic-link CTA (same posture as ticket confirmation) |
| 7.7 | Bulk approve on PAID forms | Refuse in phases 1–2; each charge is an individual review |
| 7.8 | Photo storage | Existing `ImageService`/bucket; variants `thumb` + `web`; public URLs via `/images/:id/:hash/:variant` |
| 7.9 | Idempotency for off-session charges | Stripe idempotency key `application:<id>:charge:<attempt>`; `chargeAttempts` incremented in the same transaction as the approval |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Off-session charge succeeds but the webhook is delayed → organizer sees `PROCESSING` and re-approves | Approve is idempotent on `paymentStatus`; UI shows "Confirming payment…" and polls `GET …/applications/:id` for 20 s; verify endpoint reads the intent from Stripe |
| Two organizers approve the last slot simultaneously | `FOR UPDATE`-style conditional `UPDATE … RETURNING` on the tier; loser gets 409 with a Waitlist suggestion; contract test with `Promise.all` |
| Saved card charged for the wrong amount after a tier price edit | Amount snapshot at submission is the only amount ever charged; admin sees the delta |
| Webhook misroute between orders and applications | Dispatch strictly on `metadata.applicationId`; ticket sessions never carry it; contract test asserts an order session with no metadata still hits `PaymentService` |
| Applicant photos with PII / abuse | Same limits as venue uploads; organizer-only visibility until spec 014 opts a profile into a public directory |
| Template merge fields leak HTML | Escape every value; body is plain text rendered into the shell; no raw HTML from organizers |
| Duplicate contacts from casing / whitespace | Existing lowercase upsert; trim; profile unique per org + contact |
| Free-form bulk approve sends 160 emails in one request | Queue sends through the existing retry path; respond after DB commit, emails fire-and-forget with per-item logging |

---

## 9. Follow-ups noted, not planned

Add-ons at submission (012), organizer messaging with delivery tracking (013), booth assignment + interactive map + public vendor directory (014), simple pages/CMS (015), applicant self-service edits before decision, contracts, per-product fee rates.
