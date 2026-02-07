# Data Model: Online Ticket Purchase and QR Code Generation

**Feature**: 001-online-ticket-purchase  
**Date**: 2026-02-04  
**Database**: PostgreSQL 15+  
**ORM**: Prisma 5.x

## Entity Relationship Diagram

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│     Admin       │         │      Event       │         │    Customer     │
├─────────────────┤         ├──────────────────┤         ├─────────────────┤
│ id (PK)         │1      * │ id (PK)          │1      * │ id (PK)         │
│ email (UNIQUE)  ├────────→│ organizer_id(FK) │←────────┤ email (UNIQUE)  │
│ name            │         │ name             │         │ name            │
│ organization    │         │ date             │         │ password_hash   │
│ password_hash   │         │ venue            │         │ created_at      │
│ created_at      │         │ capacity         │         └─────────────────┘
└─────────────────┘         │ ticket_price     │                 │
                            │ status           │                 │
                            │ created_at       │                 │1
                            └──────────────────┘                 │
                                    │1                           │
                                    │                            │
                                    │*                           │*
                            ┌───────────────┐                    │
                            │    Ticket     │                    │
                            ├───────────────┤                    │
                            │ id (PK)       │                    │
                            │ event_id (FK) ├────────────────────┘
                            │ customer_id(FK)───────────────────→┘
                            │ purchase_time │
                            │ price_paid    │
                            │ qr_code_jwt   │
                            │ status        │
                            │ stripe_tx_id  │
                            └───────────────┘
                                    │1
                                    │
                                    │1
                        ┌───────────────────────┐
                        │ PaymentTransaction    │
                        ├───────────────────────┤
                        │ id (PK)               │
                        │ stripe_session_id(UK) │
                        │ customer_id (FK)      │
                        │ event_id (FK)         │
                        │ amount                │
                        │ currency              │
                        │ status                │
                        │ timestamp             │
                        │ failure_reason        │
                        └───────────────────────┘
                                    │*
                                    │
                                    │1
                            ┌───────────────┐
                            │   Session     │
                            ├───────────────┤
                            │ id (PK)       │
                            │ user_id (FK)  │ (references Admin OR Customer)
                            │ user_type     │ ('admin' | 'customer')
                            │ token         │
                            │ expires_at    │
                            │ created_at    │
                            └───────────────┘
