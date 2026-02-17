# Tasks: Admin Area

**Input**: Design documents from `/specs/004-admin-area/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md

**Tests**: Playwright E2E test tasks included per Constitution Principle III (TDD — NON-NEGOTIABLE). Tests MUST be written and FAIL before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Core components that all user stories depend on

- [x] T001 Update `AdminRoute` to allow ORGANIZER role in `frontend/src/components/AdminRoute.tsx`
- [x] T002 Add `/admin` to protected paths in edge middleware `frontend/middleware.ts`
- [x] T003 Create `AdminSidebar` client component in `frontend/src/components/AdminSidebar.tsx` — include links per FR-005 (Dashboard, Organizations, Venues, Events, Analytics, Scan), FR-006 (Users — ADMIN only), FR-011 (Create Event quick action button), with active state via `usePathname()`
- [x] T004 Create admin layout with sidebar and AdminRoute guard in `frontend/src/app/admin/layout.tsx`
- [x] T005 Create admin root redirect page in `frontend/src/app/admin/page.tsx`

---

## Phase 2: User Story 1 — Admin accesses the admin area (Priority: P1) 🎯 MVP

**Goal**: ADMIN user navigates to `/admin`, sees sidebar with all navigation links, dashboard loads by default, all admin pages accessible within the admin layout.

**Independent Test**: Log in as ADMIN, navigate to `/admin`, verify redirect to `/admin/dashboard`, sidebar renders with all links (Dashboard, Organizations, Venues, Events, Analytics, Scan, Users, Create Event), click each link and verify page loads within admin layout.

### Tests for User Story 1 (TDD — write first, must FAIL) ⚠️

- [x] T100 [P] [US1] E2E test: ADMIN navigates to `/admin`, redirected to `/admin/dashboard`, sidebar visible with all links — in `frontend/e2e/admin-access.spec.ts`
- [x] T101 [P] [US1] E2E test: ADMIN clicks each sidebar link, page loads within admin layout (sidebar persists) — in `frontend/e2e/admin-access.spec.ts`
- [x] T102 [P] [US1] E2E test: Sidebar highlights currently active section — in `frontend/e2e/admin-access.spec.ts`

### Implementation for User Story 1

- [x] T006 [US1] Update existing `frontend/src/app/admin/dashboard/page.tsx` — remove redundant AdminRoute wrapper, remove duplicate header (layout provides it)
- [x] T007 [US1] Update existing `frontend/src/app/admin/create-event/page.tsx` — remove redundant AdminRoute wrapper
- [x] T008 [P] [US1] Move organizations page from `frontend/src/app/dashboard/organizations/page.tsx` to `frontend/src/app/admin/organizations/page.tsx` — update imports to `@/` aliases, remove AdminRoute wrapper
- [x] T009 [P] [US1] Move venues page from `frontend/src/app/dashboard/venues/page.tsx` to `frontend/src/app/admin/venues/page.tsx` — update imports to `@/` aliases, remove AdminRoute wrapper
- [x] T010 [P] [US1] Move events list page from `frontend/src/app/dashboard/events/page.tsx` to `frontend/src/app/admin/events/page.tsx` — update imports to `@/` aliases, remove AdminRoute wrapper
- [x] T011 [P] [US1] Move new event page from `frontend/src/app/dashboard/events/new/page.tsx` to `frontend/src/app/admin/events/new/page.tsx` — update imports to `@/` aliases, remove AdminRoute wrapper
- [x] T012 [P] [US1] Move event analytics page from `frontend/src/app/dashboard/events/[eventId]/analytics/page.tsx` to `frontend/src/app/admin/events/[eventId]/analytics/page.tsx` — update imports to `@/` aliases, remove AdminRoute wrapper
- [x] T013 [P] [US1] Move analytics page from `frontend/src/app/dashboard/analytics/page.tsx` to `frontend/src/app/admin/analytics/page.tsx` — update imports to `@/` aliases, remove AdminRoute wrapper
- [x] T014 [P] [US1] Move users page from `frontend/src/app/dashboard/users/page.tsx` to `frontend/src/app/admin/users/page.tsx` — update imports to `@/` aliases, remove AdminRoute wrapper
- [x] T015 [P] [US1] Move scan page from `frontend/src/app/scan/page.tsx` to `frontend/src/app/admin/scan/page.tsx` — update imports to `@/` aliases, remove AdminRoute wrapper
- [x] T016 [US1] Update all internal links within moved admin pages to use `/admin/*` paths instead of `/dashboard/*` paths across `frontend/src/app/admin/**/*.tsx`
- [x] T017 [US1] Remove old route directories: `frontend/src/app/dashboard/` and `frontend/src/app/scan/`

**Checkpoint**: ADMIN users can access all admin pages at `/admin/*` with sidebar navigation. Old `/dashboard` and `/scan` routes return 404.

---

## Phase 3: User Story 2 — Organizer accesses the admin area (Priority: P1)

**Goal**: ORGANIZER user navigates to `/admin`, sees sidebar navigation without the Users link. Direct navigation to `/admin/users` shows access denied.

**Independent Test**: Log in as ORGANIZER, navigate to `/admin`, verify sidebar shows Dashboard, Organizations, Venues, Events, Analytics, Scan — but NOT Users. Navigate directly to `/admin/users`, verify access denied message.

### Tests for User Story 2 (TDD — write first, must FAIL) ⚠️

- [x] T103 [P] [US2] E2E test: ORGANIZER navigates to `/admin`, sidebar shows Dashboard, Organizations, Venues, Events, Analytics, Scan — but NOT Users — in `frontend/e2e/admin-access.spec.ts`
- [x] T104 [P] [US2] E2E test: ORGANIZER navigates directly to `/admin/users`, sees access denied message — in `frontend/e2e/admin-access.spec.ts`

### Implementation for User Story 2

- [x] T018 [US2] Add role-aware link visibility to `AdminSidebar` in `frontend/src/components/AdminSidebar.tsx` — hide Users link when role is ORGANIZER
- [x] T019 [US2] Add ADMIN-only guard to users page in `frontend/src/app/admin/users/page.tsx` — show access denied for ORGANIZER role

**Checkpoint**: ORGANIZER users see all sidebar links except Users. Direct access to `/admin/users` shows access denied.

---

## Phase 4: User Story 3 — Unauthorized user is denied access (Priority: P1)

**Goal**: Unauthenticated users are redirected to sign-in. CUSTOMER users see a 403 access denied page with a link back to the public site.

**Independent Test**: Navigate to `/admin` while logged out — verify redirect to `/auth/signin` with callback URL. Log in as CUSTOMER, navigate to `/admin` — verify 403 page with action button to return to events.

### Tests for User Story 3 (TDD — write first, must FAIL) ⚠️

- [x] T105 [P] [US3] E2E test: Unauthenticated user navigates to `/admin`, redirected to `/auth/signin` with callback URL — in `frontend/e2e/admin-access.spec.ts`
- [x] T106 [P] [US3] E2E test: CUSTOMER navigates to `/admin`, sees 403 access denied with "Admin or Organizer role required" message and back-to-events button — in `frontend/e2e/admin-access.spec.ts`

### Implementation for User Story 3

- [x] T020 [US3] Enhance access denied UI in `AdminRoute` (`frontend/src/components/AdminRoute.tsx`) — add descriptive message ("Admin or Organizer role required") and action button linking to `/events`
- [x] T021 [US3] Verify edge middleware redirects unauthenticated users to `/auth/signin?callbackUrl=/admin` — update `frontend/middleware.ts` callback URL handling if needed

**Checkpoint**: Unauthenticated → sign-in redirect. CUSTOMER → 403 with descriptive message and back-to-events button.

---

## Phase 5: User Story 4 — Admin links removed from public navigation (Priority: P2)

**Goal**: Navbar shows a single "Admin" link for ADMIN/ORGANIZER users. CUSTOMER and unauthenticated users see no admin links.

**Independent Test**: Load public site as ADMIN — verify single "Admin" link appears, no Scan/Dashboard/Orgs/Venues/Events/Analytics links. Load as CUSTOMER — verify no admin links. Load as unauthenticated — verify no admin links.

### Tests for User Story 4 (TDD — write first, must FAIL) ⚠️

- [x] T107 [P] [US4] E2E test: ADMIN/ORGANIZER Navbar shows single "Admin" link, no individual admin page links — in `frontend/e2e/admin-navbar.spec.ts`
- [x] T108 [P] [US4] E2E test: CUSTOMER Navbar shows Events, My Tickets, Orders — no "Admin" link — in `frontend/e2e/admin-navbar.spec.ts`
- [x] T109 [P] [US4] E2E test: Unauthenticated Navbar shows Events and Sign In — no admin links — in `frontend/e2e/admin-navbar.spec.ts`

### Implementation for User Story 4

- [x] T022 [US4] Simplify admin navigation in `frontend/src/components/Navbar.tsx` — replace 6 individual admin links with single "Admin" link to `/admin`, extend `isAdmin` check to include ORGANIZER role
- [x] T023 [US4] Verify CUSTOMER and unauthenticated Navbar shows only Events, My Tickets/Orders, Sign In — no admin links visible in `frontend/src/components/Navbar.tsx`

**Checkpoint**: Navbar displays exactly one "Admin" link for ADMIN/ORGANIZER users. No admin links for other users.

---

## Phase 6: User Story 5 — Mobile-responsive admin sidebar (Priority: P3)

**Goal**: On mobile screens, sidebar collapses and can be toggled open/closed. Overlay dismisses sidebar when tapped.

**Independent Test**: Resize browser to mobile width. Verify sidebar is hidden and toggle button appears. Tap toggle — sidebar slides in with overlay. Tap overlay — sidebar closes.

### Tests for User Story 5 (TDD — write first, must FAIL) ⚠️

- [x] T110 [P] [US5] E2E test: At viewport < 768px, sidebar hidden, toggle button visible — in `frontend/e2e/admin-mobile.spec.ts`
- [x] T111 [P] [US5] E2E test: Tap toggle → sidebar slides in with overlay; tap overlay → sidebar closes — in `frontend/e2e/admin-mobile.spec.ts`

### Implementation for User Story 5

- [x] T024 [US5] Add mobile toggle state and backdrop overlay to `AdminSidebar` in `frontend/src/components/AdminSidebar.tsx` — hidden by default on mobile (below Tailwind `md:` 768px breakpoint), toggle button visible, slide-in animation, click-outside dismissal
- [x] T025 [US5] Update admin layout in `frontend/src/app/admin/layout.tsx` — pass mobile toggle state to sidebar, ensure responsive flex layout

**Checkpoint**: Admin sidebar is responsive — hidden on mobile with toggle, visible on desktop.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup and final validation

- [x] T026 [P] Verify all admin page links are consistent (no leftover `/dashboard/*` references) across `frontend/src/app/admin/**`
- [x] T027 [P] Verify sidebar active state highlighting works for all routes using `usePathname()` in `frontend/src/components/AdminSidebar.tsx`
- [x] T028 Run quickstart.md validation — complete all manual test scenarios from `specs/004-admin-area/quickstart.md`
- [x] T029 [P] Create admin area user guide in `docs/user-guides/organizers/admin-area.md` — document admin area navigation, sidebar, role-based access, mobile usage
- [x] T030 [P] Create ADR for admin layout pattern in `docs/architecture/decisions/adr-admin-layout.md` — document nested layout + client-side guard decision per research.md R1/R3

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **US1 (Phase 2)**: Depends on Setup (T001–T005). Page moves (T008–T015) are parallelizable.
- **US2 (Phase 3)**: Depends on US1 (sidebar must exist, users page must be moved)
- **US3 (Phase 4)**: Depends on Setup (T001–T002). Can run in parallel with US1 page moves.
- **US4 (Phase 5)**: Depends on Setup (T001). Can run in parallel with US1.
- **US5 (Phase 6)**: Depends on US1 (sidebar component must be complete)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Requires Setup → core deliverable, all pages relocated
- **US2 (P1)**: Requires US1 → sidebar exists, users page is moved
- **US3 (P1)**: Requires Setup only → can partially overlap with US1
- **US4 (P2)**: Requires Setup only → can partially overlap with US1
- **US5 (P3)**: Requires US1 → sidebar component built and working

### Within Each User Story

- [P] tasks within a phase can run in parallel
- Page moves (T008–T015) are all independent — different files, no shared state
- Link updates (T016) must happen after all pages are moved
- Route removal (T017) must be the last US1 task

### Parallel Opportunities

**Phase 1 (Setup)**: T001 and T002 are parallelizable (different files). T003–T005 are sequential (layout depends on sidebar).

**Phase 2 (US1)**: T006 and T007 are parallelizable. T008–T015 (all page moves) are parallelizable — each touches a different file.

**Cross-phase**: US3 (T020–T021) and US4 (T022–T023) can run in parallel with US1 page moves, since they modify different files.

---

## Parallel Example: User Story 1

```bash
# Parallel batch 1 — move all pages (T008–T015):
Task: "Move organizations page to frontend/src/app/admin/organizations/page.tsx"
Task: "Move venues page to frontend/src/app/admin/venues/page.tsx"
Task: "Move events list page to frontend/src/app/admin/events/page.tsx"
Task: "Move new event page to frontend/src/app/admin/events/new/page.tsx"
Task: "Move event analytics page to frontend/src/app/admin/events/[eventId]/analytics/page.tsx"
Task: "Move analytics page to frontend/src/app/admin/analytics/page.tsx"
Task: "Move users page to frontend/src/app/admin/users/page.tsx"
Task: "Move scan page to frontend/src/app/admin/scan/page.tsx"

# Sequential — after all moves complete:
Task: "Update all internal links to /admin/* paths" (T016)
Task: "Remove old /dashboard and /scan directories" (T017)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T005)
2. Complete Phase 2: User Story 1 — move all pages, update links, remove old routes
3. **STOP and VALIDATE**: ADMIN can access all admin pages via `/admin` with sidebar
4. Deploy/demo if ready — this is the core deliverable

### Incremental Delivery

1. Setup (Phase 1) → Foundation ready
2. US1 (Phase 2) → All admin pages under `/admin` (**MVP!**)
3. US2 (Phase 3) → ORGANIZER role-specific sidebar
4. US3 (Phase 4) → Polished access denied experience
5. US4 (Phase 5) → Clean public Navbar
6. US5 (Phase 6) → Mobile-responsive sidebar
7. Polish (Phase 7) → Final validation

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup together (5 tasks)
2. Once Setup is done:
   - Developer A: US1 page moves (T008–T017)
   - Developer B: US3 access denied + US4 Navbar (T020–T023) — different files
3. After US1 complete:
   - Developer A: US2 sidebar role logic (T018–T019)
   - Developer B: US5 mobile responsive (T024–T025)
4. Both: Polish (Phase 7)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- E2E tests (T100–T111) MUST be written and fail before corresponding implementation tasks begin (Constitution §III TDD).
- Documentation tasks (T029–T030) fulfill Constitution §VIII Living Documentation requirement.
