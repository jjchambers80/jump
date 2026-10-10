---
type: research
title: Zeffy payment collection — how Zeffy takes money for nonprofits, and the Stripe Connect setup Jump should run
status: reference
created: 2026-10-10
updated: 2026-10-10
project: jump
tags: [jump, research, payments, stripe, connect, kyc, payouts, disputes, 1099-k, zeffy, nonprofit]
source: support.zeffy.com help and terms pages, zeffy.com/pricing, stripe.com/customers/zeffy, docs.stripe.com Connect docs and requirements endpoint (see Sources); Jump code at origin/main 19c65b2
---

# Zeffy payment collection: research for Jump

**Question.** How does Zeffy collect payments for the nonprofits that use it, and what should Jump (Eventimus) copy? The owner has ruled out one option: the organization brings its own processor and Jump invoices it for platform fees. Every organization processes through Jump's Stripe platform via Connect.

**About the citations.** Jump `path:line` citations point to `origin/main` at `19c65b2`. The local checkout is detached at an older commit, so read them with `git show origin/main:<path>`. External claims carry a bracketed number that points to the Sources list. **(V)** means the page was read on 2026-10-10. **(I)** means inferred: the source does not say it, and the reasoning is given. When this note and a source disagree, the source wins.

---

## 1. TL;DR

- **Zeffy runs Stripe Connect with Custom accounts.** Its help centre says Zeffy creates a "custom connected Stripe account" through "Stripe Custom Connect" for each organization. You cannot attach an existing Stripe account, and no other processor is offered [6] (V). Zeffy is the platform. Its pages never name the charge type. Card statements read `ZEFFY-<org descriptor>` [7][8] (V).
- **Zeffy carries the costs, and pushes the losses onto the organization by contract.** Zeffy pays all processing fees, even on refunds [1][9] (V), so the nonprofit keeps 100%. Its revenue is an optional donor contribution, booked as a "separate transaction" that only Zeffy can refund [10][11] (V). The NPO terms make the organization "solely liable for all negative balances … including … chargebacks" and require it to repay Zeffy or Stripe "immediately" [4] (V).
- **Sell first, verify later, with payouts held.** Organizations "may be able to start accepting payments before completing all verification steps" [3] (V). Stripe onboarding must be finished within 90 days [4] (V). Verification never really ends: payouts "may be temporarily paused" during a review while fundraising continues [2] (V), and every payout goes through a 1–3 business day anti-fraud review [5] (V). If an organization is denied, Zeffy pays out the balance or refunds the donors [2][4] (V).
- **Jump's code already runs the model the owner wants.** It just shouldn't copy Zeffy's account type. Spec 047 D0-S on `main` does this:
  - It creates **organization-owned accounts**: full Stripe dashboard, `fees.payer = account`, `losses.payments = stripe`, `requirement_collection = stripe` (`ConnectService.js:506-531`), or connects an existing account with OAuth.
  - Every charge is a **direct charge** with `application_fee_amount` (`PaymentSettingsService.js:217-236`).

  Stripe says it recommends direct charges "for connected accounts that have access to the full Stripe Dashboard" [17] (V). With this setup, Stripe carries unrecoverable negative balances and Stripe files the 1099-K [15][16] (V). Under Zeffy's Custom setup, the platform carries both (I, from [14][15][16]).
- **The main gap:** while an organization is still onboarding, Jump still sells **on the platform account** (`ConnectService.js:189-192`). Jump is then the merchant and holds the money, with no automatic way to pay it out. Close that before `STRIPE_CONNECT_ENABLED` goes on in live, and gate publishing of paid events on `charges_enabled` (§5).

---

## 2. How Zeffy collects payments (findings)

### 2.1 Architecture

