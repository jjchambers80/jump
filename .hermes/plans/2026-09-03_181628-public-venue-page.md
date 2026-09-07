# Public Venue Page Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a public `/venues/[venueId]` page that displays the venue name and logo plus its published event cards, with each card linking to the existing `/events/[eventId]` purchase page, while ensuring the admin venue workflow can manage every venue-owned field shown publicly.

**Architecture:** Add a nullable `logoUrl` to `Venue`, expose one unauthenticated read endpoint at `GET /venues/:venueId`, and keep all venue writes on the existing authenticated organization-scoped routes. The public endpoint will return only public venue data and published events in the existing event-card summary shape. Extract the current public event card from `frontend/src/app/events/page.tsx` into a shared component so the venue page and event directory have one presentation and navigation contract.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Express 4, Prisma 6/PostgreSQL, Multer, Jest/Supertest, Playwright.

---

## Product Scope and Acceptance Criteria

### In scope

- Public route: `/venues/[venueId]`.
- Venue header showing the venue name and venue logo.
- Responsive list/grid of that venue's published events.
- Full event card is a link to `/events/[eventId]`.
- Empty, loading, and not-found/error states.
- Admin create/edit workflow supports venue name, logo, address, timezone, and public visibility.
- Admin can upload, replace, and remove a venue logo.
- Admin can open the public page for a public venue.
- Public event detail page links the venue name to its public venue page when the venue is public.
- Draft and cancelled events never appear on the public venue page.

### Explicitly out of scope for this simple page

- A public `/venues` directory or venue search.
- Venue descriptions, social links, maps, galleries, amenities, or contact information.
- Custom slugs; the first release uses the existing stable venue ID.
- Event management inside the venue edit form; events remain managed in `/admin/events`.
- Changing whether events at a non-public venue appear in the existing global `/events` directory. This is a separate product-policy decision and could unexpectedly hide ticketed events.
- New image storage infrastructure. This plan initially follows the existing local upload mechanism, with the deployment risk documented below.

### Observable acceptance criteria

1. An unauthenticated visitor can load `/venues/<public-venue-id>` and see the venue name, its configured logo, and its published events.
2. Each displayed card contains the same date, category, price range, and availability behavior as the global events page and navigates to `/events/<event-id>`.
3. Draft and cancelled events for the venue are absent from the response and page.
4. A missing or non-public venue returns a 404-shaped API response and a customer-friendly not-found state; it does not leak venue metadata.
5. A public venue with no published events renders a stable empty state rather than an error.
6. A venue without a logo renders an accessible fallback/placeholder so existing migrated venues remain usable.
7. ADMIN/ORGANIZER users can create a venue with a selected logo and can later upload, replace, or remove the logo.
8. Setting `isPublic` false makes the public venue endpoint unavailable while preserving admin access and existing event data.
9. Desktop and mobile layouts have no horizontal overflow, and all images have useful alt text.

---

## Current-State Evaluation

### Data model

- `packages/db/prisma/schema.prisma:96-111` defines `Venue` with `name`, `address`, `timezone`, and `isPublic`, but there is no venue logo field.
- `Event.logoUrl` already establishes the repository's nullable URL convention at `packages/db/prisma/schema.prisma:132-154`.
- A prior migration, `packages/db/prisma/migrations/20260216062327_add_event_logo_url/migration.sql`, provides the exact migration pattern to follow.

**Gap:** Add nullable `Venue.logoUrl`. Nullable is required for a safe migration of existing rows and permits an accessible fallback state.

### Backend/API

- `backend/src/api/routes/venues.js` currently exposes only authenticated routes under `/organizations/:orgId/venues`.
- `backend/src/api/server.js:90-101` has no public `/venues` mount.
- `backend/src/services/VenueService.js` supports organization-scoped CRUD but cannot set a logo or return a public venue with published events.
- `backend/src/api/validators/venueValidators.js` validates all existing editable metadata and `isPublic`; no logo should be accepted as an arbitrary JSON URL because logo mutation should go through the upload endpoint.
- The update validator does not reapply the create validator's 255-character name limit or 500-character address limit, so oversized values can enter through PATCH.
- `backend/src/services/EventService.js:283-351` already calculates the card fields needed by the new page: `priceRange` and `availableTickets`.
- `backend/src/api/routes/events.js:20-49,183-218` and the event admin edit form demonstrate an existing upload/replace/remove pattern.