```

## Entities

### 1. Event

**Purpose**: Represents a ticketed event created by organizers

| Column       | Type                       | Constraints                                           | Description                         |
| ------------ | -------------------------- | ----------------------------------------------------- | ----------------------------------- |
| id           | UUID                       | PRIMARY KEY                                           | Unique event identifier             |
| organizer_id | UUID                       | FOREIGN KEY → Admin(id), NOT NULL                     | Event creator                       |
| name         | VARCHAR(255)               | NOT NULL                                              | Event name                          |
| date         | TIMESTAMP                  | NOT NULL, CHECK (date > NOW())                        | Event date/time (future dates only) |
| venue        | VARCHAR(500)               | NOT NULL                                              | Event location                      |
| capacity     | INTEGER                    | NOT NULL, CHECK (capacity > 0 AND capacity <= 100000) | Max ticket capacity (FR-012)        |
| ticket_price | DECIMAL(10,2)              | NOT NULL, CHECK (ticket_price >= 0)                   | Price per ticket in USD (FR-012)    |
| status       | ENUM('draft', 'published') | NOT NULL, DEFAULT 'draft'                             | Event visibility status             |
| created_at   | TIMESTAMP                  | NOT NULL, DEFAULT NOW()                               | Creation timestamp                  |

**Indexes**:

- `idx_event_status` on `status` (filter published events for customer listing)
- `idx_event_date` on `date` (sort by date)
- `idx_event_organizer` on `organizer_id` (admin dashboard filtering)

**Validation Rules** (enforced at application layer):

- Future date validation: `date > NOW()`
- Capacity range: `1 <= capacity <= 100,000` (FR-012)
- Price non-negative: `ticket_price >= 0` (FR-012)

**State Transitions**:

- `draft` → `published` (FR-011: admin publishes event)
- No transition from `published` back to `draft` in MVP (simplicity)

---

### 2. Ticket

**Purpose**: Represents a single purchased ticket

| Column        | Type                                 | Constraints                          | Description                                                       |
| ------------- | ------------------------------------ | ------------------------------------ | ----------------------------------------------------------------- |
| id            | UUID                                 | PRIMARY KEY                          | Unique ticket identifier (FR-005)                                 |
| event_id      | UUID                                 | FOREIGN KEY → Event(id), NOT NULL    | Associated event                                                  |
| customer_id   | UUID                                 | FOREIGN KEY → Customer(id), NULLABLE | Ticket owner (NULL for guest checkout)                            |
| purchase_time | TIMESTAMP                            | NOT NULL, DEFAULT NOW()              | Purchase timestamp                                                |
| price_paid    | DECIMAL(10,2)                        | NOT NULL                             | Actual price paid (snapshot, may differ from current event price) |
| qr_code_jwt   | TEXT                                 | NOT NULL                             | Signed JWT string for QR code (FR-006)                            |
| status        | ENUM('valid', 'redeemed', 'expired') | NOT NULL, DEFAULT 'valid'            | Ticket status                                                     |
| stripe_tx_id  | VARCHAR(255)                         | NOT NULL, UNIQUE                     | Stripe transaction ID for audit trail (FR-016)                    |

**Indexes**:

- `idx_ticket_event` on `event_id` (capacity calculations, event ticket listing)
- `idx_ticket_customer` on `customer_id` (purchase history query, US4)
- `idx_ticket_status` on `status` (filter valid/redeemed tickets)
- `idx_ticket_stripe_tx` on `stripe_tx_id` (idempotency check for webhook processing)

**Computed Fields** (application layer):

- `is_expired`: `status = 'expired' OR (event.date + INTERVAL '1 hour') < NOW()` (FR-018)

**State Transitions**:

- `valid` → `redeemed` (future feature: QR code scanning)
- `valid` → `expired` (automated: event date + 1 hour passes, FR-018)

**QR Code JWT Structure** (FR-006):

```json
{
  "ticket_id": "uuid",
  "event_id": "uuid",
  "customer_email": "email@example.com",
  "exp": 1234567890 // event.date + 1 hour (Unix timestamp)
}
```

Signed with HMAC-SHA256 (FR-007)

---

### 3. Customer

**Purpose**: Represents ticket buyers (both registered users and guest checkout)

| Column        | Type         | Constraints             | Description                                   |
| ------------- | ------------ | ----------------------- | --------------------------------------------- |
| id            | UUID         | PRIMARY KEY             | Unique customer identifier                    |
| email         | VARCHAR(255) | NOT NULL, UNIQUE        | Customer email (login username)               |
| name          | VARCHAR(255) | NOT NULL                | Customer full name                            |
| password_hash | VARCHAR(255) | NULLABLE                | bcrypt hash (NULL for guest checkout, FR-022) |
| created_at    | TIMESTAMP    | NOT NULL, DEFAULT NOW() | Account creation timestamp                    |

**Indexes**:

- `idx_customer_email` on `email` (login lookup, unique constraint)

**Validation Rules**:

- Email format: RFC 5322 compliant (FR-015)
- Password: Min 8 characters, hashed with bcrypt work factor 10 (FR-022)

**Guest Checkout Flow**:

1. Customer enters email during checkout (no password)
2. `Customer` record created with `password_hash = NULL`
3. Ticket associated with customer via `email` match
4. Customer can later "claim" account by setting password (US4: viewing purchase history)

---

### 4. Admin

**Purpose**: Represents event organizers with administrative privileges

| Column        | Type         | Constraints             | Description                  |
| ------------- | ------------ | ----------------------- | ---------------------------- |
| id            | UUID         | PRIMARY KEY             | Unique admin identifier      |
| email         | VARCHAR(255) | NOT NULL, UNIQUE        | Admin email (login username) |
| name          | VARCHAR(255) | NOT NULL                | Admin full name              |
| organization  | VARCHAR(255) | NULLABLE                | Organization name (optional) |
| password_hash | VARCHAR(255) | NOT NULL                | bcrypt hash (FR-022)         |
| created_at    | TIMESTAMP    | NOT NULL, DEFAULT NOW() | Account creation timestamp   |

**Indexes**:

- `idx_admin_email` on `email` (login lookup, unique constraint)

**Role Enforcement** (Principle V: RBAC):

- Admin creation: Manual process (no self-service signup in MVP)
- Role stored in `Session.user_type` ('admin' vs 'customer')
- API middleware checks `user_type` before allowing event creation (FR-013)

---

### 5. PaymentTransaction

**Purpose**: Audit trail for all payment attempts (successful and failed)

| Column            | Type                                   | Constraints                          | Description                                |
| ----------------- | -------------------------------------- | ------------------------------------ | ------------------------------------------ |
| id                | UUID                                   | PRIMARY KEY                          | Unique transaction identifier              |
| stripe_session_id | VARCHAR(255)                           | NOT NULL, UNIQUE                     | Stripe Checkout Session ID                 |
| customer_id       | UUID                                   | FOREIGN KEY → Customer(id), NULLABLE | Customer (NULL for failed guest checkouts) |
| event_id          | UUID                                   | FOREIGN KEY → Event(id), NOT NULL    | Event being purchased                      |
| amount            | DECIMAL(10,2)                          | NOT NULL                             | Total amount in USD                        |
| currency          | VARCHAR(3)                             | NOT NULL, DEFAULT 'USD'              | Currency code                              |
| status            | ENUM('pending', 'succeeded', 'failed') | NOT NULL, DEFAULT 'pending'          | Payment status                             |
| timestamp         | TIMESTAMP                              | NOT NULL, DEFAULT NOW()              | Transaction timestamp                      |
| failure_reason    | TEXT                                   | NULLABLE                             | Error message if status = 'failed'         |

**Indexes**:

- `idx_payment_stripe_session` on `stripe_session_id` (webhook idempotency check)
- `idx_payment_customer` on `customer_id` (customer payment history)
- `idx_payment_status` on `status` (metrics calculation, FR-025)

**Audit Trail** (FR-016):

- All payment attempts logged (including failures)
- Immutable records (no DELETE, only INSERT/UPDATE status)
- Webhook processing checks `stripe_session_id` uniqueness before ticket issuance (idempotency)

---

### 6. Session

**Purpose**: Database-backed session storage for authentication (FR-021, FR-023)

| Column     | Type                      | Constraints             | Description                                 |
| ---------- | ------------------------- | ----------------------- | ------------------------------------------- |
| id         | VARCHAR(255)              | PRIMARY KEY             | Session token (UUID)                        |
| user_id    | UUID                      | NOT NULL                | References Admin(id) OR Customer(id)        |
| user_type  | ENUM('admin', 'customer') | NOT NULL                | Discriminator for user_id lookup            |
| token      | VARCHAR(512)              | NOT NULL, UNIQUE        | Session token (secure random)               |
| expires_at | TIMESTAMP                 | NOT NULL                | Expiration (24 hours from creation, FR-023) |
| created_at | TIMESTAMP                 | NOT NULL, DEFAULT NOW() | Session start timestamp                     |

**Indexes**:

- `idx_session_token` on `token` (session lookup on each request)
- `idx_session_expires` on `expires_at` (cleanup expired sessions)

**Session Lifecycle**:

1. Login: Create Session with `expires_at = NOW() + 24 hours`
2. Each request: Check `token` validity and `expires_at > NOW()`
3. Logout: DELETE Session record
4. Cleanup job: Periodically DELETE WHERE `expires_at < NOW()`

**Redis Integration** (research.md ADR):

- Sessions stored in Redis (primary) with 24-hour TTL
- PostgreSQL `Session` table as backup/audit log (optional in MVP, defer to post-MVP)

---

## Relationships

### One-to-Many

- **Admin → Event**: One admin creates many events (`Event.organizer_id → Admin.id`)
- **Event → Ticket**: One event has many tickets (`Ticket.event_id → Event.id`)
- **Customer → Ticket**: One customer purchases many tickets (`Ticket.customer_id → Customer.id`)
- **Customer → PaymentTransaction**: One customer has many payment attempts
- **Event → PaymentTransaction**: One event has many payment attempts

### Referential Integrity

- **ON DELETE**: `CASCADE` for Event → Ticket (deleting event removes all tickets - post-MVP)
- **ON DELETE**: `SET NULL` for Customer → Ticket (GDPR deletion preserves ticket audit trail, FR-027/FR-028)
- **ON DELETE**: `RESTRICT` for Admin → Event (prevent deletion of admin with active events)

---

## Database Schema (Prisma)

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Admin {
  id           String   @id @default(uuid())
  email        String   @unique
  name         String
  organization String?
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at")

  events       Event[]

  @@map("admins")
}

model Customer {
  id           String   @id @default(uuid())
  email        String   @unique
  name         String
  passwordHash String?  @map("password_hash") // NULL for guest checkout
  createdAt    DateTime @default(now()) @map("created_at")

  tickets      Ticket[]
  payments     PaymentTransaction[]

  @@index([email])
  @@map("customers")
}

model Event {
  id          String      @id @default(uuid())
  organizerId String      @map("organizer_id")
  name        String
  date        DateTime
  venue       String
  capacity    Int
  ticketPrice Decimal     @map("ticket_price") @db.Decimal(10, 2)
  status      EventStatus @default(DRAFT)
  createdAt   DateTime    @default(now()) @map("created_at")

  organizer   Admin       @relation(fields: [organizerId], references: [id])
  tickets     Ticket[]
  payments    PaymentTransaction[]

  @@index([status])
  @@index([date])
  @@index([organizerId])
  @@map("events")
}

enum EventStatus {
  DRAFT      @map("draft")
  PUBLISHED  @map("published")
}

model Ticket {
  id            String       @id @default(uuid())
  eventId       String       @map("event_id")
  customerId    String?      @map("customer_id") // NULL for guest checkout
  purchaseTime  DateTime     @default(now()) @map("purchase_time")
  pricePaid     Decimal      @map("price_paid") @db.Decimal(10, 2)
  qrCodeJwt     String       @map("qr_code_jwt")
  status        TicketStatus @default(VALID)
  stripeTxId    String       @unique @map("stripe_tx_id")

  event         Event        @relation(fields: [eventId], references: [id])
  customer      Customer?    @relation(fields: [customerId], references: [id], onDelete: SetNull)

  @@index([eventId])
  @@index([customerId])
  @@index([status])
  @@index([stripeTxId])
  @@map("tickets")
}

enum TicketStatus {
  VALID      @map("valid")
  REDEEMED   @map("redeemed")
  EXPIRED    @map("expired")
}

model PaymentTransaction {
  id                String            @id @default(uuid())
  stripeSessionId   String            @unique @map("stripe_session_id")
  customerId        String?           @map("customer_id")
  eventId           String            @map("event_id")
  amount            Decimal           @db.Decimal(10, 2)
  currency          String            @default("USD")
  status            PaymentStatus     @default(PENDING)
  timestamp         DateTime          @default(now())
  failureReason     String?           @map("failure_reason")

  customer          Customer?         @relation(fields: [customerId], references: [id])
  event             Event             @relation(fields: [eventId], references: [id])

  @@index([stripeSessionId])
  @@index([customerId])
  @@index([status])
  @@map("payment_transactions")
}

enum PaymentStatus {
  PENDING    @map("pending")
  SUCCEEDED  @map("succeeded")
  FAILED     @map("failed")
}

model Session {
  id        String       @id @default(uuid())
  userId    String       @map("user_id")
  userType  UserType     @map("user_type")
  token     String       @unique
  expiresAt DateTime     @map("expires_at")
  createdAt DateTime     @default(now()) @map("created_at")

  @@index([token])
  @@index([expiresAt])
  @@map("sessions")
}

enum UserType {
  ADMIN      @map("admin")
  CUSTOMER   @map("customer")
}
```

