# RSVP reminder sweep — implementation-ready specification

**Spec 034 follow-up, plan §9.2.** Write date: 2026-09-22.
Depends on: spec 034 phases 1–3 being live (EventRsvp model, RsvpService, EmailService.sendRsvpConfirmation, cancel token, storefront pages).
Source pattern: `ApplicationDigestService` + `ApplicationPaymentService.sweepOverdue` — the hourly sweep chain in `server.js`.

---

## 1. Data model changes

### 1.1 Add `EventRsvp.remindedAt`

```prisma
model EventRsvp {
  // ... existing columns
  remindedAt DateTime?   // set by the sweep when the reminder fires; null = not yet reminded
}
```

**Migration**: additive, nullable. Existing rows become `null` — no backfill. Zero-index on the new column — the sweep query uses `[eventId, status, remindedAt]` which the existing `@@index([eventId, status])` covers (the third field is the last in key order and on a nullable column, but Postgres can still filter on it in an Index Scan). Add explicit `@@index([eventId, status, remindedAt])` if `EXPLAIN ANALYZE` shows a seq scan in the test environment.

### 1.2 No new config on Organization

Unlike `applicationDigestEnabled` / `applicationDigestAt` on `Organization`, the RSVP reminder is not opt-out per organization — the sweep itself has a single timer that all orgs share. An organization that wants no reminders simply does not use the RSVP mode. No schema changes outside `EventRsvp`.

---

## 2. Sweep job (RsvpReminderService)

New file: `backend/src/services/RsvpReminderService.js` (singleton export, same pattern as `ApplicationDigestService`).

### 2.1 Timer registration in `server.js`

```js
import rsvpReminderService from './services/RsvpReminderService.js';

// RSVP reminder sweep (§9.2): ~hourly, sends reminder emails to GOING RSVPs
// whose event starts in approx 24 h.
const RSVP_REMINDER_MS = Number(process.env.RSVP_REMINDER_SWEEP_INTERVAL_MS) || 60 * 60 * 1000;
setTimeout(() => rsvpReminderService.sendDue().catch(() => {}), 60 * 1000).unref();
setInterval(() => rsvpReminderService.sendDue().catch(() => {}), RSVP_REMINDER_MS).unref();
```

The first tick fires 60 s after boot (same cadence as `applicationSweep`). `RSVP_REMINDER_SWEEP_INTERVAL_MS` env override (default 1 hour). Place it alongside the other sweeps in the `if (process.env.NODE_ENV !== 'test')` block (around line 214–249 of server.js). The timer is `unref`d so it never holds the process open.

### 2.2 Core method: `sendDue([now])`

```js
async sendDue(now = new Date()) {
  // 1. Find RSVPs due for a reminder
  // 2. For each eligible RSVP, send the email and stamp remindedAt
  // 3. Return { checked, sent, failed } for logging/tests
}
```

**Query**: fetch `EventRsvp` rows where:
- `status = 'GOING'`
- `remindedAt IS NULL`
- `event.status = 'PUBLISHED'` (never CANCELLED)
- `event.date` falls in the reminder window

**Reminder window**: the event's `date` (UTC instant) is at least 22 hours and at most 26 hours from `now` (the sweep tick). This gives a 4-hour cushion so an hourly sweep covers every RSVP exactly once regardless of when in the hour it fires.

```
const MIN_AHEAD_MS = 22 * 60 * 60 * 1000;  // 22 h
const MAX_AHEAD_MS = 26 * 60 * 60 * 1000;  // 26 h

eventDate >= now + MIN_AHEAD_MS
  AND eventDate <  now + MAX_AHEAD_MS
```

**Why 22–26 h and not "exactly 24"**: the sweep runs every ~60 min. A 4-hour window guarantees every event gets picked up in one and only one tick, even when the sweep drifts or fires early/late. An event whose `date` is 24 h 10 min from now falls into one tick; the next tick (60 min later) finds it at 23 h 10 min — still inside the 22–26 window? Let me check: next tick: `now + 60 min`, the event's `date - (now + 60 min)` = 23 h 10 min. That IS within 22–26 h, so it would be caught twice. 

**Correction**: the window must prevent double-capture across ticks. Use a 1-hour window (the sweep interval) with an offset:

```
eventDate >= now + 23.5 h  AND  eventDate < now + 24.5 h
```