| Aspect | Zeffy | Evidence |
|---|---|---|
| Connect? | Yes. "Payment Account" = "the Organization's Stripe Connected Account created through the Platform … managed by Stripe and subject to Stripe's terms". Governed by the Stripe Connected Account Agreement + Stripe ToS + Zeffy's terms | [4] §2.4 (V); [12] §II(5) (V) |
| Account type | **Custom.** "a custom connected Stripe account can be created … Stripe Custom Connect" | [6] (V) |
| Stripe products | Payments, Connect (onboarding "fully embedded in its platform"), Financial Connections, Treasury for platforms, Radar, Atlas | [13] (V) |
| Charge type | **Not stated.** Fee-free payouts plus a separately refundable contribution fit either destination charges or direct charges with `fees.payer = application` on Custom (I). Stripe now steers legacy Custom accounts to destination charges [14] (V) | (I) |
| Merchant of record | Not stated in those words. Donations "(with the exception of event tickets) are legally made to that Organization" [12] §II(4) (V). Zeffy calls itself a provider of "technology services only" [4] §12.3 (V). Who sells event tickets is left unsaid (I) | [4][12] |
| Card statement | `ZEFFY-<descriptor>`. The organization sets a descriptor of up to 14 characters; the result looks like "ZEFFY - DELO FOUNDATION" | [7][8] (V) |
| Bring your own Stripe / processor | **No.** "If your organization already uses Stripe … you cannot connect it directly to Zeffy" | [6] (V) |
| Eligibility | Nonprofits in US, CA, UK, IE, AU, DE with a bank account in the organization's name. Not individuals, for-profits, or anyone "on Stripe's restricted list" | [18] (V) |

### 2.2 Onboarding and KYC

- **What US organizations provide** [3] (V):
  - EIN and IRS legal name, plus an address that matches the IRS record;
  - a representative's SSN last 4, a government ID and a selfie;
  - the organization's bank account (personal accounts are refused);
  - a website or social presence.

  Submission happens through "Stripe's portal" inside Zeffy, and Stripe reviews it in 24–72 h.
- **Steps and proof, US** [3] (V):
  - Order: find the IRS letter, enter the EIN and legal name exactly as the IRS shows them (punctuation and capitalisation included), complete the representative's ID and selfie check, add the bank account, then "Agree & submit".
  - Proof of EIN is IRS Letter 147C, CP 575 or the SS-4.
  - If the EIN is not verified within one month, "payouts are disabled" while payments stay enabled. This is Stripe's EIN `verified_payout_limit_time` of 30 days (see below).
- **Common failures** [3] (V):
  - details that do not match the IRS record;
  - an EIN under 3 months old, which is not yet in Stripe's database;
  - a poor ID photo or selfie;
  - a PO box as the official address (use a street address, then switch to the PO box afterwards);
  - a personal bank account.
  Jump's onboarding copy should warn about each of these before the organization starts.
- **When verification is needed.** Organizations "may be able to start accepting payments before completing all verification steps". The page mentions a "one-month grace period to begin receiving payments" [3] (V). Zeffy may close the account if Stripe onboarding is not finished "within 90 days of commencing activity" [4] §4.3 (V).
- **Ongoing reviews.** Zeffy runs "ongoing checks". New requests can follow "specific donation patterns, donor activity, or changes" in use. "Payouts may be temporarily paused while a review is in progress", and fundraising continues meanwhile. Once the review clears, Zeffy triggers "a one-time payout right away" [2] (V).
- **Failure.** "a denial will result in the termination of your Zeffy account". An appeal is possible. The balance is "zeroed out, either through a final payout or by refunding the most recent donations back to the donors" [2] (V); [4] §4.5 (V). If Stripe rejects the connected account, Zeffy "may be required to close" the Zeffy account [19] (search excerpt of [4]).
- **Underlying Stripe rule** for a US nonprofit company account, from Stripe's requirements endpoint [20] (V):
  - These fields block the capability, payments and payouts "immediately" if missing: MCC, representative name, email, title, address and SSN last 4, company name and address, ToS acceptance, and the bank (payouts only).
  - These fields pause payouts if unverified after a volume or time limit: EIN (`company.tax_id`: `payout_limit_amount` 300000, `verified_payout_limit_time` 30) and addresses (60000 / 30). The endpoint gives no unit; cents ($3,000 / $600) or days are the likely reading (I).
  - So Zeffy's "accept before fully verified" maps to Stripe's own model: minimal data first, full verification before the payout limits bite (I).

