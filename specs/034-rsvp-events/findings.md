# Findings: RSVP Reminder Implementation Prerequisites

Generated 2026-09-22 · jumpplanner · t_d096a834 ("Inspect existing RSVP and application sweep patterns")

Based on spec 034 plan (D1–D13, §9 resolved), and inspection of the actual codebase at commit 2ef8877.

---

## 1. Plan Document Status

specs/034-rsvp-events/plan.md does not exist on the worktree (wt/t_d096a834). It was retrieved from git history:

    git show origin/docs/034-rsvp-plan:specs/034-rsvp-events/plan.md

All decisions D1–D13 and §9 are resolved and treated as final. The plan is complete and ready for implementation; no decisions need revisiting.

---

## 2. Sweep Implementation Pattern (the closest analog for an RSVP reminder job)

The application sweep (`ApplicationPaymentService.sweepOverdue` + `ApplicationDigestService.sendDue`) is the model for §9.2's reminder job.

### 2.1 Timer Registration

File: `backend/src/api/server.js` lines 214–224

```
const APPLICATION_SWEEP_MS = Number(process.env.APPLICATION_SWEEP_INTERVAL_MS) || 60 * 60 * 1000;
const applicationSweep = async () => {
  await applicationPaymentService.sweepOverdue().catch(() => {});
  await applicationDigestService.sendDue().catch(() => {});
};
setTimeout(applicationSweep, 30 * 1000).unref();
setInterval(applicationSweep, APPLICATION_SWEEP_MS).unref();
```

Pattern: setTimeout fires first 30s after boot; setInterval repeats at the env-overridable interval. Both use `.unref()` so they don't block process exit. Each step is individually caught.

Env key: `APPLICATION_SWEEP_INTERVAL_MS` (default 1 hour).

For an RSVP reminder sweep, follow the same: a configurable interval env var, a 30s initial delay, `.unref()` on both timer calls.

### 2.2 Idempotent Organization-Level Windows (Digest Service)

`ApplicationDigestService.sendDue()` (file: `./backend/src/services/ApplicationDigestService.js`):

- Queries organizations where `applicationDigestEnabled = true` AND (`applicationDigestAt` is null OR more than 23 hours ago).
- Claims the window with a conditional `prisma.organization.updateMany({ where: { id, applicationDigestAt: org.applicationDigestAt }, data: { applicationDigestAt: now } })`. Only the first concurrent sweep wins (`claimed.count === 0` → skip).
- Advances the window even when there are no submissions for the period.

For RSVP reminders, a similar column on Organization (e.g. `rsvpReminderSweptAt`) would let the sweep claim each org in turn and avoid double sends.

### 2.3 Batch Processing, Error Isolation

`ApplicationPaymentService.sweepOverdue()` (file: `./backend/src/services/ApplicationPaymentService.js` lines 625–690):

- Finds records in a single query with a `take: 500` limit.
- Iterates records individually with try/catch per row: "a failure on one application never blocks others."
- Each iteration runs its own Prisma transaction.
- Returns `{ withdrawn, held }` counters for logging.

### 2.4 Existing Sweeps Summary

| Sweep | Interval | Env Key | Service | File |
|---|---|---|---|---|
| Application overdue | 1h | APPLICATION_SWEEP_INTERVAL_MS | ApplicationPaymentService.sweepOverdue | 625-690 |
| Application digest | 23h (ticks hourly) | SHARED with overdue | ApplicationDigestService.sendDue | 29-105 |
| Booth hold release | 60s | BOOTH_SWEEP_INTERVAL_MS | boothService.sweepExpired | server.js |
| Abandoned orders | 5m | ORDER_SWEEP_INTERVAL_MS | OrderService.sweepAbandoned | server.js |
| Abandoned onboarding | 1h | ONBOARDING_SWEEP_INTERVAL_MS | OnboardingService.sweepAbandoned | server.js |
| Stale sessions | 24h | SESSION_SWEEP_INTERVAL_MS | SessionService.sweep | server.js |
| Custom domains | 10m | DOMAIN_SWEEP_INTERVAL_MS | DomainService.sweep | server.js |

---

## 3. RSVP / Event Model State

**No RSVP-related code exists yet.** The `Event` model (`packages/db/prisma/schema.prisma` lines 779–812) has no `admissionMode`, `rsvpLimit`, `rsvpMaxPartySize` or `rsvps` relation. There is no `EventRsvp` model, no `RsvpStatus` or `AdmissionMode` enum.

