# Cart Line-Item Breakdown

**Status:** Implemented
**Last Updated:** 2026-09-12

## Overview

Every ticket line in the customer cart shows its all-in price as a disclosure control: the amount has a dotted underline and a caret. Clicking it opens an accordion beneath the line listing the cost components that make up that price (base price, service fee, processing fee, tax, line total); the caret points down while open to signal it can be clicked again to close. An **Expand all / Collapse all** text toggle sits flush right on the same row as the cart heading and opens or closes every line at once. The behaviour is identical on the desktop sticky Order Summary, the mobile "Your Cart" drawer, and the checkout page Order Summary.

Shipping this also fixed a pre-existing mismatch: cart lines were priced as `single-ticket all-in × qty` (charging Stripe's fixed $0.30 per ticket) while the cart total charged it once and ignored tax. Lines now use the same proportional allocation as the backend, so the visible line totals always add up to the visible order total.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/lib/fees.ts` | Single copy of `FEE_CONFIG`, `computeOrderFees` (order totals + per-line allocation), `computeTierAllInPrice`, `formatPrice`. Mirrors `backend/src/services/FeeService.js` |
| `frontend/src/components/CartLineItem.tsx` | One cart line: price disclosure button (dotted underline + caret) and the breakdown accordion. `compact` variant for the desktop summary, `drawer` variant for the mobile sheet and checkout |
| `frontend/src/components/ExpandCollapseAll.tsx` | "Expand all" / "Collapse all" toggle (`aria-pressed`) placed on the heading row |
| `frontend/src/app/events/[eventId]/page.tsx` | Owns `openLines` state shared by the desktop column and the mobile drawer; renders both lists from `cartFees.lines` |
| `frontend/src/app/checkout/[eventId]/page.tsx` | Same components on the checkout Order Summary; its own `openLines` state |
| `frontend/tests/unit/fees.test.ts` | Vitest: order math matches backend, fixed fee once per order, lines sum to totals, drift lands on the largest line |
| `frontend/e2e/cart-line-breakdown.spec.ts` | Playwright: dotted underline, accordion open/close + caret, expand/collapse all placement and behaviour on desktop, drawer and checkout, line totals equal cart total, open state shared across viewports |

## Configuration

No environment variables. `FEE_CONFIG` in `lib/fees.ts` must stay in sync with `backend/src/config/fees.js`.

## How It Works

### Fee allocation (`computeOrderFees`)

1. Order-level: `subtotal = Σ price × qty`; `platformFee = 5% × subtotal`; `processingFee = 2.9% × (subtotal + platformFee) + $0.30`; `tax = subtotal × taxRate`; `total = sum`. Identical to the backend.
2. Per line: each fee is split across lines in proportion to the line's base value (`base / subtotal`), rounded to cents.
3. Drift: after rounding, any leftover cents for platform fee, processing fee and tax are added to the line with the largest base so `Σ line.total === total` exactly. (The backend corrects platform + processing drift the same way; the frontend also corrects tax drift because the tax figure is displayed per line.)

`computeTierAllInPrice` (single ticket as its own order) is still used on the tier cards above the cart; it equals `computeOrderFees([{price, quantity: 1}])`.

### State

- Event page: `openLines: Record<tierId, boolean>`. Both the desktop list and the mobile drawer read from it, so a line opened in the drawer is still open after rotating to desktop.
- `allLinesOpen = cartTiers.length > 0 && cartTiers.every(t => openLines[t.id])`. The toggle label is `Collapse all` when true, `Expand all` otherwise; clicking sets every current cart tier to `!allLinesOpen`. Closing any single line therefore flips the label back to `Expand all`.
- Tiers whose quantity drops to zero are simply not in `cartTiers`, so stale keys in `openLines` are ignored.
- Toggle is disabled when the cart is empty (event page only — checkout always has items).

### Markup / a11y

- Price: `<button aria-expanded aria-controls={regionId}>` with `data-testid="cart-line-price"`. The amount span carries `border-b border-dotted border-current`. The caret is a right-pointing chevron that rotates 90° (`rotate-90`) when open.
- Accordion: `<div role="region" hidden={!open} data-testid="line-breakdown">` with rows Base price `(qty × unit)`, Service fee, Processing fee, Tax (omitted when 0), Line total (`data-testid="line-breakdown-total"`).
- Line wrapper: `data-testid="cart-line" data-open="true|false"`.
- Lists: `data-testid="cart-lines-desktop" | "cart-lines-mobile" | "cart-lines-checkout"`.
- Toggle: `data-testid="expand-collapse-all"`, `aria-pressed`. In the mobile drawer it sits between the "Your Cart" title and the close button (which now has `aria-label="Close cart"`).

## Gotchas

- Do not re-add local `FEE_CONFIG` / fee helpers to a page — import from `lib/fees.ts`. Two diverging copies were the root cause of the old line-vs-total mismatch.
- A line's total is **not** `tierCard.allIn × qty`: the $0.30 fixed fee is charged once per order and shared across lines. Customers who add a second ticket will see the first line's price drop by a few cents; this is correct and matches what Stripe charges.
- Desktop and mobile carts are both in the DOM on the event page (`hidden lg:block` / `lg:hidden`). Tests must scope by the list `data-testid`, and `getByTestId('expand-collapse-all')` returns two elements — use `.first()` (desktop) / `.last()` (drawer) or scope from the heading.
- The e2e spec mocks `GET /events/:id`; run it with `PLAYWRIGHT_PORT` / `NEXT_PUBLIC_API_URL` pointing at the frontend/backend pair you have running (worktree default 3011 → 3012).

## Related Features

- [All-In Pricing](all-in-pricing.md) — what the customer-facing totals include
- [Fee Calculation](fee-calculation.md) — backend `FeeService` the frontend math mirrors
- [Tax Calculation](tax-calculation.md) — source of `event.taxRate`
- [Price Tiers](price-tiers.md) — base pricing
