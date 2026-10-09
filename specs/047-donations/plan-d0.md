# Spec 047 — Donations, phase D0: groundwork

**Status**: Plan, 2026-10-09. Nothing built.
**Ask**: nonprofits take donations in Jump: one-time gifts added to an event ticket purchase, preset amounts (common denominations) or a custom amount, gifts without a ticket, and recurring monthly gifts. The research and the full phase plan (D0, DV, D1–D5) live in [Donation platforms](../../docs/research/2026-10-08-donation-platforms.md) §9; the law behind every requirement is in [Donation legal compliance](../../docs/research/2026-10-08-donation-legal-compliance.md). This file specifies **D0 only**: the changes every later phase stands on. D0 ships **no donor-facing UI** and changes no behaviour for existing ticket, application or billing flows.

**v1 = D0 + DV + D1 + D3** (owner, 2026-10-09). Decided the same day:

- Ticket checkout offers **one-time** gifts only. "Make it monthly" is a separate one-step payment on the confirmation page, never part of the ticket payment (plan decision 13).
- Default preset amounts are **$10 / $25 / $50 / $100** plus Other; each organization can change them (decision 14).
- `Order.eventId` becomes nullable **in D0**, because monthly gifts have no event (decision 4).

## 1. What exists today (origin/main 4bb0142)

| Piece | Where | What D0 needs from it |
|---|---|---|
| Fee math | `backend/src/services/FeeService.js` ↔ `frontend/src/lib/fees.ts` (Gotcha 12: identical) | One platform rate for the whole order (`FEE_CONFIG.platformFeePercent` = 5%), processing `(subtotal + platformFee) × 2.9% + $0.30` once per order, fees allocated to lines by listed value. No per-line rate, no per-line fee mode |
| Fee tests | `backend/tests/unit/feeService.test.js`, `frontend/tests/unit/fees.test.ts` | Hand-written cases mirrored in both, no shared fixture file (unlike `eventTime` / `usTimeZones`) |
| Fee modes | `FeeMode { PASS ABSORB }` on `Order` and `ApplicationForm`; `applicationAmounts` (`ApplicationFormService.js:51`), `buyerLineTotal` (`orderLines.js:41`) | ABSORB exists, but **per order**: a ticket (PASS) plus an uncovered gift (ABSORB) cannot be expressed |
| Destination charge | `PaymentSettingsService.checkoutOptionsFor` (`:198-239`) | `application_fee_amount` = total cents − subtotal cents, i.e. the organization always receives exactly the ex-tax subtotal. Wrong for an ABSORB line, where the organization receives less than the line's price |
| Order | `schema.prisma` `model Order` | `eventId String` **required**, `event Event` relation required, `@@index([contactId, eventId, status])`. No `organizationId`: every org-scoped query reaches the org through `event → venue → organizationId` |
| Order kinds | `OrderKind { TICKET APPLICATION }`, `OrderItemKind { TICKET_TIER APPLICATION_TIER ADJUSTMENT WAIVER }` | D1 adds `DONATION` to both; D0 does not (no code writes it yet) |
| Webhooks | `webhooks.js:103-119` platform endpoint; `/stripe/billing` (`:301`); `BillingService.isBillingEvent` (`BillingService.js:15-21, 177-182`) | `isBillingEvent` returns true for **every** `customer.subscription.*` and `invoice.payment_failed`, and every subscription-mode `checkout.session.completed`. The platform endpoint marks those IGNORED. A donation subscription on the platform account would be dropped |
| Billing metadata | `BillingService.js:78, 99-107` | Session metadata carries `billing: 'subscription'`; `subscription_data.metadata` carries only `organizationId`. Existing live subscriptions carry no marker |
| Consent | `LegalDocument` enum (`schema.prisma:1652`), `backend/src/config/legal.js` `LEGAL_VERSIONS` / `DOCUMENT_FOR_KEY` / `KEY_FOR_DOCUMENT`, `frontend/src/lib/legal.ts` | No donation or recurring-gift document |
| Stripe tax code | `TaxService.js:14` `ADMISSIONS_TAX_CODE = 'txcd_20060057'` | Compliance research reports this code as "Stenographic Services". Not donation work; tracked in §7 |

## 2. Scope

D0 is four code cards and one decision card. Each code card is its own PR, mergeable alone, with no visible change.