New additions needed per §5:

```
enum AdmissionMode { TICKETED RSVP }
enum RsvpStatus    { GOING CANCELLED }
```

Event additions:
- `admissionMode  AdmissionMode @default(TICKETED)`
- `rsvpLimit      Int?`          // null = unlimited
- `rsvpMaxPartySize Int @default(1)`
- `rsvps          EventRsvp[]`

New model EventRsvp:
- `id, eventId, contactId, partySize, status, cancelledAt, createdAt, updatedAt`
- `@@unique([eventId, contactId])`
- `@@index([eventId, status])`
- `@@index([contactId])`

Enum additions:
- `EmailSubscribedSource` gets `RSVP` value
- `LegalSource` gets `RSVP` value

Migration is additive with defaults; existing events become `TICKETED`. The `Event.capacity` column stays non-null (D6 writes a fallback value when admissionMode is RSVP).

---

## 4. Venue Timezone Handling (Spec 033) — for RSVP Reminders

**Relevant because the reminder email must format the event date in the venue's zone.**

File: `backend/src/utils/eventTime.js`

- `formatEventDateTime(value, zone)` — used in receipt and cancellation emails. Produces "Sat, Nov 8, 2026 · 8:00 PM MST".
- `formatEventDate(value, zone)` — date only.
- `formatEventTime(value, zone)` — time only with zone abbreviation.
- `zoneAbbreviation(value, zone)` — "EST", "MDT", "AKST".

Every email that references an event time uses `formatEventDateTime(event.date, event.venue?.timezone)` (see EmailService lines 418, 487). The RSVP reminder email must use the same pattern.

Venue.timezone is sourced from `VenueService._resolveTimeZone`; `Venue.timezoneSource` decides whether an address edit re-derives.

---

## 5. Email Composition and Delivery Patterns

### 5.1 Cancellation Notification (closest to RSVP confirmation + cancel)

`EmailService.sendCancellationNotification(event, tickets)` (lines 416–471):

- Groups tickets by contact email to avoid duplicates.
- Uses `formatEventDateTime(event.date, event.venue?.timezone)` for the date line.
- Uses `orgLogoHtml()` for the branded header.
- Sends via `resend.emails.send(msg)` with inline HTML.
- Catches errors per recipient: "Continue sending to other contacts."

### 5.2 Order Confirmation

`EmailService.sendOrderConfirmation(order, tickets, options)` (lines 39–142):

- Has a 3-retry pattern with exponential backoff (1000ms * attempt).
- Never throws on failure: "email failure must not break the order flow."
- Logs at info on success, error after all retries.

### 5.3 Application Decision Email (Templated)

`EmailService.sendApplicationMessage({ to, subject, body, organization })` (lines 371–409):

- Body is plain text; paragraphs split on blank lines become HTML paragraphs.
- URLs on their own line become buttons.
- Inline URLs are auto-linked.
- Text alternate is included.

### 5.4 Buyer Login Email

`EmailService.sendBuyerLoginEmail({ contact, loginUrl, organization, code })` (lines 153–192):

- Organization name in subject: `Your sign-in link for ${orgName}`.
- Has a branded HTML shell with `orgLogoHtml`.

### 5.5 Application Receipt (Hybrid text/html)

`EmailService.sendApplicationReceipt(application, options)` (lines 483–561):

- Uses `formatEventDateTime` for the date.
- Has `text:` alternate for plain text readers.
- Includes `reply_to: organization.email` when available.

### 5.6 Email Sending Library

All emails go through `resend` (imported from `../config/resend.js`). In tests, it's mocked:

```
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));
```

The default from address: `process.env.RESEND_FROM_EMAIL || 'Jump <noreply@jump.events>'`.

### 5.7 RSVP Confirmation Email (to create)

Per §7 Phase 1: a new `EmailService.sendRsvpConfirmation` method. Should:
- Accept contact + event + partySize + cancelLink + optInStatus.
- Use `formatEventDateTime(event.date, event.venue?.timezone)` for the date line.
- Use `orgLogoHtml` for the branded header.
- Show party size.
- Carry a `.ics` attachment mention (in the text; .ics generation deferred).
- Include the cancel link.
- Follow the `sendBuyerLoginEmail` pattern (single attempt, no retry, never throws).

