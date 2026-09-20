# Spec 031 — Settings › Customer accounts

**Status**: Proposed (2026-09-20). Not implemented.
**Source**: Shopify Admin › Settings › Customer accounts screen (screenshot reviewed 2026-09-20), assessed against what Jump already ships for buyer accounts (spec 007 phase 2/4, spec 024 phase 3).
**Plan**: [plan.md](./plan.md)

## 1. Why

Jump already has passwordless buyer accounts (`Contact.accountCreatedAt`, `/buyer/*`, the `jump_buyer` cookie, `/organizations/:id/account` — `/account` on a custom domain) and a per-tier `isRefundable` flag with a self-service refund button on the account page. What is missing is an organizer-facing place to control any of it:

- there is no sign-in link anywhere on the storefront unless the organizer adds a *Buyer account* item to a menu (spec 027);
- checkout never offers sign-in, so returning buyers retype their details and are asked to "create an account" they already have;
- self-service refunds are all-or-nothing per tier: no cutoff before the event, no fee, no org-level switch;
- the account URL is not surfaced anywhere in admin, so organizers cannot link to it from emails or social posts.

Shopify groups exactly these controls under **Settings › Customer accounts**. This spec adds that section to Jump's Settings nav and builds the subset that fits an event-ticketing platform.

## 2. Assessment of the Shopify screen

| Shopify item | Jump today | Verdict |
|---|---|---|
| **Sign-in links** — "Show sign-in links in the header of online store and at checkout" (toggle) | Nothing in `OrganizationHeader`; the checkout page says "No account required". Buyer account is reachable only through a menu link or the confirmation email | **Build (phase 1).** One org-level toggle. Header gets a *Sign in* / *Account* link; checkout gets *Already have an account? Sign in* and prefills the contact form for a signed-in buyer |
| **Configurations** — "Configure apps, branding, and features for checkout and customer accounts" | Storefront colour/theme already come from the org `brand` tokens through `BrandScope` (Gotcha 6/7), applied to checkout and the account page alike. Jump has no app platform | **Skip.** Nothing to configure that Settings › General › Branding does not already own. The page shows a one-line pointer to Branding instead of a card |
| **Authentication** — "Manage sign-in methods and account access" (email code, Shop, Google/Apple in Shopify) | Email magic link only (`BuyerLoginToken` LOGIN 15 min / WELCOME 7 d). No social login, no passwords by design (spec 007) | **Build partially (phase 3).** Add a **one-time code** sign-in method as an alternative to the link: the link breaks when the mail client opens a different browser (mobile), which is the most common buyer support case. No social login, no passwords. Phase 1 renders the card read-only ("Email link") |
| **Self-serve returns and cancellations** — "Set conditions and fees with return and cancellation rules" (toggle + rules page) | `PriceTier.isRefundable` + `POST /buyer/me/tickets/:id/refund` (full `pricePaid`, any time before or after the event) | **Build (phase 2).** Org-level policy: on/off, cutoff before the event start (hours), optional fee (fixed or percent) retained from the refund. Per-tier `isRefundable` stays the per-tier gate; the policy applies on top of it. Account page shows the deadline and fee before the buyer confirms |
| **Store credit** — "Allow customers to see and spend store credit" | Nothing | **Defer — separate spec.** Useful for cancelled/rescheduled events (credit instead of cash refund), but needs a credit ledger, redemption at checkout (Stripe Checkout discounts or a pre-payment step), expiry and reporting. Out of scope here; recorded as follow-up §6 |
| **URL** — "Use this URL anywhere you'd like customers to access customer accounts" (`https://account.<shop>`) | `/account` on the org's ACTIVE custom domain, `/organizations/:id/account` on the platform host; nothing shows it | **Build (phase 1).** Read-only card with the resolved URL and a copy button. No `account.` subdomain: the account page already lives on the storefront host, which is what spec 007 chose |

## 3. Requirements

### FR-01 Settings nav entry
`SettingsNav` gains **Customer accounts** at `/admin/settings/customer-accounts`, after *Applications*, visible to every staff role. Saving requires ADMIN (same as Online store › Preferences: the policy card changes money handling).

