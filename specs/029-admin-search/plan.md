# Implementation Plan: Administration header search (spec 029)

**Status**: Planned (2026-09-19). Not implemented.
**Kanban**: root `t_d72634f6` → planning `t_c081886d` (this document) → backend `t_82d2f9dc`, header UI `t_af409c82` → verify `t_bedcd0b6`.
**Branch**: plan committed on `wt/t_c081886d`. Implementation branches are chosen by the coding workers.
**Dependencies**: nothing new. Reuses the `/admin` router, `resolveOrgScope`, existing list-search semantics, and the existing header layout.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Admin global header | `frontend/src/app/admin/AdminLayoutClient.tsx` (brand/toggle left, `OrgSwitcher` right) | The search control mounts in this bar, between the brand and the switcher |
| Admin sidebar | `frontend/src/components/AdminSidebar.tsx` | Defines the searchable sections and their list routes |
| Auth + RBAC for admin routes | `backend/src/api/routes/admin.js` — router-level `requireAuth` + `requireOrganizer` (`middleware/rbac.js`: ORGANIZER/ADMIN/SYSTEM_ADMIN) | New route goes in this router, no per-route middleware needed |
| Org scoping | `middleware/orgScope.js` `resolveOrgScope` / `isUnscoped`; `X-Jump-Org` honored for SYSTEM_ADMIN | Identical scope logic as `/admin/orders`, `/admin/customers` |
| List-search semantics already shipped | `OrderService._orgOrdersWhere` (orderRef/contact/business ILIKE + Stripe-id equality), `getTicketsByOrganization` OR predicate, `CustomerService.getCustomersByOrganization` (email/first/last/businessName ILIKE) | The search service replicates the same OR predicates per resource (they are private; do not refactor the services, copy the documented semantics) |
| API client | `frontend/src/services/api.ts` (Bearer + `X-Jump-Org` injection) | Header search fetches through it |
| Empty/loading/error list-state idioms | `admin/orders/OrdersListView.tsx`, `admin/customers/page.tsx` | Dropdown states reuse the same copy style |
| Validation error shape | `middleware/errorHandler.js` `ValidationError` → `{ error: 'Validation failed', details: [...] }` | New validator throws the same shape |
| Rate limiter factory | `middleware/rateLimit.js` `makeLimiter(name, opts)` (spec 020) | Optional `SEARCH` limiter; pass-through under test |
| E2E session helper | `frontend/e2e/helpers/session.ts` `signInAsStaff`, route stubbing via `page.route` | `admin-search.spec.ts` uses both |

## 2. Design

### 2.1 What is searchable and what matches

Nine resources, each org-scoped. `q` matches case-insensitively (`ILIKE '%term%'`) unless stated.

| Resource | Matched fields | Scope predicate | Cap | Result `href` | `meta` |
|---|---|---|---|---|---|
| EVENT | `Event.name`, `Venue.name` | `event.venue.organizationId` (reuse `venueFilter`) | 5 | `/admin/events/<id>/edit` (as the Events list rows) | `date`, `status` |
| VENUE | `Venue.name` | `venue.organizationId` | 3 | `/admin/venues` (no detail route) | — |
| CUSTOMER | `Contact.email`, `firstName`, `lastName`, `applicantProfiles.businessName` (exactly the `CustomerService` predicate) | `contact.organizationId` (column) | 5 | `/admin/customers/<id>` | `email` |
| ORDER | `Order.orderRef`, `Order.businessName`, contact first/last/email of `Order.contact`; a term starting `pi_`/`re_`/`pyr_`/`cs_` matches by **equality** against `PaymentTransaction.stripePaymentIntentId`, `Refund.stripeRefundId`, Checkout session id (same semantics as `_orgOrdersWhere`) | `order.event.venue.organizationId` | 5 | `/admin/orders/<id>` | `kind`, `status` |
| TICKET | `Ticket.barcode` (term uppercased), `Ticket.order.orderRef`, ticket contact and order contact first/last/email (same OR as `getTicketsByOrganization`) | `ticket.event.venue.organizationId` | 5 | `/admin/tickets?search=<q>` (no ticket detail route) | `eventId`, `status` |
| APPLICATION | `Application.contact` first/last/email, `applicantProfiles.businessName`; **never** match DRAFT rows (`status != 'DRAFT'`, mirrors every list) | `application.organizationId` (column, spec 019) | 5 | `/admin/events/<eventId>/applications/<id>` | `eventId`, `status` |
| PAGE | `Page.title` | `page.organizationId` | 3 | `/admin/online-store/pages` (list; editor is a dialog) | — |
| BLOG_POST | `BlogPost.title` | `blogPost.organizationId` | 3 | `/admin/content/blog-posts/<id>` | `publishedAt` |
| FILE (`StoreFile`) | `StoreFile.name` | `storeFile.organizationId` | 3 | `/admin/content/files/<id>` | `extension` |

