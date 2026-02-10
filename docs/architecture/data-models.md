# Data Model: Schema Redesign — Normalized Data Architecture

**Feature**: 003-schema-redesign  
**Date**: 2026-02-09  
**Database**: PostgreSQL 15+  
**ORM**: Prisma 6.x  
**Package**: `@jump/db` (`packages/db`)

---

## Entity Relationship Diagram

```
+---------------------+        +--------------------------------+
|    Organization     |        |          User                  |
+---------------------+        +--------------------------------+
| id (PK, cuid)       |1     * | id (PK, cuid)                  |
| name                +------->| organizationId (FK, nullable)  |
| status              |        | email (UNIQUE)                 |
| createdAt           |        | emailVerified                  |
| updatedAt           |        | name                           |
+---------+-----------+        | firstName                      |
          |1                   | lastName                       |
          |                    | image                          |
          |*                   | role                           |
+---------------------+        | isActive                       |
|       Venue         |        | deletedAt                      |
+---------------------+        | createdAt / updatedAt          |
| id (PK, cuid)       |        +-------+--------------+--------+
| organizationId (FK) |                |1             |1
| name                |                |              |
| address             |                |*             |*
| timezone            |        +---------------+ +--------------------+
| isPublic            |        |   Account     | | VerificationToken  |
| createdAt           |        +---------------+ +--------------------+
| updatedAt           |        | id (PK, cuid) | | identifier         |
+---------+-----------+        | userId (FK)   | | token              |
          |1                   | type          | | expires            |
          |                    | provider      | | (composite PK)     |
          |*                   | providerAcctId| +--------------------+
+---------------------+        +---------------+
|       Event         |
+---------------------+                +--------------------+
| id (PK, cuid)       |                |     Contact        |
| venueId (FK)        |                +--------------------+
| name                |                | id (PK, cuid)      |
| description         |         *    1 | email (UNIQUE)     |
| date                |    +--------->| firstName          |
| capacity            |    |          | lastName           |
| category            |    |          | userId (FK, opt.)  |
| status              |    |          | createdAt          |
| createdAt           |    |          | updatedAt          |
| updatedAt           |    |          +--------------------+
+--+--------------+---+    |                    |1
   |1             |1       |                    |
   |              |        |                    |*
   |*             |*       |           +--------------------+
+--------------+ +----------------+    |      Ticket        |
|  PriceTier   | |     Order      |    +--------------------+
+--------------+ +----------------+    | id (PK, cuid)      |
| id (PK,cuid) | | id (PK, cuid)  |    | orderId (FK)       |
| eventId (FK) | | eventId (FK)   |    | eventId (FK)       |
| name         | | contactId (FK) |--> | priceTierId (FK)   |
| price        | | stripeSessionId|    | contactId (FK)     |
| quantityTotal| | totalAmount    |    | pricePaid          |
| quantitySold | | currency       |    | barcode (UNIQUE)   |
| qtyReserved  | | quantity       |    | qrCodeJwt          |
| displayOrder | | status         |    | status             |
| minPerOrder  | | orderRef       |    | redeemedAt         |
| maxPerOrder  | | createdAt      |    | createdAt          |
| isActive     | | updatedAt      |    | updatedAt          |
| createdAt    | +--------+-------+    +--------------------+
| updatedAt    |          |1
+--------------+          |
                          |1
                 +------------------------+
                 |  PaymentTransaction    |
                 +------------------------+
                 | id (PK, cuid)          |
                 | orderId (FK, UNIQUE)   |
                 | stripePaymentIntentId  |
                 | amount                 |
                 | currency               |
                 | status                 |
                 | failureReason          |
                 | createdAt              |
                 +------------------------+
```

---

## Shared Prisma Package: `@jump/db`

The schema lives in `packages/db/prisma/schema.prisma` and is shared across the monorepo via npm workspaces. Both `backend` and `frontend` depend on the `@jump/db` workspace package.

```typescript
// packages/db/src/index.ts — singleton Prisma client
import { PrismaClient } from "../generated/client/index.js";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "../generated/client/index.js";
export { PrismaClient };
```

**Usage in backend**:
```javascript
import { prisma } from "@jump/db";
```

**Usage in frontend** (server components / API routes):
```typescript
import { prisma } from "@jump/db";
```

