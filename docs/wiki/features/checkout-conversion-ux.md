# Checkout Conversion & Accessibility

**Status:** Implemented
**Last Updated:** 2026-09-27

## Overview

The storefront purchase path (event page → checkout → Stripe → confirmation) was audited for conversion, mobile-first layout and WCAG 2.1 AA. The rule it enforces: **the next action is always on screen**. On desktop the checkout form sits beside a sticky order summary so the pay button lands in the first viewport (verified at 1366×768); below `lg` the summary collapses to one row and the pay button rides in a fixed bottom bar with the total (verified at 375×667). The event page adds a mobile "Get tickets · from $X" bar before anything is in the cart, and backing out of Stripe no longer empties the cart.

Payment logic, capacity and fee math are unchanged: the page posts the same `POST /orders` body and all amounts still come from `lib/fees.ts`.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/app/checkout/[eventId]/page.tsx` | Two-column checkout (form + sticky summary), collapsible mobile summary, fixed mobile pay bar, Tickets → Details → Payment steps, accessible form, 409 handling. Wrapped in `<Suspense>` for `useSearchParams` |
| `frontend/src/app/events/[eventId]/EventDetailClient.tsx` | `?status=cancelled` banner + cart restore, mobile "Get tickets" bar, checkout button inside the mobile cart sheet, dialog semantics on every sheet/modal |
| `frontend/src/app/confirmation/page.tsx` | Live-region status (PENDING → COMPLETED is announced), all tier names, "More events from <org>" back to the storefront, clears the saved cart |
| `frontend/src/lib/checkoutDraft.ts` | `sessionStorage` cart (per event id) + contact draft; every access guarded, the flow works without it |
| `frontend/src/lib/emailTypo.ts` | "Did you mean …?" for mistyped email domains / TLDs (suggestion only, never blocks) |
| `frontend/src/lib/useDialog.ts` | Escape to close, focus into the panel, Tab trap, focus returned to the opener |
| `frontend/tests/unit/emailTypo.test.ts` | Vitest for the suggester |
| `frontend/e2e/checkout-ux.spec.ts` | Pay button inside the viewport (phone + desktop), invalid-field focus / `aria-invalid` / `aria-describedby`, email suggestion, sold-out alert, Stripe-cancel restore, Get tickets bar |

## How It Works

### Checkout layout
- Grid `lg:grid-cols-[minmax(0,1fr)_24rem]`; the summary `aside` is `lg:order-2 lg:sticky`. Fee rows are a `<dl>` (Tickets / Service fee / Processing fee / Tax / Total) — fees shown before Stripe, not after.
- Below `lg` the summary body is `hidden` behind a `aria-expanded` toggle that still shows the total and ticket count. The inline pay button is `hidden lg:block`; the fixed bar (`data-testid="checkout-mobile-bar"`, `lg:hidden`) holds a second submit button tied to the form with `form="checkout-form"`. Only one of the two is ever visible, so role queries find one button.
- CTA copy: **Continue to payment — $X** with a lock icon; a trust line under it says the card is entered on Stripe.

### Form accessibility
- `autocomplete` `given-name` / `family-name` / `email`, `inputMode="email"`, no autocapitalise/spellcheck on email, 16 px inputs (no iOS zoom), 20 px checkboxes, `noValidate` with custom messages.
- Submit validates all fields, sets `aria-invalid` + `aria-describedby` to the `<field>-error` text, and focuses the first invalid field. Blur validates only fields that have content.
- A server error renders a `role="alert"` box that receives focus. A 409 whose message mentions inventory shows "Those tickets just sold out" with a link back to the tickets; the hold-cap 409 (spec 020) shows its own message.

### Returning from Stripe
- On submit, after `POST /orders` succeeds, `saveCheckoutDraft(event.id, { items, addOns })` stores the cart. Contact fields are mirrored to `sessionStorage` per organization (`jump.checkout.contact.<orgId>`) as they change and prefill the next checkout at that organization only (a signed-in buyer's profile fills only blanks).
- Stripe's `cancel_url` is `/events/:slug?status=cancelled`. The event page reads it after loading the event, shows an amber `role="status"` banner ("Payment not completed — you haven't been charged") and restores quantities for tiers still on sale, clamped to current availability and per-order limits, so the checkout bar/summary is populated immediately.
- The confirmation page clears the cart draft once the order is not `FAILED`.

### Event page
- Mobile bar states: RSVP (unchanged) · empty cart → **Get tickets · from $X** (lowest all-in price, hidden while the `#tickets` heading is on screen, focuses the first "+" stepper) · cart → cart button + **Checkout $X**.
- The mobile cart sheet is a `role="dialog"` with its own **Checkout $X** button; tier info, image and description modals are dialogs with labelled close buttons, Escape, and focus return (`useDialog`).
- Page bottom padding is `pb-24 lg:pb-0` so the fixed bar never covers content between `sm` and `lg`.

## Gotchas

- **Never trust the draft for money.** It only refills quantities; prices, availability and fees are recomputed from the event payload and re-validated by `POST /orders`.
- **`sessionStorage` can throw** (private mode, blocked storage). Keep all access inside `checkoutDraft.ts`.
- **No transition on themed inputs.** `transition-colors` on the inputs animated them from white to dark when `BrandScope` forced dark mode after hydration, leaving them grey in screenshots. Keep colour transitions off form fields on storefront pages.
- **Two submit buttons, one visible.** New checkout tests must scope to visible elements; the hidden one is `display:none` so `getByRole` ignores it.
- `ExpandCollapseAll` keeps `aria-pressed` (asserted by `cart-line-breakdown.spec.ts`).

## Related Features

- [Guest Checkout](guest-checkout.md) — order creation and Stripe redirect
- [Cart Line-Item Breakdown](cart-line-item-breakdown.md) — per-line fee accordion used in the summary
- [Customer Accounts Settings](customer-accounts-settings.md) — sign-in link + prefill on checkout
- [Abuse Protection](abuse-protection.md) — the open-hold 409 shown on checkout
