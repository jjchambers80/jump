# Implementation Plan: Online Ticket Purchase and QR Code Generation

**Branch**: `001-online-ticket-purchase` | **Date**: 2026-02-04 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-online-ticket-purchase/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Enable customers to purchase general-admission event tickets online through Stripe payment gateway and receive cryptographically-signed QR codes for entry. Event organizers create and publish events through an admin portal with real-time capacity enforcement preventing overselling. The system validates Constitution Principles I (Single Source of Truth), IV (Transactional Integrity), V (RBAC), and VI (Real-Time Synchronization) by ensuring atomic payment→ticket→inventory operations with database-level locking under concurrent load.

## Technical Context

**Language/Version**: Node.js 20 LTS (backend), TypeScript 5.x, Next.js 14 (frontend with React 18)  
**Primary Dependencies**: Express.js 4.x, Stripe SDK, jsonwebtoken, qrcode, Prisma 5.x, SendGrid SDK  
**Storage**: PostgreSQL 15+ (ACID-compliant relational database per Constitution Principle IV)  
**Testing**: Jest 29.x + Supertest (backend contract tests), Jest + Playwright 1.40+ (frontend E2E)  
**Target Platform**: Web browsers (desktop + mobile responsive), Linux/container-based server deployment  
**Project Type**: web (frontend + backend)  
**Performance Goals**: API <500ms p95 for ticket purchase/redemption (Constitution), QR scan validation <2s, dashboard load <3s  
**Constraints**: ACID transactions required, horizontal scaling (stateless), database-backed sessions (Constitution), HTTPS/TLS 1.2+, PCI-DSS compliance  
**Scale/Scope**: MVP targets: 100 concurrent purchases, events with ≤100,000 capacity, 10k tickets sold per event

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Principle I: Single Source of Truth

**Status**: ✅ PASS  
**Verification**: All ticket operations flow through centralized API (FR-001 through FR-020). Each ticket has UUID, QR codes cryptographically bind to ticket ID via JWT (FR-006, FR-007). Always-online operation required.

### Principle II: API-First Architecture

**Status**: ✅ PASS  
**Verification**: Backend provides REST endpoints for all operations. Web clients are stateless consumers. Auth enforced at API layer (FR-013, FR-021). API contracts must be documented before implementation (Phase 1 contracts/).

### Principle III: Test-Driven Development (NON-NEGOTIABLE)

**Status**: ✅ PASS  
**Verification**: Spec includes 26 acceptance scenarios across 4 user stories. All functional requirements (FR-001 through FR-028) have testable criteria. 8 measurable success criteria defined (SC-001 through SC-008). Tests will be written first per Red-Green-Refactor cycle.

### Principle IV: Transactional Integrity

**Status**: ✅ PASS  
**Verification**: Payment confirmation precedes ticket issuance (FR-004). Inventory decrements atomic with ticket creation. Failed payments prevent ticket issuance. Database-level locking required (FR-009). Audit trails mandatory (FR-016). PostgreSQL provides ACID compliance.

### Principle V: Role-Based Access Control

**Status**: ✅ PASS  
**Verification**: Admin/Customer roles defined in spec. Admin-only event creation (FR-011, FR-013 with 403 enforcement). Session tokens include role claims, 24-hour expiry (FR-023). Default role is Customer (least privilege).

### Principle VI: Real-Time Synchronization

**Status**: ✅ PASS  
**Verification**: Inventory updates visible within 2 seconds (SC-006, Constitution requirement). Database-level locking prevents concurrent double-purchase (FR-009, US3). Real-time dashboard for admins (FR-014).

### Principle VII: MVP Simplicity & Iteration

**Status**: ✅ PASS  
**Verification**: General-admission only, single payment provider (Stripe), always-online. No reserved seating, multi-tier pricing, offline mode, or advanced analytics (Out of Scope). Complexity deferred per Constitution.

### Principle VIII: Living Documentation

