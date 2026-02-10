# Feature Specification: Schema Redesign — MVP Data Architecture

**Feature Branch**: `003-schema-redesign`  
**Created**: 2025-02-08  
**Status**: Draft  
**Input**: User description: "Using the conversation history create a specification using the conversation and history and apply the necessary changes to the UI section to support new features and also add necessary endpoints related to configure the system using the new schema"

## Overview

The current Jump ticketing platform uses a flat database schema: events carry a plain-text venue string, a single ticket price, no organizational hierarchy, and a split Admin/Customer identity model. Tickets have no grouping (no orders), payments are linked indirectly via shared Stripe IDs, and capacity enforcement operates only at the event level.

This redesign introduces a lean, normalized schema that supports multi-tier pricing, proper organizational hierarchy, a unified identity model, and explicit order grouping — while keeping the MVP tightly scoped to **issue, sell, and redeem general-admission tickets reliably**. Seat selection is explicitly out of scope.

### Design Principles

- Strip the legacy reference model to only what is essential for general-admission ticketing
- Every table must justify its existence by enabling a core workflow
- Prefer nullable fields over separate tables where cardinality is 1:1
- App-level multi-tenancy (single database, `organizationId` foreign keys)
- Guest checkout as a first-class citizen (authentication is optional for purchasing)

---

## Clarifications

### Session 2026-02-08

- Q: How should existing production data (Admin, Customer, Event, Ticket, PaymentTransaction) be handled during the schema migration? → A: Wipe and re-seed. The platform is pre-launch with no real customer data; existing rows are discarded and fresh seed data is created after migration.
- Q: How long should inventory be reserved during checkout before timing out? → A: 30-minute reservation window, aligned with Stripe Checkout's default session expiry. Orders not completed within 30 minutes are marked FAILED and reserved inventory is released.
- Q: What happens when email delivery fails (Resend API error, bounce)? → A: Fire-and-forget with background retry. The order and tickets are issued regardless of email outcome; a background process retries failed deliveries. Signed-in customers can also retrieve tickets from the order history page.
- Q: What triggers ticket expiration (VALID → EXPIRED)? → A: Lazy evaluation at scan time. When a ticket is scanned after the event's date/time has passed, it is treated as expired. No background job or scheduled status change is needed; the ticket remains VALID in the database until explicitly evaluated.
- Q: How can guest purchasers retrieve tickets if they lose the confirmation email? → A: Provide a "Look up my order" page where guests enter their email and order reference to retrieve their tickets and QR codes. No account creation required.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Organizer Creates an Event with Price Tiers (Priority: P1)

An organizer signs into the platform, selects their organization, chooses a venue, and creates a new event. They define multiple price tiers (e.g., "Early Bird" at $25, "General Admission" at $40, "VIP" at $75), each with its own inventory allocation. The system validates that the total tier inventory does not exceed the event's capacity ceiling.

**Why this priority**: Without events and price tiers, no tickets can be sold. This is the foundational workflow that all other stories depend on.

**Independent Test**: Can be fully tested by creating an organization, a venue, and an event with multiple price tiers, then verifying the event appears in public listings with correct pricing — delivers the ability for organizers to set up sellable events.

**Acceptance Scenarios**:

1. **Given** an organizer is signed in and has an organization, **When** they create an event with a venue, date, capacity of 500, and two price tiers (200 Early Bird + 300 GA), **Then** the event is saved in DRAFT status with both tiers visible in the management dashboard.
2. **Given** an event has a capacity of 500, **When** the organizer tries to create price tiers totalling 600 tickets, **Then** the system rejects the configuration with a clear error explaining that tier inventory exceeds event capacity.
3. **Given** an event is in DRAFT status, **When** the organizer publishes it, **Then** the event status changes to PUBLISHED and it appears in the public event listing.
4. **Given** an event is PUBLISHED with tickets sold, **When** the organizer cancels it, **Then** the event status changes to CANCELLED, no further purchases are allowed, and existing ticket holders are notified.

---

### User Story 2 — Customer Purchases Tickets (Guest or Authenticated) (Priority: P1)

A customer browses published events, selects an event, chooses a price tier and quantity, and completes purchase. They may be a signed-in user or a guest (providing only name and email). Upon successful payment, an order is created, individual tickets are issued with unique QR codes, and a confirmation email is sent with the ticket details.

**Why this priority**: Ticket purchasing is the core revenue-generating workflow and the primary reason the platform exists.

**Independent Test**: Can be fully tested by selecting a published event, completing a purchase as a guest, and verifying that tickets with QR codes are received via email — delivers end-to-end revenue generation.