---

## Entities

### 1. User (Auth.js compatible)

**Purpose**: Authenticated identity. Created on first sign-in (magic link or Google). No passwords stored.

| Column         | Type          | Constraints                | Description                                 |
| -------------- | ------------- | -------------------------- | ------------------------------------------- |
| id             | String (cuid) | PK                         | Unique user identifier                      |
| email          | String        | UNIQUE, NOT NULL           | Login email                                 |
| emailVerified  | DateTime      | nullable                   | When email was verified (Auth.js)           |
| name           | String        | nullable                   | Display name (Auth.js)                      |
| image          | String        | nullable                   | Avatar URL (Auth.js / Google)               |
| firstName      | String        | nullable                   | First name (custom)                         |
| lastName       | String        | nullable                   | Last name (custom)                          |
| role           | UserRole      | NOT NULL, DEFAULT CUSTOMER | One of CUSTOMER, ORGANIZER, ADMIN           |
| organizationId | String        | FK -> Organization, nullable | Organization membership (organizers/admins) |
| isActive       | Boolean       | NOT NULL, DEFAULT true     | Soft-disable account                        |
| deletedAt      | DateTime      | nullable                   | Soft-delete timestamp                       |
| createdAt      | DateTime      | NOT NULL, DEFAULT now()    | Creation timestamp                          |
| updatedAt      | DateTime      | NOT NULL, auto             | Last update timestamp                       |

**Auth.js adapter notes**: The Prisma Adapter reads/writes `id`, `email`, `emailVerified`, `name`, `image` only. All custom fields (`firstName`, `lastName`, `role`, `organizationId`, `isActive`, `deletedAt`) are ignored by the adapter and managed by application code.

**Indexes**: `organizationId`, `role`, `email`

---

### 2. Account (Auth.js required)

**Purpose**: Links a User to an external authentication provider. Multiple accounts (e.g., Google + Email) can belong to one User.

| Column            | Type          | Constraints             | Description                    |
| ----------------- | ------------- | ----------------------- | ------------------------------ |
| id                | String (cuid) | PK                      | Unique account identifier      |
| userId            | String        | FK -> User, NOT NULL    | Owning user                    |
| type              | String        | NOT NULL                | Provider type (oauth, email)   |
| provider          | String        | NOT NULL                | Provider name (google, resend) |
| providerAccountId | String        | NOT NULL                | External account ID            |
| refresh_token     | String        | nullable                | OAuth refresh token            |
| access_token      | String        | nullable                | OAuth access token             |
| expires_at        | Int           | nullable                | Token expiry (epoch seconds)   |
| token_type        | String        | nullable                | Token type (bearer)            |
| scope             | String        | nullable                | OAuth scopes                   |
| id_token          | String        | nullable                | OpenID Connect ID token        |
| session_state     | String        | nullable                | Provider session state         |
| createdAt         | DateTime      | NOT NULL, DEFAULT now() | Creation timestamp             |
| updatedAt         | DateTime      | NOT NULL, auto          | Last update timestamp          |

**Unique constraint**: `(provider, providerAccountId)` — prevents duplicate provider links.  
**Cascade**: Deleting a User cascades to delete all linked Accounts.

---

### 3. VerificationToken (Auth.js required)

**Purpose**: Short-lived tokens for email magic link verification. Consumed once and deleted.

| Column     | Type     | Constraints | Description                  |
| ---------- | -------- | ----------- | ---------------------------- |
| identifier | String   | NOT NULL    | Email address being verified |
| token      | String   | NOT NULL    | Hashed verification token    |
| expires    | DateTime | NOT NULL    | Token expiry timestamp       |

**Composite unique**: `(identifier, token)` — serves as the composite primary key.  
**Lifecycle**: Created when magic link is requested -> consumed (deleted) when user clicks the link -> expired tokens cleaned up by Auth.js.

---

### 4. Organization

**Purpose**: Top-level tenant entity. All venues, events, and users are scoped to an organization.

| Column    | Type               | Constraints              | Description                    |
| --------- | ------------------ | ------------------------ | ------------------------------ |
| id        | String (cuid)      | PK                       | Unique organization identifier |
| name      | String             | NOT NULL                 | Organization display name      |
| status    | OrganizationStatus | NOT NULL, DEFAULT ACTIVE | ACTIVE or INACTIVE             |
| createdAt | DateTime           | NOT NULL, DEFAULT now()  | Creation timestamp             |
| updatedAt | DateTime           | NOT NULL, auto           | Last update timestamp          |