Notes:
- Content groups (PAGE, BLOG_POST, FILE) and VENUE are included but cheap: own-org column scans on small tables.
- Result caps per resource guarantee a bounded response; total cap 37 (sum above). No pagination in the dropdown — it is a launcher, not a list page.
- `href` composes server-side as a platform admin path (admin is never tenant-hosted). For EVENT include `?orgId=<organizationId>` exactly as the Events list rows do when a scope org exists; other detail pages resolve org through `OrgContext` and need no param.
- "View all" affordance per group is the frontend's job (§2.5); it deep-links to the section list, passing `search`/`q` **only where the list page already supports it**: orders (`?search=`), tickets (`?search=`), customers (`?search=`), blog posts (`?search=`), files (`?search=`), participants (`?q=`). Events, venues, pages lists have no free-text search — "View all" lands plain (adding `search` to `GET /admin/events` is an optional extension, explicitly out of v1 scope).

### 2.2 API contract — `GET /admin/search`

One endpoint; the backend queries all nine resources in parallel and flattens in fixed group order.

**Request**
```
GET /admin/search?q=<term>
```
- Auth: bearer staff session; org scope from `resolveOrgScope` (honors `X-Jump-Org` for members and SYSTEM_ADMIN).
- `q` required, trimmed; length 2–200 inclusive after trim. Otherwise 400 `ValidationError` with `details: [{ field: 'q', message: 'q must be 2–200 characters' }]`. Below 2 chars is refused server-side so single-character scans never reach the DB; the client also gates at 2.
- No other query params in v1.