**Acceptance Scenarios**:

1. **Given** a published event with available tickets in the "GA" tier, **When** a guest provides name and email and purchases 3 tickets, **Then** an order is created with COMPLETED status, 3 individual tickets are issued with unique QR codes, the tier's sold count increases by 3, and a confirmation email is sent.
2. **Given** a signed-in user with an existing contact record, **When** they purchase tickets, **Then** the order is linked to their existing contact (no duplicate contact created).
3. **Given** a price tier has 2 tickets remaining, **When** a customer attempts to purchase 5 tickets, **Then** the system rejects the purchase and displays the actual number available.
4. **Given** a payment fails after order creation, **When** the Stripe webhook reports failure, **Then** the order status moves to FAILED, no tickets are issued, and reserved inventory is released.
5. **Given** two customers attempt to purchase the last remaining ticket simultaneously, **When** both requests reach the server, **Then** exactly one succeeds and the other receives a sold-out message — no overselling occurs.

---

### User Story 3 — Ticket Redemption at Venue (Priority: P1)

A door attendant scans a ticket's QR code at the venue entrance. The system validates the ticket is authentic, belongs to the correct event, and has not already been redeemed. Valid tickets are marked as redeemed with a timestamp.

**Why this priority**: Without redemption, tickets are just receipts. This closes the loop on the core ticketing lifecycle (create → sell → redeem).

**Independent Test**: Can be fully tested by generating a valid ticket QR code, scanning it via the redemption endpoint, and verifying the ticket status changes to REDEEMED — delivers venue access control.

**Acceptance Scenarios**:

1. **Given** a valid ticket for today's event, **When** the QR code is scanned, **Then** the ticket status changes from VALID to REDEEMED, a redemption timestamp is recorded, and the attendant sees a green confirmation.
2. **Given** a ticket that has already been redeemed, **When** the QR code is scanned again, **Then** the system displays a red rejection with the original redemption time.
3. **Given** a QR code that is forged or tampered with, **When** it is scanned, **Then** the system rejects it as invalid.
4. **Given** a ticket for a different event, **When** it is scanned at the wrong venue, **Then** the system rejects it with a message indicating the event mismatch.

---

### User Story 4 — Organizer Manages Organization and Venues (Priority: P2)

An organizer creates their organization profile and registers venues within it. Each venue has a name, address, time zone, and visibility setting. Venues can be reused across multiple events.

**Why this priority**: Organization and venue management is required infrastructure for event creation, but events can technically be created with minimal venue data. This story formalizes the structure.

**Independent Test**: Can be fully tested by creating an organization, adding two venues, and verifying both appear in the venue selector when creating an event — delivers organizational structure.

**Acceptance Scenarios**:

1. **Given** a newly registered organizer, **When** they create an organization with name and contact details, **Then** the organization is saved with ACTIVE status and the organizer is associated with it.
2. **Given** an active organization, **When** the organizer adds a venue with name, address, and time zone, **Then** the venue is saved and appears in the venue list for that organization.
3. **Given** a venue linked to published events, **When** the organizer attempts to delete it, **Then** the system prevents deletion and explains that the venue is in use.
4. **Given** multiple organizations exist, **When** an organizer views venues, **Then** they see only venues belonging to their organization.

---

### User Story 5 — User Authentication via Magic Link and Google (Priority: P2)

A user signs in using either a magic link sent to their email or their Google account. On first sign-in, a user record is created with a default "customer" role. Admins can elevate users to "organizer" or "admin" roles. The session persists via secure tokens and includes the user's role for authorization decisions throughout the application.

**Why this priority**: Authentication is required for organizer workflows and personalized customer experiences, but guest checkout means purchasing can work without it.

**Independent Test**: Can be fully tested by requesting a magic link, clicking it, and verifying the user is signed in with the correct role visible in the session — delivers secure identity.

**Acceptance Scenarios**:

1. **Given** a new user, **When** they request a magic link via email, **Then** a verification email is sent via Resend, and clicking the link signs them in with a "customer" role.
2. **Given** a user with a Google account, **When** they click "Sign in with Google", **Then** they are authenticated and their Google profile is linked to their user record.
3. **Given** a signed-in user with "customer" role, **When** they attempt to access organizer-only features (e.g., event creation), **Then** they are denied access with a clear message.
4. **Given** an admin, **When** they change a user's role from "customer" to "organizer", **Then** the user's session reflects the new role on next request.
5. **Given** a user who previously checked out as guest, **When** they later sign up with the same email, **Then** their user record is linked to their existing contact record and they can see their past orders.

---