**State transitions**: ACTIVE <-> INACTIVE (reversible — deactivation prevents new event creation but existing published events remain visible).

---

### 5. Venue

**Purpose**: Physical location belonging to an Organization. Reusable across multiple events.

| Column         | Type          | Constraints                          | Description                  |
| -------------- | ------------- | ------------------------------------ | ---------------------------- |
| id             | String (cuid) | PK                                   | Unique venue identifier      |
| organizationId | String        | FK -> Organization, NOT NULL         | Owning organization          |
| name           | String        | NOT NULL                             | Venue display name           |
| address        | String        | NOT NULL                             | Full address string          |
| timezone       | String        | NOT NULL, DEFAULT "America/New_York" | IANA time zone               |
| isPublic       | Boolean       | NOT NULL, DEFAULT true               | Publicly visible or unlisted |
| createdAt      | DateTime      | NOT NULL, DEFAULT now()              | Creation timestamp           |
| updatedAt      | DateTime      | NOT NULL, auto                       | Last update timestamp        |

**Indexes**: `organizationId`

---

### 6. Contact

**Purpose**: Ticket buyer/holder identity, independent of authentication. Created for both guests and signed-in users.

| Column    | Type          | Constraints             | Description                              |
| --------- | ------------- | ----------------------- | ---------------------------------------- |
| id        | String (cuid) | PK                      | Unique contact identifier                |
| email     | String        | UNIQUE, NOT NULL        | Contact email (immutable after creation) |
| firstName | String        | NOT NULL                | First name                               |
| lastName  | String        | NOT NULL                | Last name                                |
| userId    | String        | FK -> User, nullable    | Optional link to auth account            |
| createdAt | DateTime      | NOT NULL, DEFAULT now() | Creation timestamp                       |
| updatedAt | DateTime      | NOT NULL, auto          | Last update timestamp                    |

**Key behaviors**:

- Email is immutable once created (different email = new Contact)
- `userId` is set when a signed-in user purchases, or when a guest later signs up with matching email
- GDPR deletion: anonymize `email`, `firstName`, `lastName`; preserve Order/Ticket records

**Indexes**: `userId`, `email`

---

### 7. Event

**Purpose**: A ticketed occurrence at a venue on a specific date.

| Column      | Type          | Constraints             | Description                 |
| ----------- | ------------- | ----------------------- | --------------------------- |
| id          | String (cuid) | PK                      | Unique event identifier     |
| venueId     | String        | FK -> Venue, NOT NULL   | Hosting venue               |
| name        | String        | NOT NULL                | Event name                  |
| description | String        | nullable                | Event description           |
| date        | DateTime      | NOT NULL                | Event date/time             |
| capacity    | Int           | NOT NULL, CHECK > 0     | Maximum capacity ceiling    |
| category    | String        | nullable                | Free-text categorization    |
| status      | EventStatus   | NOT NULL, DEFAULT DRAFT | DRAFT, PUBLISHED, CANCELLED |
| createdAt   | DateTime      | NOT NULL, DEFAULT now() | Creation timestamp          |
| updatedAt   | DateTime      | NOT NULL, auto          | Last update timestamp       |

**State transitions**: DRAFT -> PUBLISHED -> CANCELLED (terminal).

**Validation rules** (application layer):

- `date` must be in the future at creation time
- `capacity` must be >= 1 and <= 100,000
- Sum of all PriceTier `quantityTotal` values must not exceed `capacity`

**Organization scoping**: Organization is resolved transitively through `venue.organizationId`.

**Indexes**: `venueId`, `status`, `date`

---

### 8. PriceTier

**Purpose**: Named pricing level within an event. Replaces the old single `ticketPrice` on Event.