| Card | What | Depends on |
|---|---|---|
| **D0-A** | Webhook routing: billing events identified by marker, not by event type | — |
| **D0-B** | Per-line platform rate and fee mode in both fee libraries + destination-charge split | — |
| **D0-C** | `Order.organizationId` (backfilled, required) and nullable `Order.eventId` | — |
| **D0-D** | `DONATION_TERMS` and `RECURRING_GIFT` legal documents | — |
| **D0-E** | Decisions and ops: gift charge model with Stripe, 1099-K filer, counsel questions | Gates D1, not D0 code |

**Out of D0** (each was in the earlier sketch):

- **The 3% nonprofit ticket rate** (`Organization.platformFeeRate`). It changes the all-in price shown on every public tier (`computeTierAllInPrice`, `TierStub`, `EventDetailClient`, `addOns.ts`, the map page) and needs owner decision 2 (flat 3% or plan-gated) plus DV verification. D0-B makes it a one-field change later: the fee libraries already take a per-line rate.
- `OrderKind.DONATION` / `OrderItemKind.DONATION`, `GiftReceipt`, `RecurringGift`, `DonationCampaign`: added by the phase that first writes them (D1, D3, D2).
- `Organization.deductibilityStatus` and the other DV fields: DV.

## 3. D0-A — Webhook routing

**Problem.** Jump's own subscription billing (spec 022) and an organization's donation subscriptions are both Stripe subscriptions. Today any subscription event is assumed to be Jump billing.

**Change.**

1. `BillingService` stamps a marker on everything it creates: `subscription_data.metadata.billing = 'subscription'` (the session already has it).
2. `isBillingEvent(event)` becomes "a billing event type **and** a Jump-billing object":
   - `checkout.session.completed`: `mode === 'subscription'` and `metadata.billing === 'subscription'`.
   - `customer.subscription.*`: `metadata.billing === 'subscription'`, **or** any item's `price.id === starterPriceId()` (live subscriptions created before the marker).
   - `invoice.payment_failed`: `subscription_details.metadata.billing === 'subscription'` (API 2024-11-20.acacia; it moves to `parent.subscription_details` on a later API version), **or** any line's price id `=== starterPriceId()`.
   - With `JUMP_STARTER_PRICE_ID` unset, only the marker counts.
3. The platform endpoint keeps ignoring Jump-billing events. Every **other** subscription event falls through to the order handlers, which ignore types they don't know (no donation handler exists until D3).
4. The billing endpoint keeps ignoring non-billing events (`webhooks.js:311`), now including donation subscriptions if both endpoints are subscribed to the same types.

**Why a marker and not "anything that isn't ours"**: the price-id fallback alone breaks when the STARTER price is rotated; the marker alone misses live subscriptions. Both together cover old and new.

**Tests** (`backend/tests/contract/billing.test.js`, extended):

- Billing session, subscription and failed invoice with the marker: billing endpoint applies, platform endpoint IGNORED (unchanged behaviour).
- Legacy subscription with no marker but the STARTER price: still billing.
- A subscription and a subscription-mode session with **no marker and another price**: platform endpoint does **not** mark it IGNORED as billing; billing endpoint ignores it.
- Unit test for `isBillingEvent` covering every branch above, including the unset price id.

## 4. D0-B — Per-line platform rate and fee mode

**Problem.** A gift line needs a 0% platform fee and, when the donor doesn't tick "cover the fee", must have its processing share taken from the organization (ABSORB) while the ticket in the same order stays PASS. Both fee libraries assume one rate and one mode per order.

### 4.1 Item shape (both libraries)

```js
{ unitPrice, quantity, taxable?,            // existing
  platformFeeRate?,                          // default FEE_CONFIG.platformFeePercent
  feeMode? }                                 // 'PASS' (default) | 'ABSORB'
```

### 4.2 Math

Unchanged where every line is default: every existing case in both test files must pass **unmodified**.

1. `subtotal`, `tax`, tax-inclusive back-out: unchanged.
2. `platformFee = round(Σ net_line × platformFeeRate_line)`. Rounded **once** on the sum, never per line, so a uniform 5% order produces exactly today's figure.
3. `processingFee = (subtotal + platformFee) × 2.9% + $0.30`, once per order, 0 for an empty cart: unchanged. Stripe charges processing on the whole payment whoever bears it.
4. Allocation to lines:
   - platform fee: by each line's `net × rate` (so a 0% line gets 0), drift to the largest line **with a non-zero rate**;
   - processing: by listed value, as today, drift to the largest line;
   - tax: unchanged.