### 2.3 Payouts

- **Schedule.** Weekly by default (Mondays). Monthly runs on the first Monday. "Next day" is for eligible organizations only [5] (V).
- **Anti-fraud review.** Every payment goes through a "mandatory anti-fraud review" of 1–3 business days before it can be paid out [5] (V). That implies Zeffy controls payout timing, which Custom accounts allow [14] (I).
- **Bank account.** One bank account per Zeffy account. It must take direct deposit and be in the organization's legal or DBA name [5][21] (V).
- **Not documented:** whether Zeffy keeps reserves or rolling holds, and the currency details beyond the six countries [18].
- **Stripe baseline** for comparison: the first live payout typically arrives in 7–14 days. US funds settle in 2 business days, and the schedule can be manual, daily, weekly or monthly [22] (V).

### 2.4 Fees and Zeffy's revenue

- **The headline.** "No transaction fees. No platforms fees. No fees period." "We cover credit card and transaction fees." "2 out of 3 donors tip" [1] (V).
- **Refunds.** "even when a donation is refunded, Zeffy still covers the processing fees" [9] (V).
- **The contribution.** It is "voluntary … in the amount of your choice" and refundable on request within 45 days [12] §II(3) (V). It is "shown separately" and can be set to $0 [10] (V). Zeffy calls the gift and the contribution "separate transactions", and "only Zeffy's team can process these refunds" [11] (V).
- **How the tip is collected is not documented** (application fee or separate charge). Separate refunds that only Zeffy controls point to a separate charge, or a separate fee object, on Zeffy's own account (I).
- **The terms protect the tip.** They forbid organizations from "pressuring, deceiving, or mandating donors to include a platform tip". They equally forbid "messaging designed to unfairly discourage donors from tipping" [4] §3.1 (V).
- **The backlash.** The default-tip complaints are covered in [2026-10-08-donation-platforms.md](./2026-10-08-donation-platforms.md) §4.2.

### 2.5 Refunds, disputes, negative balances

- **Refund rules.** Organizations must refund in five cases: mistakes, refund-policy requests, restricted purpose impossible, legal requirement, and "a chargeback or dispute … you cannot successfully defend" [4] §12.7 (V). The donor-side terms say all purchases are final except "event cancellation, proven fraud, or misuse of funds" [12] §III(3) (V).
- **Disputes.** Zeffy emails the organization and "submits evidence … on the organization's behalf". Won funds return "in an upcoming payout". Lost: "the donor will keep their refund". Dispute fees are not mentioned [23] (V).
- **Negative balances.** These are "strictly prohibited". The organization "must IMMEDIATELY repay the negative balance to Zeffy and/or Stripe". If it does not, the outcomes are suspension, termination, "referral to collections agency" and legal action. Liability covers balances caused by chargebacks "you may deem unjustified" [4] §4.6 (V).
- **Who carries the loss with Stripe.** With Custom accounts, Stripe holds Zeffy, the platform, liable for negative balances (`losses.payments = application`) [15] (V). Zeffy's terms move that loss back to the nonprofit by contract (I).

### 2.6 Tax documents and receipts

- **Donor tax receipts** are issued by the organization through Zeffy's tooling. Receipts can be generated automatically per form for 501(c)(3)s, and "You are responsible … for the issue, content and format of Tax Receipts" [4] §12.8 (V); [24] (V).
- **1099-K: Zeffy publishes nothing.** No support article or terms clause covers it [4][25] (V: searched).
- **Stripe's rule:** Stripe doesn't issue 1099-Ks where `fees.payer` is `application_custom`; the platform is responsible [16] (V). So under Custom, filing falls to Zeffy (I). Whether a 1099-K is due at all for a tax-exempt payee is an accountant question (§6).