### User Story 6 — Customer Views Order History (Priority: P3)

A signed-in customer views their past orders, including event details, ticket count, amount paid, and ticket statuses. They can view individual ticket QR codes for upcoming events.

**Why this priority**: Order history enhances the customer experience but is not required for core purchasing or redemption.

**Independent Test**: Can be fully tested by completing two purchases, navigating to order history, and verifying both orders appear with correct details — delivers post-purchase transparency.

**Acceptance Scenarios**:

1. **Given** a signed-in customer with 3 past orders, **When** they navigate to order history, **Then** all 3 orders are displayed with event name, date, quantity, total amount, and status.
2. **Given** an order with 2 valid tickets for an upcoming event, **When** the customer clicks on the order, **Then** they can view and download each ticket's QR code.
3. **Given** an order for a cancelled event, **When** the customer views it, **Then** the order is marked accordingly and ticket statuses show as VOIDED.

---

### User Story 7 — Admin Dashboard with Event Analytics (Priority: P3)

An admin views a dashboard showing event performance: tickets sold per tier, revenue collected, redemption rates, and remaining inventory. They can filter by organization, venue, or date range.

**Why this priority**: Analytics help organizers make better decisions but are not required for the core ticketing flow.

**Independent Test**: Can be fully tested by creating an event with sales and redemptions, then viewing the dashboard to verify accurate counts and revenue figures — delivers operational visibility.

**Acceptance Scenarios**:

1. **Given** an event with 100 tickets sold across 2 tiers, **When** the organizer views the event dashboard, **Then** they see per-tier breakdown of sold, redeemed, and remaining tickets.
2. **Given** multiple events under one organization, **When** the admin filters by organization, **Then** only that organization's events and aggregate metrics are shown.

---

### Edge Cases

- What happens when a price tier is deactivated while customers have it in their cart? — The purchase attempt fails with a message that the tier is no longer available; no phantom inventory is held.
- What happens when an organizer changes event capacity below the number of tickets already sold? — The system rejects the change and displays the minimum capacity (equal to total tickets sold across all tiers).
- How does the system handle a contact with multiple email changes? — Contact email is immutable once created; a new contact record is created for a different email.
- What happens when a user's organization is deactivated? — The user retains their account but cannot create new events; existing published events remain visible but no new sales are processed.
- How does the system handle Stripe webhook retries for the same payment? — Order status transitions are idempotent; duplicate webhook calls for an already-COMPLETED order are acknowledged but ignored.
- What happens when a magic link is used after expiration? — The system shows an expired-link message and prompts the user to request a new one.
- What happens when the confirmation email fails to send? — The order and tickets are still issued successfully. A background process retries delivery. Signed-in customers can retrieve their tickets from the order history page.
- What happens when a ticket is scanned after the event has ended? — The system evaluates expiration lazily: the ticket is rejected as expired and its status is updated to EXPIRED in the database at that point.
- What happens when a guest enters an incorrect order reference on the lookup page? — The system returns a generic "order not found" message without revealing whether the email exists in the system, to prevent enumeration.

---

## Requirements _(mandatory)_

### Functional Requirements — Identity & Authentication

- **FR-001**: System MUST support user sign-in via email magic link and Google OAuth, with no password-based authentication.
- **FR-002**: System MUST create a user record with a default "customer" role on first successful sign-in.
- **FR-003**: System MUST support three user roles — "customer", "organizer", and "admin" — stored as a single role value on the user record.
- **FR-004**: System MUST enforce role-based access: only organizers and admins can create/manage events; only admins can manage users and organizations.
- **FR-005**: System MUST persist sessions via secure tokens that include user identity and role.
- **FR-006**: System MUST link a guest's contact record to their user account when they sign up with a matching email address.

### Functional Requirements — Organization & Venue

- **FR-007**: System MUST allow admins to create organizations with a name and status (active/inactive).
- **FR-008**: System MUST allow organizers to create venues within their organization, including name, address, and time zone.
- **FR-009**: System MUST enforce that organizers can only view and manage venues belonging to their organization (app-level tenancy).
- **FR-010**: System MUST prevent deletion of venues that are referenced by existing events.
- **FR-011**: System MUST support venue visibility control (public/private) to allow unlisted venues.

### Functional Requirements — Events & Price Tiers