**Gaps:** Public venue endpoint, public/private filtering, active-organization filtering, published-event filtering, venue logo persistence, consistent create/update validation, and organization-scoped logo upload/delete routes are missing.

### Administrative area

- `frontend/src/app/admin/venues/page.tsx` currently supports create/edit for name, address, timezone, and `isPublic`, and shows event counts.
- The page has no logo property, preview, file picker, replace/remove actions, upload state, or link to the public venue page.
- The inline form can create a record before it has an ID. To support a logo during creation, the submit sequence must create the venue first and then upload the selected file using the returned venue ID.
- `frontend/src/app/admin/events/[eventId]/edit/page.tsx:132-196,326-414` is the closest established upload UX and should guide validation, preview, drag/drop, replace, remove, and progress states.
- `frontend/src/services/api.ts:44-57` always calls `response.json()`. The existing venue delete route returns HTTP 204, so a successful delete can be misreported as a network/parse error. This should be fixed while hardening venue administration.
- `frontend/src/services/api.ts` and individual pages repeat asset URL assembly. The configured development URL is correctly documented as port 3002 in `frontend/.env.example`, but several fallback constants use port 3000; centralize this logic so venue and event logos cannot resolve against different backends.
- The active `005-create-event-rbac` work specifies one-organization ADMIN context and SUPER_ADMIN switching, but the current venue page still fetches all organizations through `GET /organizations`. Implement this feature on top of the finalized organization-context contract from that branch; do not reintroduce an all-organization selector for ordinary ADMIN users.

**Gaps:** Logo management and preview are required for public-page parity. The current 204 handling is a concrete venue-admin reliability defect. Organization context is concurrently changing and is a merge/integration risk.

### Public frontend

- No `frontend/src/app/venues/[venueId]/page.tsx` route exists.
- `frontend/src/app/events/page.tsx:46-153` contains a suitable clickable `EventCard`, but it is local to that page and cannot be reused.
- `frontend/src/app/events/[eventId]/page.tsx:247-268` shows venue name/address but does not link the venue name to a venue page.
- `frontend/src/app/layout.tsx` already supplies the public Navbar and theme wrapper, so the new route needs no new shell.
- `frontend/middleware.ts` protects only admin/dashboard/orders prefixes; `/venues/*` will remain public without middleware changes.

**Gaps:** New route, shared event card, public navigation path, and page-specific tests.

### Test coverage

- `backend/tests/contract/venues.test.js` covers authenticated venue CRUD but has no public endpoint, privacy, event-filtering, or upload tests.
- `backend/tests/contract/events.test.js` demonstrates public event contract setup and published/draft assertions.
- The frontend uses Playwright, but several older integration tests target stale selectors. New tests should be self-contained and use stable `data-testid` values rather than assuming those old tests prove the new flow.

---

## Proposed API Contract

### `GET /venues/:venueId`

No authentication required.

Success: HTTP 200

```json
{
  "venue": {
    "id": "venue-id",
    "name": "Venue Name",
    "address": "123 Main Street",
    "timezone": "America/New_York",
    "logoUrl": "/uploads/logos/file.webp"
  },
  "events": [
    {
      "id": "event-id",
      "name": "Event Name",
      "date": "2027-07-15T19:00:00.000Z",
      "venue": {
        "id": "venue-id",
        "name": "Venue Name",
        "address": "123 Main Street"
      },
      "category": "music",
      "status": "PUBLISHED",
      "priceRange": { "min": 25, "max": 75 },
      "availableTickets": 42
    }
  ]
}
```

Rules:

