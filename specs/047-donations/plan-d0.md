# Spec 047 — Donations, phase D0: groundwork

**Status**: Plan, 2026-10-09. Nothing built.
**Ask**: nonprofits take donations in Jump: one-time gifts added to an event ticket purchase, preset amounts (common denominations) or a custom amount, gifts without a ticket, and recurring monthly gifts. The research and the full phase plan (D0, DV, D1–D5) live in [Donation platforms](../../docs/research/2026-10-08-donation-platforms.md) §9; the law behind every requirement is in [Donation legal compliance](../../docs/research/2026-10-08-donation-legal-compliance.md). This file specifies **D0 only**: the changes every later phase stands on. D0 ships **no donor-facing UI**.

**v1 = D0 + DV + D1 + D3** (owner, 2026-10-09). Decided the same day:

- **Option C: direct charges on the organization's own Stripe account.** The organization connects its Stripe account (an existing one, or a new one it owns with the full Stripe dashboard). Every charge — tickets, applications, gifts, monthly gifts — is created **on that account**. Jump takes its platform fee through `application_fee_amount`. Money never passes through Jump's balance. This settles spec 010 `plan-phase-2.md` §11.1 (option C there) and research decision 8.
- Ticket checkout offers **one-time** gifts only. "Make it monthly" is a separate one-step payment on the confirmation page, never part of the ticket payment (plan decision 13).
- Default preset amounts are **$10 / $25 / $50 / $100** plus Other; each organization can change them (decision 14).
- `Order.eventId` becomes nullable **in D0**, because monthly gifts have no event (decision 4).

**What option C settles** (compliance doc §4): the organization is the merchant on the card statement and owns refunds and disputes; Jump never holds gift money, which removes the money-transmission, NC "solicitor" (custody) and California commingling questions and Stripe's "donations on behalf of someone else" rule; Stripe's nonprofit rate becomes reachable because it applies to the nonprofit's own account; a ticket and a gift share **one** payment again. With `controller.fees.payer = account`, Stripe — not Jump — files the 1099-K (compliance §2.5). Costs: the organization becomes the seller of record for sales tax (spec 009 flips), and every Stripe call that creates or moves money is re-pointed at the connected account (D0-S).

## 1. What exists today (origin/main 4bb0142)

| Piece | Where | What D0 needs from it |
|---|---|---|
| Connect | `ConnectService.js:170` (`accounts.create`, `controller.stripe_dashboard.type: 'express'`), `:187` account links, `:201` Express login links; `OrganizationStripeAccount.stripeAccountId` | **Express accounts Jump creates**, destination charges. Dark in production (`STRIPE_CONNECT_ENABLED` off), so no live organization is on it: nothing to migrate |
| Charge routing | `PaymentSettingsService.checkoutOptionsFor` (`:198-239`) | Destination charge: `transfer_data.destination` + `application_fee_amount = total cents − subtotal cents`. Jump is merchant; Jump keeps fees **and tax** |
| Money calls | `OrderService.js:440, 969, 1032, 1070` (Checkout); `ApplicationPaymentService.js:84, 143, 158, 178, 294, 329, 493, 643, 730, 764, 800, 1003` (Customers, SetupIntents, PaymentIntents, Checkout); `stripeRefund.js:51` (`reverse_transfer` + `refund_application_fee` when `connected`); `DisputeService.js:166` (`charges.retrieve`); `ContactErasureService.js:251` (`customers.del`); `TaxService.js:378, 436-437` (Stripe Tax on the platform account) | All run on **Jump's** account today |
| Ledger | `PaymentTransaction.stripeAccountId String?` (`schema.prisma:1183`): null = charged on the platform account | Already tells a refund which account a charge lives on |
| Webhooks | `webhooks.js:103` platform endpoint (orders, applications, refunds, disputes); `:230` Connect endpoint handles only `account.*`, `capability.updated`, `payout.*`; `:301` billing endpoint | Under direct charges, checkout, payment, refund and dispute events for organization charges arrive on the **Connect** endpoint with `event.account` |
| Billing | `BillingService` (spec 022) on Jump's own account | Unchanged by option C: Jump's subscription with each organization stays Jump's |
| Fee math | `backend/src/services/FeeService.js` ↔ `frontend/src/lib/fees.ts` (Gotcha 12: identical) | One platform rate for the whole order (`FEE_CONFIG.platformFeePercent` = 5%), processing `(subtotal + platformFee) × 2.9% + $0.30` once per order, fees allocated to lines by listed value. No per-line rate, no per-line fee mode |
| Fee tests | `backend/tests/unit/feeService.test.js`, `frontend/tests/unit/fees.test.ts` | Hand-written cases mirrored in both, no shared fixture file (unlike `eventTime` / `usTimeZones`) |
| Fee modes | `FeeMode { PASS ABSORB }` on `Order` and `ApplicationForm`; `applicationAmounts` (`ApplicationFormService.js:51`), `buyerLineTotal` (`orderLines.js:41`) | ABSORB exists, but **per order**: a ticket (PASS) plus an uncovered gift (ABSORB) cannot be expressed |
| Order | `schema.prisma` `model Order` | `eventId String` **required**, `event Event` relation required, `@@index([contactId, eventId, status])`. No `organizationId`: every org-scoped query reaches the org through `event → venue → organizationId` |
| Order kinds | `OrderKind { TICKET APPLICATION }`, `OrderItemKind { TICKET_TIER APPLICATION_TIER ADJUSTMENT WAIVER }` | D1 adds `DONATION` to both; D0 does not (no code writes it yet) |
| Consent | `LegalDocument` enum (`schema.prisma:1652`), `backend/src/config/legal.js` `LEGAL_VERSIONS` / `DOCUMENT_FOR_KEY` / `KEY_FOR_DOCUMENT`, `frontend/src/lib/legal.ts` | No donation or recurring-gift document |
| Stripe tax code | `TaxService.js:14` `ADMISSIONS_TAX_CODE = 'txcd_20060057'` | Compliance research reports this code as "Stenographic Services". Not donation work; tracked in §7 |