- **FR-012**: System MUST allow organizers to create events linked to a specific venue, with name, date/time, and overall capacity.
- **FR-013**: System MUST support event lifecycle states: DRAFT → PUBLISHED → CANCELLED. Only published events are visible to customers.
- **FR-014**: System MUST allow organizers to define multiple price tiers per event, each with a name, price, total quantity, and display order.
- **FR-015**: System MUST validate that the sum of all price tier quantities does not exceed the event's capacity ceiling.
- **FR-016**: System MUST support optional per-tier purchase limits (minimum and maximum tickets per order).
- **FR-017**: System MUST allow organizers to activate or deactivate individual price tiers without affecting other tiers.
- **FR-018**: System MUST support an optional free-text category field on events for basic categorization.

### Functional Requirements — Contacts & Guest Checkout

- **FR-019**: System MUST maintain a contact record (name, email) for every ticket holder, separate from user authentication records.
- **FR-020**: System MUST allow ticket purchases without requiring sign-in (guest checkout), using only name and email to create or match a contact record.
- **FR-021**: System MUST prevent duplicate contact records for the same email address.
- **FR-022**: System MUST optionally link a contact to a user account via a foreign key, enabling signed-in users to see their purchase history.

### Functional Requirements — Orders & Payments

- **FR-023**: System MUST group all tickets from a single purchase into an order, recording total amount, currency, quantity, and status.
- **FR-024**: System MUST enforce order lifecycle states: PENDING → COMPLETED or PENDING → FAILED.
- **FR-025**: System MUST create individual ticket records within an order, each linked to a specific price tier and contact.
- **FR-026**: System MUST enforce atomic inventory management: reserve tier inventory at checkout initiation and either confirm (on payment success) or release (on payment failure or after a 30-minute reservation timeout).
- **FR-027**: System MUST enforce exclusive per-tier inventory isolation during concurrent purchases to guarantee that no price tier ever sells more tickets than its defined quantity.
- **FR-028**: System MUST record payment transactions linked to orders, including payment provider reference, amount, currency, status, and optional failure reason.
- **FR-029**: System MUST process order status transitions idempotently to handle duplicate payment webhook deliveries.

### Functional Requirements — Tickets & Redemption

- **FR-030**: System MUST generate a unique QR code for each issued ticket, encoded as a signed token to prevent forgery.
- **FR-031**: System MUST generate a unique human-readable barcode for each ticket.
- **FR-032**: System MUST support ticket lifecycle states: VALID → REDEEMED, VALID → EXPIRED, VALID → VOIDED. Expiration is evaluated lazily at scan time — a VALID ticket is treated as EXPIRED if the associated event's date/time has passed. No background status-change job is required.
- **FR-033**: System MUST validate ticket authenticity, event association, and redemption status upon scanning.
- **FR-034**: System MUST record a redemption timestamp when a ticket is successfully scanned.
- **FR-035**: System MUST reject tickets that have already been redeemed, are expired, voided, or belong to a different event.

### Functional Requirements — Notifications

- **FR-036**: System MUST send a purchase confirmation email via Resend upon successful order completion, including ticket QR codes. Email delivery MUST NOT block order completion — emails are dispatched asynchronously with automatic retry on failure.
- **FR-037**: System MUST send a notification email to ticket holders when an event is cancelled. Email delivery failures MUST be retried automatically.

### Functional Requirements — UI Changes