| Column           | Type          | Constraints             | Description                          |
| ---------------- | ------------- | ----------------------- | ------------------------------------ |
| id               | String (cuid) | PK                      | Unique tier identifier               |
| eventId          | String        | FK -> Event, NOT NULL   | Parent event                         |
| name             | String        | NOT NULL                | Display name (e.g., "Early Bird")    |
| price            | Decimal(10,2) | NOT NULL, CHECK >= 0    | Tier price                           |
| quantityTotal    | Int           | NOT NULL, CHECK > 0     | Total inventory for this tier        |
| quantitySold     | Int           | NOT NULL, DEFAULT 0     | Confirmed sold count                 |
| quantityReserved | Int           | NOT NULL, DEFAULT 0     | Temporarily held during checkout     |
| displayOrder     | Int           | NOT NULL, DEFAULT 0     | Rendering sort order                 |
| minPerOrder      | Int           | nullable                | Minimum tickets per order (optional) |
| maxPerOrder      | Int           | nullable                | Maximum tickets per order (optional) |
| isActive         | Boolean       | NOT NULL, DEFAULT true  | Purchasable when true                |
| createdAt        | DateTime      | NOT NULL, DEFAULT now() | Creation timestamp                   |
| updatedAt        | DateTime      | NOT NULL, auto          | Last update timestamp                |

**Inventory invariant**: `quantitySold + quantityReserved <= quantityTotal` — enforced via row-level locking during purchase.

**Available tickets**: `quantityTotal - quantitySold - quantityReserved`

**Indexes**: `eventId`, `(eventId, isActive)` (composite)

---

### 9. Order

**Purpose**: Groups tickets from a single purchase. Links a contact to an event and payment.

| Column          | Type          | Constraints               | Description                    |
| --------------- | ------------- | ------------------------- | ------------------------------ |
| id              | String (cuid) | PK                        | Unique order identifier        |
| eventId         | String        | FK -> Event, NOT NULL     | Target event                   |
| contactId       | String        | FK -> Contact, NOT NULL   | Buyer contact                  |
| stripeSessionId | String        | UNIQUE, nullable          | Stripe Checkout session ID     |
| orderRef        | String        | UNIQUE, NOT NULL          | Human-readable order reference |
| totalAmount     | Decimal(10,2) | NOT NULL                  | Total order amount             |
| currency        | String        | NOT NULL, DEFAULT "usd"   | Currency code                  |
| quantity        | Int           | NOT NULL                  | Total ticket count             |
| status          | OrderStatus   | NOT NULL, DEFAULT PENDING | PENDING, COMPLETED, FAILED     |
| createdAt       | DateTime      | NOT NULL, DEFAULT now()   | Creation timestamp             |
| updatedAt       | DateTime      | NOT NULL, auto            | Last update timestamp          |

**State transitions**: PENDING -> COMPLETED (payment succeeded) | PENDING -> FAILED (payment failed or 30-min timeout).

**Idempotency**: Status transitions are one-directional. A COMPLETED or FAILED order cannot change status.

**Order reference format**: Short alphanumeric string (e.g., "JMP-A1B2C3") for guest lookup.

**Indexes**: `eventId`, `contactId`, `status`, `orderRef`

---

### 10. Ticket

**Purpose**: Atomic unit of admission. Each ticket is individually scannable.

| Column      | Type          | Constraints              | Description                                       |
| ----------- | ------------- | ------------------------ | ------------------------------------------------- |
| id          | String (cuid) | PK                       | Unique ticket identifier                          |
| orderId     | String        | FK -> Order, NOT NULL    | Parent order                                      |
| eventId     | String        | FK -> Event, NOT NULL    | Target event (denormalized for query performance) |
| priceTierId | String        | FK -> PriceTier, NOT NULL | Pricing tier at time of purchase                 |
| contactId   | String        | FK -> Contact, NOT NULL  | Ticket holder                                     |
| pricePaid   | Decimal(10,2) | NOT NULL                 | Price snapshot at time of purchase                |
| barcode     | String        | UNIQUE, NOT NULL         | Human-readable scannable barcode                  |
| qrCodeJwt   | String        | nullable                 | Signed JWT for QR code                            |
| status      | TicketStatus  | NOT NULL, DEFAULT VALID  | VALID, REDEEMED, EXPIRED, VOIDED                  |
| redeemedAt  | DateTime      | nullable                 | Timestamp when scanned                            |
| createdAt   | DateTime      | NOT NULL, DEFAULT now()  | Creation timestamp                                |
| updatedAt   | DateTime      | NOT NULL, auto           | Last update timestamp                             |