**Status**: ✅ PASS  
**Verification**: Plan includes quickstart.md, API contracts/, architecture decisions in research.md. /docs folder structure to be created in Phase 1. User guides, API docs, and architecture decisions will be generated alongside implementation.

**GATE RESULT**: ✅ ALL GATES PASSED - Proceeding to Phase 0 research

---

**POST-DESIGN RE-EVALUATION** (after Phase 1):

### Technology Choices Review

**Validated Decisions from research.md**:

- Node.js 20 + Express.js: Event-driven concurrency supports 100 concurrent purchases ✓
- Next.js 14: SSR/SEO for event discovery, React ecosystem ✓
- PostgreSQL 15+ with Prisma: ACID compliance, row-level locking (`FOR UPDATE`) ✓
- Redis 7.x: Session storage <1ms, horizontal scaling ✓
- HMAC-SHA256 JWT signing: Sufficient cryptographic security for MVP ✓

### Principle Confirmation

All principles remain compliant with technology choices:

**I. Single Source of Truth**: ✅ PostgreSQL single database, JWT-signed QR codes prevent forgery  
**II. API-First Architecture**: ✅ Express REST API, stateless Next.js frontend  
**III. Test-Driven Development**: ✅ Jest + Supertest + Playwright support Red-Green-Refactor  
**IV. Transactional Integrity**: ✅ Prisma transactions + PostgreSQL ACID guarantee atomicity  
**V. RBAC**: ✅ Session-based auth with user_type discriminator enforces Admin/Customer roles  
**VI. Real-Time Synchronization**: ✅ Database-level locking prevents race conditions, polling achieves <2s updates  
**VII. MVP Simplicity**: ✅ Monolithic backend, single payment provider (Stripe), no microservices complexity  
**VIII. Living Documentation**: ✅ OpenAPI contracts, Prisma schema, research ADRs, quickstart guide complete

**No constitution violations introduced by technology stack.**

**FINAL GATE RESULT**: ✅ APPROVED FOR IMPLEMENTATION (Phase 2: tasks.md generation)

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── models/              # Event, Ticket, Customer, Admin, PaymentTransaction
│   ├── services/            # PaymentService, TicketService, QRService, EmailService
│   ├── api/
│   │   ├── routes/          # /events, /tickets, /auth, /admin
│   │   ├── middleware/      # auth, RBAC, error handling
│   │   └── validators/      # request validation
│   ├── database/
│   │   ├── migrations/      # schema versioning
│   │   └── seeds/           # test data
│   └── utils/               # JWT signing, metrics collection
└── tests/
    ├── contract/            # API contract tests
    ├── integration/         # Payment + ticket issuance, capacity enforcement
    └── unit/                # Individual service tests

frontend/
├── src/
│   ├── components/          # EventCard, TicketDisplay, QRCode, PaymentForm
│   ├── pages/
│   │   ├── customer/        # EventList, EventDetail, Checkout, MyTickets
│   │   └── admin/           # CreateEvent, Dashboard
│   ├── services/            # API client wrappers
│   └── hooks/               # useAuth, useEvents, useTickets
└── tests/
    ├── integration/         # E2E purchase flow, admin workflows
    └── unit/                # Component tests

docs/                        # Living Documentation (Principle VIII)
├── user-guides/
│   ├── organizers/         # Event creation, monitoring
│   └── customers/          # Ticket purchase, retrieval
├── api/                    # Endpoint contracts from contracts/
├── architecture/
│   ├── decisions/          # ADRs from research.md
│   └── data-models.md      # Database schema
└── development/
    └── setup.md            # Local development from quickstart.md
```

**Structure Decision**: Web application (Option 2) selected. Jump requires separate frontend (customer web app + admin portal) and backend (REST API + database). Backend handles business logic, auth, payments, and database transactions per Constitution Principle II (API-First). Frontend is stateless, presentation-only. /docs folder added per Constitution Principle VIII (Living Documentation).

## Complexity Tracking

**No violations requiring justification.**

All Constitution gates passed during initial evaluation and post-design re-evaluation. Technology stack selections from research.md align with constitutional principles without exceptions.
