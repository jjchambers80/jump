# Applications

**Status**: Implemented — phase 1 (FREE forms end to end; PAID forms configurable but cannot open) 2026-09-17. Phase 2 (card on file, charge on approval, pay-now, refunds) pending behind `APPLICATIONS_PAYMENTS_ENABLED`. Spec: `specs/011-applications/`.
**Last Updated**: 2026-09-17

## Overview

Per-event **application forms** for people who are not ticket buyers: vendors and sponsors (PAID forms with priced, capacity-limited tiers) and press, content creators, panelists (FREE forms). Applicants fill in a business profile (reused across the organization's events), answer the organizer's questions (10 types incl. photo upload), and get a status page link by email. Organizers review in an admin list, **approve / reject / waitlist / withdraw** with a templated, editable email, keep notes and a booth label, bulk-act on free forms, and export CSV. Capacity on PAID tiers is consumed by **approval**, never by submission, so waitlisting works. Review `status` and `paymentStatus` are independent columns; money moves in phase 2.

Derived from the 2026-09-15 Eventeny organizer interview (`docs/research/`).

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`ApplicationForm`, `ApplicationTier`, `ApplicationQuestion`, `ApplicantProfile(+Image)`, `Application`, `ApplicationAnswer`, `ApplicationDecision`, `ApplicationRefund`, `ApplicationMessageTemplate`, `Contact.stripeCustomerId`) | Model; migration `20260916200000_applications` |
| `backend/src/config/applications.js` | Limits, question types, merge fields, default templates |
| `backend/src/services/ApplicationFormService.js` | Forms / tiers / questions CRUD with value validation, public read shape, `tierAmounts` (fee mode PASS/ABSORB), acceptance window, `paymentsEnabled()` |
| `backend/src/services/ApplicantProfileService.js` | Profile upsert per org + contact, photos via `ImageService` (`usageType: applicant_profile`) |
| `backend/src/services/ApplicationTemplateService.js` | Templates (defaults, edit, reset), `renderTemplate` (`{{field}}`, `{{#section}}…{{/section}}`), send via `EmailService.sendApplicationMessage` |
| `backend/src/services/ApplicationService.js` | Submit (JSON or multipart), status token, applicant views, organizer list/summary/detail/notes/preview/decide/bulk/export, capacity |
| `backend/src/api/routes/applications.js` | Public routes (forms, submit, status) |
| `backend/src/api/routes/admin.js` (Applications block), `routes/buyerAuth.js` (Applications block), `validators/applicationValidators.js` | Admin + buyer routes |
| `frontend/src/lib/applications.ts` | Shared types, labels, helpers |
| `frontend/src/app/events/[eventId]/apply/*` | Public index, form, status page; `GetInvolved.tsx` on the event page |
| `frontend/src/app/organizations/[orgId]/account/ApplicationsSection.tsx` + `frontend/src/app/api/buyer/me/applications*`, `applicant-profile` | Applicant account view (proxied through Next route handlers) |
| `frontend/src/app/admin/events/[eventId]/applications/*` | Admin list, detail, `DecisionDialog`, forms list, form editor, `useApplicationsApi` |
| `frontend/src/app/admin/settings/applications/page.tsx` | Settings › Applications (email templates) |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `APPLICATIONS_PAYMENTS_ENABLED` | No (default off) | `true` lets PAID forms OPEN and accept card-on-file submissions (phase 2). Off: PAID forms stay configurable but `PATCH status=OPEN` → 409 and submissions → 409 |

Photos use the existing image storage (bucket or local `uploads/`), max 6 profile photos + one per PHOTO question, 5 MB each, JPG/PNG/GIF/WebP.

## How It Works

### Forms

- `kind` PAID (tiers required to open) or FREE (no tiers). `status` DRAFT (hidden) → OPEN → CLOSED (visible, not accepting). Optional `opensAt`/`closesAt` window; `acceptance()` reports `open` + reason.
- PAID-only settings: `chargeTiming` SUBMIT|APPROVAL, `feeMode` PASS|ABSORB, `taxable`, `paymentDueDays` 1–30, `overduePolicy` WITHDRAW|HOLD.
- `tierAmounts(price, form, event, org)` runs `FeeService.computeOrderFees` once: PASS → applicant pays `total`, org receives `subtotal`; ABSORB → applicant pays `subtotal + tax`, org receives `subtotal − fees`. Admin sees both numbers per tier; the public form shows only the applicant price ("$303.30 incl. $28.30 fees").
- Questions are archived (`archivedAt`) instead of deleted once answered; type cannot change after answers exist. Slug unique per event, auto-derived from the name.

### Submission

`POST /events/:eventId/applications` — JSON, or multipart with `payload` (JSON string), `profilePhotos` (≤6) and `answer:<questionId>` files. Validates window, PAID flag, tier, contact, profile, every answer against its question type/options/required. In one transaction: `Contact` upsert (org + lowercased email, marketing opt-in), duplicate check (one active application per contact per form), profile upsert + photos, answers (PHOTO → `Image`), application row. FREE → `SUBMITTED` + RECEIVED email (awaited, never throws). PAID → `DRAFT` + `AWAITING_CARD` until phase 2 redirects to Stripe. Response `{ applicationId, statusUrl, next }`; `statusUrl` carries a random token whose sha256 is stored (`statusTokenHash`, 180-day TTL) for the guest status page.

### Decisions

