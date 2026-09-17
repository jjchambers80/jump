# Feature Specification: Applications (Vendors, Sponsors, Press, Panels)

**Feature Branch**: `plan/011-applications`  
**Created**: 2026-09-16  
**Status**: Proposed — plan in [plan.md](./plan.md)  
**Input**: Organizer discovery interview on Eventeny, 2026-09-15 — [docs/research/2026-09-15-eventeny-organizer-interview.md](../../docs/research/2026-09-15-eventeny-organizer-interview.md) (user stories ORG-01…12, PAY-01…06, VEN-01…07, ATT/STF as noted). Eventeny is the incumbent for the target account (Gaming Geek Expo, 160 vendors, booths $275–$1,200).  
**Builds on**: spec 003 schema (`Event`, `PriceTier` capacity locking, `Contact`), spec 007 tenant identity (per-org `Contact`, buyer magic-link auth), spec 009 tax settings, spec 010 payments (Checkout options, Stripe Connect destination charges), Image uploads (`ImageService`).

## Problem

A convention organizer sells three kinds of things besides tickets: **vendor spaces** and **sponsorships** (tiered, paid, capacity-limited, approval-gated) and **participant roles** (press, content creators, panelists — free, form-only, approval-gated). Today they do this in Eventeny, which (a) charges ~10% on a booth and shows the fee only at checkout, (b) treated a pending bank debit as paid and held a $900 booth for a month on a failed payment, (c) forces add-ons and invoices to happen after approval, and (d) locks vendor profile data in the platform. Jump has ticketing, per-org contacts, Stripe Connect and image uploads — but no concept of an application that is reviewed before money moves.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Organizer publishes application forms for an event (Priority: P1)

An organization admin opens an event's **Applications** tab and creates forms: *Vendor space* (paid, with tiers 10×10 $275 / 10×20 $550 / Corner $900, each with a quantity), *Sponsor* (paid tiers Gold / Silver / Bronze), *Press* and *Panel* (free, no tiers). Each form has an intro, custom questions (short text, long text, single/multi choice, checkbox, URL, photo upload), an open/close window, and — for paid forms — when the card is charged: **on approval** (default) or **on submission**. Forms appear on the public event page under "Get involved".

**Why this priority**: Nothing else in this spec exists without forms; this is what "Become a vendor" links to.

**Independent Test**: Create a paid form with two tiers and three questions via the API, publish it, load the public event page, verify the form is listed with tiers, prices shown all-in, and questions rendered in order.

**Acceptance Scenarios**:
1. **Given** an ADMIN on the event's Applications tab, **When** they create a form of kind PAID with tiers, **Then** each tier shows the applicant price (all-in per the form's fee mode) and remaining quantity in admin.
2. **Given** a form with `opensAt` in the future, **When** a visitor opens the public event page, **Then** the form is listed as "Opens <date>" and cannot be submitted.
3. **Given** a form with kind FREE, **When** an ADMIN adds tiers, **Then** the API rejects it (tiers are only for PAID forms).
4. **Given** a form with a required photo question, **When** an ADMIN previews the public form, **Then** the photo field is marked required and accepts JPG/PNG/WebP up to 5 MB.
5. **Given** an ORGANIZER (not ADMIN), **When** they try to create or edit a form, **Then** they get 403; they can view forms and applications.

---

### User Story 2 — Vendor applies and puts a card on file, charged only on approval (Priority: P1)

