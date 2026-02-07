# Research: Online Ticket Purchase and QR Code Generation

**Feature**: 001-online-ticket-purchase  
**Date**: 2026-02-04  
**Purpose**: Resolve NEEDS CLARIFICATION items from Technical Context and research best practices for technology stack

## Research Tasks

### 1. Backend Language & Framework Selection

**Context**: Need to choose backend language/framework for REST API with ACID transactions, Stripe integration, JWT signing, and horizontal scaling.

**Decision**: Node.js 20 LTS with Express.js 4.x

**Rationale**:

- **Stripe SDK**: Official `stripe` npm package with excellent TypeScript support and webhook handling
- **Performance**: Event-driven architecture handles concurrent requests efficiently (target: 100 concurrent purchases)
- **Ecosystem**: Rich libraries for JWT (`jsonwebtoken`), QR codes (`qrcode`), PostgreSQL (`pg` with `knex`/`Prisma` ORM)
- **Deployment**: Lightweight containers, horizontal scaling proven pattern
- **Developer velocity**: Large talent pool, rapid MVP development
- **Constitution alignment**: Stateless request handling supports horizontal scaling (Constitution deployment standards)

**Alternatives considered**:

- **Python/FastAPI**: Excellent for async, but Node.js Stripe SDK more mature. Rejected for slightly slower cold start times.
- **Java/Spring Boot**: Enterprise-grade, but heavier containers and longer build times. Overkill for MVP (Principle VII: Simplicity).
- **Go**: Fast and efficient, but smaller ecosystem for payment integrations. Rejected for MVP speed.

---

### 2. Frontend Framework Selection

**Context**: Need customer-facing web app (responsive) and admin portal with real-time dashboard updates.

**Decision**: Next.js 14 (React framework) with TypeScript

**Rationale**:

- **SSR/SSG**: Server-side rendering improves SEO for event listings, faster initial page load
- **React ecosystem**: Component libraries (Tailwind UI, shadcn/ui) accelerate UI development
- **TypeScript**: Type safety for API contracts reduces runtime errors
- **Real-time**: Built-in support for Server-Sent Events or polling for dashboard updates (SC-006: 2-second updates)
- **Responsive**: Mobile-first CSS frameworks (Tailwind) ensure responsive design per spec
- **Constitution alignment**: Stateless client per Principle II (API-First)

**Alternatives considered**:

- **Vue.js/Nuxt**: Similar capabilities, but React has larger Stripe/payment component ecosystem
- **Svelte/SvelteKit**: Smaller bundle, but less mature payment integration libraries
- **Plain React (Vite)**: Faster builds, but missing SSR/SEO benefits for event discovery

---

### 3. Database ORM & Migration Strategy

**Context**: PostgreSQL chosen for ACID compliance. Need ORM for models and migration management.

**Decision**: Prisma 5.x (ORM) + Prisma Migrate (migrations)

**Rationale**:

- **Type safety**: Auto-generates TypeScript types from schema (reduces model-code drift)
- **Migrations**: Declarative schema with automatic SQL generation, version-controlled
- **Transactions**: First-class transaction support required for atomic payment→ticket→inventory (Principle IV)
- **Row-level locking**: `SELECT FOR UPDATE` support for capacity enforcement (FR-009)
- **Developer experience**: Visual Studio Code integration, auto-completion

**Alternatives considered**:

- **Knex.js**: More flexible but requires manual TypeScript definitions. Rejected for lack of type generation.
- **TypeORM**: Good TypeScript support, but Prisma's migration tooling is more robust
- **Raw SQL**: Maximum control but higher maintenance burden, no type safety

---

### 4. Testing Framework Selection

**Context**: Need contract tests, integration tests (payment flow), and unit tests per Constitution Principle III (TDD).

**Decision**:

- **Backend**: Jest 29.x with Supertest (API testing)
- **Frontend**: Jest + React Testing Library (components), Playwright (E2E)

**Rationale**:

