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
- `POST /tickets/scan` and `/redeem` require a staff session (ORGANIZER+) or `X-Scanner-Key: $SCANNER_API_KEY` (`middleware/scannerAuth.js`). The admin check-in page uses the org-scoped `/admin/tickets/*` routes instead.
- There is no buyer surface on staff auth: `/orders/my`, `/tickets/my`, `/tickets/:id`, `/tickets/:id/request-refund` were removed in phase 4. Buyer self-service (orders, tickets, refunds) is under `/buyer/me/*` with `requireBuyer`.

## Buyer Auth (spec 007 phase 2)

- Buyers sign in without passwords. `BuyerAuthService` issues single-use hashed tokens (`BuyerLoginToken`: LOGIN 15 min, WELCOME 7 days) and mints a separate HS256 JWT with `typ: 'buyer'`. `middleware/auth.js` rejects buyer tokens; `middleware/buyerAuth.js` (`requireBuyer`) rejects staff tokens.
- Routes live in `api/routes/buyerAuth.js` under `/buyer`. `POST /buyer/auth/request` always returns 202. The frontend calls these only through `frontend/src/app/api/buyer/*` route handlers, which hold the session in the httpOnly `jump_buyer` cookie.
- Checkout opt-ins: `POST /orders` accepts `createAccount` and `emailSubscribed` booleans, stored on `Order.optInAccount`/`optInMarketing`. `PaymentService.handleCheckoutCompleted` applies them to the Contact (only ever turning on) and issues the WELCOME link. Never set `accountCreatedAt` or `emailSubscribed` from an unpaid checkout.
- Rate limiting behind the Next proxy: key on `clientIpForRateLimit(req)` (signed `X-Jump-Client-Ip`), not `req.ip`.
- Storefront URLs in emails and Stripe redirects come from `utils/storefrontUrl.js`, which is async and per organization: an ACTIVE custom domain (`DomainService.primaryHostname`) wins, else the first `FRONTEND_URL` entry. On a custom host the org page is `/` and the buyer account page is `/account`.

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

Vendor / sponsor / press forms per event — a second money path next to orders. Rules that differ from tickets:

1. **Webhook dispatch is on `metadata.applicationId`**: `routes/webhooks.js` hands those events to `ApplicationPaymentService.handleEvent` before the order switch; ticket sessions never carry that key. `charge.refunded` is matched by known intent id.
2. **Capacity is taken on approval, never on submission** (`ApplicationTier.quantityApproved` / `quantityReserved`, conditional `UPDATE … RETURNING` in `ApplicationService._takeCapacity`). Review `status` and `paymentStatus` are independent columns. The amount snapshot on `Application` is the only amount ever charged; tier price edits only surface as `pricing.changed` on the admin detail.
3. **PAID forms are gated by `APPLICATIONS_PAYMENTS_ENABLED`** (`paymentsEnabled()` in `ApplicationFormService`); bulk APPROVE on PAID is refused per application (each approval charges the saved card) — bulk WAITLIST / REJECT are fine.
4. **Sweeps in `server.js`** share one unref'd hourly timer (`APPLICATION_SWEEP_INTERVAL_MS`): `ApplicationPaymentService.sweepOverdue` then `ApplicationDigestService.sendDue`. The digest claims each organization's 24 h window with a conditional `updateMany` on `Organization.applicationDigestAt` before reading, so multiple instances never double-send.
5. **Guest status links are derived**: `applicationLinks.statusToken` = HMAC(`AUTH_SECRET`, `application-status:<id>`); rotating the secret invalidates every emailed link. Withdraw / update card / profile edits need the buyer session.
6. `POST /organizations/:orgId/events/:eventId/duplicate` (DRAFT copy incl. price tiers + application forms) is the only route in `routes/events.js` behind `requireOrgMembership`; the older org event routes rely on service-level `venue.organizationId` scoping.

See `docs/wiki/features/applications.md`.

## Add-ons (spec 012)

Products sold alongside a ticket tier (phase 1) or an application tier (phase 2): `AddOnService`, routes `/organizations/:orgId/events/:eventId/add-ons` (ADMIN writes, member reads).