## 2. Scope

| Card | What | Depends on |
|---|---|---|
| **D0-S** | Direct charges on the organization's own Stripe account (option C), in five sub-cards S1–S5 | — |
| **D0-B** | Per-line platform rate and fee mode in both fee libraries | — (S2 uses its `platformFee` as the application fee) |
| **D0-C** | `Order.organizationId` (backfilled, required) and nullable `Order.eventId` | — |
| **D0-D** | `DONATION_TERMS` and `RECURRING_GIFT` legal documents | — |
| **D0-E** | Decisions and ops without code | — |

D0-B, D0-C and D0-D change nothing visible. D0-S is the one card with a visible change (organizer onboarding and who appears on the buyer's card statement) and ships behind `STRIPE_CONNECT_ENABLED`, which stays off in production until the launch checklist's Connect steps are redone for option C.

**Dropped from the earlier draft:** a webhook card that taught `BillingService.isBillingEvent` to tell Jump billing apart from donation subscriptions. Under option C donation subscriptions live on the organization's account, so their events arrive on the Connect endpoint and never reach the platform or billing endpoints.

**Out of D0** (each was in the earlier sketch):

- **The 3% nonprofit ticket rate** (`Organization.platformFeeRate`). It changes the all-in price shown on every public tier (`computeTierAllInPrice`, `TierStub`, `EventDetailClient`, `addOns.ts`, the map page) and needs owner decision 2 (flat 3% or plan-gated) plus DV verification. D0-B makes it a one-field change later: the fee libraries already take a per-line rate.
- `OrderKind.DONATION` / `OrderItemKind.DONATION`, `GiftReceipt`, `RecurringGift`, `DonationCampaign`: added by the phase that first writes them (D1, D3, D2).
- `Organization.deductibilityStatus` and the other DV fields: DV.

## 3. D0-S — Direct charges on the organization's Stripe account

**Rule after this card:** every charge for an organization is created with the request option `{ stripeAccount: <organization's acct_…> }`, carries `application_fee_amount` = Jump's platform fee (D0-B), and is read, refunded and disputed on that account. Jump's own account keeps only Jump billing (spec 022) and orders charged before this card (`PaymentTransaction.stripeAccountId = null`). Verify each Stripe parameter against current Stripe docs when building; the shapes below are the plan, not a guarantee.

### S1. Connect the organization's own account (onboarding)

- **Has a Stripe account:** "Connect with Stripe" OAuth (`connect.stripe.com/oauth/authorize` → `stripe.oauth.token`), storing `stripe_user_id` in `OrganizationStripeAccount.stripeAccountId`. Deauthorization already lands on `account.application.deauthorized` (`webhooks.js`).
- **No Stripe account yet:** `accounts.create` with `controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' }`, then an account link. The organization owns the account and its full dashboard; Stripe, not Jump, carries negative balances and files the 1099-K.
- Replace the Express login link (`ConnectService.js:201`) with a link to the organization's Stripe dashboard. Payouts and balance (`:335-336`) keep working with `stripeAccount`.
- Test-mode Express accounts are dropped; production has none.

### S2. Ticket checkout as a direct charge

- `OrderService.createOrder` → `stripe.checkout.sessions.create(params, { stripeAccount })` with `payment_intent_data.application_fee_amount` = platform fee cents. No `transfer_data`.
- `checkoutOptionsFor` returns the account id and fee instead of `transfer_data`. Payment methods: the organization's account settings decide what it can accept; Jump's allowlist (`config/payments.js`) still filters. The statement descriptor is the organization's own (the spec 010 suffix setting becomes a hint, not a value Jump sends).
- `OrderService.js:969, 1032, 1070` retrieve sessions with the same `stripeAccount`, read from the order's `PaymentTransaction.stripeAccountId`.
- `PaymentTransaction.stripeAccountId` is written at session creation.

### S3. Webhooks for connected-account money events

- The Connect endpoint (`webhooks.js:230`) dispatches `checkout.session.*`, `payment_intent.*`, `charge.refunded`, `charge.dispute.*` to the **same** handlers the platform endpoint uses (`PaymentService`, `ApplicationPaymentService`, `DisputeService`), passing `event.account`. Extract the platform endpoint's switch into one function both endpoints call: never two copies.
- Handlers check that `event.account` equals the order's `PaymentTransaction.stripeAccountId`, so one organization's account can never complete another's order.
- The platform endpoint keeps handling the same types for legacy platform charges (`stripeAccountId = null`).
- Stripe Dashboard: the Connect webhook endpoint subscribes to the added event types (launch checklist).
- Dedup (`StripeWebhookEvent`, unique on endpoint + event id) and the fail-closed rules (AGENTS.md "Stripe webhooks") apply unchanged.

### S4. Refunds, disputes, erasure

- `stripeRefund.js`: for a direct charge, `refunds.create({ payment_intent, amount, refund_application_fee: true }, { stripeAccount, idempotencyKey })`. No `reverse_transfer` (there is no transfer). `stripeAccountId = null` keeps today's platform call.
- Whether Jump returns its platform fee on refunds stays the current rule (`refund_application_fee: true`); spec 031 retained fees are unchanged.
- `DisputeService.js:166` retrieves the charge on the order's account. Disputes are now the organization's in Stripe; Jump still mirrors them into `Dispute` rows and alerts the organizer.
- `ContactErasureService.js:251` deletes the Stripe Customer on the account it was created on.

### S5. Applications and tax on the connected account

- **Applications** (`ApplicationPaymentService`): Customers, SetupIntents, saved cards, off-session PaymentIntents and Checkout all move to `{ stripeAccount }`; `application_fee_amount` replaces `transfer_data` (`:329`). `Contact.stripeCustomerId` is already per organization (Contact is per org, Gotcha 8), so the stored id now names a Customer on that organization's account. `APPLICATIONS_PAYMENTS_ENABLED` is off in production; any test-mode cards on file are re-collected.
- **Sales tax** (spec 009): the organization is now the seller. `TaxService` Stripe Tax calls (`:378, 436-437`) run on the organization's account and read its registrations; `MANUAL` rates are unchanged. The collected tax stays in the organization's charge (not in Jump's fee) and the organization remits it. Settings › Tax copy, `docs/wiki/features/tax-settings.md` and Gotcha 12 change to say so.

### D0-S tests

- Contract tests with the Stripe mock assert the `stripeAccount` request option and `application_fee_amount` on every money call above, and the absence of `transfer_data`.
- Connect endpoint: a `checkout.session.completed` with `account` completes the order; one with a different `account` is refused; a platform-endpoint event for a legacy order still completes it.
- Refund: direct-charge order refunds on its account without `reverse_transfer`; legacy order refunds on the platform as today.
- `npm run verify:stripe` gains a direct-charge run against a test-mode connected account (outside `npm test`).

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

### 4.3 What each party gets under direct charges

All of `total` is charged on the organization's account. Then:

- **Jump:** `application_fee_amount = platformFee` cents (0 for a gift line at 0%). Not processing, not tax.
- **Stripe:** its actual processing fee, deducted from the organization's balance.
- **Organization:** the rest, including the tax it collected and must remit. Its ex-tax net is approximately `orgReceives = subtotal − absorbedFees`.

`processingFee` in the fee libraries is an **estimate** at 2.9% + $0.30: what a PASS buyer is asked to cover. Stripe's actual fee can differ (the nonprofit rate is lower; international and some card types are higher), and the organization keeps or bears the difference. Copy that says "covers the processing fee" never promises the exact Stripe amount.

D0-B only adds the numbers. **S2** switches `checkoutOptionsFor` from `total cents − subtotal cents` to `fees.platformFee` in the same PR that drops `transfer_data`, so the dark destination-charge path is never left with a fee rule meant for direct charges.

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
- Each case asserts every order field and every line field, plus two invariants: `Σ lineTotal = total`, and `total − orgReceives = platformFee + processingFee + tax` (Jump's fee, Stripe's estimated fee and the tax the organization remits).
- In S2, `paymentSettingsService.test.js` asserts `application_fee_amount` equals `platformFee` cents for cases 1–6 and for an all-PASS ticket order.

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
- The text is written from IRS Publication 1771 and the compliance doc §3.5 disclosures (no counsel on retainer); versions stay `-draft` until the owner approves it, like spec 023.

## 7. D0-E — Decisions and ops (no code)

| # | Item | Owner | Output |
|---|---|---|---|
| E1 | **Confirm with Stripe support** that a Connect platform using direct charges on nonprofits' own accounts needs no platform-level review for donations (compliance §4: "merchants fundraising on an approved crowdfunding platform using Stripe Connect" need no extra approval; each nonprofit's own account goes through Stripe's restricted-business review at onboarding) | Owner | Stripe's answer on file. Free |
| E2 | **California and Hawaii platform laws** (AB 488 "type E", HRS 467B). Option C does not obviously take Jump out of them. Launch default: **block gifts from CA and HI donors** (`DONATIONS_GEO_BLOCK`, D1); register later ($625/yr CA, $250/yr HI) when volume justifies it. A one-hour flat-fee consult on this question is the best use of legal money if any is spent | Owner | Geofence on at launch; registration decision revisited |
| E3 | **Receipt and disclosure wording** from IRS Publication 1771 plus the state legends in compliance §3.3–3.5, owner-approved | Owner + engineering | Text for `GiftReceipt` and the "About this gift" block, before D1 ships |
| E4 | **Launch checklist and spec 010**: record option C in `specs/010-payments-settings/plan-phase-2.md` §11.1; replace the Express steps in `docs/wiki/config/production-launch-checklist.md` with OAuth / full-dashboard onboarding and the Connect endpoint event list; correct the 1099-K line (`plan-phase-2.md:341`): with `fees.payer = account` Stripe files | Engineering | Docs PR with D0-S |
| E5 | **Stripe tax code** `TaxService.js:14`: confirm against Stripe's tax-code list and fix in its own PR | Engineering | Separate `fix:` PR; not donation work. Under option C it applies on the organization's account |

Questions the compliance doc listed for counsel that option C answers: money transmission and NC solicitor status (Jump never holds gift money), California commingling (same), 1099-K filer (Stripe), and Stripe's "on behalf of" rule (the nonprofit charges on its own account).

## 8. Done when

- D0-B, D0-C, D0-D merged with CI green and no visible change; `npm test` (backend) and `npm run test:unit` + typecheck (frontend) pass with **no existing test changed** except moving fee cases into the shared fixture and adding `organizationId` to direct order inserts.
- D0-S merged behind `STRIPE_CONNECT_ENABLED`: a test-mode organization connects its own account, buys a ticket, gets a refund and opens a dispute, all on its account, with Jump's fee arriving as an application fee.
- E1 answered and E4 merged before D1 starts; E2 and E3 settled before `DONATIONS_ENABLED` goes on in production.
- `docs/wiki/` and the AGENTS files updated: Gotcha 12 (per-line rate and fee mode, shared fixture, organization collects tax), Gotcha 13 (direct charges: `stripeAccount` on every money call, never `transfer_data`), Gotcha 17 (`Order.organizationId` is the org scope; `eventId` is null only for DONATION orders), and the Stripe webhooks gotcha (money events arrive on the Connect endpoint).