This is a 1-hour window centred on 24 h ahead. An hourly sweep ticks at, say, T=14:00. It catches events whose date is within [24.5, 25.5 h from now), i.e. date in [T+24.5, T+25.5). Next tick at T+15:00 catches events within [T+23.5, T+24.5). Non-overlapping. Every event falls in exactly one tick when the sweep is exactly hourly; if a tick fires early (e.g. 50 min apart) the windows still touch but do not overlap — an event at exactly the seam edge belongs to the earlier window, but the stamp (`remindedAt IS NULL` gate) prevents double sends in any case.

Actually, the stamp (`remindedAt IS NULL`) is the idempotency gate — the window is advisory for relevance. An event that falls through two windows is only sent once because the second query finds `remindedAt IS NOT NULL`. So the window can be the simpler 22–26 h range:

```sql
WHERE rsvp.status = 'GOING'
  AND rsvp.remindedAt IS NULL
  AND event.status = 'PUBLISHED'
  AND event.date >= NOW() + INTERVAL '22 hours'
  AND event.date <  NOW() + INTERVAL '26 hours'
```

The stamp is what prevents duplicates, not the window precision. Keep the generous window to survive sweep delays (e.g. a deployment that stalls the tick for 2 hours). An RSVP is reminded at most once.

### 2.3 Idempotent stamping

Within each tick, the stamping is the critical ordering step — stamp first, send second. Must use a conditional update so concurrent ticks (if the app has multiple replicas) never double-send:

```js
// Claim RSVPs by stamping remindedAt atomically
const claimed = await prisma.eventRsvp.updateMany({
  where: {
    status: 'GOING',
    remindedAt: null,
    event: { status: 'PUBLISHED', date: { gte: minBound, lt: maxBound } },
  },
  data: { remindedAt: now },
});
if (claimed.count === 0) return { checked: 0, sent: 0, failed: 0 };

// Fetch the claimed RSVPs with event + contact + organization
const rsvps = await prisma.eventRsvp.findMany({
  where: { remindedAt: now, status: 'GOING' },
  include: {
    event: { include: { venue: true } },
    contact: true,
  },
});
```

**Key**: `updateMany` with `remindedAt: null` is the atomic claim. A second replica's `updateMany` sees `remindedAt IS NOT NULL` and claims zero rows, so every RSVP is stamped once. The subsequent `findMany` reads only the rows we just stamped — no race.

**Edge case**: if the email send fails partway through the batch, the RSVPs already stamped are not retried. This is acceptable: the failed sends are logged with full contact/event info for manual inspection. The sweep makes a best-effort pass. If operational durability matters (e.g. an entire batch fails due to Resend outage), the operator can clear `remindedAt` via a data script or the admin panel in a future phase. The spec below defines the logging contract so failures are detectable.

### 2.4 Per-RSVP sending logic

```js
let sent = 0;
let failed = 0;
for (const rsvp of rsvps) {
  try {
    await this.sendReminder(rsvp);
    sent++;
  } catch (error) {
    failed++;
    logger.error('RSVP reminder send failed', {
      rsvpId: rsvp.id,
      eventId: rsvp.eventId,
      contactId: rsvp.contactId,
      error: error.message,
    });
  }
}
```

`sendReminder(rsvp)` builds the email from the RSVP's event, contact, party size. It calls a new method `EmailService.sendRsvpReminder` — see §3.

### 2.5 Logging and observability

After the batch completes, emit one summary line:

```js
logger.info('RSVP reminder sweep', {
  event: 'rsvp_reminder_sweep',
  checked: claimed.count,
  sent,
  failed,
});
```

This matches the `event: 'application_digest_sweep'` pattern from `ApplicationDigestService.sendDue` (line 46). The `checked` value is the claimed count (stamped); `sent` is how many emails actually succeeded; `failed` is how many threw.

### 2.6 Return value

```js
return { checked: claimed.count, sent, failed };
```

Test assertions run against this return value.

### 2.7 Event cancellation interaction

§9.3 already specifies that cancelling an RSVP event emails its guests and sets their RSVPs to CANCELLED (`EventService.cancellation` path). The reminder sweep naturally excludes CANCELLED RSVPs via `status = 'GOING'`. It also excludes cancelled events via `event.status = 'PUBLISHED'`. No special handling needed: a cancellation that happens between the stamp and the send is still fine — the RSVP was GOING at stamp time and the cancellation notification already covers it. The reminder is noise but harmless because the RSVP was already CANCELLED and the reminder email carries the cancel link.

