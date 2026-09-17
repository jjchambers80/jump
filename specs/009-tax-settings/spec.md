# Feature Specification: Settings › Tax (Shopify-style Tax Configuration)

**Feature Branch**: `feat/009-tax-settings`, `feat/009-tax-phase-2`, `feat/009-tax-phase-3`, `plan/009-tax-settings`  
**Created**: 2026-09-14  
**Status**: Implemented — phases 1-3 on origin/main  
**Post-spec changes**: Stripe Tax field names pinned against `stripe@17` types; §5.1 (tax on service fees) and §5.4 (seller of record) remain undecided; §5.2 and §5.3 shipped as recommended; SettingsNav moved to its own component.  
**Input**: "Do some research about the existing tax service that we have in our system and under the Settings menu create a new menu item called Tax. On the page have a similar configuration as seen on this Shopify example. Determine whether these are settings/features we need; if not exclude, if so include, and put together a proper implementation plan."  
**Builds on**: spec 001 fee/tax model, spec 007 tenant identity, spec 008 Settings UI patterns

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Organization views Stripe Tax service status (Priority: P1)

An organization admin navigates to Settings > Tax and sees a "Tax service" card showing "Stripe Tax" with a status pill: Active (green), Pending setup (amber), or Unavailable (grey). The status reflects the platform's Stripe Tax account state. When Active, the card also shows the number of active Stripe Tax registrations. A "Manage" link (SYSTEM_ADMIN only) opens the Stripe dashboard tax settings.

**Why this priority**: Organizations currently have no visibility into whether Stripe Tax is working. If it is not active, rates will silently be 0%.

**Independent Test**: Call `GET /admin/settings/tax` and verify the response includes `service.status` and `service.registrationCount`. Verify the UI renders the correct pill and count.

**Acceptance Scenarios**:
1. **Given** the platform Stripe account has Stripe Tax active with 5 state registrations, **When** an admin loads Settings > Tax, **Then** they see "Stripe Tax" with a green "Active" pill and "5 active registrations" secondary text.
2. **Given** Stripe Tax is pending setup, **When** the page loads, **Then** the pill shows amber "Pending setup" and a note: "Stripe Tax is not activated on the platform account. Regions set to Stripe Tax will calculate 0% until it is."
3. **Given** the Stripe API cannot be reached, **When** the page loads, **Then** the pill shows grey "Unavailable."
4. **Given** a SYSTEM_ADMIN viewing the card, **When** they click "Manage," **Then** a new tab opens to `https://dashboard.stripe.com/settings/tax` (or `/test/settings/tax` in test mode).
5. **Given** an ORGANIZER viewing the card, **When** they see "Manage," **Then** it is not rendered or is disabled.

---

### User Story 2 — Organization configures a tax region (Priority: P1)

An organization admin sees a "Tax regions" table derived from the organization's venues. Each venue's US state becomes a region row. For each region, the admin can set whether to collect tax and whether to use Stripe Tax (automatic) or a manual rate. When Stripe Tax is chosen, the system shows a "no registration" warning if the platform account lacks an active registration for that state. When manual is chosen, the admin enters a percentage rate applied to all venues in that state.

**Why this priority**: Per-region tax configuration is the primary functional deliverable. Without it, the organization cannot control where and how tax is collected.

**Independent Test**: Set a region to "Collecting" with Stripe Tax, verify the rate lookup runs. Switch to Manual at 5.3%, verify upcoming events show that rate. Set to "Not collecting," verify events show 0% tax.

**Acceptance Scenarios**:
1. **Given** the organization has venues in North Carolina and Virginia, **When** the Tax regions table loads, **Then** it shows two rows: "North Carolina" and "Virginia," each with Collecting and Tax service columns.
2. **Given** a region row set to Stripe Tax with no platform registration for that state, **When** the row renders, **Then** it shows a "no registration" warning pill.
3. **Given** a region row, **When** an admin (ADMIN/SYSTEM_ADMIN) clicks it, **Then** an "Edit tax region" dialog opens with Collecting toggle, Tax service radio (Stripe Tax / Manual rate), and a manual rate input.
4. **Given** a manual rate of 5.30% is set for a region, **When** the organization's upcoming events in that state are viewed, **Then** their tax rate shows 5.30% and `Event.taxRateSource` is `MANUAL`.
5. **Given** a region set to "Not collecting," **When** a customer purchases a ticket for an event in that state, **Then** the order has `taxAmount: 0`.