### FR-02 Sign-in links (`Organization.buyerSignInLinks`, default `true`)
- On: `OrganizationHeader` shows a right-aligned link — *Sign in* when no buyer session for this org, *Account* when there is one — on every page that renders the header (org, event, page, blog). Not on the account page itself, apply, checkout or confirmation.
- On: the checkout contact step shows *Already have an account? Sign in* linking to the account page with `?next=<checkout path>`; when a buyer session for this org exists the contact form is prefilled from `GET /buyer/me` and the *Create an account* checkbox is hidden (the contact already has one).
- Off: neither link renders; a menu *Buyer account* item (spec 027) still works.
- The account page and `/account/verify` honour a same-origin relative `next` and redirect to it after sign-in. Absolute URLs and protocol-relative values are ignored.

### FR-03 Account URL card
Shows the resolved public account URL for the active org: `https://<active custom domain>/account` when the org has an ACTIVE `OrganizationDomain`, otherwise `<storefrontBaseUrl>/organizations/<id>/account`. Copy button. Read-only; the *Manage* affordance links to Settings › Domains.

### FR-04 Self-serve refund policy
Columns on `Organization`: `selfServeRefundsEnabled Boolean @default(true)`, `selfServeRefundCutoffHours Int?` (null = until the event starts), `selfServeRefundFeeType SelfServeRefundFeeType @default(NONE)` (`NONE | FIXED | PERCENT`), `selfServeRefundFeeValue Decimal(10,2)?`.
- A ticket is self-refundable iff: policy enabled **and** tier `isRefundable` **and** ticket `VALID` **and** `now < event.date − cutoffHours` **and** the computed refund amount `> 0`.
- Refund amount = `pricePaid − fee`, fee = `feeValue` (FIXED, capped at `pricePaid`) or `round(pricePaid × feeValue / 100, 2)` (PERCENT, 0–100). The fee stays with the organization; it is recorded on the `Refund` row (`feeAmount`) so Orders and the tax report show what was retained.
- Enforced in `POST /buyer/me/tickets/:id/refund` (400 with the reason when ineligible). Staff refunds from `/admin/orders` are unaffected: staff always refund the full amount.
- The account page shows, per ticket: *Refundable until <date/time>* (browser zone until spec 021 adds an org time zone) (and *A $X / Y% fee applies*), or *Refund window closed* / *Not refundable*. The confirm dialog states the amount that will be returned.
- Off: the button disappears; existing tier flags are untouched so turning it back on restores behaviour.

### FR-05 Authentication (phase 3)
`Organization.buyerSignInMethod BuyerSignInMethod @default(LINK)` (`LINK | CODE`).
- `CODE`: the sign-in email carries a 6-digit code (and still the link); the account page shows a code field after the email step. `POST /buyer/auth/verify-code { organizationId, email, code }` consumes it. Codes: `BuyerLoginToken` with `purpose CODE`, 10-minute TTL, hash of `code` stored, `attempts` counter, invalid after 5 attempts; per-IP limiter on the verify route (`BUYER_AUTH_VERIFY`, spec 020 factory).
- `LINK`: today's behaviour.
- The card also lists the fixed facts (session 30 days, link 15 minutes) so organizers stop asking.

### NFR
- All new admin reads/writes are org-scoped through `activeOrgFor(req)`; public reads expose only the flags the storefront needs (`buyerSignInLinks`, `buyerSignInMethod`).
- No behaviour change for organizations that never open the page: defaults reproduce today's storefront except for the new header/checkout links, which are on by default (product decision, §5).
- Refund policy evaluation is one pure function shared by the route and the serializer — never duplicated in the frontend.

## 4. Out of scope
Store credit (§6), social/OAuth buyer sign-in, passwords, `account.` subdomains, per-event refund policies (tier flag + org policy is enough for v1), self-serve *cancellation* of application orders (spec 011 has withdraw), changing refund behaviour for staff.

## 5. Decisions taken
- **Sign-in links default on.** Every org gets the header/checkout links on deploy. Rationale: the account already exists for opted-in buyers; hiding the door is the bug.
- **Policy default enabled, no cutoff, no fee.** Reproduces today's behaviour exactly for existing orgs.
- **Fee recorded on `Refund.feeAmount`** rather than in `reason` text: the ledger is the source of truth for money (Gotcha 17).
- **Code sign-in is a mode, not an addition.** One method per org keeps the account page simple; the email always contains the link as a fallback.

## 6. Follow-ups
- **Store credit** (own spec): `StoreCredit` ledger per Contact, issue from an order refund ("refund to credit"), redeem at checkout, expiry, account-page balance.
- Per-event override of the refund policy (e.g. non-refundable festival passes) if organizers ask.
- Buyer-facing marketing preferences on the account page (unsubscribe) — today unsubscribe is admin-only (`buyer-accounts.md` gotcha).
