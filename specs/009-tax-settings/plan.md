# Implementation Plan: Settings › Tax (Shopify-style tax configuration)

**Status**: Phase 1 implemented 2026-09-14 on branch `feat/009-tax-settings` (service card, regions table, edit dialog, backend + migration, tests, docs). Stripe Tax field names pinned against `stripe@17` types (§2.1). Phase 2 implemented 2026-09-14 on `feat/009-tax-phase-2` (Recalculate now, upcoming-event count, tax line on the admin event page). Phase 3 open; §5 decisions still unanswered.
**Input**: "Do some research about the existing tax service that we have in our system and under the Settings menu create a new menu item called Tax. On the page have a similar configuration as seen on this Shopify example. Determine whether these are settings/features we need; if not exclude, if so include, and put together a proper implementation plan."
**Reference screen**: Shopify Settings › Taxes and duties — a `Tax service` card (`Shopify tax services • Active`, `Manage`), a `Tax regions` table (Region | Collecting | Tax service, with Shopify Tax / Basic Tax / Manual Tax per region and a `Global collected tax report` link), a `Duties and import taxes` card (collect at checkout, Customs information: country of origin, HS codes), and `Additional configuration` checkboxes (include sales tax in product price, charge sales tax on shipping, charge VAT on digital goods).
**Builds on**: spec 001 fee/tax model, spec 007 tenant identity (`activeOrgFor` scoping), spec 008 Settings UI patterns.

---

## 1. What already exists

Tax is implemented end-to-end today, but it is invisible to the organization: no page shows it, nothing lets an organization choose whether or how it collects, and every failure degrades silently to a 0% rate.

| Layer | Exists today | File |
|-------|--------------|------|
| Lookup | `TaxService.getTaxRateForVenue(postalCode, country='US')` — one `stripe.tax.calculations.create` with a $100 reference line, tax code `txcd_20060057` (event admissions), `address_source: 'shipping'` (venue = where the service is delivered); returns `tax_amount_exclusive / 10000`. **Any error or missing postal code returns 0 and only logs.** | `backend/src/services/TaxService.js` |
| Cache | `Event.taxRate Decimal(6,5)?` — written by `EventService._refreshTaxRate()` on create, on venue change, and on publish. Never refreshed when the venue's address changes. | `packages/db/prisma/schema.prisma:293`, `backend/src/services/EventService.js:594` |
| Math | `FeeService.computeOrderFees(items, taxRate)`: `tax = subtotal × taxRate`, exclusive (added on top). Platform and processing fees are **not** taxed. | `backend/src/services/FeeService.js`, mirrored in `frontend/src/lib/fees.ts` |
| Persisted | `Order.taxAmount`; per-item unit tax on `OrderItem`; `Ticket.pricePaid` | `OrderService.js:174-193` |
| Checkout | Stripe Checkout receives one all-in `unit_amount` per tier (base + allocated fees + tax). Stripe `automatic_tax` is **not** used; Stripe never sees tax as tax. | `OrderService.js:222-246` |
| Refunds | Refund whole `totalAmount` / `pricePaid`; refunded tax is not tracked separately. | `RefundService.js` |
| Customer UI | Tier cards, cart accordion, checkout and confirmation all show the `Tax` line from `event.taxRate`. | `frontend/src/lib/fees.ts`, `CartLineItem.tsx`, `OrderTotals.tsx` |
| Settings shell | `SettingsNav` (`General`, `Domains`, `Users`), `SummaryRow`, `SettingsDialog`, `icons.tsx`; admin routes scoped by `activeOrgFor(req)` (X-Jump-Org header, spec 007) | `frontend/src/app/admin/settings/*`, `backend/src/api/routes/admin.js:36-45` |
| Config | `STRIPE_SECRET_KEY` only — one platform Stripe account for every organization. No Stripe Connect. | |
| Tests | `feeService.test.js` (87 lines), `eventService.test.js` (`taxRate: null` fixture). **No test covers `TaxService`.** | |
| Docs | `docs/wiki/features/tax-calculation.md`, `all-in-pricing.md`, `fee-calculation.md`; `backend/AGENTS.md:56-59` | |

**Verdict**: keep the lookup, cache-on-event, and fee math. Add an organization-level layer *above* the lookup that decides, per region, whether tax is collected and by which method, and a page that shows the organization what is happening.

