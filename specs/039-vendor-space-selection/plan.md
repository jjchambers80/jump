# Spec 039 — Vendor space selection: floor map or tiers

Status: plan approved, not started (decisions final 2026-09-28)
Builds on: spec 011 (applications), spec 014 (floor map), spec 037 phase 5 (apply-then-choose, PR #216)
Supersedes: spec 037 **D6** ("one vendor flow, no per-form switch") for the *choose* step only. Apply-then-choose itself stays.

## 1. Problem

After approval a vendor lands on **Choose your space** (`ChooseSpace.tsx`). Today:

- The organizer must pick the category (`ApplicationTier`) in the Approve dialog. The vendor never chooses a tier.
- The page shows a **List** tab ("any space in your category, the organizer places you") and, only when the event's published map has booths bound to that category, a **Map** tab. The organizer cannot decide which of the two the vendor gets.
- Every booth costs its tier's price. A corner booth and an aisle booth in the same category cost the same unless the organizer invents a tier per price point.

Requested behaviour:

1. The organizer configures, per application form, whether vendors **choose a spot on the floor map** or **choose a tier**.
2. **Map mode**: the vendor sees the floor plan and picks a spot. Spots can have their own price. Vendors must only be able to pick spots of the kind they were approved for (a food truck must not take a table).
3. **Tier mode**: no map. The vendor picks one of the tiers the organizer configured; the organizer places them later.
4. Selection still happens **after approval** (apply-then-choose is unchanged).

## 2. Decisions (confirmed with JJ 2026-09-27)

| # | Decision |
|---|----------|
| D1 | New per-form setting `ApplicationForm.spaceSelection`: `TIERS` \| `MAP`. PAID forms only. |
| D2 | **Map mode keeps the category lock.** The organizer picks the category in the Approve dialog (spec 037 D4, unchanged). The vendor sees the whole map, but only booths bound to their category are selectable; the others render dimmed with "Not in your category". `BoothService.chooseBooth` already refuses `booth.tierId !== application.tierId`. |
| D3 | **Per-booth price override.** New nullable `Booth.price`. Empty = the tier's price. The tier stays the category (legend swatch, capacity, add-ons, fee mode). |
| D4 | **Tier mode: the vendor picks the tier after approval.** The approval does not have to name a category. |
| D5 | Selection timing stays after approval. Booth-first PRs #179 / #186 are superseded (see §9). |

## 3. Further decisions (recommendations accepted by JJ 2026-09-28)

**D6 (was O1). Tier mode and "approval guarantees a space" (`reserveOnApproval`).** A slot is reserved *in a tier*; if the vendor picks the tier later there is nothing to reserve against.
Decision: the Tier-mode Approve dialog offers **"Let the vendor choose"** (default, no slot taken, first come) or **a specific tier** (locks it and reserves exactly as today). The form setting text explains that only a locked tier guarantees a space. This also covers the "food truck must not pick a table" risk in tier mode: the organizer locks the tier when it matters.

**D7 (was O2). Map mode: keep the "any space, organizer places me" list option?**
Decision: **no**. In map mode the second tab becomes an accessible **Spots list** of the same selectable booths (label, size, price, sortable), not the category-only purchase. Keyboard, screen-reader and small-screen users need it; organizers who want "organizer places me" use tier mode.

**D8 (was O3). When can the organizer switch the setting?**
Decision: freely until the first application on the form is approved; after that only if no application is in `AWAITING_SELECTION` / `PAYMENT_DUE` / `PROCESSING` (409 `SPACE_SELECTION_LOCKED` with the count). Paid vendors are unaffected either way.

**D9 (was O4). Map mode prerequisites.**
Decision: saving `MAP` requires the event's map to be **published** with at least one booth bound to each active tier of the form (422 lists the tiers without booths). If the map is later unpublished, the vendor sees "The floor plan is being updated — check back soon" instead of a picker, and the Approve dialog warns.

**D10 (was O5). Staff-placed booth price.** Today a booth placed by staff before payment means "pay for the category only".
Decision: before payment the vendor pays the **placed booth's price** (override or tier); the assign dialog shows the price change. After payment, placement never re-prices; staff use an order adjustment.

**D11 (was O6). Map templates.** Decision: templates stay geometry-only (spec 014 rule) — no prices. Event duplication copies `Booth.price`.

## 4. Data model

```prisma
enum SpaceSelectionMode {
  TIERS
  MAP
}

model ApplicationForm {
  // …
  spaceSelection SpaceSelectionMode @default(TIERS) // spec 039; PAID forms only
}

model Booth {
  // …
  price Decimal? @db.Decimal(10, 2) // spec 039: overrides tier.price when set
}
```

Migration `2026xxxx_vendor_space_selection`: additive enum + two nullable/defaulted columns. Enum in its own migration file (spec 037 pattern) so the value commits before use.

**Backfill** (`db:backfill:039-space-selection`, dry run by default, idempotent): a PAID form whose event has a published map with booths bound to any of its tiers → `MAP` (it shows a Map tab today); every other form → `TIERS`. In-flight `AWAITING_SELECTION` applications keep their `tierId`, so they keep working in both modes.

`Application.tierId` may now stay `null` on an APPROVED application (tier mode, "let the vendor choose") until selection. That is the main risk; see §8.

## 5. Backend

### 5.1 One price source
New `spacePriceFor({ tier, booth })` → `booth?.price ?? tier.price`, used by `OrderLineService.applicationOrderData` (new optional `booth` argument; line description `"<tier> · <booth label>"`). Every caller that recomputes an application amount today goes through it:

- `ApplicationService.select` (order creation / reopen)
- `_selectionView` (applicant preview)
- the three recompute sites around `ApplicationService.js:1774`, `:1808`, `:2373`
- `ApplicationTemplateService` email amounts (`:106`)

Once the order exists its `OrderItem.unitPrice` is the record (spec 024 one ledger); nothing reads the live booth price after payment. Contract test: changing `Booth.price` after payment changes no order, receipt, refund or report.

### 5.2 Map
- `MapService` save: accept `price` per booth (≥ 0, 2 decimals, `null` clears); unchanged booths keep theirs.
- Public map payload: each booth gets `price` (all-in, the form's fee mode via `tierAmounts`) and the legend gets `priceFrom` / `priceTo` per tier.
- Refuse a price change on a booth that is `HELD` or `SOLD` (409 `BOOTH_PRICE_LOCKED`) so a vendor never pays a different price than the one they held.
- Map publish keeps deriving `quantityTotal` for bound tiers.

### 5.3 Form setting
- `validateUpdateForm`: `spaceSelection` whitelist key, PAID only; D8 lock + D9 prerequisites in `ApplicationFormService`.
- Form templates (`ApplicationFormTemplateService.SETTING_KEYS`) and event duplication carry it.
- Public / admin form serializers expose it.

### 5.4 Approval
- `MAP`: category required (as today). Refuse when the category has no booth on the published map (409 `NO_SPOTS_IN_CATEGORY`).
- `TIERS`: `tierId` optional ("let the vendor choose", no slot) or given (locks, reserves per `reserveOnApproval`) — D6.

### 5.5 Selection (`POST /applications/:id/select`, guest + buyer)
Body gains `tierId`.

| Mode | `boothId` | `tierId` | Rule |
|------|-----------|----------|------|
| `MAP` | required | ignored | booth must be AVAILABLE, on the published map, in the application's category; price = `spacePriceFor` |
| `TIERS`, tier locked | refused | must equal the locked tier or be omitted | as today's list path |
| `TIERS`, vendor chooses | refused | required, active tier of the form | takes a slot (`_takeTierSlot`, 409 `SOLD_OUT`), sets `application.tierId` in the same transaction |

Add-ons are validated against the chosen tier. `releaseSelection` (single release path) also clears a vendor-chosen `tierId` back to `null` so "Change my choice" can pick another tier; a locked tier is kept.

`_selectionView` returns `mode`, and either `categories[]` (tier mode: id, name, description, all-in price, spaces left, add-ons) or `category` + `map` (map mode, booth count, price range).

## 6. Screens

### Organizer
1. **Form settings › How vendors choose their space** (`FormEditorCards.tsx`, PAID only): two radio cards.
   - *Choose a tier* — "Vendors pick one of your tiers. You place them on the floor later."
   - *Choose a spot on the floor map* — "Vendors pick a spot within the category you approve them for. Spots can have their own price." Disabled with a link to the Map tab when D9 is not met; lists the tiers without spots.
   Next to it the existing "approval guarantees a space" setting, with the tier-mode caveat (D6).
2. **Approve dialog** (`DecisionDialog.tsx`): map mode — category required, shows "12 spots open, $250–$400". Tier mode — "Let the vendor choose" first option, then each tier.
3. **Map builder › Inspector** (`InspectorPanel.tsx`): Price field under Tier, placeholder = tier price ("Uses tier price $250"), Reset link. Multi-select sets one price on all. Canvas badge on booths with an override. Locked with a tooltip when HELD / SOLD.
4. **Submissions table / detail**: category column shows "Vendor choosing" for a null tier on an approved application; the Awaiting space chip stays. Extend `SubmissionsTable`, never fork it.
5. **Assign booth dialog**: shows price difference before payment (D10).

### Vendor (`ChooseSpace.tsx`, guest status page + buyer account — both already share it)
1. **Tier mode**: "Choose your space" → radio-card group of tiers (name, description, all-in price, spaces left, sold-out cards disabled). Selecting a tier shows its extras. Total + "Hold this space and pay $X". A locked tier renders as today's single card (the screenshot).
2. **Map mode**: `Map | Spots` tablist (Map default).
   - Map: whole floor plan, own-category booths selectable with price on hover/focus, other categories dimmed and patterned (not colour alone), sold / held greyed. Selected booth panel: label, size, price, "Hold this spot". Mobile: bottom sheet.
   - Spots: table of selectable booths — label, size, price — sortable; same select action.
   - Extras, total and pay block below the chosen spot; total uses the booth's price.
3. **Held state**: unchanged layout; shows "Spot A12 · 10×10 · $325" and "Change my choice".
4. **Waiting state** (D9): map unpublished → notice, no picker.
5. **Emails**: `CHOOSE_SPACE` copy varies by mode ("pick your spot on the floor plan" / "pick your space"); receipts show the booth line from the order.

Storefront colours through `brand` tokens only; no motion on the hold / pay steps.

## 7. Delivery (cards)

| Card | Scope | Depends on | Risk |
|------|-------|------------|------|
| **039A** schema + price source | enum, columns, migration, backfill script, `spacePriceFor` in every recompute site, order line description, map save / public payload / price lock | — | high (money) |
| **039B** mode rules | form setting + validators + D8/D9, templates + duplication, approval per mode, `select` with `tierId`, release clears vendor tier, `_selectionView` per mode | A | high (capacity) |
| **039C** organizer UI | form setting card, Approve dialog, builder price field + bulk, submissions "Vendor choosing", assign dialog price | B | medium |
| **039D** vendor UI | ChooseSpace tier radio group, Map/Spots with dimmed categories + booth prices, held / waiting states, email copy | B | medium |
| **039E** docs | wiki `applications.md` + `floor-map` page, `backend/AGENTS.md` gotcha (one price source, tierId can be null when approved), CLAUDE.md gotcha line | C, D | low |

Each card is a PR with the required CI green. Run the backfill on prod right after 039A deploys, before B.

## 8. Risks

- **`tierId` null on APPROVED** (tier mode). Every reader that assumes a tier after approval must be audited: `_selectionView`, digest, overdue sweep, CSV export, submissions table, vendor directory, door check-in, `moneyOf`, refund paths. Card B includes a grep-driven checklist and a contract test per surface.
- **Price drift**: a price edit between hold and pay. Mitigated by the HELD/SOLD lock (§5.2) and the order line snapshot.
- **Mode switch with vendors mid-selection**: D8 lock.
- **Capacity in tier mode without a lock**: first come, enforced by `_takeTierSlot` `FOR UPDATE`; approved vendors may find their preferred tier full — copy says so up front.
- **Stale open PRs** touching the same code (#177, #181, #186) — resolve before 039A (§9).

## 9. Housekeeping before work starts

- Close **#179** (booth-first spec) and **#186** (booth-first implementation): superseded by apply-then-choose + D5.
- Re-check **#177** (booth hold concurrency) and **#181** (release booth on every ending decision) against main: `releaseSelection` from #216 may already cover #181; #177's locking may still be worth landing first.

## 10. Tests

Backend contract:
1. Map mode: select a booth in own category with an override → order line = override price (+ fees/tax), description includes label.
2. Map mode: booth of another category → 409; booth without override → tier price.
3. Price edit on a HELD booth → 409 `BOOTH_PRICE_LOCKED`; after payment, price edit changes no order / receipt / report.
4. Tier mode, vendor chooses: select with `tierId` takes slot + sets tier atomically; full tier → 409 `SOLD_OUT`; release clears the tier; locked tier cannot be changed.
5. Approve: map mode without category → 422; category without spots → 409; tier mode with no tier → ok, no slot.
6. Setting: `MAP` without published map / with a tier lacking booths → 422; switch with a vendor `AWAITING_SELECTION` → 409.
7. Backfill: dry run / apply / idempotent; map-bound forms → `MAP`.
8. Null-tier audit: digest, CSV, submissions list, directory render an approved vendor-choosing application.

Frontend: Vitest for the price range / selectability helpers (`boothSelection.ts`); Playwright (mocked API, CI shards) for tier radio flow, map flow with dimmed categories + Spots tab keyboard selection, builder price field.

## 11. Out of scope

Choosing on the apply form (booth-first), free forms, per-booth add-ons, dynamic pricing, map templates with prices, more than one map per event.
