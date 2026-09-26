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
- **Workspace tabs** (shared, `components/events/EventWorkspace.tsx`): Overview · Applications (to-review count) · Map · Attendees (ticketed) or Guest list (RSVP) · Analytics (ticketed) · Door check-in (when there are forms).
- **Main column**: Sales (tier table, add-ons, money footer, Orders link = `/admin/orders?eventId=`) or RSVPs; Applications (per-form pipeline bar, tiers); Event details (description through `ContentHtml`, folds when long).
- **Aside**: Date & venue, Admission (`CapacityMeter` + issued / checked in), Floor map (booth matrix, one cell per booth, scaled above 120), Listing, Tax & payments.

Sections are `OverviewSection` cards (`components/events/EventOverviewSections.tsx`) with an Edit link whose accessible name says what it edits. Edit links go to `/admin/events/:id/edit?orgId=…#event-<section>`; the edit page scrolls `<main>` to that card with `jumpTo` once loaded, and Save / Cancel / "Back to event" return here. Analytics and Applications pages link "← Back to event" here too.

Admin search event results open this page (`AdminSearchService` `eventHref`).

## Event workspace (spec 037 phase 2)

Every page of one event mounts `EventWorkspaceHeader` — breadcrumb (Events › event › page), the page's `<h1>`, status + event name + date in the venue zone, optional actions, and the tab bar. Facts come from `GET /organizations/:orgId/events/:eventId/workspace` (`EventService.getEventWorkspace`: name, status, date, venue zone, admission mode, `mapId`, `formCount`, `toReview`). The Details page renders its own hero and reuses `WorkspaceTabs` / `workspaceTabs()`.

| Tab | Route | Notes |
|---|---|---|
| Overview | `/admin/events/:id` | This page |
| Applications | `/admin/events/:id/applications[/forms]` | `ApplicationsHeader` = workspace header + Queue / Forms switch |
| Map | `/admin/events/:id/map` | With a map: `router.replace` to the builder `/admin/maps/:mapId` (its back arrow returns to the event). Without: Blank map or a saved floor plan (`mapsApi.createFromFloorPlan`) |
| Attendees | `/admin/events/:id/attendees` | `TicketRowsView` with `eventId` (event filter locked and hidden) — Orders › Tickets stays the cross-event lookup |
| Guest list | `/admin/events/:id/rsvps` | RSVP events |
| Analytics | `/admin/events/:id/analytics` | Ticketed events |
| Door check-in | `/admin/events/:id/check-in` | Phone-first page; keeps its own header with "← Back to event" |

Saved items (D2) are managed where they are used: **Saved tiers** (`TierPresetMenu`, pick / edit / delete / new, in the Price Tiers header of the create and edit pages), application templates in the forms page's **Start from** picker, floor plans in Maps (see [Map templates](map-templates.md)).

## Tests

`frontend/e2e/admin-event-details.spec.ts` (sections, Edit hrefs, tabs, RSVP variant, not-found, 390 px), `admin-events-list.spec.ts` (card link, whole-card click).