- Query the venue with `id = :venueId`, `isPublic = true`, and `organization.status = ACTIVE` in the same predicate.
- Return 404 for a missing or non-public venue.
- Include only `Event.status = PUBLISHED` events belonging to that venue.
- Sort events by `date ASC` for deterministic display.
- Calculate price/availability from active price tiers using the same logic as the global event directory.
- Do not return `organizationId`, internal counts, draft/cancelled events, or other admin-only fields.
- No pagination for the first simple version. Revisit if real venues exceed a practical card count.

### Admin logo endpoints

- `POST /organizations/:orgId/venues/:venueId/logo`
  - Authenticated and organization-scoped.
  - Multipart field name: `logo`.
  - Same size/type policy as the existing event-logo UI unless the upload helper is deliberately hardened for both features.
  - Returns the updated venue including `logoUrl`.
- `DELETE /organizations/:orgId/venues/:venueId/logo`
  - Authenticated and organization-scoped.
  - Clears `logoUrl` and returns the updated venue as JSON (HTTP 200), or returns 204 only after the API client is fixed to support empty bodies.

---

## Implementation Tasks

### Task 1: Add venue logo persistence

**Objective:** Give every venue an optional persisted logo URL without breaking existing data.

**Files:**
- Modify: `packages/db/prisma/schema.prisma:96-111`
- Create: `packages/db/prisma/migrations/<timestamp>_add_venue_logo_url/migration.sql`
- Modify: `packages/db/prisma/seed.ts:40-60` only if a checked-in sample asset/URL exists; do not invent an external URL.
- Modify: `docs/architecture/data-models.md` venue field table/diagram.

**Steps:**

1. Add a nullable `logoUrl String?` to `Venue`, adjacent to the other public presentation fields.
2. Add a migration containing `ALTER TABLE "Venue" ADD COLUMN "logoUrl" TEXT;`.
3. Run `npm run db:generate`.
4. Run the repository's migration workflow against the development database: `npm run db:migrate -- --name add_venue_logo_url` if the migration was not generated manually; do not generate a second migration.
5. Verify existing venues remain readable and have `logoUrl = null`.

**Expected verification:** Prisma generation succeeds; migration applies without a backfill or non-null failure.

### Task 2: Define and test the public venue API contract

**Objective:** Lock down public visibility and event-list behavior before implementation.

**Files:**
- Modify/Test: `backend/tests/contract/venues.test.js`

**Steps:**

1. Add fixtures for one public venue, one private venue, one venue under an inactive organization, and published/draft/cancelled events.
2. Write a failing test that unauthenticated `GET /venues/:venueId` returns the public venue fields and no `organizationId`.
3. Write a failing test that only published events for that exact venue are returned and are ordered by date.
4. Assert each returned event has the shared card fields: ID, name, date, venue, category, status, price range, and available ticket count.
5. Write failing 404 tests for unknown venues, `isPublic: false` venues, and venues owned by inactive organizations.
6. Write a failing empty-state contract test for a public venue with no published events (`events: []`).
7. Run: `npm test --workspace=backend -- tests/contract/venues.test.js --runInBand`.
8. Confirm the new tests fail because `/venues/:venueId` is not mounted.

### Task 3: Implement the public venue query and route

**Objective:** Return a privacy-safe venue payload and its published event summaries.

**Files:**
- Modify: `backend/src/services/VenueService.js`
- Modify: `backend/src/api/routes/venues.js`
- Modify: `backend/src/api/server.js:17-26,90-101`
- Modify: `specs/003-schema-redesign/contracts/api.yaml`
- Optionally create if needed to avoid duplicated calculations: `backend/src/utils/eventSummary.js`
- Modify if the formatter is shared: `backend/src/services/EventService.js:283-351`

**Steps:**

1. Extract or centralize the existing price-range and availability calculation so `/events` and `/venues/:id` cannot drift.
2. Add `VenueService.getPublicVenueById(venueId)` with one Prisma query that filters `isPublic: true` and active organization status, selects only public venue fields, and includes published events with active tier data.
3. Format events into the established event-card shape and sort by date ascending.
4. Split `backend/src/api/routes/venues.js` into a public router and the existing organization-scoped router, following the export pattern used by `backend/src/api/routes/events.js`.
5. Mount the public router at `/venues` and preserve the existing `/organizations/:orgId/venues` mount unchanged.
6. Return `NotFoundError('Venue not found')` for missing, private, or inactive-organization venues.
7. Update the OpenAPI venue schema plus public-detail and logo endpoint definitions in `specs/003-schema-redesign/contracts/api.yaml`.
8. Re-run: `npm test --workspace=backend -- tests/contract/venues.test.js --runInBand`.
9. Run regression tests: `npm test --workspace=backend -- tests/contract/events.test.js --runInBand`.

