# Feature Specification: Add-ons (Ticket Tiers and Application Tiers)

**Feature Branch**: `plan/012-add-ons`  
**Created**: 2026-09-17  
**Status**: Proposed — plan in [plan.md](./plan.md)  
**Input**: Organizer discovery interview on Eventeny, 2026-09-15 — [docs/research/2026-09-15-eventeny-organizer-interview.md](../../docs/research/2026-09-15-eventeny-organizer-interview.md) (stories ORG-08, VEN-03, PAY-01/02, pain point #6, pitfall #10). Hand-off from spec 011 §6 phase 3.  
**Builds on**: spec 003 (`PriceTier` capacity locking, `Order`/`OrderItem`), spec 009 (tax, tax-inclusive math, `FeeService`), spec 010 (Checkout options, Stripe Connect routing), spec 011 (`ApplicationForm`, `ApplicationTier`, amount snapshot, charge on approval, refunds, CSV, event duplicate).

## Problem

Organizers sell things alongside a ticket or a booth: power to the booth, extra vendor badges, a table and chairs, parking, a VIP lounge pass. Jump has no product other than a ticket tier or an application tier, so today these are either bundled into a tier's price (wrong for optional items) or handled off-platform. The interviewed organizer configured nothing at application time, invoiced power and badges after approval, split fees per invoice by hand, and called the result "a disaster" — next year they would rather push power to the venue's portal than repeat it. Add-ons must be set up with the tier and purchased in the same checkout as the ticket or application, with the all-in price visible before Stripe, and never as a surprise line at checkout.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Organizer defines add-ons on an event (Priority: P1)

An ADMIN opens an event's edit page and finds an **Add-ons** section next to price tiers. They create *Booth power — $125*, *Extra vendor badge — $10 (max 4)*, *Table & chairs — $40 (limited to 60)*, *Parking pass — $15*. Each add-on has a name, description, price, optional total quantity, optional per-order maximum, a taxable flag, and a scope: offered with **tickets**, with **applications**, or both. By default an add-on is offered on every tier in its scope; the organizer can restrict it to specific tiers (e.g. power only on vendor booths, not on sponsor tiers). Presets (power, extra badge, table & chairs, parking) create common add-ons in one click.

**Why this priority**: Everything else depends on add-ons existing; and pitfall #10 says the setup must happen *with* the tier, not after launch.

**Independent Test**: Create three add-ons via the API with different scopes and tier restrictions; fetch the public event and the public application form; verify each tier lists exactly the add-ons that apply to it with the all-in price.

**Acceptance Scenarios**:
1. **Given** an ADMIN on the event edit page, **When** they create an add-on with scope APPLICATION restricted to the "10×10 booth" tier, **Then** the public vendor form shows the add-on only when that tier is selected, and the sponsor form never shows it.
2. **Given** an add-on with `quantityTotal = 60`, **When** 60 have been sold or are reserved, **Then** the public pages show it as sold out and the API refuses further quantity with 409.
3. **Given** an add-on with `maxPerOrder = 4`, **When** a buyer requests 5, **Then** the API returns 400 and the UI stepper stops at 4.
4. **Given** an ORGANIZER (not ADMIN), **When** they try to create or edit an add-on, **Then** 403; they can view add-ons and their sales.
5. **Given** an add-on that has been sold at least once, **When** the organizer deletes it, **Then** it is deactivated (hidden from new purchases) rather than removed, and existing orders and applications still show it.

---

### User Story 2 — Attendee buys add-ons with tickets (Priority: P1)

On the event page, once a buyer has a ticket in the cart, an **Add-ons** block appears listing the add-ons offered on the tiers in the cart, each with a quantity stepper and its all-in price. The cart total updates live with the same fee and tax breakdown as tickets. Checkout shows the add-on lines, Stripe shows them as separate line items, and the order confirmation page, ticket page and confirmation email list them. No ticket is generated for an add-on.

**Why this priority**: Ticket add-ons are the simplest end-to-end slice and share the money path with applications.

**Independent Test**: Create an order with one tier ×2 and one add-on ×1; verify `OrderAddOn` row with fee/tax allocation, Stripe session with two line items whose sum equals `Order.totalAmount`, two tickets and zero tickets for the add-on, confirmation email lists the add-on, and the add-on's `quantitySold` incremented on `checkout.session.completed`.

**Acceptance Scenarios**:
1. **Given** a cart with no tickets, **When** the buyer views the event page, **Then** no add-on can be added (add-ons require a ticket line).
2. **Given** an add-on offered only on the VIP tier, **When** the cart holds only General tickets, **Then** the add-on is not listed; adding a VIP ticket lists it.
3. **Given** a tax-inclusive organization, **When** the buyer adds a taxable add-on, **Then** the listed add-on price includes tax and the breakdown backs tax out exactly as for tiers (spec 009 phase 3).
4. **Given** a Stripe session that expires or fails, **When** the order is failed, **Then** the add-on reservation is released together with the tier reservation.
5. **Given** a completed order with an add-on, **When** the admin refunds that add-on line, **Then** a `Refund` for the line's all-in amount is created, `quantitySold` decrements, and tickets are untouched; a full-order refund includes add-on lines.

---

### User Story 3 — Vendor buys add-ons while applying (Priority: P1)

On the application form, after choosing a tier, the applicant sees the add-ons offered on that tier with quantity steppers and all-in prices per the form's fee mode. The summary reads "10×10 booth $275.00 + Booth power $125.00 + 2 × Extra badge $20.00 = $420.00" before they enter Stripe. The amount snapshot on the application includes the add-ons; the card on file is charged for the whole amount at approval (or at submission for `chargeTiming: SUBMIT`). Organizer views, the status page, emails and the CSV export show the add-on lines.

**Why this priority**: ORG-08 / VEN-03 are P1 in the interview; this is the case that produced the invoicing chaos.

**Independent Test**: Submit a PAID application with a tier and two add-on lines; verify `ApplicationAddOn` rows, `Application.applicantPays` equals the sum computed by the amounts helper, approval charges that amount, add-on `quantitySold` increments at approval under the same lock as the tier, and the CSV has one column per add-on with quantities.

**Acceptance Scenarios**:
1. **Given** fee mode ABSORB on the form, **When** the applicant adds a $10 badge, **Then** they pay $10.00 for it and the organizer's view shows what they receive after fees (the organizer in the interview absorbed the badge fee to avoid vendor backlash).
2. **Given** fee mode PASS, **When** the applicant adds power, **Then** the all-in line price is shown on the form, never only on Stripe's page.
3. **Given** an application `SUBMITTED` with card on file, **When** the organizer changes the add-on quantities before deciding (the vendor emailed asking for two power drops), **Then** the amount snapshot is recomputed at today's prices, the applicant is notified, and approval charges the new amount.
4. **Given** an add-on with 0 remaining at approval time, **When** the organizer approves, **Then** 409 names the add-on and suggests removing the line or waitlisting; nothing is charged and the tier slot is not taken.
5. **Given** an `APPROVED` + `PAID` application, **When** the organizer wants to add another add-on, **Then** the UI explains post-payment additions are invoiced (later spec) and offers no charge here; decreases go through the existing partial refund.
6. **Given** a form's tier price or an add-on price changed since submission, **When** the organizer opens the application, **Then** the "price changed since submission" note (spec 011 phase 3) covers add-on lines too.
7. **Given** the organizer duplicates the event, **When** the copy is created, **Then** add-ons and their tier attachments are copied alongside tiers and forms.

---

### User Story 4 — Organizer sees what was sold and who bought it (Priority: P2)

Under the event's Add-ons section, each add-on shows sold / reserved / remaining and revenue. An **Add-on purchasers** export lists, per line, buyer or business name, email, booth label (applications) or order ref (tickets), quantity, and paid state — the list the organizer hands to the venue electrician or the badge printer.

**Why this priority**: The operational reason add-ons exist; without it the organizer still keeps a spreadsheet.

**Independent Test**: Sell an add-on on two orders and one application; the export has three rows with correct quantities; an unpaid (`PAYMENT_DUE`) application row is marked unpaid.

**Acceptance Scenarios**:
1. **Given** an event with add-on sales, **When** the organizer opens the Add-ons section, **Then** each add-on shows sold, reserved and remaining counts and gross revenue, split tickets vs applications.
2. **Given** a scanner checking in a ticket whose order includes a parking pass, **When** the ticket is scanned, **Then** the scan result lists the order's add-ons so staff can hand over the pass.

---

### Edge Cases

- Add-on quantity is **per order / per application**, not per ticket. A buyer with 3 tickets and 1 parking pass gets one pass. Per-ticket add-ons (a meal per attendee) are out of scope.
- An add-on attached to a tier that is later deactivated is simply not offered; attachments are kept.
- Changing an add-on's price does not change existing orders (immutable `unitPrice` on the line) or existing application snapshots (recomputed only by an organizer edit or surfaced by the price-changed note).
- Add-on lines never create tickets, never count toward `Order.quantity` (ticket count), and never affect tier capacity.
- The processing fee's fixed component is charged once per order, as today; allocation across tier and add-on lines is proportional to listed value with the existing drift fix.
- Application add-on reservation follows the tier: nothing is held at submission; add-on and tier are reserved together at approval and released together on withdraw / overdue / failed charge, in the same transaction.
- A required add-on (a mandatory cleaning fee) is not modelled in phase 1; see open decision 7.4 in the plan.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001** An event has zero or more `AddOn` products with name, description, price, optional `quantityTotal`, optional `maxPerOrder`, `taxable`, `isActive`, `displayOrder`, and scope `TICKET`, `APPLICATION` or `BOTH`.
- **FR-002** An add-on is offered on every tier in its scope unless restricted to explicit tiers (`PriceTier` and/or `ApplicationTier` attachments).
- **FR-003** Public event and application-form responses list, per tier, the add-ons offered with all-in prices computed by the same fee library as tiers, honouring the organization's tax-inclusive setting and, for applications, the form's fee mode and the add-on's `taxable` flag.
- **FR-004** `POST /orders` accepts add-on lines; each is validated against scope, tier attachment, `isActive`, `maxPerOrder` and remaining quantity; reservation uses the same conditional `UPDATE … RETURNING` pattern as tiers and is released on failure, expiry and refund.
- **FR-005** Order add-on lines are stored on `OrderAddOn` with immutable `unitPrice`, `quantity`, and allocated `platformFee`, `processingFee`, `tax`; `Order.totalAmount` and the Stripe line items include them; `Order.quantity` remains the ticket count.
- **FR-006** No ticket is created for an add-on line; order confirmation page, ticket page, admin order detail, and the confirmation email list add-on lines.
- **FR-007** Refund per add-on line (all-in amount) and full-order refund including add-on lines; Connect transfer reversal and application-fee refund apply pro rata as for tickets.
- **FR-008** Application submission accepts add-on lines validated against the selected tier's offered add-ons; lines are stored on `ApplicationAddOn`; the amount snapshot (`subtotal`, fees, `tax`, `applicantPays`, `orgReceives`) covers tier + add-ons.
- **FR-009** Approval reserves add-on quantities in the same transaction as the tier slot; a sold-out add-on returns 409 naming the add-on; withdraw / overdue release them together.
- **FR-010** ORGANIZER+ may edit add-on lines on applications in `SUBMITTED`, `WAITLISTED`, or `APPROVED`+`PAYMENT_DUE` states; the snapshot is recomputed, a decision-log entry is written, and the applicant is emailed. Lines on `PAID` applications are read-only.
- **FR-011** The price-changed note, CSV export (one column per add-on), status page, applicant emails, admin list filter ("has add-on") and detail page include add-on lines.
- **FR-012** Event duplicate copies add-ons and their attachments.
- **FR-013** Per-add-on sales (sold / reserved / remaining / revenue, tickets vs applications) and a purchasers CSV export.
- **FR-014** Ticket scan results include the order's add-on lines.
- **FR-015** Add-on configuration is ADMIN; viewing and line edits on applications are ORGANIZER+; public reads are unauthenticated and org-scoped by event.
- **FR-016** Add-ons with sales cannot be deleted — deactivation only.

### Key Entities

- **AddOn** — event-scoped product; scope, price, quantity, tax flag, tier attachments.
- **PriceTierAddOn / ApplicationTierAddOn** — explicit tier attachments used only when the add-on is restricted.
- **OrderAddOn** — purchased line on an order; immutable price and allocated fees; refundable per line.
- **ApplicationAddOn** — line on an application; part of the amount snapshot; editable before payment.

## Success Criteria _(mandatory)_

- **SC-001** A vendor can buy power and badges in the same application submission with the exact total shown before Stripe; no invoice is needed afterwards for items configured up front.
- **SC-002** An attendee can add a parking pass to a ticket order; the pass appears on the confirmation and on the scan result.
- **SC-003** Add-on prices are shown all-in on every public surface (event page, cart, apply form, status page, emails); Stripe never shows a higher total than the page.
- **SC-004** Add-on capacity is never oversold under concurrent checkouts or approvals (contract test with `Promise.all`).
- **SC-005** The purchasers export gives the organizer the list they previously kept in a spreadsheet.

## Assumptions

- Fee mode for an add-on is inherited from its parent (tickets: PASS, all-in; applications: the form's `feeMode`). Per-product absorb / pass / split is the separate "fee modes" roadmap item.
- Add-ons are priced in the event's currency (USD today) and taxed at the event's rate when `taxable`.
- Post-payment additions to an approved application are invoices (a later spec); this spec only allows edits before money moves and decreases via refund.