---

## Capacity Enforcement Implementation (FR-009)

**Critical Transaction** (prevents overselling):

```typescript
// Pseudocode for atomic ticket purchase
async function purchaseTickets(
  eventId: string,
  quantity: number,
  customerId: string,
) {
  return await prisma.$transaction(async (tx) => {
    // 1. Lock event row (SELECT FOR UPDATE)
    const event = await tx.event.findUniqueOrThrow({
      where: { id: eventId },
      // Prisma doesn't expose FOR UPDATE directly, use raw query:
    });

    // Raw SQL for row-level locking
    const [lockedEvent] = await tx.$queryRaw`
      SELECT * FROM events WHERE id = ${eventId} FOR UPDATE
    `;

    // 2. Calculate current capacity
    const soldCount = await tx.ticket.count({
      where: { eventId, status: { not: "expired" } },
    });

    const remaining = lockedEvent.capacity - soldCount;

    // 3. Check capacity
    if (remaining < quantity) {
      throw new Error(`Only ${remaining} tickets available`);
    }

    // 4. Create tickets (inventory implicitly decremented)
    const tickets = await tx.ticket.createMany({
      data: Array(quantity)
        .fill(null)
        .map(() => ({
          eventId,
          customerId,
          pricePaid: lockedEvent.ticketPrice,
          qrCodeJwt: generateJWT({ eventId, customerId }),
          stripeTxId: stripeTransactionId,
        })),
    });

    return tickets;
  });
}
```