### 2.7 Bring your own processor

Not allowed. Organizations get a Zeffy-created Custom account, and an existing Stripe account "remains separate and unaffected" [6] (V). No other processor appears anywhere in the help centre.

---

## 3. Jump today (origin/main 19c65b2)

| Aspect | Jump | Where |
|---|---|---|
| Model | Spec 047 option C, decided 2026-10-09. It supersedes spec 010 phase 2 (Express + destination charges, Jump as merchant) | `docs/wiki/config/production-launch-checklist.md:62`; `specs/010-payments-settings/plan-phase-2.md:5` (history) |
| Account | New: `controller { fees.payer: account, losses.payments: stripe, stripe_dashboard: full, requirement_collection: stripe }` plus a Stripe-hosted Account Link. Existing: Connect OAuth (`STRIPE_CONNECT_CLIENT_ID`) | `ConnectService.js:506-531`, `:212-262`, `:271-339` |
| Charge | A direct charge (`{ stripeAccount }`) with `payment_intent_data.application_fee_amount` = the platform fee (5%, or 3% for verified nonprofits). No `transfer_data`, no `on_behalf_of` | `PaymentSettingsService.js:72-97`, `:217-236` |
| Merchant / descriptor | The organization, using its own descriptor (no suffix is sent) | `docs/wiki/features/payments-settings.md` "Direct charges" |
| Refunds | On the connected account with `refund_application_fee: true` (pro-rata fee return) | `stripeRefund.js`, per `connect-payouts.md` |
| Disputes / negative balance | The organization's dispute. Stripe carries unrecoverable losses (`losses.payments = stripe`). Jump mirrors disputes into `Dispute` rows | `connect-payouts.md` liability table |
| 1099-K | Stripe files, because `fees.payer = account` | [16]; `specs/047-donations/plan-d0.md:13` |
| Payout schedule | The organization picks daily, weekly or monthly in Jump (`updatePayoutSettings`) or in its dashboard. Payout descriptor derived with a `'JUMP'` prefix budget | `ConnectService.js:432`, `:523-528` |
| Routing fallback | Not connected, or still onboarding (`!detailsSubmitted`) → **platform charge, Jump is merchant**. Onboarded but charges paused → 409 `PAYMENTS_UNAVAILABLE` | `ConnectService.js:184-205` |
| Publish gate | None. `EventService` has no Connect check | `git grep -n chargesEnabled origin/main -- backend/src/services/EventService.js` (no hits) |
| Jump's own billing | Subscriptions on Jump's account: embedded Checkout plus a card on file (`PlatformCustomer`), dark behind `BILLING_ENABLED` | `specs/022-organization-onboarding/plan.md:3`, `:122-129` |
| Flag | `STRIPE_CONNECT_ENABLED` is off in prod. The Connect platform is not yet set up in the Stripe sandbox | launch checklist `:14`, `:60-75` |

---

## 4. Recommendation

### 4.1 Out of scope: the organization brings its own processor and Jump invoices platform fees

This is dropped. Jump would be collecting money it can't net at source, which means collections risk and building accounts receivable and dunning. It would also have no control over refunds, disputes or fee disclosure on someone else's processor. Nothing below is designed for it.

### 4.2 Check of the owner's view: "every org processes through Jump's platform via Connect"

**Agree.** Zeffy runs this way [6], and the code on `main` already does it. Three refinements:

