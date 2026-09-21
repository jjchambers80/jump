# Floor Maps and Vendor Booth Purchases

**Status**: Implemented — builder/public map (phase 1) and approved-vendor self-service purchase (phase 2), 2026-09-21. Spec: `specs/014-floor-map/spec.md`.
**Last Updated**: 2026-09-21

## Overview

An event can have one SVG floor map. Organizers draw and number booths, bind each booth to an application tier, assign approved vendors, and publish the map. A published map is available on the event storefront and is read with `Cache-Control: no-store` plus an ETag derived from the map and booth update times.

For a map-bound PAID application tier, approval does not charge the applicant. Approval moves the application to `PAYMENT_DUE` and invites the vendor to select an available booth. The booth is held under a database row lock, then either charged off-session with the saved card or carried into Stripe Checkout. Only a successful payment transition changes the booth from `HELD` to `SOLD`.

## Vendor Purchase Flow

1. The application must be `APPROVED`, `PAYMENT_DUE`, on a map-bound tier, and have no existing booth.
2. The guest status-link route or buyer-session route calls `ApplicationService.chooseBooth`.
3. `BoothService.holdForPurchase` locks the application first and booth second. It verifies the map is published, the booth is available, and its tier matches the application.
4. A card-on-file application attempts an off-session PaymentIntent. Success confirms the application/order and booth in one transition. A decline returns the application to `PAYMENT_DUE` and releases the booth immediately.
5. Without a saved card, the application retains the hold while the vendor enters hosted Checkout. Cancelling Checkout expires the session, releases the booth, and reopens the picker.
6. The payment webhook is authoritative. The browser never marks a booth sold.

Concurrent vendors may see the same booth as available, but the row lock gives exactly one caller the hold. Other callers receive `409 BOOTH_TAKEN`; the picker refetches the no-cache map before allowing another choice.

## State and Release Rules

- `AVAILABLE → HELD`: vendor chooses the booth.
- `HELD → SOLD`: Stripe success, offline settlement, or waiver confirms the application.
- `HELD → AVAILABLE`: card decline, hold expiry, Checkout cancellation, withdrawal, rejection, tier change, or a full refund before another owner is assigned.
- A `PROCESSING` application keeps its booth even after the displayed hold deadline so a delayed Stripe result cannot sell money without inventory.
- Payment-success handling is idempotent. If money succeeds after booth state was unexpectedly lost, the application remains paid; payment is never rolled back because of inventory state.
- Staff assignment/move and vendor selection use the same application-before-booth lock order. One application cannot own or hold two booths.

## API

| Method | Path | Auth |
|---|---|---|
| POST | `/applications/:id/booth?token=…` `{ boothId }` | Signed guest status token |
| POST | `/applications/:id/cancel-checkout?token=…` | Signed guest status token |
| POST | `/buyer/me/applications/:id/booth` `{ boothId }` | Buyer session, same contact and organization |
| POST | `/buyer/me/applications/:id/cancel-checkout` | Buyer session, same contact and organization |
| GET | `/events/:eventId/map` | Public, published maps only |
| GET/POST/PUT | `/admin/maps*` | Organization staff; writes follow route-specific role checks |

The booth-selection endpoints use the `BOOTH_CHOOSE` per-IP limiter. Guest tokens are application-specific HMAC status tokens; buyer routes additionally enforce contact ownership.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `BOOTH_HOLD_MS` | `900000` (15 min) | Vendor hold lifetime |
| `BOOTH_SWEEP_INTERVAL_MS` | `60000` (1 min) | Expired-hold sweep cadence |
| `RATE_LIMIT_BOOTH_CHOOSE_LIMIT` / `_WINDOW_MS` | limiter defaults | Per-IP booth selection/cancellation cap |

The backend schedules the booth sweep with unref'd timers. Tests may invoke `BoothService.sweepExpiredHolds` directly.

## Key Files

| File | Purpose |
|---|---|
| `backend/src/services/BoothService.js` | Locking, hold/sell/release operations, expiry sweep |
| `backend/src/services/ApplicationService.js` | Authorization, selection orchestration, cancellation and application transitions |
| `backend/src/services/ApplicationPaymentService.js` | Stripe/Checkout state, idempotent payment transitions, receipts |
| `backend/src/services/MapService.js` | Map CRUD, publication and public serialization |
| `backend/src/api/routes/applications.js` | Guest status-link selection and cancellation routes |
| `backend/src/api/routes/buyerAuth.js` | Buyer-session selection and cancellation routes |
| `frontend/src/components/maps/BoothPicker.tsx` | Tier-filtered map picker, buy sheet, countdown, stale-state refresh |
| `frontend/src/app/events/[eventId]/apply/status/[applicationId]/page.tsx` | Guest vendor purchase surface |
| `frontend/src/app/organizations/[orgId]/account/AccountClient.tsx` | Signed-in buyer application purchase surface |
| `frontend/src/components/maps/PublicMap.tsx` | Shared accessible SVG map renderer |

## Testing

- `backend/tests/unit/boothPurchase.test.js` — purchase state machine, expiry and payment outcomes.
- `backend/tests/unit/boothService.test.js` — locking and booth state rules.
- `backend/tests/contract/boothPurchases.test.js` — guest/buyer authorization, approved-only rule, concurrent one-winner hold, stale conflict, webhook-to-sold, Checkout cancellation, card decline/retry, staff collision, and map-bound form constraints.
- `backend/tests/contract/applicationPayments.test.js` — surrounding card-on-file, Checkout, webhook and idempotency behavior.
- `frontend/e2e/public-booth-purchase.spec.ts` — card and no-card success paths, stale availability, decline/retry UI, assigned-booth fallback, and unapproved applicant gating in Chromium and Firefox.

## Known Limitations

- One booth per application and one map per event.
- Booth choice is after approval only; choosing during submission is deferred.
- The public map does not cache in Redis. Correctness is preferred over cached reads.
- Public vendor profiles, searchable directory/key, PDF export, reusable map templates, and menu map targets are phase 3.
- Browser E2E mocks the backend at the network boundary; real PostgreSQL locking, order persistence, and payment failure recovery are covered by backend contract tests rather than a live Stripe browser session.
