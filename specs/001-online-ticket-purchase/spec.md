# Feature Specification: Online Ticket Purchase and QR Code Generation

**Feature Branch**: `001-online-ticket-purchase`  
**Created**: 2026-02-04  
**Status**: Draft  
**Input**: User description: "online ticket purchase and QR code generation"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Customer Ticket Purchase Flow (Priority: P1)

A customer visits the Jump platform, browses available events, selects a general-admission ticket, completes payment through Stripe, and receives a QR code ticket for event entry.

**Why this priority**: This is the core revenue-generating capability. Without online ticket purchase, the platform has no value proposition. It validates the entire payment → ticket issuance → QR generation pipeline and proves transactional integrity (Constitution Principle IV).

**Independent Test**: Can be fully tested by creating a test event, purchasing a ticket with Stripe test credentials, verifying payment confirmation, and confirming QR code delivery. Delivers immediate value: customers can buy tickets online.

**Acceptance Scenarios**:

1. **Given** the customer is on the event listing page, **When** they click on an available event, **Then** they see event details including price, available capacity, and a "Buy Tickets" button
2. **Given** the customer is viewing event details with available capacity, **When** they click "Buy Tickets" and select quantity (1-10), **Then** they are taken to a payment page showing total cost and Stripe payment form
3. **Given** the customer has entered valid payment information, **When** they submit payment, **Then** Stripe processes the payment and returns a confirmation
4. **Given** payment is confirmed by Stripe, **When** the system issues the ticket, **Then** inventory is decremented atomically and a unique ticket ID is generated
5. **Given** a ticket has been issued, **When** the system generates the QR code, **Then** it creates a signed JWT containing ticket ID, event ID, and expiration timestamp, encoded as a QR code
6. **Given** the QR code has been generated, **When** the purchase completes, **Then** the customer sees a confirmation page displaying the QR code and receives it via email
7. **Given** the customer has completed purchase, **When** they return to the event page, **Then** available capacity reflects the ticket(s) purchased

---

### User Story 2 - Event Organizer Creates Event (Priority: P2)

An event organizer logs into the Jump admin portal, creates a new event with basic details (name, date, venue, capacity), sets general-admission ticket pricing, and publishes the event for online sales.

**Why this priority**: Events must exist before tickets can be sold. This establishes the foundational data model (events, capacity, pricing) and validates role-based access control (Constitution Principle V: only Admin role can create events).

**Independent Test**: Can be fully tested by logging in as an admin user, creating an event, verifying it appears in the event listing, and confirming non-admin users cannot access event creation. Delivers value: organizers can list events for sale.

**Acceptance Scenarios**:

1. **Given** an admin user is logged in, **When** they navigate to "Create Event", **Then** they see a form requesting event name, date/time, venue, capacity, and ticket price
2. **Given** the admin is filling out the event form, **When** they enter capacity as a positive integer, **Then** the system validates capacity > 0 and ≤ 100,000
3. **Given** the admin has filled all required fields, **When** they submit the form, **Then** the system creates the event with status "Draft"
4. **Given** an event is in Draft status, **When** the admin clicks "Publish", **Then** the event becomes visible to customers and available for purchase
5. **Given** an event has been published, **When** tickets are sold, **Then** the admin can view real-time remaining capacity (calculated as total capacity minus tickets sold)
6. **Given** a non-admin user attempts to access event creation, **When** they navigate to the create event URL, **Then** they receive a 403 Forbidden error

---

### User Story 3 - Capacity Enforcement and Oversell Prevention (Priority: P1)

The system enforces capacity limits in real-time, preventing ticket sales when an event reaches full capacity, even under concurrent purchase attempts.

**Why this priority**: Overselling tickets creates legal liability and damages customer trust. This validates Constitution Principle VI (Real-Time Synchronization) and Principle I (Single Source of Truth) by ensuring inventory accuracy under load.

**Independent Test**: Can be fully tested by creating an event with capacity=5, simulating 10 concurrent purchase attempts, and verifying exactly 5 tickets are sold. Delivers value: organizers trust inventory accuracy.

**Acceptance Scenarios**:

1. **Given** an event has 3 tickets remaining, **When** a customer attempts to purchase 5 tickets, **Then** the system displays an error "Only 3 tickets available" and does not process payment
2. **Given** an event has exactly 1 ticket remaining, **When** two customers simultaneously attempt to purchase 1 ticket each, **Then** database-level locking ensures only one purchase succeeds
3. **Given** an event has reached full capacity (remaining = 0), **When** a customer views the event, **Then** the "Buy Tickets" button is disabled and replaced with "Sold Out"
4. **Given** a customer has items in their "cart" but has not completed payment, **When** another customer purchases the last available tickets, **Then** the first customer's payment fails with "Event sold out during checkout"
5. **Given** tickets have been purchased, **When** the admin views the event dashboard, **Then** they see accurate real-time counts: Total Capacity, Tickets Sold, Remaining

