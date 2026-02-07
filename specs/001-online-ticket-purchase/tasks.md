# Tasks: Online Ticket Purchase and QR Code Generation

**Branch**: `001-online-ticket-purchase`  
**Input**: Design documents from `/specs/001-online-ticket-purchase/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story per Constitution Principle III (TDD).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

This is a web application with:

- **Backend**: `backend/src/`, `backend/tests/`
- **Frontend**: `frontend/src/`, `frontend/tests/`
- **Documentation**: `docs/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create backend/ directory structure: src/{models,services,api/{routes,middleware,validators},database/{migrations,seeds},utils}, tests/{contract,integration,unit}
- [x] T002 Create frontend/ directory structure: src/{components,pages/{customer,admin},services,hooks}, tests/{integration,unit}
- [x] T003 Create docs/ directory structure: user-guides/{organizers,customers}, api/, architecture/{decisions,data-models.md}, development/setup.md
- [x] T004 [P] Initialize backend Node.js 20 project with package.json (dependencies: express, @prisma/client, stripe, jsonwebtoken, qrcode, bcrypt, cors, dotenv)
- [x] T005 [P] Initialize frontend Next.js 14 project with TypeScript 5.x and React 18
- [x] T006 [P] Configure ESLint and Prettier for both backend and frontend
- [x] T007 [P] Configure Jest 29.x for backend testing with supertest
- [x] T008 [P] Configure Playwright 1.40+ for frontend E2E testing
- [x] T009 Create .env.example files for backend (DATABASE_URL, REDIS_URL, STRIPE_SECRET_KEY, JWT_SECRET, SENDGRID_API_KEY) and frontend (NEXT_PUBLIC_API_URL, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
- [x] T010 Create backend/.gitignore and frontend/.gitignore (node_modules, .env, build artifacts)

**Checkpoint**: ✅ Project structure ready for foundational development

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T011 Initialize Prisma 5.x in backend/prisma/ with schema.prisma (generator, datasource PostgreSQL 15+)
- [x] T012 Define Prisma enums in backend/prisma/schema.prisma: EventStatus (DRAFT, PUBLISHED), TicketStatus (VALID, REDEEMED, EXPIRED), PaymentStatus (PENDING, SUCCEEDED, FAILED), UserType (CUSTOMER, ADMIN)
- [x] T013 [P] Define Event model in backend/prisma/schema.prisma per data-model.md (id UUID, organizer_id, name, date, venue, capacity, ticket_price, status, created_at)
- [x] T014 [P] Define Ticket model in backend/prisma/schema.prisma per data-model.md (id UUID, event_id, customer_id, purchase_time, price_paid, qr_code_jwt, status, stripe_tx_id)
- [x] T015 [P] Define Customer model in backend/prisma/schema.prisma (id UUID, email unique, name, password_hash, created_at)
- [x] T016 [P] Define Admin model in backend/prisma/schema.prisma (id UUID, email unique, name, organization, password_hash, created_at)
- [x] T017 [P] Define PaymentTransaction model in backend/prisma/schema.prisma (id UUID, stripe_session_id unique, customer_id, event_id, amount, currency, status, timestamp, failure_reason)
- [x] T018 [P] Define Session model in backend/prisma/schema.prisma (id UUID, user_id, user_type, token, expires_at, created_at)
- [x] T019 Add indexes to schema.prisma: idx_event_status, idx_event_date, idx_event_organizer, idx_ticket_event, idx_ticket_customer, idx_session_token
- [x] T020 Run prisma migrate dev --name init_online_ticket_purchase to create initial migration
- [x] T021 Create backend/src/database/seeds/seed.ts with test data: 2 admins, 5 customers, 3 events (1 draft, 2 published)
- [x] T022 Implement backend/src/middleware/errorHandler.ts for centralized error responses (error, message, details)
- [x] T023 Implement backend/src/middleware/auth.ts for session token validation (verifies session existence, checks expiration per FR-023)
- [x] T024 Implement backend/src/middleware/rbac.ts for role-based access control (requireAdmin, requireCustomer middleware functions per FR-013)
- [x] T025 Implement backend/src/utils/logger.ts using Winston 3.x for structured JSON logging with correlation IDs
- [x] T026 Implement backend/src/utils/metrics.ts using prom-client for Prometheus metrics (sales rate, payment success, API response times, QR generation, sessions per FR-025)
- [x] T027 Create backend/src/api/server.ts Express app with CORS, JSON body parser, error handler middleware, health check endpoint (/health)
- [x] T028 Configure Redis 7.x client in backend/src/utils/redis.ts for session storage
- [x] T029 Create backend/src/config/stripe.ts with Stripe SDK initialization using STRIPE_SECRET_KEY
- [x] T030 Create backend/src/config/sendgrid.ts with SendGrid SDK initialization for email delivery
- [x] T031 [P] Create frontend/src/services/api.ts base HTTP client with fetch wrapper, error handling, and Authorization header injection
- [x] T032 [P] Create frontend/src/hooks/useAuth.tsx custom hook for session management (login, logout, current user state)
- [x] T033 Create docs/architecture/data-models.md by copying content from data-model.md
- [x] T034 Create docs/api/ directory and copy contracts/api.yaml and contracts/README.md
- [x] T035 Create docs/development/setup.md by copying content from quickstart.md

**Checkpoint**: ✅ Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Customer Ticket Purchase Flow (Priority: P1) 🎯 MVP

**Goal**: Enable customers to purchase tickets through Stripe and receive QR codes via email

**Independent Test**: Create test event, purchase ticket with Stripe test credentials, verify payment, confirm QR code delivery

### Contract Tests for User Story 1 (TDD - Write FIRST)

> **⚠️ CRITICAL**: Write these tests FIRST, ensure they FAIL before implementation (Red-Green-Refactor per Principle III)

- [x] T036 [P] [US1] Contract test for GET /events in backend/tests/contract/events.test.ts (verify 200 response, pagination, published events only per FR-001)
- [x] T037 [P] [US1] Contract test for GET /events/{eventId} in backend/tests/contract/events.test.ts (verify 200 with event details, capacity, 404 for invalid ID per FR-001)
- [x] T038 [P] [US1] Contract test for POST /tickets/purchase in backend/tests/contract/tickets.test.ts (verify 200 with Stripe session ID, 400 for invalid quantity, 409 for insufficient capacity per FR-002, FR-003, FR-010)
- [x] T039 [P] [US1] Contract test for GET /tickets/confirm in backend/tests/contract/tickets.test.ts (verify 200 with ticket and QR code, 404 for invalid session per FR-008)

### Integration Tests for User Story 1 (TDD - Write FIRST)

- [x] T040 [P] [US1] Integration test for full purchase flow in backend/tests/integration/purchaseFlow.test.ts (event listing → ticket purchase → Stripe success → ticket confirmation → email delivery, verify atomic payment→ticket→inventory per FR-004, SC-001, SC-003)
- [x] T041 [P] [US1] Integration test for QR code generation in backend/tests/integration/qrGeneration.test.ts (verify JWT structure with ticket_id, event_id, customer_email, expiration, HMAC-SHA256 signature per FR-006, FR-007, SC-004)
- [x] T042 [P] [US1] E2E test for customer purchase journey in frontend/tests/integration/customerPurchase.spec.ts using Playwright (browse events → select event → enter quantity → Stripe checkout → confirmation page with QR code per SC-001)

### Backend Implementation for User Story 1

- [x] T043 [P] [US1] Implement backend/src/services/EventService.ts with methods: listPublishedEvents(page, limit), getEventById(eventId) per FR-001
- [x] T044 [P] [US1] Implement backend/src/services/PaymentService.ts with methods: createStripeCheckoutSession(eventId, quantity, customerEmail) per FR-003, initiatePayment()
- [x] T045 [US1] Implement backend/src/services/TicketService.ts with methods: createTicketsAfterPayment(paymentTransactionId, eventId, customerId, quantity) using Prisma transaction for atomic inventory decrement + ticket creation per FR-004, FR-009
- [x] T046 [US1] Implement backend/src/services/QRService.ts with methods: generateQRCode(ticketId, eventId, customerEmail, expirationTime) using jsonwebtoken with HMAC-SHA256 signing per FR-006, FR-007
- [x] T047 [US1] Implement backend/src/services/EmailService.ts with methods: sendTicketEmail(customerEmail, tickets, qrCodes) using SendGrid SDK per FR-008, with retry logic (3 attempts) per FR-020
- [x] T048 [US1] Implement GET /events route in backend/src/api/routes/events.ts calling EventService.listPublishedEvents with pagination (default limit=20)
- [x] T049 [US1] Implement GET /events/:eventId route in backend/src/api/routes/events.ts calling EventService.getEventById with 404 handling
- [x] T050 [US1] Implement POST /tickets/purchase route in backend/src/api/routes/tickets.ts with request validation (quantity 1-10, eventId UUID, email format per FR-015), capacity check, Stripe session creation
- [x] T051 [US1] Implement GET /tickets/confirm route in backend/src/api/routes/tickets.ts to handle Stripe success redirect, verify payment, issue tickets, generate QR codes, send email
- [x] T052 [US1] Implement POST /webhooks/stripe route in backend/src/api/routes/webhooks.ts with signature verification, payment status update, idempotency per FR-019
- [x] T053 [US1] Add validation in backend/src/api/validators/ticketValidators.ts for purchase request (quantity range, email format, eventId UUID)
- [x] T054 [US1] Add error handling for capacity exceeded in TicketService (throw 409 Conflict per FR-010)
- [x] T055 [US1] Add logging for all ticket purchase operations in services (correlation ID, customer_id, event_id, ticket_ids, amount, stripe_tx_id per FR-016)
- [x] T056 [US1] Add metrics collection in PaymentService and TicketService (increment sales rate counter, record payment success/failure, record QR generation success per FR-025)

### Frontend Implementation for User Story 1

- [x] T057 [P] [US1] Create frontend/src/components/EventCard.tsx displaying event name, date, venue, price, capacity, "Buy Tickets" button
- [x] T058 [P] [US1] Create frontend/src/components/TicketDisplay.tsx for displaying QR code and ticket details
- [x] T059 [P] [US1] Create frontend/src/components/PaymentForm.tsx integrating Stripe Elements for checkout
- [x] T060 [US1] Implement frontend/src/pages/customer/EventList.tsx fetching events from GET /events, rendering EventCard components with pagination
- [x] T061 [US1] Implement frontend/src/pages/customer/EventDetail.tsx fetching single event from GET /events/:eventId, displaying details, quantity selector (1-10), "Buy Tickets" button
- [x] T062 [US1] Implement frontend/src/pages/customer/Checkout.tsx initiating Stripe Checkout via POST /tickets/purchase, redirecting to Stripe hosted page
- [x] T063 [US1] Implement frontend/src/pages/customer/Confirmation.tsx handling Stripe success redirect, calling GET /tickets/confirm, displaying TicketDisplay component with QR codes
- [x] T064 [US1] Create frontend/src/services/eventService.ts wrapper for event API calls (listEvents, getEventById)
- [x] T065 [US1] Create frontend/src/services/ticketService.ts wrapper for ticket API calls (purchaseTickets, confirmPurchase)
- [x] T066 [US1] Add responsive CSS in EventList and EventDetail pages using Tailwind (mobile-first design per target platform)
- [x] T067 [US1] Add error handling in Checkout page for "Event sold out during checkout" scenario (display error, link back to events)
- [x] T068 [US1] Add loading states in Confirmation page ("Processing..." with 30-second timeout per edge case)

**Checkpoint**: User Story 1 complete - Customers can purchase tickets and receive QR codes ✅

---

## Phase 4: User Story 3 - Capacity Enforcement and Oversell Prevention (Priority: P1) 🎯 MVP

**Goal**: Enforce capacity limits with database-level locking to prevent overselling under concurrent load

**Independent Test**: Create event with capacity=5, simulate 10 concurrent purchases, verify exactly 5 tickets sold

**Note**: US3 is implemented before US2 because it's P1 (critical for MVP) and enhances US1 (purchase flow) with concurrency safety

### Contract Tests for User Story 3 (TDD - Write FIRST)

- [x] T069 [P] [US3] Contract test for POST /tickets/purchase capacity validation in backend/tests/contract/tickets.test.ts (verify 400 when quantity > remaining, verify 409 when event sold out per FR-010)
- [x] T070 [P] [US3] Load test for concurrent purchases in backend/tests/integration/capacityEnforcement.test.ts (simulate 10 concurrent requests for event with capacity=5, verify exactly 5 succeed, 5 fail with 409 per FR-009, SC-002, SC-007)

### Implementation for User Story 3

- [x] T071 [US3] Enhance TicketService.createTicketsAfterPayment to use SELECT FOR UPDATE row-level locking in backend/src/services/TicketService.ts (wrap in Prisma transaction: lock event row, check capacity, decrement, create tickets per data-model.md capacity enforcement pseudocode)
- [x] T072 [US3] Add database constraint validation in backend/prisma/schema.prisma: CHECK constraint on Event capacity (capacity > 0, capacity <= 100000 per FR-012)
- [x] T073 [US3] Update POST /tickets/purchase route in backend/src/api/routes/tickets.ts to check remaining capacity before creating Stripe session (prevent payment initiation if capacity insufficient per edge case)
- [x] T074 [US3] Add error response for capacity exceeded: 409 Conflict with message "Event sold out during checkout" in backend/src/services/TicketService.ts
- [x] T075 [US3] Update frontend EventDetail page to disable "Buy Tickets" button when remaining capacity = 0, display "Sold Out" badge
- [x] T076 [US3] Add real-time capacity display in EventCard component showing "X tickets remaining" (calculated from total capacity - tickets sold)
- [x] T077 [US3] Add logging for capacity enforcement events (capacity_check, lock_acquired, inventory_decremented) in TicketService per FR-016

**Checkpoint**: User Story 3 complete - Capacity enforcement prevents overselling under concurrent load ✅

---

## Phase 5: User Story 2 - Event Organizer Creates Event (Priority: P2)

**Goal**: Enable admins to create events with capacity and pricing through admin portal

**Independent Test**: Login as admin, create event, verify it appears in event listing, confirm non-admin cannot access

### Contract Tests for User Story 2 (TDD - Write FIRST)

- [x] T078 [P] [US2] Contract test for POST /auth/register in backend/tests/contract/auth.test.ts (verify 201 with user object, 400 for invalid email, 409 for duplicate email per FR-021, FR-024)
- [x] T079 [P] [US2] Contract test for POST /auth/login in backend/tests/contract/auth.test.ts (verify 200 with session cookie, 401 for invalid credentials per FR-021)
- [x] T080 [P] [US2] Contract test for POST /auth/logout in backend/tests/contract/auth.test.ts (verify 200, session invalidated per FR-023)
- [x] T081 [P] [US2] Contract test for GET /auth/me in backend/tests/contract/auth.test.ts (verify 200 with user info, 401 when not authenticated per FR-021)
- [x] T082 [P] [US2] Contract test for POST /admin/events in backend/tests/contract/admin.test.ts (verify 201 for admin user, 403 for customer/unauthenticated per FR-011, FR-013)
- [x] T083 [P] [US2] Contract test for PATCH /admin/events/:eventId in backend/tests/contract/admin.test.ts (verify 200 for admin owner, 403 for non-admin per FR-011)
- [x] T084 [P] [US2] Contract test for POST /admin/events/:eventId/publish in backend/tests/contract/admin.test.ts (verify 200 status change to PUBLISHED, event visible in customer event list per FR-011)
- [x] T085 [P] [US2] Contract test for GET /admin/dashboard/stats in backend/tests/contract/admin.test.ts (verify 200 with real-time metrics, 403 for non-admin per FR-014, FR-025)

### Integration Tests for User Story 2 (TDD - Write FIRST)

- [x] T086 [P] [US2] Integration test for event creation workflow in backend/tests/integration/eventCreation.test.ts (admin login → create event → verify draft status → publish → verify customer visibility per acceptance scenarios)
- [x] T087 [P] [US2] E2E test for admin event creation in frontend/tests/integration/adminEventCreation.spec.ts using Playwright (login as admin → create event form → submit → verify success → publish → verify in customer event list)

### Backend Implementation for User Story 2

- [x] T088 [P] [US2] Implement backend/src/services/AuthService.ts with methods: register(email, name, password, userType), login(email, password), logout(sessionToken), getCurrentUser(sessionToken) per FR-021
- [x] T089 [P] [US2] Implement password hashing in AuthService using bcrypt (hash passwords before storage per FR-022)
- [x] T090 [US2] Implement session creation in AuthService (generate token, store in Redis + Session table, set 24-hour expiration per FR-023)
- [x] T091 [US2] Implement session validation in backend/src/middleware/auth.ts (check Redis/database, verify expiration, refresh expiration on activity per FR-023)
- [x] T092 [P] [US2] Implement backend/src/services/AdminEventService.ts with methods: createEvent(adminId, eventData), updateEvent(eventId, adminId, updates), publishEvent(eventId, adminId) per FR-011
- [x] T093 [US2] Add validation in AdminEventService.createEvent for capacity (1-100000), price (>=0), date (future) per FR-012
- [x] T094 [US2] Add RBAC check in AdminEventService methods (verify adminId matches organizer_id for update/publish operations)
- [x] T095 [US2] Implement POST /auth/register route in backend/src/api/routes/auth.ts with email validation, duplicate check, user creation
- [x] T096 [US2] Implement POST /auth/login route in backend/src/api/routes/auth.ts with credential verification, session creation, Set-Cookie header (HttpOnly, Secure, SameSite=Strict)
- [x] T097 [US2] Implement POST /auth/logout route in backend/src/api/routes/auth.ts with session deletion from Redis + database
- [x] T098 [US2] Implement GET /auth/me route in backend/src/api/routes/auth.ts with requireAuth middleware, return user info (id, email, name, user_type)
- [x] T099 [US2] Implement POST /admin/events route in backend/src/api/routes/admin.ts with requireAdmin middleware, input validation, event creation in DRAFT status
- [x] T100 [US2] Implement PATCH /admin/events/:eventId route in backend/src/api/routes/admin.ts with requireAdmin middleware, ownership verification, update event
- [x] T101 [US2] Implement POST /admin/events/:eventId/publish route in backend/src/api/routes/admin.ts with requireAdmin middleware, status change to PUBLISHED
- [x] T102 [US2] Implement GET /admin/dashboard/stats route in backend/src/api/routes/admin.ts with requireAdmin middleware, aggregate metrics (total capacity, tickets sold, remaining per FR-014)
- [x] T103 [US2] Add validation in backend/src/api/validators/adminValidators.ts for event creation (name max 255, capacity range, price decimal, date ISO8601 future)
- [x] T104 [US2] Add error handling for 403 Forbidden when non-admin accesses admin routes (enforce in requireAdmin middleware per FR-013)
- [x] T105 [US2] Add logging for admin operations (event_created, event_published, event_updated with admin_id, event_id)

### Frontend Implementation for User Story 2

- [x] T106 [P] [US2] Create frontend/src/pages/auth/Register.tsx with registration form (email, name, password, confirm password)
- [x] T107 [P] [US2] Create frontend/src/pages/auth/Login.tsx with login form (email, password), redirect to admin dashboard if user_type=ADMIN
- [x] T108 [P] [US2] Create frontend/src/components/ProtectedRoute.tsx wrapper requiring authentication, redirecting to login if not authenticated
- [x] T109 [P] [US2] Create frontend/src/components/AdminRoute.tsx wrapper requiring admin role, showing 403 error for non-admins
- [x] T110 [US2] Implement frontend/src/pages/admin/CreateEvent.tsx with form (name, date, venue, capacity, ticket_price) and validation matching backend validators
- [x] T111 [US2] Implement frontend/src/pages/admin/Dashboard.tsx displaying real-time stats from GET /admin/dashboard/stats (total capacity, sold, remaining, auto-refresh every 5 seconds per ADR-004)
- [x] T112 [US2] Add event list in Dashboard showing admin's events with Edit and Publish buttons
- [x] T113 [US2] Create frontend/src/services/authService.ts wrapper for auth API calls (register, login, logout, getCurrentUser)
- [x] T114 [US2] Create frontend/src/services/adminService.ts wrapper for admin API calls (createEvent, updateEvent, publishEvent, getDashboardStats)
- [x] T115 [US2] Update useAuth hook in frontend/src/hooks/useAuth.tsx to handle login/logout, store user state, check admin role
- [x] T116 [US2] Add form validation in CreateEvent page (capacity 1-100000, price >=0, date future, all fields required)
- [x] T117 [US2] Add success/error notifications in CreateEvent page after form submission
- [x] T118 [US2] Add polling logic in Dashboard for real-time updates (useEffect with 5-second interval, cleanup on unmount)

**Checkpoint**: User Story 2 complete - Admins can create and publish events ✅

---

## Phase 6: User Story 4 - Customer Views Purchase History (Priority: P3)

**Goal**: Enable customers to view past purchases and re-download QR codes

**Independent Test**: Purchase tickets as customer, login, verify purchase history displays correct tickets with downloadable QR codes

### Contract Tests for User Story 4 (TDD - Write FIRST)

- [x] T119 [P] [US4] Contract test for GET /tickets/my in backend/tests/contract/tickets.test.ts (verify 200 with customer's tickets ordered by event date, 401 when not authenticated per FR-017)

### Integration Tests for User Story 4 (TDD - Write FIRST)

- [x] T120 [P] [US4] Integration test for purchase history in backend/tests/integration/purchaseHistory.test.ts (create customer, purchase multiple tickets for different events, verify GET /tickets/my returns all tickets with correct details per FR-017)
- [x] T121 [P] [US4] E2E test for customer viewing history in frontend/tests/integration/customerHistory.spec.ts using Playwright (login → navigate to My Tickets → verify tickets display → click ticket → verify QR code and details)

### Implementation for User Story 4

- [x] T122 [US4] Implement backend/src/services/TicketService.ts method: getCustomerTickets(customerId) returning tickets with event details, ordered by event date per FR-017
- [x] T123 [US4] Add ticket expiration logic in TicketService: mark ticket as EXPIRED when event.date + 1 hour < NOW() per FR-018
- [x] T124 [US4] Implement GET /tickets/my route in backend/src/api/routes/tickets.ts with requireAuth middleware (customer or admin), call TicketService.getCustomerTickets
- [x] T125 [P] [US4] Create frontend/src/pages/customer/MyTickets.tsx displaying list of tickets grouped by event, show event name, date, venue, ticket count
- [x] T126 [US4] Create frontend/src/pages/customer/TicketDetail.tsx showing single ticket with full QR code, event details, purchase timestamp, expired badge if applicable per FR-018
- [x] T127 [US4] Update frontend/src/services/ticketService.ts with getMyTickets() method calling GET /tickets/my
- [x] T128 [US4] Add navigation link to "My Tickets" in customer navbar (only visible when authenticated)
- [x] T129 [US4] Add redirect to login page when unauthenticated user accesses /my-tickets
- [x] T130 [US4] Add styling for expired tickets (grayed out QR code, "Expired" badge) in TicketDetail component
- [x] T131 [US4] Add download button for QR code image in TicketDetail component

**Checkpoint**: User Story 4 complete - Customers can view purchase history and access tickets ✅

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T132 [P] Create docs/user-guides/customers/how-to-purchase-tickets.md with screenshots and step-by-step instructions
- [x] T133 [P] Create docs/user-guides/organizers/how-to-create-events.md with admin portal walkthrough
- [x] T134 [P] Create docs/architecture/decisions/ADR-001-monolith-architecture.md from research.md
- [x] T135 [P] Create docs/architecture/decisions/ADR-002-synchronous-ticket-issuance.md from research.md
- [x] T136 [P] Create docs/architecture/decisions/ADR-003-server-side-qr-generation.md from research.md
- [x] T137 [P] Create docs/architecture/decisions/ADR-004-polling-over-websockets.md from research.md
- [x] T138 [P] Add API response time monitoring to all routes (middleware logging request duration, sending to Prometheus per FR-025, FR-026)
- [x] T139 [P] Add unit tests for EventService in backend/tests/unit/eventService.test.ts (test listPublishedEvents, getEventById)
- [x] T140 [P] Add unit tests for TicketService in backend/tests/unit/ticketService.test.ts (test createTicketsAfterPayment, getCustomerTickets)
- [x] T141 [P] Add unit tests for QRService in backend/tests/unit/qrService.test.ts (test JWT generation, signature verification)
- [x] T142 [P] Add unit tests for AuthService in backend/tests/unit/authService.test.ts (test register, login, password hashing)
- [x] T143 Code cleanup: Remove console.log statements, add JSDoc comments to all public methods
- [x] T144 Security audit: Add rate limiting to login endpoint (5 attempts per 15 minutes), add CSRF token to forms
- [x] T145 Performance optimization: Add Redis caching for GET /events endpoint (5-minute TTL), invalidate on event publish
- [x] T146 Performance optimization: Add database query optimization (ensure indexes on foreign keys, analyze slow query log)
- [x] T147 Run through quickstart.md setup guide on fresh environment to validate instructions
- [x] T148 Create backend/README.md with architecture overview, how to run tests, deployment instructions
- [x] T149 Create frontend/README.md with component structure, how to run development server, build process
- [x] T150 Add GDPR data deletion endpoint POST /customers/:customerId/delete-data in backend/src/api/routes/customers.ts (anonymize customer PII, preserve financial records per FR-027, FR-028)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phases 3-6)**: All depend on Foundational phase completion
  - **US1 (Phase 3)**: Can start after Foundational - No dependencies on other stories
  - **US3 (Phase 4)**: Can start after Foundational - Enhances US1 with concurrency safety (logical dependency but can be developed in parallel)
  - **US2 (Phase 5)**: Can start after Foundational - Independent from US1/US3 (admin portal separate from customer purchase)
  - **US4 (Phase 6)**: Depends on US1 completion (needs ticket data from purchases) and US2 (needs auth system)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Priority Order (for sequential development)

1. **User Story 1 (P1)**: Customer purchase flow - Core revenue generation
2. **User Story 3 (P1)**: Capacity enforcement - Critical for preventing overselling
3. **User Story 2 (P2)**: Event creation - Enables organizers to list events
4. **User Story 4 (P3)**: Purchase history - Nice-to-have, can be deferred if time-constrained

### Within Each User Story (TDD Workflow)

1. **Write contract tests FIRST** → Ensure they FAIL (Red)
2. **Write integration tests** → Ensure they FAIL (Red)
3. **Implement backend models and services** → Tests start passing (Green)
4. **Implement API routes** → Contract tests pass (Green)
5. **Implement frontend components** → E2E tests pass (Green)
6. **Refactor and optimize** → Tests still pass (Refactor)
7. Story complete when all tests pass and acceptance scenarios verified

### Parallel Opportunities

#### Setup Phase (Phase 1)

All tasks marked [P] can run in parallel:

- T004, T005 (backend/frontend initialization)
- T006, T007, T008 (linting, testing setup)

#### Foundational Phase (Phase 2)

All Prisma model definitions can run in parallel (T013-T018), then migration (T020) depends on all models complete.

#### User Story 1 (Phase 3)

- **Contract tests**: T036, T037, T038, T039 can all run in parallel (different test files)
- **Integration tests**: T040, T041, T042 can run in parallel
- **Backend services**: T043, T044 can run in parallel (EventService, PaymentService are independent)
- **Frontend components**: T057, T058, T059 can run in parallel (different component files)

#### User Story 3 (Phase 4)

- **Tests**: T069, T070 can run in parallel

#### User Story 2 (Phase 5)

- **Contract tests**: T078-T085 can all run in parallel (8 test files)
- **Integration tests**: T086, T087 can run in parallel
- **Backend services**: T088, T092 can run in parallel (AuthService, AdminEventService)
- **Frontend pages**: T106, T107, T108, T109 can run in parallel (auth and admin routes)

#### User Story 4 (Phase 6)

- **Tests**: T119, T120, T121 can run in parallel

#### Polish Phase (Phase 7)

- **Documentation**: T132-T137 can all run in parallel (independent markdown files)
- **Unit tests**: T139-T142 can all run in parallel (different service test files)

### Team Parallel Example (3 developers)

**Week 1**: Setup + Foundational (all together)

- Day 1-2: Setup (T001-T010)
- Day 3-5: Foundational (T011-T035)

**Week 2-3**: User Story 1 (parallel work)

- **Dev 1**: Backend (T043-T056) - Services and API routes
- **Dev 2**: Frontend (T057-T068) - Customer pages and components
- **Dev 3**: Tests (T036-T042) - Write tests FIRST, validate as Dev 1/2 implement

**Week 4**: User Story 3 (parallel work)

- **Dev 1**: Backend concurrency logic (T071-T074)
- **Dev 2**: Frontend capacity UI (T075-T076)
- **Dev 3**: Load testing (T069-T070)

**Week 5-6**: User Story 2 (parallel work)

- **Dev 1**: Backend auth + admin (T088-T105)
- **Dev 2**: Frontend admin portal (T106-T118)
- **Dev 3**: Tests (T078-T087)

**Week 7**: User Story 4 (can be 1-2 developers)

- **Dev 1**: Backend + Frontend (T122-T131)
- **Dev 2**: Tests (T119-T121)

**Week 8**: Polish (parallel work)

- **All devs**: Documentation, unit tests, optimization (T132-T150)

---

## Implementation Strategy

### MVP Scope (Minimum Viable Product)

**MVP = User Story 1 + User Story 3** (Both P1)

This MVP delivers:

- ✅ Customers can purchase tickets online through Stripe
- ✅ QR codes are generated and emailed
- ✅ Capacity enforcement prevents overselling
- ✅ Core revenue-generating functionality

**Deferred for v2**:

- User Story 2 (Event creation) - Use database seeding for initial events
- User Story 4 (Purchase history) - Customers only get QR via email initially

### Incremental Delivery

1. **Sprint 1** (Weeks 1-3): Setup + Foundational + US1 → Customers can purchase tickets
2. **Sprint 2** (Week 4): US3 → Capacity enforcement under load
3. **Sprint 3** (Weeks 5-6): US2 → Admin event creation portal
4. **Sprint 4** (Week 7): US4 → Customer purchase history
5. **Sprint 5** (Week 8): Polish → Production-ready

### Validation After Each Phase

- **After US1**: Run contract tests, purchase test ticket end-to-end, verify QR in email
- **After US3**: Run load test (10 concurrent requests for 5-capacity event), verify 5 succeed
- **After US2**: Login as admin, create event, verify customers see it, verify 403 for non-admin
- **After US4**: Purchase tickets, login, verify history displays all tickets
- **After Polish**: Run full quickstart.md setup, run all tests, verify metrics dashboard

### Total Estimated Tasks: 150

- Setup: 10 tasks
- Foundational: 25 tasks
- User Story 1: 33 tasks (11 tests + 22 implementation)
- User Story 3: 9 tasks (2 tests + 7 implementation)
- User Story 2: 41 tasks (10 tests + 31 implementation)
- User Story 4: 13 tasks (3 tests + 10 implementation)
- Polish: 19 tasks

### Test Coverage Summary

- **Contract tests**: 19 tests (API endpoint validation against OpenAPI spec)
- **Integration tests**: 7 tests (End-to-end user journeys, payment flow, capacity enforcement)
- **E2E tests**: 3 tests (Frontend Playwright tests)
- **Unit tests**: 4 test suites (Service layer tests in Polish phase)
- **Total test tasks**: 33 (22% of total tasks - strong TDD adherence per Constitution Principle III)

### Parallel Task Summary

- Tasks marked [P]: 62 parallelizable tasks (41% can run in parallel with proper team coordination)
- Critical path (sequential): Foundational → US1 backend → US1 frontend → US3 → US2 → US4
- With 3 developers: ~8 weeks to complete all user stories + polish
- With 1 developer (sequential): ~12-14 weeks

---

## Suggested MVP Implementation Order

For fastest time-to-value, implement in this order:

1. **Phase 1: Setup** (T001-T010) - 1-2 days
2. **Phase 2: Foundational** (T011-T035) - 3-5 days
3. **Phase 3: User Story 1** (T036-T068) - 1-2 weeks
4. **Phase 4: User Story 3** (T069-T077) - 3-5 days

**STOP HERE FOR MVP LAUNCH** ✅

Then continue with:

5. **Phase 5: User Story 2** (T078-T118) - 1-2 weeks
6. **Phase 6: User Story 4** (T119-T131) - 3-5 days
7. **Phase 7: Polish** (T132-T150) - 1 week

This approach gets core ticket purchasing live in **2-3 weeks**, validates revenue generation, then adds admin portal and history viewing based on user feedback.