---

## 2. Research findings that change the design

### 2.1 Stripe Tax only collects where the *platform's* Stripe account is registered

Stripe Tax calculates tax only in jurisdictions that have an active **tax registration** on the account (`stripe.tax.registrations`). Elsewhere the calculation returns `tax_amount_exclusive: 0` with `taxability_reason: 'not_collecting'`. Since Jump uses one platform `STRIPE_SECRET_KEY` for every organization, today's "is tax collected in Texas?" is answered by the platform operator's Stripe registrations, not by the organization whose event it is — and a 0 from "not registered" is indistinguishable from a 0 from "API failed" or "no postal code".

**Consequence**: the per-organization `Collecting` toggle from the Shopify screen is not cosmetic here; it is the only place an organization can express its own registrations. And a `Manual rate` option is required so an organization can collect in a state the platform account is not registered in.

**Verify in phase 1** (same caution spec 008 applied to Railway): `stripe.tax.settings.retrieve()` (`status: 'active' | 'pending'`), `stripe.tax.registrations.list({ status: 'active' })` (`country`, `country_options.us.state`), and `line_items.data[].tax_breakdown[].taxability_reason` on the calculation. Pin the exact field names against the installed `stripe` package before building the status card.

### 2.2 Silent 0% is a correctness bug, not a default

`TaxService` returns 0 on missing postal code, Stripe error, Stripe Tax not enabled, and not-registered. An organization that *is* registered in a state will under-collect with no signal. The page must show a per-region status (last lookup result, last error, rate observed) and `_refreshTaxRate` must persist the outcome rather than swallow it.

### 2.3 Shopify's sections, mapped to ticketing

| Shopify section | Purpose there | Applies to Jump? | Decision |
|-----------------|---------------|------------------|----------|
| **Tax service** card (`Shopify tax services • Active`, `Manage`) | Which engine calculates; whether it is enabled | Yes — Stripe Tax is the engine; whether Stripe Tax is enabled on the account is an operational fact the organization cannot see today | **Include.** `Stripe Tax` + status pill (`Active` / `Pending setup` / `Unavailable`). `Manage` is a SYSTEM_ADMIN-only link to the Stripe dashboard tax settings; members see the pill only. |
| **Tax regions** table (Region · Collecting · Tax service) | Where the merchant collects and remits; created from shipping zones | Yes — regions are where the organization's venues are (tax is venue-based, `address_source: 'shipping'`). Organizations need to say "we collect in NC and VA, not TX" and pick automatic vs manual per region | **Include** as the core of the page. Regions derived from the organization's venues (US state), not from a shipping-zone model we do not have. |
| Region search + sort | Merchants with dozens of countries | Organizations have a handful of states | **Exclude** (sort alphabetically). |
| **Global collected tax report** | Remittance | Yes — `Order.taxAmount` exists but no report; organizations remitting manually need "tax collected by state by month" | **Include** (phase 3): table + CSV. |
| **Duties and import taxes** (collect at checkout, DDP labels) | Cross-border physical goods | No — nothing ships | **Exclude.** |
| **Customs information** (country of origin, HS codes per variant) | Customs declarations | No | **Exclude.** |
| **Include sales tax in product price** | Tax-inclusive pricing (EU/AU norm; some US organizers price "$50 all-in") | Plausible — an organizer may want the listed tier price to be the final price with tax backed out | **Include as phase 3 option**, behind a decision (see §5). Requires mirrored math in `FeeService.js` and `fees.ts`. |
| **Charge sales tax on shipping** | Shipping is a taxable line in some regions | No shipping | **Exclude.** |
| **Charge VAT on digital goods** | EU VAT MOSS for digital products | Currency is `usd`, venues are US, tax code is admissions | **Exclude.** |
| *(not on Shopify)* Tax on service fees | Many states tax admission fees inclusive of service charges; Jump taxes base only | Real compliance question | **Defer** — list in §5, do not build without a tax-professional decision. |

### 2.4 Regions are US states keyed from `Venue.state`

`Venue` has `state` and `postalCode` (nullable), no country. `Organization.countryCode` defaults `US`. Region key = `(country='US', region=<2-letter state>)`. Venues without `state` cannot be assigned a region; the page shows them in a `Needs address` row that links to the venue. Rate lookup stays postal-code based (local rates vary within a state); the region row governs *whether* and *how*, not the exact rate.

