# Event Details (Admin)

`/admin/events/[eventId]` is the event's read-only home (spec 037 phase 1). The events list card opens it; every section shows what is set and links to the one place it is edited. The page itself writes nothing except the event's lifecycle actions: Publish, Duplicate, Close / Reopen sales, Unpublish, Cancel and Delete draft (spec 050-D).

> **Spec 050-P (2026-10-11):** every Edit control on this page opens the [event setup wizard](event-setup-wizard.md) at `/admin/events/:id/setup?step=<key>`. The four flyouts and the section editors are gone; see the wizard page › Edit mode for the full section → step map.

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
| `applications.forms[]` | Per form: status, dates, `purpose`, `spaceSelection` (spec 050-O: picks the form's wizard step and the map link), counts by status (DRAFT never counted), `approvedSettled` / `approvedAwaitingPayment`, tiers with booths on the map |
| `map` | Booths by status, `boothTotal`, `unassignedBooths` (no vendor space tier); `null` without a map |

The **Special guests** card makes a second request, `GET /organizations/:orgId/events/:eventId/guests` (the lineup routes, spec 050-Q), in parallel; a failure only affects that card.

Types: `frontend/src/lib/eventOverview.ts`. Contract test: `backend/tests/contract/eventOverview.test.js`.

## Layout

- **Hero** (`page.tsx` `EventHero`): image tile with a date badge, status, "Starts in N days", name, date in the venue zone, venue, public path; actions View page · Publish (DRAFT; **Continue setup** instead on a wizard draft with `setupCompletedAt` null) · Edit event · `⋯` (`EventActionsMenu`: Duplicate, Close sales… / Reopen sales and Unpublish… on PUBLISHED, Cancel, Delete draft… on DRAFT, through `EventLifecycleDialog`). A "Sales closed" pill shows while `salesClosedAt` is set. A refused Publish lists the readiness blockers (`PublishBlockers`, focused `role="alert"`, each linking to its wizard step). Below a `Perforation`, four headline numbers (ticketed: Collected, Tickets sold, Checked in, Applications; RSVP: Guests, RSVPs, Spots left, Applications).
- **Workspace tabs** (shared, `components/events/EventWorkspace.tsx`): Overview · Applications (to-review count) · Map · Attendees (ticketed) or Guest list (RSVP) · Analytics (ticketed) · Door check-in (when there are forms).
- **Main column**: Sales (tier table, add-ons, money footer, Orders link = `/admin/orders?eventId=`) or RSVPs; Applications (per-form pipeline bar, tiers); Special guests (lineup count, the first four names with role, hidden ones marked, "and N more"; empty state links to add one); Event details (description through `ContentHtml`, folds when long).
- **Aside**: Date & venue, Admission (`CapacityMeter` + issued / checked in), Floor map (booth matrix, one cell per booth, scaled above 120), Listing, Tax & payments.

Sections are `OverviewSection` cards (`components/events/EventOverviewSections.tsx`) with an Edit control whose accessible name says what it edits.

**Where each section is edited (spec 050-O/P):** every Edit is a 44 px link into the wizard carrying `&org=` (`detailsEditLinks` in `lib/eventWizard.ts`).

| Section | Opens |
|---|---|
| Hero **Edit event** / image tile **Edit image** | `step=name` / `step=image` |
| Date & venue (Edit / **Change venue**) | `step=date` / `step=venue` |
| Event details, Listing | `step=description` |
| Sales, Admission, RSVPs; one tier (click its name) | `step=tickets`; `&tier=<id>` opens that tier's dialog |
| Add-ons (**Edit add-ons** on Sales and RSVPs) | `step=collect-more` |
| An application form's **Edit form** | its flow at Form details, `setup/<flow>?step=details&form=<id>` (spec 051) |
| **Add to this event** (vendor application, special guests, volunteer application, other application) | `setup/<flow>`; special guests at `?step=lineup` ([Application setup flows](application-setup-flows.md)) |
| Floor map | `step=floor-map` while a VENDOR MAP form exists, else the Map tab |
| Special guests (**Edit special guests** / **Add a special guest**) | `step=special-guests` |

The wizard's Save & exit comes back with `?saved=1` / `?saved=0`; the page announces "Saved." or "Your latest changes were not saved." in an always-mounted `role="status"`, drops the marker and focuses the exact Edit control used (`lib/detailsReturn.ts`). The old `/edit`, `/edit/details`, `/edit/sales` and Applications › Forms URLs redirect to the wizard ([Event Editor](event-editor.md)). Analytics and Applications pages link "← Back to event" here too.

Admin search event results open this page (`AdminSearchService` `eventHref`).

## Event workspace (spec 037 phase 2)

Every page of one event mounts `EventWorkspaceHeader` — breadcrumb (Events › event › page), the page's `<h1>`, status + event name + date in the venue zone, optional actions, and the tab bar. Facts come from `GET /organizations/:orgId/events/:eventId/workspace` (`EventService.getEventWorkspace`: name, status, date, venue zone, admission mode, `mapId`, `formCount`, `toReview`). The Details page renders its own hero and reuses `WorkspaceTabs` / `workspaceTabs()`.

| Tab | Route | Notes |
|---|---|---|
| Overview | `/admin/events/:id` | This page |
| Applications | `/admin/events/:id/applications` | `ApplicationsHeader` = workspace header + **Add a form** (a disclosure listing the four application flows; forms are configured only there, spec 051) |
| Map | `/admin/events/:id/map` | With a map: `router.replace` to the builder `/admin/maps/:mapId` (its back arrow returns to the event). Without: Blank map or a saved floor plan (`mapsApi.createFromFloorPlan`) |
| Attendees | `/admin/events/:id/attendees` | `TicketRowsView` with `eventId` (event filter locked and hidden) — Orders › Tickets stays the cross-event lookup |
| Guest list | `/admin/events/:id/rsvps` | RSVP events |
| Analytics | `/admin/events/:id/analytics` | Ticketed events |
| Door check-in | `/admin/events/:id/check-in` | Phone-first page; keeps its own header with "← Back to event" |

Saved items (D2) are managed where they are used: **Saved tiers** (`TierPresetMenu`, pick / edit / delete / new, in the wizard's Tickets step), application templates in the wizard's **Start from** picker (edit and delete there too), floor plans in Maps (see [Map templates](map-templates.md)).

## Tests

`frontend/e2e/admin-event-details.spec.ts` (sections, every Edit href into the wizard, no retired links, Special guests card: names / hidden / more / empty / failed load, tabs, RSVP variant, not-found, payments notice, 390 px), `admin-event-edit-mode.spec.ts` (every section link → step, saved notice, focus return, redirects), `admin-event-close-sales.spec.ts`, `admin-event-publish-blockers.spec.ts`, `admin-events-list.spec.ts` (card link, whole-card click).
