# API Contracts Documentation

**Feature**: 001-online-ticket-purchase  
**API Version**: 1.0.0  
**OpenAPI Spec**: [api.yaml](api.yaml)

## Overview

This directory contains the REST API contracts for the Jump ticketing platform. All contracts follow OpenAPI 3.0.3 specification and align with Constitution Principle II (API-First Architecture).

## Files

- **api.yaml**: Complete OpenAPI specification for all endpoints
- **README.md**: This file (contract documentation and usage guidelines)

## API Endpoints by Domain

### Events (`/events`)

| Endpoint            | Method | Auth | Description                           | Spec Reference |
| ------------------- | ------ | ---- | ------------------------------------- | -------------- |
| `/events`           | GET    | None | List published events with pagination | FR-001         |
| `/events/{eventId}` | GET    | None | Get event details including capacity  | FR-001         |

### Tickets (`/tickets`)

| Endpoint            | Method | Auth    | Description                                    | Spec Reference |
| ------------------- | ------ | ------- | ---------------------------------------------- | -------------- |
| `/tickets/purchase` | POST   | None    | Initiate Stripe Checkout for ticket purchase   | FR-002, FR-003 |
| `/tickets/confirm`  | GET    | None    | Retrieve tickets after Stripe success redirect | FR-008         |
| `/tickets/my`       | GET    | Session | Get authenticated customer's purchase history  | FR-017         |

### Authentication (`/auth`)

| Endpoint         | Method | Auth    | Description                                   | Spec Reference |
| ---------------- | ------ | ------- | --------------------------------------------- | -------------- |
| `/auth/register` | POST   | None    | Create customer account                       | FR-021, FR-024 |
| `/auth/login`    | POST   | None    | Login customer or admin (sets session cookie) | FR-021         |
| `/auth/logout`   | POST   | Session | Invalidate session                            | FR-023         |
| `/auth/me`       | GET    | Session | Get current user info                         | FR-021         |

### Admin (`/admin`)

| Endpoint                          | Method | Auth  | Description                               | Spec Reference |
| --------------------------------- | ------ | ----- | ----------------------------------------- | -------------- |
| `/admin/events`                   | POST   | Admin | Create draft event                        | FR-011, FR-012 |
| `/admin/events/{eventId}`         | PATCH  | Admin | Update event details                      | FR-011         |
| `/admin/events/{eventId}/publish` | POST   | Admin | Publish event (make visible to customers) | FR-011         |
| `/admin/dashboard/stats`          | GET    | Admin | Real-time dashboard statistics            | FR-014, FR-025 |

### Webhooks (`/webhooks`)

| Endpoint           | Method | Auth      | Description                    | Spec Reference |
| ------------------ | ------ | --------- | ------------------------------ | -------------- |
| `/webhooks/stripe` | POST   | Signature | Stripe payment event callbacks | FR-019         |

## Authentication & Authorization

### Session-Based Auth (FR-021)

**Cookie**: `sessionId` (HttpOnly, Secure, SameSite=Strict)  
**Expiration**: 24 hours from last activity (FR-023)  
**Storage**: Redis with database backup (research.md ADR-008)

**Flow**:

1. `POST /auth/login` → returns `Set-Cookie: sessionId=...`
2. Subsequent requests include cookie automatically
3. Server validates session on each request (middleware)
4. `POST /auth/logout` → deletes session

### Role-Based Access Control (Principle V)

**Roles**: `customer`, `admin`  
**Enforcement**: API middleware checks `Session.user_type` before route handler

**Admin-Only Endpoints** (return 403 if not admin):

- `/admin/*` (all admin routes)

**Customer-Only Endpoints** (return 401 if not authenticated):

- `/tickets/my`

## Request/Response Patterns

### Error Responses

All errors follow consistent schema:

```json
{
  "error": "Error category",
  "message": "Human-readable description",
  "details": {
    /* optional context */
  }
}
```

**HTTP Status Codes**:

- `400 Bad Request`: Invalid input (validation failure)
- `401 Unauthorized`: Authentication required but missing/invalid
- `403 Forbidden`: Authenticated but insufficient permissions (RBAC)
- `404 Not Found`: Resource does not exist
- `409 Conflict`: Business rule violation (e.g., insufficient capacity)
- `500 Internal Server Error`: Unexpected server error

### Validation Rules

**Email** (FR-015): RFC 5322 format, enforced before payment  
**Password** (FR-022): Min 8 characters, bcrypt hashed  
**Capacity** (FR-012): 1 ≤ capacity ≤ 100,000  
**Price** (FR-012): price ≥ 0  
**Date** (FR-012): Future dates only for event creation  
**Quantity** (FR-002): 1 ≤ quantity ≤ 10 per purchase

### Pagination

**Query Parameters**:

- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

**Response**:

```json
{
  "items": [
    /* array of resources */
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalPages": 5,
    "totalItems": 87
  }
}
```

## Ticket Purchase Flow (US1)

**Sequence**:

```
1. Customer: GET /events → Browse events
2. Customer: GET /events/{eventId} → View details + capacity
3. Customer: POST /tickets/purchase
   Request: { eventId, quantity, customerEmail, customerName }
   Response: { checkoutUrl, sessionId } (Stripe Checkout URL)
4. Customer: Redirected to Stripe Checkout (external)
5. Customer: Completes payment on Stripe
6. Stripe: Redirects back to /tickets/confirm?session_id=xxx
7. Customer: GET /tickets/confirm?session_id=xxx
   Response: { tickets: [{ qrCode, event, ... }] }
8. Backend: Email sent with QR codes (FR-008)
9. Stripe: POST /webhooks/stripe (async confirmation)
   Backend: Updates PaymentTransaction status, triggers retry if needed
```