---

## 3. Email: `EmailService.sendRsvpReminder`

New method in `backend/src/services/EmailService.js`, following the `sendApplicationReceipt` / `sendCancellationNotification` pattern.

### 3.1 Signature

```js
/**
 * RSVP reminder sent ~24 h before the event (§9.2). Branded with the
 * organization's logo; includes the event name, date/time in the venue's
 * timezone (spec 033), party size, a cancel link, and a reminder of any
 * practical info (marketing opt-in note).
 * Fire-and-forget with async retry (3 attempts, like sendOrderConfirmation).
 *
 * @param {Object} rsvp - EventRsvp row with included event (incl. venue), contact
 */
async sendRsvpReminder(rsvp) { ... }
```

### 3.2 Email contents

**Subject**: `Reminder: {event.name} is happening tomorrow — {org.name}`

**HTML body** (branded shell, same layout as `sendOrderConfirmation`):

```
Organization logo (orgLogoHtml)
Heading: "Event Reminder — {event.name}"

Hi {contact.firstName},

This is a reminder that you're on the list for:

{event.name}
{formatEventDateTime(event.date, venue.timezone)} — in the event time zone
Party size: {rsvp.partySize}

You can cancel your RSVP at any time. Please let us know if your plans change so we can open the spot to someone else.

[CANCEL RSVP button → rsvpCancelUrl]

You received this because you RSVP'd to this event. If you no longer wish to receive marketing emails from {org.name}, you can unsubscribe at any time.

{org.name}
```

**Cancel URL**: `GET /rsvp/:token/cancel` — same signed cancel link from phase 1 (`POST /rsvps/cancel` with the raw token). The cancellation link generation reuses the same token + storefront URL pattern already defined for phase 1 (D10 in the plan). The reminder needs a fresh cancel link URL per RSVP:

```js
const cancelToken = rsvp.cancelToken;  // already stored or generated at RSVP creation
const cancelUrl = `${base}/rsvp/${cancelToken}/cancel`;
```

If the cancel token is single-purpose and stored at RSVP creation time (phase 1 stores a signed token per RSVP), retrieve it from the RSVP row or re-derive it from `AUTH_SECRET` + `rsvp.id` (same HMAC pattern as `applicationLinks.statusToken`). The exact mechanism is already decided in D10 — reference `applicationLinks.js` in `backend/src/services/` for the HMAC pattern.

**Plain-text fallback**: same content, line-wrapped, with the cancel URL in full.

**Retries**: same 3-attempt loop as `sendOrderConfirmation` (lines 40–141 of EmailService.js), with exponential backoff (1 s × attempt). Fire-and-forget — never throw to the caller after exhaustion.

**Logger event**: `event: 'rsvp_reminder_sent'`, with `rsvpId`, `eventId`, `contactId`.

---

## 4. Configuration

### 4.1 New env variables

| Variable | Default | Notes |
|----------|---------|-------|
| `RSVP_REMINDER_SWEEP_INTERVAL_MS` | 3600000 (1 h) | How often the sweep runs. Same pattern as `APPLICATION_SWEEP_INTERVAL_MS`, `ORDER_SWEEP_INTERVAL_MS`, `SESSION_SWEEP_INTERVAL_MS`. |
| `RSVP_REMINDER_HOURS_AHEAD` | 24 | Centre of the reminder window. Overridable so a different lead time can be tested or configured. The sweep computes `minBound` and `maxBound` from this ± 0.5 h default, ± 2 h graceful. |

Add both to the env variable table in root `AGENTS.md` under a new `RSVP_REMINDER_*` section, with the same table layout used for existing sweep env vars.

### 4.2 No rate limiter needed

The sweep sends at most one email per RSVP. The Resend API key and rate limits are already handled by `EmailService`. The sweep itself does not create a new public HTTP endpoint, so no rate limiter registration is needed in `middleware/rateLimit.js`.

---

## 5. DST and boundary cases

### 5.1 Venue timezone shift

The event `date` is stored as a UTC instant. The sweep query compares `event.date` (UTC) to `new Date()` (runtime UTC) — no timezone involved. The window is computed in UTC milliseconds, so DST does not affect eligibility. The email rendering uses `formatEventDateTime(event.date, venue.timezone)` (the same helper every other event surface uses) to display the local time with the zone abbreviation.

