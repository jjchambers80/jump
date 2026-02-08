# Implementation Plan: Theme Modes (Dark, Light & Auto)

**Branch**: `002-theme-modes` | **Date**: 2026-02-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-theme-modes/spec.md`

## Summary

Add dark, light, and auto (device-preference) theme modes to the Jump Ticketing Platform frontend. Uses `next-themes` library for SSR-safe theme management with Tailwind CSS `darkMode: 'class'` strategy. A cycling icon button (sun, moon, auto) in the Navbar allows switching. Theme persists in localStorage, defaults to "auto" for first-time visitors, and prevents FOUC via `next-themes` inline script injection. All 10 pages and 5 components receive `dark:` Tailwind variant classes using a dark gray/slate palette that complements the existing blue brand accents. Smooth ~150ms CSS transitions on user-triggered theme changes. Frontend-only change -- no backend modifications required.

## Technical Context

**Language/Version**: TypeScript 5.7.2, React 18.3.1
**Primary Dependencies**: Next.js 14.2.21, Tailwind CSS 3.4.1, `next-themes` (new -- ^0.4.x)
**Storage**: localStorage (client-side theme preference via `next-themes`)
**Testing**: Playwright (E2E, already configured), no unit test framework installed
**Target Platform**: Web (all modern browsers: Chrome, Safari, Firefox, Edge)
**Project Type**: Web application (frontend + backend monorepo)
**Performance Goals**: Theme switch < 100ms perceived, no FOUC on load
**Constraints**: WCAG AA contrast ratios (4.5:1 normal text, 3:1 large text), no layout shift on theme change
**Scale/Scope**: 10 page files, 5 shared components, 1 root layout -- all need dark mode treatment

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #    | Principle               | Applies? | Status | Notes                                                                                                           |
| ---- | ----------------------- | -------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| I    | Single Source of Truth  | No       | PASS   | No ticket/data model changes                                                                                    |
| II   | API-First               | No       | PASS   | Frontend-only feature, no API changes                                                                           |
| III  | TDD (NON-NEGOTIABLE)    | Yes      | PASS   | Playwright E2E tests written first for theme toggle, persistence, auto mode, FOUC prevention, and accessibility |
| IV   | Transactional Integrity | No       | PASS   | No payment/inventory changes                                                                                    |
| V    | RBAC                    | No       | PASS   | Theme available to all users regardless of role                                                                 |
| VI   | Real-Time Sync          | No       | PASS   | Theme is client-local, no sync needed                                                                           |
| VII  | MVP Simplicity          | Yes      | PASS   | Three preset modes only (no custom colors). Single new dependency (next-themes). No backend changes             |
| VIII | Living Documentation    | Yes      | PASS   | quickstart.md documents theme system usage for developers                                                       |

**Gate result**: ALL PASS -- proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/002-theme-modes/
  plan.md              # This file
  research.md          # Phase 0 output
  data-model.md        # Phase 1 output
  quickstart.md        # Phase 1 output
  contracts/           # N/A -- frontend-only feature, no API contracts
  tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
frontend/
  src/
    app/
      layout.tsx                    # MODIFY: Add suppressHydrationWarning, wrap with ThemeProvider
      globals.css                   # MODIFY: Add dark mode CSS variables, fix variable naming
      page.tsx                      # MODIFY: Add dark: variant classes
      auth/
        login/page.tsx              # MODIFY: Add dark: variant classes
        register/page.tsx           # MODIFY: Add dark: variant classes
      events/
        page.tsx                    # MODIFY: Add dark: variant classes
        [eventId]/page.tsx          # MODIFY: Add dark: variant classes
      checkout/
        [eventId]/page.tsx          # MODIFY: Add dark: variant classes
      confirmation/
        page.tsx                    # MODIFY: Add dark: variant classes
      my-tickets/
        page.tsx                    # MODIFY: Add dark: variant classes
      tickets/
        [ticketId]/page.tsx         # MODIFY: Add dark: variant classes
      admin/
        create-event/page.tsx       # MODIFY: Add dark: variant classes
        dashboard/page.tsx          # MODIFY: Add dark: variant classes
    components/
      ThemeProvider.tsx              # CREATE: Client component wrapping next-themes
      ThemeToggle.tsx               # CREATE: Cycling icon button (sun/moon/auto) with a11y
      Navbar.tsx                    # MODIFY: Add ThemeToggle, add dark: variant classes
      EventCard.tsx                 # MODIFY: Add dark: variant classes
      TicketDisplay.tsx             # MODIFY: Add dark: variant classes
      AuthProvider.tsx              # NO CHANGE
      QRScanner.tsx                 # NO CHANGE
  tailwind.config.js                # MODIFY: Add darkMode: 'class'
  e2e/
    theme-modes.spec.ts             # CREATE: Playwright E2E tests
  package.json                      # MODIFY: Add next-themes dependency
```

**Structure Decision**: Web application structure (frontend/backend monorepo). This feature modifies only the `frontend/` directory. No backend changes. New components (ThemeProvider.tsx, ThemeToggle.tsx) follow existing patterns in frontend/src/components/. E2E tests go in frontend/e2e/ alongside existing Playwright config.

## Complexity Tracking

> No constitution violations. No complexity justifications needed.
