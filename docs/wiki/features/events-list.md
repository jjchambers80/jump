# Events List (Admin)

The admin Events list (`/admin/events`) is the organizer's main management surface for events. It was redesigned in spec 035 to be full-width, with a KPI summary strip, filter toolbar, and compact event cards.

## Components

| Component | File | Role |
|---|---|---|
| `EventsPageHeader` | `components/events/EventsPageHeader.tsx` | Icon tile, `<h1>Events</h1>`, total pill, subtitle, Create Event link |
| `EventsSummary` | `components/events/EventsSummary.tsx` | KPI strip: 4 cards (Registered, Published, Drafts, Available inventory) in a `grid-cols-2 xl:grid-cols-4` layout |
| `EventsToolbar` | `components/events/EventsToolbar.tsx` | Status radiogroup with counts, search (300ms debounce), category select, sort select |
| `EventListCard` | `components/events/EventListCard.tsx` | `<article aria-labelledby>` with `<h2>` title, date tile, status pill, category chip, sold/avail, sell-through bar |
| `EventActionsMenu` | `components/events/EventActionsMenu.tsx` | `⋯` overflow menu with keyboard nav (ArrowDown/Up, Escape), focus return |
| `EventsPagination` | `components/events/EventsPagination.tsx` | Numbered pagination `<nav aria-label="Pagination">`, `aria-current="page"`, Prev/Next buttons |
| `CancelEventDialog` | `components/events/CancelEventDialog.tsx` | Modal confirm dialog for event cancellation (replaces `window.confirm`) |

## Key Behaviors

- **URL-driven state**: Filters (status, q, category, sort) and page number live in URL search params via `useSearchParams`. Wrapped in `<Suspense>` per Next 14 App Router requirement.
- **Debounced search**: 300ms debounce on the search input before updating the URL and refetching.
- **Filter persistence**: Filters survive page reload because they are in the URL.
- **Status filter as radiogroup**: Uses `role="radiogroup"` with `role="radio"` and `aria-checked` buttons (not tab panels), with counts inside the accessible name (e.g. "Published, 7 events").
- **Card layout**: `grid-cols-[auto_1fr] xl:grid-cols-[auto_1fr_auto]` — date tile, content, actions. Below xl the actions row moves under the content.
- **Primary action per card type**: DRAFT/PUBLISHED → Edit (link); DRAFT also shows Publish; CANCELLED → Duplicate. Remaining actions in `⋯` menu.
- **Contextual actions**: TICKETED published → Analytics; RSVP → RSVPs. Never both on the same card.
- **Sell-through**: Sold ÷ sum of tier `quantityTotal`, labelled "Cap: N (x%)". RSVP events show "N going / M limit".
- **Pagination**: Page size 25. `Showing N–M of K events` alongside numbered buttons with ellipsis for large page counts.
- **Loading state**: Skeleton placeholders with `aria-busy="true"`.

## Accessibility (WCAG 2.2 AA)

- `<h1>Events</h1>` on the page; each card `<article aria-labelledby>` with an `<h2>` title linking to Edit.
- Status radiogroup labelled "Filter by status", each radio has `aria-checked` and count in accessible name.
- Search input `type="search"` with `aria-label="Search events"`.
- Category select with `aria-label="Filter by category"`, sort select with `aria-label="Sort events"`.
- Result count in `role="status"` region announced on filter changes.
- Every `⋯` button has `aria-label="More actions for {eventName}"`.
- All interactive controls ≥ 24×24 px (WCAG SC 2.5.8). Verified in Playwright.
- Pagination `<nav aria-label="Pagination">` with `aria-current="page"` on the active page button.
- Focus-visible rings on all controls (`focus-visible:ring-2 focus-visible:ring-indigo-500`).
- No horizontal scroll at 320px or 390px viewport widths.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/organizations/:orgId/events` | List with `q`, `category`, `status`, `sort`, `page`, `limit` params |
| `GET` | `/organizations/:orgId/events/summary` | Counts (all/statuses), published capacity+count, drafts count, registered tickets+RSVPs, available inventory, distinct categories |
| `GET` | `/organizations/:orgId/events/export.csv` | Same filters and sort, streamed CSV, all pages |

Sort options: `upcoming` (default, date asc + past newest first), `date_desc`, `created_desc`, `name_asc`.

## Key Files

- `frontend/src/app/admin/events/page.tsx` — Page entry point, `EventsListShell` + `EventsListContent` split for Suspense boundary
- `frontend/src/components/events/*` — All event list components
- `frontend/e2e/admin-events-list.spec.ts` — Playwright e2e tests (23 tests: KPI, filters, URL round-trip, keyboard nav, cancel dialog, a11y checks, responsive, screenshots)
- `backend/src/api/routes/events.js` — Backend list + summary endpoints

## Gotchas

- The page is wrapped in `<Suspense>` because `EventsListContent` uses `useSearchParams()`. Keep this pattern; never render `useSearchParams` outside a Suspense boundary.
- The debounce timeout (300ms) means key-by-key URL updates are delayed. Tests that type multiple characters should wait for the debounce to fire (see `filters round-trip through URL reload` test pattern).
- `aria-labelledby` on the article must match the `id` of the `<h2>` inside it. Both are set in `EventListCard.tsx` using `headingId = `event-card-${event.id}-title` ``.
- Capacity on events-list cards uses `sum of tier quantityTotal`, not `Event.capacity` — tiers own the inventory.
- Past uncancelled events get an "Ended" pill and muted styling, but their status filter position (PUBLISHED) is unchanged.
- RSVP events have `admissionMode: 'RSVP'` and no price tiers; `isRsvp` branches show RSVP count + goings, never Analytics or sell-through.

## History

| Spec | Changes |
|---|---|
| 035A | Events list API: search, category, sort, summary endpoint + contract tests |
| 035B | Full-width shell, header, new event card components |
| 035C | KPI strip, filter toolbar, URL-driven state |
| 035D | CSV export endpoint + header button |
| 035E | WCAG 2.2 AA a11y+responsive e2e tests, wiki page |