**Key Points**:

- `SELECT FOR UPDATE` locks event row during transaction
- Other concurrent transactions wait for lock release
- Transaction commits atomically (all tickets created or none)
- Prevents race condition per US3 acceptance scenario 2

---

## Metrics Calculation (FR-025)

**Ticket Sales Rate** (tickets/minute):

```sql
SELECT
  COUNT(*) / EXTRACT(EPOCH FROM (MAX(purchase_time) - MIN(purchase_time))) * 60 AS tickets_per_minute
FROM tickets
WHERE purchase_time > NOW() - INTERVAL '1 hour';
```

**Payment Success Rate** (%):

```sql
SELECT
  (COUNT(*) FILTER (WHERE status = 'succeeded')::FLOAT / COUNT(*)) * 100 AS success_rate_pct
FROM payment_transactions
WHERE timestamp > NOW() - INTERVAL '1 day';
```

**Remaining Capacity** (per event):

```sql
SELECT
  e.capacity - COUNT(t.id) AS remaining
FROM events e
LEFT JOIN tickets t ON t.event_id = e.id AND t.status != 'expired'
WHERE e.id = $1
GROUP BY e.id, e.capacity;
```

---

## Data Retention & GDPR Compliance (FR-027, FR-028)

**Customer Data Deletion Process** (30-day timeline):