## Capacity Enforcement (US3)

**Atomic Transaction** (FR-009):

```
POST /tickets/purchase
↓
1. Database transaction starts
2. SELECT capacity, sold_count FROM events WHERE id = ? FOR UPDATE (row lock)
3. IF (capacity - sold_count) < quantity THEN
     ROLLBACK
     RETURN 409 "Only X tickets available"
4. Create PaymentTransaction (status = 'pending')
5. Call Stripe Checkout API
6. COMMIT transaction
7. Return checkoutUrl
```

**Concurrent Purchase Handling**:

- `FOR UPDATE` lock ensures serialized access to capacity calculation
- Second purchase waits for first transaction to complete
- If first purchase consumes last tickets, second purchase fails with 409

## Real-Time Dashboard (SC-006)

**Polling Strategy** (research.md ADR-004):

```
Frontend: setInterval(() => {
  fetch('/admin/dashboard/stats?eventId=xxx')
    .then(res => res.json())
    .then(data => updateDashboard(data))
}, 5000) // 5-second polling interval
```

**Response** (FR-014, FR-025):

```json
{
  "totalCapacity": 1000,
  "ticketsSold": 743,
  "remainingCapacity": 257,
  "ticketsRedeemed": 0,
  "salesRate": 12.5, // tickets/minute
  "paymentSuccessRate": 98.3 // percentage
}
```

## Webhook Handling (FR-019)

**Stripe Events**:

- `payment_intent.succeeded`: Mark PaymentTransaction as 'succeeded', issue tickets
- `payment_intent.failed`: Mark PaymentTransaction as 'failed', log reason

**Security** (Stripe signature verification):

```typescript
const sig = request.headers["stripe-signature"];
const event = stripe.webhooks.constructEvent(
  request.body, // raw body
  sig,
  process.env.STRIPE_WEBHOOK_SECRET,
);
// If signature invalid, throws error → returns 400
```

**Idempotency** (prevents duplicate ticket issuance):

```sql
-- Check if already processed
SELECT id FROM payment_transactions
WHERE stripe_session_id = ? AND status = 'succeeded';

IF found THEN
  -- Already processed, skip ticket creation
  RETURN 200
```

## QR Code Generation (FR-006, FR-007)

**JWT Structure**:

```json
{
  "ticket_id": "uuid",
  "event_id": "uuid",
  "customer_email": "email@example.com",
  "exp": 1234567890 // event.date + 1 hour
}
```

**Signing**:

```typescript
const jwt = require('jsonwebtoken');
const qrData = jwt.sign(
  { ticket_id, event_id, customer_email },
  process.env.JWT_SECRET,  // HMAC-SHA256 key
  { expiresIn: eventDate + 1 hour }
);
```

**QR Code Encoding**:

```typescript
const QRCode = require("qrcode");
const qrCodeDataURL = await QRCode.toDataURL(qrData, {
  errorCorrectionLevel: "H", // 30% redundancy
  type: "image/png",
  width: 300,
});
// Returns: "data:image/png;base64,iVBORw0KGgoAAAANS..."
```

**API Response**:

```json
{
  "tickets": [
    {
      "id": "ticket-uuid",
      "qrCode": "data:image/png;base64,...", // For browser display
      "event": {
        /* event details */
      },
      "status": "valid"
    }
  ]
}
```

## Performance Targets (Constitution)

| Operation                    | Target                       | Spec Reference |
| ---------------------------- | ---------------------------- | -------------- |
| `GET /events`                | <500ms p95                   | Constitution   |
| `POST /tickets/purchase`     | <500ms p95                   | Constitution   |
| `GET /tickets/confirm`       | <2s (QR generation included) | SC-001         |
| `GET /admin/dashboard/stats` | <500ms p95                   | SC-006         |
| Webhook processing           | <5s response to Stripe       | FR-019         |

## Testing

**Contract Tests** (research.md):

- Use Supertest for HTTP assertions
- Test all endpoints against OpenAPI schema
- Validate request/response bodies match spec

**Example**:

```typescript
import request from "supertest";
import app from "../src/app";

describe("GET /events", () => {
  it("returns event list matching schema", async () => {
    const res = await request(app).get("/api/v1/events").expect(200);

    expect(res.body).toHaveProperty("events");
    expect(res.body.events[0]).toHaveProperty("id");
    expect(res.body.events[0]).toHaveProperty("remainingCapacity");
  });
});
```

## Development Tools

**Swagger UI**: View interactive API documentation

```bash
npx @redocly/cli preview-docs contracts/api.yaml
```

**Validation**: Lint OpenAPI spec

```bash
npx @redocly/cli lint contracts/api.yaml
```

**Code Generation**: Generate TypeScript types

```bash
npx openapi-typescript contracts/api.yaml --output src/types/api.ts
```

## Versioning

**Current Version**: 1.0.0  
**Breaking Changes**: Require MAJOR version bump per Constitution  
**Endpoint Deprecation**: Mark as deprecated in OpenAPI, provide sunset date in response headers

**Future Versions**:

- `v2`: May include ticket transfers, refunds (currently Out of Scope)
- Maintain backward compatibility within MAJOR version

## Next Steps

API contracts complete. Proceeding to:

1. **quickstart.md**: Local development setup and testing
2. **Update agent context**: Add technology stack to AI agent context file
3. **Re-evaluate Constitution Check**: Confirm no violations