5. Per line:
   - `PASS`: `lineTotal = net + platformFee + processingFee + tax` (today's formula).
   - `ABSORB`: `lineTotal = listed + (taxInclusive ? 0 : tax)`; the line's `absorbedFees = platformFee + processingFee` comes out of the organization's share.
6. Order level, new fields:
   - `absorbedFees = Σ absorbedFees_line`
   - `orgReceives = subtotal − absorbedFees`
   - `total = subtotal + platformFee + processingFee + tax − absorbedFees` (what the buyer pays).

   The old invariant `total = subtotal + platformFee + processingFee + tax` still holds whenever `absorbedFees = 0`. Update the header comment in both files to the new one.

`applicationAmounts` keeps working unchanged (it passes no per-line mode and applies form ABSORB itself). Moving it onto the per-line mode is a follow-up, not D0.

### 4.3 Destination-charge split

`checkoutOptionsFor(organization, { fees, lineItems })` computes `application_fee_amount = total cents − subtotal cents` (`PaymentSettingsService.js:201`). With ABSORB lines the organization must receive `orgReceives`, so:

- `application_fee_amount = total cents − orgReceives cents`, still from the exact line-item cents Stripe will charge.
- With no ABSORB line, `orgReceives = subtotal`, so the result is identical to today.
- Callers that don't pass `orgReceives` (none after this card) fall back to `subtotal`.

The organization-facing rule "you receive exactly the ex-tax subtotal" in the doc comment becomes "you receive `orgReceives`: the subtotal, less fees on lines whose fees you absorb".

### 4.4 Ledger columns

- `OrderItem.feeMode FeeMode?`: null means the order's `feeMode`. `buyerLineTotal(line, feeMode)` callers pass `line.feeMode ?? order.feeMode`.
- Nothing writes a non-null value until D1. No backfill.

### 4.5 Tests

- Both test files: a shared case table at `backend/tests/fixtures/fees.fixtures.json`, read by Jest and Vitest, like `eventTime` (Gotcha 33 pattern). Move the existing hand-written cases into it, then add:
  1. donation-only, 0% rate, PASS (donor covers);
  2. donation-only, 0% rate, ABSORB (donor doesn't cover);
  3. ticket 5% PASS + donation 0% PASS;
  4. ticket 5% PASS + donation 0% ABSORB;
  5. tax-inclusive ticket + donation 0% ABSORB;
  6. three lines with mixed rates, checking drift lands on a non-zero-rate line.
- Each case asserts every order field and every line field, plus two invariants: `Σ lineTotal = total`, and `total − orgReceives = platformFee + processingFee + tax` (what the platform keeps, whoever bore the fees).
- `paymentSettingsService.test.js`: `application_fee_amount` for cases 2 and 4, and unchanged for an all-PASS order.

## 5. D0-C — `Order.organizationId`, nullable `Order.eventId`

**Problem.** A gift without a ticket, and every monthly gift, has no event. Today an Order cannot exist without one, and every org-scoped Order query goes through the event.

### 5.1 Migration (expand → backfill → contract, one PR)

Follows the spec 044 `ApplicationForm.organizationId` migration (`20261004000000_standing_application_forms`), which did the same thing for forms.

1. Add `organizationId String?`, FK to `Organization` with the same delete behaviour as `eventId` (no cascade), indexes `[organizationId, status, createdAt]` and `[organizationId, kind, status]`.
2. Backfill from the event: `UPDATE "Order" o SET "organizationId" = v."organizationId" FROM "Event" e JOIN "Venue" v ON v."id" = e."venueId" WHERE e."id" = o."eventId"` (the schema has no `@map`, so columns are camelCase).
3. Verify in the same migration: zero rows left null, and zero rows where `o."organizationId"` differs from the contact's `organizationId` (contacts are per org since spec 007, so the two must agree). Either check failing raises and aborts the migration.
4. `SET NOT NULL` on `organizationId`; `DROP NOT NULL` on `eventId`; the Prisma relation becomes `event Event?`.
5. `CHECK ("eventId" IS NOT NULL OR "kind" NOT IN ('TICKET','APPLICATION'))`: ticket and application orders keep their event, enforced by the database. Only D1's `DONATION` kind may omit it.
6. A `BEFORE INSERT OR UPDATE OF "eventId", "organizationId"` trigger fills `organizationId` from the event when it is omitted, copied from `set_application_form_organization()`. It protects raw inserts; Prisma still requires the field.
7. Every Prisma `order.create` passes `organizationId`: `OrderService.createOrder` (`:332`), `OrderService.createApplicationOrder` (`:124`), `packages/db/prisma/seed.ts:302`, and the roughly 30 test files that create orders directly (spec 044 updated its tests the same way).

Migration safety (CI): additive column + backfill + constraint in one migration is acceptable at today's row counts; record the row count and timing from a prod snapshot in the PR.

### 5.2 Moving org scope off the event

Every query that scopes Orders to an organization through `event: { venue: { organizationId } }` moves to `organizationId`. Every reader of `order.event` must handle `null` (rendering "—" or the organization name where the event name goes).

The full list of call sites is §5.4. Rules:

- **Scope** (`where`) → `organizationId`. Event-specific views keep filtering by `eventId`; they never see event-less orders, which is correct.
- **Deref** (`order.event.name`, `.venue`, `.date`) → optional chaining plus a fallback label. Event time formatting (Gotcha 28) is skipped when there's no event.
- **Raw SQL** → join on `"Order".organization_id`.
- **Frontend types** → `event: … | null`.
- The tax report, event analytics, ticket counts and RSVP paths stay event-scoped; dashboard and customer totals become org-scoped.

### 5.3 Tests

- Migration test: backfill sets the right organization on ticket and application orders across two orgs.
- The CHECK refuses a TICKET order with `eventId = null`.
- Every order created through `createOrder` and the application paths has `organizationId` set (assert in the existing order and application contract tests).
- For each SCOPE site, the existing contract tests pass unchanged; that is the proof of no behaviour change. Cases with `eventId = null` arrive in D1, when the `DONATION` kind first exists and the CHECK allows it.
- Frontend typecheck passes with `event` nullable.

### 5.4 Call sites (audit of origin/main 4bb0142; tests excluded)

**SCOPE: org scoping through the event. Move to `organizationId`.** 18 sites.

| Site | Today |
|---|---|
| `backend/src/api/routes/admin.js:1071-1087` | dashboard payment success rate and gross: `order.count/aggregate({ event: venueFilter })` |
| `admin.js:1389-1399, 1421-1430, 1469-1475, 1578-1584` | order detail, resend confirmation, refund, refund history: ownership via `order.event.venue.organizationId` (**throws** on a null event) |
| `admin.js:1547-1550` | add-on line refund: ownership via `line.order.event.venue.organizationId` (**throws**) |
| `OrderService.js:802` `_orgOrdersWhere` | `/admin/orders` list and CSV |
| `TaxService.js:230` | collected-tax report |
| `DashboardService.js:58-62, 82-83` | 14-day trend and recent orders. **SYSTEM_ADMIN passes `event: {}`**, which on an optional relation silently drops event-less orders: use `{}` on the order instead |
| `EventService.js:775-781` | org "registered" total, filtered by event category and search: keeps the event filter (it is about events), but must not be the org total anywhere else |
| `BuyerDataExportService.js:44` | buyer export (Gotcha 30: a missed gift is a data-rights bug) |
| `AdminSearchService.js:71` | admin header search |
| `DisputeService.js:519` | dispute reconcile |
| `mcp/src/tools.js:242-247` | agent `get_sales_summary`, grouped by `eventId`: gifts become an "Organization (no event)" row |
| `backend/src/scripts/verify-checkout-tax.js:170-173` | test-mode cleanup |

**DEREF: reads event fields. Make null-safe, falling back to the organization.** The ones that **throw today** on a null event:

- `OrderService._formatOrderDetail` (`:1207-1226`): `order.event.id/name/date/logoUrl`, and the org branding read from `order.event.venue.organization`. Org branding moves to an `organization` include on the order; event fields become `event: null`.
- `TaxService.js:253, 274`: tax region from `order.event.venue`. The tax report stays event-scoped (gifts are never taxed), so it filters `eventId: { not: null }` and never sees them.
- `CustomerService.js:447, 454`: upcoming tickets `order.event.date >= now`.
- Everything that reads org identity from the event: `EmailService.sendOrderConfirmation` (`:124-172`, order URL, brand colour, org name, logo, subject), `OrderService._formatOrderRow` (`:1319-1348`), `getReceiptForContact` (`:612-649`), `DisputeService._notifyOrganizer` (`:432-446`, returns silently with no event, so a gift dispute would **never alert the organizer**). All move to `order.organization`.

Already null-safe, re-checked only: `DashboardService.js:98,130`, `AdminSearchService.js:91,205`, `CustomerTimelineService.js:12,221`, `ContactErasureService.js:104,110`, `BuyerDataExportService.js:47,140`, `DisputeService.js:463-466`, `CustomerService.js:315,402`.

**EVT: per-event filters by `eventId`. Unchanged**: event-less orders correctly drop out. `orders.js:121-131`, `OrderService.js:806, 893-910`, `EventService.js:262, 1079-1088, 1223-1230`, `reconcile-venue-time-zones.js:67`.

**RAW: unchanged, TICKET only.** `OrderService.js:225-229` (per-buyer hold cap) and `TicketService.js:94-121` (ticket numbering lock) only ever run for ticket orders, which keep their event under the CHECK. `RefundService` and `DisputeService` `FROM "Order"` locks are by id.

**TYPE: frontend.** 18 sites in 10 files make `event` (or `eventName` / `eventDate`) nullable and render the organization instead:

- `services/api.ts:236-237, 259-270`, `lib/orders.ts:21-23`;
- admin: `orders/OrdersListView.tsx:363`, `orders/[orderId]/page.tsx:47, 383-388`, `customers/[contactId]/page.tsx:40, 752-773`;
- buyer: `confirmation/page.tsx:46, 116, 241-264, 368-392, 512` (org id and branding today come from `order.event.organization*`; `clearCheckoutDraft(event.id)` is skipped without an event), `orders/[orderId]/page.tsx:274-300`, `orders/lookup/page.tsx:109, 198-206`, `organizations/[orgId]/account/(member)/orders/[orderId]/receipt/page.tsx:18, 83, 138-140`.
- Already tolerant: `account/(member)/orders/page.tsx:22-25, 75`, `adminService.ts:76`, `dashboard/RecentOrders.tsx:55`.

**Order of work inside D0-C:** migration and writes → SCOPE → backend DEREF → frontend TYPE. With no event-less order able to exist until D1, every step is behaviour-neutral and the existing suites are the regression check.

## 6. D0-D — Legal documents

- `LegalDocument` gains `DONATION_TERMS` (the charity agreement an org admin accepts before taking gifts; DV) and `RECURRING_GIFT` (the donor's recurring authorization; D3).
- `backend/src/config/legal.js`: `LEGAL_VERSIONS.donationTerms` and `.recurringGift` = `'2026-10-09-draft'`, plus both maps. `frontend/src/lib/legal.ts` type union.
- `GET /legal/versions` returns them. No page, checkbox or caller until DV / D3.
- Counsel supplies the text (blocker L5/L6); until then the versions stay `-draft`, like spec 023.

## 7. D0-E — Decisions and ops (no code; gates D1)

| # | Item | Owner | Output |
|---|---|---|---|
| E1 | **Gift charge model** (compliance doc §4: A destination, B `on_behalf_of`, C direct). Recommended: C for gift-only orders; for ticket + gift choose with Stripe between a second gift payment and B | Owner + Stripe + counsel | Decision written into spec 010 `plan-phase-2.md` §11.1 and this spec. **D1 cannot start without it**: it decides whether D1's ticket checkout carries the gift line or a second payment |
| E2 | **Stripe approval** (blocker L1): request "fundraising on a Connect platform" with the chosen model | Owner | Written approval on file |
| E3 | **1099-K filer** (L7). Stripe does not file for Express (`application_express`) accounts | Owner + tax advisor | Filer chosen; fix `specs/010-payments-settings/plan-phase-2.md:341` and `docs/wiki/config/production-launch-checklist.md`. Also gates `STRIPE_CONNECT_ENABLED` for tickets |
| E4 | **Counsel questions** (compliance §7, the launch-blocking ones: AB 488 / Hawaii register or geofence, NC solicitor and money transmission per model, acknowledgments as the charity's agent, receipt and disclosure wording) | Owner | Added to the spec 023 counsel card |
| E5 | **Stripe tax code** `TaxService.js:14`: confirm against Stripe's tax-code list and fix in its own PR with the spec 009 owner | Engineering | Separate `fix:` PR; not donation work |

## 8. Done when

- D0-A, D0-B, D0-C, D0-D merged with CI green; `npm test` (backend) and `npm run test:unit` + typecheck (frontend) pass with **no existing test changed** except moving fee cases into the shared fixture.
- No visible change: checkout totals, application totals, receipts, dashboard, customers, tax report and billing behave exactly as before (existing contract and Playwright suites).
- D0-E items E1–E4 have an owner and a date. E1 decided before D1 is specified.
- `docs/wiki/` and `backend/AGENTS.md` updated: Gotcha 12 (per-line rate and fee mode, shared fixture), Gotcha 17 (`Order.organizationId` is the org scope; `eventId` is null only for DONATION orders).