1. **"Through Jump's Connect platform" yes; "on Jump's balance" no.** Zeffy's Custom model makes the platform liable to Stripe for negative balances [15] and makes the platform file the 1099-K [16]. Zeffy can afford that: it absorbs every fee, raises tips at scale, and has Stripe Treasury and a risk team [13]. Jump has no lawyer and no risk team. Keep the organization as account owner and merchant, with Stripe carrying losses and filing 1099-Ks. The only thing Jump keeps from each payment is its application fee.
2. **Connecting an existing Stripe account by OAuth is not "bring your own processor".** It is still a direct charge through Jump's platform, with the fee taken at the moment of the charge. No invoice is involved. Keep it: nonprofits that already have Stripe keep their nonprofit rate and history [plan-d0 §S1]. The trade-off: the organization can refund in its own dashboard or disconnect, and Jump must follow the webhooks (already built). If the owner wants Zeffy's "only accounts we create", leave `STRIPE_CONNECT_CLIENT_ID` unset. That needs no code.
3. **A card on file is fine as a fallback for Jump's own charges.** It already exists: spec 022 subscriptions on Jump's account. It is the right tool for subscription fees and for any shortfall, for example a platform fee Jump chooses to waive and later recover. It must not become the way ticket platform fees are collected. Those stay as `application_fee_amount`.

### 4.3 Concrete Connect configuration

| Decision | Recommendation | Why |
|---|---|---|
| Account | Keep the code as is: organization-owned, `stripe_dashboard: full`, `fees.payer: account`, `losses.payments: stripe`, `requirement_collection: stripe`. Plus OAuth for existing accounts. **Do not** move to Custom or Express | Stripe carries negative balances [15] and files the 1099-K [16]. Stripe keeps KYC current [14]. Nonprofit rate is reachable [plan-d0 §0]. The owner already rejected Express (memory `project-donations-plan`) |
| Charge type | **Direct charges for everything**: tickets, applications, add-ons and donations. One model, no split. Spec 010's destination charges are retired, as already recorded at launch checklist `:62` | A ticket and a gift share one payment, so they need one merchant. Donations must settle with the charity (donation compliance doc §4). Stripe recommends direct charges for full-dashboard accounts [17] |
| Merchant / descriptor | The organization is merchant of record. Its own descriptor (`settings.payments.statement_descriptor`) shows, and Jump does **not** add a platform prefix like `ZEFFY-` | On a direct charge, the connected account's static descriptor applies [27]. Jump isn't the merchant, so putting its brand on the statement would mislead buyers and draw disputes to Jump (I) |
| Dispute / negative-balance liability | The organization, with Stripe as backstop (`losses.payments = stripe`). Jump keeps mirroring disputes and emailing the organizer. Its terms say the organization owns refunds and chargebacks, Zeffy-style §4.6 wording but without Jump as creditor | Direct-charge disputes debit the connected account [14]. Under `losses.payments = stripe`, Stripe is liable when the account can't repay [15] |
| When verification is required | **No paid sales until `charges_enabled`.** Drafts, free and RSVP events need nothing. Publishing a paid event, opening a PAID form or turning on donations requires an active connected account. Payouts follow Stripe's own `payouts_enabled` and limits | This is Zeffy's "sell first, verify later" without Jump holding the money. Stripe already lets an account charge once the minimal data is in, and pauses **payouts** until EIN and address verify [20]. Selling on the platform before then makes Jump merchant and custodian of money it has no automatic way to transfer (`ConnectService.js:189-192`) |
| Payout schedule | Stripe default (daily, automatic), editable by the organization. Copy should say "first payout usually 7–14 days after your first sale". No Jump-side anti-fraud payout review | [22]. Zeffy's 1–3 day review [5] is a cost of being liable for losses, which Jump is not |
| Platform fee | `application_fee_amount` = the disclosed fixed platform fee (5%, or 3% for verified nonprofits), with the fee returned pro rata on refunds (`refund_application_fee`) | Already built. No Stripe fee on the fee itself [17] |
| Buyer tip | **No tip.** Don't copy Zeffy's contribution. If one is ever added, it must be opt-in at $0 and itemized. Before building it, take accounting advice on whether it can ride inside `application_fee_amount`: on a direct charge it passes through the charity's gross (I) | Default-tip backlash and the FTC fee rule (donation-platforms §4.2, §8.4). Zeffy keeps the tip as a separate transaction [11], which a direct charge on the charity's account can't do cleanly (I) |
| Processing fees | The organization pays Stripe, at its own rate (nonprofit rate if it has one). The buyer may cover it (`FeeService` PASS mode). Jump does **not** absorb it | Absorbing it is Zeffy's model and needs tip revenue. That is a pricing decision for the owner, out of scope here |