**State transitions**: VALID -> REDEEMED (scanned) | VALID -> EXPIRED (lazy, at scan time if event has passed) | VALID -> VOIDED (event cancelled).

**Denormalization**: `eventId` is stored directly on Ticket for query performance (avoids joining through Order for scan validation).

**QR code JWT payload**: `{ sub: ticketId, eventId, barcode, iat, exp }` — signed with HMAC-SHA256.

**Indexes**: `orderId`, `eventId`, `priceTierId`, `contactId`, `barcode`, `status`

---

### 11. PaymentTransaction

**Purpose**: Immutable Stripe payment audit record. Append-only — never updated or deleted after creation.

| Column                | Type          | Constraints                  | Description                                   |
| --------------------- | ------------- | ---------------------------- | --------------------------------------------- |
| id                    | String (cuid) | PK                           | Unique transaction identifier                 |
| orderId               | String        | FK -> Order, UNIQUE, NOT NULL | Linked order (1:1)                           |
| stripePaymentIntentId | String        | UNIQUE, nullable             | Stripe PaymentIntent ID                       |
| amount                | Decimal(10,2) | NOT NULL                     | Payment amount                                |
| currency              | String        | NOT NULL, DEFAULT "usd"      | Currency code                                 |
| status                | PaymentStatus | NOT NULL, DEFAULT PENDING    | PENDING, SUCCEEDED, FAILED                    |
| failureReason         | String        | nullable                     | Failure description                           |
| createdAt             | DateTime      | NOT NULL, DEFAULT now()      | Creation timestamp (no updatedAt — immutable) |

**Immutability**: No `updatedAt` field. PaymentTransaction is append-only — never modified after creation. Status changes create new context (Order status reflects payment outcome).

**Indexes**: `orderId`, `status`

---

## Enums Reference

| Enum               | Values                           | Usage                                    |
| ------------------ | -------------------------------- | ---------------------------------------- |
| UserRole           | CUSTOMER, ORGANIZER, ADMIN       | User.role — single role per user         |
| OrganizationStatus | ACTIVE, INACTIVE                 | Organization.status — reversible         |
| EventStatus        | DRAFT, PUBLISHED, CANCELLED      | Event.status — linear lifecycle          |
| OrderStatus        | PENDING, COMPLETED, FAILED       | Order.status — terminal after transition |
| TicketStatus       | VALID, REDEEMED, EXPIRED, VOIDED | Ticket.status — EXPIRED evaluated lazily |
| PaymentStatus      | PENDING, SUCCEEDED, FAILED       | PaymentTransaction.status — append-only  |

---

## Key Relationships Summary

| Relationship               | Type | FK Location                | Notes                           |
| -------------------------- | ---- | -------------------------- | ------------------------------- |
| Organization -> User       | 1:N  | User.organizationId        | Organizers/admins belong to org |
| Organization -> Venue      | 1:N  | Venue.organizationId       | Venues scoped to org            |
| Venue -> Event             | 1:N  | Event.venueId              | Events hosted at venues         |
| Event -> PriceTier         | 1:N  | PriceTier.eventId          | Multiple pricing options        |
| Event -> Order             | 1:N  | Order.eventId              | Orders placed for event         |
| Event -> Ticket            | 1:N  | Ticket.eventId             | Denormalized for query speed    |
| Contact -> Order           | 1:N  | Order.contactId            | Buyer identity                  |
| Contact -> Ticket          | 1:N  | Ticket.contactId           | Holder identity                 |
| User -> Contact            | 1:N  | Contact.userId             | Optional auth link              |
| User -> Account            | 1:N  | Account.userId             | Auth.js provider links          |
| Order -> Ticket            | 1:N  | Ticket.orderId             | Purchase grouping               |
| Order -> PaymentTransaction | 1:1 | PaymentTransaction.orderId | Payment audit                   |
| PriceTier -> Ticket        | 1:N  | Ticket.priceTierId         | Tier tracking                   |

---

## Index Strategy

