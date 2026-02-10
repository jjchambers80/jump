# Implementation Plan: Schema Redesign — MVP Data Architecture

**Branch**: `003-schema-redesign` | **Date**: 2026-02-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-schema-redesign/spec.md`

## Summary

Replace the current flat database schema (Admin/Customer split identity, single ticket price, no organizational hierarchy, no order grouping) with a normalized MVP schema following the hierarchy Organization → Venue → Event → PriceTier → Ticket, with a unified User + Contact identity model powered by Auth.js v5. The migration wipes all pre-launch data and re-seeds from scratch. The Prisma schema moves to a shared `packages/db` monorepo package consumed by both frontend and backend.

## Technical Context

**Language/Version**: Node.js 20 LTS (backend), TypeScript 5.x (frontend)
**Primary Dependencies**: Express.js 4.x, Next.js 14, React 18, Auth.js v5 (NextAuth), Prisma 5.x, Stripe SDK, Resend SDK, `qrcode`, `jsonwebtoken`
**Storage**: PostgreSQL 15+, Redis 7.x
**Testing**: Jest 29.x + Supertest (backend), Playwright 1.40+ (frontend E2E)
**Target Platform**: Web (server + SPA), future Android
**Project Type**: Web (monorepo — backend + frontend + shared packages/db)
**Performance Goals**: <500ms p95 API response, <2s QR scan-to-verdict, 100 concurrent purchases
**Constraints**: No seat selection, no offline mode, no password auth, single role per user, app-level tenancy
**Scale/Scope**: 100K capacity events, 10K tickets/event, 3 user roles, 12 database entities

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #    | Principle                 | Compliance | Notes                                                                                                                                                                      |
| ---- | ------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I    | Single Source of Truth    | ✅ PASS    | Ticket uniqueness via cuid, QR via signed JWT, atomic state transitions preserved                                                                                          |
| II   | API-First Architecture    | ✅ PASS    | Auth.js in Next.js layer, Express API verifies JWTs, all FRs define API endpoints before UI                                                                                |
| III  | Test-Driven Development   | ✅ PASS    | Spec defines acceptance scenarios as GWT; tests written before code per constitution                                                                                       |
| IV   | Transactional Integrity   | ✅ PASS    | Order groups tickets atomically, PriceTier-level row locking, idempotent webhooks, PaymentTransaction append-only                                                          |
| V    | Role-Based Access Control | ✅ PASS    | Single User table, role string (customer/organizer/admin), JWT propagation, Contact separation                                                                             |
| VI   | Real-Time Synchronization | ✅ PASS    | Inventory/redemption counts immediately visible; <2s scan requirement preserved                                                                                            |
| VII  | MVP Simplicity            | ✅ PASS    | No seat selection, no dynamic pricing, no multi-payment, no offline. Includes all MVP MUSTs: Organization→Venue→Event hierarchy, PriceTier, Auth.js, Order, Guest checkout |
| VIII | Living Documentation      | ✅ PASS    | API contracts generated in Phase 1, data model documented, quickstart produced                                                                                             |
| IX   | Data Architecture         | ✅ PASS    | Exact hierarchy match: Org→Venue→Event→PriceTier; User/Contact separation; cuid IDs; shared packages/db; app-level tenancy                                                 |

**Gate result: PASS — no violations. Proceeding to Phase 0.**

### Post-Phase 1 Re-evaluation

_Re-checked after data-model.md, contracts/api.yaml, and quickstart.md are complete._

| #    | Principle                 | Compliance | Post-Design Notes                                                                                                                                                                                                                                        |
| ---- | ------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I    | Single Source of Truth    | ✅ PASS    | data-model.md defines cuid IDs on all entities; Ticket.barcode UNIQUE; QR JWT carries ticketId+eventId+barcode; single Prisma schema in packages/db                                                                                                      |
| II   | API-First Architecture    | ✅ PASS    | contracts/api.yaml documents 32 endpoints with full request/response schemas before implementation; JWT Bearer auth on all protected routes; role enforcement via middleware                                                                             |
| III  | Test-Driven Development   | ✅ PASS    | Acceptance scenarios from spec.md map 1:1 to API contract operations; tests will be written before implementation per tasks.md                                                                                                                           |
| IV   | Transactional Integrity   | ✅ PASS    | data-model.md defines PriceTier inventory invariant (quantitySold + quantityReserved ≤ quantityTotal) with row-level locking; Order groups tickets atomically; PaymentTransaction is append-only (no updatedAt); idempotent webhook handling specified   |
| V    | Role-Based Access Control | ✅ PASS    | User model is Auth.js Adapter-compatible with custom role field; UserRole enum (CUSTOMER, ORGANIZER, ADMIN); Contact separated from User; API contracts specify auth requirements per endpoint; JWT payload includes role claim                          |
| VI   | Real-Time Synchronization | ✅ PASS    | Ticket.redeemedAt timestamp captured on scan; PriceTier.quantitySold/quantityReserved updated atomically; redemption endpoint returns verdict in <2s per contract                                                                                        |
| VII  | MVP Simplicity            | ✅ PASS    | No seat selection, no dynamic pricing, no offline, no multi-payment. Includes all MVP MUSTs: Org→Venue→Event hierarchy, PriceTier, Auth.js, Order, Guest checkout, QR redemption                                                                         |
| VIII | Living Documentation      | ✅ PASS    | data-model.md, contracts/api.yaml, quickstart.md, research.md all produced as Phase 1 deliverables; API documented before implementation                                                                                                                 |
| IX   | Data Architecture         | ✅ PASS    | Exact hierarchy: Organization(1→N)Venue(1→N)Event(1→N)PriceTier; Event(1→N)Order(1→N)Ticket; User/Contact separation; cuid IDs; shared @jump/db; app-level tenancy; PaymentTransaction append-only; all entity lifecycle states match constitution table |

**Post-Phase 1 gate result: PASS — all 9 principles verified against design artifacts.**

## Project Structure

### Documentation (this feature)

```text
specs/003-schema-redesign/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (OpenAPI schemas)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
packages/
└── db/
    ├── package.json           # @jump/db workspace package
    ├── prisma/
    │   └── schema.prisma      # Shared Prisma schema (moved from backend/prisma/)
    └── index.ts               # Re-exports PrismaClient + generated types

