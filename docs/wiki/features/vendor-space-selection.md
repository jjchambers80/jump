# Vendor Space Selection (floor map or tiers)

**Status**: Implemented (spec 039, cards 039A–039D, 2026-09-29)
**Last Updated**: 2026-09-29

## Overview

Each paid application form sets **how an approved vendor chooses their space**:

- **Tiers**: the vendor pays for a space type, and the organizer places them on the floor later. The organizer either approves the vendor into a tier or lets the vendor pick one.
- **Floor map**: the vendor picks a spot on the event's floor plan. They can pick only spots of the category the organizer approved them for, so a food truck cannot take a table. Each spot can have its own price.

Vendors still apply for free and choose after approval ([apply-then-choose](applications.md#apply-then-choose-spec-037-phase-5)). This page covers only what they choose and how it is priced.

Plan and decisions D1–D11: `specs/039-vendor-space-selection/plan.md`. PRs: #226 (plan), #227 (039A schema and prices), #229 (039B rules), #230 (039D vendor screen), #234 (039C organizer screens).

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | `SpaceSelectionMode` enum, `ApplicationForm.spaceSelection`, `Booth.price`, `Application.tierChosenByVendor` |
| `backend/src/services/orderLines.js` | `spacePriceFor({ tier, booth })`: the one place that decides what a space costs before fees |
| `backend/src/services/OrderLineService.js` | `applicationOrderData(…, { booth })`: prices the tier line from the booth and names it `"<tier> · <label>"` |
| `backend/src/services/ApplicationService.js` | `decide` (category rules per mode, `_assertSpotsInCategory`), `select` (per-mode rules, vendor-picked tier), `changeTier` (locks a vendor-picked tier), `_selectionView` (applicant payload) |
| `backend/src/services/ApplicationPaymentService.js` | `releaseSelection`: gives a vendor-picked tier and its slot back |
| `backend/src/services/ApplicationFormService.js` | Validates `spaceSelection`, `_assertMapReady` (D9), `_assertSpaceSelectionChangeable` (D8), templates and duplication |
| `backend/src/services/MapService.js` | Saves `price` per booth under a row lock and refuses changes on in-use booths; public payload booth `price` and legend `priceFrom` / `priceTo`; duplication copies prices |
| `backend/src/services/ApplicationTemplateService.js` | CHOOSE_SPACE merge fields `space.onMap`, `space.pickTier`; hides the single price on MAP forms |
| `backend/src/scripts/backfill-039-space-selection.js` | Sets forms that already sold from a published map to MAP |
| `frontend/src/components/applications/ChooseSpace.tsx` | Vendor screen: tier radio group, or **Map \| Spots** tabs, waiting state, held state |
| `frontend/src/components/applications/SpotList.tsx` | Accessible, sortable list of the vendor's open spots with their prices |
| `frontend/src/components/maps/BoothPicker.tsx` | Floor-map picker: other categories faded and locked, per-spot price |
| `frontend/src/components/maps/boothSelection.ts` | `spotPrice`, `priceRangeLabel`, `sortSpots` (Vitest) |
| `frontend/src/components/applications/FormEditorCards.tsx` | Form setting "How vendors choose their space" |
| `frontend/src/app/admin/events/[eventId]/applications/DecisionDialog.tsx` | Approve dialog: "Let the vendor choose" (TIERS) or a required category (MAP) |
| `frontend/src/components/maps/builder/InspectorPanel.tsx`, `builder/pricing.ts` | Builder "Spot price" field, bulk price, lock on in-use spots |
| `frontend/src/components/maps/BoothPanel.tsx` | Assign dialog: explains the spot price an unpaid vendor pays |

## Configuration

No new environment variables. Paid forms still need `APPLICATIONS_PAYMENTS_ENABLED` ([Applications](applications.md#configuration)).

After deploying 039A, run the backfill once. It is a dry run unless `DRY_RUN=false`, and it is idempotent. Production was run on 2026-09-28 and changed 0 forms.

```
cd backend && npm run db:backfill:039-space-selection
cd backend && DRY_RUN=false npm run db:backfill:039-space-selection
```

## How It Works

### Pricing (D3)

- `Booth.price` is optional. When it is empty the spot costs its tier's price.
- The tier is still the category: it sets the legend colour, capacity, add-ons and fee mode.
- Every place that works out an application amount goes through `spacePriceFor`. That covers: the order opened by `select`; offline settlement and waiving; add-on edits; adjustments (whose floor is now the space price); the admin `pricing` preview; and the email `tier.price`.
- Each caller passes the booth the application holds or was placed on (`boothService.boothForApplication`).
- Once an order exists, its `OrderItem.unitPrice` is the record. A later price edit changes no order, receipt, refund or report.
- `MapService.replaceLayout` locks the map's booth rows (`FOR UPDATE`, the same lock `BoothService.chooseBooth` takes). Changing the price of a HELD, SOLD or RESERVED booth returns 409 `BOOTH_PRICE_LOCKED`.

### Floor-map forms (D2, D7, D9)

1. **Approval must name a category.**
   - 400 `CATEGORY_REQUIRED` for `tierId: null`.
   - 409 `NO_SPOTS_IN_CATEGORY` when the published map has no spot in that category.
2. **The vendor sees the whole map.** Only available spots of their category can be selected; other categories are faded and `aria-disabled`.
3. **The Spots tab lists the same spots** with size and all-in price, sortable by spot or price.
4. **`select` requires a `boothId` of that category** (400 `BOOTH_REQUIRED`). There is no category-only purchase, except when staff already placed the vendor.
5. **While the map is unpublished,** the applicant view returns `map.pending: true` and the screen shows "The floor plan is being updated".
6. **Opening a MAP form, or switching an open form to MAP,** needs a published map with at least one spot on every active tier (400 `MAP_NOT_READY` with `details.tiers`). A draft form may be set to MAP earlier, which is how a duplicated event (whose map copy is a draft) works.

### Tier forms (D4, D6)

1. **The Approve dialog defaults to "Let the vendor choose"**, sent as `tierId: null`.
   - The application becomes APPROVED + `AWAITING_SELECTION` with `tierId` null and no slot taken, even on a reserving form. The rest is first come.
   - Picking a tier instead locks it and reserves exactly as before.
2. **A vendor with no tier sees `selection.categories`**: every active tier with its all-in price, spaces left and add-ons.
   - `select({ tierId })` takes the slot (409 `SOLD_OUT` when full) and sets `tierId` + `tierChosenByVendor` in the selection transaction.
   - `releaseSelection` gives both back, so "Change my choice" can pick again.
3. **A locked tier cannot be swapped at selection** (409 `TIER_LOCKED`). `select` refuses a `boothId` (400 `BOOTH_NOT_OFFERED`); staff place the vendor from the map.
4. **An organizer tier change on a vendor who is still choosing** locks the tier and takes the slot a reserving approval would have taken.
5. **Offline settlement and waive stay refused until a tier exists** (`canSettleOffline`).

### The setting (D1, D8)

- `ApplicationForm.spaceSelection` applies to PAID forms only (`TIERS` by default).
- It cannot change while any vendor on the form is `AWAITING_SELECTION`, `PAYMENT_DUE` or `PROCESSING` (409 `SPACE_SELECTION_LOCKED`, `details.choosing`).
- Form templates, save-as-template and event duplication carry it. Map templates carry no prices (D11); event duplication copies them.

### Staff placement (D10)

A booth placed by staff before payment is the vendor's space, and they pay its price (its own price or the tier's). After payment, moving or placing a vendor never re-prices them; use an order adjustment. The assign dialog says so on a priced spot.

### Email

The CHOOSE_SPACE default reads:

- MAP forms: "Pick your spot on the floor map; each spot shows its price." No single price is quoted.
- Vendor-picks forms: "Pick the space type that fits you."

New merge field: `space.pickTier`. `space.onMap` now follows the form setting, not the map binding.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PATCH | `/admin/events/:eventId/application-forms/:formId` | Admin | `spaceSelection: 'TIERS' \| 'MAP'` (D8 lock, D9 on open) |
| POST | `/admin/events/:eventId/applications/:id/decision` | Organizer | `APPROVE` with `tierId` (id, or `null` = the vendor chooses on TIERS forms) |
| POST | `/admin/events/:eventId/applications/:id/preview` | Organizer | Same `tierId` semantics for the email preview |
| POST | `/admin/events/:eventId/applications/:id/tier` | Organizer | Locks a tier on a vendor who is still choosing (takes the slot on reserving forms) |
| GET | `/applications/:id/status?token=` | Status token | `selection.mode`, `tierLocked`, `category` or `categories`, `map` (`available`, `pending`, `boothsAvailable`, `priceFrom`, `priceTo`) |
| POST | `/applications/:id/select?token=` (and `/buyer/me/applications/:id/select`) | Status token / buyer | `{ boothId? , tierId?, addOns, useSavedCard? }` per the rules above |
| PUT | `/admin/maps/:mapId/layout` | Organizer | Booths accept `price` (number, `null` clears, omitted keeps) |
| GET | `/events/:eventId/map` | Public | Booth `price` (all-in) and legend `priceFrom` / `priceTo` |

## Database

- `enum SpaceSelectionMode { TIERS, MAP }`.
- `ApplicationForm.spaceSelection`, default `TIERS`.
- `Booth.price Decimal(10,2)?` (migration `20261014100000_vendor_space_selection`).
- `Application.tierChosenByVendor Boolean @default(false)` (migration `20261015100000_vendor_chosen_tier`).

See [Database Architecture](database-architecture.md).

## Gotchas

- **An APPROVED application can have `tierId` null** on a TIERS form while the vendor chooses. Every reader of an approved application must allow it; FREE forms already had null tiers.
- **Never read `tier.price` for an application amount.** Use `spacePriceFor({ tier, booth })`, or better, the order's lines.
- **The order line description includes the booth label** whenever a booth is involved ("Booth · A12"), even without a booth price.
- **Autosave in the builder always sends `price`.** A vendor holding a spot mid-edit makes the save fail with `BOOTH_PRICE_LOCKED`, and the builder reloads the map.
- **`admin-maps.spec.ts` is quarantined** (its full-screen test is flaky). Builder price coverage lives in `e2e/admin-map-booth-price.spec.ts`.

## Related Features

- [Applications](applications.md): apply-then-choose, approval, payment
- [Floor Maps and Vendor Booth Purchases](floor-maps.md): holds, sold state, public map
- [Floor Map Builder](map-builder.md): where spots and their prices are edited
- [Application orders](application-orders.md): the order a selection opens
- [Add-ons](add-ons.md): extras offered per tier
