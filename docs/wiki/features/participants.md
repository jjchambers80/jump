# Participants

**Status**: Phase 1 implemented 2026-09-18 (organization-wide submissions list, shared table, Applications tab listing forms across events). Phases 2 (templates) and 3 (tags, check-in) planned. Spec: `specs/019-participants/`.
**Last Updated**: 2026-09-18

## Overview

**Participants** is the sidebar home for everyone who applies to an organization's events — vendors, exhibitors, sponsors, press, panelists. It shows every submission (spec 011 `Application`) across every event in one list, modelled on Eventeny's "Submissions List" (`docs/research/eventeny-submissions-list.png`): logo, business, contact, short id, tags, application, status, payment, submitted date and a `⋯` actions menu; search, filters, saved views, bulk decisions and CSV.

Why this exists when the spec 018 Transactions list was removed: submissions had no organization-wide home (only the per-event tab), so this is not a duplicate list. Two guard-rails keep it that way:

1. **One table.** `SubmissionsTable` renders both `/admin/participants` and `/admin/events/:eventId/applications`. The per-event mount passes `eventId` and loses the Event filter and event line; everything else is identical (same `data-testid`s, same URL params).
2. **One detail page.** Rows link to `/admin/events/:eventId/applications/:id`. Participants has no detail route of its own.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/migrations/20260922000000_participants_list_index` | `Application(organizationId, submittedAt)` index behind the org-wide list (re-added; the spec 018 removal dropped the earlier one) |
| `backend/src/services/ApplicationService.js` | `listInScope` / `summaryInScope` / `exportCsvInScope` / `bulkDecideInScope` over a `{ eventId?, organizationId? }` scope; the per-event `list` / `summary` / `exportCsv` / `bulkDecide` are thin wrappers after `requireEvent`. `_listWhere(scope, query)`, `_listOrder` (+ `business_desc`, `status_desc`, `event`), `_serializeRow` (+ `shortId`, `eventId`, `event`, `organization` when unscoped, `logoUrl`, `statusUrl`), exported `shortId(id)` |
| `backend/src/services/ApplicationFormService.js` (`listFormsInScope`) | Forms across the organization with their event, non-draft `applicationCount`, acceptance and active application add-ons |
| `backend/src/services/applicationLinks.js` (`statusUrlWithBase`) | Status link from a known storefront base — the list resolves one base per organization instead of one per row |
| `backend/src/api/routes/admin.js` (Participants block, `participantsScopeFor`) | `GET /admin/applications`, `…/summary`, `…/export.csv`, `POST …/bulk`, `GET /admin/application-forms` — registered before the per-event block |
| `frontend/src/components/applications/SubmissionsTable.tsx` | The shared table: URL query state, summary chips, filters (Event on the org mount, Form, Payment, Add-on, Sort), search, saved views, bulk bar, sortable Status header, `⋯` menu, `DecisionDialog` mount, pagination |
| `frontend/src/components/applications/BusinessCell.tsx`, `RowActionsMenu.tsx` | Logo / initial + name + contact + `ID: XXXXXXXX`; `role="menu"` with View · decisions for the row's status · Copy status link |
| `frontend/src/lib/savedViews.ts` | `readSavedViews` / `writeSavedViews` / `viewKey` generic over a `localStorage` key (`jump.applications.views.<eventId>` per event, `jump.participants.views.org` org-wide) |
| `frontend/src/app/admin/participants/page.tsx`, `ParticipantsHeader.tsx`, `useParticipantsApi.ts` | Submissions page; header with Submissions / Applications tabs; org-wide API client |
| `frontend/src/app/admin/participants/applications/page.tsx` | Applications tab: forms across events (Event, Form, Kind, Status, Submissions link, Edit) — templates land here in phase 2 |
| `frontend/src/app/admin/events/[eventId]/applications/page.tsx` | Now `ApplicationsHeader` + `SubmissionsTable eventId=…` |
| `frontend/src/app/admin/events/[eventId]/applications/DecisionDialog.tsx` | `submitWhenClean` — a decision can be sent with the untouched template (previously the button stayed disabled until something was edited) |
| `frontend/src/components/AdminSidebar.tsx` | **Participants** after Customers |
| `frontend/src/lib/applications.ts` | `ApplicationRow` additions, `OrgForm`, `shortId()` |

## How It Works

### Scope

`participantsScopeFor(req)` follows the customers route: SYSTEM_ADMIN is unscoped (`organizationId: null`, rows and forms carry `organization`); a member is scoped to the active organization (X-Jump-Org); a staff user with no membership gets empty results (`{ data: [], total: 0, summary: {} }`, `{ data: [] }`, an empty CSV, bulk results all "Application not found").

### Query

`_listWhere(scope, query)`: `status ≠ DRAFT`, plus `eventId` / `organizationId` from the scope. Filters `event` (org mount only; must be in scope, else 404 like `requireEvent`), `form`, `tier`, `addOn`, `status` (comma list), `payment`. `q` matches business name, contact first / last name, email, form name, `boothLabel`, the exact id, and — when the term is 6–25 `[a-z0-9]` — the lower-cased id tail (`shortId` is the last 8 characters upper-cased; cuids are lowercase). Sorts: `submitted_asc`, `business`, `business_desc`, `status`, `status_desc` (Postgres enum order: SUBMITTED < WAITLISTED < APPROVED < REJECTED < WITHDRAWN), `event` (event date desc, then submitted desc); default submitted desc. `summary` counts by status over the scope alone, so the chips stay stable while filtering. Org mount page size 25; per-event keeps `LIST_PAGE_SIZE`.

### Bulk across events

`bulkDecideInScope` loads `{ id, eventId }` for the ids inside the scope, groups by event and runs the per-event path per group, so every rule holds (state machine, PAID approve refused, tier capacity at approval). Results keep the caller's order; ids outside the scope come back `{ ok: false, error: 'Application not found' }`.

### CSV

Same builder as the per-event export. Org-wide adds `event`, `eventDate` (and `organization` when unscoped) as the first columns, add-on columns are the union across the rows' events, filename `participants-<yyyy-mm-dd>.csv`, and more than 10 000 rows is a 413 ("narrow the filter").

### Decisions from the list

`⋯` → decision → the table fetches the full application through the per-event route (`GET /admin/events/:eventId/applications/:id`) and mounts the existing `DecisionDialog` with the row's `eventId`. `onDecided` patches the row's `status` / `paymentStatus` / `decidedAt` and refreshes `summary` with one call — no full reload.

## API Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/admin/applications` (`event,form,status,payment,tier,addOn,q,sort,page,pageSize`) | organizer+ |
| GET | `/admin/applications/summary`, `/admin/applications/export.csv` | organizer+ |
| POST | `/admin/applications/bulk` `{ ids, decision, note? }` | organizer+ |
| GET | `/admin/application-forms` | organizer+ |