- **Jest**: Industry standard for Node.js/React, excellent mocking support, parallel test execution
- **Supertest**: HTTP assertion library for Express routes, perfect for contract tests (Phase 1 contracts/)
- **Playwright**: Cross-browser E2E for complete purchase flow (US1), headless mode for CI/CD
- **React Testing Library**: User-centric testing (tests user interactions, not implementation details)
- **Constitution alignment**: TDD workflow Red-Green-Refactor supported by watch mode

---

### 5. JWT Signing Algorithm & Key Management

**Context**: QR codes encode signed JWTs (FR-006, FR-007). Need to choose signing algorithm.

**Decision**: HMAC-SHA256 with rotating secret keys (stored in environment variables)

**Rationale**:

- **Performance**: HMAC is faster than RSA for signing/verification (important for QR generation at scale)
- **Simplicity**: Symmetric signing sufficient for MVP (backend both signs and verifies)
- **Security**: 256-bit entropy, rotate keys quarterly via environment config
- **Library support**: `jsonwebtoken` npm package has proven implementation
- **Constitution alignment**: Cryptographic binding prevents QR forgery (Principle I)

**Alternatives considered**:

- **RSA signatures**: Asymmetric keys allow distributed verification, but MVP only backend verifies (deferred to future)
- **ECDSA**: Smaller signatures, but HMAC-SHA256 is more widely understood and audited

---

### 6. QR Code Generation Library

**Context**: Need to generate QR codes encoding JWT strings (FR-006) for display and email.

**Decision**: `qrcode` npm package (version 1.5.x)

**Rationale**:

- **Format support**: SVG (scalable), PNG (email attachment), data URL (browser display)
- **Error correction**: Level H (30% redundancy) ensures scannability even if damaged
- **Performance**: Synchronous generation <10ms for 200-character JWT
- **Browser compatibility**: Works in Node.js (backend) and browser (optional client-side preview)

**Alternatives considered**:

- **node-qrcode**: Similar but less actively maintained
- **ZXing (Java)**: Requires JVM, rejected due to language mismatch
- **Google Charts API**: External dependency, slower, potential privacy concerns

---

### 7. Email Delivery Service

**Context**: Send QR code tickets via email after purchase (FR-008, SC-005: <5 seconds delivery).

**Decision**: SendGrid (Twilio SendGrid API)

**Rationale**:

- **Reliability**: 99.99% uptime SLA, transactional email optimized for delivery speed
- **Templates**: HTML email templates with embedded QR code images
- **Webhooks**: Delivery confirmation callbacks for tracking (SC-005 verification)
- **Free tier**: 100 emails/day sufficient for MVP testing
- **Stripe integration**: Common pattern (many Stripe users also use SendGrid)

**Alternatives considered**:

- **AWS SES**: Cheaper at scale, but requires AWS account setup. Deferred for post-MVP cost optimization.
- **Mailgun**: Similar features, but SendGrid has better TypeScript SDK
- **Resend**: Newer service with great DX, but less proven at scale

---

### 8. Session Storage Strategy

**Context**: Database-backed sessions required per Constitution (horizontal scaling). Session tokens expire after 24 hours (FR-023).

**Decision**: Redis for session storage with `express-session` + `connect-redis`

**Rationale**:

- **Performance**: In-memory store, <1ms session lookups (critical for <500ms API p95 target)
- **Expiration**: Native TTL support for 24-hour session timeout (FR-023)
- **Horizontal scaling**: Shared session store across multiple API instances (Constitution deployment requirement)
- **High availability**: Redis Sentinel/Cluster for production failover
- **Developer experience**: Well-documented Express middleware

**Alternatives considered**:

- **PostgreSQL sessions**: ACID guarantees but slower (10-50ms latency vs <1ms Redis). Rejected for performance.
- **JWT-only (stateless)**: No server-side revocation (security risk for logout/role changes). Rejected per Constitution session requirement.

---

### 9. Payment Webhook Handling

**Context**: Stripe sends asynchronous webhooks for payment confirmation (FR-019). Need reliable processing.

**Decision**: Dedicated `/webhooks/stripe` endpoint with signature verification + idempotent processing

**Rationale**:

