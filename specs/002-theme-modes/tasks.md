# Tasks: Theme Modes (Dark, Light & Auto)

**Input**: Design documents from `/specs/002-theme-modes/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: E2E tests (Playwright) are included per Constitution Principle III (TDD - NON-NEGOTIABLE).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependency, configure Tailwind and CSS variables, create ThemeProvider

- [x] T001 Install `next-themes` dependency in frontend/package.json
- [x] T002 Add `darkMode: 'class'` to frontend/tailwind.config.js
- [x] T003 [P] Replace CSS custom properties with light/dark pairs and add `transition-colors duration-150` to body in frontend/src/app/globals.css
- [x] T004 [P] Create ThemeProvider client component wrapping next-themes with `attribute="class"`, `defaultTheme="system"`, `enableSystem` in frontend/src/components/ThemeProvider.tsx
- [x] T005 Update root layout to add `suppressHydrationWarning` on `<html>` and wrap children with ThemeProvider in frontend/src/app/layout.tsx

**Checkpoint**: Theme infrastructure is in place. Manually toggling localStorage `theme` to `"dark"` and reloading should apply `.dark` class to `<html>`. No visible toggle yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: N/A -- no blocking foundational work beyond Setup. All infrastructure is in Phase 1. User story work can begin immediately after Setup.

---

## Phase 3: User Story 1 - Toggle Between Light and Dark Mode (Priority: P1) MVP

**Goal**: Users can click a cycling icon button in the navbar to switch between light, dark, and auto themes. The entire UI updates immediately. Preference persists across sessions.

**Independent Test**: Click the theme toggle button. Verify mode cycles light -> dark -> auto. Verify all page backgrounds, text, cards, and borders change. Close and reopen browser; verify saved mode loads.

### E2E Tests for User Story 1

> **Write these tests FIRST, ensure they FAIL before implementation (Constitution III)**

- [x] T006 [US1] Write Playwright E2E tests for toggle cycling (light->dark->auto->light), theme class application on `<html>`, localStorage persistence across reload, localStorage-cleared reset to system/auto default (edge case), and theme switch performance (assert class change within 2 seconds of click per SC-001) in frontend/e2e/theme-modes.spec.ts

### Implementation for User Story 1

- [x] T007 [US1] Create ThemeToggle cycling icon button component with sun/moon/monitor SVG icons, mounted guard pattern, and `aria-label` in frontend/src/components/ThemeToggle.tsx
- [x] T008 [US1] Add ThemeToggle to Navbar and add `dark:` variant classes to all Navbar elements (bg, text, border, hover states) in frontend/src/components/Navbar.tsx
- [x] T009 [P] [US1] Add `dark:` variant classes to EventCard component (card bg, text, border, shadow, badge colors) in frontend/src/components/EventCard.tsx
- [x] T010 [P] [US1] Add `dark:` variant classes to TicketDisplay component (card bg, text, QR container, status badges) in frontend/src/components/TicketDisplay.tsx — also visually verify QRScanner.tsx overlay is not adversely affected in dark mode (NO CHANGE expected, but confirm no hardcoded colors clash)
- [x] T011 [P] [US1] Add `dark:` variant classes to home page (hero section, background, headings, descriptive text, CTA buttons) in frontend/src/app/page.tsx
- [x] T012 [P] [US1] Add `dark:` variant classes to events listing page (page bg, search inputs, grid cards, loading states) in frontend/src/app/events/page.tsx
- [x] T013 [P] [US1] Add `dark:` variant classes to event detail page (bg, event info cards, ticket selection, price display) in frontend/src/app/events/[eventId]/page.tsx
- [x] T014 [P] [US1] Add `dark:` variant classes to checkout page (bg, order summary card, form inputs, payment section, buttons) in frontend/src/app/checkout/[eventId]/page.tsx
- [x] T015 [P] [US1] Add `dark:` variant classes to confirmation page (bg, success card, ticket details, email display) in frontend/src/app/confirmation/page.tsx
- [x] T016 [P] [US1] Add `dark:` variant classes to my-tickets page (bg, ticket list cards, empty state, status indicators) in frontend/src/app/my-tickets/page.tsx
- [x] T017 [P] [US1] Add `dark:` variant classes to ticket detail page (bg, ticket card, QR code container, event info) in frontend/src/app/tickets/[ticketId]/page.tsx
- [x] T018 [P] [US1] Add `dark:` variant classes to login page (bg, form card, inputs, labels, buttons, links) in frontend/src/app/auth/login/page.tsx
- [x] T019 [P] [US1] Add `dark:` variant classes to register page (bg, form card, inputs, labels, buttons, links) in frontend/src/app/auth/register/page.tsx
- [x] T020 [P] [US1] Add `dark:` variant classes to admin dashboard page (bg, stats cards, tables, status badges) in frontend/src/app/admin/dashboard/page.tsx
- [x] T021 [P] [US1] Add `dark:` variant classes to admin create-event page (bg, form card, inputs, labels, date pickers, buttons) in frontend/src/app/admin/create-event/page.tsx

**Checkpoint**: All three theme modes work via the toggle button. Every page and component renders correctly in both light and dark. Theme persists across sessions. E2E tests pass.

---

## Phase 4: User Story 2 - Auto Mode Follows Device Settings (Priority: P2)

**Goal**: When "Auto" is selected, the site follows the OS/browser color scheme preference and responds to real-time changes (e.g., macOS scheduled light-to-dark transitions).

**Independent Test**: Set OS to dark mode, load site with "Auto" selected -- verify dark theme. Switch OS to light while site is open -- verify live update without reload.

### E2E Tests for User Story 2

- [x] T022 [US2] Write Playwright E2E tests for system preference detection using `page.emulateMedia({ colorScheme })`, real-time response to colorScheme changes, and default "system" for first-time visitors in frontend/e2e/theme-modes.spec.ts

### Implementation for User Story 2

- [x] T023 [US2] Verify ThemeProvider has `enableSystem` and `defaultTheme="system"` props configured correctly in frontend/src/components/ThemeProvider.tsx (may already be done in T004; validate and fix if needed)

**Checkpoint**: Auto mode correctly follows device preference and responds to real-time OS changes. E2E tests for system preference pass. No regressions in US1 tests.

---

## Phase 5: User Story 3 - Theme Toggle is Accessible and Discoverable (Priority: P3)

**Goal**: The theme toggle is keyboard-navigable, announces its state to screen readers, and displays a tooltip indicating the current mode. Works for authenticated and unauthenticated users.

**Independent Test**: Tab to the theme toggle using keyboard only -- verify it receives focus and is operable. Use a screen reader -- verify it announces purpose and current state. Hover -- verify tooltip shows mode name.

### E2E Tests for User Story 3

- [x] T024 [US3] Write Playwright E2E tests for keyboard navigation (Tab to toggle, Enter/Space to activate), aria-label content verification, and tooltip visibility on hover in frontend/e2e/theme-modes.spec.ts

### Implementation for User Story 3

- [x] T025 [US3] Enhance ThemeToggle with tooltip (title attribute or custom tooltip), focus-visible ring styling, and verify `aria-label` dynamically reflects current state (e.g., "Theme: dark, click to switch to auto") in frontend/src/components/ThemeToggle.tsx
- [x] T026 [US3] Verify theme toggle is visible and functional for both authenticated and unauthenticated users by testing Navbar rendering in both states in frontend/src/components/Navbar.tsx

**Checkpoint**: Theme toggle is fully accessible. Keyboard navigation works. Screen reader announces state. Tooltip visible. E2E accessibility tests pass.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: FOUC prevention validation, contrast checks, documentation, cleanup

- [x] T027 [P] Write Playwright E2E test to verify no FOUC on page load (navigate with saved theme, assert correct class on `<html>` immediately) AND verify no CSS transition fires on initial load (FR-013: transitions only on user-triggered changes — assert `getComputedStyle(document.body).transitionDuration` is applied but no visible color shift occurs during navigation) in frontend/e2e/theme-modes.spec.ts
- [x] T028 [P] Verify WCAG AA color contrast ratios (4.5:1 normal text, 3:1 large text) for all pages in both light and dark modes using `@axe-core/playwright` integration — run axe accessibility scans on each page in both themes, assert zero color-contrast violations. Document and fix any failures before proceeding
- [x] T029 [P] Update developer documentation in docs/ with theme system architecture and usage guide per quickstart.md
- [x] T030 Run full Playwright E2E suite to verify no regressions across all theme tests in frontend/e2e/theme-modes.spec.ts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies -- start immediately
- **Foundational (Phase 2)**: N/A for this feature
- **User Story 1 (Phase 3)**: Depends on Setup (Phase 1) completion
- **User Story 2 (Phase 4)**: Depends on Setup (Phase 1) -- can run in parallel with US1 but recommended after US1 since it validates the same infrastructure
- **User Story 3 (Phase 5)**: Depends on US1 (ThemeToggle must exist before enhancing accessibility)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Requires Setup only. Core feature -- must complete first.
- **User Story 2 (P2)**: Requires Setup only. `enableSystem` and `defaultTheme="system"` are configured in Setup, so this story is mostly validation + tests. Can start after Setup but ideally after US1 toggle exists.
- **User Story 3 (P3)**: Requires US1 (ThemeToggle.tsx must exist). Enhances the toggle with a11y attributes, tooltip, and keyboard handling.

### Within Each User Story

- E2E tests MUST be written and FAIL before implementation (Constitution III - TDD)
- Infrastructure components before page-level changes
- Navbar before individual pages (toggle must exist)
- All page dark-mode tasks are parallelizable (different files)

### Parallel Opportunities

Within **Phase 1 (Setup)**:

```
T001 (install) -> T002 (tailwind config)
                  T003 (globals.css)      [P] -- parallel with T004
                  T004 (ThemeProvider)    [P] -- parallel with T003
                -> T005 (layout.tsx)       -- depends on T004