backend/
├── src/
│   ├── api/
│   │   ├── server.js
│   │   ├── routes/
│   │   │   ├── auth.js            # REMOVED (replaced by Auth.js in frontend)
│   │   │   ├── events.js          # UPDATED: venueId, capacity, priceTier nesting
│   │   │   ├── tickets.js         # UPDATED: orderId, priceTierId, contactId
│   │   │   ├── organizations.js   # NEW: CRUD for organizations
│   │   │   ├── venues.js          # NEW: CRUD for venues
│   │   │   ├── priceTiers.js      # NEW: CRUD for price tiers
│   │   │   ├── orders.js          # NEW: order creation, retrieval, guest lookup
│   │   │   └── users.js           # NEW: admin user management
│   │   ├── middleware/
│   │   └── validators/
│   ├── middleware/
│   │   ├── auth.js                # REWRITTEN: JWT verification (Auth.js tokens)
│   │   ├── rbac.js                # REWRITTEN: requireRole() from JWT claims
│   │   └── errorHandler.js
│   ├── services/
│   │   ├── AuthService.js         # REMOVED (replaced by Auth.js)
│   │   ├── AdminEventService.js   # REMOVED (merged into EventService)
│   │   ├── EventService.js        # UPDATED: venue FK, capacity, PriceTier ops
│   │   ├── TicketService.js       # UPDATED: per-tier locking, Order parent
│   │   ├── PaymentService.js      # UPDATED: Order creation, Contact upsert
│   │   ├── EmailService.js        # UPDATED: SendGrid → Resend, async retry
│   │   ├── QRService.js           # UNCHANGED
│   │   ├── OrganizationService.js # NEW
│   │   ├── VenueService.js        # NEW
│   │   ├── OrderService.js        # NEW
│   │   └── UserService.js         # NEW
│   ├── config/
│   │   ├── stripe.js
│   │   ├── sendgrid.js            # REMOVED (replaced by resend.js)
│   │   └── resend.js              # NEW
│   └── utils/
└── tests/
    ├── contract/
    ├── integration/
    └── unit/

frontend/
├── src/
│   ├── app/
│   │   ├── api/auth/[...nextauth]/route.ts  # NEW: Auth.js route handler
│   │   ├── auth/
│   │   │   └── signin/page.tsx              # NEW: magic link + Google sign-in
│   │   ├── events/                          # UPDATED: price tier selection UI
│   │   ├── orders/
│   │   │   ├── page.tsx                     # NEW: order history
│   │   │   └── lookup/page.tsx              # NEW: guest order lookup
│   │   ├── dashboard/
│   │   │   ├── events/                      # UPDATED: per-tier analytics
│   │   │   ├── organizations/               # NEW: org management
│   │   │   ├── venues/                      # NEW: venue management
│   │   │   └── users/                       # NEW: admin user management
│   │   └── layout.tsx                       # UPDATED: SessionProvider wrapper
│   ├── components/
│   ├── hooks/
│   │   └── useAuth.tsx                      # REMOVED (replaced by useSession)
│   ├── services/
│   │   └── authService.ts                   # REMOVED (replaced by next-auth/react)
│   └── auth.ts                              # NEW: Auth.js config (providers, callbacks)
├── middleware.ts                             # NEW: Auth.js edge middleware
└── tests/
```

**Structure Decision**: Web monorepo with shared `packages/db`. The Prisma schema moves from `backend/prisma/` to `packages/db/prisma/` so both frontend (Auth.js Prisma Adapter) and backend (business logic) share a single source of truth for types and client. Backend auth layer is gutted (Auth.js replaces Express sessions); frontend gains Auth.js route handler and edge middleware.

## Complexity Tracking

> No constitution violations detected. This section is intentionally empty.