## Testing

- `backend/tests/contract/participants.test.js` — scope matrix, `q` per field + id tail, every sort, `event` filter 404, filters compose, paging, bulk across two events with a PAID approve refused, CSV columns for member and SYSTEM_ADMIN, route ordering, index (`EXPLAIN` with `enable_seqscan = off`).
- `frontend/e2e/participants.spec.ts` — sidebar entry, list with two events, status header sort, event filter narrowing the Form options, search by short id, `⋯` → Waitlist round-trip (row + chips updated, no reload), bulk to the org route, saved views under `jump.participants.views.org`, per-event mount without Event filter, Applications tab; axe on both mounts.
- `frontend/e2e/applications*.spec.ts` still cover the per-event mount (same `data-testid`s).

## Gotchas

- `statusUrl` on rows costs one `storefrontFor` per organization in the page, not per row — keep it that way (`_storefrontBases`).
- The e2e mocks for the per-event list predate spec 019 and omit the new row fields; the table treats `eventId`, `shortId`, `event`, `logoUrl`, `statusUrl` as optional at runtime (`row.eventId ?? eventId`, `row.shortId ?? shortId(row.id)`).
- Two `next dev` servers sharing `.next` can serve a stale chunk on the first compile; a Playwright failure that passes alone is that, not the code.
- Phase 3 will add `tags[]`, `checkedInAt` / `checkedOutAt`; the Tags column shows `boothLabel` as a single chip until then.

## Related Features

- [Applications](applications.md) — the per-event forms, submissions and money this list reads.
- [Application payments — reporting and corrections](application-payments-reporting.md) — why there is no org-wide money list.
- [Add-ons](add-ons.md) — the Add-ons column and "has add-on" filter.