```

Within **Phase 3 (US1)** after T006 (tests) and T007-T008 (toggle + navbar):

```
All page tasks T009-T021 can run in parallel (different files)
```

Within **Phase 6 (Polish)**:

```
T027, T028, T029 can all run in parallel
T030 (full suite) runs last
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T005)
2. Write E2E tests (T006) -- verify they FAIL
3. Build ThemeToggle + Navbar (T007-T008)
4. Dark-mode all pages and components (T009-T021) -- parallelizable
5. **STOP and VALIDATE**: Run E2E tests -- all should PASS
6. MVP complete: users can toggle themes on all pages

### Incremental Delivery

1. Setup -> US1 -> **Theme toggle works on all pages (MVP!)**
2. Add US2 -> **Auto mode follows device preference**
3. Add US3 -> **Fully accessible toggle with tooltip**
4. Polish -> **FOUC verified, contrast checked, docs updated**

---

## Notes

- Total tasks: **30**
- Tasks per user story: US1=16, US2=2, US3=3, Setup=5, Polish=4
- Parallel opportunities: 13 tasks in US1 can run in parallel (all page dark-mode tasks)
- All pages use the same color palette mapping from research.md R5
- No backend changes required for any task
- Commit after each task or logical group
- The E2E test file (frontend/e2e/theme-modes.spec.ts) is built incrementally across phases -- each story adds its test cases to the same file