---

### User Story 3 — Venues without a state (Priority: P2)

The Tax regions table includes a "Needs address" row when the organization has venues lacking a `state` field. Clicking the row shows a list of those venues with links to edit them.

**Why this priority**: Venues without states cannot have a valid tax configuration. This is a guidepost for the admin to fix incomplete venue data.

**Independent Test**: Create a venue without a state. Verify the "Needs address" row appears in the Tax regions table with a link to the venue.

**Acceptance Scenarios**:
1. **Given** an organization has 2 venues without a `state` value, **When** the Tax regions table renders, **Then** it shows a "Needs address" row with "2 venues have no state."
2. **Given** an admin clicks the "Needs address" row, **When** the action is triggered, **Then** a list of the incomplete venues appears with links to `/admin/venues/:id`.

---

### User Story 4 — Action needed banner (Priority: P2)

When a derived region (a US state where the organization has venues) has no TaxRegion row (i.e., no configuration has been set), an "Action needed" banner appears above the table. Events in that state collect no tax until the organization chooses a configuration.

**Why this priority**: Without this banner, an admin may not realize a new venue's state is collecting no tax — the silent 0% bug from spec 009 research.

**Independent Test**: Add a venue in a new state the organization has not configured. Verify the banner appears with the state name and "collects no tax" warning.

**Acceptance Scenarios**:
1. **Given** an organization has a venue in Texas but no TaxRegion row for Texas, **When** the Tax page loads, **Then** an amber "Action needed" banner appears: "Texas has venues but no tax setting. Events there collect no tax until you choose one."
2. **Given** all derived regions have TaxRegion rows, **When** the Tax page loads, **Then** no banner is shown.
3. **Given** the banner is visible and the admin configures the region, **When** the page is refreshed, **Then** the banner disappears.

---

### User Story 5 — Tax-inclusive pricing (Priority: P3)

An admin enables "Include sales tax in ticket prices" in Additional configuration. When checked, listed tier prices are treated as all-inclusive: the listed price is the final price, and the tax amount is backed out at the event's rate rather than added on top. The buyer sees "Includes $X.XX tax" on the tier card and receipt instead of a separate "+ $X.XX tax" line. A confirm dialog warns the admin before enabling.

**Why this priority**: Tax-inclusive pricing is common in EU and for US organizers who want "all-in" pricing ($50 ticket = $50, nothing added). However, it changes buyer perception and fee math, so it requires an explicit decision and confirmation.

**Independent Test**: Enable tax-inclusive pricing for an organization. Create a $50 tier with 8.25% tax. Verify the buyer sees "Includes $3.81 tax" on the tier card and the order `taxAmount` is backed out of the $50, not added on top.

**Acceptance Scenarios**:
1. **Given** an admin in Additional configuration, **When** they toggle "Include sales tax in ticket prices," **Then** a confirm dialog shows an example: "$50.00 tier at 8.25% → $46.19 + $3.81 tax."
2. **Given** tax-inclusive pricing is enabled and a tier costs $50 with 8.25% tax, **When** a buyer views the tier card, **Then** it shows "$50 · Includes $3.81 tax" instead of "$50 + $4.13 tax."
3. **Given** tax-inclusive pricing is enabled, **When** the order is created, **Then** `FeeService` computes the tax by backing it out of the listed price: `taxAmount = listedPrice - (listedPrice / (1 + taxRate))`.

---

### User Story 6 — Collected tax report (Priority: P3)

An admin views Settings > Tax > Report and sees a date-range table showing, per region, the number of orders, taxable sales total, tax collected, and tax refunded (estimated). A "Download CSV" button exports the data. Refunded tax is estimated proportionally because refunds do not store a tax split, and the page notes this.

**Why this priority**: Organizations remitting sales tax manually need this to file their returns. Without it, they must run custom database queries.

**Independent Test**: Generate orders spanning multiple regions over a date range. Verify the report shows correct totals per region and the CSV matches the table.

**Acceptance Scenarios**:
1. **Given** an organization with completed orders in NC and VA over the past month, **When** the admin opens the tax report with that date range, **Then** the table shows two rows with order count, taxable sales, and tax collected per region.
2. **Given** an order with a partial refund, **When** the report is generated, **Then** the "Tax refunded" column shows the estimated amount (refund amount ÷ order total × order tax), and a note says "Estimated — refunds do not store a tax split."
3. **Given** the report is loaded, **When** the admin clicks "Download CSV," **Then** a CSV file is downloaded with the same data as the table.
4. **Given** a date range with no orders, **When** the report loads, **Then** it shows zero rows with a "No orders in this period" empty state.

