# ADR-002: Synchronous Ticket Issuance

**Status**: Accepted  
**Date**: 2026-02-04  
**Decision Makers**: Engineering Team  
**Context**: Feature 001 – Online Ticket Purchase and QR Code Generation

## Context

After a customer completes payment through Stripe, the system must issue tickets and generate QR codes. We needed to decide whether this process should be synchronous (in the same request) or asynchronous (via a background queue).

The success criteria require that 95% of customers see their QR code within 90 seconds of initiating purchase (SC-001) and that email delivery occurs within 5 seconds for 95% of purchases (SC-005).

## Decision

**Synchronous ticket issuance in the purchase confirmation flow**, with **asynchronous email delivery with retry**.

When a customer is redirected back after Stripe payment:

1. Verify payment status (synchronous)
2. Create tickets atomically with inventory decrement (synchronous, database transaction)
3. Generate QR code JWTs and images (synchronous)
4. Return tickets with QR codes to the customer (synchronous)
5. Send confirmation email (asynchronous, non-blocking with retry)

## Rationale

- **Immediate Feedback**: Customers expect to see their QR codes immediately after payment. A "processing" state requiring a separate check degrades user experience.
- **Transactional Integrity** (Constitution Principle IV): Synchronous processing within a database transaction ensures atomic payment→ticket→inventory operations. If ticket creation fails, the customer sees an error immediately.
- **Simplicity**: No message queue infrastructure (RabbitMQ, SQS) required for MVP.
- **Email Separation**: Email delivery is the one step that can safely be asynchronous because:
  - The customer already has their QR code on-screen
  - Customers can re-access tickets via "My Tickets" page
  - Email failures don't invalidate the ticket

## Alternatives Considered

| Alternative                          | Pros                      | Cons                                                                | Why Rejected                                   |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| **Fully Asynchronous** (queue-based) | Decoupled, retry-friendly | Requires queue infrastructure, customer waits for processing        | Adds complexity, worse UX                      |
| **Webhook-Only Processing**          | Stripe handles retry      | Payment success → customer redirect is faster than webhook delivery | Customer may see "processing" for 5-30 seconds |
| **Event-Driven (CQRS)**              | Scalable, audit-friendly  | Eventual consistency complexity, overkill for MVP                   | Principle VII: Simplicity                      |

## Consequences

### Positive

- 95%+ of customers see QR codes immediately after payment confirmation
- No additional infrastructure (message queues) needed
- Simple error handling — failures are visible in the same request
- Atomic transactions prevent orphaned tickets or inventory mismatches

### Negative

- If QR generation is slow, the confirmation response is delayed
- If the confirmation endpoint fails after payment, the customer must retry (mitigated by Stripe webhook as fallback)
- Email retry logic lives in the application process

### Mitigations

- QR generation is fast (<10ms per ticket) so synchronous processing doesn't add significant latency
- Stripe webhooks provide a fallback mechanism — if the redirect-based confirmation fails, the webhook triggers ticket issuance
- Email retry (3 attempts per FR-020) uses async fire-and-forget pattern
- Admin alerting if all email retries fail