### 2.5 Backward compatibility of the `Collecting` default

Today every event collects whatever Stripe returns. If new region rows defaulted to `Not collecting`, existing organizations would silently stop charging tax on the next event. **Decision**: the migration backfills one `TaxRegion` row per existing (organization, state) with `collecting: true, source: STRIPE` (behaviour unchanged). Regions that appear later (new venue in a new state) default to `collecting: false` and the page shows an `Action needed` banner until the organization decides — matching Shopify, where a new zone collects nothing until configured.

### 2.6 Cost

Stripe Tax calculations are billed per calculation (pay-as-you-go, currently $0.05 each). Jump makes one per event create/venue change/publish/region change, not per order, so cost is negligible; document it and keep it that way (no per-order recalculation).

Sources: Stripe Tax docs — Calculations API, Registrations API, Tax Settings API, "Tax behaviors and reasons" (`docs.stripe.com/tax`); Shopify "Setting up US taxes" and "Tax overrides and exemptions" (`help.shopify.com/en/manual/taxes`); existing code as cited in §1.

---

## 3. UX specification

Route: `/admin/settings/tax`. Nav item **Tax**, placed after `Domains`, visible to every staff role that can see Settings (ORGANIZER, ADMIN, SYSTEM_ADMIN). Editing regions requires ADMIN or SYSTEM_ADMIN; ORGANIZER sees read-only rows (dialog opens disabled with a note), mirroring how `Users` is role-gated.

```
Settings
Manage your organization and business information.

[General] [Domains] [Tax] [Users]      ┌──────────────────────────────────────────────┐
                                        │ 🧾 Tax                                        │
                                        │                                               │
                                        │ Tax service                        [Manage]* │
                                        │ ┌───────────────────────────────────────────┐ │
                                        │ │ ⚡ Stripe Tax          ● Active            │ │
                                        │ └───────────────────────────────────────────┘ │
                                        │                                               │
                                        │ Tax regions  ⓘ                                │
                                        │ States where your venues are located and      │
                                        │ where you collect and remit sales tax. Add a  │
                                        │ venue to add a region. If you're unsure about │
                                        │ your liability, check with a tax professional.│
                                        │ ┌───────────────────────────────────────────┐ │
                                        │ │ Region          Collecting   Tax service   │ │
                                        │ │ North Carolina  ● Collecting Stripe Tax   ›│ │
                                        │ │ Texas           — Not set    —   ⚠ Action ›│ │
                                        │ │ Virginia        ● Collecting Manual 5.3%  ›│ │
                                        │ │ Needs address   2 venues have no state    ›│ │
                                        │ └───────────────────────────────────────────┘ │
                                        │ ┌───────────────────────────────────────────┐ │
                                        │ │ 📄 Collected tax report                   ›│ │
                                        │ └───────────────────────────────────────────┘ │
                                        │                                               │
                                        │ Additional configuration                      │
                                        │ ☐ Include sales tax in ticket prices          │
                                        │   Listed tier prices are treated as final;    │
                                        │   tax is backed out at the region's rate.     │
                                        └──────────────────────────────────────────────┘
* Manage: SYSTEM_ADMIN only — opens Stripe dashboard tax settings.
```

### 3.1 Tax service card

- Provider is fixed: `Stripe Tax`.
- Pill from `GET /admin/settings/tax` → `service.status`:
  - `active` → green `Active`
  - `pending` → amber `Pending setup` with note "Stripe Tax is not activated on the platform account. Regions set to Stripe Tax will calculate 0% until it is." (visible to all roles so members understand why rates are 0)
  - `unavailable` → grey `Unavailable` (no key / API error), same note style.
- Secondary line: `N active registrations` when `active` (from `registrations.list`), so an ADMIN can see at a glance whether their state is covered.
- `Manage` (SYSTEM_ADMIN only): external link `https://dashboard.stripe.com/settings/tax`.

### 3.2 Tax regions table

One row per region derived from venues, alphabetical by state name. Columns:

| Column | Content |
|--------|---------|
| Region | State name, secondary `n venues` |
| Collecting | `● Collecting` / `Not collecting` / `— Not set` (no row yet) |
| Tax service | `Stripe Tax` (+ `⚠ no registration` badge when the platform account has no active registration for that state and `service.status === 'active'`), `Manual · 5.30%`, or `—` |

