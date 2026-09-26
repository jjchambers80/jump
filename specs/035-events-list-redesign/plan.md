# Spec 035 — Events list redesign: full width, summary strip, filters, cards

Status: **Planned** · Written 2026-09-24 · All decisions resolved 2026-09-24 (§9) · Kanban JUMP-035A–E (§8) · Related: 024 (one ledger / `PAID_ORDER_STATUSES`), 033 (venue time zones), 034 (RSVP events), resource slugs (PRs #119–#121), #154 (two-column event form)

Source design: Google Stitch export `~/Downloads/stitch_card_layout_redesign/screen.png` (+ `code.html`), screen `25fe21a927aa46708dcd60aff08995ed`. It is a direction, not a pixel spec.

## 1. Problem

`/admin/events` (`frontend/src/app/admin/events/page.tsx`, 442 lines) is a `max-w-5xl` column of flat cards. On a wide screen two-thirds of the width is empty. Each card has up to nine equal-weight text buttons in one row, which wraps badly and has no clear primary action. The page cannot search, filter by category or sort, shows no totals, and gives no sense of how an event is selling without expanding its tier table.

## 2. What the mockup adds (inventory)

| # | Feature / component | Today | Backend work |
|---|---|---|---|
| F1 | Full-width shell | `max-w-5xl mx-auto` | — |
| F2 | Header: icon tile, title, **"N Total" pill**, subtitle, **Export CSV**, Create Event | title + Create only | total from pagination; CSV endpoint (F11) |
| F3 | **KPI strip**, 4 cards: Total registered (+ trend), Published live (count + capacity), Cancelled / inactive (count + capacity), Available inventory (tickets + tiers) | none | new summary endpoint — the page only holds one page of events, so client sums would be wrong |
| F4 | **Status segmented control with counts**: All (5) · Draft (0) · Published (2) · Cancelled (3) | plain buttons, no counts | counts from summary endpoint |
| F5 | **Search** "Filter by title, venue…" | none | `q` param on list |
| F6 | **Category dropdown** | none | `category` param + distinct categories in summary |
| F7 | **Sort control** | fixed `createdAt desc` | `sort` param |
| F8 | **Event card**: status accent bar on the left edge, **date tile** (month / day / year), title, status pill with dot, category chip with icon, tier-count chip, date/time + zone, venue, "N sold / N avail", "Cap: N (x%)", **sell-through bar** | text row with emoji icons | — (data already in payload) |
| F9 | Action row: Analytics, RSVPs, Show Tiers, Applications, Event Page, **Edit (primary)**, **✕ (cancel)**; cancelled rows: Show Tiers, Duplicate, Applications, RSVPs, **⋯ overflow** | 5–9 equal buttons | — |
| F10 | Footer: "Showing 1–5 of 5 events", **numbered pagination** | Prev / "Page x of y" / Next | — |
| F11 | Export CSV | none | new CSV endpoint honoring the same filters |
| F12 | Dark-first styling | light + dark via Tailwind `dark:` | — |

## 3. Decisions (discretion calls on the mockup)

**D1. Width.** Use the same shell as the event form (#154): `mx-auto w-full max-w-screen-2xl px-4 sm:px-6`. Full width up to 1536 px keeps one rhythm across Events → Edit, and stops 30-character rows stretching across a 2560 px monitor.

**D2. Keep, drop, change.**
- **Keep** F1, F2, F4–F8, F10, F11.
- **KPI strip (F3): keep 4 cards, redefine two.** "Total registered" = paid tickets (`PAID_ORDER_STATUSES`, gotcha 17) **plus** RSVP "going" headcount, labelled so the mix is honest ("Registered · tickets + RSVPs"). **Drop the "+12% vs last mo" trend** in v1: it needs a dated baseline the list doesn't have and a wrong trend is worse than none; revisit with Analytics. "Cancelled / inactive" → **"Drafts"** card instead: a cancelled event's capacity is not actionable, drafts are. Cancelled count still lives in the status control.
- **Drop** "All time data synced" (says nothing) and monospaced numbers (use `tabular-nums` in the admin font).
- **Change the action row (F9)** — see D3.

**D3. Actions: one primary, two contextual, the rest in ⋯.** Seven buttons per card do not survive a 390 px screen and bury Edit. Per card:
- Primary: **Edit** (DRAFT, PUBLISHED); **Publish** for DRAFT sits next to it (the mockup lost Publish — keep it). CANCELLED: **Duplicate** is primary.
- Contextual, branched on `admissionMode` (gotcha 29), never on tier count: TICKETED → **Analytics** (published) + **Tiers** disclosure; RSVP → **RSVPs**. Today every card shows RSVPs, including ticketed ones.
- **⋯ menu** (reuse the `RowActionsMenu` keyboard pattern from spec 019: arrows, Escape, focus return): Event page ↗, Applications, Duplicate, Copy link, **Cancel event…** (destructive, last, red).
- **No ✕ icon for cancel.** An ✕ reads as "dismiss card", and cancelling an event emails buyers. It goes in ⋯ and opens a real confirm dialog (replace `window.confirm`).

**D4. Status is never color alone.** The left accent bar and date-tile tint are decoration; the status pill carries the word. Colors: PUBLISHED green, DRAFT slate, CANCELLED red, past (date < now, not cancelled) muted with an "Ended" pill.

**D5. Dates are the venue's clock (spec 033).** The date tile and the date line both format with the venue `timezone` (`formatEventDate…` helpers), zone abbreviation always shown. A late-night event must not land on a different tile day than its date line.

**D6. Sell-through bar.** TICKETED: sold ÷ sum of tier `quantityTotal` (inventory lives on tiers — gotcha 4), label "Cap: N (x%)" uses the same denominator; `Event.capacity` is only a ceiling. RSVP: going ÷ `rsvpLimit`, or no bar when unlimited. The bar is `aria-hidden`; the text next to it carries the numbers.

**D7. Default sort = upcoming first** (`date asc`, future before past), then past events newest first. Past events stay in **All** (and their status filter) with an **Ended** pill; there is no separate Past filter. Options: Upcoming, Date (newest), Recently created, Name A–Z. Sort, status, category, `q` and page live in the URL (`useSearchParams` → `<Suspense>`), so a filtered view can be shared and survives reload.

**D8. Event page link uses the slug URL** (resource slugs, PRs #119–#121) — today it is `/events/${id}`.

**D9. Tier disclosure stays**, as a `button[aria-expanded][aria-controls]` over the existing table (today it has neither attribute). The table gets a `<caption class="sr-only">`.

## 4. Layout

```
xl ≥1280                                         md 768–1279              < md
┌ header: icon · Events [12 total]   [Export][+Create] ┐   same, buttons wrap     title row, buttons full-width
├ KPI ×4 ───────────────────────────────────────────── ┤   KPI 2×2               KPI 2×2 (compact)
├ [All 12|Draft 2|Published 7|Cancelled 3]  [search][cat][sort] ┤  status row, then filters row   status scrolls-x, filters stacked
├ card ▌[date] title pill chip chip            [Edit][Publish][Tiers][⋯] ┤                        actions under body
│      ▌       date·zone  venue                                          │
│      ▌       9 sold / 3,391 avail ▬▬▬▬▬ Cap 5,000 (0.2%)               │
├ …                                                                      ┤
└ Showing 1–25 of 57            [‹ Prev] 1 2 3 [Next ›] ┘                 Prev / Next only
```

Grids: KPI `grid grid-cols-2 xl:grid-cols-4 gap-4`. Card body `grid grid-cols-[auto_1fr] xl:grid-cols-[auto_1fr_auto] gap-4` (date tile · content · actions); below `xl` the actions row moves under the content.

## 5. Accessibility (WCAG 2.2 AA)

- Page `<h1>`; each card an `<article aria-labelledby>` with an `<h2>` title linking to Edit.
- Status control: `role="radiogroup"` of `aria-checked` buttons (it filters one list, it is not tab panels); counts inside the accessible name ("Published, 7 events").
- Search `<input type="search">` with a visible or `sr-only` label; category `<select>` labelled; sort a labelled `<select>` (not an icon-only button — the mockup's sort icon has no text).
- Result count in a `role="status"` region so filter changes are announced ("7 events").
- Every icon-only control (⋯) has an accessible name that includes the event ("More actions for Comedy Night Special").
- Targets ≥ 24×24 px (2.5.8, as fixed in #155); visible `focus-visible` rings; 4.5:1 text, 3:1 for pill borders/bars on both themes.
- Pagination `<nav aria-label="Pagination">`, `aria-current="page"`.
- Loading skeleton `aria-busy` on the list; motion respects `prefers-reduced-motion`.

## 6. Backend changes

1. `GET /organizations/:orgId/events` — add `q` (case-insensitive `contains` on event name and venue name), `category`, `sort` (`upcoming` | `date_desc` | `created_desc` | `name_asc`, validated, default `upcoming`). Include `admissionMode`, `slug`, and for RSVP events a `rsvpGoingCount` (one `groupBy`, no N+1).
2. `GET /organizations/:orgId/events/summary` — one call: `counts {all, DRAFT, PUBLISHED, CANCELLED}`, `published {count, capacity}`, `drafts {count}`, `registered {tickets, rsvps}` (tickets from `PAID_ORDER_STATUSES` only), `inventory {available, tiers}` over PUBLISHED events, `categories: string[]` (distinct, sorted). Honors the same `q` / `category` filters except status, so the counts match what the tabs would show. `categories` is the org's full distinct category list — it ignores the category (and status) filter, so the dropdown always offers every category. Counts still honor `q`/`category`.
3. `GET /organizations/:orgId/events/export.csv` — same filters and sort, all pages, streamed; columns: name, status, admission mode, date (venue zone, ISO + zone), venue, category, tiers, sold, available, capacity, RSVPs going, public URL. Formula-injection-safe cells (reuse the escaping in the existing add-on / RSVP CSV exports).
4. Contract tests for all three, including org isolation (another org's events never counted) and a TICKETED/RSVP mix.

## 7. Frontend changes

- Split the 442-line page: `EventsPageHeader`, `EventsSummary` (KPI strip), `EventsToolbar` (status / search / category / sort), `EventListCard`, `EventActionsMenu`, `EventsPagination` under `frontend/src/app/admin/events/`.
- URL-driven state + debounced search (300 ms).
- Keep `DuplicateEventDialog`; add `CancelEventDialog`.
- Page size **25** (was 20).
- Playwright spec `admin-events-list.spec.ts` (mock API, `signInAsStaff`): full width at 1440, KPI 2×2 at 390, no horizontal scroll, filters round-trip through the URL, RSVP card shows RSVPs and no Analytics, ⋯ menu keyboard, cancel needs confirmation, 24 px targets.

## 8. Triage — proposed Kanban cards

Order is chosen so each card ships on its own and the page never regresses.

| Card | Title | Scope | Depends on | Size |
|---|---|---|---|---|
| **035A** `t_2171f25c` | Events list API: search, category, sort, summary | §6.1, §6.2 + contract tests | — | M |
| **035B** `t_235d5afc` | Events list: full-width shell, header, new card | F1, F2 (minus Export), F8, D3–D6, D8, D9; component split; uses the existing list payload | — (parallel with A) | L |
| **035C** `t_3c3cc3cd` | Events list: KPI strip + filter toolbar | F3, F4–F7, F10, URL state, D7 | A, B | M |
| **035D** `t_ddb49911` | Events list: CSV export | §6.3 + header button | A | S |
| **035E** `t_7d16ff9b` | Events list: a11y + responsive e2e, wiki page | §5 checks in Playwright, `/doc-feature` → `docs/wiki/features/events-list.md` | B, C | S |

A and B run in parallel (separate worktrees); C is the merge point. Each card: PR with required checks green, before/after screenshots at 1440 and 390 in the PR body.

## 9. Decisions resolved (2026-09-24)

1. **Trend on "Registered"**: dropped for v1 (D2). Revisit alongside Analytics.
2. **Past events**: shown in "All" with an "Ended" pill; no fifth filter (D7).
3. **Export scope**: one row per event, the §6.3 columns. Per-tier sales already export from the event's Analytics page; a second per-tier CSV here would duplicate it.
4. **Page size**: 25.

## 10. Non-goals

- Bulk actions / row selection.
- Changing the event editor, analytics, RSVP or applications pages.
- Calendar or table view toggle.
- Storefront changes.