1. Customer submits deletion request via API
2. System creates `DeletionRequest` record (separate table, not shown in MVP schema)
3. After 30 days:
   - `UPDATE customers SET email = 'deleted_' || id || '@gdpr.local', name = 'Deleted User', password_hash = NULL WHERE id = $1`
   - Preserve `Ticket` records (audit trail) but anonymize customer linkage
   - Preserve `PaymentTransaction` records (7-year financial retention per Constitution)
4. QR codes in `tickets` table remain valid until expiration (event integrity preserved)

**Financial Record Retention**:

- `PaymentTransaction` table: NO DELETE for 7 years
- `Ticket` table: NO DELETE (proof of purchase, refund validation)
- Customer PII removed while preserving transactional data

---

## Migration Strategy

**Initial Migration** (Phase 1):

```bash
npx prisma migrate dev --name init_online_ticket_purchase
```

**Future Migrations** (examples):

- Add `refunded` status to `TicketStatus` enum (post-MVP refund feature)
- Add `promo_code_id` FK to `Ticket` (post-MVP discount feature)
- Add `reserved_seat_id` FK to `Ticket` (post-MVP reserved seating)

**Rollback Strategy**:

- Prisma migrations are version-controlled (Git)
- Rollback: `npx prisma migrate resolve --rolled-back <migration_name>`
- Always test migrations in staging before production

---

## Performance Considerations

**Index Coverage**:

- All foreign keys have indexes (join performance)
- Query-heavy columns indexed (`status`, `date`, `email`)
- Composite indexes deferred to post-MVP (monitor query patterns first)

**Connection Pooling**:

- Prisma connection pool: 20 connections (research.md decision)
- Transaction timeout: 30 seconds (prevents deadlocks)

**Query Optimization**:

- `SELECT` only required columns (avoid `SELECT *`)
- Use `findUnique` over `findMany` where possible (index usage)
- Batch inserts for multiple tickets (`createMany` vs individual `create`)

---

## Testing Data Seeds

**Seed Script** (`prisma/seed.ts`):

```typescript
// Create test admin
const admin = await prisma.admin.create({
  data: {
    email: "admin@test.com",
    name: "Test Organizer",
    passwordHash: await bcrypt.hash("testpass123", 10),
  },
});

// Create test event
const event = await prisma.event.create({
  data: {
    organizerId: admin.id,
    name: "Test Concert",
    date: new Date("2026-03-15T19:00:00Z"),
    venue: "Test Venue",
    capacity: 100,
    ticketPrice: 50.0,
    status: "PUBLISHED",
  },
});

// Create test customer
const customer = await prisma.customer.create({
  data: {
    email: "customer@test.com",
    name: "Test Customer",
    passwordHash: await bcrypt.hash("testpass123", 10),
  },
});
```

Run seeds: `npx prisma db seed`

---

## Next Steps

Data model complete. Proceeding to:

1. **contracts/**: OpenAPI spec for REST endpoints using these entities
2. **quickstart.md**: Database setup instructions (PostgreSQL, Prisma migrations)
