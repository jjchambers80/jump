# Event Details (Admin)

`/admin/events/[eventId]` is the event's read-only home (spec 037 phase 1). The events list card opens it; every section shows what is set and links to the one place it is edited. The page itself writes nothing except the list card's own actions: Publish, Duplicate and Cancel.

Plan: `specs/037-event-workspace/plan.md`.

## Data

One request: `GET /organizations/:orgId/events/:eventId/overview` (`EventService.getEventOverview`, `requireOrgMembership`, 404 for an event of another organization).

| Key | Contents |
|---|---|
| `event` | `_formatEventDetail` (venue with `timezone`, tiers, tax, RSVP fields) |
| `money` | Paid orders of both kinds (`PAID_ORDER_STATUSES`): `gross`, `orgReceives`, `refunded` (succeeded refunds), `net = gross − refunded`, split `tickets` / `applications` |
| `tickets` | `issued` (not VOIDED), `checkedIn` (REDEEMED), `voided`; `null` for RSVP events |
| `rsvp` | `going`, `headcount`, `cancelled`, `remaining`; `null` for ticketed events |
| `addOns` | `AddOnService.sales` |
| `applications.forms[]` | Per form: status, dates, counts by status (DRAFT never counted), `approvedSettled` / `approvedAwaitingPayment`, tiers with booths on the map |
| `map` | Booths by status, `boothTotal`, `unassignedBooths` (no vendor space tier); `null` without a map |

Types: `frontend/src/lib/eventOverview.ts`. Contract test: `backend/tests/contract/eventOverview.test.js`.

## Layout

- **Hero** (`page.tsx` `EventHero`): image tile with a date badge, status, "Starts in N days", name, date in the venue zone, venue, public path; actions View page · Publish (DRAFT) · Edit event · `⋯` (`EventActionsMenu`). Below a `Perforation`, four headline numbers (ticketed: Collected, Tickets sold, Checked in, Applications; RSVP: Guests, RSVPs, Spots left, Applications).
- **Workspace tabs**: Overview · Applications (to-review count) · Floor map (when a map exists) · Analytics (ticketed) or Guest list (RSVP) · Door check-in (when there are forms). Phase 2 moves these pages under `/admin/events/:id`.
- **Main column**: Sales (tier table, add-ons, money footer, Orders link = `/admin/orders?eventId=`) or RSVPs; Applications (per-form pipeline bar, tiers); Event details (description through `ContentHtml`, folds when long).
- **Aside**: Date & venue, Admission (`CapacityMeter` + issued / checked in), Floor map (booth matrix, one cell per booth, scaled above 120), Listing, Tax & payments.

Sections are `OverviewSection` cards (`components/events/EventOverviewSections.tsx`) with an Edit link whose accessible name says what it edits. Edit links go to `/admin/events/:id/edit?orgId=…#event-<section>`; the edit page scrolls `<main>` to that card with `jumpTo` once loaded, and Save / Cancel / "Back to event" return here. Analytics and Applications pages link "← Back to event" here too.

Admin search event results open this page (`AdminSearchService` `eventHref`).

## Tests

`frontend/e2e/admin-event-details.spec.ts` (sections, Edit hrefs, tabs, RSVP variant, not-found, 390 px), `admin-events-list.spec.ts` (card link, whole-card click).