Row = `SummaryRow`-style button opening **Edit tax region** dialog (`SettingsDialog` shell, Cancel/Save header):

```
Edit tax region — Texas
  Collect sales tax in Texas        [toggle]
  Tax service                       (enabled only when collecting)
    ◉ Stripe Tax (automatic)
        Rates by venue postal code. Requires an active
        Stripe Tax registration for Texas.  ⚠ None found.
    ○ Manual rate
        [ 6.250 ] %   Applied to the ticket base price for every venue in Texas.
  Last lookup: 8.250% via Stripe Tax on Sep 12, 2026 · 3 upcoming events use this region
  ℹ Saving recalculates the tax rate on upcoming events in Texas. Orders already placed are not changed.
```

`Needs address` row (only when some venues lack `state`): lists the venues with links to `/admin/venues/:id`; no dialog.

`Action needed` banner above the table when any derived region has no row (`Not set`): "Texas has venues but no tax setting. Events there collect no tax until you choose one."

### 3.3 Collected tax report (phase 3)

`/admin/settings/tax/report`: date range (default: this calendar year to date), table `Region | Orders | Taxable sales | Tax collected | Tax refunded*`, totals row, `Download CSV`. `*` Refunded tax is estimated proportionally (refund amount ÷ order total × order tax) because refunds do not store a tax split — say so on the page.

### 3.4 Additional configuration (phase 3)

Single checkbox `Include sales tax in ticket prices` → `Organization.taxInclusivePricing`. Saving shows a confirm dialog with an example (`$50.00 tier at 8.25% → $46.19 + $3.81 tax`) because it changes what every customer sees.

---

## 4. Data model

```prisma
enum TaxSource {
  STRIPE
  MANUAL
}

model TaxRegion {
  id             String    @id @default(cuid())
  organizationId String
  country        String    @default("US")   // ISO 3166-1 alpha-2
  region         String                      // US state code, e.g. "NC"
  collecting     Boolean   @default(false)
  source         TaxSource @default(STRIPE)
  manualRate     Decimal?  @db.Decimal(6, 5) // required when source = MANUAL, 0..1
  // Observability for the page (§2.2)
  lastRate       Decimal?  @db.Decimal(6, 5)
  lastSource     TaxSource?
  lastCheckedAt  DateTime?
  lastError      String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, country, region])
  @@index([organizationId])
}

model Organization {
  // ...
  taxInclusivePricing Boolean     @default(false)  // phase 3
  taxRegions          TaxRegion[]
}

model Event {
  // ...
  taxRate       Decimal?   @db.Decimal(6, 5)  // unchanged
  taxRateSource TaxSource?                     // new: which path produced taxRate (null = legacy / not collecting)
}
```

Migration `add_tax_regions`: create enum + table + columns, then backfill (§2.5):

```sql
INSERT INTO "TaxRegion" ("id","organizationId","country","region","collecting","source","createdAt","updatedAt")
SELECT gen_random_uuid()::text, v."organizationId", 'US', upper(v."state"), true, 'STRIPE', now(), now()
FROM "Venue" v WHERE v."state" IS NOT NULL AND length(trim(v."state")) = 2
GROUP BY v."organizationId", upper(v."state");
```

`Venue.state` is free text today. The validator gains a 2-letter uppercase US state check (`venueValidators.js`) so region keys are stable; existing rows with long names (`North Carolina`) are normalised in the same migration via a state-name → code map in the migration script, and anything unmatched stays as-is and surfaces under `Needs address`.

---

## 5. Open decisions (need the user / a tax professional)

1. **Tax on service fees** — `tax = subtotal × rate` today; platform + processing fees are untaxed. Several states treat admission "service charges" as part of the taxable sale. Not building a toggle until decided; the plan makes adding one a one-line change in both fee libraries.
2. **Tax-inclusive pricing math** (phase 3) — when inclusive, is the platform fee computed on the net (base − tax) or on the listed price? Recommendation: fees on the net amount, tax backed out first, so the customer-visible total equals the listed price + fees. Confirm before phase 3.
3. **Default for regions that appear after launch** — plan says `Not collecting` + banner (Shopify behaviour). Alternative is `Collecting via Stripe` to match today's implicit behaviour. Recommendation stands: not collecting; over-collecting where unregistered is also a liability.
4. **Who remits** — single platform Stripe account means Stripe Tax registrations are the platform's. If organizations are the sellers of record, the platform should not be adding registrations on their behalf; `Manual rate` becomes the primary path for most organizations and the Stripe Tax path is a convenience where the platform *is* registered. This plan supports both; product needs to state which one is the norm in onboarding copy.