1. **Lines live on their own tables** (`OrderAddOn`, `ApplicationAddOn`), never on `OrderItem`. `Order.quantity` stays the ticket count; `TicketService.createTicketsForOrder` and analytics never see add-on lines.
2. **Same money rule as tiers**: add-on lines are extra items in the one `FeeService.computeOrderFees` call with `taxable: addOn.taxable`; tax is computed on taxable listed value only, fees on the whole subtotal. Fee mode is inherited (tickets PASS; applications the form's PASS/ABSORB via `applicationAmounts(lines, form, event, org)` — `tierAmounts` is its one-line wrapper). `frontend/src/lib/fees.ts` mirrors the per-item `taxable` rule — change both plus both fixture files.
3. **Capacity**: `AddOn.quantityTotal` null = unlimited, otherwise the same conditional `UPDATE … RETURNING` as `PriceTier` via `AddOnService.reserve` (called after the tier reservations in `OrderService.createOrder`), `release` (Stripe failure, `failOrder`), `commit` (`OrderService.completeOrder`), `unsell` (refunds). Every path that decrements tier reservations must also call `release`.
4. **Offers**: `scope` TICKET / APPLICATION / BOTH; `allTiers` or explicit `PriceTierAddOn` / `ApplicationTierAddOn` rows. `validateOrderLines` re-checks scope, attachment to a cart tier, `isActive` and `maxPerOrder` server-side; the public event payload (`GET /events/:id` → `addOns[]`) carries `priceTierIds` for the storefront picker.
5. **Refunds**: `RefundService.refundAddOnLine` refunds the line's all-in amount (`Refund.orderAddOnId`) and releases quantity; `refundOrder` marks open lines refunded. Order status is REFUNDED only when no VALID/REDEEMED ticket and no open add-on line remain.
6. Add-ons with any line cannot be deleted (409) — deactivate. Event duplicate copies add-ons with remapped tier attachments (`copyForms` returns the application tier id map for this).
7. **Applications (phase 2)**: `POST /events/:eventId/applications` takes `addOns: [{ addOnId, quantity }]`, validated by `AddOnService.validateApplicationLines` against the tier's offer (`allTiers` or `ApplicationTierAddOn`; ADMIN sets attachments per tier with `PUT …/application-forms/:formId/tiers/:tierId/add-ons`). `ApplicationAddOn` keeps `unitPrice` and `applicantPays` (the line's allocated share) so Stripe Checkout / the status page itemise exactly the snapshot; the tier line is `Application.applicantPays − Σ lines`. Nothing is held at submission. **Approval takes the tier slot first, then reserves add-ons in display order** (`ApplicationService._takeCapacity`); a sold-out add-on throws 409 `{ addOnId, name, remaining, requested, suggestion: 'EDIT_ADD_ONS' }` and the transaction rolls the tier back. `capacitySlot` covers both: RESERVED = tier reserved + add-ons reserved, APPROVED = tier approved + add-ons sold (`_markPaid` commits, `_releaseCapacity` / the overdue sweep release or unsell). Lines change only through `updateAddOns` (`PATCH /admin/events/:eventId/applications/:id/add-ons`, ORGANIZER+, allowed in SUBMITTED / WAITLISTED / APPROVED+PAYMENT_DUE — see `addOnsEditable`): recomputes the snapshot at today's prices, moves any held reservations, expires a pending pay-now session, writes an `ADD_ONS_CHANGED` decision and emails the `ADD_ONS_CHANGED` template (`{{addOns.summary}}`). After PAID: refund an amount, never edit lines.
8. **Reporting (phase 3)**: `GET …/add-ons/sales` (per add-on sold / reserved / remaining / listed revenue, split `orders` vs `applications` with `held` / `pending`) and `…/add-ons/purchasers.csv` (one row per line, both sources) on the add-ons router; the daily digest adds "Add-ons requested" totals per form. See `docs/wiki/features/add-ons.md`.

## Application money: reporting and corrections (spec 018)

There is no org-wide transactions list (phase 1 was removed 2026-09-18); application money is managed under `/admin/events/:eventId/applications`. The org-wide **submissions** list (spec 019, `/admin/applications*`) is not a money list: `ApplicationService.listInScope / summaryInScope / exportCsvInScope / bulkDecideInScope` take a `{ eventId?, organizationId? }` scope and the per-event methods wrap them, so never add a second list implementation — extend the scope. Organizer metadata on an application (booth, note, tags, check-in) goes through one `PATCH …/applications/:id` → `ApplicationService.updateMeta`; check-in stamps are refused unless APPROVED.

1. **Refund routes are ADMIN on both types** (`/admin/orders/:id/refund`, `/tickets/:id/refund`, `/orders/:id/add-ons/:lineId/refund`, `/admin/events/:eventId/applications/:id/refund`).
2. **Reporting (phase 2)**: `PAID_ORDER_STATUSES` / `PAID_APPLICATION_STATUSES` in `services/paidStatuses.js` are the one definition of "money collected" — `CustomerService`, `EventService.getEventAnalytics`, the dashboard stats and `TaxService.collectedReport` all import them. A customer is a contact with either; `totalSpent` stays gross with `totalRefunded` beside it. Application tax joins the tax report by `paidAt` on `form.taxable` forms; rows carry `count` + `sources[]` (the `orders` field is an alias of `count`).
3. **Corrections (phase 3)**: `amountEditable(application)` in `ApplicationService` is the single gate for tier change, adjustments and add-on edits — SUBMITTED / WAITLISTED / APPROVED+PAYMENT_DUE only, never after money moved or once `paymentSource = OFFLINE`. Adjustments (`ApplicationAdjustment`, signed) fold into the **tier line** via `applicationLines(tier, form, lines, adjustmentTotal)` — FeeService never sees a negative item and `tier.price + Σ ≥ 0` is enforced. Waive and offline payment (ADMIN, APPROVED+PAYMENT_DUE) confirm the held slot the way `_markPaid` does (`_confirmHeldSlot`) and set `paymentSource = OFFLINE`; a waived row is `NOT_REQUIRED` + OFFLINE with a `WAIVER` adjustment. `ApplicationPaymentService.refund` records a `manual` refund for OFFLINE rows with no Stripe call. Every Stripe path already gates on `paymentStatus` (`PAYMENT_DUE` / `PROCESSING` / `stripePaymentIntentId`), so offline rows never reach Stripe. See `docs/wiki/features/application-payments-reporting.md`.

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