**Expected verification:** New venue contract tests pass, existing public events contract remains unchanged, and no admin endpoint becomes public.

### Task 4: Add and test organization-scoped venue logo management

**Objective:** Let authorized administrators upload, replace, and remove the exact image displayed publicly.

**Files:**
- Modify: `backend/src/services/VenueService.js`
- Modify: `backend/src/api/routes/venues.js`
- Modify: `backend/src/api/validators/venueValidators.js`
- Modify/Test: `backend/tests/contract/venues.test.js`
- Optional DRY refactor: create `backend/src/middleware/logoUpload.js` and modify `backend/src/api/routes/events.js` to consume it.

**Steps:**

1. Write failing multipart tests for valid upload, missing file, invalid file type, wrong organization/venue, and logo removal. Add cross-organization denial tests for every venue mutation path.
2. Apply the finalized organization-access guard from feature 005, and keep organization scoping inside service mutations rather than relying only on a route-level precheck.
3. Add a dedicated service method to set/clear `logoUrl` only after verifying the venue belongs to `orgId`.
4. Add authenticated `POST /:venueId/logo` and `DELETE /:venueId/logo` routes under the organization-scoped venue router.
5. Reuse the existing 5 MB logo policy and returned `/uploads/logos/<file>` URL convention. If extracting shared Multer setup, validate both MIME and extension, reject/sanitize SVG, and run event-logo regression tests as well.
6. Ensure JSON create/update validation whitelists accepted fields and does not accept a client-supplied arbitrary `logoUrl`.
7. Make PATCH enforce the same 255-character name and 500-character address limits as POST.
8. If feasible within the existing storage model, remove a replaced/deleted local file only after the database update succeeds; never delete files outside the configured upload root.
9. Complete the existing delete-with-linked-events 409 test and add suite cleanup so venue contract data is not left behind.
10. Run: `npm test --workspace=backend -- tests/contract/venues.test.js --runInBand`.
11. Run: `npm run lint --workspace=backend`.

**Expected verification:** Authorized upload/replace/remove works; invalid uploads and cross-organization IDs fail without changing venue data.

### Task 5: Extract one reusable public event card

**Objective:** Guarantee that the global event directory and venue page display and navigate events consistently.

**Files:**
- Create: `frontend/src/components/EventCard.tsx`
- Modify: `frontend/src/app/events/page.tsx:10-153,296-299`
- Create: `frontend/src/lib/assets.ts`
- Modify: `frontend/src/app/events/[eventId]/page.tsx` and `frontend/src/app/admin/events/[eventId]/edit/page.tsx` to use the shared asset URL helper.

**Steps:**

1. Move the `Event`, `EventVenue`, and `PriceRange` types plus `formatPrice` and `EventCard` into a reusable client component.
2. Preserve the whole-card `<Link href={`/events/${event.id}`}>` behavior, category, date/time, price range, availability, sold-out state, dark theme, and responsive styles.
3. Add stable test selectors on the card root and name without altering semantics.
4. Add one `resolveAssetUrl()` helper using `NEXT_PUBLIC_API_URL` with the documented `http://localhost:3002` development fallback; preserve already-absolute URLs.
5. Replace page-local logo URL construction with the shared helper.
6. Import the shared component/type into the existing `/events` page and remove the local duplicate.
7. Run: `npm run build --workspace=frontend`.

**Expected verification:** `/events` renders unchanged and every card still links to the event detail page.

### Task 6: Build the public venue page

**Objective:** Render the simple public venue experience with robust states.

**Files:**
- Create: `frontend/src/app/venues/[venueId]/page.tsx`
- Modify: `frontend/src/app/events/[eventId]/page.tsx:10-15,247-268`

