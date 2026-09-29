# Spot Chooser (vendor floor-map workspace)

**Status**: Implemented (PR #240, in production 2026-09-29)
**Last Updated**: 2026-09-29

## Overview

An approved vendor on a floor-map (MAP) application form picks their spot in a two-step workspace:

1. **Choose your spot**: the floor map and a list of open spots in the vendor's category, kept in sync.
2. **Extras and payment**: add-ons and how to pay, then hold the spot and pay. This step appears only when there is something to decide.

On the status page the workspace takes the whole screen. The buyer account shows the same component stacked. The rules for what a vendor may choose and how it is priced are in [Vendor Space Selection](vendor-space-selection.md).

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/applications/SpotWorkspace.tsx` | The workspace: map pane (legend, zoom / fit controls), spot list, "Other categories" reference list, step 2 review, action bar. Owns the map fetch (ETag), selection, sort and step |
| `frontend/src/components/applications/ChooseSpace.tsx` | Mounts `SpotWorkspace` when `usesSpotWorkspace(app)`; owns holding, charging, polling, notices and the held view. Builds the extras (`AddOnPicker`) and "How you pay" fields passed in as step 2 |
| `frontend/src/app/events/[eventId]/apply/status/[applicationId]/page.tsx` | Status page. With the workspace: `ApplyShell width="full" hero="compact"` and a compact application summary + footer (answers in a `<details>`, account link) handed to `ChooseSpace` |
| `frontend/src/app/events/[eventId]/apply/ApplyShell.tsx` | `width: 'full'` (edge-to-edge `main`) and `hero: 'compact'` (one bar: back button, date tile, title, event, date and venue) |
| `frontend/src/components/maps/MapCanvas.tsx` | `ariaLabel` prop; `transformRef` drives fit, zoom and centring |
| `frontend/src/components/maps/Booth.tsx` | Unselectable booths get `tabIndex={-1}` |
| `frontend/src/components/maps/boothSelection.ts` | `selectability`, `sortSpots`, `spotPrice` (shared rules, Vitest) |
| `frontend/e2e/public-booth-purchase.spec.ts` | Desktop sync + saved card, mobile layout, pinned map + full screen, Checkout, taken spot, declined card, single step + hold / release |

`BoothPicker.tsx` and `SpotList.tsx` were removed; the workspace replaces both.

## Configuration

None. It mounts for approved vendors on PAID MAP forms, which need `APPLICATIONS_PAYMENTS_ENABLED` ([Applications](applications.md#configuration)).

## How It Works

### When it mounts

`usesSpotWorkspace(app)` in `ChooseSpace.tsx` is true when all of these hold:

- The application is APPROVED.
- `selection.mode` is `MAP` and `selection.state` is `CHOOSE`.
- There is no staff-placed booth and no `categories` pick.
- The category is set, and the map is available and not pending.

Otherwise `ChooseSpace` renders its narrow views: held, waiting for the map, TIERS, or placed booth.

### Layout

**Phone (mobile first)**:

- Compact hero.
- The map at full width and short (`38svh`, 15–26 rem; `45svh` from `sm`), pinned to the top of the screen (`sticky top-0`) while everything below scrolls under it.
- The legend (scrolls away; it is not pinned).
- The application summary (form · category, business, status badge, "Choose and pay by …").
- The step header and the spot list.
- A fixed bottom action bar, which appears once a spot is chosen.

In step 2 the map is hidden so the review sits at the top.

**Desktop (`lg`+)**: a grid of `minmax(0,1fr)` and `minmax(22rem,28%)`.

- The map fills the left column. It is sticky at `h-dvh`, with the legend and the zoom / fit buttons floating on it.
- The right column holds the summary, the step header, the list or review, the footer, and the action bar (sticky at the column's bottom).

**Buyer account (`layout="inline"`)**: everything stacks. The action bar is sticky within the card.

**Full screen** (every layout): the **Full screen** pill (top left; bottom left on `lg`, under the floating legend) turns the map box itself into a `fixed inset-0` overlay (`role="dialog"`, `aria-modal`). The page stops scrolling, Tab stays inside, and Escape or the bottom bar's **Done** / **Back to list** closes it. The bottom bar holds the legend and the chosen spot with its price. The map refits on enter and exit, within what the pill row and the bottom bar leave visible, and re-centres the chosen spot. Leaving step 1 or starting a hold closes full screen.

### Sync between map and list

- **Map to list**: tapping an open booth checks its radio row. On `lg` it also scrolls the row into view.
- **List to map**: choosing a row marks the booth and centres it at the current zoom (`setTransform`, instant under reduced motion).
- **Map viewport**: the map fits once on load and again when the width changes by 24 px or more. Height changes, such as a phone's address bar, never undo the vendor's zoom. Entering or leaving full screen refits explicitly.

### What the list shows

- **Open spots**: only open spots of the vendor's category, in a radio group. Sort by spot (natural order) or by lowest price. The header shows how many are open and the price range.
- **Other categories**: below, under **Other categories**, every other category's spots, grouped in legend order. They are greyed and dashed, with size, state (Taken / Reserved / Blocked / Held) and price. They are plain `<li aria-disabled>` rows, never radios and never tab stops. Spots with no category are omitted.

### Why a spot cannot be chosen (PR #242)

Tapping a locked booth on the map shows a tip at the tap point (`spot-disabled-tip`, `role="status"`). `Booth` passes the click through `onDisabledClick`, `MapCanvas` passes it on as `onDisabledBoothClick`, and `SpotWorkspace.reasonFor` picks the text:

- another category ("Spot B1 is for Smoke Test Booth. You are approved as Food truck, so it cannot be chosen.")
- taken, on hold, reserved, or not for sale (no category)
- "Go back to step 1 to change your spot." during step 2

The tip is clamped inside the map, with its arrow on the tapped point. It closes on its close button, Escape, the next tap on the map, a step change, a map refetch, or after 6 s. Locked booths are not tab stops, so keyboard and screen-reader users get the same facts from the list's **Other categories** section.

### Steps

- **Step 2 exists only when** the category offers extras or the vendor has a saved card (`review` is non-null).
- **Without step 2,** step 1's button is `space-hold` ("Hold this space and pay $X") and holds directly.
- **With step 2,** step 1's button is `space-continue`. Step 2 shows:
  - the spot with **Change**
  - `AddOnPicker`
  - "How you pay"
  - line items
  - `space-hold` with the total (one fee calculation, `estimateSpaceTotal`)
- **Focus**: moving between steps focuses the step heading. The page scrolls to it only when it is off screen or low on it.

### Holding and outcomes

`onHold(boothId)` calls `ChooseSpace.hold`, which returns a `HoldOutcome`, and the workspace then refetches the map.

- **`taken`** (409 `BOOTH_TAKEN`): the selection clears and the workspace goes back to step 1.
- **A declined saved card**: the vendor stays on step 2 and "How you pay" switches to the checkout page.
- **A successful hold**: the application refreshes to `state: HELD`. The page drops back to the normal layout with the held view, countdown and "Change my choice".

## API Endpoints

No new endpoints. The workspace reads `GET /events/:eventId/map` (the public map, with ETag) and posts `select` / `pay` through the caller's `SpaceApi`: guest `?token=` routes, or buyer `app/api/buyer/me/applications/[id]/*`. See [Vendor Space Selection](vendor-space-selection.md#api-endpoints).

## Database

None.

## Gotchas

- **`ChooseSpace` must keep one tree position on the status page.**
  - A hold switches the page from the workspace to the held layout. If `ChooseSpace` remounted, its settle poll (`pollRef`), `busy` and notice would be lost, and a saved-card charge would sit on "Confirming your payment" until a reload.
  - The page therefore renders it in one wrapper `<div>` whose class alone changes, and `ApplyShell` keeps `<main>` at the same slot for both widths.
- **Full screen is a class change, never a portal.** Moving the map box into a portal would remount `MapCanvas` and lose its transform. The pane raises itself to `z-50` while full, because the pinned pane (`sticky z-20`) is a stacking context the overlay would otherwise be trapped in, under the `z-30` action bar. Keep ancestors free of `transform` / `filter` / `backdrop-filter`, or `fixed` stops covering the screen.
- **Two legends are in the DOM**: one floating on the map (`lg`) and one under it (stacked). Only one is visible at a time. Scope e2e assertions with `locator('visible=true')`.
- **The radios are `sr-only`.** Click the row label in tests (`getByTestId('spot-option').filter({ hasText })`). A forced `check()` on the 1 px input can miss.
- **The action bar is `fixed` on phones.** The spots column adds `pb-40` while a spot is chosen so nothing hides behind it.
- **Storefront colours stay on brand tokens.** Tier swatches come from `mapTheme.ts` (the only place map colours live).

## Related Features

- [Vendor Space Selection](vendor-space-selection.md): MAP / TIERS rules, per-spot prices
- [Applications](applications.md): apply-then-choose, holds, payment
- [Floor Maps and Vendor Booth Purchases](floor-maps.md): booth holds and the sold state
- [Add-ons](add-ons.md): the extras in step 2