---

### User Story 4 - Customer Views Purchase History (Priority: P3)

A logged-in customer can view their past ticket purchases, re-download QR codes for upcoming events, and see event details.

**Why this priority**: Customers may lose email confirmations or need to access tickets from a different device. This improves user experience but is not critical for MVP launch (can be deferred if time-constrained).

**Independent Test**: Can be fully tested by purchasing tickets as a customer, logging in, and verifying purchase history displays correct tickets with downloadable QR codes. Delivers value: reduces support burden for lost tickets.

**Acceptance Scenarios**:

1. **Given** a customer is logged in, **When** they navigate to "My Tickets", **Then** they see a list of all tickets they have purchased, ordered by event date
2. **Given** a customer is viewing their ticket history, **When** they click on a ticket, **Then** they see the full QR code, event details (name, date, venue), and purchase timestamp
3. **Given** a customer has purchased multiple tickets for the same event, **When** they view that event in their history, **Then** each ticket displays a unique QR code
4. **Given** a customer views a past event (event date has passed), **When** they see the ticket, **Then** it is marked "Expired" and QR code is grayed out
5. **Given** a customer is not logged in, **When** they attempt to access "My Tickets", **Then** they are redirected to the login page

---

### Edge Cases

- **What happens when Stripe payment is pending/delayed?** System polls Stripe webhook for confirmation. Ticket is not issued until payment status = "succeeded". Customer sees "Processing..." state with 30-second timeout.
- **What happens when a customer closes browser mid-payment?** Stripe session ID is stored. If customer returns within 1 hour, they can resume or see payment status. Abandoned payments do not decrement inventory.
- **What happens when capacity reaches 0 during checkout?** Payment submission fails before Stripe is called. Customer sees "Event sold out during checkout" and is not charged.
- **What happens if QR code generation fails after payment succeeds?** Payment is logged but QR generation is retried asynchronously (up to 3 attempts). Customer receives email with QR code once generation succeeds. Admin is alerted to manual intervention if all retries fail.
- **What happens when a customer enters invalid email?** Email validation occurs before payment. Customer cannot proceed to Stripe form without valid email format.
- **What happens when event capacity is set to a negative number?** Form validation prevents negative or zero capacity. If somehow bypassed, database constraint rejects the transaction.
- **What happens when two events have the same name and date?** This is allowed. Events are distinguished by unique event ID, not by name/date combination.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST display a list of published events showing event name, date, venue, price, and available capacity
- **FR-002**: System MUST allow customers to select ticket quantity (1-10 per transaction) for events with available capacity
- **FR-003**: System MUST integrate with Stripe payment gateway to capture payment before ticket issuance
- **FR-004**: System MUST atomically decrement event capacity and create ticket record only after Stripe confirms payment success
- **FR-005**: System MUST generate a unique ticket ID (UUID v4 or equivalent) for each ticket purchased
- **FR-006**: System MUST generate a QR code encoding a signed JWT with ticket ID, event ID, customer email, and expiration timestamp (event end time + 1 hour)
- **FR-007**: System MUST use HMAC-SHA256 or RSA signature for JWT signing to prevent QR code forgery
- **FR-008**: System MUST display the QR code to the customer immediately after purchase and send it via email
- **FR-009**: System MUST enforce event capacity limits using database-level locking to prevent overselling under concurrent transactions
- **FR-010**: System MUST prevent ticket purchase when remaining capacity < requested quantity
- **FR-011**: System MUST allow Admin users to create, edit, and publish events
- **FR-012**: System MUST validate event creation inputs: capacity (positive integer ≤ 100,000), price (positive decimal ≥ 0), date (future date)
- **FR-013**: System MUST prevent non-Admin users from accessing event creation or modification endpoints (403 Forbidden)
- **FR-014**: System MUST display real-time inventory counts to admins: total capacity, tickets sold, remaining capacity
- **FR-015**: System MUST validate customer email format before allowing payment submission
- **FR-016**: System MUST log all ticket purchases with audit trail: timestamp, customer ID, event ID, ticket IDs, amount paid, Stripe transaction ID
- **FR-017**: System MUST allow customers to view their purchase history showing all tickets with event details and QR codes
- **FR-018**: System MUST mark tickets as "Expired" when event end time + 1 hour has passed
- **FR-019**: System MUST handle Stripe webhook callbacks to update payment status asynchronously
- **FR-020**: System MUST retry QR code generation up to 3 times on failure, with admin alert if all retries fail
- **FR-021**: System MUST implement email/password authentication with database-backed session tokens for both Customer and Admin users
- **FR-022**: System MUST hash passwords using bcrypt or Argon2 before storage
- **FR-023**: System MUST expire session tokens after 24 hours of inactivity
- **FR-024**: System MUST support guest checkout (no account required) for ticket purchase, with optional account creation for viewing purchase history
- **FR-025**: System MUST collect and expose metrics: ticket sales rate (tickets/minute), payment success/failure rate (%), API endpoint response times (ms), QR generation success rate (%), active session count
- **FR-026**: System MUST log metric data with timestamps for performance monitoring and alerting
- **FR-027**: System MUST process customer data deletion requests (GDPR/CCPA) within 30 days from request
- **FR-028**: System MUST preserve financial transaction records for 7 years while removing customer PII when deletion is requested

