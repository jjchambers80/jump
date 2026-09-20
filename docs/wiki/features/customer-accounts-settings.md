# Settings › Customer accounts

**Status**: Phase 1 implemented (spec 031, 2026-09-20). Phases 2 (self-serve refund policy) and 3 (one-time code sign-in) planned.
**Last Updated**: 2026-09-20
**Spec**: `specs/031-customer-accounts/spec.md`, plan in `plan.md`

## Overview

Organizer-facing controls for the buyer accounts that already exist ([Buyer Accounts](buyer-accounts.md)). Modelled on Shopify's Settings › Customer accounts screen. Phase 1 adds the Settings nav entry and:

- **Sign-in links** — one toggle (`Organization.buyerSignInLinks`, default on). On: the storefront header shows *Sign in* (no buyer session for this org) or *Account* (session), and the checkout contact step says *Already have an account? Sign in*. A signed-in buyer at checkout gets first/last/email prefilled and no "Create an account" box (the order is sent with `createAccount: false`).
- **Branding** — pointer to Settings › General; checkout and the account page already take the org's brand tokens through `BrandScope`.
- **Authentication** — read-only for now: email link, 15-minute link, 30-day session.
- **URL** — the public account URL with a copy button: `https://<active custom domain>/account` when the org has an ACTIVE domain, otherwise `<platform>/organizations/<id>/account`. *Manage* links to Settings › Domains.

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
| `backend/tests/contract/customerAccountSettings.test.js` | 4 tests: defaults + platform URL, RBAC + validation, per-org toggle + public payload, custom-domain URL |
| `frontend/e2e/admin-customer-accounts.spec.ts`, `e2e/public-sign-in-links.spec.ts` | 8 tests × 2 browsers: nav + cards, toggle save, custom-domain URL, organizer read-only; header link states, checkout link + prefill, toggle off, `next` redirect + off-site rejection |

## Database

- `Organization.buyerSignInLinks Boolean @default(true)` — migration `20260930600000_organization_buyer_sign_in_links`.

## Gotchas

- **Default on changes every live storefront's header on deploy.** The toggle is the escape hatch; a menu *Buyer account* item (spec 027) still works when it is off.
- **`next` is same-origin only.** `safeNextPath` accepts paths starting with `/` (not `//`); anything else is dropped and the buyer lands on the account page. Across a mobile mail-app → other browser hop the `sessionStorage` value is lost, which is acceptable until phase 3's code sign-in.
- **The header link is not on focused flows.** Checkout, confirmation, apply and the account page do not pass `signIn`; checkout has its own inline link instead.
- **`buyerSignInLinks` is read only from public payloads** — never from the admin settings endpoint on the storefront.
