# Spec 034 — RSVP events: free admission, headcount and marketing capture

Status: **Planned** · Written 2026-09-22 · All decisions resolved 2026-09-22 (§4, §9) · Kanban JUMP-034A/B/C · Related: 007 (tenant contacts), 020 (abuse limits), 023/024 (consent + legal trail), 032 (customer detail), 033 (venue time zones)

## 1. Problem

Some events are free and open to the public. The organizer does not sell anything, but still wants two things out of the event page:

1. **A headcount** — how many people plan to come.
2. **Marketing capture** — a name and email for every attendee, with an explicit opt-in to news and updates.

Today every event is ticketed. The only way to model a free event is a $0 price tier, which drags the buyer through the checkout, creates `Order` rows with no money in them (noise in Orders, analytics and the tax report — spec 024 made `Order` the money ledger), and shows an "Order Summary" column for a purchase that is not happening.

## 2. Goals

1. An organizer can set an event to **RSVP** instead of **Ticketed**. RSVP events need no price tiers.
2. The public event page keeps its layout, but the tier list is replaced by an inline RSVP form and the right-hand Order Summary column is gone.
3. Every RSVP creates or updates the organization's `Contact` (spec 007) with its marketing status — subscribed or not — so it shows up under Customers.
4. Optional party size and optional total cap, enforced server-side.

## 3. Non-goals

- **Check-in.** No QR, no scanner, no door list toggle. RSVP is headcount + marketing capture only.
- **Phone / SMS.** Not collected. SMS needs TCPA written consent, 10DLC registration and a sending provider Jump does not have; that is its own spec.
- **Waitlist.** A full event says so; nothing queues.
- **Mixed events** (free RSVP plus a paid VIP tier). The mode is an enum so this stays possible later, but v1 is one or the other.
- **Reminder emails.** See §9.2.

## 4. Decisions

**D1. A mode, not "an event with no tiers".** `Event.admissionMode` (`TICKETED` default | `RSVP`). Every surface branches on the mode, never on `priceTiers.length === 0` — a draft ticketed event with no tiers yet must not render as an RSVP event.

**D2. An RSVP is not an `Order`.** New `EventRsvp` row. No money, no tickets, no `OrderItem`, nothing in `PAID_ORDER_STATUSES`, nothing in revenue, analytics money or the tax report. `/admin/orders` stays the one money surface (gotcha 17) and does not list RSVPs.

**D3. Form fields: first name, last name, email, party size (only when the organizer allows more than 1), marketing opt-in checkbox.** `Contact.firstName` / `lastName` are non-null, so a name is required; the organizer also needs it for the list. No phone.

**D4. Opt-in is unchecked by default and names the organization** ("Email me news and updates from {org}"). It goes through `ContactOptInService.apply` with a new `EmailSubscribedSource.RSVP`, so it only ever turns on — an unchecked box never unsubscribes an existing subscriber (the unsubscribe flow owns that).

**D5. Inline form in the tier slot, no right column.** On `lg+` the content card goes full width; the form sits where `activeTiers` render today. Below `lg`, a sticky bottom "RSVP" bar scrolls to the form (mirrors the existing mobile cart bar). No modal, no extra click.

**D6. Cap and party size are their own columns.** `Event.rsvpLimit Int?` (null = unlimited headcount) and `Event.rsvpMaxPartySize Int @default(1)`. `Event.capacity` keeps its meaning (ceiling for ticketed inventory); RSVP-mode create/edit writes `capacity = rsvpLimit ?? venue capacity ?? 0` so the non-null column stays valid and nothing that reads it breaks.

**D7. Headcount is enforced under a row lock.** Creating or growing an RSVP runs `SELECT ... FOR UPDATE` on the `Event` row, sums `partySize` of `GOING` RSVPs, and refuses with 409 `RSVP_FULL` past `rsvpLimit` — same pattern as `PriceTier` capacity (backend `AGENTS.md`).

