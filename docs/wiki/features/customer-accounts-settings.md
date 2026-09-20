# Settings › Customer accounts

**Status**: Implemented — all three phases (spec 031, 2026-09-20).
**Last Updated**: 2026-09-20
**Spec**: `specs/031-customer-accounts/spec.md`, plan in `plan.md`

## Overview

Organizer-facing controls for the buyer accounts that already exist ([Buyer Accounts](buyer-accounts.md)). Modelled on Shopify's Settings › Customer accounts screen. Phase 1 adds the Settings nav entry and:

- **Sign-in links** — one toggle (`Organization.buyerSignInLinks`, default on). On: the storefront header shows *Sign in* (no buyer session for this org) or *Account* (session), and the checkout contact step says *Already have an account? Sign in*. A signed-in buyer at checkout gets first/last/email prefilled and no "Create an account" box (the order is sent with `createAccount: false`).
- **Branding** — pointer to Settings › General; checkout and the account page already take the org's brand tokens through `BrandScope`.
- **Authentication** — `Organization.buyerSignInMethod`: **Email link** (default; 15-minute single-use link) or **Email code** (phase 3): the sign-in email leads with a 6-digit code and the account page shows a code field after the email step; the link is still in the email as a fallback. Sessions are 30 days either way.
- **URL** — the public account URL with a copy button: `https://<active custom domain>/account` when the org has an ACTIVE domain, otherwise `<platform>/organizations/<id>/account`. *Manage* links to Settings › Domains.

Phase 2 adds **Self-serve refunds** (row in the same card): a toggle (`selfServeRefundsEnabled`, default on) and, when on, a form with a *cutoff* in hours before the event start (`selfServeRefundCutoffHours`, blank = until the event starts) and a *fee* (`selfServeRefundFeeType` NONE / FIXED / PERCENT + `selfServeRefundFeeValue`). The policy applies on top of each tier's `isRefundable` flag:

- A ticket is self-refundable iff policy enabled ∧ tier refundable ∧ ticket `VALID` ∧ `now < event.date − cutoff` ∧ `pricePaid − fee > 0`. Gates are checked in that order and the first failure is the `reason` (`DISABLED`, `TIER`, `STATUS`, `WINDOW_CLOSED`, `ZERO`).
- Fee: FIXED = `min(value, pricePaid)`; PERCENT = `round(pricePaid × value / 100)`. The buyer receives `pricePaid − fee`; the organization keeps the fee, recorded on `Refund.feeAmount`.
- The buyer's account page shows the terms per ticket (*Refundable until … · $2.50 fee*, *Refund window closed*, *Not refundable*), the confirm names the net amount, and the button appears only when eligible.
- Staff refunds from `/admin/orders` ignore the policy and return the full price; the order detail's refund row shows *$X fee retained* when applicable. Because a retained fee is money still on the order, a self-refund with a fee leaves the order `PARTIALLY_REFUNDED`; a later staff `refundOrder` returns the remainder.

### One-time code (phase 3)