**Steps:**

1. Define the page response type matching `GET /venues/:venueId` and fetch it with the existing `api` client.
2. Render a loading state, a not-found/error state with a route back to `/events`, and the success state.
3. In the success header, render venue name and logo. Resolve relative upload URLs against `NEXT_PUBLIC_API_URL`; preserve absolute URLs if encountered.
4. Render an accessible placeholder when `logoUrl` is null and meaningful alt text when present.
5. Render the response events through the shared `EventCard` in a one/two/three-column responsive grid.
6. Render a dedicated “No events scheduled” empty state for `events: []`.
7. Add stable `data-testid` attributes for venue name, logo/fallback, event list, event cards, and empty state.
8. On the existing event detail page, turn the venue name into a link to `/venues/${event.venue.id}`. Keep the address visible and do not nest this link inside another link.
9. Verify manually at desktop and mobile widths; confirm `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
10. Run: `npm run build --workspace=frontend`.

**Expected verification:** Direct public navigation works without sign-in, cards route correctly, and all states render without layout overflow.

### Task 7: Complete venue administration for public-page parity

**Objective:** Make `/admin/venues` the complete source of truth for fields shown or controlling the public venue page.

**Files:**
- Modify: `frontend/src/app/admin/venues/page.tsx`
- Modify: `frontend/src/services/api.ts:44-57`
- Test/Create: `frontend/e2e/admin-venues.spec.ts`
- Coordinate with the final admin organization-context files produced by `specs/005-create-event-rbac/`.

**Steps:**

1. Extend the admin `Venue` type with `logoUrl` and show a logo thumbnail/fallback in each venue row.
2. Add a file selection/preview area to the create/edit form, based on the established event-logo UX.
3. Validate file size/type before upload and show upload, replace, remove, error, and success states.
4. For creation, POST metadata first, then upload the selected logo using the returned venue ID; if upload fails, keep the created venue visible and report that only the logo failed rather than claiming the whole venue creation failed.
5. For edits, upload/replace/remove through the new venue logo endpoints and refresh the venue list after success.
6. Keep name, address, timezone, and `isPublic` editing intact. Label the visibility toggle clearly: when disabled, the public venue URL returns not found.
7. Add “View public page” for `isPublic: true` venues, opening `/venues/<id>` without exposing the link for private venues.
8. Fix `ApiClient.request` to handle HTTP 204/empty responses before calling `response.json()`, then verify the existing Delete Venue action does not show an error after a successful delete.
9. Align organization selection with the completed branch `005-create-event-rbac`: ordinary ADMIN/ORGANIZER users use their session organization; only SUPER_ADMIN sees cross-organization selection.
10. Add Playwright coverage for logo preview/upload, public/private link visibility, metadata editing, and successful deletion. Use the branch's finalized development sign-in flow rather than the stale password-based assumptions in older admin tests.
11. Run: `npm test --workspace=frontend -- e2e/admin-venues.spec.ts --project=chromium`.

**Expected verification:** Every venue-owned public field is manageable from admin, private/public status is clear, and create/edit/delete flows report their real outcomes.

### Task 8: Add public-page browser coverage

**Objective:** Verify customer behavior independently of admin authentication.

**Files:**
- Create: `frontend/e2e/public-venue.spec.ts`

**Steps:**

1. Add a test that intercepts the public venue API response with deterministic fixture data and verifies the venue name/logo and event cards.
2. Click a card and assert navigation to `/events/<event-id>`.
3. Add an empty-events response test.
4. Add a 404/private response test and verify the user-facing not-found state.
5. Add a missing-logo test and verify the accessible fallback.
6. Run on Chromium: `npm test --workspace=frontend -- e2e/public-venue.spec.ts --project=chromium`.
7. Run on Firefox after Chromium passes: `npm test --workspace=frontend -- e2e/public-venue.spec.ts --project=firefox`.

### Task 9: Update operator/customer documentation and run final gates

**Objective:** Document the new workflow and verify the complete feature without disturbing unrelated branch work.

**Files:**
- Modify: `docs/user-guides/organizers/admin-area.md`
- Modify: `docs/user-guides/customers/how-to-purchase-tickets.md`
- Review: `docs/architecture/data-models.md`

**Steps:**

1. Document venue logo upload/replace/remove and the public visibility toggle for organizers.
2. Document navigation from an event detail page to its venue page for customers.
3. Run backend venue/event contract tests.
4. Run backend lint.
5. Run frontend build.
6. Run the two new Playwright specs on Chromium and the public spec on Firefox.
7. Run `git diff --check`.
8. Review `git status --short` and the scoped diff. Preserve all pre-existing modified/untracked files on branch `005-create-event-rbac`; do not revert or include unrelated order/RBAC work.
9. Perform live QA with one public venue containing multiple event statuses and one private venue.
10. Do not commit or push unless explicitly requested.

---

## Final Verification Matrix

| Concern | Automated proof | Manual proof |
| --- | --- | --- |
| Public access | Supertest unauthenticated 200 | Incognito/direct route loads |
| Privacy | Supertest private venue 404 | Private venue URL shows not found |
| Event filtering | Supertest published/draft/cancelled fixtures | Only published cards visible |
| Card navigation | Playwright click + URL assertion | Card opens existing event page |
| Logo lifecycle | Supertest multipart + admin Playwright | Upload, replace, remove reflected publicly |
| Empty state | API contract + Playwright | Public venue with no events is stable |
| Responsive UI | Playwright/public test | Desktop + mobile, no horizontal overflow |
| Admin parity | Admin Playwright | Every public venue field can be managed |
| Regression | Existing event contract + frontend build | `/events` and event detail remain usable |

---

## Risks and Tradeoffs

1. **Active branch overlap:** `packages/db/prisma/schema.prisma`, `frontend/middleware.ts`, and `frontend/src/app/events/[eventId]/page.tsx` already have uncommitted work. Implementation must patch narrowly after re-reading those files and preserve the current RBAC/order changes.
2. **Organization scoping is in transition:** The current venue UI lists organizations even though feature 005 says ordinary ADMIN users should be fixed to one organization. Venue-logo endpoints must use the finalized tenant authorization, not merely trust an arbitrary `orgId` supplied in the URL.
3. **Local upload persistence:** The backend stores uploads under `backend/uploads`. This may be ephemeral in container/serverless production. Before production launch, confirm a persistent volume exists or replace the URL/storage implementation with object storage; that infrastructure is intentionally not added to this simple page plan.
4. **Existing upload security/cleanup:** Event logo upload currently filters mainly by extension and does not visibly clean replaced files. A shared upload helper is preferable, but hardening formats or cleanup for existing event logos should be handled carefully to avoid breaking accepted assets.
5. **Visibility policy:** This plan makes `isPublic: false` hide only the venue page. It does not automatically hide the venue's already-published events from `/events` or `/events/:id`. Changing that behavior requires an explicit product decision because it affects ticket sales and existing links.
6. **No pagination:** Returning all published venue events is simplest and matches the request. If production venues can have hundreds of events, add pagination later using the existing `/events` pagination pattern.
7. **Client-rendered metadata:** Existing public pages are client components. This plan follows that convention; server rendering and per-venue SEO metadata can be a later enhancement if discoverability becomes a requirement.
8. **Stale unit coverage:** `backend/tests/unit/eventService.test.js` still reflects older imports/signatures/schema. Do not treat it as proof for the new filters until repaired; use current contract tests for this feature and schedule that unit-suite repair separately unless implementation must touch the same formatter.

## Open Product Questions (defaults chosen above)

- **Past published events:** The default is to include all published events, ordered by date, matching current backend semantics. If only future events should appear, add `date >= now` and rename the section “Upcoming events.”
- **Missing logo:** The default is a branded/accessibility-friendly fallback, not blocking publication.
- **Private venue events:** The default is to preserve their current event visibility and hide only the venue page.
- **Public venue discovery:** No `/venues` index is included; discoverability comes from the venue link on an event detail page and direct links from admin.

These defaults keep the page simple and avoid silently changing existing ticket availability or event visibility.