`POST /admin/events/:eventId/applications/:id/decision { decision, note?, message?, sendEmail? }` — `DECISIONS` table: APPROVE (from SUBMITTED/WAITLISTED), REJECT (same), WAITLIST (from SUBMITTED), WITHDRAW (from SUBMITTED/WAITLISTED/APPROVED). Runs under `SELECT … FOR UPDATE` on the application; approving a tiered application does `UPDATE "ApplicationTier" SET quantityApproved+1 WHERE remaining >= 1 RETURNING` → 409 `tier is full` (details `suggestion: WAITLIST`) when it loses the race. Leaving APPROVED releases the slot (`capacitySlot` remembers which counter). Every decision writes an `ApplicationDecision` with the note and the email actually sent (subject/body). `message` overrides the rendered template for this send only; `sendEmail: false` skips it. `POST …/preview { decision }` returns the rendered template for the dialog. Bulk (`POST …/bulk`) refuses APPROVE on PAID forms.

### Templates

Per organization per action (`RECEIVED`, `APPROVED`, `REJECTED`, `WAITLISTED`, `WITHDRAWN`, `PAYMENT_DUE`), defaults from `config/applications.js`. Plain text; `{{applicant.firstName}}`, `{{profile.businessName}}`, `{{event.name}}`, `{{tier.name}}`, `{{links.status}}` etc.; `{{#tier}}…{{/tier}}` sections. Values are HTML-escaped and rendered into the branded email shell (paragraphs, bare URLs become buttons). Unbalanced sections are rejected on save.

### Applicant views

Guest: `GET /applications/:id/status?token=`. Signed in (buyer magic link, spec 007): `GET /buyer/me/applications[/:id]`, `POST …/withdraw` (SUBMITTED/WAITLISTED only), `GET/PATCH /buyer/me/applicant-profile`, `DELETE …/photos/:imageId`. The account page shows an Applications section above Orders when any exist.

### Roles

ORGANIZER+ views forms/applications and decides; ADMIN/SYSTEM_ADMIN configures forms, tiers, questions, templates. Members are scoped through `resolveOrgScope` → `requireEvent(eventId, orgId)` (404 for another org's event); SYSTEM_ADMIN passes `null`.

## API Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/events/:eventId/applications/forms`, `/forms/:slug` | public |
| POST | `/events/:eventId/applications` | public, rate-limited (30/h per client IP) |
| GET | `/applications/:id/status?token=` | token |
| GET/PATCH | `/buyer/me/applicant-profile`; DELETE `…/photos/:imageId` | buyer |
| GET | `/buyer/me/applications`, `/buyer/me/applications/:id`; POST `…/withdraw` | buyer |
| GET/POST | `/admin/events/:eventId/application-forms` | organizer+ / admin |
| GET/PATCH/DELETE | `…/application-forms/:formId` | organizer+ / admin / admin |
| POST/PATCH/DELETE | `…/application-forms/:formId/tiers[/:tierId]` | admin |
| POST/PATCH/DELETE | `…/application-forms/:formId/questions[/:questionId]`, PATCH `…/questions/reorder` | admin |
| GET | `/admin/events/:eventId/applications` (`form,status,payment,tier,q,sort,page,pageSize`), `…/summary`, `…/export.csv` | organizer+ |
| GET/PATCH | `…/applications/:id` (PATCH `boothLabel`, `internalNote`) | organizer+ |
| POST | `…/applications/:id/preview`, `…/applications/:id/decision`, `…/applications/bulk` | organizer+ |
| GET/PUT/DELETE | `/admin/settings/application-templates[/:action]` | organizer+ / admin / admin |

## Testing

- `backend/tests/contract/applications.test.js` — 21 cases: forms RBAC + validation, PAID cannot open, tier/question edits, tenant 404s, public read, submit validation, multipart submit with a real PNG, duplicates, status token, decisions + state machine, 3 concurrent approvals on a 1-slot tier, bulk, CSV, templates, buyer views.
- `backend/tests/unit/applicationFormService.test.js`, `applicationTemplates.test.js` — fee modes, slug, acceptance, rendering of every default template.
- `frontend/e2e/applications.spec.ts` — event page strip, apply index, full press application → status page, bad token, admin list filters/search/bulk bar, detail + notes + waitlist with edited email + history, forms create/edit/add question, ORGANIZER read-only, templates save; axe clean.

## Gotchas

- **PAID forms cannot open until phase 2** — the API returns 409 on `status: OPEN`; the editor shows the warning. Tiers, fee mode and questions can be prepared now.
- **Submissions never take capacity.** `remaining` on a tier only drops on approval; the public form shows "Full — you can still apply for the waitlist".
- **The RECEIVED email is awaited** in `submit` so tests and callers see it; `ApplicationTemplateService.send` swallows transport errors (logged as `application_email_failed`).
- **Photos inside the submit transaction**: `ImageService.processUpload` uses its own transaction, so a failed submission can leave an unreferenced `Image`; `POST /admin/images/cleanup` (existing) removes orphans.
- **Status token is single-purpose**: it only reads the applicant view; withdrawing or editing needs the buyer session.
- **Storefront hosts**: `/events/:id/apply/*` passes through the tenant-host middleware like the event page; the buyer account section works on `/account` there.
- Frontend `e2e` runs of unrelated specs (`theme-modes`, `admin-access`, `wcag-contrast`) fail on a clean tree in this environment too — not related to this feature.

## Related Features

- [Buyer Accounts](buyer-accounts.md) — applicant sign-in and account page
- [Fee Calculation](fee-calculation.md) — fee mode math
- [Connect Payouts](connect-payouts.md) — where application charges route in phase 2
- [Email Notifications](email-notifications.md) — transport and branding shell
