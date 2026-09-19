# Production Launch Checklist

**Last Updated**: 2026-09-18

Things a human has to do or decide before Jump takes real money. Code and tests are done for every item here; each needs an account setting, a business decision, or a data review that no deploy can perform. Tick items off in place and date them.

## Go-live todos

Blocking items, in the order to do them. Details in the sections below.

- [ ] **Set the statement descriptor prefix on the Stripe account** (added 2026-09-14) — Stripe Dashboard › Settings › Business › Public details › Statement descriptor. Use something short like `JUMP` so organizations keep 16 characters for their own name. Until this is set, buyers see the raw account name on their card statement and Settings › Payments cannot save a statement name. See [Stripe payments](#stripe-payments).
- [ ] Live `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` on Railway; activate the account. See [Stripe payments](#stripe-payments).
- [ ] Decide NY and CA tax regions; activate Stripe Tax or keep manual rates. See [Stripe Tax](#stripe-tax-settings--tax-spec-009).
- [ ] Stripe Connect platform setup, then `STRIPE_CONNECT_ENABLED=true` (added 2026-09-16) — only after the live key; see [Stripe Connect](#stripe-connect-spec-010-phase-2).
- [ ] **Ship spec 020 phase 1 (abuse protection) before the first public on-sale** (added 2026-09-18) — `POST /orders` is unauthenticated, unlimited, and reserves tier inventory for 30 minutes before payment, so a script can hold a whole tier for free. Phase 1 adds per-IP and per-buyer limits plus an abandoned-order sweep. See [Abuse protection](#abuse-protection-and-edge-layer-spec-020).
- [ ] **Decide the edge layer (Cloudflare or Railway-only) before the first production custom domain** (added 2026-09-18) — moving behind Cloudflare later changes every organization's CNAME target. See [Abuse protection](#abuse-protection-and-edge-layer-spec-020).

## Stripe Tax (Settings › Tax, spec 009)

Found during production verification on 2026-09-14: the platform Stripe account has **Stripe Tax not activated** (`tax.settings.status = pending`, zero registrations). Every region set to *Stripe Tax* therefore errors (`Stripe Tax isn't active for this account…`) and new events in those states start at **0%**. Existing events keep their cached rate (PR #38), so nothing regressed, but nothing new gets a rate either.

- [ ] **Activate Stripe Tax** on the platform account — Stripe Dashboard › Settings › Tax (`https://dashboard.stripe.com/settings/tax`). Settings › Tax shows the pill as *Active* once done (5-minute cache).
- [ ] **Add a tax registration for every state where an organization collects** (today: North Carolina). Registrations are per Stripe account, i.e. the platform's, not the organization's — see the open decision below.
- [x] **Or**, per organization, switch those regions to a **manual rate** on Settings › Tax. Done 2026-09-14: North Carolina set to *Manual · 7.25%* (`lastError` cleared, 1 upcoming event recalculated at 7.25%). Manual rates need no Stripe Tax activation; the two items above remain if Stripe Tax is wanted later.
- [x] After either, confirm the row shows a rate, not *Lookup failed* — NC shows `7.25% via manual rate` (2026-09-14).
- [ ] **Review the backfill**: migration `20260914010000_tax_regions` marked every existing organization/state as *Collecting via Stripe Tax* to preserve behaviour. Confirm each organization is actually registered to collect there; set *Not collecting* where it is not.
- [x] **Fix venues without a state** — done 2026-09-14: Madison Square Garden → New York, NY 10001; The Fillmore → San Francisco, CA 94115. *Needs address* is now empty.
- [ ] **Decide NY and CA**: those venues created two new regions that default to *Not set* (3 upcoming events collect no tax). Set each to *Collecting* with a manual rate (NYC combined 8.875%; San Francisco combined 8.625% — verify with a tax professional) or *Not collecting*.

## Tax product decisions (spec 009 plan §5)

- [ ] **Seller of record** — is the platform or the organization remitting? Decides whether *Stripe Tax* (platform registrations) or *Manual rate* is the norm in onboarding copy.
- [ ] **Tax on service fees** — platform and processing fees are currently untaxed (`tax = subtotal × rate`). Several states tax admission service charges. Needs a tax professional; one-line change in `FeeService.js` + `fees.ts` once decided.
- [ ] **Confirm tax-inclusive math** — built as fees on the *net* (ex-tax) amount, total = listed + fees. If fees should apply to the listed price instead, change both fee libraries and both fixture files together.

## Stripe payments

Verified 2026-09-14 (read-only `accounts.retrieve()` with the backend's Railway env, after spec 010 phase 1 deployed): production runs a **test** `STRIPE_SECRET_KEY` (`charges_enabled: false`, account not activated), **no** `STRIPE_WEBHOOK_SECRET` variable is set (webhook signatures are not verified), **no statement descriptor prefix**, and no optional payment-method capabilities. Settings › Payments therefore shows *Test mode*, statement name *Not available*, and every optional method *Unavailable* — accurate, not a bug. Checkout behaviour is unchanged (`card` only, no suffix).

- [ ] Live `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` on the backend service; webhook endpoint `POST /webhooks/stripe` registered on the live account — see [Stripe Setup](stripe-setup.md).
- [ ] **Set a statement descriptor prefix** on the live Stripe account (Dashboard › Settings › Business › Public details, "Statement descriptor" → shortened descriptor / prefix). Keep it short (e.g. `JUMP`, 4 characters): organizations get `22 − prefix − 2` characters for their own name on Settings › Payments. Until it is set, no per-organization statement name is sent and the dialog is disabled — see [Payments Settings](../features/payments-settings.md).
- [ ] **Confirm capabilities** for the optional payment methods organizations may enable (`link_payments`, `cashapp_payments`; BNPL later per spec 010 §5.6). Methods without an active capability show as *Unavailable*.

## Application payments (spec 011 phase 2)

Vendor / sponsor application charges use the same Stripe account, statement descriptor and Connect routing as ticket orders — nothing new to configure in Stripe beyond the webhook events. Off by default.

- [ ] **Platform webhook events** — add `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled` and `charge.refunded` to the existing `POST /webhooks/stripe` endpoint (Developers › Webhooks). Off-session charges that Stripe returns as `processing` and every pay-now / card-on-file Checkout return depend on them.
- [x] **Done 2026-09-17** — `APPLICATIONS_PAYMENTS_ENABLED=true` set on the backend service (Railway auto-redeployed). Test-mode `STRIPE_WEBHOOK_SECRET` also set the same day: webhook endpoint `we_1UGr111UMiqINVj5j52mAahr` registered on the test account for `https://backend-production-7d5c.up.railway.app/webhooks/stripe` (checkout.session.*, payment_intent.*, charge.refunded). Both must be re-done against the live account at launch (line 38). Optional `APPLICATION_SWEEP_INTERVAL_MS` (default 1 h) for the overdue pay-now sweep.
- [x] **Verified locally 2026-09-17** against the test-mode account with `stripe listen --forward-to localhost:3002/webhooks/stripe` (`STRIPE_WEBHOOK_SECRET` set, `APPLICATIONS_PAYMENTS_ENABLED=true`): PAID form (charge at approval) → apply with `4242…` → setup-mode Checkout → *Card on file* via `checkout.session.completed` → approve → off-session PaymentIntent `29742` cents succeeded synchronously → *Paid*, tier remaining 40 → 39; apply with `4000 0000 0000 0341` → *Card on file* → approve → `card_declined` → *Approved · Payment due* (slot reserved, due +7 days) + PAYMENT_DUE email with the status link → pay-now Checkout, new card → *Paid* (`checkout=paid` notice), remaining 38; partial refund $50 from the admin detail → `re_…` succeeded in Stripe, `PARTIALLY_REFUNDED`, refundable $247.42. Found and fixed on the way: the global `express.json()` broke signature verification for every webhook once a secret is set (PR #56) — **merge #56 before setting `STRIPE_WEBHOOK_SECRET` in prod**.
- [ ] **Verify in prod with one internal organization** after enabling: same script as above with the live webhook endpoint; add the `reverse_transfer` check on a refund once the organization is connected.
- [x] **Smoke-tested in prod (test mode) 2026-09-18 — spec 018 offline payment**, deploy `159a2f4` (Railway auto-deploy; `20260920000000_transactions_corrections` applied by the start command). `2026 Game and Geek Vendor Application` (APPROVAL, $27.31): apply as `jj.chambers+smoke2@etix.com` → setup Checkout with `4000 0000 0000 0341` → *Card on file* via webhook → approve → `card_declined` → *Approved · Payment due*, slot reserved → `POST …/offline-payment { CHEQUE, 27.31, #1042, paidAt 2026-09-17 }` (a wrong amount was 400) → *Paid*, `paymentSource: offline`, slot approved (tier 1 → 2 approved), `OFFLINE_PAID` decision + "Payment received" email, amount locked ("Settled outside Stripe"). `POST /admin/transactions/APPLICATION/:id/refund { 5 }` (route since removed with the Transactions list, 2026-09-18) recorded a `manual` refund → `PARTIALLY_REFUNDED`, net 22.31, **zero refunds on the Stripe PaymentIntent**; customers show `applicationCount 1, totalSpent 27.31, totalRefunded 5`; applicant status page reads "Partly refunded · $27.31 · $5.00 refunded".

## Participants (spec 019)

- [x] **Migrations verified in prod 2026-09-18** (via `railway ssh --service backend`, deploy `27290567` = main `85472d0`): `_prisma_migrations` has `20260922000000_participants_list_index` (19:33Z), `20260923000000_application_form_templates` (19:51Z), `20260924000000_application_tags_checkin` (20:04Z), none rolled back. Indexes `Application_organizationId_submittedAt_idx`, `Application_tags_idx`, `ApplicationFormTemplate_organizationId_name_key`, `ApplicationFormTemplate_organizationId_updatedAt_idx` present; columns `Application.tags` (ARRAY), `checkedInAt`, `checkedOutAt`, `ApplicationForm.createdFromTemplateId` present. 0 templates, 4 applications at the time. `GET /admin/applications/summary` answers 401 unauthenticated (route live).
- [ ] Sidebar **Participants** smoke in prod as a member: list shows the 4 applications, Edit tags round-trip, check-in tick on an approved row, Save as template → New application from it.

## Stripe Connect (spec 010 phase 2)

Code and tests shipped 2026-09-16 behind `STRIPE_CONNECT_ENABLED` (default off). Until it is on, nothing routes and the Payments page renders as phase 1. Do these **after** the live `STRIPE_SECRET_KEY` is in place — connected accounts are per Stripe mode, so anything onboarded under the test key is void live. Details: [Connect Payouts](../features/connect-payouts.md), `specs/010-payments-settings/plan-phase-2.md` §8.

- [ ] **Decide the connected-account model before any of the steps below** (raised 2026-09-17, undecided). Built as Stripe-created **Express** accounts with destination charges: Jump is merchant of record, charges run on Jump's account, organizers receive the ex-tax subtotal, Jump keeps `application_fee_amount` (fees + tax). The alternative is organizers linking their **own existing Stripe account** (Standard, OAuth "Connect with Stripe"), which changes onboarding and — if charges should run on the organizer's account (direct charges) — makes the organizer merchant of record with their own Stripe fees, disputes, tax and statement descriptor. Destination charges to a Standard account keep Jump as merchant of record and only swap the onboarding flow. Both alternatives are not built; see `specs/010-payments-settings/plan-phase-2.md` §11.
- [ ] **Stripe Dashboard › Connect › Get started** on the live account: platform profile, business type "platform / marketplace", accept the Connect terms.
- [ ] **Connect › Settings › Branding** — name, icon, brand colour. This is what organizers see on the Stripe-hosted onboarding page and in their Express dashboard.
- [ ] **Connect › Settings › Express dashboard features** — payouts and bank-account editing on; payment details visible. Jump links organizers here for bank changes and payout history.
- [ ] **Connect › Tax forms** — enable 1099-K filing by Stripe for Express accounts (the platform is merchant of record; Stripe files for connected accounts when enabled). Confirm with finance alongside spec 009 §5.4 (seller of record).
- [ ] **Add a Connect webhook endpoint** — Developers › Webhooks › Add endpoint › *Listen to events on Connected accounts*: `https://<backend>/webhooks/stripe/connect`, events `account.updated`, `capability.updated`, `account.application.deauthorized`, `account.external_account.created|updated|deleted`, `payout.paid`, `payout.failed`. Copy the secret to `STRIPE_CONNECT_WEBHOOK_SECRET` on the backend service. Do **not** add `checkout.session.*` or `charge.refunded` here.
- [ ] Set `STRIPE_CONNECT_ENABLED=true` on the backend service and redeploy. The startup log `Stripe webhook configuration` should show `platformSecret: true, connectSecret: true, connectEnabled: true`.
- [ ] **Verify with one internal organization**: Settings › Payments › *Set up payouts* → complete Express onboarding → `Receiving payouts` → place a test order and confirm in the Stripe dashboard that the payment shows `application_fee_amount` = fees + tax and the connected balance received the subtotal → change the payout schedule → refund one ticket and confirm the transfer reversal and application-fee refund → full refund.
- [ ] Decide the cutover policy for organizations that never onboard (plan §5.7: no deadline, persistent dashboard banner). Revisit once the first organizations are connected.

## Abuse protection and edge layer (spec 020)

Reviewed 2026-09-18 against `main`: production has no edge layer (Railway only, custom domains CNAME straight to the Railway frontend host). App-level `express-rate-limit` covers only `POST /buyer/auth/request` (20/h) and `POST /events/:eventId/applications` (30/h). Unbounded today: `POST /orders` (free 30-minute inventory holds, released only by the `checkout.session.expired` webhook), staff magic-link requests (any address gets mail; clicking creates an `UNASSIGNED` user), `POST /orders/lookup`, `verify-payment`, `X-Scanner-Key` brute force, `/domains/resolve`. Plan: `specs/020-abuse-protection/plan.md`.

- [ ] **Phase 1 merged and deployed** — limiters on the money paths, per-buyer hold cap, abandoned-order sweep, `Order` indexes migration. Verify in prod: `GET /health` unlimited; 11th `POST /orders` from one IP in 15 min → 429; `rate_limited_total` visible on `/metrics`.
- [ ] **Phase 2 merged and deployed** — magic-link guard, `helmet`, Next security headers with CSP report-only. Verify: storefront, checkout (Stripe redirect), admin with an uploaded image, Google sign-in — zero CSP reports for a week, then enforce.
- [ ] **Edge-layer decision recorded** (plan §7.1): **B — Railway-only for launch**, with phases 1–2 and optional Turnstile; revisit Cloudflare + Cloudflare for SaaS at launch-plus-one-quarter or sooner if metrics justify it. Date: 2026-09-18. Option C (platform hosts only) rejected because custom-domain storefronts would remain exposed.
- [ ] **Staff invite-first flow recorded** (plan §7.3): invite staff through Settings › People before magic-link sign-in; unknown/deleted addresses receive the same success-shaped response but no email and no `User` row. Google sign-in is unaffected.
- [ ] Optional: `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` on checkout, buyer sign-in and application submit — works without moving DNS to Cloudflare.

## Related

- [Tax Settings](../features/tax-settings.md), [Tax Calculation](../features/tax-calculation.md)
- [Environment Variables](environment-variables.md), [Railway Deployment](../features/railway-deployment.md)
- Older, partly stale lists: `specs/001-online-ticket-purchase/IMPLEMENTATION_SUMMARY.md` › Production Checklist, `docs/development/QA_DEPLOYMENT_GUIDE.md` › Pre-Deployment Checklist