### Edge Cases

- What happens when an organization has no venues? The Tax regions table is empty; the tax service card is shown; no regions can be configured until a venue is created.
- What happens when a venue's state is changed? `VenueService._refreshEventTaxRates()` recalculates the tax for all events at that venue using the new state's region configuration.
- What happens when an API key is rotated (test → live)? The service status is re-evaluated on the next page load; the cache is invalidated.
- What happens when Stripe Tax registrations change? The registration count is fetched live on each page load (no cache) so the status is always current.
- What happens when tax-inclusive pricing was enabled but the org later disables it? All existing events keep their cached rates; only new events/publishes will use exclusive pricing.
- What happens when a region is set to Stripe Tax but Stripe Tax is unavailable? The lookup falls back to 0%; the region row shows the `lastError`.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Settings > Tax MUST show a "Tax service" card with Stripe Tax status pill (Active / Pending setup / Unavailable) and active registration count.
- **FR-002**: Tax regions MUST be derived from the organization's venue states (US states).
- **FR-003**: Each region row MUST show Region name, Collecting status, and Tax service (Stripe Tax / Manual / Not set).
- **FR-004**: An admin (ADMIN/SYSTEM_ADMIN) MUST be able to edit a region: set Collecting on/off, choose Stripe Tax or Manual rate.
- **FR-005**: Manual rate MUST be a Decimal(6,5) in range 0-100%.
- **FR-006**: A "Needs address" row MUST list venues without a state.
- **FR-007**: An "Action needed" banner MUST appear when a derived region has no TaxRegion row.
- **FR-008**: Changing a region's configuration MUST trigger tax rate recalculation on upcoming events in that state.
- **FR-009**: The collected tax report (`/admin/settings/tax/report`) MUST show per-region orders, taxable sales, tax collected, and estimated tax refunded, with date range filter and CSV export.
- **FR-010**: Tax-inclusive pricing toggle MUST show a confirm dialog with an example before saving.
- **FR-011**: ORGANIZER role MUST see Tax pages as read-only (rows clickable but dialogs open disabled with "Ask an admin").

### Key Entities

- **TaxRegion**: Organization, country (default "US"), region (US state code), collecting, source (Stripe/Manual), manualRate, lastRate, lastSource, lastCheckedAt, lastError.
- **Organization.taxInclusivePricing**: Boolean, default false. When true, FeeService backs out tax from the listed price.
- **Event.taxRateSource**: TaxSource enum (STRIPE / MANUAL), tracks which source produced the cached tax rate.
- **TaxService**: Service for `getServiceStatus`, `listRegions`, `upsertRegion`, `recalculateEvents`, `getTaxReport`.
- **TaxService card**: Admin-visible status card showing Stripe Tax engine health.
- **EditTaxRegionDialog**: Modal dialog for configuring one region's collection and source.
- **TaxRegionsTable**: SummaryRow-style table of regions with status indicators.
- **TaxReport page**: `/admin/settings/tax/report` — collected tax report with CSV export.
- **TaxInclusiveConfirmDialog**: Confirmation dialog for enabling tax-inclusive pricing.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An admin can see Stripe Tax status and configure all regions for their organization within 2 minutes of landing on the page.
- **SC-002**: Changing a region from Not collecting to Collecting (Stripe Tax) recalculates and caches the rate on upcoming events within 5 seconds.
- **SC-003**: The collected tax report CSV is downloadable in under 10 seconds for a 12-month range with up to 50 states.
- **SC-004**: An ORGANIZER who cannot edit can still see every region's current status and last lookup result.
- **SC-005**: Organizations that do nothing get backward-compatible behaviour (migration creates `collecting: true` rows for existing regions).

## Assumptions

- Stripe Tax is the only tax engine; no third-party tax providers.
- Tax is venue-based (where the event happens), not buyer-based.
- A single platform Stripe account serves all organizations (no Stripe Connect for tax).
- Tax rate is cached on Event at create/venue change/publish time, not calculated per order.
- Refunded tax estimate via proportion is acceptable — refunds do not store tax splits.
- Tax region states are US only initially; international expansion would add country code.