# Implementation Plan: Settings › Customer accounts (spec 031)

**Status**: Phase 1 merged 2026-09-20 (PR #113). Phase 2 merged 2026-09-20 (PR #114). Phase 3 built 2026-09-20 (`feat/031-customer-accounts-phase-3`).
**Phase 2 deviation**: a self-refund that retains a fee leaves the order `PARTIALLY_REFUNDED` (the fee is money still on the order) so staff can return it with `refundOrder`; the plan's §7 risk note assumed `REFUNDED`.
**Spec**: [spec.md](./spec.md)
**Dependencies**: nothing new. Reuses the buyer session (spec 007), the `/admin/online-store/preferences` GET/PATCH pattern, `RefundService.refundTicket`, `activeOrgFor(req)`, `storefrontFor()` and the spec 020 limiter factory.
**Phases**: three independently mergeable PRs, in order. Phase 1 is the one that puts the nav item in place; phases 2 and 3 add cards to the same page.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Settings nav | `frontend/src/app/admin/settings/SettingsNav.tsx` `SECTIONS` | Add the entry; page layout copied from `admin/settings/tax/page.tsx` (nav + cards) |
| Org-level preference GET/PATCH | `backend/src/api/routes/admin.js` `/online-store/preferences`, `services/StorefrontPreferencesService.js`, `validators/storefrontPreferencesValidators.js` (partial whitelist validator) | New `CustomerAccountSettingsService` + validator follow this exactly; ADMIN on PATCH |
| Card / toggle / section-status UI | `frontend/src/app/admin/online-store/preferences/page.tsx` (`Toggle`, `SectionStatus`, per-section save) | Copy the idiom; lift `Toggle` to `components/admin/Toggle.tsx` if it is the second use (it will be) |
| Public org payload | `OrganizationService.getPublicOrganization` (`select` list incl. `themeMode`, `storefrontPrivate`) | Add `buyerSignInLinks`, `buyerSignInMethod` |
| Storefront header | `frontend/src/components/OrganizationHeader.tsx` (`nav` prop, right slot already holds the mobile menu button) | Sign-in link mounts in the right slot |
| Checkout contact form | `frontend/src/app/checkout/[eventId]/page.tsx` ("No account required" copy at ~L456, create-account checkbox ~L564) | Sign-in link + prefill + hide checkbox |
| Buyer session (browser tier) | `frontend/src/app/api/buyer/me/route.ts`, `lib/buyerSession.ts` | New `useBuyer(orgId)` hook wraps `GET /api/buyer/me` |
| Account page + verify | `frontend/src/app/organizations/[orgId]/account/page.tsx`, `account/verify/page.tsx` | `next` param, refund copy, code entry (phase 3) |
| Storefront URLs | `backend/src/utils/storefrontUrl.js` `buyerAccountUrl(orgId)` (custom-domain aware via `storefrontFor`) | Account URL card reads this server-side |
| Self-service refund | `backend/src/api/routes/buyerAuth.js` `POST /me/tickets/:id/refund` → `RefundService.refundTicket` (full `pricePaid`) | Gains a policy check and an `amount`/`feeAmount` |
| Ticket serializer | `TicketService.getTicketsForContact` (`isRefundable` from tier) | Gains `refundPolicy` per ticket |
| Login tokens | `BuyerLoginToken` (`tokenHash` unique, `purpose`, TTL, single-use claim in `BuyerAuthService.consumeToken`) | `CODE` purpose reuses the table (phase 3) |
| Limiter factory | `middleware/rateLimit.js` `makeLimiter` + `LIMITS` | `BUYER_AUTH_VERIFY` for the code route |
| Tests | `backend/tests/contract/storefrontPreferences.test.js`, `buyerAuth.test.js`; `frontend/e2e/admin-preferences.spec.ts`, `helpers/session.ts` | Templates for the new suites |

## 2. Data model

`packages/db/prisma/schema.prisma`, one migration per phase.

```prisma
// Spec 031: Settings › Customer accounts
enum SelfServeRefundFeeType { NONE FIXED PERCENT }
enum BuyerSignInMethod { LINK CODE }

model Organization {
  // phase 1
  buyerSignInLinks           Boolean                @default(true)
  // phase 2
  selfServeRefundsEnabled    Boolean                @default(true)
  selfServeRefundCutoffHours Int?                                   // null = until event start
  selfServeRefundFeeType     SelfServeRefundFeeType @default(NONE)
  selfServeRefundFeeValue    Decimal?               @db.Decimal(10, 2)
  // phase 3
  buyerSignInMethod          BuyerSignInMethod      @default(LINK)
}

model Refund {
  feeAmount Decimal @default(0) @db.Decimal(10, 2)   // phase 2: retained by the org on a self-service refund
}

model BuyerLoginToken {
  attempts Int @default(0)                            // phase 3: failed code entries
}
enum BuyerTokenPurpose { WELCOME LOGIN CODE }         // phase 3
```

Defaults reproduce current behaviour except the header/checkout links (spec §5). Dev DB syncs with `db push` per the usual memory note; prod runs the migrations.

## 3. Phase 1 — nav item, sign-in links, account URL

### 3.1 Backend
- `services/CustomerAccountSettingsService.js`: `get(orgId)` → `{ buyerSignInLinks, accountUrl, domain: { hostname } | null, signInMethod: 'LINK', refundPolicy: {...} }` (refund/method fields ship in later phases; phase 1 returns the link flag + `accountUrl` from `buyerAccountUrl(orgId)` and the ACTIVE domain hostname if any). `update(orgId, patch)` whitelist write.
- `validators/customerAccountSettingsValidators.js`: `validateUpdateCustomerAccountSettings` — partial PATCH, phase 1 key `buyerSignInLinks: boolean`.
- `routes/admin.js`: `GET /admin/settings/customer-accounts` (organizer) and `PATCH` (`requireAdmin`), org from `activeOrgFor(req)`.
- `OrganizationService.getPublicOrganization` select gains `buyerSignInLinks`.

### 3.2 Frontend
- `SettingsNav.tsx`: `{ href: '/admin/settings/customer-accounts', label: 'Customer accounts' }` after Applications.
- `app/admin/settings/customer-accounts/page.tsx`: cards **Sign-in links** (toggle, saves on change, `SectionStatus`), **Customer accounts** group with rows *Configurations* (text pointer → `/admin/settings` Branding, no toggle), *Authentication* (read-only "Email link · sign-in link valid 15 minutes · session 30 days"), *URL* (resolved URL in a read-only input + Copy; *Manage* → `/admin/settings/domains`). ORGANIZER sees the toggle disabled with the ADMIN hint used on Preferences.
- `services/api.ts`: `getCustomerAccountSettings()`, `updateCustomerAccountSettings(patch)` + types.
- `lib/useBuyer.ts`: client hook `useBuyer(orgId)` → `{ buyer | null, loading }` from `GET /api/buyer/me`, treating a session for another org as null (same rule as the account page). One fetch per mount, no polling.
- `OrganizationHeader.tsx`: new prop `signIn?: boolean` (default `false`); pages that already pass `nav` pass `signIn={org.buyerSignInLinks}`. Renders `Sign in` / `Account` linking to `storefrontPath(orgId, '/account')` in the right slot beside the mobile menu button. Uses `brand` tokens.
- `checkout/[eventId]/page.tsx`: when `event.organization.buyerSignInLinks` (extend the event public payload or fetch the public org — the page already knows `organizationName`; add `buyerSignInLinks` to the event serializer's organization block) and no buyer: replace "No account required — …" with "No account required — just enter your details. Already have an account? **Sign in**" (`/account?next=<current path>`). With a buyer for this org: prefill first/last/email, keep them editable, hide the *Create an account* checkbox and send `createAccount: false`.
- `account/page.tsx` + `account/verify/page.tsx`: accept `?next=`; only relative paths starting with `/` and not `//` are honoured; verify page carries `next` through the magic link round-trip by storing it in `sessionStorage` before the email is requested (the token email cannot carry it safely) and reading it after verify.
- `lib/storefrontHost.ts` unchanged: `/account` already rewrites on custom domains.

### 3.3 Tests
- Contract `customerAccountSettings.test.js`: GET defaults, PATCH by ADMIN, 403 ORGANIZER, 400 non-boolean, org scoping via `X-Jump-Org`, public payload exposes the flag, `accountUrl` switches to the custom domain when one is ACTIVE.
- E2E `admin-customer-accounts.spec.ts` (`signInAsStaff`): nav entry, toggle round-trip, URL copy. `storefront-sign-in-links.spec.ts`: header link on/off, checkout link on/off, prefill with a stubbed `/api/buyer/me`, `next` redirect after verify (stubbed).

## 4. Phase 2 — self-serve refund policy

### 4.1 Backend
- `services/RefundPolicyService.js` (pure): `evaluate(org, ticket)` → `{ eligible, reason: 'DISABLED' | 'TIER' | 'STATUS' | 'WINDOW_CLOSED' | 'ZERO' | null, deadline: Date | null, fee, refundAmount }`. `deadline = event.date − cutoffHours·1h` (or `event.date`). Fee rules per spec FR-04; rounding `round(x·100)/100`, fee capped at `pricePaid`.
- `RefundService.refundTicket(ticketId, { reason, initiatedBy, amount = null, feeAmount = 0 })`: when `amount` is given it must equal `pricePaid − feeAmount` (guard), the `Refund` row stores `amount` + `feeAmount`, Stripe is refunded `amount`. Ticket is still VOIDED and inventory restored. Staff callers pass nothing → unchanged.
- `routes/buyerAuth.js` refund route: load ticket with event + tier + org policy, `evaluate`, 400 `ValidationError(reasonMessage)` when ineligible, else call `refundTicket` with the computed amount/fee. Replaces the inline `isRefundable`/`VALID` checks (they move into `evaluate`).
- `TicketService.getTicketsForContact`: include `event.date`, org policy; each ticket gains `refundPolicy: { eligible, reason, deadline, fee, refundAmount }`. `isRefundable` stays for compatibility.
- Settings service/validator: `selfServeRefundsEnabled: boolean`, `selfServeRefundCutoffHours: int 0–8760 | null`, `selfServeRefundFeeType: enum`, `selfServeRefundFeeValue: number ≥ 0 (≤ 100 when PERCENT), required when type ≠ NONE`.
- Orders: `OrderService` order detail and the Orders CSV include `feeAmount` on refund rows ("Refunded $18.00 · $2.00 fee retained"); tax report unaffected (fee is not tax).

### 4.2 Frontend
- Settings page: **Self-serve refunds** row with toggle; when on, an inline form: *Cutoff* (number of hours before the event, blank = until start), *Fee* (None / Fixed amount / Percentage + value). Saves through the same PATCH.
- Account page tickets: from `refundPolicy` render "Refundable until Sat, Sep 26, 7:00 PM · $2.00 fee" / "Refund window closed" / "Not refundable"; confirm dialog: "You'll receive $18.00 (of $20.00)". Button only when `eligible`.
- Admin order detail refund row shows the retained fee.

### 4.3 Tests
- Unit `refundPolicyService.test.js`: disabled, tier gate, status gate, cutoff boundary (exactly at deadline is closed), null cutoff, fixed fee > price caps to zero refund (`ZERO`), percent rounding.
- Contract: buyer refund 400 on `WINDOW_CLOSED`, succeeds with fee → `Refund.amount`/`feeAmount`, Stripe stub called with the net amount, staff refund path unchanged, PATCH validation matrix.
- E2E: settings form, account page copy with stubbed `/api/buyer/me/tickets`.

## 5. Phase 3 — one-time code sign-in

### 5.1 Backend
- `BuyerAuthService.requestLogin(orgId, email)` returns `rawCode` too when `org.buyerSignInMethod === 'CODE'`: 6 digits from `crypto.randomInt`, stored as `sha256(orgId:email:code)` with `purpose CODE`, 10-minute TTL, same per-email cap as LOGIN.
- `consumeCode(orgId, email, code)`: find newest unused, unexpired CODE token for the contact; compare hash; on mismatch increment `attempts` and throw 401 (token dead at 5); on match claim it (`updateMany` single-use pattern) and return the contact.
- `POST /buyer/auth/verify-code` with `makeLimiter('BUYER_AUTH_VERIFY', …)` (e.g. 30 / 15 min per IP); response identical to `/verify`.
- `EmailService.sendBuyerLoginEmail` gains `code` (rendered above the link when present).
- Settings service/validator: `buyerSignInMethod: 'LINK' | 'CODE'`; public payload exposes it.

### 5.2 Frontend
- `app/api/buyer/verify-code/route.ts` proxy setting the cookie like `verify`.
- Account page: in CODE mode, after "Check your email" show a 6-digit input + *Continue*; on success reload profile / honour `next`.
- Settings page: **Authentication** card becomes a radio (Email link / Email code) with the fixed facts beneath.

### 5.3 Tests
- Unit: code hashing, TTL, attempt lockout, single use.
- Contract: verify-code happy path, wrong code ×5 → locked, limiter (`RATE_LIMIT_ENFORCE_IN_TESTS=1`), method flag in public payload.
- E2E: account page code flow with stubbed proxies.

## 6. Documentation and hand-off
- `/doc-feature` → `docs/wiki/features/customer-accounts-settings.md`; update `buyer-accounts.md` (sign-in links, code method, refund policy) and `docs/wiki/README.md`.
- `AGENTS.md` root Gotchas: one line — "Self-service ticket refunds go through `RefundPolicyService.evaluate` (spec 031); staff refunds never apply the policy or fee."
- `specs/STATUS.md` row 031.
- Kanban: root card + three phase cards per `docs/development/kanban-workflow.md`; each PR returns URL, files, tests, migration, SHA, risks.

## 7. Risks
- **Header link on by default** changes every live storefront's header on deploy — announce in the release note; the toggle is the escape hatch.
- **`next` through magic link**: relies on `sessionStorage` in the same browser; cross-browser (mobile mail app) loses `next` and lands on the account page — acceptable, and the phase 3 code method removes the cross-browser case.
- **Fee on partial refunds** interacts with `PARTIALLY_REFUNDED` totals in `refundOrder` (`alreadyRefunded + refundAmount > totalAmount` guard) — the retained fee makes a later staff full-order refund possible for the remainder; contract test covers "self refund with fee, then staff refunds the rest".
- **Event date edits** after a buyer saw a deadline: the policy is evaluated at request time, never cached.