| Table              | Index                 | Columns           | Rationale                      |
| ------------------ | --------------------- | ----------------- | ------------------------------ |
| User               | idx_user_org          | organizationId    | Filter users by organization   |
| User               | idx_user_role         | role              | Filter by role for admin views |
| User               | idx_user_email        | email             | Unique lookup (Auth.js)        |
| Venue              | idx_venue_org         | organizationId    | Org-scoped venue listing       |
| Contact            | idx_contact_user      | userId            | Link contact to auth user      |
| Contact            | idx_contact_email     | email             | Guest lookup, dedup            |
| Event              | idx_event_venue       | venueId           | Events at venue                |
| Event              | idx_event_status      | status            | Filter published events        |
| Event              | idx_event_date        | date              | Sort by date                   |
| PriceTier          | idx_tier_event        | eventId           | Tiers for an event             |
| PriceTier          | idx_tier_event_active | eventId, isActive | Active tiers for purchase      |
| Order              | idx_order_event       | eventId           | Orders for an event            |
| Order              | idx_order_contact     | contactId         | Order history                  |
| Order              | idx_order_status      | status            | Filter by order state          |
| Order              | idx_order_ref         | orderRef          | Guest lookup by reference      |
| Ticket             | idx_ticket_order      | orderId           | Tickets in an order            |
| Ticket             | idx_ticket_event      | eventId           | Tickets for an event           |
| Ticket             | idx_ticket_tier       | priceTierId       | Tickets per tier               |
| Ticket             | idx_ticket_contact    | contactId         | Holder's tickets               |
| Ticket             | idx_ticket_barcode    | barcode           | Barcode scan lookup            |
| Ticket             | idx_ticket_status     | status            | Filter by ticket state         |
| PaymentTransaction | idx_payment_order     | orderId           | Payment for order              |
| PaymentTransaction | idx_payment_status    | status            | Filter by payment state        |

---

## Capacity Enforcement

**Critical Transaction** (prevents overselling via row-level locking on PriceTier):

```typescript
async function purchaseTickets(eventId: string, items: { priceTierId: string; quantity: number }[]) {
  return await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const [tier] = await tx.$queryRaw`
        SELECT * FROM "PriceTier" WHERE id = ${item.priceTierId} FOR UPDATE
      `;

      const available = tier.quantityTotal - tier.quantitySold - tier.quantityReserved;
      if (available < item.quantity) {
        throw new Error(`Only ${available} tickets available for tier ${tier.name}`);
      }

      await tx.priceTier.update({
        where: { id: item.priceTierId },
        data: { quantityReserved: { increment: item.quantity } },
      });
    }

    // Create order + tickets ...
  });
}
```

---

## Migration from Previous Schema

**Strategy**: Wipe and re-seed (pre-launch, no real data).

| Old Entity         | Action          | New Entity                                                      |
| ------------------ | --------------- | --------------------------------------------------------------- |
| Admin              | DROP            | -> User (role: ORGANIZER or ADMIN)                              |
| Customer           | DROP            | -> User (role: CUSTOMER) + Contact                              |
| Event              | DROP + RECREATE | -> Event (venueId FK, no ticketPrice) + PriceTier               |
| Ticket             | DROP + RECREATE | -> Ticket (orderId, priceTierId, contactId, barcode added)      |
| PaymentTransaction | DROP + RECREATE | -> PaymentTransaction (orderId FK, append-only)                 |
| Session            | DROP            | -> Removed (JWT strategy, no DB sessions)                       |
| ---                | CREATE          | Organization, Venue, Contact, Order, Account, VerificationToken |

---

## Performance Considerations

**Connection Pooling**:

- Prisma connection pool: 20 connections
- Transaction timeout: 30 seconds (prevents deadlocks)

**Query Optimization**:

- All foreign keys have indexes (join performance)
- Query-heavy columns indexed (`status`, `date`, `email`, `barcode`)
- Composite index on `(eventId, isActive)` for PriceTier purchase queries
- `SELECT` only required columns; use `findUnique` over `findMany` where possible
- Batch inserts for multiple tickets (`createMany`)

---

## Data Retention & GDPR Compliance

**Contact Data Anonymization**:

1. Contact submits deletion request
2. Anonymize `email`, `firstName`, `lastName` on Contact
3. Preserve Order and Ticket records (audit trail) with anonymized references
4. Preserve PaymentTransaction records (7-year financial retention)

**Financial Record Retention**:

- PaymentTransaction: NO DELETE for 7 years (append-only)
- Ticket: NO DELETE (proof of purchase)
- Contact PII removed while preserving transactional data
