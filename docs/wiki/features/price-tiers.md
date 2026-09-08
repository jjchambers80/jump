# Price Tiers

**Status:** Active
**Last Updated:** 2026-09-07

## Overview

Each event supports multiple price tiers (Early Bird, VIP, General Admission, etc.). Tiers track inventory independently with `quantityTotal`, `quantitySold`, and `quantityReserved`. Inventory reservation uses raw SQL `FOR UPDATE` row-level locking to prevent overselling under concurrency. Tiers support sale windows, visibility controls, per-order quantity limits, and drag-and-drop reordering.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/PriceTierService.js` | Tier CRUD, capacity validation, activation, reordering |
| `backend/src/api/routes/priceTiers.js` | Org-scoped tier endpoints nested under events |
| `backend/src/services/OrderService.js` | Inventory reservation via `FOR UPDATE` raw SQL |

## Configuration

| Field | Type | Description |
|-------|------|-------------|
| `name` | String | Tier display name |
| `description` | String? | Optional tier description |
| `price` | Decimal | Ticket price (0 or greater) |
| `quantityTotal` | Int | Total inventory for this tier |
| `quantitySold` | Int | Tickets with completed payment |
| `quantityReserved` | Int | Tickets in pending checkout |
| `displayOrder` | Int | Sort position (0-based) |
| `minPerOrder` | Int? | Minimum tickets per order |
| `maxPerOrder` | Int? | Maximum tickets per order |
| `isActive` | Boolean | Whether tier is purchasable |
| `visibility` | Enum | `PUBLIC`, `PRIVATE`, or `HIDDEN` |
| `saleStartDate` | DateTime? | Sale window open |
| `saleEndDate` | DateTime? | Sale window close |
| `isRefundable` | Boolean | Whether tier supports refunds |

## How It Works

1. **Create** (`POST .../price-tiers`): Validates `quantityTotal` is positive and that adding it to existing tiers does not exceed `Event.capacity`. Auto-assigns `displayOrder` as `max + 1` if not provided.
2. **Update** (`PATCH .../price-tiers/:priceTierId`): Validates new `quantityTotal` against capacity ceiling and floor (`quantitySold + quantityReserved`). Cannot reduce below already committed inventory.
3. **Activate/Deactivate** (`POST .../activate` or `.../deactivate`): Toggles `isActive` flag. Inactive tiers cannot be purchased.
4. **Reorder** (`POST .../price-tiers/reorder`): Accepts ordered `tierIds` array. Updates `displayOrder` for each tier in a transaction.
5. **List** (`GET .../price-tiers`): Public view filters out `HIDDEN` tiers and tiers outside sale window. Pass `?includeAll=true` for admin view.
6. **Inventory reservation** (in `OrderService.createOrder`): Uses raw SQL `UPDATE ... WHERE (quantityTotal - quantitySold - quantityReserved) >= $quantity` with implicit row lock to atomically reserve inventory. Returns empty result if insufficient -- triggers `ConflictError`.
7. **Inventory finalization** (in `TicketService.createTicketsForOrder`): After payment, moves inventory from `quantityReserved` to `quantitySold` via `increment`/`decrement`.
8. **Computed fields**: API response includes `quantityAvailable` (`quantityTotal - quantitySold - quantityReserved`), `isOnSale`, and `saleStatus` (`ON_SALE`, `NOT_STARTED`, `ENDED`).

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/organizations/:orgId/events/:eventId/price-tiers` | Public | List tiers (filtered by visibility/sale window) |
| POST | `/organizations/:orgId/events/:eventId/price-tiers` | Organizer | Create tier |
| PATCH | `/organizations/:orgId/events/:eventId/price-tiers/:priceTierId` | Organizer | Update tier |
| POST | `.../price-tiers/:priceTierId/activate` | Organizer | Activate tier |
| POST | `.../price-tiers/:priceTierId/deactivate` | Organizer | Deactivate tier |
| POST | `.../price-tiers/reorder` | Organizer | Reorder tiers |

## Gotchas

- **`quantitySold + quantityReserved` must never exceed `quantityTotal`.** Enforced at reservation time by atomic SQL `WHERE` clause and at update time by floor validation.
- **Reordering uses `displayOrder` field** -- not array index. Transaction updates all tiers to avoid gaps.
- **Capacity is a ceiling, not a floor.** Sum of all tier `quantityTotal` can be less than `Event.capacity` (partial allocation is valid).
- **Price can be 0** (free tiers) but not negative.
- **Sale status is computed at response time** from `saleStartDate`/`saleEndDate` -- not stored.
- **Inventory rollback on Stripe failure**: If Stripe Checkout session creation fails, `OrderService` decrements `quantityReserved` and marks order FAILED.

## Related Features

- [Event Management](event-management.md) -- tiers belong to events, capacity ceiling
- [Guest Checkout](guest-checkout.md) -- inventory reserved during order creation
- [Ticket Issuance](ticket-issuance.md) -- reserved inventory moved to sold on payment