- **Security**: Stripe signature verification prevents webhook forgery (Stripe SDK built-in)
- **Idempotency**: Check payment transaction ID before processing (prevents duplicate ticket issuance if webhook retries)
- **Async retry**: Stripe retries failed webhooks automatically (3 days), system can handle late delivery
- **Constitution alignment**: Ensures eventual consistency while maintaining transactional integrity (Principle IV)

**Pattern**:

```
1. Verify Stripe signature
2. Parse event type (payment_intent.succeeded, payment_intent.failed)
3. Check if transaction_id already processed (idempotency)
4. If new: Update PaymentTransaction status, trigger ticket issuance
5. Return 200 OK immediately (Stripe expects <5s response)
```

---

### 10. Database Connection Pooling

**Context**: PostgreSQL connections must be pooled for performance under concurrent load (100 purchases target).

**Decision**: Prisma connection pool with `connection_limit: 20`, `pool_timeout: 30s`

**Rationale**:

- **Connection reuse**: Reduces connection overhead (new connection = ~50ms, pooled = <1ms)
- **Concurrency**: 20 connections sufficient for 100 concurrent requests (avg 5 requests/purchase including inventory checks)
- **Timeout**: 30s prevents indefinite waits if pool exhausted
- **Automatic management**: Prisma handles pool lifecycle (acquire, release, health checks)

---

### 11. Metrics Collection & Monitoring

**Context**: FR-025 requires metrics: ticket sales rate, payment success rate, API response times, QR generation success rate, active sessions.

**Decision**: Prometheus + Express middleware (`prom-client`)

**Rationale**:

- **Histogram metrics**: API response times bucketed for p50/p95/p99 calculation (SC-001 validation)
- **Counter metrics**: Ticket sales, payment successes/failures (SC-003 validation)
- **Gauge metrics**: Active session count, current inventory levels
- **Push model**: Express middleware auto-instruments HTTP requests (no code changes per endpoint)
- **Open standard**: Compatible with Grafana dashboards for visualization (post-MVP)

**Metrics implemented**:

- `http_request_duration_ms{endpoint, method}` - API response times
- `ticket_sales_total{event_id}` - Sales rate calculation
- `payment_status_total{status=success|failed}` - Payment success rate
- `qr_generation_total{status=success|failed}` - QR generation reliability
- `active_sessions` - Session count

---

### 12. Error Handling & Logging Strategy

**Context**: Constitution requires structured logging. Need strategy for errors, debugging, and audit trails.

**Decision**: Winston logger with JSON format + correlation IDs

**Rationale**:

- **Structured logs**: JSON output parsed by log aggregators (future: ELK stack, CloudWatch)
- **Correlation IDs**: Trace requests across services (request ID in headers, propagated to logs)
- **Log levels**: ERROR (immediate action), WARN (investigate), INFO (audit trail), DEBUG (development)
- **Audit trail**: FR-016 requires timestamp, customer ID, event ID, amount, Stripe transaction ID (logged at INFO level)
- **Constitution alignment**: Debuggability per Principle VIII documentation requirement

---

## Technology Stack Summary

| Component          | Technology               | Version     | Justification                                 |
| ------------------ | ------------------------ | ----------- | --------------------------------------------- |
| Backend Runtime    | Node.js                  | 20 LTS      | Event-driven concurrency, Stripe SDK maturity |
| Backend Framework  | Express.js               | 4.x         | Proven REST API pattern, middleware ecosystem |
| Frontend Framework | Next.js                  | 14          | SSR/SEO, React ecosystem, TypeScript support  |
| Database           | PostgreSQL               | 15+         | ACID compliance (Constitution Principle IV)   |
| ORM                | Prisma                   | 5.x         | Type safety, migrations, transaction support  |
| Session Store      | Redis                    | 7.x         | <1ms lookups, horizontal scaling              |
| Testing (Backend)  | Jest + Supertest         | 29.x        | TDD workflow, contract tests                  |
| Testing (Frontend) | Jest + Playwright        | 29.x + 1.4x | Component + E2E coverage                      |
| Payment Gateway    | Stripe                   | Latest SDK  | MVP requirement, webhook support              |
| JWT Library        | jsonwebtoken             | 9.x         | HMAC-SHA256 signing                           |
| QR Code Library    | qrcode                   | 1.5.x       | SVG/PNG generation, error correction          |
| Email Service      | SendGrid                 | Latest SDK  | <5s delivery, template support                |
| Metrics            | Prometheus (prom-client) | Latest      | Histogram/counter/gauge metrics               |
| Logging            | Winston                  | 3.x         | Structured JSON, correlation IDs              |

