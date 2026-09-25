# RSVP Events — headcount and marketing capture without tickets

Spec 034 implementation, all three phases on main.

## Overview

An RSVP event is a free event that collects headcount and marketing opt-in without going through the checkout or creating Order rows. RSVPs live on a new `EventRsvp` table, never on `Order`, `OrderItem` or `Ticket`.

The mode is set by `Event.admissionMode` (enum: `TICKETED` or `RSVP`). Every surface branches on the mode, never on `priceTiers.length === 0`.

## Reminder emails (§9.2)

A background sweep (~hourly) sends a reminder email to GOING RSVPs when the event is approximately 24 hours away.

- **Sweep service**: `backend/src/services/RsvpReminderService.js`
- **Timer**: registered in `server.js`, first tick 60 s after boot, then every `RSVP_REMINDER_SWEEP_INTERVAL_MS` (default 1 h)
- **Idempotent**: stamps `EventRsvp.remindedAt` atomically with `updateMany` before sending; a concurrent replica claims zero rows
- **Window**: events whose UTC date is 20–26 hours ahead of the sweep tick are eligible (survives ~4 h sweep delays)
- **Email**: branded shell with org logo, event name, date/time in venue timezone (spec 033), party size, Cancel RSVP button
- **Configuration**: `RSVP_REMINDER_SWEEP_INTERVAL_MS` env var
- **Unit tests**: `backend/tests/unit/rsvpReminder.test.js` (8 tests, all mock prisma)

## Live headcount (admin)

`/admin/events/:eventId/rsvps` is the organizer's door view: Expected Headcount (Σ `partySize` of GOING), RSVPs (count of GOING), Cancelled, and the table.

- **Re-reads itself every 30 s** while the tab is in front, and immediately when the tab comes back — RSVPs arrive right up to the doors.
- A **Refresh** button forces a read; an `Updated hh:mm:ss` stamp (viewer's account zone, spec 030) says how fresh the number is.
- A failed background poll keeps the last good numbers on screen instead of replacing the table with an error.
- The table scrolls horizontally on a phone rather than clipping its last columns.

Guards: `frontend/e2e/admin-rsvps.spec.ts` (desktop + 375 px) and `frontend/e2e/public-rsvp.spec.ts` (the patron form at 375 px, including the double-tap case).

## Data model

```prisma
enum AdmissionMode { TICKETED RSVP }
enum RsvpStatus    { GOING CANCELLED }

model Event {
  admissionMode    AdmissionMode @default(TICKETED)
  rsvpLimit        Int?          // null = unlimited headcount
  rsvpMaxPartySize Int           @default(1)
  rsvps            EventRsvp[]
}

model EventRsvp {
  id          String     @id @default(cuid())
  eventId     String
  contactId   String
  partySize   Int        @default(1)
  status      RsvpStatus @default(GOING)
  cancelledAt DateTime?
  remindedAt  DateTime?   // set by the reminder sweep
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  event   Event   @relation(...)
  contact Contact @relation(...)

  @@unique([eventId, contactId])
}
```

## API

| Method + path | Auth | Notes |
|---|---|---|
| `POST /events/:eventId/rsvps` | public, `RSVP_CREATE` limiter | Creates/updates RSVP; always 202 on success (D8) |
| `POST /rsvps/cancel` | public, token | Signed cancel link |
| `GET /admin/events/:eventId/rsvps` | ORGANIZER | Headcount summary, list, CSV export |
| `PATCH /organizations/:orgId/events/:eventId` | existing | Accepts `admissionMode`, `rsvpLimit`, `rsvpMaxPartySize` |

## Key design decisions

- **D2: RSVP ≠ Order**. RSVPs are `EventRsvp` rows, not Orders — no money, no tickets, no impact on revenue, analytics or the tax report. `/admin/orders` stays the one money surface.
- **D4: Opt-in unchecked by default**, sources as `RSVP`. Only ever turns on; unchecked never unsubscribes.
- **D7: Headcount enforced under row lock.** `SELECT ... FOR UPDATE` on Event, sums `partySize` of GOING RSVPs, refuses at `rsvpLimit` with 409 `RSVP_FULL`.
- **D8: One RSVP per contact per event**, idempotent. Submitting again updates party size and re-sends confirmation. The response is identical, so the form does not reveal who has RSVP'd.
- **D9: Existing contact names preserved.** An RSVP fills a missing name but never overwrites from an unauthenticated form.
- **D10: Cancel link, no account.** Signed single-purpose token in the confirmation email.
- **D11: Mode switch locked** once anything happened. `TICKETED→RSVP` refused while the event has any order; `RSVP→TICKETED` refused while it has any GOING RSVP (409 `ADMISSION_MODE_LOCKED`).
- **D13: Consent trail.** Forms accept `acceptances[]`, `LegalAcceptanceService` writes rows with `source: 'RSVP'`, `referenceType: 'EventRsvp'`.

## Customer list — RSVP'd filter (phase 3)

The customers list gains an **RSVP** dropdown filter (next to the segment filter). `rsvp=going` shows contacts with at least one GOING RSVP, bypassing the default money-collected predicate. An optional `eventId` scopes it to one event. The admin RSVPs tab links to the filtered customer list via `View customers`.

Backend: `CustomerService.customerWhere` replaces `customerPredicate(scope)` with `{ rsvps: { some: { status: 'GOING', ...(eventId && { eventId }) } } }` when `rsvp=going`.

## Customer timeline (phase 3)

`CustomerTimelineService` emits `RSVP_CREATED` and `RSVP_CANCELLED` entries with `rsvpId`, `partySize` and `event`. The customer detail page renders an RSVPs card between applications and the timeline.

## Event analytics (phase 3)

`EventService.getEventAnalytics` branches on `admissionMode`. For RSVP events, it returns headcount, RSVP count, cancelled count and remaining spots, with `tiers: []`, zero revenue and no per-tier breakdown. The frontend uses `RsvpAnalyticsSummary` and `rsvpAnalyticsCards()` to render headcount-focused stat cards.

## Reserved paths

`/rsvp` is reserved in both `redirectPath.js` (backend) and `storefrontHost.ts` / `storefrontHost.test.ts` (frontend) per gotcha 22.

## Configuration

- `RATE_LIMIT_RSVP_CREATE_LIMIT`, `RATE_LIMIT_RSVP_CREATE_WINDOW_MS` (default 30/hour/IP)

## Gotcha

**RSVP ≠ Order.** When the task touches `Event.admissionMode`, branch on it — never on `priceTiers.length === 0`. An RSVP event is never an Order, never counts in revenue/analytics/tax, and the checkout refuses it with `EVENT_NOT_TICKETED`. The customers list's default predicate is still contacts with paid orders; the RSVP'd filter is separate.