---

## 6. Cancellation Behavior (Existing)

### 6.1 EventService.cancelEvent (lines 372–409)

File: `backend/src/services/EventService.js`

- Sets `status: 'CANCELLED'`.
- Contains a TODO comment: `// TODO: Notify ticket holders (T076)`.
- Does NOT currently notify RSVP contacts or set RSVPs to CANCELLED (no RSVP code exists).

### 6.2 §9.3 Requirement

When `cancelEvent` is called on an RSVP-mode event, it must:
- Find all `EventRsvp` rows with status `GOING`.
- Load each contact.
- Call `EmailService.sendCancellationNotification(...)` — or a variant that also handles RSVPs without tickets (the existing method expects `tickets` with `contact`).
- Set RSVPs to `CANCELLED`.

This requires either modifying `cancelEvent` to also handle RSVPs (branching on `admissionMode`), or adding a parallel RSVP cancellation path.

---

## 7. Legal Consent Trail

File: `backend/src/services/LegalAcceptanceService.js`

- `assertCurrent(acceptances, required)` validates against `LEGAL_VERSIONS` from `config/legal.js`.
- `record(tx, params, acceptances)` writes rows inside a transaction.
- `requestMeta(req)` produces `{ ipHash, userAgent }` for the audit trail.

For RSVP (D13):
- New `LegalSource.RSVP` value.
- `referenceType: 'EventRsvp'`.
- `subjectType: 'CONTACT'` (or `'ANONYMOUS_EMAIL'` for guest RSVPs).
- Required documents: `TERMS`, `PRIVACY` (same as checkout).
- Enforcement follows `LEGAL_ACCEPTANCE_REQUIRED` exactly.

---

## 8. Signed Token / Cancel Link Pattern

### 8.1 Application Status Token (HMAC-derived, no DB write)

File: `backend/src/services/applicationLinks.js`

```
function statusToken(applicationId) {
  return createHmac('sha256', process.env.AUTH_SECRET)
    .update(`application-status:${applicationId}`)
    .digest('hex');
}
```

Advantages: no DB write, deterministic per id + secret, verifiable at any time.

### 8.2 One-Time Token (VerificationToken table)

File: `backend/src/utils/oneTimeTokens.js`

- `issueToken(purpose, subject, ttlMs)` — writes sha256(raw) to `VerificationToken` table.
- `consumeToken(purpose, raw)` — finds by hash prefix, removes row.
- `consumeCode(purpose, subject, code)` — constant-time compare for 6-digit codes.

Used for password resets, email changes, recovery links.

### 8.3 Recommendation for RSVP Cancel Token

D10 says "signed, single-purpose link" with no expiry before the event date. The HMAC pattern from `applicationLinks.js` is a good fit:
- Purpose prefix: `rsvp-cancel:<eventRsvpId>`.
- Deterministic per id + secret, no DB write needed for the token itself.
- The cancel endpoint (`POST /rsvps/cancel`) verifies `verifyStatusToken`-style against the row id.
- Idempotent: cancelling an already-cancelled RSVP returns success.
- The token does not expire until the event passes (the signed info is the RSVP id).

---

## 9. Configuration and Environment Variables

### 9.1 Rate Limiter Registration

File: `backend/src/middleware/rateLimit.js` lines 76–161 (the `LIMITS` object).

Pattern for a new limiter (per §6):

```
RSVP_CREATE: {
  windowMs: 60 * 60 * 1000,
  limit: 30,
  message: 'Too many RSVPs from this address. Try again later.',
},
```

Added to `LIMITS` and consumed via `makeLimiter('RSVP_CREATE', LIMITS.RSVP_CREATE)`.

Env override: `RATE_LIMIT_RSVP_CREATE_LIMIT` and `RATE_LIMIT_RSVP_CREATE_WINDOW_MS`.

### 9.2 Application Config

File: `backend/src/config/applications.js` — constants for application-specific limits and templates.

An RSVP config file or section may hold: `RSVP_MAX_PARTY_SIZE` (default 10), `RSVP_CONFIRMATION_TTL_HOURS`, etc.

### 9.3 Org-Scoped Timer Config

Every sweep timer follows the pattern:
```
const SWEEP_MS = Number(process.env.SWEEP_INTERVAL_MS) || <default>;
```
For RSVP reminders: `RSVP_REMINDER_SWEEP_INTERVAL_MS` (default 1 hour for a 24h-in-advance check).