A vendor clicks "Become a vendor" on the event page, picks a tier, sees the exact total they will be charged (e.g. "$275.00 — no fees" or "$303.00 incl. fees", depending on the organizer's fee mode), fills in their business profile (business name, description, website, socials, product photos) and the organizer's questions, and is sent to Stripe to save a card. No charge happens. They receive a "we got your application" email and can see the status in their account.

**Why this priority**: The core vendor experience; "$275 becomes $303 at checkout" is the incumbent's headline complaint and charge-on-approval is what organizers expect.

**Independent Test**: Submit a paid application with `chargeTiming: APPROVAL`; verify the Stripe Checkout Session is created in `setup` mode, a `Contact` (and `stripeCustomerId`) exists, the application is `SUBMITTED` with `paymentStatus: CARD_ON_FILE` after the `checkout.session.completed` webhook, and no PaymentIntent exists yet.

**Acceptance Scenarios**:
1. **Given** a PAID form with fee mode ABSORB and a $275 tier, **When** the vendor views the tier, **Then** the price reads "$275.00" and the organizer's admin view shows "you receive $258.53 after fees" (fees per `FeeService`).
2. **Given** fee mode PASS, **When** the vendor views the tier, **Then** the price reads the all-in total and the fee line is shown before Stripe, never only on Stripe's page.
3. **Given** the vendor completes Stripe's card-saving page, **When** they return, **Then** the application shows "Submitted — card on file, you will only be charged if accepted" and a confirmation email is sent.
4. **Given** the vendor abandons Stripe's page, **When** 30 minutes pass, **Then** the application is `DRAFT` (never shown to the organizer) and can be resumed from the confirmation link.
5. **Given** a returning applicant signed in through the buyer magic link, **When** they open another form of the same organization, **Then** their business profile and prior answers to identically-labelled questions are prefilled.

---

### User Story 3 — Organizer decides: approve, reject, waitlist, withdraw (Priority: P1)

The organizer reviews applications in a list (filters by form, tier, status, payment status; search by business or contact), opens one to see the profile, photos, answers and payment state, and chooses **Approve**, **Reject**, **Waitlist** or **Withdraw**. A templated email for that action is prefilled and editable before sending. Approving a PAID application with charge-on-approval **reserves the tier capacity and charges the saved card in the same step**; the organizer sees "Paid" immediately when the card succeeds, or "Payment failed — due by <date>" when it does not.

**Why this priority**: Approval-with-charge is the operational core; instant, truthful payment feedback is what the incumbent got wrong.

**Independent Test**: Approve a `CARD_ON_FILE` application with a test card that succeeds; verify the tier's `quantitySold` increments under a `FOR UPDATE` lock, a PaymentIntent with `off_session: true` is confirmed, `paymentStatus` becomes `PAID` only after `payment_intent.succeeded`, and the APPROVED template email is sent. Repeat with a declining test card; verify `APPROVED` + `PAYMENT_DUE`, a pay-now link in the email, and the reservation held until `paymentDueAt`.

**Acceptance Scenarios**:
1. **Given** a `SUBMITTED` free application, **When** the organizer approves, **Then** status is `APPROVED`, no payment objects are created, and the APPROVED template is sent with merge fields filled.
2. **Given** a `CARD_ON_FILE` application whose tier has 0 remaining, **When** the organizer approves, **Then** the API returns 409 "tier is full" and suggests Waitlist; nothing is charged.
3. **Given** a declined off-session charge, **When** approval completes, **Then** status `APPROVED`, `paymentStatus: PAYMENT_DUE`, `paymentDueAt = now + form.paymentDueDays`, the reservation is held, and the email contains a hosted pay-now link.
4. **Given** `PAYMENT_DUE` past `paymentDueAt`, **When** the daily sweep runs, **Then** the application becomes `WITHDRAWN` with reason `payment_overdue`, capacity is released, and the organizer is notified — unless the form's `overduePolicy` is `HOLD` (flag only).
5. **Given** a `PAID` application, **When** the organizer withdraws it, **Then** they choose refund none / full / partial; a full refund reverses the Connect transfer and application fee pro rata; capacity is released.
6. **Given** a `WAITLISTED` application, **When** capacity frees and the organizer approves it, **Then** it goes through the same charge-on-approval path.
7. **Given** the organizer edits the template text before sending, **When** they confirm, **Then** the edited body is what the applicant receives and the template itself is unchanged.
8. **Given** an ORGANIZER role, **When** they approve or reject, **Then** it succeeds (decisions are ORGANIZER+; form configuration is ADMIN).

---

### User Story 4 — Payment truth: processing is not paid (Priority: P1)

Every application shows one of `NOT_REQUIRED`, `AWAITING_CARD`, `CARD_ON_FILE`, `PROCESSING`, `PAID`, `PAYMENT_DUE`, `REFUNDED`, `PARTIALLY_REFUNDED`. `PAID` is set only by the `payment_intent.succeeded` webhook (or an idempotent verify call that reads the intent from Stripe). Application payments accept **cards only** (no bank debits) so there is no multi-day pending window; `PROCESSING` exists for completeness and is treated as unpaid everywhere (lists, exports, capacity is still reserved).

**Why this priority**: The incumbent's worst incident. Sales staff must never be told "paid" by a status that a bank can still reverse.

**Independent Test**: Simulate `payment_intent.processing` then `payment_intent.payment_failed`; verify the application never shows `PAID`, ends `PAYMENT_DUE`, and the organizer gets an alert email. Simulate `succeeded` and verify `PAID` with `paidAt`.

**Acceptance Scenarios**:
1. **Given** any application, **When** its Stripe object is not `succeeded`, **Then** no view, list, export or email says paid.
2. **Given** a `payment_intent.payment_failed` webhook for a `PROCESSING` application, **When** it is processed, **Then** the organizer receives "Payment failed for <business> — due by <date>" and the applicant receives the pay-now email.
3. **Given** the organizer opens an application, **When** it has a Stripe PaymentIntent, **Then** a "View in Stripe" link opens the intent in the mode-aware dashboard.

---

### User Story 5 — Applicant sees status and pays what is due (Priority: P2)

From the organization's account page (buyer magic link, spec 007), an applicant sees each application with its status and payment state, can open the pay-now link when `PAYMENT_DUE`, can withdraw a `SUBMITTED` or `WAITLISTED` application, and can update the card on file.

**Independent Test**: Sign in as the contact; `GET /buyer/me/applications` lists the application; `POST /buyer/me/applications/:id/pay` returns a Checkout URL in payment mode for the due amount; after `checkout.session.completed` the application is `PAID`.

**Acceptance Scenarios**:
1. **Given** `PAYMENT_DUE`, **When** the applicant pays through the hosted page, **Then** the application becomes `PAID`, the reservation stands, and both parties get a receipt.
2. **Given** `SUBMITTED`, **When** the applicant withdraws, **Then** status `WITHDRAWN` with `withdrawnBy: APPLICANT`; the organizer sees it in the list.
3. **Given** `APPROVED`+`PAID`, **When** the applicant tries to withdraw, **Then** the UI tells them to contact the organizer (refunds are organizer-initiated).

---

### User Story 6 — Organizer works the list at scale (Priority: P2)

160 vendors: the organizer filters, sorts, bulk-approves free applications, bulk-waitlists, exports CSV (profile, answers flattened to columns, tier, status, payment, amounts, Stripe ids) and messages a filtered segment (hands off to spec 013; phase 1 = mailto list / CSV).

**Acceptance Scenarios**:
1. **Given** a filter on form + status, **When** the organizer exports, **Then** the CSV has one row per application with one column per question.
2. **Given** a bulk approve on 20 free applications, **When** it runs, **Then** each gets the APPROVED template; paid applications are excluded from bulk approve (each charge needs individual review).

---

### Edge Cases

- Applicant submits twice to the same form: second submission is blocked while one is `DRAFT`/`SUBMITTED`/`WAITLISTED`/`APPROVED`; allowed after `REJECTED`/`WITHDRAWN`.
- Tier price changes after cards are on file: the application keeps the amount quoted at submission (`amount*` snapshot); admin sees a "price changed" note.
- Card on file expires or is detached before approval: charge fails → `PAYMENT_DUE` path.
- Organization's Connect account goes `restricted` between submission and approval: charge routes to the platform account (spec 010 rule), never blocks approval.
- Form closed after submission: existing applications are still decidable.
- Event cancelled: `APPROVED`+`PAID` applications are listed for refund; no automatic refund (organizer decision, mirrors ticket cancellation MVP).
- Deleted question after answers exist: question is soft-hidden (`archivedAt`); answers preserved and exported.
- Applicant email differs in case: `Contact` is unique on org + lowercased email (existing rule).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001** Forms belong to an event; kinds `PAID` (tiers required) and `FREE`; fields: name, slug, intro (rich text limited to headings/paragraphs/links/lists), status `DRAFT|OPEN|CLOSED`, `opensAt`, `closesAt`, `chargeTiming SUBMIT|APPROVAL` (PAID only), `feeMode PASS|ABSORB` (PAID only), `taxable` (default false), `paymentDueDays` (default 7), `overduePolicy WITHDRAW|HOLD`, `maxSubmissionsPerContact` (default 1 active).
- **FR-002** Tiers: name, description, price, `quantityTotal`, `quantityApproved` (capacity consumed by approval), `quantityReserved` (held during charge / payment due), `displayOrder`, `isActive`. Capacity is enforced on **approval** with `SELECT … FOR UPDATE` on the tier row, same pattern as `PriceTier`.
- **FR-003** Questions: label, help text, type `SHORT_TEXT|LONG_TEXT|SINGLE_CHOICE|MULTI_CHOICE|CHECKBOX|URL|EMAIL|PHONE|NUMBER|PHOTO`, `required`, `options[]`, `displayOrder`, `archivedAt`. Answers store text or an `Image` id; multi-choice as JSON array.
- **FR-004** Applicant profile per organization + contact (`ApplicantProfile`): business name, description, website, socials (JSON of known keys), up to 6 photos. Reused across the organization's events; organizer can export it.
- **FR-005** Public submission flow creates/updates the `Contact` (existing upsert), the profile, a `DRAFT` application with answers, then: FREE → `SUBMITTED`; PAID + `APPROVAL` → Stripe Checkout `mode: 'setup'` (card only) → webhook stores `stripePaymentMethodId` on the application and `stripeCustomerId` on the contact → `SUBMITTED`/`CARD_ON_FILE`; PAID + `SUBMIT` → Checkout `mode: 'payment'` with the application's amount → `SUBMITTED`/`PAID` after `checkout.session.completed` (`payment_status = paid`).
- **FR-006** Amounts are snapshotted on the application at submission: `subtotal`, `platformFee`, `processingFee`, `tax`, `total`, `applicantPays` (= total in PASS, = subtotal in ABSORB), computed by `FeeService.computeOrderFees` with the form's `taxable` flag and the organization's tax-inclusive setting.
- **FR-007** Decisions: `APPROVED`, `REJECTED`, `WAITLISTED`, `WITHDRAWN` from `SUBMITTED`/`WAITLISTED` (and `APPROVED → WITHDRAWN`). Every decision records `decidedAt`, `decidedByUserId`, optional internal note, and the message actually sent.
- **FR-008** Approve on a PAID + `APPROVAL` application: in one transaction lock the tier, verify capacity, increment `quantityReserved`, set `APPROVED`; then create and confirm an off-session PaymentIntent (`customer`, `payment_method`, `off_session: true`, `confirm: true`, Connect `transfer_data` + `application_fee_amount` per spec 010 routing, `metadata.applicationId`); on synchronous success set `PROCESSING` (the webhook sets `PAID` and moves reserved → approved); on failure set `PAYMENT_DUE` with `paymentDueAt` and send the pay-now email. The approval itself never rolls back on a payment failure.
- **FR-009** Pay-now: hosted Checkout in payment mode for `applicantPays`, card only, `metadata.applicationId`, expiring at `paymentDueAt`; success → `PAID`.
- **FR-010** Overdue sweep (hourly, `unref`'d like the domain sweep): `PAYMENT_DUE` past due → per `overduePolicy`: `WITHDRAW` releases capacity and emails both parties; `HOLD` flags `overdue: true`.
- **FR-011** Refunds on `PAID` applications: full or partial, through Stripe with `reverse_transfer` + `refund_application_fee` when the intent was a destination charge; recorded in `ApplicationRefund`; status `REFUNDED`/`PARTIALLY_REFUNDED`.
- **FR-012** Message templates per organization per action (`APPROVED`, `REJECTED`, `WAITLISTED`, `WITHDRAWN`, `PAYMENT_DUE`, `RECEIVED`) with merge fields `{{applicant.firstName}}`, `{{profile.businessName}}`, `{{event.name}}`, `{{form.name}}`, `{{tier.name}}`, `{{amount.applicantPays}}`, `{{payment.dueDate}}`, `{{links.payNow}}`, `{{links.account}}`. Defaults seeded on first use. Decision dialog previews the rendered email and allows one-off edits.
- **FR-013** Emails via the existing `EmailService`/Resend transport with the organization's branding; sender identity per spec 013 later.
- **FR-014** Buyer account (spec 007 magic link) gains an Applications section: list, detail, pay-now, withdraw (while `SUBMITTED`/`WAITLISTED`), update card (Checkout setup mode).
- **FR-015** Admin: Applications tab per event (list with filters/sort/search, detail with answers, photos, payment timeline, Stripe links, decision actions), Forms builder (form, tiers, questions, templates), CSV export, bulk approve/waitlist/reject for FREE forms.
- **FR-016** Webhooks on the platform endpoint: `checkout.session.completed` (branch on `metadata.applicationId` + `session.mode`), `setup_intent.succeeded`, `payment_intent.succeeded|processing|payment_failed|canceled` (only intents with `metadata.applicationId`), `charge.refunded`. Ticket-order handling unchanged.
- **FR-017** Public read of forms for an event is unauthenticated and cache-safe (no per-user data); submission is rate-limited per IP + email like buyer login.
- **FR-018** RBAC: view + decide = ORGANIZER, ADMIN, SYSTEM_ADMIN; configure forms/tiers/questions/templates + refunds = ADMIN, SYSTEM_ADMIN; all scoped by `activeOrgFor(req)` / event ownership.
- **FR-019** Audit log lines for every state change (`application_submitted`, `application_decided`, `application_charge_attempted`, `application_payment_*`, `application_refunded`, `application_overdue`).

### Key Entities

- **ApplicationForm** — per event; kind, timing, fee mode, window, policies.
- **ApplicationTier** — per PAID form; price and capacity.
- **ApplicationQuestion** / **ApplicationAnswer** — organizer questions and applicant answers (text or image).
- **ApplicantProfile** (+ **ApplicantProfileImage**) — reusable per organization + contact.
- **Application** — the submission: contact, form, tier, status, payment status, amount snapshot, Stripe ids, decision fields, due date.
- **ApplicationRefund** — refunds against a paid application.
- **ApplicationMessageTemplate** — per organization per action.
- Existing: **Contact** gains `stripeCustomerId`; **Event**, **Organization**, **Image**, **OrganizationStripeAccount**, **PaymentTransaction** (not reused — applications keep their own ledger fields).

## Success Criteria _(mandatory)_

- **SC-001** A vendor can go from "Become a vendor" to "card on file" in one sitting without seeing a price that differs from the first one shown.
- **SC-002** Approving a card-on-file application yields a truthful payment state within the same request (`PROCESSING` → `PAID` via webhook typically < 5 s; declined → `PAYMENT_DUE` immediately) — never a "paid" that later reverts.
- **SC-003** Capacity per tier can never be exceeded by approvals under concurrent decisions (contract test with parallel approvals).
- **SC-004** A `PAYMENT_DUE` application cannot hold capacity past `paymentDueAt` under `WITHDRAW` policy.
- **SC-005** Existing ticket purchase, refund and webhook tests pass unchanged.
- **SC-006** 160 applications with 12 questions export in < 3 s and the admin list pages in < 500 ms.
- **SC-007** Every decision email is derived from an organizer-editable template; no hardcoded copy reaches applicants.

## Assumptions

- Applications are per event (a convention is one `Event`); multi-day scheduling is out of scope.
- Card only for application payments; ACH/bank debit deliberately excluded (the incident that motivated FR-008/FR-010).
- Booth fees follow the ticket fee schedule (`FEE_CONFIG`) — no separate rate in phase 1; per-product rate cards are a later fee-modes spec.
- Booth/table assignment and the floor map are spec 014; `Application` gets a nullable `boothLabel` free-text now so organizers can note placement.
- Add-ons (power, extra badges) are spec 012; the amount snapshot and Checkout line-item structure here leave room for add-on lines.
- Organizer-to-applicant messaging beyond decision emails is spec 013.
- Applicant sign-in reuses the buyer magic link; there is no separate "vendor account".
