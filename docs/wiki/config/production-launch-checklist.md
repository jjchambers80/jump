# Production Launch Checklist

**Last Updated**: 2026-09-14

Things a human has to do or decide before Jump takes real money. Code and tests are done for every item here; each needs an account setting, a business decision, or a data review that no deploy can perform. Tick items off in place and date them.

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

- [ ] Live `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` on the backend service; webhook endpoint `POST /webhooks/stripe` registered on the live account — see [Stripe Setup](stripe-setup.md).
- [ ] **Set a statement descriptor prefix** on the live Stripe account (Dashboard › Settings › Business › Public details, "Statement descriptor" → shortened descriptor / prefix). Keep it short (e.g. `JUMP`, 4 characters): organizations get `22 − prefix − 2` characters for their own name on Settings › Payments. Until it is set, no per-organization statement name is sent and the dialog is disabled — see [Payments Settings](../features/payments-settings.md).
- [ ] **Confirm capabilities** for the optional payment methods organizations may enable (`link_payments`, `cashapp_payments`; BNPL later per spec 010 §5.6). Methods without an active capability show as *Unavailable*.

## Related

- [Tax Settings](../features/tax-settings.md), [Tax Calculation](../features/tax-calculation.md)
- [Environment Variables](environment-variables.md), [Railway Deployment](../features/railway-deployment.md)
- Older, partly stale lists: `specs/001-online-ticket-purchase/IMPLEMENTATION_SUMMARY.md` › Production Checklist, `docs/development/QA_DEPLOYMENT_GUIDE.md` › Pre-Deployment Checklist