### 9.4 Reserved Paths

File: `backend/src/utils/redirectPath.js` (lines 9–23) and `frontend/src/lib/storefrontPath.ts`.

The plan says to reserve `/rsvp` in both (Gotcha 22). Current reserved paths:

```
/^\/$/, /^\/account(\/|$)/, /^\/events(\/|$)/, /^\/checkout(\/|$)/,
/^\/orders(\/|$)/, /^\/venues(\/|$)/, /^\/tickets(\/|$)/,
/^\/confirmation$/, /^\/api(\/|$)/, /^\/admin(\/|$)/, /^\/auth(\/|$)/,
/^\/organizations(\/|$)/, /^\/_next(\/|$)/
```

Add `/^\/rsvp(\/|$)/` to both `RESERVED` arrays.

---

## 10. Admin Scope / Org Routing

All admin routes use `activeOrgFor(req)` (from `backend/src/api/routes/adminScope.js`) to resolve the target organization ID. Pattern:

```
import { activeOrgFor } from './adminScope.js';
const orgId = await activeOrgFor(req);
const data = await someService.method(orgId, ...);
```

The admin RSVPs route (`GET /admin/events/:eventId/rsvps`) follows the pattern of other admin event routes, using `requireAuth` + `requireOrganizer` + `requireOrgMembership` for the event's venue org.

---

## 11. Contact / Opt-In Model

### 11.1 Contact (lines 700–732)

- `organizationId` + `email` is unique (`@@unique([organizationId, email])`).
- `firstName` and `lastName` are both non-null (so D3 requires a name).
- `emailSubscribed` (bool) + provenance fields (`emailSubscribedAt`, `emailSubscribedSource`, `emailUnsubscribedAt`).

### 11.2 ContactOptInService (file at path)

- `apply(db, contactId, { account, marketing, source })` — only ever turns flags on, never off (D4).
- `source` accepts `'CHECKOUT'`, `'APPLY'`, `'ADMIN'`, `'IMPORT'`.
- For RSVP (D4): a new source value `'RSVP'`.

---

## 12. Test Patterns

### 12.1 Contract Tests

File: `backend/tests/contract/applicationPayments.test.js`

- Use `jest.unstable_mockModule` to mock `resend` and `stripe`.
- Use `supertest` against the Express app.
- Use `staffToken({ email, role })` from `tests/helpers/staff.js` for auth.
- Use `allAcceptances` from `tests/helpers/legal.js` for legal consent.
- Track sent emails via a shared array (`sentEmails.push(msg)`).
- Reset Stripe mocks and counters per test (`resetStripeMocks()`).
- Use a unique `TAG` per test file for barcode/email/orderRef namespace isolation.
- Clean up in `afterAll` in dependency order (Contact before Organization).
- Mock `paymentSettingsService._statusCache` to skip the live Stripe capability check.

### 12.2 Unit Tests

File: `backend/tests/unit/applicationPayments.test.js`

- Mock only what's needed (`@jump/db`, stripe, logger).
- Test pure functions (status token, fee identity) in isolation.
- No database needed.

### 12.3 Test Fixture Files

- `backend/tests/fixtures/eventTime.fixtures.json` — shared between backend and frontend for venue timezone assertion (a parity pair).
- Tests should follow the same `TAG` + `afterAll` structure for data isolation.

---

## 13. Remaining Ambiguities and Constraints

1. **Cancel link expiry (D10).** The plan says "no expiry before the event date" but does not specify behaviour after the event. Recommendation: tokens expire 7 days after the event date (covers the "oops, I RSVP'd for the wrong day" use case while eventually cleaning up dead links).

2. **Event cancellation + RSVPs (§9.3).** The existing `EventService.cancelEvent` has a `// TODO: Notify ticket holders` comment. An RSVP integration must either:
   a. Modify `cancelEvent` to also handle RSVP contacts when `admissionMode === 'RSVP'`.
   b. Or add a parallel path that the caller chooses.
   The existing `sendCancellationNotification` expects `tickets` with `contact` — an RSVP-only variant would accept `EventRsvp[]` with `contact` included.

3. **`.ics` attachment.** The plan mentions it for the confirmation email but does not specify how to generate it. The codebase has no `.ics` generation utility; this will need a new dependency or inline vCalendar construction.