**D8. One RSVP per contact per event, idempotent, no enumeration.** `@@unique([eventId, contactId])`. Submitting again updates the party size (still under D7) and re-sends the confirmation. The response is identical whether the email was new or already on the list ("You're on the list — check your email"), so the form does not reveal who has RSVP'd.

**D9. Existing contacts keep their names.** An RSVP fills a missing name but never overwrites an existing contact's first/last name from an unauthenticated form.

**D10. Cancel link, no account.** The confirmation email carries a signed, single-purpose link (`/rsvp/:token/cancel`) that sets the RSVP to `CANCELLED`. Keeps the headcount honest without making buyers sign in.

**D11. Mode switch is locked once anything happened.** `TICKETED → RSVP` is refused while the event has any order; `RSVP → TICKETED` is refused while it has any `GOING` RSVP (409 `ADMISSION_MODE_LOCKED`). Tiers on an event switched to RSVP are kept but never serialized publicly or sold.

**D12. Checkout refuses RSVP events.** `POST /orders` returns 409 `EVENT_NOT_TICKETED` for an RSVP event, regardless of what tiers exist. Public serializer omits `priceTiers` and `addOns` in RSVP mode.

**D13. Consent trail.** The form echoes `GET /legal/versions` as `acceptances`, like checkout; `LegalAcceptanceService` writes rows with a new `LegalSource.RSVP`, `referenceType: 'EventRsvp'`. Enforcement follows `LEGAL_ACCEPTANCE_REQUIRED` exactly as checkout does.

## 5. Data model

```prisma
enum AdmissionMode { TICKETED RSVP }
enum RsvpStatus    { GOING CANCELLED }

model Event {
  // ...
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
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  event   Event   @relation(fields: [eventId], references: [id])
  contact Contact @relation(fields: [contactId], references: [id])

  @@unique([eventId, contactId])
  @@index([eventId, status])
  @@index([contactId])
}

// additions
enum EmailSubscribedSource { ... RSVP }
enum LegalSource           { ... RSVP }
```

Migration is additive with defaults; existing events become `TICKETED`. No backfill.

## 6. API

| Method + path | Auth | Notes |
|---|---|---|
| `POST /events/:eventId/rsvps` | public, `RSVP_CREATE` limiter | Body `{ firstName, lastName, email, partySize?, marketing, acceptances? }`. Event must be `PUBLISHED`, `RSVP`, not past. Upserts `Contact` via `organizationId_email`, upserts `EventRsvp` under D7, applies opt-in, writes legal rows, sends confirmation. Always `202 { status: 'ok' }` on success (D8) |
| `POST /rsvps/cancel` | public, token | Body `{ token }`. Idempotent |
| `GET /admin/events/:eventId/rsvps` | ORGANIZER, org-scoped | List + `{ headcount, rsvpCount, cancelledCount }`; `?format=csv` export (name, email, party size, subscribed, RSVP'd at in the viewer's account zone) |
| `PATCH /admin/events/:eventId` | existing | Accepts `admissionMode`, `rsvpLimit`, `rsvpMaxPartySize`; D11 lock; RSVP mode skips tier validation |
| `POST /orders` | existing | D12 guard |
| `GET /events/:slug` (public) | existing | Adds `admissionMode`, `rsvpRemaining` (headcount left, or null), `rsvpMaxPartySize`; drops tiers/add-ons in RSVP mode |

New limiter `RATE_LIMIT_RSVP_CREATE_*` (default 30/hour/IP, like `APPLICATION_SUBMIT`); add to the env table in root `AGENTS.md`.

Service layering: `RsvpService` (create, cancel, list, headcount) in `backend/src/services/`, validator in `validators/`, routes in a new `rsvps.js` registered in `server.js`.

## 7. Phases

### Phase 1 — backend (JUMP-034A)