---

## 6. Backend

### 6.1 `TaxService` (rewrite around regions; keep the Stripe call)

```js
// backend/src/services/TaxService.js
resolveRegionForVenue(venue)            // → { country:'US', region:'NC' } | null
listRegions(orgId)                      // derived rows: venues grouped by state, left-joined to TaxRegion, + needsAddress venues
upsertRegion(orgId, country, region, { collecting, source, manualRate })  // validates; then recalculateEvents(orgId, country, region)
rateForVenue(orgId, venue)              // { rate, source, error } — 0/null when no row or !collecting; manualRate; or Stripe lookup (existing getTaxRateForVenue)
recalculateEvents(orgId, country, region) // DRAFT/PUBLISHED events with date >= now in that region → EventService._refreshTaxRate
getServiceStatus()                      // { provider:'STRIPE_TAX', status, registrations:[{country, region}] } cached 5 min in-process
getTaxSettings(orgId) / updateTaxSettings(orgId, { taxInclusivePricing })   // phase 3
collectedReport(orgId, { from, to })    // phase 3: group PAID orders by venue.state
```

`getTaxRateForVenue` keeps its signature but **throws** on Stripe error instead of returning 0; callers (`rateForVenue`) catch, write `lastError`, and return `{ rate: 0, error }`. A calculation whose breakdown says `not_collecting` is recorded as `lastError: 'No Stripe Tax registration for NC'`, rate 0.

### 6.2 `EventService._refreshTaxRate(event)`

Replace the direct `taxService.getTaxRateForVenue(postalCode)` with `taxService.rateForVenue(orgId, event.venue)`; persist `taxRate` and `taxRateSource`; on error keep the previous cached rate (do not overwrite a good rate with 0 because Stripe blipped) and log. Also call it from `VenueService.updateVenue` when `state` or `postalCode` change (closes the stale-cache gotcha in the wiki).

### 6.3 Admin routes (`backend/src/api/routes/admin.js`, all via `activeOrgFor(req)`)

| Method | Path | Body / query | Response | Role |
|--------|------|--------------|----------|------|
| GET | `/admin/settings/tax` | — | `{ service, regions[], needsAddress[], settings }` | organizer+ |
| PUT | `/admin/settings/tax/regions/:country/:region` | `{ collecting, source, manualRate? }` | updated region row + `recalculatedEvents: n` | admin+ |
| PATCH | `/admin/settings/tax` | `{ taxInclusivePricing }` | settings | admin+ (phase 3) |
| GET | `/admin/settings/tax/report?from&to&format=json\|csv` | — | rows + totals | organizer+ (phase 3) |

Validators: new `backend/src/api/validators/taxValidators.js` — `source ∈ {STRIPE, MANUAL}`, `manualRate` required when MANUAL, `0 ≤ manualRate ≤ 0.5`, up to 5 decimals; `region` matches `^[A-Z]{2}$`; `country === 'US'` for this release. Role check: reuse the pattern that gates `/settings/people` writes (ADMIN/SYSTEM_ADMIN).

### 6.4 Region-level Stripe registration hint

`getServiceStatus()` returns active registrations; `listRegions` marks each STRIPE-sourced row `registrationFound: boolean`. Purely informational; the lookup still runs.

---

## 7. Frontend