Heuristic: if the venue is in `America/New_York` (UTC−5 standard, UTC−4 DST), an event date in March at 8 PM EDT is stored as `2027-03-15T00:00:00.000Z`. The sweep at March 14 11 PM EDT (`2027-03-14T03:00:00.000Z`) finds `difference = 21 h` — inside the 22–26 h window. At March 15 12 AM EDT (`2027-03-15T04:00:00.000Z`), difference = 20 h — outside. The RSVP is stamped and reminded. No DST edge-case problem because UTC is the comparison plane.

### 5.2 Sweep delay recovery

If the sweep does not run for 3 hours (deployment, outage), the window is 22–26 h ahead. An event at 24 h ahead at the missed tick is at 21 h ahead by the next tick — just outside the window. But the `remindedAt IS NULL` gate means: if the event falls outside the window at the next tick, no email goes out and the RSVP never gets a reminder. This is an edge case but worth avoiding.

**Mitigation**: use a wider fail-open window (the generous 22–26 h is already 4 hours wide). Also, stamping is idempotent, so we can widen the bottom bound to cover the missed tick. Use 20–26 h:

- Normal tick: event at 24 h → caught.
- Tick 3 h late: event at 21 h → still inside 20–26 h → caught.
- Tick 6 h late: event at 18 h → outside both bounds → missed.

If a tick is 6+ h late there are larger operational problems. The 20–26 window survives a 4 h outage. Final recommendation: **20–26 h window**.

### 5.3 Event rescheduling

If an event's `date` is rescheduled, existing RSVPs keep their `remindedAt = null` (or whatever it was). If a reminder was already sent for the old date, the RSVP's `remindedAt` is already set and the guest does NOT get a second reminder for the new date. This is acceptable: the confirmation email (phase 1) already advises the guest, and rescheduling is rare.

To support re-reminding on reschedule, a future enhancement could clear `remindedAt` when an event's date changes and the RSVP is still GOING. Not specified here (out of scope for §9.2).

---

## 6. Schema / migration impact summary

| Addition | Type | Migration |
|----------|------|-----------|
| `EventRsvp.remindedAt` | `DateTime?` | Additive `ALTER TABLE "EventRsvp" ADD COLUMN "remindedAt" TIMESTAMP;` — nullable, no default, no backfill. |

No new enums, no new models, no changes to `Organization` or `Event`.

---

## 7. Files to create

| File | Purpose | Pattern to follow |
|------|---------|-------------------|
| `backend/src/services/RsvpReminderService.js` | Sweep service, singleton export | `ApplicationDigestService.js` |
| `backend/tests/unit/rsvpReminder.test.js` | Unit tests for the sweep logic | `backend/tests/unit/applicationPayments.test.js` |
| `backend/tests/contract/rsvpReminder.test.js` | Contract test with real DB | Existing spec 034 contract tests (to be written in phase 1) |

## 8. Existing files to modify

| File | Change |
|------|--------|
| `backend/src/api/server.js` | Import `RsvpReminderService`, register the interval timer (≈6 lines) |
| `backend/src/services/EmailService.js` | Add `sendRsvpReminder` method |
| `packages/db/prisma/schema.prisma` | Add `remindedAt DateTime?` to `EventRsvp` |
| `specs/STATUS.md` (when finalised) | Mark §9.2 as implemented |
| `root AGENTS.md` | Add `RSVP_REMINDER_SWEEP_INTERVAL_MS` and `RSVP_REMINDER_HOURS_AHEAD` to the env variable table |

---

## 9. Unit tests (`backend/tests/unit/rsvpReminder.test.js`)

All tests mock `prisma` (never hit the DB) and stub `EmailService.sendRsvpReminder`. Follow the pattern in existing unit tests (e.g., create an `__mocks__` entry for `@jump/db` or use `jest.mock`).