---

## Architecture Decision Records (ADRs)

### ADR-001: Monolithic Backend vs Microservices

**Decision**: Monolithic Express.js backend for MVP

**Rationale**: Constitution Principle VII (MVP Simplicity) favors single deployable unit. Microservices add operational complexity (service discovery, inter-service auth, distributed transactions). Monolith can scale horizontally (stateless + Redis sessions). Defer microservices to post-MVP when domain boundaries stabilize.

**Consequences**: Simpler deployment, faster development, easier debugging. Future refactor to microservices possible if scaling needs arise (e.g., separate payment service).

---

### ADR-002: Synchronous vs Asynchronous Ticket Issuance

**Decision**: Synchronous ticket issuance in purchase flow, asynchronous QR email retry

**Rationale**: Customers expect immediate QR code display after payment (SC-001: <90s purchase). Synchronous issuance ensures atomic payment→ticket→inventory (Principle IV). QR email can retry asynchronously (FR-020) without blocking customer experience.

**Consequences**: 95% of customers see QR immediately (SC-005). 5% edge cases (email failure) handled by retry worker. Admin alert if all retries fail.

---

### ADR-003: Server-Side vs Client-Side QR Generation

**Decision**: Server-side QR generation, sent to client as data URL

**Rationale**: JWT signing must happen server-side (private key security). Generating QR on server ensures consistent format/error correction. Client displays pre-rendered QR (faster than client-side library load).

**Consequences**: Slightly larger API response (~2-5KB per QR), but eliminates client library dependency and ensures cryptographic security.

---

### ADR-004: Polling vs WebSockets for Real-Time Dashboard

**Decision**: HTTP polling (5-second interval) for admin dashboard

**Rationale**: SC-006 requires <2s updates, but exact real-time not critical for admin view. Polling is simpler to implement/deploy than WebSockets (no sticky sessions, connection management). MVP uses polling; WebSockets deferred to post-MVP if sub-second updates needed.

**Consequences**: Slightly higher network overhead, but sufficient for MVP. Upgrade path to Server-Sent Events (SSE) available if needed.

---

## Implementation Risks & Mitigations

| Risk                                  | Impact                         | Likelihood | Mitigation                                                                              |
| ------------------------------------- | ------------------------------ | ---------- | --------------------------------------------------------------------------------------- |
| Stripe webhook delays                 | Tickets not issued immediately | Low        | 30s timeout + retry mechanism (FR-020), customer sees "Processing"                      |
| Concurrent capacity race condition    | Overselling tickets            | Medium     | PostgreSQL row-level locking (`SELECT FOR UPDATE`) in transaction (FR-009)              |
| Email delivery failures               | Customer doesn't receive QR    | Low        | Async retry (3 attempts), admin alert, customer can re-download from "My Tickets" (US4) |
| Session store (Redis) downtime        | Users can't authenticate       | Low        | Redis Sentinel HA in production, graceful degradation (logout users, require re-login)  |
| PostgreSQL connection pool exhaustion | API timeout/failures           | Medium     | Connection limit tuning (start 20, monitor), queue requests vs fail fast                |
| JWT secret key compromise             | QR code forgery                | Low        | Rotate keys quarterly, use environment variables (never commit to repo)                 |

---

## Next Steps (Phase 1)

All NEEDS CLARIFICATION items resolved. Proceeding to:

1. **data-model.md**: Database schema for Event, Ticket, Customer, Admin, PaymentTransaction entities
2. **contracts/**: OpenAPI spec for REST endpoints (/events, /tickets, /auth, /admin, /webhooks)
3. **quickstart.md**: Local development setup (Node.js, PostgreSQL, Redis, Stripe test keys, environment config)
4. **Re-evaluate Constitution Check**: Confirm no violations introduced by technology choices