| File | Change |
|------|--------|
| `frontend/src/app/admin/settings/SettingsNav.tsx` | Add `{ href: '/admin/settings/tax', label: 'Tax' }` after Domains |
| `frontend/src/app/admin/settings/icons.tsx` | `TaxIcon` (receipt/percent glyph, same 20px stroke style) |
| `frontend/src/app/admin/settings/tax/page.tsx` | Page: heading, `TaxServiceCard`, `TaxRegionsTable`, report link, `AdditionalConfiguration` (phase 3). Same shell as `domains/page.tsx` (`SettingsNav`, `max-w-6xl`, `min-w-0 flex-1`) |
| `.../tax/TaxServiceCard.tsx` | Provider row + `StatusPill` (reuse `domains/StatusPill.tsx` variants: active/pending/failed) |
| `.../tax/TaxRegionsTable.tsx` | Table + `Action needed` banner + `Needs address` row |
| `.../tax/EditTaxRegionDialog.tsx` | `SettingsDialog` body: toggle, radio group, rate input (`inputMode="decimal"`, shown as percent, stored as fraction), last-lookup line, recalculation note. Focus returns to the row button on close (same `buttonRef` contract as `SummaryRow`) |
| `.../tax/useTaxApi.ts` | `get()`, `saveRegion()`, `updateSettings()`, `report()` over the shared `apiClient` (X-Jump-Org injected) |
| `.../tax/types.ts` | `TaxServiceStatus`, `TaxRegionRow`, `TaxSettings` |
| `.../tax/report/page.tsx` | Phase 3 |
| `frontend/src/lib/fees.ts` + `backend/src/services/FeeService.js` | Phase 3 only: `taxInclusive` branch, kept byte-for-byte equivalent between the two |

Org switcher: page waits for the switcher (same `useRef` gate as `settings/page.tsx`, PR #29) and refetches on org change.

---

## 8. Phases

### Phase 1 — Regions + page (ships the Shopify screen minus report/inclusive)
1. Prisma: `TaxSource`, `TaxRegion`, `Event.taxRateSource`, `Venue.state` normalisation; migration with backfill. `npm run db:generate`.
2. `TaxService` rewrite (§6.1), `_refreshTaxRate` change (§6.2), venue-update hook.
3. Admin `GET /settings/tax`, `PUT /settings/tax/regions/:country/:region`, validators, RBAC.
4. Pin Stripe Tax status/registration field names against a live test key (§2.1); cache 5 min.
5. Frontend nav item, page, service card, regions table, edit dialog.
6. Tests — unit: `taxService.test.js` (resolve region, not-collecting → 0, manual → rate, Stripe error → lastError + previous rate kept, `not_collecting` reason), `eventService.test.js` fixture gains `taxRateSource`; contract: `admin-tax.test.js` (scoping via X-Jump-Org, SYSTEM_ADMIN with `?organizationId=`, ORGANIZER 403 on PUT, validator errors, recalculation count); Playwright: `admin-tax-settings.spec.ts` (nav item present, row opens dialog, toggle + manual rate round-trip, focus restoration, `Not set` banner).
7. Docs: rewrite `docs/wiki/features/tax-calculation.md`, touch `all-in-pricing.md` gotchas, `backend/AGENTS.md` fee formula note (`taxRate` now region-resolved), wiki README index, `/doc-feature`.

### Phase 2 — Observability polish
- `lastRate / lastCheckedAt / lastError` surfaced in the dialog and as a `⚠` badge on the row.
- `Recalculate now` button in the dialog (re-runs lookups for the region's upcoming events).
- Event detail page (admin) shows `Tax: 8.25% · Stripe Tax · NC` with a link to Settings › Tax.

### Phase 3 — Report and inclusive pricing (each gated on §5 decisions)
- `GET /settings/tax/report` + `/admin/settings/tax/report` page + CSV.
- `Organization.taxInclusivePricing` + mirrored inclusive math + confirm dialog + customer-facing "incl. tax" label on tier cards.

### Explicitly out of scope
Duties/import taxes, customs (country of origin, HS codes), tax on shipping, VAT on digital goods, non-US regions, per-organization Stripe accounts (Connect), tax on service fees (decision 5.1), Stripe `automatic_tax` on Checkout sessions.

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Backfill marks a region as collecting for an organization that is not registered | Behaviour is unchanged from today; the page now makes it visible and one toggle fixes it. Release note to organizations. |
| Stripe Tax status call adds latency to the settings page | 5-minute in-process cache; status fetched in parallel with regions; page renders regions before the pill resolves. |
| `Venue.state` free text breaks region keys | Migration normalises known names; validator enforces 2-letter codes going forward; unmatched venues surface in `Needs address` rather than being silently untaxed. |
| Recalculating many events on region save | Limited to upcoming DRAFT/PUBLISHED events; one Stripe call per event; runs after the response is sent if > 20 events (log completion). |
| Frontend/backend fee math drift (phase 3) | `frontend/tests/unit/fees.test.ts` already compares against fixtures; add inclusive fixtures generated from the backend. |