| # | Test | Assertion |
|---|------|-----------|
| 1 | **Eligible RSVP gets a reminder** | One GOING RSVP with `remindedAt = null`, event PUBLISHED, date = now + 24 h. `sendDue` returns `{ checked: 1, sent: 1, failed: 0 }`. `updateMany` sets `remindedAt`. |
| 2 | **CANCELLED RSVP skipped** | RSVP with `status = CANCELLED`. `checked: 0`. |
| 3 | **Already reminded RSVP skipped** | RSVP with `remindedAt` set. `checked: 0`. |
| 4 | **Cancelled event skipped** | RSVP GOING but `event.status = CANCELLED`. `checked: 0`. |
| 5 | **Event outside window skipped** | Event date = now + 10 h (too soon), now + 48 h (too far). `checked: 0`. |
| 6 | **Batch: some send, some fail** | 3 eligible RSVPs, stub `sendRsvpReminder` to reject the second. Returns `{ checked: 3, sent: 2, failed: 1 }`. All 3 stamped; second and third attempted. |
| 7 | **Concurrent replica guard** | `updateMany` returns `{ count: 0 }` (simulated second replica claimed them first). `findMany` not called. Returns `{ checked: 0, sent: 0, failed: 0 }`. |
| 8 | **Window boundaries** | Event at `now + 20 h` (included), `now + 26 h` (excluded). Use the 20 h ≤ and < 26 h arithmetic from §2.2. |

---

## 10. Integration tests (`backend/tests/contract/rsvpReminder.test.js`)

These run against a real Postgres test database (same `tests/globalSetup.js` provisioning as the rest). Use `tests/helpers/staff.js` for org setup.

| # | Test | Setup | Assertion |
|---|------|-------|-----------|
| 1 | **Full happy path** | Create org → venue → event (PUBLISHED, date = 24 h ahead) → create Contact → create GOING RSVP. Run `sendDue`. | `remindedAt` is set on the RSVP row. Email sent to the contact (assert via a stubbed spy on `emailService.sendRsvpReminder` or the existing `sentEmails` counter if one exists). |
| 2 | **CANCELLED RSVP excluded** | Same setup + a CANCELLED RSVP. Run sweep. | Only the GOING RSVP is reminded. |
| 3 | **Cancelled event excluded** | Same but `event.status = CANCELLED` and both RSVPs GOING. Run sweep. | No reminders, no stamps. |
| 4 | **Idempotent across sweeps** | Run sweep twice. | Second run stamps zero rows, sends zero emails. |
| 5 | **Party size rendered** | RSVP with `partySize = 3`. Run sweep, inspect the email body (captured via a spy on `emailService.sendRsvpReminder`). | "Party size: 3" appears in the body. |

**Cleanup**: delete RSVPs → Contact → Event → Venue → Organization in `afterAll` (FK order: `EventRsvp` before `Contact`, `Event` before `Venue`, `Venue` before `Organization`).

---

## 11. Open items (not blocking, future phases)

These are recorded here so the implementer can note them but not implement them:

- **Manual re-send**: no admin UI to re-send a reminder or clear `remindedAt`. An operator can use `psql` to clear the column. A future admin action could be considered.
- **Event reschedule clears remindedAt**: not implemented. Decide and file a follow-up if this matters to organisers.
- **Organiser opt-out per event**: not needed in v1 — the sweep is shared. If an organisation wants no automatic reminders, they can set the RSVP limit to 0 or simply not publish the event.
- **Rate limiting / capping sends per tick**: not needed — an organisation with 10,000 RSVPs triggers 10,000 sends. Resend handles volume; the sweep is sequential but fire-and-forget. If a cap is needed, model it on `ApplicationDigestService.MAX_ROWS_PER_FORM` (line 19). Do not add without data.

## 12. Risks

1. **Large batch blocks event loop**: 10,000 sequential `await resend.emails.send()` calls could hold the event loop for minutes. Mitigation: the sweep runs on an `unref`d timer and the logger immediately records progress per fails. Acceptable for the first release; if it proves problematic, batch the sends with `Promise.allSettled` in chunks of 25.
2. **Resend outage mass-stamps but does not send**: the RSVPs are stamped before the send loop. If Resend is down for the full sweep duration, every eligible RSVP is stamped but no email goes out. The only recovery is manual `UPDATE "EventRsvp" SET "remindedAt" = NULL` for the affected rows. Mitigation: log the failure count prominently and add a runbook step in the deployment docs. A future enhancement could defer stamping until after the send succeeds per RSVP (defeating the idempotency guard for multi-replica setups). Keep the current order — stamp first, send second — because correctness (no double sends across replicas) is worth more than a rare manual recovery.
3. **False negative on cancelled event**: the sweep loads RSVPs with `event: { include: { venue: true } }`. If the event is cancelled between the stamp and the send in a different transaction, the email still goes out. Harmless — the cancel link is in the email. Acceptable.