4. **Phone not collected.** D3 and §3 explicitly say no phone. The Event model's `rsvpMaxPartySize` (default 1) means no phone field validation is needed.

5. **Opt-in never unsubscribes (D4).** `ContactOptInService.apply` already enforces this ("only ever turns on"). Ensure the RSVP source is added to the `apply` method's allowed values and that the checkbox is unchecked by default.

6. **`Event.capacity` non-null (D6).** The column is non-null. In RSVP mode, the create/edit serializer must set `capacity = rsvpLimit ?? venue capacity ?? 0` so readers that assume `capacity > 0` still work.

7. **Mode switch lock (D11).** The plan specifies 409 `ADMISSION_MODE_LOCKED` when switching `TICKETED ↔ RSVP` after anything happened. Implementation must check (a) for RSVP → Ticketed: any `GOING` RSVP exists, and (b) for Ticketed → RSVP: any order exists. Implementation belongs in `EventService.createEvent` (for new events, no restriction) and `EventService.updateEvent` (for mode change checks).

8. **Storefront gate.** RSVP public routes need `middleware/storefrontGate.js` (the same 403 `StorefrontLockedError` that checkout/apply/event routes use). Add to the list of `middleware/storefrontGate` applications.

9. **Admin RSVPs tab.** Follows the pattern of the Submissions Table (spec 019): a single component that lists RSVPs with headcount summary, visible only when `admissionMode === 'RSVP'`.

---

## 14. Prerequisite Code Before Phase 1

Before RSVP implementation can begin:

1. Prisma schema: `AdmissionMode` and `RsvpStatus` enums + `Event` additions + `EventRsvp` model.
2. Migration + `npm run db:generate`.
3. `EmailSubscribedSource.RSVP` and `LegalSource.RSVP` enum values added.
4. `redirectPath.js` and `storefrontPath.ts`: add `/^\/rsvp(\/|$)/` to reserved paths.
5. `rateLimit.js` `LIMITS`: add `RSVP_CREATE` entry.
6. `ContactOptInService`: accept `source: 'RSVP'` in the `apply` method (no code change needed if the spread works; add to allowed sources if there's a whitelist — currently there isn't, the source is written verbatim).

---

## 15. Key File Inventory for Implementation

| Purpose | File | Lines (approx) |
|---|---|---|
| Schema | `packages/db/prisma/schema.prisma` | Event 779-812, Contact 700-732, enums 1056-1438 |
| Rate limiters | `backend/src/middleware/rateLimit.js` | 76-161 LIMITS |
| Sweep pattern | `backend/src/api/server.js` | 214-224 |
| Application sweep | `backend/src/services/ApplicationPaymentService.js` | 625-690 |
| Digest pattern | `backend/src/services/ApplicationDigestService.js` | 29-105 (full file) |
| Email | `backend/src/services/EmailService.js` | 564 lines (full file) |
| Cancel event | `backend/src/services/EventService.js` | 372-409 |
| One-time tokens | `backend/src/utils/oneTimeTokens.js` | 66 lines (full file) |
| Application status link | `backend/src/services/applicationLinks.js` | 36 lines (full file) |
| Legal consent | `backend/src/services/LegalAcceptanceService.js` | 142 lines (full file) |
| Opt-in | `backend/src/services/ContactOptInService.js` | 128 lines (full file) |
| Event time formatting | `backend/src/utils/eventTime.js` | 184 lines (full file) |
| Storefront URLs | `backend/src/utils/storefrontUrl.js` | 73 lines (full file) |
| Reserved paths (backend) | `backend/src/utils/redirectPath.js` | 62 lines (full file) |
| Reserved paths (frontend) | `frontend/src/lib/storefrontPath.ts` | 26 lines (full file) |
| Admin scope | `backend/src/api/routes/adminScope.js` | referenced but not read |
| Storefront gate | `backend/src/middleware/storefrontGate.js` | referenced but not read |
| Contract test (pattern) | `backend/tests/contract/applicationPayments.test.js` | 685 lines (full file) |
| Unit test (pattern) | `backend/tests/unit/applicationPayments.test.js` | 89 lines (full file) |
| Applications config | `backend/src/config/applications.js` | 194 lines (full file) |
| Legal config | `backend/src/config/legal.js` | referenced but not read |