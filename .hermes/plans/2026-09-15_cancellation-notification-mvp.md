# Cancellation Notification & Ticket Voiding — MVP Plan

**Feature:** JUMP-009 (FR-037/T076 completion)
**Date:** 2026-09-15
**Spec:** specs/003-schema-redesign/spec.md (FR-037), specs/003-schema-redesign/tasks.md (T076)
**Input:** EventService/EmailService audit report, cancellation-notification requirements report

## Summary

Wire the existing `sendCancellationNotification()` into `cancelEvent()`, add retry matching the order-confirmation pattern, void tickets + restore inventory during cancel. This completes the T076 TODO at EventService.js:295 and satisfies FR-037 (retry requirement). No Stripe refund automation, no new notification channels, no custom organizer messages.

## Decisions

### A. Channels

Email only (Resend). No SMS, push, or in-app dashboard banner. Matches FR-037, no customer data for SMS exists, no push infrastructure exists. Deferred to a future spec if product requests it.

### B. Recipients

One email per unique contact email, grouped from tickets with contact relation loaded. Existing dedup logic in sendCancellationNotification is correct. Guests and signed-in users are treated identically — both resolve to a Contact record with an email.

### C. Idempotency & Dedup

No explicit idempotency key for the notification call itself — the grouping by email naturally prevents duplicates within one cancel invocation. The cancel endpoint itself has no idempotency protection; calling cancelEvent twice on the same event will fail on the second call because status is already CANCELLED (ConflictError). This is sufficient.

### D. Retry / Backoff / Failure Handling

Add 3-retry loop (matching sendOrderConfirmation) to sendCancellationNotification. Linear backoff: 1s, 2s, 3s. Log failure after all retries exhausted. Never throw — email failure must not break the cancel flow (matching sendOrderConfirmation line 136 pattern).

### E. Timing / Event Ordering

Status transitions to CANCELLED first (already implemented at line 279). Then: fetch tickets -> void + restore inventory -> send notifications. This ordering is safe: tickets are fetched after the event is locked to CANCELLED, so no new purchases can arrive during processing.

### F. Copy / Content

Use the existing template verbatim — red banner, "Event Cancelled" heading, "Your tickets have been voided and a refund will be processed automatically" message, support@jump.events footer. No custom organizer message in MVP. The "refund will be processed automatically" text remains aspirational (refunds are out of scope) — acceptable for MVP; update copy in a follow-up when refund automation is implemented.

### G. Privacy & Data Minimization

Existing guards are sufficient: null email skipped (anonymized contacts), grouped by email (no cross-contact disclosure), no opt-out check (not spec'd). No additional PII concerns in MVP.

### H. Ticket Voiding & Inventory Restoration

Void ALL tickets belonging to the event (VALID and REDEEMED statuses). Decrement quantitySold on each PriceTier per the refund-service pattern (RefundService.js:109 Raw SQL: `SET "quantitySold" = "quantitySold" - ${qty}`). REDEEMED tickets: void them for audit trail; their quantitySold adjustment is already reflected from the original purchase, so decrement is still correct (the scan didn't undo the purchase).

### I. Refunds

Not in scope. The email says "a refund will be processed automatically" but no Stripe refund code runs during cancel. This is a known copy-reality mismatch explicitly deferred. Update email copy (remove or qualify the refund claim) if product approves, but the MVP wiring should preserve existing copy to minimize template changes.

### J. Observability

- cancelEvent already logs event_cancelled. Add logs for: ticket count voided, per-tier inventory restored, notification attempts (already in sendCancellationNotification), notification failure after retries exhausted.
- No separate audit table for cancellation events in MVP. The existing log stream is sufficient.

### K. Scope of Testing

- Unit test for cancelEvent (new): happy path (PUBLISHED -> CANCELLED + tickets voided + notification called), edge cases (DRAFT reject, no-tickets event, null-contact tickets).
- Extend existing contract test (events.test.js POST cancel): assert tickets get VOIDED status after cancel.
- No EmailService isolated test file needed for MVP — the integration is covered by the contract test side-effect assertion.

## Implementation Surface

### Files to modify

| File | Change |
|------|--------|
| `backend/src/services/EventService.js` | Replace TODO at line 295: fetch tickets with contact, void + restore inventory, call emailService.sendCancellationNotification |
| `backend/src/services/EmailService.js` | Add retry loop (3 attempts, linear backoff) to sendCancellationNotification |
| `backend/tests/unit/eventService.test.js` | Add cancelEvent unit test |
| `backend/tests/contract/events.test.js` | Extend POST cancel test to assert tickets VOIDED |

### No schema changes needed

Ticket.status and PriceTier.quantitySold already exist. No migration required.

### No new dependencies

Resend SDK already in use, Prisma already in use.

## Non-Goals

- Stripe refund automation
- SMS / push / in-app notification channels
- Custom organizer message in cancellation email
- Cancellation audit table / event store
- Async / background job for notification dispatch
- Rate limiting of bulk email sends
- Idempotency key on the cancel endpoint
- Localization / i18n of email template
- Frontend cancellation UI (cancel button already works via POST endpoint)

## Rollout Considerations

- Cancel is an organizer-only action, low volume. No gradual rollout needed.
- RESEND_FROM_EMAIL env var must be set (already required for order confirmations). If unset, defaults to `Jump <noreply@jump.events>`.
- For events with many ticket holders (~10k), the synchronous inline loop will take several seconds. Acceptable for MVP; defer background dispatch to future if latency becomes a problem.
- No database migration — the new behavior uses existing columns.