# Event Details (Admin)

`/admin/events/[eventId]` is the event's read-only home (spec 037 phase 1). The events list card opens it; every section shows what is set and links to the one place it is edited. The page itself writes nothing except the event's lifecycle actions: Publish, Duplicate, Close / Reopen sales, Unpublish, Cancel and Delete draft (spec 050-D).

> **Spec 050 (event setup wizard, behind `NEXT_PUBLIC_EVENT_WIZARD_ENABLED`, off in prod):** with the flag on, every Edit control below opens the wizard at `/admin/events/:id/setup?step=<key>` and the four flyouts never mount. See [Event Setup Wizard](event-setup-wizard.md) › Edit mode for the section → step map. The flyout table below describes the flag-off page.

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

Types: `frontend/src/lib/eventOverview.ts`. Contract test: `backend/tests/contract/eventOverview.test.js`.

## Layout

- **Hero** (`page.tsx` `EventHero`): image tile with a date badge, status, "Starts in N days", name, date in the venue zone, venue, public path; actions View page · Publish (DRAFT; **Continue setup** instead on a wizard draft with `setupCompletedAt` null, flag on) · Edit event · `⋯` (`EventActionsMenu`: Duplicate, Close sales… / Reopen sales and Unpublish… on PUBLISHED, Cancel, Delete draft… on DRAFT, through `EventLifecycleDialog`). A "Sales closed" pill shows while `salesClosedAt` is set. A refused Publish lists the readiness blockers (`PublishBlockers`, focused `role="alert"`, links to the old editors or, flag on, the wizard steps). Below a `Perforation`, four headline numbers (ticketed: Collected, Tickets sold, Checked in, Applications; RSVP: Guests, RSVPs, Spots left, Applications).
- **Workspace tabs** (shared, `components/events/EventWorkspace.tsx`): Overview · Applications (to-review count) · Map · Attendees (ticketed) or Guest list (RSVP) · Analytics (ticketed) · Door check-in (when there are forms).
- **Main column**: Sales (tier table, add-ons, money footer, Orders link = `/admin/orders?eventId=`) or RSVPs; Applications (per-form pipeline bar, tiers); Event details (description through `ContentHtml`, folds when long).
- **Aside**: Date & venue, Admission (`CapacityMeter` + issued / checked in), Floor map (booth matrix, one cell per booth, scaled above 120), Listing, Tax & payments.

Sections are `OverviewSection` cards (`components/events/EventOverviewSections.tsx`) with an Edit control whose accessible name says what it edits.

**Where each section is edited (spec 037 phase 3, D10; flag off):**

| Section | Editor |
|---|---|
| Event details, Date & venue | Full page `/admin/events/:id/edit/details#event-…` (name, URL, description, media, date & venue, listing) |
| Sales (whole table, add-ons) | Full page `/admin/events/:id/edit/sales#event-price-tiers` (admission, tiers, add-ons) |
| One tier (click its name) / **Add tier** | `TierFlyout` — PATCH / POST `…/price-tiers[/:id]`, sale window in the venue zone, quantity never below sold |
| Admission | `AdmissionFlyout` — capacity (never below the tiers' total) or RSVP limit / party size; the mode is locked once orders or RSVPs exist |
| Listing | `ListingFlyout` — category + URL slug (409 → slug error) |
| An application form's **Settings** | `FormSettingsFlyout` — name, status, opens / closes (venue zone); options and questions stay on the form page |

Flyouts are `components/Flyout.tsx`: right-hand panel on desktop, bottom sheet on phones, one `<form role="dialog">` with a sticky Cancel / Save footer, focus trap and return, Escape and backdrop ask before discarding unsaved changes. They PATCH only their own fields and the page reloads the overview. The full-page editors scroll `<main>` to the hash's card with `jumpTo`; Save / Cancel / "Back to event" return here, and the header's **Details | Sales** switch moves between them (confirming when dirty). The old `/edit` URL redirects to the editor that owns its hash (`edit/page.tsx`). Analytics and Applications pages link "← Back to event" here too.

Admin search event results open this page (`AdminSearchService` `eventHref`).

**Flag on (spec 050-O):** Edit controls are 44 px links carrying `&org=` (`detailsEditLinks`); new ones where a step had no entry point: **Edit image** (hero tile), **Change venue** (Date & venue), **Edit add-ons** (Sales and RSVPs). The wizard's Save & exit comes back with `?saved=1` / `?saved=0`; the page announces "Saved." or "Your latest changes were not saved." in an always-mounted `role="status"`, drops the marker and focuses the exact Edit control used (`lib/detailsReturn.ts`). `/edit`, `/edit/details`, `/edit/sales` and the Applications › Forms config pages redirect to the wizard.

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

`frontend/e2e/admin-event-details.spec.ts` (flag-off server: sections, Edit hrefs, tabs, flyouts: admission, tier edit / add, listing, form settings, Escape guard, RSVP variant, not-found, 390 px, no setup links), `admin-event-edit-mode.spec.ts` (flag-on server: every section link → step, saved notice, focus return, redirects), `admin-event-close-sales.spec.ts`, `admin-event-publish-blockers.spec.ts`, `admin-events-list.spec.ts` (card link, whole-card click).