- Schema + migration (§5), `npm run db:generate`.
- `RsvpService`, validator, public + admin routes, cancel token (reuse the buyer-token signing helper pattern; purpose-scoped, no expiry before the event date).
- `EmailService.sendRsvpConfirmation`: org branding, event date via `formatEventDateTime` + venue zone (gotcha 27), party size, `.ics` attachment, cancel link.
- `EventService`: create/update accept the mode fields; publish skips the tier requirement in RSVP mode; D11 lock; public serializer changes.
- `OrderService` / orders route: D12 guard.
- Event cancellation notifies `GOING` RSVP guests and sets their RSVPs `CANCELLED` (§9.3).
- `ContactOptInService.apply` accepts `source: 'RSVP'`.
- Tests: unit for headcount math; contract tests for create (new contact, existing contact keeps name, opt-in on/off never unsubscribes, duplicate submit updates party size, identical responses), cap races (two concurrent RSVPs at the last seat), `RSVP_FULL`, party size > max, draft/past/ticketed event refused, cancel idempotent, checkout refuses RSVP event, mode-switch locks, CSV.

### Phase 2 — frontend (JUMP-034B)

- Admin new + edit event: **Admission** segmented control (`Ticketed` / `RSVP`) above tiers. RSVP hides tiers, add-ons, tax and fee copy; shows "Limit RSVPs" toggle + number and "Guests per RSVP" (1–10). Locked control with an explanation when D11 applies.
- Admin event page: **RSVPs** tab — headcount summary, table (name, email, party size, subscribed badge, RSVP'd at), CSV export; hidden for ticketed events.
- Storefront `EventDetailClient`: RSVP branch per D5 — inline form, "N spots left" when capped, "RSVPs are full" and "This event has ended" states, success state in place ("You're on the list — we sent a confirmation to …"), sticky mobile bar. Brand tokens via `BrandScope` only (gotcha 6).
- `EventCard` + listing: "Free · RSVP" instead of `priceRange`.
- `/rsvp/cancel` page (storefront shell, reads token, confirms).
- Tests: Vitest for any pure helpers; Playwright for the RSVP happy path, full state and admin mode toggle (`signInAsStaff`).

### Phase 3 — customers, reporting, docs (JUMP-034C)

- `CustomerTimelineService`: `RSVP_CREATED` / `RSVP_CANCELLED` entries; customer detail shows the contact's RSVPs.
- Customers list: **RSVP'd** filter (§9.1), optionally scoped to one event; the admin RSVPs tab links to it.
- Event analytics page: headcount instead of revenue/tickets for RSVP events; dashboard money untouched.
- `redirectPath.isReservedPath` + `storefrontHost.ts`: reserve `/rsvp` (gotcha 22); add the store-access gate to the new public route.
- `/doc-feature` wiki page `docs/wiki/features/rsvp-events.md`, AGENTS gotcha, `specs/STATUS.md` row.

## 8. Risks

- **Bots filling the list.** Limiter + Contact upsert keep it bounded; captcha deferred unless abuse shows up (spec 020 edge-layer decision).
- **Silent tier leak.** An event switched to RSVP keeps its tiers; D12 and the serializer are the guard. Covered by contract tests.
- **`Event.capacity` readers.** D6 keeps the column populated; grep every reader in phase 1 to confirm none assumes tiers exist.

## 9. Resolved questions (2026-09-22)

1. **Where RSVP contacts appear under Customers → add an "RSVP'd" filter.** The default Customers list stays "money collected" (`CustomerService`, spec 032 phase 3); RSVP-only contacts remain `Prospect`. Phase 3 adds an **RSVP'd** filter (contacts with at least one `GOING` RSVP, optionally scoped to one event) next to the segment filter, and the RSVPs tab links to it.
2. **Reminder email 24 h before → follow-up, not v1.** Tracked as a separate card after phase 3 (sweep job modelled on the application sweep).
3. **Cancelling an RSVP event emails its guests → yes, in phase 1.** `EventService` cancellation calls `EmailService.sendCancellationNotification` for every `GOING` RSVP's contact (transactional, no opt-in needed), alongside the existing ticket-holder path; RSVPs are set to `CANCELLED`.
