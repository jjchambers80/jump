# Tasks: Schema Redesign — MVP Data Architecture

**Branch**: `003-schema-redesign`
**Input**: Design documents from `/specs/003-schema-redesign/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story per Constitution Principle III (TDD).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4, US5, US6, US7)
- Include exact file paths in descriptions

## Path Conventions

This is a web application monorepo with:

- **Shared DB**: `packages/db/` (@jump/db workspace package)
- **Backend**: `backend/src/`, `backend/tests/`
- **Frontend**: `frontend/src/`, `frontend/tests/`
- **Documentation**: `docs/`

---

## Phase 1: Setup (Monorepo & Shared Package)

**Purpose**: Configure npm workspaces, create packages/db, update root package.json, prepare environment

- [x] T001 Update root package.json to add npm workspaces configuration: `"workspaces": ["packages/*", "backend", "frontend"]` and add root scripts `db:generate`, `db:migrate`, `db:seed`, `db:studio`, `dev:backend`, `dev:frontend` per quickstart.md
- [x] T002 Create packages/db/package.json for @jump/db workspace package with `prisma`, `@prisma/client`, `tsup` as dependencies, `postinstall` script for prisma generate, and `main`/`types` entries pointing to dist/ per quickstart.md
- [x] T003 [P] Create packages/db/tsconfig.json with ES2022 target, NodeNext module, strict mode per quickstart.md
- [x] T004 [P] Create packages/db/tsup.config.ts with ESM format, dts generation, entry point index.ts per quickstart.md
- [x] T005 Create packages/db/index.ts exporting PrismaClient singleton (globalThis pattern) and re-exporting all generated types from ./generated/client per quickstart.md
- [x] T006 [P] Create packages/db/.env with DATABASE_URL for PostgreSQL per quickstart.md
- [x] T007 [P] Update .gitignore to exclude packages/db/generated/, packages/db/dist/, and packages/db/node_modules/
- [x] T008 [P] Create .env.example files: packages/db/.env.example (DATABASE_URL), frontend/.env.local.example (AUTH_SECRET, AUTH_RESEND_KEY, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, DATABASE_URL), backend/.env.example (AUTH_SECRET, DATABASE_URL, REDIS_URL, STRIPE_SECRET_KEY, RESEND_API_KEY)

**Checkpoint**: Monorepo workspace structure ready for schema and dependency installation

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Prisma schema, migration, Auth.js config, JWT middleware rewrite, RBAC rewrite, Resend config — MUST be complete before ANY user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Database Schema & Migration

- [x] T009 Move backend/prisma/schema.prisma to packages/db/prisma/schema.prisma and delete backend/prisma/migrations/ directory (wipe-and-reseed per research.md R4)
- [x] T010 Define Prisma enums in packages/db/prisma/schema.prisma: UserRole (CUSTOMER, ORGANIZER, ADMIN), OrganizationStatus (ACTIVE, INACTIVE), EventStatus (DRAFT, PUBLISHED, CANCELLED), OrderStatus (PENDING, COMPLETED, FAILED), TicketStatus (VALID, REDEEMED, EXPIRED, VOIDED), PaymentStatus (PENDING, SUCCEEDED, FAILED)
- [x] T011 [P] Define User model in packages/db/prisma/schema.prisma per data-model.md (id cuid, email unique, emailVerified, name, image, firstName, lastName, role UserRole default CUSTOMER, organizationId FK, isActive, deletedAt, accounts relation, contacts relation, organization relation, indexes on organizationId/role/email)
- [x] T012 [P] Define Account model in packages/db/prisma/schema.prisma per data-model.md (Auth.js compatible — id cuid, userId FK cascade, type, provider, providerAccountId, OAuth token fields, unique on provider+providerAccountId)
- [x] T013 [P] Define VerificationToken model in packages/db/prisma/schema.prisma per data-model.md (identifier, token, expires, composite unique on identifier+token)
- [x] T014 [P] Define Organization model in packages/db/prisma/schema.prisma per data-model.md (id cuid, name, status OrganizationStatus default ACTIVE, venues/users relations)
- [x] T015 [P] Define Venue model in packages/db/prisma/schema.prisma per data-model.md (id cuid, organizationId FK, name, address, timezone default America/New_York, isPublic, events relation, index on organizationId)
- [x] T016 [P] Define Contact model in packages/db/prisma/schema.prisma per data-model.md (id cuid, email unique, firstName, lastName, userId FK optional onDelete SetNull, orders/tickets relations, indexes on userId/email)
- [x] T017 [P] Define Event model in packages/db/prisma/schema.prisma per data-model.md (id cuid, venueId FK, name, description optional, date, capacity, category optional, status EventStatus default DRAFT, priceTiers/orders/tickets relations, indexes on venueId/status/date)
- [x] T018 [P] Define PriceTier model in packages/db/prisma/schema.prisma per data-model.md (id cuid, eventId FK, name, price Decimal(10,2), quantityTotal, quantitySold default 0, quantityReserved default 0, displayOrder default 0, minPerOrder optional, maxPerOrder optional, isActive default true, tickets relation, indexes on eventId and eventId+isActive)
- [x] T019 [P] Define Order model in packages/db/prisma/schema.prisma per data-model.md (id cuid, eventId FK, contactId FK, stripeSessionId unique optional, orderRef unique, totalAmount Decimal(10,2), currency default usd, quantity, status OrderStatus default PENDING, tickets/payment relations, indexes on eventId/contactId/status/orderRef)
- [x] T020 [P] Define Ticket model in packages/db/prisma/schema.prisma per data-model.md (id cuid, orderId FK, eventId FK denormalized, priceTierId FK, contactId FK, pricePaid Decimal(10,2), barcode unique, qrCodeJwt optional, status TicketStatus default VALID, redeemedAt optional, indexes on orderId/eventId/priceTierId/contactId/barcode/status)
- [x] T021 [P] Define PaymentTransaction model in packages/db/prisma/schema.prisma per data-model.md (id cuid, orderId FK unique, stripePaymentIntentId unique optional, amount Decimal(10,2), currency default usd, status PaymentStatus default PENDING, failureReason optional, createdAt only — NO updatedAt per constitution append-only rule, indexes on orderId/status)
- [x] T022 Configure Prisma generator in packages/db/prisma/schema.prisma with custom output path ../generated/client per quickstart.md
- [x] T023 Run npm install from repo root to link workspaces, then run npm run db:generate and npm run db:migrate -- --name init_schema_redesign
- [x] T024 Create packages/db/prisma/seed.ts with sample data: 1 organization, 2 venues, 1 admin user, 2 organizer users, 2 customer users, 3 events (1 DRAFT, 2 PUBLISHED each with 2-3 price tiers), 2 contacts, 1 completed order with tickets per data-model.md

### Auth.js Configuration (Frontend)

- [x] T025 Install Auth.js dependencies in frontend/: `next-auth@beta`, `@auth/prisma-adapter`, `resend` per quickstart.md
- [x] T026 Add `@jump/db: "*"` to frontend/package.json dependencies and run npm install from repo root
- [x] T027 [P] Create frontend/src/auth.config.ts with edge-safe Auth.js config: Resend provider (magic link) and Google provider, no Prisma references per research.md R1
- [x] T028 Create frontend/src/auth.ts with full Auth.js config: PrismaAdapter(@jump/db), JWT strategy, custom HS256 encode/decode using jsonwebtoken (sub, email, role, name in payload), session callback populating role from DB, signIn callback for Contact↔User linking (FR-006) per research.md R1
- [x] T029 Create frontend/middleware.ts importing from auth.config.ts for edge-compatible route protection per research.md R1
- [x] T030 Create frontend/src/app/api/auth/[...nextauth]/route.ts exporting GET and POST handlers from auth.ts

### Backend Auth Rewrite

- [x] T031 Update backend/package.json to add `@jump/db: "*"` dependency, remove `@prisma/client` and `bcrypt` direct dependencies, add `jsonwebtoken` if not present
- [x] T032 Rewrite backend/src/middleware/auth.js to verify Auth.js HS256 JWT tokens from Authorization Bearer header using jsonwebtoken.verify(token, AUTH_SECRET, { algorithms: ['HS256'] }), attach decoded user (sub, email, role, name) to req.user
- [x] T033 Rewrite backend/src/middleware/rbac.js to use req.user.role from JWT claims: requireRole(...roles) middleware factory, requireOrganizer, requireAdmin, requireAuth convenience exports per FR-004
- [x] T034 Remove backend/src/api/routes/auth.js (login/register routes replaced by Auth.js in frontend)
- [x] T035 Remove backend/src/services/AuthService.js (session-based auth replaced by JWT verification)

### Email & Config Updates

- [x] T036 Create backend/src/config/resend.js initializing Resend SDK with RESEND_API_KEY environment variable per research.md R3
- [x] T037 Remove backend/src/config/sendgrid.js (replaced by resend.js per plan.md)
- [x] T038 Update backend/src/services/EmailService.js to import from resend.js instead of sendgrid.js, use Resend API for sending emails with fire-and-forget + background retry pattern per FR-036, FR-037, research.md R3

### Backend Model Imports Update

- [x] T039 Update all backend service and route files to import PrismaClient from @jump/db instead of local @prisma/client (search-and-replace across backend/src/)

**Checkpoint**: Foundation ready — Prisma schema migrated, Auth.js configured, JWT middleware rewritten, email switched to Resend. User story implementation can now begin in parallel.

---

## Phase 3: User Story 4 — Organizer Manages Organizations & Venues (Priority: P2, but foundational for US1) 🏗️

**Goal**: Enable organizers to create organizations and register venues — required infrastructure before events can be created with venue FK

**Independent Test**: Create an organization, add two venues, verify both appear in venue listing scoped to that organization

**Why before P1 stories**: Events require a venueId FK → venues require an organizationId FK → org/venue CRUD must exist first

### Contract Tests for User Story 4

- [x] T040 [P] [US4] Contract test for organization endpoints (GET/POST /organizations, GET/PATCH /organizations/:id) in backend/tests/contract/organizations.test.js — verify admin-only access, 201 on create, scoping per FR-048
- [x] T041 [P] [US4] Contract test for venue endpoints (GET/POST /organizations/:orgId/venues, GET/PATCH/DELETE /organizations/:orgId/venues/:id) in backend/tests/contract/venues.test.js — verify org-scoped access, 409 on delete with linked events per FR-049, FR-010

### Implementation for User Story 4

- [x] T042 [P] [US4] Implement backend/src/services/OrganizationService.js with methods: createOrganization(data), getOrganizationById(id), listOrganizations(), updateOrganization(id, data) per FR-048
- [x] T043 [P] [US4] Implement backend/src/services/VenueService.js with methods: createVenue(orgId, data), getVenueById(orgId, id), listVenuesByOrganization(orgId), updateVenue(orgId, id, data), deleteVenue(orgId, id) with linked-event guard per FR-049, FR-010
- [x] T044 [US4] Create backend/src/api/routes/organizations.js with GET / (admin), POST / (admin), GET /:id (admin), PATCH /:id (admin) using OrganizationService and requireAdmin middleware per contracts/api.yaml
- [x] T045 [US4] Create backend/src/api/routes/venues.js with GET /organizations/:orgId/venues (org-scoped), POST (org-scoped), GET /:id (org-scoped), PATCH /:id (org-scoped), DELETE /:id (org-scoped) using VenueService and requireOrganizer middleware per contracts/api.yaml
- [x] T046 [US4] Create backend/src/api/validators/organizationValidators.js with validation for name (required string), status per FR-048
- [x] T047 [US4] Create backend/src/api/validators/venueValidators.js with validation for name, address (required), timezone (valid IANA), isPublic per FR-049
- [x] T048 [US4] Register organization and venue routes in backend/src/api/server.js
- [x] T049 [P] [US4] Create frontend/src/app/dashboard/organizations/page.tsx with organization list and create form (admin-only) per FR-038
- [x] T050 [P] [US4] Create frontend/src/app/dashboard/venues/page.tsx with venue list, create/edit form scoped to selected organization per FR-039
- [x] T051 [US4] Add organization selector component in frontend/src/components/OrganizationSelector.tsx for organizer dashboard navigation per FR-038

**Checkpoint**: Organizations and venues are manageable. Venue selector is available for event creation in US1.

---

## Phase 4: User Story 1 — Organizer Creates Events with Price Tiers (Priority: P1) 🎯 MVP

**Goal**: Enable organizers to create events at venues with multiple price tiers, validate capacity constraints, and publish events

**Independent Test**: Create an organization, a venue, and an event with 3 price tiers, verify capacity validation, publish event, confirm it appears in public listings with pricing

### Contract Tests for User Story 1

- [x] T052 [P] [US1] Contract test for event endpoints in backend/tests/contract/events.test.js — replace existing tests: GET /events (public, published only), GET /events/:id (public), POST /organizations/:orgId/events (org-scoped, 201), PATCH (org-scoped), POST publish (status DRAFT→PUBLISHED), POST cancel (PUBLISHED→CANCELLED) per FR-050
- [x] T053 [P] [US1] Contract test for price tier endpoints in backend/tests/contract/priceTiers.test.js — POST /events/:id/price-tiers (201, capacity validation 422), GET (public), PATCH, activate/deactivate, reorder per FR-051, FR-015

### Implementation for User Story 1

- [x] T054 [US1] Update backend/src/services/EventService.js: replace flat event model with venue FK, add createEvent(orgId, data) with venueId validation, updateEvent(orgId, eventId, data) with capacity floor check, publishEvent(eventId) status transition DRAFT→PUBLISHED, cancelEvent(eventId) with ticket holder notification, listPublishedEvents() with venue join, getEventById(id) with venue and price tiers per FR-012, FR-013
- [x] T055 [US1] Remove backend/src/services/AdminEventService.js (merged into EventService per plan.md)
- [x] T056 [US1] Create backend/src/services/PriceTierService.js with methods: createPriceTier(eventId, data) with capacity sum validation, updatePriceTier(id, data), activatePriceTier(id), deactivatePriceTier(id), reorderPriceTiers(eventId, orderedIds), listPriceTiers(eventId) per FR-014, FR-015, FR-016, FR-017
- [x] T057 [US1] Update backend/src/api/routes/events.js: replace existing routes with GET /events (public, published), GET /events/:id (public with venue+tiers), GET /organizations/:orgId/events (org-scoped), POST /organizations/:orgId/events (org-scoped), PATCH /organizations/:orgId/events/:id (org-scoped), POST .../events/:id/publish (org-scoped), POST .../events/:id/cancel (org-scoped) per contracts/api.yaml
- [x] T058 [US1] Create backend/src/api/routes/priceTiers.js with GET .../events/:id/price-tiers (public), POST (org-scoped), PATCH .../price-tiers/:id (org-scoped), POST activate/deactivate (org-scoped), POST reorder (org-scoped) per contracts/api.yaml
- [x] T059 [US1] Create backend/src/api/validators/eventValidators.js with validation: venueId (required cuid), name (required), date (required, future), capacity (required, 1–100000), category (optional string) per FR-012
- [x] T060 [US1] Create backend/src/api/validators/priceTierValidators.js with validation: name (required), price (>= 0 decimal), quantityTotal (> 0), displayOrder (int), minPerOrder/maxPerOrder (optional int) per FR-014, FR-016
- [x] T061 [US1] Register price tier routes in backend/src/api/server.js
- [x] T062 [US1] Update frontend/src/app/events/ pages to display price tier options on event detail page per FR-041
- [x] T063 [US1] Update event creation form in frontend to include venue selector dropdown (from VenueService), capacity field, and price tier builder (add/remove/reorder tiers with name, price, quantity, min/max per order) per FR-040
- [x] T064 [US1] Update frontend/src/app/dashboard/events/ pages to show per-tier inventory in event management view

**Checkpoint**: Events can be created with venues and price tiers, published, and browsed publicly. US2 (purchasing) can now proceed.

---

## Phase 5: User Story 2 — Customer Purchases Tickets (Priority: P1) 🎯 MVP

**Goal**: Enable guest and authenticated customers to purchase tickets from specific price tiers, with atomic inventory management, order grouping, and confirmation email via Resend

**Independent Test**: Select a published event, choose a price tier and quantity, complete guest checkout with name/email, verify order created with COMPLETED status, tickets issued with QR codes, confirmation email sent, inventory decremented

### Contract Tests for User Story 2

- [x] T065 [P] [US2] Contract test for POST /orders in backend/tests/contract/orders.test.js — verify 201 with order and Stripe session, 422 for invalid tier/quantity, 409 for insufficient inventory per FR-052
- [x] T066 [P] [US2] Contract test for GET /orders/:id, POST /orders/lookup, GET /orders/my, GET /events/:id/orders in backend/tests/contract/orders.test.js per FR-053, FR-054

### Integration Tests for User Story 2

- [x] T067 [P] [US2] Integration test for full purchase flow in backend/tests/integration/purchaseFlow.test.js — replace existing: order creation → Stripe webhook → order COMPLETED → tickets issued with barcodes + QR JWTs → PriceTier.quantitySold incremented → confirmation email sent per FR-023, FR-025, FR-026, FR-036
- [x] T068 [P] [US2] Integration test for capacity enforcement in backend/tests/integration/capacityEnforcement.test.js — replace existing: concurrent purchases against same tier, verify no overselling (quantitySold + quantityReserved ≤ quantityTotal), reservation timeout at 30 min per FR-026, FR-027

### Implementation for User Story 2

- [x] T069 [US2] Create backend/src/services/OrderService.js with methods: createOrder(eventId, contactData, items[{priceTierId, quantity}]) using Prisma transaction for atomic Contact upsert + Order create + PriceTier inventory reservation + Stripe session creation, getOrderById(id), getOrdersByContact(contactId), getOrdersByEvent(eventId), lookupOrder(email, orderRef) per FR-023, FR-024, FR-052, FR-053, FR-054
- [x] T070 [US2] Generate unique orderRef in OrderService (format: JMP-XXXXXX alphanumeric) for guest lookup per FR-054
- [x] T071 [US2] Update backend/src/services/PaymentService.js: refactor to create Stripe Checkout session linked to Order (not individual ticket), handle webhook for order status transition PENDING→COMPLETED or PENDING→FAILED, release reserved inventory on failure, idempotent duplicate webhook handling per FR-024, FR-028, FR-029
- [x] T072 [US2] Update backend/src/services/TicketService.js: createTicketsForOrder(orderId) to create individual Ticket records per item with priceTierId, contactId, pricePaid snapshot, unique barcode generation, QR JWT generation, update PriceTier.quantitySold (move from quantityReserved to quantitySold) per FR-025, FR-030, FR-031
- [x] T073 [US2] Implement barcode generation utility in backend/src/utils/barcode.js — generate unique human-readable barcodes (e.g., JUMP-XXXXXXXXXXXX) per FR-031
- [x] T074 [US2] Update backend/src/services/QRService.js: update JWT payload to include { sub: ticketId, eventId, barcode, iat, exp } signed with HS256 using AUTH_SECRET per FR-030, data-model.md
- [x] T075 [US2] Update backend/src/services/EmailService.js: add sendOrderConfirmation(order, tickets) method using Resend, include ticket QR codes as inline content, fire-and-forget with async retry queue per FR-036
- [x] T076 [US2] Add sendCancellationNotification(event, tickets) method to EmailService for event cancellation notifications per FR-037
- [x] T077 [US2] Create backend/src/api/routes/orders.js with POST /orders (public — guest checkout), GET /orders/:id (owner/admin), POST /orders/lookup (public — email + orderRef), GET /orders/my (authenticated), GET /events/:id/orders (org-scoped) per contracts/api.yaml
- [x] T078 [US2] Update backend/src/api/routes/tickets.js: refactor existing purchase route to redirect through OrderService, update webhook handler route per contracts/api.yaml
- [x] T079 [US2] Create backend/src/api/validators/orderValidators.js with validation: eventId (required cuid), contact.email (required email), contact.firstName (required), contact.lastName (required), items array with priceTierId + quantity per FR-052
- [x] T080 [US2] Register order routes in backend/src/api/server.js
- [x] T081 [US2] Update frontend event detail page to show price tier selector with tier name, price, available count, and quantity input per FR-041
- [x] T082 [US2] Create guest checkout flow in frontend: inline name + email collection on purchase page without requiring sign-in per FR-042
- [x] T083 [US2] Update frontend purchase confirmation page to display order reference, ticket details with QR codes, and "save to email" prompt

**Checkpoint**: End-to-end purchase flow works for both guest and authenticated users. Tickets are issued with QR codes. Core revenue generation is functional.

---

## Phase 6: User Story 3 — Ticket Redemption at Venue (Priority: P1) 🎯 MVP

**Goal**: Enable door attendants to scan QR codes and validate/redeem tickets with lazy expiration evaluation

**Independent Test**: Generate a valid ticket QR code, scan it via the redemption endpoint, verify status changes to REDEEMED with timestamp — then scan again and verify rejection

### Contract Tests for User Story 3

- [x] T084 [P] [US3] Contract test for POST /tickets/redeem in backend/tests/contract/tickets.test.js — replace existing: verify 200 with green verdict for valid ticket, 409 for already-redeemed, 400 for invalid/forged QR, 403 for wrong event, 410 for expired (past event date) per FR-055, FR-032, FR-033, FR-034, FR-035

### Integration Tests for User Story 3

- [x] T085 [P] [US3] Integration test for redemption flow in backend/tests/integration/qrGeneration.test.js — replace existing: valid scan → REDEEMED + timestamp, duplicate scan → rejection with original time, expired ticket (event date passed) → lazy EXPIRED status update per FR-032, FR-034

### Implementation for User Story 3

- [x] T086 [US3] Update backend/src/services/TicketService.js: add redeemTicket(qrPayload, eventId) method with JWT verification, event association check, lazy expiration (if event.date < now → mark EXPIRED and reject), duplicate redemption check, atomic status VALID→REDEEMED + redeemedAt timestamp per FR-032, FR-033, FR-034, FR-035
- [x] T087 [US3] Update POST /tickets/redeem route in backend/src/api/routes/tickets.js to accept QR code JWT payload, call TicketService.redeemTicket, return verdict (valid/already-redeemed/expired/invalid/wrong-event) with appropriate HTTP status codes per contracts/api.yaml
- [x] T088 [US3] Update frontend scan/redemption UI to display color-coded verdict: green for valid redemption, red for rejection with reason (already redeemed with timestamp, expired, invalid, wrong event)

**Checkpoint**: Complete ticket lifecycle works: create → sell → redeem. Core MVP (US1 + US2 + US3) is fully functional.

---

## Phase 7: User Story 5 — User Authentication via Magic Link & Google (Priority: P2)

**Goal**: Enable users to sign in via magic link or Google, with role-based access, and automatic Contact↔User linking for returning guests

**Independent Test**: Request a magic link, click it, verify signed in with CUSTOMER role. Sign in with Google, verify profile linked. Check that a user who previously purchased as guest sees their past orders after signing up with the same email.

### Contract Tests for User Story 5

- [x] T089 [P] [US5] Contract test for user management endpoints (GET /users, PATCH /users/:id) in backend/tests/contract/users.test.js — verify admin-only access, role update, deactivation per FR-056

### Implementation for User Story 5

- [x] T090 [US5] Create backend/src/services/UserService.js with methods: listUsers(filters), updateUser(id, data) for role changes and deactivation per FR-056
- [x] T091 [US5] Create backend/src/api/routes/users.js with GET /users (admin), PATCH /users/:id (admin) using UserService and requireAdmin middleware per contracts/api.yaml
- [x] T092 [US5] Create backend/src/api/validators/userValidators.js with validation: role (one of CUSTOMER, ORGANIZER, ADMIN), isActive (boolean) per FR-003, FR-056
- [x] T093 [US5] Register user routes in backend/src/api/server.js
- [x] T094 [US5] Create frontend/src/app/auth/signin/page.tsx with magic link email form and Google sign-in button per FR-045
- [x] T095 [US5] Update frontend/src/app/layout.tsx to wrap with Auth.js SessionProvider per plan.md
- [x] T096 [US5] Remove frontend/src/hooks/useAuth.tsx (replaced by next-auth/react useSession) per plan.md
- [x] T097 [US5] Remove frontend/src/services/authService.ts (replaced by next-auth/react signIn/signOut) per plan.md
- [x] T098 [US5] Implement Contact↔User linking in auth.ts signIn callback: when a user signs up, query Contact by matching email and set Contact.userId = newUser.id per FR-006
- [x] T099 [US5] Create frontend/src/app/dashboard/users/page.tsx with user list, role selector, activate/deactivate toggle (admin-only) per FR-046

**Checkpoint**: Authentication works via magic link and Google. Organizer and admin dashboards are access-controlled. Guest purchase history is linked on sign-up.

---

## Phase 8: User Story 6 — Customer Views Order History (Priority: P3)

**Goal**: Enable signed-in customers to view past orders with ticket details and QR codes, and guest lookup by email + order reference

**Independent Test**: Complete two purchases as an authenticated user, navigate to order history, verify both orders appear with correct details. Use guest lookup with email + orderRef and verify ticket QR codes are returned.

### Contract Tests for User Story 6

- [x] T100 [P] [US6] Contract test for GET /orders/my in backend/tests/contract/orders.test.js — verify authenticated response with order list, event details, ticket statuses per FR-053
- [x] T101 [P] [US6] Contract test for POST /orders/lookup in backend/tests/contract/orders.test.js — verify public access, returns order + tickets for valid email+orderRef, 404 for invalid (no enumeration) per FR-054

### Implementation for User Story 6

- [x] T102 [US6] Create frontend/src/app/orders/page.tsx with order history list for signed-in users: event name, date, quantity, totalAmount, status, link to view tickets per FR-043
- [x] T103 [US6] Create order detail view showing individual ticket QR codes for upcoming events, ticket statuses (VALID/REDEEMED/EXPIRED/VOIDED) per FR-043
- [x] T104 [US6] Create frontend/src/app/orders/lookup/page.tsx with guest order lookup form: email + orderRef inputs, display order details and ticket QR codes on match, generic "order not found" on miss (no enumeration) per FR-047
- [x] T105 [US6] Connect frontend order pages to GET /orders/my and POST /orders/lookup API endpoints

**Checkpoint**: Customers can access their purchase history and retrieve tickets. Guest lookup works without authentication.

---

## Phase 9: User Story 7 — Admin Dashboard with Event Analytics (Priority: P3)

**Goal**: Enable organizers and admins to view per-event and per-tier sales, revenue, and redemption metrics

**Independent Test**: Create an event with sales and redemptions, view the analytics endpoint, verify accurate per-tier sold/redeemed/remaining counts and revenue figures

### Contract Tests for User Story 7

- [x] T106 [P] [US7] Contract test for GET /events/:id/analytics in backend/tests/contract/analytics.test.js — verify org-scoped access, per-tier breakdown of sold/redeemed/remaining/revenue per FR-057

### Implementation for User Story 7

- [x] T107 [US7] Create analytics query in backend/src/services/EventService.js: getEventAnalytics(eventId) returning per-tier sold, redeemed, remaining (quantityTotal - quantitySold), revenue (quantitySold × price), plus event-level aggregates per FR-057
- [x] T108 [US7] Create GET .../events/:id/analytics route in backend/src/api/routes/events.js with org-scoped auth, calling EventService.getEventAnalytics per contracts/api.yaml
- [x] T109 [US7] Update frontend/src/app/dashboard/events/ pages to show per-tier sales breakdown table: tier name, price, sold, redeemed, remaining, revenue per FR-044
- [x] T110 [US7] Add organization and date range filtering to dashboard analytics view per US7 acceptance scenario 2

**Checkpoint**: Organizers have operational visibility into event performance with per-tier granularity.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Documentation updates, cleanup, validation, and security hardening

- [x] T111 [P] Update docs/architecture/data-models.md with new entity reference from data-model.md
- [x] T112 [P] Update docs/api/openapi.yaml and docs/api/README.md with new contracts from contracts/api.yaml
- [x] T113 [P] Update docs/development/setup.md with monorepo setup instructions from quickstart.md
- [x] T114 Remove stale backend files: backend/prisma/ directory (schema moved to packages/db), backend/src/models/ if present (Prisma generates types)
- [x] T115 Update backend/tests/setup.js to import PrismaClient from @jump/db instead of local client
- [x] T116 Run full test suite (backend unit + contract + integration) and fix any regressions
- [x] T117 Run frontend E2E tests (Playwright) and fix any regressions in updated pages
- [x] T118 Validate quickstart.md end-to-end: fresh clone → npm install → db:generate → db:migrate → db:seed → dev:backend → dev:frontend → verify running
- [x] T119 Security review: verify all org-scoped endpoints enforce organizationId check, all admin endpoints require ADMIN role, guest lookup returns generic errors (no enumeration)
- [x] T120 Update PROGRESS.md and docs with schema redesign completion status

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US4 Org & Venues (Phase 3)**: Depends on Foundational — BLOCKS US1 (events require venueId)
- **US1 Events & Tiers (Phase 4)**: Depends on US4 — BLOCKS US2 (purchases require events + tiers)
- **US2 Purchase (Phase 5)**: Depends on US1 — BLOCKS US3 (redemption requires issued tickets)
- **US3 Redemption (Phase 6)**: Depends on US2 — completes core MVP lifecycle
- **US5 Auth (Phase 7)**: Depends on Foundational only — can run in parallel with US4/US1/US2/US3
- **US6 Order History (Phase 8)**: Depends on US2 (orders must exist) and US5 (auth for /orders/my)
- **US7 Analytics (Phase 9)**: Depends on US1 (events) and US2 (orders with sales data)
- **Polish (Phase 10)**: Depends on all desired user stories being complete

### Critical Path (Sequential)

```
Setup → Foundational → US4 (Org/Venues) → US1 (Events/Tiers) → US2 (Purchase) → US3 (Redemption)
```

This is the MVP critical path. US5, US6, US7 can be deferred or parallelized.

### Parallel Opportunities

- **Within Phase 2**: All model definitions (T011–T021) can run in parallel — different sections of same schema file
- **US5 (Auth)** can proceed in parallel with the US4→US1→US2→US3 chain after Foundational is complete
- **US6 + US7** can proceed in parallel with each other after their dependencies are met
- **Within each story**: Contract tests [P] can run in parallel; implementation tasks with [P] can run in parallel

### Within Each User Story

- Contract tests written FIRST — ensure they FAIL before implementation
- Services before routes
- Routes before frontend
- Backend before frontend within the same story
- Story complete before moving to next in the critical path

---

## Parallel Example: Foundational Phase

```bash
# These model definitions can all be written in parallel (same file, different sections):
T011: Define User model in packages/db/prisma/schema.prisma
T012: Define Account model in packages/db/prisma/schema.prisma
T013: Define VerificationToken model in packages/db/prisma/schema.prisma
T014: Define Organization model in packages/db/prisma/schema.prisma
T015: Define Venue model in packages/db/prisma/schema.prisma
T016: Define Contact model in packages/db/prisma/schema.prisma
T017: Define Event model in packages/db/prisma/schema.prisma
T018: Define PriceTier model in packages/db/prisma/schema.prisma
T019: Define Order model in packages/db/prisma/schema.prisma
T020: Define Ticket model in packages/db/prisma/schema.prisma
T021: Define PaymentTransaction model in packages/db/prisma/schema.prisma