- **FR-038**: System MUST provide an organization selector in the organizer dashboard, allowing organizers to switch between organizations they belong to.
- **FR-039**: System MUST provide a venue management page where organizers can create, edit, and list venues within their organization.
- **FR-040**: System MUST update the event creation form to include a venue selector (populated from the organizer's venues), a capacity field, and a price tier builder (add/remove/reorder tiers with name, price, quantity, and optional min/max per order).
- **FR-041**: System MUST update the public event listing page to display price tier options, allowing customers to select a tier and quantity before checkout.
- **FR-042**: System MUST provide a guest checkout flow that collects name and email inline on the purchase page, without requiring account creation.
- **FR-043**: System MUST provide an order history page for signed-in customers, displaying past orders with event details, ticket counts, amounts, and statuses.
- **FR-044**: System MUST update the organizer event dashboard to show per-tier sales breakdown (sold, redeemed, remaining) and total revenue.
- **FR-045**: System MUST replace the current login/register forms with magic link and Google sign-in options.
- **FR-046**: System MUST provide an admin user management page where admins can view users, change roles, and deactivate accounts.
- **FR-047**: System MUST provide a "Look up my order" page where guests can enter their email address and order reference to retrieve their tickets and QR codes without signing in.

### Functional Requirements — API Endpoints

- **FR-048**: System MUST expose endpoints for organization management: create, read, update, and list organizations (admin-only).
- **FR-049**: System MUST expose endpoints for venue management: create, read, update, list, and delete venues (organizer/admin, scoped to organization).
- **FR-050**: System MUST update event endpoints to accept venue reference, capacity, and nested price tier definitions during creation and update.
- **FR-051**: System MUST expose endpoints for price tier management: create, read, update, activate/deactivate, and reorder tiers within an event (organizer/admin).
- **FR-052**: System MUST expose an endpoint for order creation that accepts contact details, event, tier selection, and quantity — then initiates payment.
- **FR-053**: System MUST expose endpoints for order retrieval: by order ID, by contact, and by event (with role-based scoping).
- **FR-054**: System MUST expose a guest order lookup endpoint that accepts an email address and order reference and returns order details with ticket QR codes (unauthenticated).
- **FR-055**: System MUST expose a ticket redemption endpoint that accepts a scanned QR code payload, validates it, and updates ticket status.
- **FR-056**: System MUST expose an admin endpoint for user management: list users, update roles, and deactivate accounts.
- **FR-057**: System MUST expose an analytics endpoint that returns per-event and per-tier sales, revenue, and redemption metrics (organizer/admin).

### Key Entities

- **User**: Represents an authenticated identity. Has a role (customer, organizer, admin), belongs to an optional organization, and optionally links to contact records. Created on first sign-in.
- **Account**: Links a user to an external authentication provider (Google, Email). Multiple accounts can belong to one user.
- **Organization**: A business entity that owns venues and whose organizers create events. Has a status (active/inactive).
- **Venue**: A physical location belonging to an organization. Has a name, address, and time zone. Reusable across events.
- **Contact**: A ticket-holder identity (name + email). Exists independently of authentication — created for both guests and signed-in users. Optionally linked to a user.
- **Event**: A ticketed occurrence at a venue on a specific date. Has a lifecycle (draft → published → cancelled), an overall capacity ceiling, and belongs to an organization via its venue.
- **Price Tier**: A pricing option within an event (e.g., "Early Bird", "VIP"). Defines price, total inventory, and tracks sold/reserved counts. Each event has one or more tiers.
- **Order**: Groups tickets from a single purchase. Links to a contact, an event, and a payment transaction. Tracks total amount, quantity, and status.
- **Ticket**: An individual admission token within an order. Linked to a price tier, a contact, and an event. Carries a QR code and barcode, and tracks its lifecycle (valid → redeemed/expired/voided).
- **Payment Transaction**: Records a payment attempt linked to an order. Captures provider reference, amount, status, and failure reason.

---

## Assumptions

- **Single role per user**: A user holds exactly one role at a time. Multi-role support (e.g., a user who is both an organizer and a customer) is deferred to a future phase.
- **App-level tenancy**: All organizations share a single database. Data isolation is enforced through application-level foreign key scoping, not database-level row policies.
- **No seat selection**: All events are general admission. Reserved seating is explicitly out of scope.
- **Currency from Stripe**: Currency is stored on orders and payments as a string (e.g., "usd") and determined by the Stripe session, not configurable per-tier.
- **Contact email immutability**: Once a contact record is created with an email, that email is not changed. A different email produces a new contact record.
- **Standard performance expectations**: Page loads under 2 seconds, API responses under 500ms for typical operations, unless otherwise noted.
- **Pre-launch data wipe**: The platform has no real customer data. The migration drops all existing tables and re-seeds from scratch — no data migration scripts are required.
- **Shared Prisma schema**: A single Prisma schema in a shared monorepo package is consumed by both frontend and backend applications.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Organizers can create a fully configured event (with venue, capacity, and multiple price tiers) in under 5 minutes.
- **SC-002**: Customers can complete a ticket purchase (including guest checkout) in under 3 minutes from event selection to confirmation email receipt.
- **SC-003**: System prevents 100% of overselling attempts — no event ever has more tickets sold than its capacity, and no price tier exceeds its inventory.
- **SC-004**: Ticket redemption (scan to verdict) completes in under 2 seconds, including network latency.
- **SC-005**: All existing ticket purchase and redemption functionality continues to work after migration — zero regression in core workflows.
- **SC-006**: Guest checkout requires no account creation — only name and email — and successfully creates contact, order, and ticket records.
- **SC-007**: Users can sign in via magic link or Google and access role-appropriate features within 30 seconds of initiation.
- **SC-008**: Organizers see accurate real-time sales data (per-tier sold, revenue, remaining) on their event dashboard, refreshed within 10 seconds of a purchase.
- **SC-009**: System supports at least 100 concurrent purchases for a single event without data integrity violations or degraded response times.
- **SC-010**: All payment webhook retries are handled idempotently — duplicate webhooks produce no duplicate orders, tickets, or charges.