**Response 200**
```json
{
  "query": "acme",
  "total": 6,
  "data": [
    {
      "type": "EVENT",
      "id": "clx…",
      "title": "Acme Summer Fest",
      "subtitle": "Jun 21, 2026 · Civic Hall",
      "href": "/admin/events/clx…/edit?orgId=org_1",
      "meta": { "status": "PUBLISHED" }
    }
  ]
}
```
- `type` ∈ `EVENT | VENUE | CUSTOMER | ORDER | TICKET | APPLICATION | PAGE | BLOG_POST | FILE` — a single flat enum the frontend groups by, so the client stays dumb.
- `title` = the primary label (event/venue/customer/page/blog/file name, orderRef, barcode); `subtitle` = secondary context (customer email, attendee, venue+date, `kind · status`); both strings, frontend renders them plainly.
- `meta` = optional per-type extras from the table above; additive only.
- `data` ordered: events, venues, customers, orders, tickets, applications, pages, blogPosts, files; stable within a group (each query's own `orderBy`).
- Empty result is 200 with `total: 0, data: []` — it is not an error.

**Errors**
- 401 unauthenticated (`requireAuth`), 403 role below ORGANIZER (`requireOrganizer`); 403 for staff with no org membership surfaces as 200-empty like `/admin/customers` and `/admin/orders` do today (staff with no membership see nothing, not a 404).
- SYSTEM_ADMIN with no `X-Jump-Org` is unscoped and searches all orgs (same as other admin lists); with `X-Jump-Org` scoped to that org.
- 400 for missing/short/long `q`; 500 handled by the existing `next(error)` path.

### 2.3 Backend implementation

- **`backend/src/services/AdminSearchService.js`** (new): `search({ organizationId, unscoped }, q)` — builds the nine Prisma queries with the predicates from §2.1, each `select`-only the fields needed for `title/subtitle/href/meta`, each with its `take` cap, run in a single `Promise.all`, then flattened in the fixed order. Reuse `venueFilter`-style scoping: pass `scope.organizationId` or `null` (unscoped) and build `event: { venue: { organizationId } }` etc. exactly as the existing routes do. Never search drafts (`Application.status != 'DRAFT'`).
- **`backend/src/api/routes/admin.js`**: `router.get('/search', validateAdminSearchQuery, ...)` — same `resolveOrgScope` / empty-for-no-membership handling as `GET /orders`. No conflict with parameterized routes; `blogsRouter` mounts before `adminRouter` on `/admin` and has no `/search`.
- **`backend/src/api/validators/adminValidators.js`**: `validateAdminSearchQuery` (trim, min 2, max 200 → `ValidationError`).
- No `server.js` change (router already mounted), no env vars, no npm dependencies.

### 2.4 Indexing and performance

- Current indexes cannot serve `ILIKE '%term%'` (btree works for prefix/equality only): `Event.name` unindexed, `Venue(organizationId)`, `Contact(organizationId,email) unique`, `Order.orderRef` btree, `Page/organizationId,createdAt`, `BlogPost(organizationId,updatedAt)`, `StoreFile(organizationId,name)`.
- At Jump's scale the org-scoped sequential scans with `take` caps are fast enough; the 2-char minimum and per-resource caps bound the worst case. This is the v1 strategy: **no new dependency; rely on scope + caps**.
- Optional hardening (recommended, low risk, one additive migration): `pg_trgm` GIN indexes on the hot text columns so `ILIKE '%…%'` uses trigram indexes: `Event.name`, `Venue.name`, `Contact.email/firstName/lastName`, `Order.orderRef`, `Application` contact fields are reached through relations (leave), `Page.title`, `BlogPost.title`, `StoreFile.name`. Declare with Prisma's `type: Gin` + `ops: raw("gin_trgm_ops")` in `schema.prisma` and add a raw `CREATE EXTENSION IF NOT EXISTS pg_trgm` migration before it. **Risk**: `CREATE EXTENSION` needs a role with the right privileges on the managed Postgres — verify on Railway before including; if blocked, ship v1 without the extension (scans stay bounded by scope+caps) and revisit when a resource exceeds ~50k rows/org. If this migration is included, note `db push` databases need the extension created manually (mirror the spec 024 backfill-script pattern) and mention it in the migration header comment.
- No Redis involvement (list lookups are too cheap to cache; the existing Redis layer is for public storefront paths).
- Rate limiting (optional, recommended): `RATE_LIMIT_SEARCH_LIMIT` / `_WINDOW_MS` via `makeLimiter` on this route, pass-through under test per spec 020. If omitted, the `BASELINE` limiter still applies.

### 2.5 Frontend implementation

- **`frontend/src/lib/adminSearch.ts`** (new): `AdminSearchRow` / `AdminSearchResponse` types, `SEARCH_GROUP_ORDER` and `GROUP_LABEL` maps (`EVENT → Events` …), `searchQueryString(q)`. No fetching here.
- **`frontend/src/components/AdminSearch.tsx`** (new, `'use client'`): mounted in `AdminLayoutClient.tsx` inside the header bar between the brand block and `OrgSwitcher`, `flex-1 max-w-md`.
  - **Behavior**: form submission and a 250 ms debounced input; gate at 2 trimmed chars (hint "Type at least 2 characters" below the threshold); `AbortController` cancels the in-flight request when the query changes or the dropdown closes; refetch when `useOrg().selectedOrgId` changes (clear results on org switch).
  - **States**: idle hint; loading (small spinner row); results grouped by `type` with group headers and a "View all … in <Section>" footer link per group (hrefs per §2.1 notes, `?search=<q>`/`?q=<q>` where supported); no-results ("No results for “q”" + a hint listing what it searches: name, email, order number, barcode); request error (message + retry button, consistent with list-page error copy).
  - **Keyboard/a11y**: `role="combobox"` `aria-expanded` + `aria-controls` listbox; `ArrowUp`/`ArrowDown` cycle a highlighted row, `Enter` opens it, `Escape` closes; results are real `<Link>`s (middle-click/target works); outside click closes; `prefers-reduced-motion` respected, durations short (design-motion skill).
  - **Responsive**: `< md` the input collapses to an icon button that opens a full-width search row beneath the header bar; desktop keeps the inline input. The OrgSwitcher and mobile sidebar toggle stay untouched.
  - Fetch through `services/api.ts` (`api.get<AdminSearchResponse>('/admin/search?q=…')`) so `X-Jump-Org` and the bearer token are injected automatically.
- **`AdminLayoutClient.tsx`**: import and render `<AdminSearch />`. No `useSearchParams` anywhere in the control (no Suspense requirement); Gotcha 14 (dev server restart after `next build`) unaffected.

### 2.6 Authorization boundaries (summary)

All three layers already exist; the feature only rides them:
1. Edge: `frontend/src/middleware.ts` redirects unauthenticated `/admin*` to sign-in.
2. Component: `AdminRoute` (`AdminLayoutClient`) blocks non-staff.
3. Backend: `/admin` router `requireAuth` + `requireOrganizer`; record-level scoping via `resolveOrgScope` in the route, predicates org-scoped in the service (§2.1). SYSTEM_ADMIN unscoped only without `X-Jump-Org`; members never see another org's rows (contract test pins this). Buyers (`jump_buyer` cookie) are rejected by `requireAuth` (staff tokens only) — no buyer surface.

## 3. Files

- Backend: `backend/src/services/AdminSearchService.js` (new), `backend/src/api/routes/admin.js`, `backend/src/api/validators/adminValidators.js`, optional migration `packages/db/prisma/migrations/*_admin_search_trgm` + `schema.prisma` GIN indexes (§2.4).
- Frontend: `frontend/src/components/AdminSearch.tsx` (new), `frontend/src/lib/adminSearch.ts` (new), `frontend/src/app/admin/AdminLayoutClient.tsx`.
- Tests: `backend/tests/contract/adminSearch.test.js` (new), `frontend/e2e/admin-search.spec.ts` (new), optional `frontend/src/lib/__tests__/adminSearch.test.ts` if the Vitest harness is extended beyond `lib/color.ts`.
- Docs (after the feature ships): `docs/wiki/features/admin-search.md` via `/doc-feature`, `specs/STATUS.md` row for 029, and an AGENTS.md Gotcha only if a future pitfall is discovered.

## 4. Tests

**Backend contract (`backend/tests/contract/adminSearch.test.js`)** — follow existing conventions: `staffToken({ email, role })` + `joinOrgByToken` from `tests/helpers/staff.js`, own email/orderRef namespace, `afterAll` cleanup in dependency order (Contact before Organization), `@jest/globals`, mock `@jump/db` not `@prisma/client`.
- 401 without token; 403 for `UNASSIGNED`; 200 for ORGANIZER / ADMIN.
- 400: missing `q`, `q` of 1 char, `q` of 201 chars; 400 shape `details[0].field === 'q'`.
- Matching per resource type (one row reachable per resource; assert `type`, `title`, `href`).
- No results → 200 `{ query, total: 0, data: [] }`.
- Org isolation: same term present in two orgs' data → only active org rows returned (tenantIsolation-style); member with no membership → empty.
- SYSTEM_ADMIN: unscoped returns rows from both orgs; `X-Jump-Org` header scopes it.
- Caps: create 6 matching events → 5 returned.
- Draft applications excluded; Stripe-id term (`pi_…`) matches order by equality; barcode term matches ticket.
- Multi-word/whitespace term trimmed; case-insensitive match.

**Frontend E2E (`frontend/e2e/admin-search.spec.ts`)** — `signInAsStaff` (mint session cookie + mock `GET /api/auth/session`), stub the backend with `page.route('**/admin/search*')` for deterministic fixtures (established pattern).
- Typing 2+ chars submits and renders grouped results; selecting (click) navigates to the row's href.
- ArrowDown + Enter opens the highlighted result; Escape closes; outside click closes.
- No results state; error state (route returns 500 → message + retry).
- Foreign-org exclusion: fixtures contain another org's rows and the UI never renders them (mocked backend stands in; the real guarantee is the contract test).
- Header/nav regression: OrgSwitcher and sidebar toggle still visible/usable on desktop and mobile.

**Unit**: backend validator unit test if one exists for other validators (or fold into contract); frontend grouping helper test if the Vitest harness gains jsdom-free pure-function support (`lib/color.ts` today) — otherwise covered by E2E. Mark any harness limitation in the PR.

## 5. Acceptance criteria

1. `GET /admin/search?q=` exists under the existing `/admin` auth+role guard; 401/403 behave like sibling admin routes.
2. `q` < 2 or > 200 chars (after trim) → 400 `ValidationError` with `details[0].field === 'q'`; trimming is server-side truth.
3. Empty/whitespace `q` cannot reach the database (client gates at 2 too).
4. Results are scoped: a member sees only their organization's rows across all nine resource types; a memberless staff user gets `{ query, total: 0, data: [] }`; SYSTEM_ADMIN sees all orgs without `X-Jump-Org` and one org with it.
5. Every resource type matches its §2.1 fields case-insensitively (contains); orders additionally match `pi_`/`re_`/`pyr_`/`cs_` ids by equality; DRAFT applications never appear.
6. Per-resource caps from §2.1 hold; response `data` is ordered by the fixed group order; `href`s match the existing navigation targets (rows use the same paths as the section lists' own links).
7. Total runtime stays bounded: 9 capped org-scoped queries, no in-memory scan of full tables (each query has `take` + org predicate).
8. The header search renders in the admin header on desktop; on mobile it degrades to the icon-expanded row; OrgSwitcher and sidebar behavior are unchanged.
9. Keyboard: combobox/listbox pattern with arrow navigation, Enter opens, Escape closes; results are links so middle-click works.
10. States: idle hint, loading, grouped results, no-results ("No results for “q”"), and request error with retry are all rendered.
11. Changing org in the switcher resets/refetches search results (no stale cross-org results).
12. Contract tests and the E2E spec pass (`cd backend && npm test`, `cd frontend && npx playwright test admin-search`); no other suite regresses.
13. Docs: after merge, `docs/wiki/features/admin-search.md` exists via `/doc-feature` and `specs/STATUS.md` lists 029.

## 6. Risks / open items

- **pg_trgm extension privileges** on the managed Postgres role (§2.4) — verify before including the migration; v1 is complete without it.
- **Order `href` event detail**: application results need the application's `eventId` to build the per-event detail href; the service must select it (listed in §2.1 `meta`).
- **Adding `search` to `GET /admin/events`** ("View all" pre-filter for events) is deferred; note it in the verify card if a test needs it.
- **Frontend unit harness** currently only exercises `lib/color.ts`; if adding a jsdom component test is disproportionate, cover behavior in E2E and say so.
- The dropdown intentionally has no pagination and no results page: this is a launcher. If lists grow past ~50k rows/org, revisit pg_trgm (or Postgres FTS over a generated tsvector) per §2.4.