# These Auth.js configs can be written in parallel:
T027: Create frontend/src/auth.config.ts
T028: Create frontend/src/auth.ts (after T027)
T029: Create frontend/middleware.ts
T030: Create frontend/src/app/api/auth/[...nextauth]/route.ts
```

## Parallel Example: User Story 4

```bash
# After contract tests pass, these services can be written in parallel:
T042: Implement OrganizationService in backend/src/services/OrganizationService.js
T043: Implement VenueService in backend/src/services/VenueService.js

# These frontend pages can be written in parallel:
T049: Create organizations dashboard page
T050: Create venues dashboard page
```

---

## Implementation Strategy

### MVP First (US4 + US1 + US2 + US3)

1. Complete Phase 1: Setup (monorepo)
2. Complete Phase 2: Foundational (schema + auth + config)
3. Complete Phase 3: US4 Org & Venues (infrastructure for events)
4. Complete Phase 4: US1 Events & Tiers → **VALIDATE**: events creatable with tiers
5. Complete Phase 5: US2 Purchase → **VALIDATE**: end-to-end purchase works
6. Complete Phase 6: US3 Redemption → **VALIDATE**: full ticket lifecycle
7. **STOP and VALIDATE**: Core MVP is complete — create, sell, redeem tickets

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US4 (Org/Venues) → Organizational structure in place
3. Add US1 (Events/Tiers) → Events publishable → Demo organizer workflow
4. Add US2 (Purchase) → Revenue generation live → Demo customer workflow (MVP!)
5. Add US3 (Redemption) → Full lifecycle → Demo venue operations
6. Add US5 (Auth) → Magic link + Google sign-in → Enhanced security
7. Add US6 (Order History) → Customer self-service → Better UX
8. Add US7 (Analytics) → Operational visibility → Business intelligence
9. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers after Foundational is complete:

- **Developer A**: US4 → US1 → US2 → US3 (critical path)
- **Developer B**: US5 (auth, independent of critical path)
- After critical path and US5 complete:
  - **Developer A**: US6 (order history)
  - **Developer B**: US7 (analytics)

---

## FR Coverage Matrix

| FR Range   | Domain               | Covered In   |
| ---------- | -------------------- | ------------ |
| FR-001–006 | Identity & Auth      | Phase 2, US5 |
| FR-007–011 | Org & Venue          | US4          |
| FR-012–018 | Events & Tiers       | US1          |
| FR-019–022 | Contacts & Guest     | US2, US5     |
| FR-023–029 | Orders & Payments    | US2          |
| FR-030–035 | Tickets & Redemption | US2, US3     |
| FR-036–037 | Notifications        | US2          |
| FR-038–047 | UI Changes           | US1–US7      |
| FR-048–057 | API Endpoints        | US1–US7      |

---

## Notes

- [P] tasks = different files, no dependencies on in-progress work
- [Story] label maps task to specific user story for traceability
- US4 (P2) is ordered before US1 (P1) because events depend on venues — priority doesn't override dependency order
- Constitution Principle III (TDD): contract tests written FIRST, verified to FAIL, then implemented
- PaymentTransaction is append-only (no updatedAt) per Constitution Principle IX
- Ticket expiration is lazy (evaluated at scan time, not via background job) per FR-032
- Contact email is immutable — different email creates new Contact per FR-021
- All org-scoped routes must verify user's organizationId matches the route's orgId
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