- `BuyerAuthService.requestLogin` issues a `CODE` token alongside the `LOGIN` link when the org is on `CODE`: `randomInt` 6 digits, 10-minute TTL, stored as `sha256("code:<orgId>:<email>:<code>")` so a code is only good for the address and organization it was sent to. The per-email cap (3 LOGIN tokens / 15 min) still gates requests.
- `consumeCode(orgId, email, code)` checks the newest live code for that address with a timing-safe compare; a wrong guess increments `BuyerLoginToken.attempts` and the fifth sets `usedAt` (dead). Success claims it with the same `updateMany` single-use predicate. Every failure is the same 401.
- `POST /buyer/auth/verify-code { organizationId, email, code }` → `{ sessionToken, organizationId }`, behind `BUYER_AUTH_VERIFY` (30 / 15 min per signed client IP). Frontend proxy `POST /api/buyer/verify-code` sets the `jump_buyer` cookie like `/verify`.
- The account page reads `organization.buyerSignInMethod` from the public payload; on success it honours a stored `?next=` path, else reloads its data in place.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/CustomerAccountSettingsService.js` | `get` / `update` (whitelist patch), serializes `accountUrl` via `buyerAccountUrl` + active domain hostname |
| `backend/src/api/validators/customerAccountSettingsValidators.js` | Partial PATCH validator (`buyerSignInLinks: boolean`) |
| `backend/src/api/routes/admin.js` | `GET /admin/settings/customer-accounts` (organizer), `PATCH` (ADMIN) — org from `activeOrgFor(req)` |
| `backend/src/services/OrganizationService.js`, `EventService.js`, `routes/organizations.js` | Public payloads expose the flag: `organization.buyerSignInLinks` (org page + content identity), `event.organizationSignInLinks` (event / checkout) |
| `frontend/src/app/admin/settings/customer-accounts/page.tsx` | Settings page (cards above); ORGANIZER sees the toggle disabled |
| `frontend/src/app/admin/settings/SettingsNav.tsx` | **Customer accounts** entry after Applications |
| `frontend/src/components/OrganizationHeader.tsx` | `signIn` prop → header link (`data-testid="buyer-sign-in-link"`) |
| `frontend/src/lib/useBuyer.ts` | Client hook: one `GET /api/buyer/me` per mount, another org's session counts as signed out |
| `frontend/src/lib/buyerNext.ts` | `safeNextPath` (relative paths only), `rememberNext` / `takeNext` via `sessionStorage` |
| `frontend/src/app/checkout/[eventId]/page.tsx` | Sign-in link with `?next=<current path>`, prefill, hidden opt-in for signed-in buyers |
| `frontend/src/app/organizations/[orgId]/account/page.tsx`, `account/verify/page.tsx` | Honour `?next=`: already signed in → redirect at once; otherwise stored before the magic link is requested and consumed after verify |
| `backend/src/services/RefundPolicyService.js` | Pure `evaluateRefundPolicy(policy, ticket, now)`, `refundFee`, `refundDeadline`, `REFUND_POLICY_SELECT`, buyer-facing messages |
| `backend/src/services/RefundService.js` | `refundTicket` takes `feeAmount`; `Refund.feeAmount` in both formatters; order stays `PARTIALLY_REFUNDED` while fees are retained |
| `backend/src/api/routes/buyerAuth.js` | Refund route evaluates the policy (403 ownership first, then 400 with the reason) |
| `backend/src/services/TicketService.js` | `listTickets(where, { refundPolicy })` adds `refundPolicy` per ticket for buyers |
| `backend/tests/unit/refundPolicyService.test.js` | 7 tests: fee rules, deadline, gate order, boundary at the deadline |
| `backend/tests/contract/buyerRefundPolicy.test.js` | 7 tests: defaults, disabled, cutoff, fixed fee + staff remainder, percent + ZERO, staff bypass, tier/voided |
| `backend/tests/contract/customerAccountSettings.test.js` | 5 tests: defaults + platform URL, RBAC + validation, per-org toggle + public payload, refund policy save + pairing rules, custom-domain URL |
| `frontend/e2e/public-refund-policy.spec.ts` | Account page terms line, button gating, confirm + result copy |
| `backend/src/services/BuyerAuthService.js` | `issueCode`, `consumeCode`, `CODE_MAX_ATTEMPTS`; `requestLogin` returns `rawCode` for CODE orgs |
| `backend/src/api/routes/buyerAuth.js` | `POST /buyer/auth/verify-code` + `BUYER_AUTH_VERIFY` limiter |
| `backend/src/services/EmailService.js` | `sendBuyerLoginEmail({ code })` — code block + subject `<code> is your sign-in code for <org>` |
| `frontend/src/app/api/buyer/verify-code/route.ts` | Cookie-setting proxy |
| `backend/tests/contract/buyerSignInCode.test.js` | 5 tests: code email + single use, lockout after 5, address/org binding + malformed input, LINK orgs get no code, setting + public payload |
| `frontend/e2e/public-sign-in-code.spec.ts` | Code step, wrong/right code, LINK org has no field, `next` after code sign-in |
| `frontend/e2e/admin-customer-accounts.spec.ts`, `e2e/public-sign-in-links.spec.ts` | 8 tests × 2 browsers: nav + cards, toggle save, custom-domain URL, organizer read-only; header link states, checkout link + prefill, toggle off, `next` redirect + off-site rejection |

## Database

- `Organization.buyerSignInLinks Boolean @default(true)` — migration `20260930600000_organization_buyer_sign_in_links`.
- `Organization.buyerSignInMethod BuyerSignInMethod @default(LINK)`, `BuyerLoginToken.attempts Int @default(0)`, `BuyerTokenPurpose` gains `CODE` — migration `20260930900000_buyer_sign_in_code`.
- `Organization.selfServeRefundsEnabled Boolean @default(true)`, `selfServeRefundCutoffHours Int?`, `selfServeRefundFeeType SelfServeRefundFeeType @default(NONE)`, `selfServeRefundFeeValue Decimal(10,2)?`; `Refund.feeAmount Decimal(10,2) @default(0)` — migration `20260930700000_self_serve_refund_policy`.

## Gotchas

- **Default on changes every live storefront's header on deploy.** The toggle is the escape hatch; a menu *Buyer account* item (spec 027) still works when it is off.
- **`next` is same-origin only.** `safeNextPath` accepts paths starting with `/` (not `//`); anything else is dropped and the buyer lands on the account page. Across a mobile mail-app → other browser hop the `sessionStorage` value is lost, which is acceptable until phase 3's code sign-in.
- **The header link is not on focused flows.** Checkout, confirmation, apply and the account page do not pass `signIn`; checkout has its own inline link instead.
- **`buyerSignInLinks` is read only from public payloads** — never from the admin settings endpoint on the storefront.
- **One eligibility function.** The buyer refund route and the buyer ticket serializer both call `evaluateRefundPolicy`; the frontend only renders `refundPolicy`. Do not add a second check anywhere.
- **Staff never pay the fee.** `refundTicket` without `feeAmount` is the staff path; the policy is not consulted.
- **Deadline copy is in the browser's zone** until spec 021 adds an organization time zone.
- **Codes are a mode, not an addition.** One method per org; the email always keeps the link so a buyer on the same device loses nothing. Switching to LINK leaves already-issued codes usable until they expire (10 min).
