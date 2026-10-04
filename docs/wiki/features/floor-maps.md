# Floor Maps and Vendor Booth Purchases

**Status**: Implemented — builder/public map (phase 1) and approved-vendor self-service purchase (phase 2), 2026-09-21. Spec: `specs/014-floor-map/spec.md`.
**Last Updated**: 2026-09-26

## Overview

An event can have one SVG floor map. Organizers draw and number booths, bind each booth to an application tier, assign approved vendors, and publish the map. A published map is available on the event storefront and is read with `Cache-Control: no-store` plus an ETag derived from the map and booth update times.

Since spec 037 phase 5 (apply-then-choose) choosing a booth is one of the two ways an approved PAID vendor **chooses their space** — the other is the list (any open space in their category, placed by staff later). A tier is **map-bound** when the event's published map has booths bound to it: derived at read time (`BoothService.mapBoundTierIds` / `isMapBound`), the `ApplicationTier.mapBound` column is no longer read (dropped in spec 037 phase 6). Approval never charges: it assigns the category and moves the application to `AWAITING_SELECTION`. The booth is held under a database row lock, then either charged off-session with a saved card or carried into Stripe Checkout. Only a successful payment transition changes the booth from `HELD` to `SOLD`. See [Applications › Apply-then-choose](applications.md#apply-then-choose-spec-037-phase-5).

**Spec 039**: the form's `spaceSelection` now decides whether vendors pick on the map at all. On a MAP form they must pick a spot of their approved category; there is no list option. Spots can carry their own `Booth.price`. See [Vendor Space Selection](vendor-space-selection.md).

## Vendor Purchase Flow

1. The application must be `APPROVED` + `AWAITING_SELECTION` with a category, and own no booth (a booth staff placed means the vendor pays for the category from the list instead).
2. The guest status-link route or buyer-session route calls `ApplicationService.select` (`POST …/select { boothId, addOns, useSavedCard }`; `POST …/booth { boothId }` is the same without add-ons).
3. `BoothService.chooseBooth` runs inside the selection transaction: application locked first, booth second. It verifies the map is published, the booth is available and its tier is the application's category. The same transaction takes the category slot (when the form did not reserve one at approval), reserves add-ons and opens the order; the booth's `holdExpiresAt` equals `Application.selectionHeldUntil` (15 minutes).
4. `useSavedCard` attempts an off-session PaymentIntent. Success confirms the application/order and booth in one transition. A decline releases the whole selection (booth, add-ons, slot on a first-come form, order `CANCELLED`) and the vendor chooses again.
5. Otherwise the vendor pays on hosted Checkout (`PROCESSING` protects the hold). Backing out of Checkout while the hold still runs keeps the booth (`PAYMENT_DUE`); after it lapses, or when the session expires, the selection is released.
6. The payment webhook is authoritative. The browser never marks a booth sold.

Concurrent vendors may see the same booth as available, but the row lock gives exactly one caller the hold. Other callers receive `409 BOOTH_TAKEN`; the picker refetches the no-cache map before allowing another choice.

## State and Release Rules

- `AVAILABLE → HELD`: vendor chooses the booth.
- `HELD → SOLD`: Stripe success, offline settlement, or waiver confirms the application.
- `HELD → AVAILABLE`: card decline, hold expiry (`ApplicationPaymentService.sweepExpiredSelections` releases the whole selection; `BoothService.sweepExpiredHolds` leaves selection holds to it), an expired Checkout session or backing out after the hold lapsed, "Change my choice", withdrawal, or a full refund before another owner is assigned.
- A `PROCESSING` application keeps its booth even after the displayed hold deadline so a delayed Stripe result cannot sell money without inventory.
- Payment-success handling is idempotent. If money succeeds after booth state was unexpectedly lost, the application remains paid; payment is never rolled back because of inventory state.
- Staff assignment/move and vendor selection use the same application-before-booth lock order. One application cannot own or hold two booths.

## API

| Method | Path | Auth |
|---|---|---|
| POST | `/applications/:id/select?token=…` `{ boothId?, addOns?, useSavedCard? }` | Signed guest status token (spec 037 phase 5) |
| POST | `/applications/:id/release?token=…` | Signed guest status token (spec 037 phase 5) |
| POST | `/applications/:id/booth?token=…` `{ boothId }` | Signed guest status token |
| POST | `/applications/:id/cancel-checkout?token=…` | Signed guest status token |
| POST | `/buyer/me/applications/:id/select`, `…/release` | Buyer session, same contact and organization |
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
| `frontend/src/components/applications/SpotWorkspace.tsx` | Vendor picker (replaced `BoothPicker` in PR #240): the map beside a synced list of the category's open spots, other categories greyed; holds and payment stay in `ChooseSpace`. See [Spot Chooser](spot-chooser.md) |
| `frontend/src/app/events/[eventId]/apply/status/[applicationId]/page.tsx` | Guest vendor purchase surface |
| `frontend/src/app/organizations/[orgId]/account/AccountClient.tsx` | Signed-in buyer application purchase surface |
| `frontend/src/components/maps/MapCanvas.tsx` | Shared SVG map canvas (builder preview, public map, spot chooser) |
| `frontend/src/app/events/[eventId]/map/PublicMapClient.tsx` | Public map page. See [Public Floor Map Page](public-floor-map.md) |

## Testing

- `backend/tests/unit/boothPurchase.test.js` — purchase state machine, expiry and payment outcomes.
- `backend/tests/unit/boothService.test.js` — locking and booth state rules.
- `backend/tests/contract/boothPurchases.test.js` — guest/buyer authorization, approved-only rule, concurrent one-winner hold, stale conflict, webhook-to-sold, Checkout cancellation, card decline/retry, staff collision, and map-bound form constraints.
- `backend/tests/contract/applicationPayments.test.js` — surrounding card-on-file, Checkout, webhook and idempotency behavior.
- `frontend/e2e/public-booth-purchase.spec.ts` — choose your space: map with a saved card and on Checkout, stale availability, decline/retry, the list with keyboard tabs, the held countdown and release, a booth placed by staff, and an application under review.

## Known Limitations

- One booth per application and one map per event.
- Booth choice is after approval only (spec 037 D6: the apply form never shows booths).
- The public map does not cache in Redis. Correctness is preferred over cached reads.
- Public vendor profiles, searchable directory/key, PDF export, reusable map templates, and menu map targets are phase 3.
- Browser E2E mocks the backend at the network boundary; real PostgreSQL locking, order persistence, and payment failure recovery are covered by backend contract tests rather than a live Stripe browser session.