---

## 5. Gaps and next steps (ordered)

1. **Stop platform charges for unconnected or onboarding organizations in live.** Owner decision on the cutover policy, launch checklist `:75`. In `ConnectService.chargeAccountFor` (`:191-209`), refuse rather than fall back once Connect is on in live. Keep the fallback only for test mode or legacy orders.
2. **Publish gate.** `EventService` publish, PAID application forms and spec 047 D1 donations should require `connectStatus === 'active'` (or at least `chargesEnabled`). Show a "Set up payments" step: the existing `PayoutsBanner`, the onboarding checklist, and wizard step 12 in [2026-10-10-event-creation-wizard.md](./2026-10-10-event-creation-wizard.md).
3. **Finish the Stripe platform setup** (launch checklist `:65-74`):
   - platform profile set to "software platform, direct charges";
   - OAuth client id, or none if the owner wants created accounts only (§4.2.2);
   - branding;
   - the Connect webhook;
   - a test-mode run with `npm run verify:stripe -- --direct`.
4. **Copy and UX:**
   - first-payout expectation (7–14 days);
   - what Stripe asks for (EIN, representative SSN last 4, ID, bank in the organization's name), mirroring Zeffy's guide [3];
   - the payout-pause explanation when `payoutsEnabled` goes false.

   Optional follow-up: Connect embedded components (account management, payouts, payments/disputes) so organizers never leave Jump [17]. The `project-finance-payouts` memory already names this.
5. **Small fixes:**
   - The payout descriptor is derived with a `'JUMP'` prefix (`ConnectService.js:525-526`), but the brand is Eventimus. Check the intended prefix.
   - The `project-finance-payouts` memory still says "Connect Express", which is stale since option C. Update the note.
6. **Terms (lawyer):** an Organizer Terms Connect annex (launch checklist `:116`) covering:
   - the organization as merchant and seller of record;
   - organization liability for refunds and chargebacks;
   - Jump's application fee and the pro-rata refund of it;
   - account closure;
   - the Stripe Connected Account Agreement.

   This blocks enabling Connect. Zeffy's §2.4, §4.3–4.6 and §12.7–12.8 [4] are a useful checklist of clauses, not text to copy.
7. **Accountant:**
   - confirm Stripe, not Jump, files 1099-Ks for OAuth-connected accounts (Stripe files where the account pays its own fees [16]);
   - whether a tax-exempt payee gets one at all;
   - the treatment of any future tip.
8. **Stripe support** (already carded, `t_570ef200`): confirm direct-charge donations on organization-owned accounts need no extra restricted-business review.

---

## 6. Not verified

- Zeffy's charge type (direct vs destination), whether it sets `on_behalf_of`, how the contribution is technically charged, its dispute-fee policy, reserves, and 1099-K practice. None of these is published. All inferences are marked (I).
- The unit of Stripe's requirement-endpoint limits (cents vs dollars) [20].
- Zeffy's NPO terms were read through a summarising fetch. Clause quotes are as returned, last updated "Aug 2026" [4]. A search excerpt also points to an older terms URL [19].

---

## Sources (accessed 2026-10-10)

1. Zeffy pricing (V) — https://www.zeffy.com/pricing
2. Zeffy help: "What is Stripe verification? FAQ" (V) — https://support.zeffy.com/what-is-stripe-verification-faq-f1fsz
3. Zeffy help: "Complete Your US Stripe Verification" (V) — https://support.zeffy.com/a-guide-to-completing-your-stripe-verification-us (also served at https://support.zeffy.com/complete-your-us-stripe-verification-3zy36)
4. Zeffy "Terms and Conditions of Use – NPO", last updated Aug 2026 (V) — https://support.zeffy.com/terms-and-conditions-of-use-npo-3pvmw
5. Zeffy help: payouts, schedules, amounts and reports (V) — https://support.zeffy.com/zeffy-payouts-schedules-amounts-and-reports-ajuec
6. Zeffy help: "Connecting an Existing Stripe Account to Zeffy" (V) — https://support.zeffy.com/connecting-an-existing-stripe-account
7. Zeffy help: "Updating Your Bank Statement Descriptor" (V) — https://support.zeffy.com/updating-your-bank-statement-descriptor-nyo3t
8. Zeffy help: "There's a charge on my bank statement from Zeffy that I don't recognize" (V) — https://support.zeffy.com/charge-2vkbe
9. Zeffy help: "Zeffy Really Is Free" (V; refund sentence from search excerpt) — https://support.zeffy.com/how-is-zeffy-free
10. Zeffy help: "What is the contribution made towards Zeffy?" (V) — https://support.zeffy.com/what-is-the-contribution-made-towards-zeffy-why-was-i-charged-extra-s41ae
11. Zeffy help: "Voluntary contribution refunds on Zeffy" (V) — https://support.zeffy.com/voluntary-contribution-refunds-on-zeffy-n9sh9
12. Zeffy "Terms and Conditions of Use – Users" (V) — https://support.zeffy.com/terms-of-use-for-users
13. Stripe customer story: Zeffy (V) — https://stripe.com/customers/zeffy
14. Stripe: Connect charge types (V) — https://docs.stripe.com/connect/charges ; connected account types (V) — https://docs.stripe.com/connect/accounts
15. Stripe: controller properties (V) — https://docs.stripe.com/connect/migrate-to-controller-properties
16. Stripe: US tax reporting for Connect platforms (V) — https://docs.stripe.com/connect/tax-reporting
17. Stripe: Create direct charges (Stripe-hosted Checkout) (V) — https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted
18. Zeffy help: "Is my organization eligible to use Zeffy?" (V) — https://support.zeffy.com/is-my-organization-eligible-to-use-zeffy-8m24r
19. Search excerpt of Zeffy terms (account closure on Stripe rejection; older URL) — https://support.zeffy.com/terms-and-conditions-of-use
20. Stripe requirements endpoint, US platform, US `non_profit` / `incorporated_non_profit`, Express dashboard, `card_payments` + `transfers`, API v1 (V, raw JSON) — https://docs.stripe.com/_endpoint/get-requirements-for-setups?account-setup-A[apiVersion]=v1&account-setup-A[platformCountry]=US&account-setup-A[accountCountry]=US&account-setup-A[dashboardType]=express&account-setup-A[tosType]=full&account-setup-A[legalEntityType]=non_profit&account-setup-A[businessStructure]=incorporated_non_profit&account-setup-A[capabilities][0]=card_payments&account-setup-A[capabilities][1]=transfers (human page: https://docs.stripe.com/connect/required-verification-information)
21. Zeffy help: "Connecting multiple bank accounts to Zeffy" (V) — https://support.zeffy.com/connecting-multiple-bank-accounts-to-zeffy-t3oom
22. Stripe: Payouts (V) — https://docs.stripe.com/payouts
23. Zeffy help: "Disputes and Chargebacks" (V) — https://support.zeffy.com/disputes-and-chargebacks-y63dc
24. Zeffy help: "Automatic tax receipts for donations" (V) — https://support.zeffy.com/automatic-tax-receipts-for-donations-q0amt
25. Search of support.zeffy.com for "1099-K" (no article found) — https://support.zeffy.com/
26. Jump: [2026-10-08-donation-platforms.md](./2026-10-08-donation-platforms.md), [2026-10-08-donation-legal-compliance.md](./2026-10-08-donation-legal-compliance.md), `specs/047-donations/plan-d0.md`, `docs/wiki/features/connect-payouts.md`, `docs/wiki/config/production-launch-checklist.md`
27. Stripe: statement descriptors with Connect (V) — https://docs.stripe.com/connect/statement-descriptors