### Key Entities

- **Event**: Represents a ticketed event. Attributes: event ID (UUID), name, date/time, venue, capacity (integer), ticket price (decimal), status (Draft/Published), created timestamp, organizer ID (foreign key to Admin user)
- **Ticket**: Represents a single ticket purchase. Attributes: ticket ID (UUID), event ID (foreign key), customer ID (foreign key), purchase timestamp, price paid, QR code data (JWT string), status (Valid/Redeemed/Expired), Stripe transaction ID
- **Customer**: Represents a ticket buyer. Attributes: customer ID (UUID), email (unique), name, created timestamp, password hash (for authentication)
- **Admin**: Represents an event organizer. Attributes: admin ID (UUID), email (unique), name, organization name, created timestamp, password hash, role (Admin)
- **Payment Transaction**: Represents a payment record. Attributes: transaction ID (UUID), Stripe session ID, customer ID, event ID, amount, currency (USD), status (Pending/Succeeded/Failed), timestamp, failure reason (if failed)

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Customers can complete ticket purchase (from event selection to QR code receipt) in under 90 seconds under normal conditions
- **SC-002**: System prevents overselling: 0 tickets sold above event capacity across 100 simulated concurrent purchase attempts
- **SC-003**: Payment and ticket issuance are atomic: 100% of successful Stripe payments result in ticket issuance, 0% of failed payments result in tickets
- **SC-004**: QR codes are cryptographically secure: Manually tampered QR codes fail validation 100% of the time during redemption (tested in future feature)
- **SC-005**: Customers receive QR code via email within 5 seconds of payment confirmation 95% of the time
- **SC-006**: Event capacity displays update in admin dashboard within 2 seconds of ticket purchase
- **SC-007**: System handles 50 concurrent ticket purchases without payment failures or inventory errors
- **SC-008**: Customer purchase history displays all tickets with correct event details and downloadable QR codes 100% of the time

## Assumptions

- Stripe test API keys are available for development and integration testing
- Email delivery service (e.g., SendGrid, AWS SES) is configured for sending QR codes
- Customers have valid email addresses and can receive email
- Single currency support (USD) is sufficient for MVP
- General-admission tickets only (no seat selection, VIP tiers, or dynamic pricing)
- Events are single-date (no recurring events or multi-day passes)
- Customers do not need to create accounts to purchase tickets (guest checkout supported), but account creation is optional for viewing purchase history
- Payment processing fees are absorbed by the platform or added to ticket price transparently (not itemized separately)

## Dependencies

- Stripe API integration for payment processing
- JWT library for signing and encoding QR code data
- QR code generation library (e.g., qrcode.js, ZXing, or equivalent)
- Email delivery service API
- PostgreSQL or equivalent ACID-compliant database for transactional integrity
- Web frontend framework (TBD) for customer-facing ticket purchase UI
- Admin portal frontend (TBD) for event creation and monitoring

## Out of Scope (MVP)

- Ticket refunds or cancellations
- Ticket transfers or resale
- Multi-tier ticket pricing (VIP, early bird, group discounts)
- Reserved seating or seat selection
- Promo codes or discount functionality
- Multi-language support
- Offline ticket purchase capability
- Mobile app for ticket purchase (web-responsive only)
- Social login (OAuth with Google/Facebook)
- Advanced analytics or reporting dashboards
- Email marketing or customer segmentation
- Waitlist functionality when events sell out
- Ticket redemption/scanning (deferred to separate feature)

## Clarifications

### Session 2026-02-04

- Q: What authentication mechanism should be used for customer and admin login (email/password, magic link, OAuth, or other)? → A: Email/password with session tokens (database-backed sessions for horizontal scaling per Constitution deployment standards)
- Q: What operational metrics should be collected for monitoring system health, performance, and business KPIs? → A: Application-level metrics including ticket sales rate, payment success/failure rate, API response times, QR generation success rate, and active session count
- Q: What is the timeline for processing customer data deletion requests (GDPR/CCPA compliance)? → A: 30 days from request
