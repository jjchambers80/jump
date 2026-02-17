# Implementation Plan: Admin Area

**Branch**: `004-admin-area` | **Date**: 2026-02-15 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-admin-area/spec.md`

## Summary

Consolidate all administrative pages (Dashboard, Organizations, Venues, Events, Analytics, Users, Scan, Create Event) into a dedicated admin area at `/admin` with a shared layout featuring a persistent sidebar navigation. Access is restricted to ADMIN and ORGANIZER roles via the existing `AdminRoute` client-side guard (updated to allow ORGANIZER) and edge middleware. The public Navbar is simplified to show a single "Admin" link instead of individual admin page links. No new backend endpoints, database changes, or API contracts are required — this is a frontend-only restructuring of existing pages.

## Technical Context

**Language/Version**: TypeScript 5.x, React 18, Next.js 14 (App Router)
**Primary Dependencies**: next-auth v5 (Auth.js), next/navigation, tailwindcss
**Storage**: N/A (no schema changes — frontend restructuring only)
**Testing**: Playwright 1.40+ (E2E), Jest (component tests if added)
**Target Platform**: Web (desktop-primary, mobile-responsive)
**Project Type**: Web application (monorepo: frontend + backend + packages/db)
**Performance Goals**: Admin pages render within 3 seconds; sidebar navigation is instant (client-side)
**Constraints**: Edge middleware must remain edge-safe (no Prisma); role check client-side only
**Scale/Scope**: ~10 pages relocated, 1 new layout component, 1 new page (redirect), 3 modified components

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                     | Status   | Notes                                                                                                                                                                                                                                                |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Single Source of Truth     | **PASS** | No ticket/data changes. UI restructuring only.                                                                                                                                                                                                       |
| II. API-First Architecture    | **PASS** | No new API endpoints. Frontend-only changes. Client does not contain business logic — only presentation and auth orchestration.                                                                                                                      |
| III. Test-Driven Development  | **PASS** | Acceptance scenarios in spec translate to Playwright E2E tests. Tests will verify role-based access and navigation.                                                                                                                                  |
| IV. Transactional Integrity   | **N/A**  | No payment, inventory, or transaction changes.                                                                                                                                                                                                       |
| V. Role-Based Access Control  | **PASS** | Enforces RBAC per constitution: ADMIN/ORGANIZER access admin area, CUSTOMER denied. Backend API continues to enforce role checks independently. Edge middleware protects `/admin` for authentication. AdminRoute enforces authorization client-side. |
| VI. Real-Time Synchronization | **N/A**  | No changes to real-time behavior.                                                                                                                                                                                                                    |
| VII. MVP Simplicity           | **PASS** | Consolidation reduces complexity — fewer scattered routes, cleaner navigation.                                                                                                                                                                       |
| VIII. Living Documentation    | **PASS** | This plan and spec serve as documentation. No new API endpoints to document.                                                                                                                                                                         |
| IX. Data Architecture         | **N/A**  | No schema or entity changes.                                                                                                                                                                                                                         |

**Gate result**: PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/004-admin-area/
├── plan.md              # This file
├── research.md          # Phase 0: technology decisions
├── data-model.md        # Phase 1: no new entities (documents existing)
├── quickstart.md        # Phase 1: dev setup & testing guide
├── contracts/           # Phase 1: N/A (no new API endpoints)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
frontend/
├── middleware.ts                          # MODIFY: add /admin to protected paths
├── src/
│   ├── components/
│   │   ├── AdminRoute.tsx                 # MODIFY: allow ORGANIZER role
│   │   └── Navbar.tsx                     # MODIFY: replace admin links with single "Admin" link
│   └── app/
│       └── admin/
│           ├── layout.tsx                 # CREATE: admin layout with sidebar + AdminRoute guard
│           ├── page.tsx                   # CREATE: redirect /admin → /admin/dashboard
│           ├── dashboard/page.tsx         # EXISTS: remove redundant AdminRoute wrapper & header
│           ├── create-event/page.tsx      # EXISTS: remove redundant AdminRoute wrapper
│           ├── organizations/page.tsx     # MOVE from /dashboard/organizations
│           ├── venues/page.tsx            # MOVE from /dashboard/venues
│           ├── events/                    # MOVE from /dashboard/events (incl. [eventId], new/)
│           ├── analytics/page.tsx         # MOVE from /dashboard/analytics
│           ├── users/page.tsx             # MOVE from /dashboard/users
│           └── scan/page.tsx              # MOVE from /scan

# REMOVE after migration:
frontend/src/app/dashboard/               # All admin pages relocated to /admin
frontend/src/app/scan/                    # Relocated to /admin/scan
```

**Structure Decision**: Web application layout. All admin pages are consolidated under
`frontend/src/app/admin/` using Next.js App Router nested layout. The shared `admin/layout.tsx`
wraps all sub-routes with the `AdminRoute` guard and sidebar navigation, eliminating the need
for individual pages to wrap themselves.

## Complexity Tracking

> No violations — table not needed.

## Constitution Re-Check (Post-Design)

_GATE: Re-evaluated after Phase 1 design completion._

| Principle                     | Status   | Post-Design Notes                                                                                                                                                                       |
| ----------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Single Source of Truth     | **PASS** | Admin pages consolidated to single `/admin` route tree. No duplication.                                                                                                                 |
| II. API-First Architecture    | **PASS** | No new endpoints. Frontend consumes existing APIs unchanged.                                                                                                                            |
| III. Test-Driven Development  | **PASS** | Acceptance scenarios → Playwright E2E tests: `admin-access.spec.ts` (US1–US3), `admin-navbar.spec.ts` (US4), `admin-mobile.spec.ts` (US5). Test tasks T100–T111 precede implementation. |
| IV. Transactional Integrity   | **N/A**  | No transactions affected.                                                                                                                                                               |
| V. Role-Based Access Control  | **PASS** | Three-layer defense: edge middleware (auth), AdminRoute (authz), backend API (enforcement). Research R3 confirms this is the Auth.js recommended pattern.                               |
| VI. Real-Time Synchronization | **N/A**  | No changes.                                                                                                                                                                             |
| VII. MVP Simplicity           | **PASS** | Reduces route count from 3 top-level admin paths to 1. Sidebar replaces 6 Navbar links.                                                                                                 |
| VIII. Living Documentation    | **PASS** | Full artifact set: spec, plan, research, data-model, quickstart, contracts README.                                                                                                      |
| IX. Data Architecture         | **N/A**  | No schema changes.                                                                                                                                                                      |

**Gate result**: PASS — no violations post-design.

## Generated Artifacts

| Artifact            | Path                                       | Status                       |
| ------------------- | ------------------------------------------ | ---------------------------- |
| Feature Spec        | `specs/004-admin-area/spec.md`             | Complete                     |
| Implementation Plan | `specs/004-admin-area/plan.md`             | Complete                     |
| Research            | `specs/004-admin-area/research.md`         | Complete                     |
| Data Model          | `specs/004-admin-area/data-model.md`       | Complete                     |
| Contracts           | `specs/004-admin-area/contracts/README.md` | Complete (N/A — no new APIs) |
| Quickstart          | `specs/004-admin-area/quickstart.md`       | Complete                     |
| Tasks               | `specs/004-admin-area/tasks.md`            | Complete                     |
