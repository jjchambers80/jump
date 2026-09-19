# Backend — Scoped Agent Instructions

Loads when agent touches `backend/` files. For root-level commands and env vars, see [`../AGENTS.md`](../AGENTS.md).

## Auth Flow

1. Frontend Auth.js handles login (Google OAuth / magic link)
2. JWT callback injects `accessToken` into session
3. Frontend sends `Authorization: Bearer <token>` to backend
4. `middleware/auth.js` verifies JWT with shared `AUTH_SECRET` (HS256)
5. `req.user` populated: `{id, email, role, name, organizationId}` — `organizationId` is the `X-Jump-Org` header (admin org switcher) or the sign-in claim; scoping always verifies it against `OrganizationMember`. Roles: `UNASSIGNED | ORGANIZER | ADMIN | SYSTEM_ADMIN`

## Tenancy (spec 007)

- Buyers = `Contact`, one row per `(organizationId, email)`. Checkout upserts by `organizationId_email` with the event's venue org.
- Staff = `User` + `OrganizationMember(userId, organizationId, role)`. `resolveOrgScope(userId, role, preferredOrgId)` picks the active org; `requireOrgMembership(param)` guards `/organizations/:orgId/*` routes. SYSTEM_ADMIN bypasses both.
- Customer admin queries filter `Contact.organizationId` directly; never scope contacts through orders.
- `POST /tickets/scan` and `/redeem` require a staff session (ORGANIZER+) or `X-Scanner-Key: $SCANNER_API_KEY` (`middleware/scannerAuth.js`). Staff sessions are scoped to their organization (`scannerOrgScope(req)` → `TicketService.{lookupByBarcode,redeemByBarcode,redeemTicket}(…, { organizationId })`; a foreign ticket reads as `INVALID`); readers are unscoped, and so is SYSTEM_ADMIN only when no `X-Jump-Org` header is sent. The admin check-in page uses the org-scoped `/admin/tickets/*` routes instead.
- Spec 022 onboarding: `/signup*` (`routes/signup.js`, any signed-in user) creates a **pending** organization (`onboardingCompletedAt: null`, only `OnboardingService.start` writes null — the column defaults to `now()`) plus an ADMIN membership and a `PlatformCustomer` (the org's relationship with Jump: owner, plan, Stripe Billing customer, survey JSON — never a `Contact`). Pending orgs are hidden from `GET /organizations`; `complete` stamps the org and promotes `UNASSIGNED → ADMIN`. `POST /organizations` adds the creator as ADMIN member, so contract tests must call it with a `staffToken`, not a fabricated JWT. Phase 2 (`BILLING_ENABLED` + `JUMP_STARTER_PRICE_ID`): `BillingService` runs Jump's subscriptions on the **same `stripe` client** (Jump's account; the organization's connected account is never involved) — embedded Checkout in subscription mode, `confirmCheckout` on return, `statusFor` / `portalLink` for Settings › Plan — and mirrors state only from Stripe objects; subscription events arrive on `POST /webhooks/stripe/billing` (`STRIPE_BILLING_WEBHOOK_SECRET`), and `BillingService.isBillingEvent` makes each endpoint ignore the other's events. Nothing is gated on `PlatformCustomer.plan`. Phase 3: `complete` seeds `SEED_TEMPLATES` (config/onboarding.js) through `ApplicationFormTemplateService.create` when the survey chose applications; `sweepAbandoned` runs hourly from `server.js`; `GET /organizations` returns `plan` / `onboarding` only for SYSTEM_ADMIN. See `docs/wiki/features/organization-onboarding.md`.
- There is no buyer surface on staff auth: `/orders/my`, `/tickets/my`, `/tickets/:id`, `/tickets/:id/request-refund` were removed in phase 4. Buyer self-service (orders, tickets, refunds) is under `/buyer/me/*` with `requireBuyer`.

## Buyer Auth (spec 007 phase 2)

- Buyers sign in without passwords. `BuyerAuthService` issues single-use hashed tokens (`BuyerLoginToken`: LOGIN 15 min, WELCOME 7 days) and mints a separate HS256 JWT with `typ: 'buyer'`. `middleware/auth.js` rejects buyer tokens; `middleware/buyerAuth.js` (`requireBuyer`) rejects staff tokens.
- Routes live in `api/routes/buyerAuth.js` under `/buyer`. `POST /buyer/auth/request` always returns 202. The frontend calls these only through `frontend/src/app/api/buyer/*` route handlers, which hold the session in the httpOnly `jump_buyer` cookie.
- Checkout opt-ins: `POST /orders` accepts `createAccount` and `emailSubscribed` booleans, stored on `Order.optInAccount`/`optInMarketing`. `PaymentService.handleCheckoutCompleted` applies them to the Contact (only ever turning on) and issues the WELCOME link. Never set `accountCreatedAt` or `emailSubscribed` from an unpaid checkout.
- Rate limiting behind the Next proxy: key on `clientIpForRateLimit(req)` (signed `X-Jump-Client-Ip`), not `req.ip`.
- Storefront URLs in emails and Stripe redirects come from `utils/storefrontUrl.js`, which is async and per organization: an ACTIVE custom domain (`DomainService.primaryHostname`) wins, else the first `FRONTEND_URL` entry. On a custom host the org page is `/` and the buyer account page is `/account`.

## Online Store › Preferences

- `StorefrontPreferencesService`: `GET/PATCH /admin/online-store/preferences` (PATCH is ADMIN; partial; `password` string sets / `null` clears the scrypt hash; private mode requires a password and the two are only cleared together). The hash is omitted by the Prisma client globally — opt in with `omit: { storefrontPasswordHash: false }` or a `select`.
- `GET /organizations/:id/public` returns `locked: true` + `message` and no events when the store is private and the request lacks a valid `X-Storefront-Access` token (HS256 JWT bound to the org id and a fingerprint of the current hash, minted by `POST /organizations/:id/storefront-access`, rate limited 10 / 15 min per IP + org; the header may carry several tokens, comma-separated). Every other public storefront route (`GET /events/:id`, `GET /venues/:id`, `POST /orders`, public application form routes) uses `middleware/storefrontGate.js` and answers 403 `StorefrontLockedError` — add the gate to any new public storefront route. `listPublishedEvents` hides private stores. `GET /organizations/:id/public/meta` feeds the storefront `generateMetadata`. See `docs/wiki/features/online-store-preferences.md`.

## Custom Domains (spec 007 phase 3)

- `OrganizationDomain` rows: PENDING → VERIFIED → ACTIVE → FAILED. `DomainService.verifyDomain` checks `TXT _jump-verify.<host>` and the CNAME; with `lib/railwayDomains.js` configured it also waits for the certificate, otherwise DNS proof activates. `server.js` sweeps every 10 min (active domains daily) with an unref'd timer.
- `GET /domains/resolve?host=` (public, cached 60s) is what `frontend/src/middleware.ts` calls to map a tenant host to an organization. Only ACTIVE hosts resolve.
- Admin routes: `/admin/settings/domains` (GET/POST), `/:id/verify`, `/:id/primary`, `DELETE`. Scoped via `activeOrgFor(req)` in `routes/admin.js` (same helper as `/admin/settings/business-details` and `/people`): members get `X-Jump-Org` if they belong to it else first membership; SYSTEM_ADMIN gets `X-Jump-Org`, then `?organizationId=`. Services take the resolved `organizationId` — do not add `*ForUser(userId)` methods, they ignore the switcher and 404 for SYSTEM_ADMIN.
- Hostnames must be subdomains (no apex), never platform hosts. `normalizeHostname` is the single validator.

## Payment Flow (WHY: Stripe is source of truth, not the client)

1. `POST /orders` → creates Order + Contact + reserves tier inventory
2. Backend creates Stripe Checkout Session → returns URL to frontend
3. Customer pays on Stripe-hosted page
4. `POST /webhooks/stripe` receives `checkout.session.completed`
5. PaymentService: marks order COMPLETED → creates tickets → sends email
6. **Never** update payment status from client requests — only from webhook
7. Spec 010 phase 2: with `STRIPE_CONNECT_ENABLED=true` and an active `OrganizationStripeAccount` (`transfersEnabled`, current `mode`, not disconnected), the session is a **destination charge** — `transfer_data.destination` + `application_fee_amount` = total cents − subtotal cents, so the organization receives exactly the ex-tax subtotal. Routing is decided only in `PaymentSettingsService.checkoutOptionsFor`; `PaymentTransaction.stripeAccountId` / `applicationFee` record it. Refunds on those orders pass `reverse_transfer` + `refund_application_fee`. Connected-account events arrive on `POST /webhooks/stripe/connect` (`STRIPE_CONNECT_WEBHOOK_SECRET`), never on the platform endpoint

## Applications (spec 011)

Vendor / sponsor / press forms per event. Since spec 024 a PAID-form application **is an order** (see the next section); the rules that differ from tickets:

1. **Webhook dispatch is on `metadata.applicationId`**: `routes/webhooks.js` hands `checkout.session.*` / `setup_intent.*` / `payment_intent.*` events with that key to `ApplicationPaymentService.handleEvent` before the order switch; ticket sessions never carry it. `charge.refunded` is never dispatched there — every refund resolves through the order's `PaymentTransaction` in `RefundService.handleExternalRefund`, which branches on `order.kind`.
2. **Capacity is taken on approval, never on submission** (`ApplicationTier.quantityApproved` / `quantityReserved`, conditional `UPDATE … RETURNING` in `ApplicationService._takeCapacity`). Review `status` and `paymentStatus` are independent columns. The amount snapshot is the application's order (its lines and totals) and is the only amount ever charged; tier price edits only surface as `pricing.changed` on the admin detail.
3. **PAID forms are gated by `APPLICATIONS_PAYMENTS_ENABLED`** (`paymentsEnabled()` in `ApplicationFormService`); bulk APPROVE on PAID is refused per application (each approval charges the saved card) — bulk WAITLIST / REJECT are fine.
4. **Sweeps in `server.js`** share one unref'd hourly timer (`APPLICATION_SWEEP_INTERVAL_MS`): `ApplicationPaymentService.sweepOverdue` then `ApplicationDigestService.sendDue`. The digest claims each organization's 24 h window with a conditional `updateMany` on `Organization.applicationDigestAt` before reading, so multiple instances never double-send.
5. **Guest status links are derived**: `applicationLinks.statusToken` = HMAC(`AUTH_SECRET`, `application-status:<id>`); rotating the secret invalidates every emailed link. Withdraw / update card / profile edits need the buyer session.
6. `POST /organizations/:orgId/events/:eventId/duplicate` (DRAFT copy incl. price tiers + application forms) is the only route in `routes/events.js` behind `requireOrgMembership`; the older org event routes rely on service-level `venue.organizationId` scoping.

See `docs/wiki/features/applications.md`.

## Add-ons (spec 012)

Products sold alongside a ticket tier (phase 1) or an application tier (phase 2): `AddOnService`, routes `/organizations/:orgId/events/:eventId/add-ons` (ADMIN writes, member reads).

1. **Lines live on `OrderAddOn`** for ticket orders and application orders alike (spec 024), never on `OrderItem`. `Order.quantity` stays the ticket count (1 on an application order); `TicketService.createTicketsForOrder` and analytics never see add-on lines.
2. **Same money rule as tiers**: add-on lines are extra items in the one `FeeService.computeOrderFees` call with `taxable: addOn.taxable`; tax is computed on taxable listed value only, fees on the whole subtotal. Fee mode is inherited (tickets PASS; applications the form's PASS/ABSORB via `applicationAmounts(lines, form, event, org)` — `tierAmounts` is its one-line wrapper). `frontend/src/lib/fees.ts` mirrors the per-item `taxable` rule — change both plus both fixture files.
3. **Capacity**: `AddOn.quantityTotal` null = unlimited, otherwise the same conditional `UPDATE … RETURNING` as `PriceTier` via `AddOnService.reserve` (called after the tier reservations in `OrderService.createOrder`), `release` (Stripe failure, `failOrder`), `commit` (`OrderService.completeOrder`), `unsell` (refunds). Every path that decrements tier reservations must also call `release`.
4. **Offers**: `scope` TICKET / APPLICATION / BOTH; `allTiers` or explicit `PriceTierAddOn` / `ApplicationTierAddOn` rows. `validateOrderLines` re-checks scope, attachment to a cart tier, `isActive` and `maxPerOrder` server-side; the public event payload (`GET /events/:id` → `addOns[]`) carries `priceTierIds` for the storefront picker.
5. **Refunds**: `RefundService.refundAddOnLine` refunds the line's all-in amount (`Refund.orderAddOnId`) and releases quantity; `refundOrder` marks open lines refunded. Order status is REFUNDED only when no VALID/REDEEMED ticket and no open add-on line remain.
6. Add-ons with any line cannot be deleted (409) — deactivate. Event duplicate copies add-ons with remapped tier attachments (`copyForms` returns the application tier id map for this).
7. **Applications (phase 2)**: `POST /events/:eventId/applications` takes `addOns: [{ addOnId, quantity }]`, validated by `AddOnService.validateApplicationLines` against the tier's offer (`allTiers` or `ApplicationTierAddOn`; ADMIN sets attachments per tier with `PUT …/application-forms/:formId/tiers/:tierId/add-ons`). The lines are `OrderAddOn` rows on the application's order with per-line fee / tax shares; `buyerLineTotal(line, feeMode)` (`services/orderLines.js`) is what the applicant pays per line, so Stripe Checkout / the status page itemise exactly the snapshot; the tier line is `Order.totalAmount − Σ lines`. Nothing is held at submission. **Approval takes the tier slot first, then reserves add-ons in display order** (`ApplicationService._takeCapacity`); a sold-out add-on throws 409 `{ addOnId, name, remaining, requested, suggestion: 'EDIT_ADD_ONS' }` and the transaction rolls the tier back. `capacitySlot` covers both: RESERVED = tier reserved + add-ons reserved, APPROVED = tier approved + add-ons sold (`_markPaid` commits, `_releaseCapacity` / the overdue sweep release or unsell). Lines change only through `updateAddOns` (`PATCH /admin/events/:eventId/applications/:id/add-ons`, ORGANIZER+, allowed in SUBMITTED / WAITLISTED / APPROVED+PAYMENT_DUE — see `addOnsEditable`): recomputes the snapshot at today's prices, moves any held reservations, expires a pending pay-now session, writes an `ADD_ONS_CHANGED` decision and emails the `ADD_ONS_CHANGED` template (`{{addOns.summary}}`). After PAID: refund an amount, never edit lines.
8. **Reporting (phase 3)**: `GET …/add-ons/sales` (per add-on sold / reserved / remaining / listed revenue, split `orders` vs `applications` with `held` / `pending`) and `…/add-ons/purchasers.csv` (one row per line, both sources) on the add-ons router; the daily digest adds "Add-ons requested" totals per form. See `docs/wiki/features/add-ons.md`.

## Application orders — one ledger (spec 024; reporting and corrections from spec 018)

**A PAID-form application is an `Order` (`kind: APPLICATION`, `applicationId`) from submission on.** Money, Stripe payment objects and refunds live on `Order` / `OrderItem` / `OrderAddOn` / `PaymentTransaction` / `Refund`; `Application` keeps review state, capacity, the card on file and the decision log. FREE forms have no order. There is no org-wide transactions list (spec 018 phase 1 was removed 2026-09-18) and there must never be one beside Orders. The org-wide **submissions** list (spec 019, `/admin/applications*`) is not a money list: `ApplicationService.listInScope / summaryInScope / exportCsvInScope / bulkDecideInScope` take a `{ eventId?, organizationId? }` scope and the per-event methods wrap them — extend the scope, never add a second list. Organizer metadata (booth, note, tags, check-in) goes through one `PATCH …/applications/:id` → `ApplicationService.updateMeta`; check-in stamps are refused unless APPROVED.

1. **Order at submission**: `ApplicationService.submit` creates the order inside the submission transaction through `OrderService.createApplicationOrder(tx, { application, data })`, where `data = OrderLineService.applicationOrderData(tier, form, addOnLines, adjustments, event, organization)` — one `APPLICATION_TIER` item, an `OrderAddOn` per add-on, a signed `ADJUSTMENT` / `WAIVER` item per manual line, totals from `applicationAmounts` (unchanged fee math; adjustments fold into the tier line so `tier.price + Σ ≥ 0`). Replaced DRAFTs are withdrawn (`withdrawReason: 'replaced'`), never deleted, so their order stays as `CANCELLED`.
2. **Two states, one write**: `Application.paymentStatus` is the fine-grained machine; `Order.status` is derived by `orderStatusFor(application)` (`services/applicationOrderStatus.js`: `AWAITING_CARD / CARD_ON_FILE / PROCESSING / PAYMENT_DUE → PENDING`, `PAID → COMPLETED`, refunds as-is, `NOT_REQUIRED` on a PAID form = waived = `COMPLETED` at 0, `REJECTED / WITHDRAWN` before money moved → `CANCELLED`). Every write that touches `status` or `paymentStatus` goes through `ApplicationService._transition(tx, id, data, { orderData })` or writes the order in the same transaction (`ApplicationPaymentService._markPaid / _markPaymentDue`, `sweepOverdue`, `RefundService._recomputeApplicationOrderStatus`). Never update one without the other.
3. **Money reads go through `moneyOf(application)`** (`services/applicationMoney.js`) — every serializer, template (`ApplicationTemplateService.contextFor`), digest and CSV reads totals, Stripe ids, `paidAt`, `dueAt` (the payment-due clock), refunds, add-on lines and adjustments from `application.order`. Include `order: { include: ORDER_INCLUDE }` (`OrderLineService`) wherever money is needed. The API shapes (`amounts`, `payment`, `refunds`, `adjustments`, `addOns`, `paymentSource`, `offlinePayment`) did not change; they gained `orderId` / `orderRef`.
4. **One `PaymentTransaction` per order** (`orderId` unique): `ApplicationPaymentService._upsertPayment` writes it on the first charge attempt or payment-mode session and updates it in place — a declined approval charge leaves `status: FAILED` + `failureReason` + the failed intent id, a later pay-now or retry overwrites them, an offline payment sets `source: OFFLINE` + `offlineMethod / offlineReference / recordedById` and no Stripe id. A waived balance has no payment row.
5. **Refunds are `RefundService.refundOrder(orderId, { amount?, reason, initiatedBy })` for every kind.** `kind: APPLICATION` takes an amount (partial or the remainder), creates a `Refund` (`manual: true` with no Stripe call when the payment is offline) and moves both statuses; ticket orders refuse `amount` (400) and keep per-ticket / per-line / full semantics. `ApplicationService.refund` delegates and writes the `MANUAL_REFUND` decision. `POST /admin/orders/:orderId/refund { amount? }` and `POST /admin/events/:eventId/applications/:id/refund` land on the same ledger; both are ADMIN.
6. **Reporting**: `PAID_ORDER_STATUSES` (`services/paidStatuses.js`) is the one definition of "money collected" for both kinds — `CustomerService` (a customer has a paid order of either kind; `applicationCount` / `ticketOrderCount` split by `kind`), `EventService.getEventAnalytics` (`revenue.applications` = Σ APPLICATION orders), the dashboard stats and `TaxService.collectedReport` (date basis `paidAt`, falling back to `createdAt`; application orders count only when the form is taxable; rows carry `sources[]`). `AddOnService.sales / purchasersCsv` read application lines from `OrderAddOn` where `order.kind = APPLICATION`.
7. **Corrections (spec 018 phase 3)**: `amountEditable(application)` is the single gate for tier change, adjustments and add-on edits — SUBMITTED / WAITLISTED / APPROVED+PAYMENT_DUE only, never after money moved or once settled offline. All four rewrite the order through `ApplicationService._rewriteOrder` (`OrderLineService.rewriteApplicationOrder`: delete lines, recreate, update totals; adjustment ids are preserved). Waive adds a `WAIVER` item and zeroes the totals; offline payment upserts the OFFLINE payment row; both confirm the held slot like `_markPaid` (`_confirmHeldSlot`).
8. **Orders surface (phase 2)**: `GET /admin/orders` (`validateOrderListQuery` → `OrderService.getOrdersByOrganization`) is the one list for both kinds — `status` omitted hides FAILED + CANCELLED, a `pi_` / `re_` / `pyr_` / `cs_` search term matches Stripe ids by equality, rows carry `kind`, `description` (`OrderLineService.describe`), `businessName`, `statusDetail` (the application's fine state while PENDING) and `refunded` / `net`; `GET /admin/orders/export.csv` streams the same rows in pages of 500 plus a `refund` line per succeeded refund; `GET /buyer/me/orders` returns the same row shape. `POST /admin/orders/:orderId/refund` takes `amount` only for application orders. The Orders page (`frontend/src/app/admin/orders/`) is a shell with an **Orders / Tickets** toggle: `OrdersListView` (order rows) and `TicketRowsView` (the old ticket-row page, moved verbatim) — never add a third money list or sidebar entry. Jump's receipt (`ApplicationPaymentService.sendReceipt` → `EmailService.sendApplicationReceipt`) goes out once after `_markPaid` and after an offline payment, before the organizer's templated email; tests that count `sentEmails` after a payment expect it first.
9. **Apply-form opt-ins and consent (phase 3)**: `POST /events/:eventId/applications` requires `acceptances: [{ document, version }]` — TERMS + PRIVACY, plus CARD_AUTHORIZATION on PAID forms with `chargeTiming = APPROVAL` — checked by `LegalAcceptanceService.assertCurrent` against `config/legal.js` `LEGAL_VERSIONS` (400 `LEGAL_VERSION_STALE` / `LEGAL_ACCEPTANCE_REQUIRED`, `code` on the error body) and written inside the submission transaction with `requestMeta(req)` (hashed IP, UA) and the server-rendered `presentedText`. `optInAccount` / `optInMarketing` are stored on the application and applied by `ContactOptInService.applyForApplication` **when it first reaches SUBMITTED** — inside `submit` for FREE forms, in `ApplicationPaymentService._sendReceived` for PAID forms — never for a DRAFT; the same service applies checkout opt-ins (`PaymentService._applyOptIns`, source CHECKOUT) and records marketing provenance (`Contact.emailSubscribedSource / emailSubscribedAt / emailUnsubscribedAt`; staff edits = ADMIN). `POST /orders` records TERMS + PRIVACY when `acceptances` are sent, logs when they are not until `LEGAL_ACCEPTANCE_REQUIRED=true`, and always refuses a stale version. `GET /legal/versions` is the public source of the versions. Never write `LegalAcceptance` from a client-supplied text: the backend renders `presentedText` itself.
10. **Backfill**: migrations `20260930000000_application_orders_enums` (enum values must commit before use) and `20260930000001_application_orders` (add columns → SQL backfill of one order per PAID-form application with lines, payment and refunds → drop `ApplicationRefund`, `ApplicationAdjustment`, `ApplicationAddOn` and the money columns). `db push` databases run `npm run db:backfill:024` (`src/scripts/backfill-application-orders.js`, applies the same two files) **before** `db push`. `tests/contract/applicationOrdersBackfill.test.js` replays the migrations on a scratch database.

See `docs/wiki/features/application-orders.md` (and `application-payments-reporting.md` for the spec 018 history), `specs/024-application-orders/plan.md`.

## Capacity Enforcement (WHY: prevents overselling under concurrent load)

```sql
SELECT * FROM "PriceTier" WHERE id = ? FOR UPDATE  -- row-level lock
-- quantityTotal - quantitySold - quantityReserved >= requested
-- Reserve first, move reserved → sold after payment confirmation
```

## Fee Calculation (FTC All-In Pricing)

```
total = subtotal + platformFee + processingFee + tax
- platformFee = subtotal × 0.05
- processingFee = (subtotal + platformFee) × stripeRate + fixedFee
- tax = subtotal × taxRate, or backed out of the listed price when `Organization.taxInclusivePricing` (then subtotal = listed ÷ (1 + rate)) (venue-based; `Event.taxRate` is resolved from the organization's `TaxRegion` for the venue's state — not collecting → 0, MANUAL → flat rate, STRIPE → Stripe Tax lookup by postal code. See `docs/wiki/features/tax-calculation.md`)
```

## Tests

- `npm test` is self-sufficient: `tests/globalSetup.js` derives the test DB from `backend/.env` `DATABASE_URL` (database renamed to `jump_test`), creates it if missing and runs `prisma migrate deploy`. Override with `TEST_DATABASE_URL`; skip provisioning with `SKIP_TEST_DB_SETUP=1`.
- Suites run in parallel against one database. Every suite must use its own email/orderRef/barcode namespace and clean up in `afterAll` in dependency order — `Contact` before `Organization` (RESTRICT FK).
- Staff fixtures: `tests/helpers/staff.js` — `staffToken({ email, role })` creates a real `User`, `joinOrgByToken(token, orgId, role)` adds the `OrganizationMember`. Never sign a JWT for a user that does not exist: org-scoped routes resolve access through memberships and will 403.
- Non-staff (`UNASSIGNED`) tokens may still be fabricated; they only exercise 403 paths.
- Mock `@jump/db`, never `@prisma/client`; use `@jest/globals`, never `vitest`, in `backend/tests`.

## File Layout

```
src/api/routes/       # Express route handlers (15 files)
src/api/validators/   # Request validation (express-validator)
src/api/server.js     # App setup + middleware + route registration
src/config/           # Stripe, database, logging config
src/middleware/        # Auth, RBAC, error handling, file uploads
src/services/         # Business logic (~29 files: domain services + small helpers like applicationLinks.js, stripeRefund.js)
src/utils/            # Logger, metrics, barcode generation
```
