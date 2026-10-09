---
type: research
title: Donation platforms — survey, user feedback, and a phased plan for donations in Jump
status: reference
created: 2026-10-08
updated: 2026-10-08
project: jump
tags: [jump, research, donations, nonprofit, fees, stripe, recurring, tax-receipts, competitors, compliance]
source: vendor pricing pages and help centres, Trustpilot, vendor feedback boards, IRS, FTC, Stripe docs (see Sources); Jump code at origin/main 0f1519b
---

# Donation platforms: research for Jump

**Question.** A nonprofit prospect runs donations on **Zeffy** and ticketing on **Eventbrite**. Jump (Eventimus) wants one all-in-one nonprofit offering that beats both on price and on features. This document covers four things:

- what the popular donation platforms charge and offer;
- what their customers like and dislike;
- what Jump already has that donations can reuse;
- a thin-slice plan to add donations without breaking Jump's existing rules.

**About the citations.** Jump `path:line` citations point to `origin/main` at `0f1519b`. The local checkout is detached at an older commit, so read them with `git show origin/main:<path>`.

External claims carry a bracketed number that points to the Sources list. Marks on claims:

- **(V)**: the vendor's own page was read on 2026-10-08.
- **‡**: the vendor page refused automated fetches (403, 429, or a bot checkpoint). The claim rests on the vendor page's text as quoted in search results, or on a secondary source. Treat it as unverified.

**Gaps in the user-feedback evidence:**

- **Reddit** refuses both the search tool and the JSON API, so no Reddit thread was read directly. Reddit sentiment appears here only where another source quotes it, and is marked as such.
- **G2, Capterra and TrustRadius** pages returned 403, so their review summaries come from search-result excerpts (‡).
- **Trustpilot** pages and Zeffy's public feedback board were read directly.

---

## 1. TL;DR

- **The market splits into four models.**
  1. **Free to the nonprofit, funded by a donor "tip"**: Zeffy, Givebutter's default, Every.org.
  2. **A percentage platform fee plus processing**: Donorbox, Fundraise Up, Funraise.
  3. **A CRM subscription with processing at cost or close to it**: Bloomerang (now including Qgiv and Kindful), Little Green Light, Bonterra/Network for Good.
  4. **A custom-quoted annual contract**: GoFundMe Pro, formerly Classy.

  Eventbrite is a ticketing platform with nonprofit discounts on its Pro plan, but **not on ticket fees** [1][6][10][12][14][17][20][21][25][26‡].
- **The single loudest complaint in the category is the pre-filled donor tip.** Zeffy's default contribution is 15–22%, and donors call it a surprise charge. Zeffy's feedback-board request to default it to $0 has 224 votes. Zeffy answered with self-serve refunds, not a $0 default [3][5]. Givebutter draws the same complaint at a smaller scale [9].
- **The next most common complaints:**
  - payout holds and account freezes (Zeffy, Givebutter) [5][9];
  - recurring gifts donors cannot cancel (Donorbox) [11];
  - opaque pricing and auto-renewing contracts (GoFundMe Pro) [13‡];
  - CRM pricing that climbs with contact count (Bloomerang) [38‡];
  - slow grants and missing donor data (PayPal Giving Fund, Every.org) [22][23][24‡].
- **What customers like:** "free" (Zeffy), breadth of features (Givebutter), ease of setup (Donorbox, Zeffy), value for money (Little Green Light), and donors covering fees (Donorbox, Funraise and Fundraise Up all report most donors do) [10][18‡][20][21][43‡].
- **Jump today has none of the donation basics.** It has no donation line, no recurring payments for buyers, no donor-chosen fee coverage, no tax-receipt wording and no campaigns or goals. It does have the hard parts:
  - one ledger with refunds and disputes;
  - Stripe Connect destination charges;
  - a per-org Contact CRM with tags, notes and a timeline;
  - forms with custom questions;
  - a card-on-file plus off-session charge pattern;
  - a theme editor;
  - Resend email.
- **Two blockers to fix before any donation code:**
  - `Order.eventId` is required. Every revenue and tax query scopes by event → venue → organization, so a standalone gift has no place in the ledger (schema.prisma:1067, TaxService.js:230).
  - The platform webhook endpoint drops **every** `customer.subscription.*` event, `invoice.payment_failed` event, and subscription-mode `checkout.session.completed` as a Jump billing event (BillingService.js:15-21, 177-182; webhooks.js:115). A recurring donation would be silently ignored.
- **Pricing recommendation (section 7).**
  - **Donations:** 0% Jump platform fee. Stripe processing at cost. An optional **"cover the fee for [Org]"** checkbox that shows the exact amount.
  - **Never a pre-filled tip to Jump.** If Jump ever asks for one, it starts at $0.
  - **Tickets for verified nonprofits:** 3% instead of 5%. That is cheaper for the buyer than Eventbrite at every ticket price (section 7.2).
  - **The honest pitch:** the nonprofit keeps 100% of every ticket and gift, and the buyer sees one all-in price with no tip upsell. Jump cannot beat Zeffy's "$0 to everyone" headline without an absorbed-fee guarantee. Section 7.3 sets that out as an owner decision.
- **Plan (section 9).**
  - **D0:** ledger and webhook groundwork, plus the **gift charge-model decision**.
  - **DV (new):** nonprofit verification and the charity agreement.
  - **D1:** donation line at event checkout plus donate-only, event-anchored.
  - **D2:** standalone campaigns and pages.
  - **D3:** recurring gifts.
  - **D4:** stewardship and IRS reporting (statements, the quid-pro-quo disclosure, 990 exports).
  - **D5:** goals, tributes and embeds.
  - **Later:** peer-to-peer, ACH, DAF.

  Each phase now has a compliance checklist, and launch is gated on L1–L8.
- **Legal research (2026-10-08): [Donation legal compliance](./2026-10-08-donation-legal-compliance.md).** It changes this plan in four ways:
  - **California AB 488 probably covers Jump** as a "type E" charitable fundraising platform: white-label SaaS that lets charities take donations. Hawaii has had a parallel law since 2026-07-01.
  - **Stripe restricts donation platforms** and says a merchant may not accept donations on behalf of someone else. Under destination charges, Jump is the business of record.
  - **Jump, not Stripe, must file 1099-Ks** for Express accounts.
  - **The Stripe Tax admissions code in `TaxService.js` is wrong.**

  Receipt wording ships **with** D1, not in D4. Section 8 explains why.

---

## 2. Pricing survey (US, as published 2026-10-08)

| Platform | Model | Platform fee | Processing | Subscription | Donor tip / cover fee | Source |
|---|---|---|---|---|---|---|
| **Zeffy** | Free, funded by tips | 0% | 0%. Zeffy covers it | None. "No fees period" | Optional contribution, pre-filled. Donors report 15–22% defaults; Zeffy says "2 out of 3 donors leave us a tip" | [1] (V), [2] (V), [3] (V) |
| **Givebutter** | Free with tips, or 3% | 0% with tips on. **3% flat** with tips off (for accounts created on or after 2025-09-09) | 2.9% + 30¢ card; 1.9% + 30¢ ACH | Free; Plus $29 / $79 / $129 per month by contact count | Tips plus donor-covered fees. The "Givebutter Guarantee" covers uncovered processing when tips are on | [6] (V), [7‡], [42‡] |
| **Donorbox** | % platform fee by plan | Standard 2.95% (forms), 3.95% (events, memberships, P2P supporters); Pro 1.75% / 2%; Premium 1.6% / 2% | Stripe 2.2% + 30¢ card (nonprofit rate); ACH 0.8%, capped at $5; crypto and stock 3.95% all-in | Standard $0; Pro $150/mo; Premium custom; Live kiosk $50–80/mo per device | Cover fees, "most do" | [10] (V) |
| **GoFundMe Pro** (Classy) | Custom quote | Not published | Not published (reports: 2.2–2.5% + 30¢ ‡) | "Annual upfront subscription with a transaction fee per donation" | Not published | [12] (V), [13‡] |
| **Bloomerang** (now incl. Qgiv and Kindful) | CRM subscription | Not published on the pricing page | Not published (reports: Bloomerang Payments 2.0% + 30¢ ‡) | Giving Platform from $242/mo; Fundraising $40/mo (needs CRM); CRM $125/mo; Volunteer $119/mo, all billed annually | Not stated | [14] (V); qgiv.com/pricing 301-redirects to bloomerang.com/pricing [15] (V) |
| **Qgiv** (legacy) | Subscription plus % | Historically $40/mo + 3.95% + 30¢ ‡ | Included above ‡ | — | — | [15‡] (competitor page) |
| **Kindful** | Discontinued | — | — | Being migrated into Bloomerang CRM | — | [16‡] |
| **Little Green Light** | CRM subscription | 0% to LGL | Pay-as-you-go via Stripe or PayPal, "starting at 2.2% + $0.30" | $45/mo (2,500 records) to $135/mo (50,000 records); 10% off annual | Not stated | [17] (V) |
| **Bonterra / Network for Good** | Custom quote | Reports: 3% on Essentials/Free, removed on the top tier ‡ | Not published | Reports: ~$100–300/mo ‡ | — | [19‡] |
| **Funraise** | % platform fee | Free plan 5%; Premium 0–3% | 2.9% + 60¢ | Free under $1M a year raised; Premium by quote | "~90% of donors cover fees" | [20] (V) |
| **Fundraise Up** | % platform fee | **4%** (the page title reads "4% Fee, No Contracts") | Plus processing | None | Fee coverage; claims an effective cost of about 1% | [21] (V) |
| **PayPal Giving Fund** | Donor-advised intermediary | 0% | PayPal covers 100% of transaction fees | None | None. The charity receives a **grant** 15–45 days later if enrolled, ~90 days if not | [22] (V via search: PayPal help page) |
| **Every.org** | Donor-advised intermediary, funded by tips and philanthropy | 0% | Reports: card fees passed through; ACH, stock and DAF covered; crypto 1% ‡ | None | Optional tip at the end of checkout ‡ | [24‡] |
| **Eventbrite** | Per-ticket fee | **3.7% + $1.79 per paid ticket** | **2.9% per order** | Pro plans (50% off for nonprofits; the discount "doesn't apply to Ticketing Fees" ‡) | Buyer pays by default; organizer may absorb | [25] (V), [26‡], [40‡] |
| **Jump today** | Per-order fee passed to the buyer | **5%** of subtotal | 2.9% + $0.30 per order, passed through | STARTER plan, dark (`BILLING_ENABLED`) | None | `backend/src/config/fees.js:4-8` |

**Eventbrite donation tickets: conflicting reports.** Search excerpts of Eventbrite's own help article on donations conflict. One says the service fee is waived on donation ticket types and the 2.9% processing remains. Another says a 2% service fee with no processing fee, or "2.5% credit card processing" [27‡]. The help centre returned 403, so the donation-ticket fee is **unverified**.

**Stripe's nonprofit rate.** Stripe discounts processing for registered nonprofits when **at least 80% of the account's volume is tax-deductible donations** [29] (V). The page does not state the rate; vendors quote 2.2% + 30¢ [10][17].

This matters for Jump. Under destination charges, Stripe's fee lands on Jump's **platform** account. Jump's account is mostly ticket volume, so Jump cannot claim the nonprofit rate for its nonprofit customers. Only a direct-charge model on the nonprofit's own account could, and spec 010 §11.1 already leaves that model open.

---

## 3. Feature survey

Legend:

- **Y**: the vendor's page lists it.
- **~**: partial, an add-on, or a paid tier only.
- **–**: absent, per the vendor or a cited review.
- **?**: not verified in this pass.

| Feature | Zeffy | Givebutter | Donorbox | GoFundMe Pro | Bloomerang | LGL | Funraise | Fundraise Up | Every.org | PayPal GF | Eventbrite | **Jump** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| One-time gifts | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | ~ (donation ticket type) | **–** |
| Recurring gifts | Y | Y | Y (+ upsell on Pro) | Y | ? | ? | ? | Y | ? | ? | – | **–** (no buyer subscriptions) |
| Donor covers fees | n/a (tip) | Y | Y | ? | ? | ? | Y | Y | ? | n/a | ~ (absorb toggle) | **~** (`FeeMode.ABSORB` exists for application forms; not donor-chosen) |
| Tribute / in-memory gifts | ? | Y | ? | ? | ? | ? | ? | ? | ? | – | – | **–** |
| Peer-to-peer | Y | Y | Y | Y | ? | – | ? | ? | ? | – | – | **–** |
| Campaign goal / thermometer | ? | Y | Y (crowdfunding) | Y | ? | – | ? | ? | ? | – | – | **–** (`Stats` section is static numbers) |
| Text-to-give | – [‡] | Y | Y | ? | Y ‡ | – | ? | ? | – | – | – | **–** |
| Embeddable form / button | ? | Y | Y | ? | ? | Y | ? | Y | ? | – | ~ (widgets) | **–** (storefront pages and custom domains only) |
| Tax receipts | Y | Y | Y (white-label on Pro) | ? | ? | ? | ? | ? | Y (issued by Every.org, not the charity) | – (donor gets a PPGF receipt) | – | **~** (order confirmation; no deductibility text) |
| Donor CRM | Y | Y (Plus for workflows) | Y | Y | Y (core) | Y (core) | ? | ? | ~ | – | – | **~** (Customers: tags, notes, timeline, opt-ins; no list CSV) |
| Events / ticketing | Y | Y | Y (3.95% tier) | ~ (add-on) | ? | – | ? | – | – | – | Y | **Y** (core product) |
| Auctions / raffles | Y / Y | Y / Y | ? | ? | ? | – | ? | – | – | – | – | **–** |
| Memberships | Y | Y | Y | ? | ? | ? | ? | ? | – | – | – | **–** |
| Apple / Google Pay | Y | Y | Y | ? | ? | ? | ? | Y | ? | – | ? | **Y** (Stripe Checkout, `config/payments.js:58-62`) |
| ACH / bank | Y ‡ | Y | Y | ? | ? | ? | ? | Y | Y ‡ | – | – | **–** (deliberately out, `config/payments.js:13-16`) |
| Crypto / stock | ? | ? | Y (3.95%) | ? | ? | – | ? | Y (crypto) | Y ‡ | – | – | **–** |
| DAF | ? | Y | ? | ? | ? | – | ? | ? | Y ‡ | – | – | **–** |
| PayPal / Venmo / Cash App | ? | Y / Y / Y | PayPal Y | ? | ? | PayPal Y | ? | ? | ? | PayPal | ? | **~** (Cash App Pay and Link opt-in; no PayPal) |
| In-person tap to pay | Y | ? | Y (kiosk $50–80/mo) | ? | ? | – | ? | ? | – | – | ~ | **–** (QR scan for entry only) |

Row sources:

- Zeffy: [1], [4‡]. Zeffy has no text-to-give per a secondary source ‡.
- Givebutter: [8].
- Donorbox: [10].
- GoFundMe Pro: [12].
- Bloomerang: [14], [38‡].
- LGL: [17], [18‡].
- Funraise: [20].
- Fundraise Up: [21].
- Every.org: [24‡].
- PayPal Giving Fund: [22], [23].
- Eventbrite: [25], [27‡].

**Why the "?" cells.** Many vendor pages list features in carousels that the fetcher could not read. A "?" means unchecked, not absent. Before this table goes in front of a prospect, someone should verify the cells for the platforms the prospect actually compares against (Zeffy and Eventbrite).

---

## 4. What users say

The feedback is grouped by theme, not by vendor. Quotes are as shown on the cited page.

### 4.1 Likes

| Theme | Evidence |
|---|---|
| **"It's actually free"** | Zeffy: "No transaction fees. No platforms fees. No fees period." [1]. G2 comparison summaries say Zeffy users value that "100% of donations go to the nonprofit" and find links for events and donations easy to set up [43‡]. |
| **Breadth in one tool** | Givebutter is praised for donation pages, P2P, ticketing and recurring support in one free plan [43‡]. Its feature page lists cards, ACH, PayPal, Venmo, Cash App, DAF, tribute gifts, text-to-donate, auctions, raffles, a goal thermometer and a donor portal [8]. |
| **Donors cover the fees** | Donorbox: "Most do, so you receive the full donation" [10]. Funraise: "~90% of donors cover fees" [20]. Fundraise Up cites "82% of all donors cover processing fees" in a case study [21]. These are vendor claims, not independent data. |
| **Fast setup, intuitive** | Donorbox and Zeffy, per G2 comparison summaries [43‡]. |
| **Value and support** (CRM tools) | Little Green Light: "the most value for the money", "excellent customer service" [18‡]. Bloomerang: rated 4.7 on Capterra and G2 and widely called "easy to use" [38‡]. |
| **Responsive support** | Givebutter: some reviewers praise 24/7 live chat [9]. Donorbox: positive Trustpilot reviews cite quick responses [11]. |

### 4.2 Dislikes

| Theme | Evidence |
|---|---|
| **Pre-filled platform tip** (Zeffy, Givebutter) | Zeffy Trustpilot, donor, 2026-02-21: "An extra 17% was added to my donation without any warning". Donor, 2026-04-23: "At no point before clicking pay was it clearly disclosed that a 15% fee would be added". Donor, 2025-07-18: "Your only option is whether you want to donate 17%, 20% or 22%" [5]. On Zeffy's own feedback board, "Make the Voluntary Donation to the Zeffy platform default to $0, vs 17% or 34% at times" has **224 votes**. Nonprofits comment: "This has left a lot of our donors feeling scammed"; "our donors are refusing to use the Zeffy platform"; screen-reader users struggle to opt out of the dropdown [3]. Zeffy closed the request on 2026-03-11 with a **self-serve refund link** in the confirmation email instead of a $0 default [3]. Its help page confirms the amount can be set to $0 but that it is pre-filled [2]. Givebutter, 2026-01-10: "At the very last step, they tried to add $10.20 to our donation. No previous notice on a 'tip'" [9]. A Donorbox blog (a competitor) relays r/Charity posts of a $2,000 gift charged $2,199.95 [39‡]. |
| **Payout holds and account freezes** | Zeffy, nonprofit, 2026-01-20: "The funds are being held… Over 100k. All documentation has been provided yet still they hold funds". 2025-05-25: "They cancelled our small non-profit without a clear reason causing all donations to be refunded" [5]. Zeffy runs a mandatory anti-fraud review of 1–3 business days before each payout [4‡]. Givebutter, 2026-09-16: "Givebutter will hold your funds for up to ten days". 2026-06-29: an account suspended as an "individual account" [9]. |
| **Recurring gifts that won't stop** (Donorbox) | Donorbox Trustpilot, 2026-09: "Send one donation, ender up paying every month for 6 month, Even after deleting payment". 2025-08: "This company refuses to cancel my subscription!" [11]. |
| **Fee surprises and opaque pricing** | Givebutter, 2025-12-10: "We did a payout of $470, and they literally charged a $68 fee" [9]. Donorbox: one nonprofit calls a "6% fee" alongside Stripe processing "triple market price" [11]. GoFundMe Pro publishes no prices ("answer a few questions") [12]. Reviewers cite "high donor fees and high annual fees" and renewals they "could not stop" [13‡]. Eventbrite's ticket fee is not discounted for nonprofits [26‡]. Competitors market against it, e.g. "every $100 ticket… up to $10 in fees" [25][41‡]. |
| **CRM pricing that climbs with contact count** | Bloomerang: per-record pricing pushes small orgs to keep contacts out of the CRM. Renewals rise 7–12%, and one reported Reddit user went from $300 to $1,000 a year (relayed by a competitor blog) [38‡]. |
| **Slow money and missing donor data** (intermediaries) | PayPal Giving Fund grants arrive 15–45 days later (enrolled) or ~90 days later (not enrolled) [22]. Donor information arrives only if the donor opts in [23]. Every.org: donations go to Every.org as the 501(c)(3), so **the charity must not issue its own receipt** [24‡]. Disbursements run weekly by direct deposit or monthly through a partner [24‡]. |
| **Dated or basic forms** (CRM-first tools) | Little Green Light forms are "a bit dated and could be more customizable", with a learning curve [18‡]. |
| **Product decay after acquisitions** | Kindful is in sunset inside Bloomerang: reports and registration forms do not migrate, and crowdfunding stops [16‡]. GoFundMe Pro: "declining customer service since Classy's GoFundMe acquisition" [13‡]. |
| **Support during holds** | Zeffy, 2026-03-03: "They stopped paying and asking for additional info… no reply from Zeffy" [5]. Givebutter, 2026-05-10: "customer service shrugs it off" [9]. |

### 4.3 What this means for Jump

1. **Trust is the opening.** The category's biggest complaint is a default-on tip that donors read as a hidden charge. Jump already sells "all-in pricing, no surprises" for tickets (FTC fee rule, section 8.4). Carry that to donations:
   - no pre-filled tip;
   - one total shown before Pay;
   - the amount that goes to the nonprofit stated in plain words.
2. **Recurring cancellation must be self-serve on day one.** Jump already has a buyer account (spec 040, patron "My account"), so "manage my monthly gift" goes there, not in a support ticket.
3. **Payout holds are Stripe's, not Jump's.** Under Connect Express, Stripe controls verification holds. Set expectations in onboarding, and surface the Stripe requirements state, which the Finance pages already partly do.
4. **No per-contact CRM pricing.** Jump's Customers list is free per org. Keep it that way. It answers the Bloomerang complaint directly.
5. **The nonprofit's name on the receipt, the nonprofit's money in the nonprofit's account.** Unlike PayPal Giving Fund and Every.org, Jump is not an intermediary charity: gifts settle to the nonprofit's own Connect account. Say so plainly.

---

## 5. What Jump already has (origin/main 0f1519b)

| Capability | Fact | Where | Reuse for donations |
|---|---|---|---|
| Fees | 5% platform fee on the ex-tax subtotal. Processing = (subtotal + platform fee) × 2.9% + $0.30, once per order. Per-line `taxable`; `taxInclusive` mode | `FeeService.js:32-55`, `frontend/src/lib/fees.ts:12-16`; parity fixtures `backend/tests/unit/feeService.test.js:150`, `frontend/tests/unit/fees.test.ts:123,178` | A donation line needs **0% platform fee** and `taxable: false`. That is a per-line fee rule, so **both** libraries and **both** fixture files change together (Gotcha 12). |
| Fee modes | Ticket orders are always `PASS`. Application forms support `ABSORB` (listed price is the total; fees come out of `orgReceives`) | `OrderService.js:343-344`; `schema.prisma:1554,1725`; `ApplicationFormService.js:51-80` | "Donor covers fees" = PASS for that line; "doesn't cover" = ABSORB. Both modes already exist; they need to work per line, chosen by the donor. |
| Per-org fee override | None. Every caller reads the constant `FEE_CONFIG`; `PlatformPlan` is never read by fee code | `fees.js`, `PaymentSettingsService.js:360-362` | A nonprofit ticket rate (3%) needs a per-org rate input to `computeOrderFees`. |
| Order ledger | `OrderKind` {TICKET, APPLICATION}; `Order.eventId` **required**; `OrderItem.kind` {TICKET_TIER, APPLICATION_TIER, ADJUSTMENT, WAIVER}; append-only `PaymentTransaction`, `Refund`; `PAID_ORDER_STATUSES` | `schema.prisma:1064-1112,1117,1173,1201,1379,1384`; `paidStatuses.js:7` | Add `OrderKind.DONATION` and `OrderItemKind.DONATION`. Donations must live here (Gotcha 17: `/admin/orders` is the one money surface). |
| Refunds | `RefundService.refundOrder`: partial amounts for APPLICATION orders, per ticket or add-on for TICKET orders | `RefundService.js:33-44` | A donation line needs a partial-refund path (like APPLICATION) and **receipt voiding** (section 8). |
| Checkout | `price_data` lines with an all-in `unit_amount`; `checkoutOptionsFor` spread in; metadata `{orderId, orderRef, eventId}`; 30-minute expiry | `OrderService.js:396-454` | A donation line is one more `price_data` line. Use `price_data`, not Stripe's `custom_unit_amount`: pay-what-you-want "can't add any other line items", needs quantity 1, and doesn't support recurring [30]. |
| Webhooks | `/stripe` platform endpoint; `/stripe/connect`; `/stripe/billing`; dedup via `StripeWebhookEvent` | `webhooks.js:103-192,230,301` | **Blocker:** `BillingService.isBillingEvent` returns true for any `customer.subscription.*` event, any `invoice.payment_failed` event, and any subscription-mode `checkout.session.completed` (`BillingService.js:15-21,177-182`). The `/stripe` route then ignores the event (`webhooks.js:115-119`). Recurring donations must be told apart by metadata first. |
| Card on file and off-session charges | Stripe Customer saved on `Contact.stripeCustomerId`; setup-mode Checkout; `paymentIntents.create({off_session, confirm})` with `transfer_data` + `application_fee_amount` | `ApplicationPaymentService.js:82-91,156-170,316-345` | Fallback design for recurring gifts. Stripe Billing subscriptions on Connect are the better fit [31]. |
| Recurring for buyers | None. The only `mode: 'subscription'` is the org paying Jump | `BillingService.js:91-109` | Must be built (phase D3). |
| Stripe Connect | Destination charges: `transfer_data.destination` + `application_fee_amount` = total − subtotal; dark behind `STRIPE_CONNECT_ENABLED` | `PaymentSettingsService.js:198-255`; `ConnectService.js:62` | With a 0% donation fee, `application_fee_amount` for a donation-only order is just the processing the donor covered. If the donor didn't cover it, Jump keeps nothing and Stripe's fee still lands on the platform account. That has to be priced (section 7.3). |
| Payment methods | Cards plus Apple/Google Pay always on; Link, Cash App, Affirm, Klarna, Afterpay opt-in; **ACH deliberately excluded** | `config/payments.js:10-62` | BNPL should be off for donation lines (a donor financing a gift is a poor look and a refund risk). ACH is worth revisiting for large or recurring gifts (Donorbox charges 0.8%, capped at $5 [10]). |
| Contacts / Customers | Per-org `Contact` (unique `organizationId + email`), opt-ins, `tags`, `note`, timeline of orders, applications and RSVPs; JSON export per contact; **no list CSV** | `schema.prisma:810-850`; `CustomerTimelineService.js:29`; `admin.js:1835` | Donor = Contact (Gotcha 8). Add donations to the timeline and lifetime-giving columns. A CSV export is a common donor-CRM ask. |
| Forms | Application forms with 10 question types; standing (event-less) forms are FREE only | `schema.prisma:1713,1781,1603`; `ApplicationFormService.js:411-441` | Custom donation-form questions ("How did you hear about us?") can reuse the `ApplicationQuestion` types. A donation is **not** an application (no review state). |
| Add-ons | `AddOn`/`AddOnProduct` with `taxable`; `OrderAddOn` lines | `schema.prisma:1991,2010,2065` | Tempting ("Add a $10 donation" as an add-on), but wrong: add-ons have a fixed price, inventory and the 5% fee. Use a dedicated line kind. |
| Organization | `ein` (9 digits, masked); `BUSINESS_TYPES` includes `NONPROFIT`; onboarding type `community_nonprofit` | `schema.prisma:494`; `organizationValidators.js:14,246-253`; `config/onboarding.js:12` | A starting point for "verified nonprofit". There are no 501(c)(3) status, legal-name-on-receipt or deductibility fields. |
| Theme / pages | `@jump/theme` sections incl. Hero, Stats, CallToAction, Tiers, Faq; page templates; contact form (email only) | `packages/theme/src/registry.js:137-416`; `pageTemplateManifest.js:24-30` | New `DonationForm` and `GoalProgress` sections; a donation page template. |
| Email | Resend; inline HTML templates; `sendOrderConfirmation`, `sendApplicationReceipt` (no deductibility text) | `EmailService.js:5,49,119,902-978` | Donation receipt plus annual giving statement. |
| Reporting | Tax report counts taxable APPLICATION orders; analytics, dashboard and customer revenue use `PAID_ORDER_STATUSES`, scoped through the event | `TaxService.js:223-245`; `EventService.js:872`; `DashboardService.js:60,83`; `admin.js:1081-1085` | Each query must decide whether donations count. They must **never** count as taxable sales. |
| RSVP | `EventRsvp`, never an Order (Gotcha 29) | `schema.prisma:966` | A free RSVP event can still take a gift. That is an Order of kind DONATION beside the RSVP, never a field on the RSVP. |

---

## 6. Gap summary: Jump vs the prospect's current stack (Zeffy + Eventbrite)

| Need | Zeffy | Eventbrite | Jump now | Jump after D1–D4 |
|---|---|---|---|---|
| Sell tickets with all-in pricing | Y (tip-funded) | Y (fees on top) | **Y** | Y, 3% nonprofit rate |
| Add a gift at ticket checkout | ? | ~ (donation ticket type) | – | **Y** |
| Standalone donation page | Y | – | – | **Y** (D2) |
| Monthly giving, self-serve cancel | Y | – | – | **Y** (D3) |
| Deductibility-compliant receipt and annual statement | Y | – | – | **Y** (D1 text, D4 statement) |
| Gala ticket with deductible portion (price minus FMV) | ? | – | – | **Y** (D4) |
| One donor record across tickets and gifts | Y | – (separate tool) | ~ (Customers) | **Y**. This is the all-in-one advantage. |
| No tip upsell at checkout | **–** | Y | Y | Y |
| Branded storefront, custom domain, themes | ~ | ~ | **Y** | Y |
| Applications (vendors, sponsors), floor maps | – | – | **Y** | Y |
| Peer-to-peer, auctions, raffles, text-to-give | Y / Y / Y / – | – | – | Later / out of scope |

---

## 7. Pricing recommendation

### 7.1 Principles

1. **No pre-filled tip, ever.** This is Jump's clearest differentiator against Zeffy and Givebutter [3][5][9]. It also keeps the ticket checkout inside the FTC rule, which treats charges paid through pre-checked boxes or opt-out defaults as **mandatory**, so they must be in the total price [35].
2. **Nonprofit keeps 100% of the price it sets.** This is already true for tickets (fees are passed to the buyer, `orgReceives = subtotal`, `OrderService.js:343-344`).
3. **The buyer sees one total before Pay**, with a line that says what the nonprofit receives.

### 7.2 Tickets for verified nonprofits: 3% platform fee (from 5%)

Buyer's total for one ticket. All three calculations assume the buyer pays every fee:

- **Jump:** price + platform fee + (price + platform fee) × 2.9% + $0.30, which is how `FeeService` works today.
- **Eventbrite:** price + 3.7% + $1.79, then 2.9% processing on that total. This assumes processing applies to the order total. Eventbrite's page says "2.9% payment processing fee per order" [25] but not the base it applies to.
- **Zeffy:** price plus a donor tip that is optional but pre-filled.

| Ticket | Jump today (5%) | **Jump nonprofit (3%)** | Eventbrite | Zeffy (tip at a 15% default / at $0) |
|---|---|---|---|---|
| $10 | $11.10 | **$10.90** | $12.51 | $11.50 / $10.00 |
| $25 | $27.31 | **$26.80** | $28.52 | $28.75 / $25.00 |
| $50 | $54.32 | **$53.29** | $55.20 | $57.50 / $50.00 |
| $100 | $108.34 | **$106.29** | $108.55 | $115.00 / $100.00 |
| $250 | $270.41 | **$265.27** | $268.61 | $287.50 / $250.00 |

- **At 5%, Jump beats Eventbrite only below about $115 a ticket**, because Eventbrite's $1.79 fixed fee dominates on cheap tickets. A gala at $250 a seat costs the buyer more on Jump than on Eventbrite.
- **At 3%, Jump is cheaper than Eventbrite at every price.** Both the percentage (≈6.0% vs ≈6.7%) and the fixed part ($0.30 vs ≈$1.84) are lower.
- **Against Zeffy**, Jump costs less than a donor who keeps Zeffy's default tip, and more than one who sets it to $0. The honest line: **"a fixed, disclosed fee instead of a tip prompt."**
- Zeffy's tip percentages here are illustrative. Zeffy varies the default by amount [2], and donors report 15–22% [5].

### 7.3 Donations: 0% Jump platform fee, processing at cost, donor may cover it

- **Platform fee on a donation line: 0%.**
- **Processing (2.9% + $0.30) on the donation:** the donor sees a **"Cover the $3.30 processing fee so [Org] receives the full $100"** checkbox.
  - **Unchecked by default inside a ticket checkout.** A pre-checked box there would make it a mandatory fee under the FTC rule [35].
  - **May be pre-checked on a standalone donation form**, where the FTC live-event rule does not apply. Recommendation: still start unchecked for consistency and trust. Measure the coverage rate, and revisit with data.
  - When covered, gross the fee up so the nonprofit truly nets the full gift: cover = (gift + 0.30) / (1 − 0.029) − gift, e.g. $3.30 on $100. Today's ticket formula does not gross up; it multiplies (subtotal + platform fee) by 2.9%.
- **If the donor doesn't cover:** the nonprofit nets gift − processing (e.g. $96.80 of $100). Jump earns $0 on that gift.

**Owner decision (section 10, Q1): match Zeffy's "nonprofit keeps 100%"?** Three options:

- **(a) As above.** Honest and simple. The nonprofit pays processing only when the donor declines. Jump earns nothing on donations and monetises through tickets, applications and the STARTER subscription.
- **(b) Jump absorbs uncovered processing**, a "Givebutter Guarantee"-style promise [42‡]. This costs Jump ~3% of uncovered donation volume. Only viable funded by (c) or by subscription revenue.
- **(c) An optional tip to Jump, opt-in at $0.** Zeffy and Givebutter run on tips, but theirs are pre-filled. An opt-in tip will raise far less. Only worth it with (b).

**Recommendation:** ship (a). Reconsider (b) once there is coverage-rate data. Never ship a pre-filled (c).

### 7.4 Stripe's nonprofit rate

Under destination charges, Jump pays Stripe on the platform account at standard rates. The nonprofit discount (≈2.2% + 30¢, requiring ≥80% donation volume [29]) is out of reach for Jump's platform account. A nonprofit that does mostly donations would get the discount on its **own** account only under direct charges. That is the open spec 010 §11.1 question, so record it there and do not block on it.

---

## 8. Legal and tax items

Not legal advice. Every item here goes to counsel with spec 023.

> **Superseded in part (2026-10-08).** The primary-source research is in [Donation legal compliance](./2026-10-08-donation-legal-compliance.md). Where the two disagree, that document wins. The main corrections to this section:
>
> - **§8.3, AB 488.** The answer is now "probably yes". Jump fits the regulation's "solicitation type E" (11 CCR §314(q)). The duties include:
>   - registration (PL-1, $625);
>   - separate funds;
>   - payout within 5 business days;
>   - a good-standing check on each charity.
>
>   Hawaii HRS 467B (effective 2026-07-01) adds a parallel duty.
> - **The charge model.** Destination charges without `on_behalf_of` put gifts in Jump's balance. Four rules strain on that:
>   - Stripe's donation rules;
>   - the FinCEN and NC agent-of-payee money-transmitter exemptions, which are written for goods and services;
>   - NC 131F, where custody makes Jump a "solicitor" rather than a consultant;
>   - California's commingling rule.
>
>   The decision is now a D0 item.
> - **§8.2.** The 2026 insubstantial-benefit limits are $13.90, $139 and $69.50 (Rev. Proc. 2025-32).
> - **§8.5.** NC exempts §170-deductible donations from admission tax (G.S. 105-164.4G(f)). The Stripe Tax admissions code `txcd_20060057` in use today is "Stenographic Services".

### 8.1 Quid pro quo disclosure: payments over $75 (IRC §6115)

When a donor pays **more than $75** and receives goods or services (a gala dinner ticket, a tote), the charity must give a written statement. It must say the deductible amount is limited to the payment minus the fair market value (FMV) received, and it must give a **good-faith FMV estimate**. The penalty is **$10 per contribution, up to $5,000 per event or mailing** [32] (V). The rule has exceptions for insubstantial benefits and certain membership benefits [32].

**What this means for Jump:**

- Nonprofit ticket tiers need an optional `fairMarketValue`.
- A receipt for a $250 gala ticket with $80 FMV must state that $170 may be deductible.
- A plain donation line has FMV $0.

### 8.2 Written acknowledgment: single gifts of $250 or more (IRC §170(f)(8))

The donor cannot deduct a **single** contribution of $250 or more without a **contemporaneous written acknowledgment** [33] (V). It must state:

- the organization's name;
- the cash amount;
- whether goods or services were provided, and if so their description and a good-faith value.

Separate gifts under $250 are **not aggregated**. One annual summary may cover several gifts. **Email is acceptable** [34] (per IRS Pub 1771 as excerpted in search results ‡; the PDF could not be text-extracted here).

**What this means for Jump:**

- Every donation receipt carries the org's legal name and the amount, plus a "no goods or services were provided" sentence, or the FMV line.
- Build an annual giving statement per Contact (D4).
- Showing the EIN is customary but not stated as required on the IRS page [33].

### 8.3 State charitable solicitation registration

About **40 states plus DC** require a charity to register before soliciting there. Online solicitation can trigger registration under the **Charleston Principles**: targeting a state's residents, or repeated contact with them. Only ~17 states formally adopt those principles [37‡].

**California AB 488** separately regulates **charitable fundraising platforms**:

- registration with the Attorney General, renewed annually;
- annual reporting of donations, fees and disbursements;
- no facilitating gifts to charities that are delinquent, suspended or revoked;
- written consent before using a charity's name [36‡].

**What this means for Jump:**

- (1) Registration is the nonprofit's own obligation. Jump should say so in onboarding and terms, not do it for them.
- (2) **Whether Jump itself is a "charitable fundraising platform" under AB 488** is a counsel question. AB 488 is aimed at platforms soliciting for charities. Jump sells software to the charity itself, and money goes to the charity's own Connect account, but that should be confirmed, not assumed. **Go-live blocker** for donations in California if the answer is yes.
- (3) Jump should verify 501(c)(3) status (EIN check against IRS data) before turning on deductibility wording. It must never print "tax-deductible" for an organization that isn't.

### 8.4 FTC fee rule (16 CFR Part 464, effective 2025-05-12)

The rule requires **live-event ticket** prices to show the total price upfront, with mandatory fees included [35] (V). Optional add-ons may be left out of the total, **but charges paid through "pre-checked boxes, or opt-out provisions" are treated as mandatory** [35] (V). The FAQ does not address tips or donations specifically.

**What this means for Jump:**

- In a ticket checkout, the donation line and the cover-fees box start **empty and unchecked**.
- A tip to Jump, if ever added, starts at $0.
- The ticket's all-in price (existing `all-in-pricing` behaviour) is unchanged by donations.

### 8.5 Sales tax

Donations are not sales. The donation line is `taxable: false` and is left out of `TaxService.collectedReport`. The deductible portion of a gala ticket does **not** change the ticket's sales-tax treatment; that is a jurisdiction question for counsel and spec 009.

### 8.6 Refunds and receipts

- Refunding a gift after a receipt has gone out should void it and send a corrected receipt.
- Disputes follow the existing `DisputeService`.
- Recurring gifts cancel from the patron account (spec 040) and the admin, both directly.

---

## 9. Plan: thin slices

Each phase is shippable on its own and dark behind `DONATIONS_ENABLED`. Phases follow the house gotchas:

- **One ledger.** Every dollar is an `Order` with lines, `PaymentTransaction` and `Refund` (Gotcha 17). There is no `/admin/donations` money list. `/admin/orders` gets a **Kind** filter.
- **Contacts are scoped per org.** Find the donor by `organizationId_email` (Gotcha 8).
- **The two fee libraries stay identical,** with shared fixtures (Gotcha 12).
- **Payment state changes only through webhooks** (root AGENTS.md).
- **An RSVP is never an Order** (Gotcha 29).
- **Erasure and export cover new buyer data.** That means `BuyerDataExportService` and `ContactErasureService`.

**Compliance mapping (2026-10-08).** Every requirement in [Donation legal compliance](./2026-10-08-donation-legal-compliance.md) §5 is assigned to a phase below.

- Numbers in the form "§5 #n" refer to rows of that table.
- "L1"–"L8" are its launch blockers (§6).
- **`DONATIONS_ENABLED` must not be turned on in production until L1–L8 are cleared.** Building dark is fine.

**Required capabilities (owner, 2026-10-09).** Version 1 must support all four of these. **v1 = D0 + DV + D1 + D3.** D2 (campaigns and goals) and D5 can follow.

| # | Capability | Phase | Where the donor sees it |
|---|---|---|---|
| R1 | One-time gift as an add-on to an event ticket purchase | D1 | Gift step in event checkout |
| R2 | Preset amounts (common denominations) plus a custom amount | D1, reused by D3 and D2 | Every gift picker |
| R3 | One-time gift without buying a ticket | D1 (donate-only on an event); D3 adds the org-level `/donate` page | Event page, `/donate` |
| R4 | Recurring monthly gift (a subscription) | D3 | `/donate`, event donate-only, and "Make it monthly" after a ticket purchase |

Consequences of putting R4 in v1:

- **D0 3b is required, not optional.** A monthly gift has no event, so `Order.eventId` must be nullable before D3. This settles open decision 4.
- **D3 no longer waits for D2.** D3 ships a minimal org-level `/donate` page with no campaign model; `RecurringGift.campaignId` stays optional, and D2 later adds campaign pages around the same form.
- **One gift-picker component** (amount presets, custom amount, one-time / monthly toggle, cover-fees box) serves checkout, donate-only, `/donate` and later the D2 DonationForm section. Never fork it per surface (the spec 019 SubmissionsTable rule).

### D0. Groundwork (no UI)

1. **Webhook routing.** Make `BillingService.isBillingEvent` require a Jump-billing marker:
   - `metadata.kind = 'jump_billing'` on the billing Checkout and subscription, or
   - `subscription.items[].price.id === JUMP_STARTER_PRICE_ID`.

   Then an organization's donation subscription on the platform endpoint is no longer swallowed. Add a contract test: a donation subscription event on `/webhooks/stripe` must not be IGNORED.
2. **Per-line fee rule in `FeeService` and `fees.ts`.** Each item gets `platformFeeRate` (default `FEE_CONFIG.platformFeePercent`) and `feeMode` (`PASS` | `ABSORB`). Shared fixtures gain:
   - a donation-only cart;
   - ticket + donation (covered);
   - ticket + donation (not covered);
   - a tax-inclusive ticket + donation.

   A per-org rate override (`Organization.platformFeeRate` or a plan lookup) is added here for the 3% nonprofit ticket rate.
3. **Decide the event anchor.** Either:
   - **(a)** D1 keeps `Order.eventId` required (event-anchored gifts only), and D2 makes it nullable; or
   - **(b)** do it now: add `Order.organizationId` (backfill from event → venue), make `eventId` nullable, and move revenue and tax queries to `organizationId`.

   Recommendation: **(b) in D0** if D2 is committed. The migration touches TaxService, EventService analytics, DashboardService, CustomerService and every `kind`-switch. It is cheaper once than twice.
4. **Decide the gift charge model (new; blocks D1).** See compliance doc §4. Options:
   - **A:** today's destination charge;
   - **B:** destination charge with `on_behalf_of`;
   - **C:** a direct charge on the charity's account.

   Under B or C, a ticket and a gift can't share one payment unless the whole order moves to the charity, which flips the spec 009 seller-of-record decision. Decide with Stripe (L1) and counsel (L3). Write the result into spec 010 §11.1. The likely result is C for donate-only orders, plus a separate gift payment or B for ticket + gift.

**D0 compliance checklist:**

- [ ] **L1.** Open the Stripe approval request for "fundraising on a Connect platform" with the chosen charge model (§5 #21).
- [ ] **L7.** Decide how 1099-Ks get filed for Express accounts. Stripe does **not** file for `application_express` (compliance §2.5).
  - Enable Stripe's 1099 product or another filer.
  - Collect a W-9 or TIN per account.
  - Correct `specs/010-payments-settings/plan-phase-2.md:341` and the launch checklist.
  - This also gates `STRIPE_CONNECT_ENABLED` for tickets.
- [ ] Fix `ADMISSIONS_TAX_CODE = 'txcd_20060057'` ("Stenographic Services") in `backend/src/services/TaxService.js`. Fix it in its own PR, with the spec 009 owner choosing between `txcd_50010003`, `txcd_50011001` and `txcd_50013001`. Not donation work, but found here (§5 #22).
- [ ] Add `DONATION_TERMS` and `RECURRING_GIFT` to `LegalDocument`, and their version constants in both apps (spec 024 / LR-05 pattern).
- [ ] Put the eight counsel questions (compliance §7) on the spec 023 counsel card.

### DV. Nonprofit verification and charity agreement (new; before D1)

Who may take gifts, and what may be said about them. SYSTEM_ADMIN and org-admin UI only. Nothing changes on the storefront.

- **Deductibility status** (§5 #1, L4):
  - `Organization.deductibilityStatus` (`NOT_VERIFIED` | `DEDUCTIBLE_170C` | `EXEMPT_NOT_DEDUCTIBLE` | `NOT_EXEMPT`);
  - evidence (Pub 78 match and deductibility code, or an uploaded determination, group-ruling or church document);
  - `verifiedAt` and `verifiedBy`.
- **Verification flow.**
  - **Launch:** SYSTEM_ADMIN checks the EIN against the IRS Pub 78 and revocation bulk files, loaded into a lookup table refreshed monthly.
  - **Fallback:** manual review for churches, group subordinates and governmental units.
  - **Monthly job:** re-check against the revocation file. A hit drops the org to `NOT_VERIFIED` and emails its admins.
- **Gifts only to the org itself.**
  - Donations are available only to orgs with status `DEDUCTIBLE_170C` or `EXEMPT_NOT_DEDUCTIBLE`.
  - A gift always goes to the selling org.
  - No organizer may take gifts "for" another charity. That would make it a co-venturer and Jump a type C/D platform (§5 #20).
- **Org receipt identity.**
  - `legalName` and EIN (existing `ein`, shown unmasked on receipts with consent);
  - `receiptSignatory`;
  - `privacyPolicyUrl`.
- **State disclosures** (§5 #17, #18).
  - Per-org settings with prefilled legends for NC, FL, NY, PA, VA, WA, NJ, MD, MS and WV, plus an editable phone or registration number.
  - The NC legend is on by default for NC orgs. The phone number is a setting, because the statute leaves it as a placeholder.
  - Onboarding asks for state license numbers or an exemption, and states that registration is the org's job.
  - An optional "local focus" sentence.
- **Charity agreement** (L6).
  - The org admin accepts `DONATION_TERMS`, recorded as a `LegalAcceptance` with `subjectType: User` and `organizationId`.
  - The agreement covers: consent to use the org's name (AB 488 / HRS 467B), agency, the authority to send acknowledgments in the org's name, data processing (DPA), payout timing, dispute recovery, and the org's own registration duties.
- **Good-standing gate** (§5 #16).
  - Before enabling donations and then monthly: verified status, plus the California AG "May Not Operate or Solicit" list if Jump registers in California.
  - A failure disables donations and emails the org.

**DV compliance checklist:** §5 #1, #17, #18, #20, plus the parts of #16 that need consent and good standing. L4, plus L6 text from counsel.

### D1. Gift at event checkout, and donate-only on an event (MVP for the prospect)

- **Organizer:** per event, turn on **Accept donations** and set:
  - preset amounts, e.g. $10 / $25 / $50 / other;
  - a minimum;
  - a short appeal line;
  - whether a donation needs a ticket.

  Requires DV verification.
- **Organization defaults** (Settings, reused by every event and by D3): preset amounts (default $10 / $25 / $50 / $100), minimum (default $1), maximum (default $10,000, a fraud cap), and the appeal line. An event can override the presets.
- **Buyer (R1, R2):** an optional "Add a gift to [Org]" step in event checkout.
  - Preset amount buttons plus an **Other amount** field (whole dollars or cents, validated against min and max on the server too).
  - **Nothing is pre-selected** and the gift starts at $0, so presets never act as a default charge (FTC fee rule, checklist below).
  - The cover-fees box is unchecked and shows the exact amount it adds.
  - The gift appears as its own line in the order summary before Pay.
- **Donate-only (R3):** the same picker without a ticket. Works on free, RSVP and sold-out events.
- **Confirmation page:** a "Make it monthly" prompt that opens the D3 recurring flow. It is a separate payment, never added to the ticket order (see D3).
- **Ledger:** `OrderKind` gains `DONATION` for donate-only orders; a gift added to a ticket order stays `TICKET`. `OrderItemKind.DONATION` uses `taxable: false` and `platformFeeRate: 0`. Gifts are charged under the D0.4 model.
- **Receipt:** the order confirmation gains a **Gift** block, and every gift gets a `GiftReceipt` row (append-only, with a snapshot of the org's identity and the text as sent).
- **Admin:**
  - Orders gets a Kind filter (Ticket / Application / Donation), and order detail shows the gift line.
  - Event analytics shows "Gifts" separate from ticket revenue.
  - The tax report excludes gifts.
- **Refunds:** a partial refund of the gift line through `RefundService.refundOrder`, with `reverse_transfer`. **Receipt voiding moves here from D4,** because refunds ship in D1.

**D1 compliance checklist:**

- [ ] **Receipt** (§5 #3, #4, L5). Every gift, any amount:
  - the charity's legal name and EIN;
  - the date and amount;
  - "No goods or services were provided in exchange for this gift", or the FMV line;
  - "Keep this receipt for your tax records";
  - no SSN collected;
  - sent at once, in the charity's name as donee (never "Eventimus" as donee).
- [ ] **Deductibility wording** only when `DEDUCTIBLE_170C`. The §6113 sentence, in its own paragraph at body size, when `EXEMPT_NOT_DEDUCTIBLE` (§5 #1, #2).
- [ ] **FTC fees rule** (§5 #12):
  - the gift starts at $0 with no amount pre-selected;
  - cover-fees is unchecked;
  - the gift is a named line in the total before Pay;
  - the ticket's all-in price is unchanged;
  - no fee is ever called a donation.
- [ ] **"About this gift" block** (compliance §3.5) in the gift step and donate-only page: recipient, deductibility, fees, timing, data, refunds, and the org's state legends (§5 #13, #17). "100% goes to [Org]" only when processing is covered.
- [ ] **Sales tax** (§5 #22): the gift is `taxable: false` and always optional. A "required donation" for entry must be a ticket tier, never a gift line.
- [ ] **Voiding** (§5 #9): a refund voids the receipt and emails a corrected acknowledgment.
- [ ] **Disputes** (§5 #25): a dispute on a gift reverses the transfer per the charity agreement, and a dispute-rate alert per org is added.
- [ ] **BNPL off** for orders containing a gift. Not a legal rule, but a refund and dispute risk.
- [ ] **AB 488 / HI** (§5 #16, L2): if not registered, `DONATIONS_GEO_BLOCK` refuses gifts whose billing state is CA or HI.
  - Stripe Checkout collects the billing address. Enforce it in the `checkout.session.completed` handler by refunding blocked gifts, and in the UI with a state question before the gift step.
  - Counsel picks registration or geofence.
- [ ] **Privacy** (§5 #23): gifts appear in `BuyerDataExportService`. `ContactErasureService` anonymizes the contact and keeps `GiftReceipt` and the ledger. The charity's privacy URL is linked on the page.
- [ ] **Gates:** L1–L8 cleared before production.

### D2. Standalone campaigns and donation pages

- **`DonationCampaign`** (per org): slug, title, description (sanitised HTML, Gotcha 20), goal amount, start and end, preset amounts, optional `eventId`, custom questions (reusing `ApplicationQuestion` types), `allowRecurring`, `hidden`.
- **Public pages:**
  - `/donate/<slug>` on the storefront, plus a **DonationForm** theme section and a **GoalProgress** section (raised = paid DONATION lines for the campaign).
  - Reserved-path update in both `storefrontHost.ts` and `redirectPath.js` (Gotcha 22).
  - Menu target type.
  - A store-access gate (private store mode).
- **Orders** with `eventId = null` (needs D0 3b).

**D2 compliance checklist:**

- [ ] The D1 receipt, §6113 text, "About this gift" block, legends and geo-block apply to every campaign page and DonationForm section (§5 #2, #13, #16, #17).
- [ ] Campaign copy is the charity's. Jump never promotes, ranks or lists campaigns across orgs. A cross-org "discover causes" page would be "promote a Web site" (Charleston III(C)(2)) and AB 488 type A (§5 #19).
- [ ] **Per-gift report to the charity** (AB 488 §321): an Orders export with gift date, transfer date, gross, fees and net (§5 #16).
- [ ] **Gifts-by-donor-state** report for the charity's registration decisions (§5 #18).
- [ ] The goal thermometer counts net paid gifts only (refunds out), so the display isn't misleading under FTC §5.

### D3. Recurring gifts (in v1, R4)

- **Where monthly is offered:**
  - the org-level `/donate` page (new here, minimal: org name, appeal line, gift picker; reserved-path update in `storefrontHost.ts` and `redirectPath.js`, Gotcha 22; store-access gate);
  - donate-only on an event;
  - "Make it monthly" on the ticket confirmation page.
- **Not inside ticket checkout.** A Stripe Checkout in `mode: 'subscription'` can carry one-time lines, but then the ticket is paid through the subscription's first invoice. That breaks the ticket order's 30-minute reservation, `checkout.session.completed` handling and refunds. Ticket + monthly gift is two payments; the confirmation prompt makes the second one a single step. Open decision 13.
- **Picker:** the D1 component with a **One time / Monthly** toggle, defaulting to One time. Monthly uses the same presets and custom amount. Yearly can be added later; `interval` already allows it.
- **Stripe Billing on Connect**, under the D0.4 charge model. For the destination model: Checkout in `mode: 'subscription'` with `price_data.recurring`, on the platform account with `transfer_data.destination` (destination subscription) and an `application_fee_percent` equal to any covered fee [31]. Under model C, the subscription lives on the charity's account.
- **`RecurringGift`:** `contactId`, `organizationId`, `campaignId?`, amount, interval, `coverFees`, `stripeSubscriptionId`, status, `nextChargeAt`, `canceledAt`, `authorizationAcceptanceId`.
- **Every `invoice.paid` creates one Order** of kind DONATION, idempotent on invoice id, through the platform webhook (D0.1). `invoice.payment_failed` sends a dunning email. `customer.subscription.deleted` cancels.
- **Donor self-serve:** patron "My account" lists monthly gifts with **Change amount / Update card / Cancel** (spec 040). Every email carries a manage link. This is the Donorbox lesson [11].
- **Failed payments:** Stripe Smart Retries; after the final failure the gift moves to `PAST_DUE` and then `CANCELED`, with a donor email at each step and an "update your card" link. Expiring cards get a reminder email before the charge.
- **Admin:** a recurring-gift list per contact on the Customers detail page (a view of `RecurringGift`, not a money list), and a cancel action.

**D3 compliance checklist** (§5 #14, built to California's automatic-renewal law as best practice, plus Reg E and card-network rules):

- [ ] An affirmative, unchecked "Give $X every [month] until I cancel" consent, next to the amount, frequency, first charge date and how to cancel. Stored as `LegalAcceptance` (`RECURRING_GIFT`).
- [ ] An acknowledgment email with the terms copy, immediately.
- [ ] Cancel online in one step from My account and from every email, no login wall beyond the magic link. Admin cancel too.
- [ ] Notice before any amount change (10 days, the Reg E §1005.10(d) standard). An annual reminder of the active gift.
- [ ] A `GiftReceipt` per charge. Each charge is a separate contribution, never aggregated toward $250 (§5 #4).
- [ ] **Memberships with benefits are out of scope.** They would be subscriptions under the automatic-renewal laws and need their own spec.

### D4. Stewardship and IRS reporting

- **Annual giving statement per Contact:** a PDF or HTML email for the calendar year, listing every gift and the deductible portion, net of refunds. Sent in bulk **by January 31** by admin action, and re-sendable (§5 #5).
- **Gala tickets:** `PriceTier.fairMarketValue`, plus a "token benefits" switch validated against the tax-year thresholds in config (2026: $13.90 / $139 / $69.50; Rev. Proc. 2025-32). When the price is over $75, the §6115 statement appears on the **tier's sale page and the receipt**: deductible amount = price − FMV, and FMV is a good-faith estimate by the org (§5 #6, #7).
- **"Give without attending"** option on gala events (Rev. Rul. 67-246) (§5 #8).
- **Receipt branding:** the org's signatory name and title.
- **990 exports** (§5 #10):
  - gift CSV (donor name, address, email, date, amount, FMV, deductible, campaign or event, refund state);
  - per-donor yearly totals (Schedule B);
  - per-event gross / contribution / revenue (Part VIII lines 1c and 8a, Schedule G Part II).
- **Gala sales tax** (§5 #22):
  - the FMV part taxable and the deductible part a separate nontaxable line, pending counsel Q6;
  - a per-event "nonprofit sole-sponsor" exemption switch (NC 105-164.4G(f)), stored with who set it and when. This is a spec 009 extension.

**D4 compliance checklist:** §5 #5, #6, #7, #8, #10, #22 (gala), with L5 text for the annual statement and quid pro quo statement.

### D5. Engagement

- Tribute or in-memory gifts (honoree, optional notify email). The notify email is transactional and carries no appeal.
- An embeddable donate button or iframe for the nonprofit's own website. **The "About this gift" block, legends, §6113 text and geo-block travel inside the embed.** AB 488 still applies when Jump's platform is embedded in the charity's site (§12599.9(a)(1)(E) "may integrate with the charitable organization's platform").
- A thank-you email editor. Organizer-written text can never remove the required receipt fields.
- Lifetime giving on the Customers list with a "Donors" saved filter.
- Any DAF button gives the gift only, never tickets or benefits (§5 #26).

### Later or out of scope

- **Peer-to-peer:** supporter pages, leaderboards.
  - Makes Jump an AB 488 **type B** platform, which brings statutory donor disclosures and receipts within 5 business days.
  - Supporters may become solicitors under state law.
  - Needs its own legal pass.
- **ACH:** re-open spec 010 §5.6, since large and recurring gifts justify it. Brings Nacha WEB-debit fraud screening and mandates (Stripe collects them), and Reg E authorization copies.
- DAF, crypto, stock. Stock and crypto are noncash: Form 8283 and appraisals fall on the donor, and the charity's acknowledgment describes the property without valuing it.
- **Text-to-give:** TCPA consent records and STOP handling. The nonprofit exemption covers landlines only.
- **Auctions and raffles.** Raffles carry state gaming law, W-2G reporting ($2,000 and 300× from 2026) and 990 Schedule G Part III. Keep them out.
- Matching-gift lookup.
- Tap-to-pay donations at the door.
- **Membership programs:** automatic-renewal laws apply (compliance §2.10).

### Data model sketch

```prisma
enum OrderKind      { TICKET APPLICATION DONATION }          // + DONATION
enum OrderItemKind  { TICKET_TIER APPLICATION_TIER ADJUSTMENT WAIVER DONATION }
enum DeductibilityStatus { NOT_VERIFIED DEDUCTIBLE_170C EXEMPT_NOT_DEDUCTIBLE NOT_EXEMPT }  // DV (replaces TaxExemptStatus)
enum LegalDocument  { /* existing */ DONATION_TERMS RECURRING_GIFT }                      // D0
enum GiftReceiptKind { SINGLE ANNUAL }

model Organization {
  // existing: ein String?
  legalName                 String?
  deductibilityStatus       DeductibilityStatus @default(NOT_VERIFIED)
  deductibilityEvidence     Json?      // { source: 'PUB78'|'DOCUMENT', pub78Code, fileId }
  deductibilityVerifiedAt   DateTime?
  deductibilityVerifiedById String?
  stateDisclosures          Json?      // { NC: { enabled, phone }, FL: { enabled, regNumber, phone }, ... }
  privacyPolicyUrl          String?
  platformFeeRate           Decimal?  @db.Decimal(5,4)   // null → FEE_CONFIG; 0.03 for verified nonprofits
  receiptSignatory          String?
}

model GiftReceipt {                                // D1, append-only; snapshot so it reprints as sent
  id               String @id @default(cuid())
  organizationId   String
  contactId        String
  orderId          String?                       // null for ANNUAL
  number           String                        // per-org sequence
  kind             GiftReceiptKind
  amount           Decimal @db.Decimal(10,2)
  fairMarketValue  Decimal @db.Decimal(10,2) @default(0)
  deductibleAmount Decimal @db.Decimal(10,2)
  orgSnapshot      Json                          // legal name, EIN, status, legends, text version
  issuedAt         DateTime @default(now())
  emailedAt        DateTime?
  voidedAt         DateTime?
  supersedesId     String?
}

model Order {
  organizationId String            // D0 3b: backfilled, indexed; eventId becomes optional
  eventId        String?
  // existing columns unchanged
}

model OrderItem {
  // existing columns; for kind = DONATION:
  donationCampaignId String?
  coverFees          Boolean @default(false)
  fairMarketValue    Decimal? @db.Decimal(10,2)   // 0 for a pure gift
  tributeType        String?                      // D5: HONOR | MEMORY
  tributeName        String?
}

model DonationCampaign {                           // D2
  id String @id @default(cuid())
  organizationId String
  eventId        String?
  slug  String
  title String
  descriptionHtml String?
  goalAmount     Decimal? @db.Decimal(10,2)
  presetAmounts  Decimal[]
  minimumAmount  Decimal  @db.Decimal(10,2) @default(1)
  allowRecurring Boolean  @default(false)
  startsAt DateTime?
  endsAt   DateTime?
  hidden   Boolean @default(false)
  @@unique([organizationId, slug])
}

model RecurringGift {                              // D3
  id String @id @default(cuid())
  organizationId String
  contactId      String
  campaignId     String?
  amount         Decimal @db.Decimal(10,2)
  interval       String  // month | year
  coverFees      Boolean
  stripeSubscriptionId String @unique
  status         String  // ACTIVE | PAST_DUE | CANCELED
  canceledAt     DateTime?
  authorizationAcceptanceId String               // LegalAcceptance (RECURRING_GIFT)
}

model PriceTier {
  fairMarketValue Decimal? @db.Decimal(10,2)       // D4: gala deductible portion
  tokenBenefits   Boolean  @default(false)         // D4: validated against tax-year thresholds
}

model Event {
  nonprofitSoleSponsorExempt Boolean @default(false) // D4 / spec 009: NC 105-164.4G(f) style exemption
}
```

There is deliberately **no** `Donation` money table. The gift's money is the Order line; `RecurringGift` holds only the schedule.

---

## 10. Open decisions for the owner

1. **Who pays processing on uncovered gifts?** Option (a), the nonprofit (recommended for launch), or option (b), Jump absorbs it, funded by subscription or by an opt-in tip (section 7.3).
2. **Nonprofit ticket rate.** 3% is recommended because it beats Eventbrite at every price. Choose between a flat 3% and keeping 5%, and decide whether the rate is gated on `deductibilityStatus = DEDUCTIBLE_170C` or on the STARTER plan.
3. **Do donations count in dashboard "revenue"?** Recommendation: show them as a separate "Gifts" figure, never merged into ticket sales, and never in the tax report.
4. ~~When to do `Order.organizationId` / nullable `eventId`.~~ **Settled 2026-10-09:** in D0, because monthly gifts (R4) are in v1 and have no event.
5. **Cover-fees default on standalone forms.** Start unchecked (recommended) or pre-checked. The FTC rule forbids pre-checked only in ticket checkouts.
6. **Nonprofit verification.** Manual SYSTEM_ADMIN approval for launch, or an automated IRS Tax Exempt Organization Search / Candid lookup.
7. **Counsel questions.** The full list of twelve is in [compliance §7](./2026-10-08-donation-legal-compliance.md#7-counsel-only-questions). The ones that block launch:
   - AB 488 and HRS 467B: register, or geofence?
   - NC 131F solicitor status and money transmission under each charge model.
   - Whether Jump may issue acknowledgments in the charity's name.
   - The receipt, statement and disclosure wording.
8. **Gift charge model (D0.4, blocks D1).** Choose between:
   - destination charges, as today;
   - `on_behalf_of`;
   - direct charges on the charity's account.

   This is now driven by compliance (Stripe's donation rules, custody, commingling), not only by Stripe's nonprofit rate. It is the spec 010 §11.1 decision, made with Stripe (L1).
11. **California and Hawaii: register or geofence at launch?** Registration costs $625 a year in California and $250 in Hawaii, plus annual reports. A geofence costs donors in those states. Counsel decides whether a geofence is a sufficient position (L2).
12. **1099-K filer.** Stripe's 1099 product or another filer for Express accounts (L7). This applies to tickets too.
9. **ACH.** Re-open for gifts? It is a big saving on large and recurring gifts, but brings delayed failure handling.
10. **Scope cap.** Confirm peer-to-peer, auctions, raffles and text-to-give stay out of v1.
13. **Monthly gift inside ticket checkout?** Recommended: no. Ticket checkout offers one-time gifts only, and the confirmation page offers "Make it monthly" as a separate one-step payment (D3). The alternative, one subscription-mode Checkout carrying the ticket, needs the ticket order flow reworked around invoices.
14. **Default preset amounts.** $10 / $25 / $50 / $100 with Other is proposed; organizations can change them.

---

## 11. Not verified

Each item below needs a manual check before it is quoted to a prospect.

**Pricing:**

- Every.org's exact fees by payment method. every.org returned 429 or a bot checkpoint [24‡].
- Eventbrite's donation-ticket fee (conflicting excerpts) and its nonprofit-pricing help article (403) [26‡][27‡].
- GoFundMe Pro and Bonterra prices. Neither publishes them [12][19‡].
- Bloomerang Payments' processing rate and Qgiv's legacy rate. Both come from secondary sources [15‡].

**Citations and features:**

- ~~The exact text of IRS Pub 1771 on aggregation and email~~ and ~~California AB 488 details~~ were verified on 2026-10-08 against Pub 1771 and the 11 CCR §§314–323 regulations. See [Donation legal compliance](./2026-10-08-donation-legal-compliance.md) §2.3 and §3.1, and its §8 for what remains unverified.
- All "?" cells in the section 3 feature table.

**User feedback:**

- No Reddit thread was read directly; Reddit refused automated access.
- G2, Capterra and TrustRadius quotes are search excerpts (403).
- Reviews relayed by competitor blogs (Donorbox on Zeffy, Givebutter and Zeffy on Bloomerang) are marked ‡ and may be selective.

---

## Sources (accessed 2026-10-08)

1. Zeffy pricing (V) — https://www.zeffy.com/pricing
2. Zeffy help: "What is the contribution made towards Zeffy? Why was I charged extra?" (V) — https://support.zeffy.com/what-is-the-contribution-made-towards-zeffy-why-was-i-charged-extra-s41ae
3. Zeffy feedback board: "Voluntary Contribution Defaults to $0" (V, 224 votes, marked complete 2026-03-11) — https://feedback.zeffy.com/feature-requests/p/voluntary-contribution-defaults-to-0
4. Zeffy help: payouts, schedules and anti-fraud review ‡ — https://support.zeffy.com/zeffy-payouts-schedules-amounts-and-reports-ajuec
5. Trustpilot, Zeffy 1-star reviews (V; TrustScore 4.7, 556 reviews) — https://www.trustpilot.com/review/zeffy.com?stars=1
6. Givebutter pricing (V) — https://givebutter.com/pricing
7. Givebutter help: legacy pricing explained ‡ — https://help.givebutter.com/en/articles/12143045-givebutter-legacy-pricing-explained
8. Givebutter features (V) — https://givebutter.com/features
9. Trustpilot, Givebutter 1-star reviews (V; TrustScore 4.3, 372 reviews) — https://www.trustpilot.com/review/givebutter.com?stars=1
10. Donorbox pricing (V, fetched with curl) — https://donorbox.org/pricing
11. Trustpilot, Donorbox 1-star reviews (V; TrustScore 4.4, 103 reviews) — https://www.trustpilot.com/review/donorbox.org?stars=1
12. GoFundMe Pro pricing (V; classy.org/pricing 301-redirects here) — https://pro.gofundme.com/c/pricing/
13. GoFundMe Pro reviews on Capterra ‡ (403; search excerpts) — https://www.capterra.com/p/127258/GoFundMe-Pro/reviews/; RallyUp "GoFundMe Pro alternatives" ‡ (competitor) — https://rallyup.com/blog/gofundme-pro-alternatives/
14. Bloomerang pricing (V) — https://bloomerang.com/pricing
15. qgiv.com/pricing → 301 to bloomerang.com/pricing (V); Qgiv legacy fees ‡ (competitor page) — https://www.zeffy.com/compare/zeffy-vs-qgiv
16. Kindful status ‡ — https://www.trustradius.com/products/kindful/reviews; https://www.donordock.com/articles/kindful-alternatives
17. Little Green Light pricing (V) — https://www.littlegreenlight.com/pricing/
18. Little Green Light reviews ‡ — https://www.softwareadvice.com/nonprofit/little-green-light-profile/reviews/; https://www.g2.com/products/little-green-light/reviews
19. Bonterra Network for Good ‡ — https://www.bonterratech.com/product/network-for-good; https://www.trustradius.com/products/bonterra-network-for-good/pricing
20. Funraise pricing (V) — https://www.funraise.org/pricing
21. Fundraise Up pricing (V; page title "Fundraise Up Pricing: 4% Fee, No Contracts") — https://fundraiseup.com/pricing/
22. PayPal Giving Fund: fees help (search excerpt of the official help page), about page (V) — https://www.paypal.com/us/cshelp/article/are-there-any-fees-charged-for-using-paypal-giving-fund--help207; https://www.paypal.com/us/webapps/mpp/givingfund/about
23. "Why PayPal Giving Fund may hurt your nonprofit's fundraising" ‡ — https://www.nptechforgood.com/2025/07/11/why-paypal-giving-fund-may-hurt-your-nonprofits-fundraising-efforts/
24. Every.org pricing, disbursements, receipts ‡ (429 / bot checkpoint) — https://www.every.org/pricing; https://support.every.org/hc/en-us/articles/360061887233-Disbursements-overview; https://support.every.org/hc/en-us/articles/5711616989843-How-do-we-record-and-acknowledge-donations-received-from-Every-org-donors
25. Eventbrite organizer pricing (V) — https://www.eventbrite.com/organizer/pricing/
26. Eventbrite help: nonprofit pricing for Eventbrite Pro ‡ (403) — https://www.eventbrite.com/help/en-us/articles/585157/can-my-nonprofit-or-charity-get-lower-fees-for-our-events/
27. Eventbrite help: collecting donations ‡ — https://www.eventbrite.com/help/en-us/articles/460357/how-to-fundraise-and-collect-donations-with-eventbrite/
28. Eventbrite help: event payouts ‡ — https://www.eventbrite.com/help/en-us/articles/640593/get-started-with-event-payouts/
29. Stripe: fee discount for nonprofit organizations (V) — https://support.stripe.com/questions/fee-discount-for-nonprofit-organizations
30. Stripe Checkout: pay what you want (V) — https://docs.stripe.com/payments/checkout/pay-what-you-want
31. Stripe Connect: subscriptions (destination subscriptions, `application_fee_percent`) ‡ — https://docs.stripe.com/connect/subscriptions
32. IRS: quid pro quo contributions (V) — https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-quid-pro-quo-contributions
33. IRS: written acknowledgments (V) — https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments
34. IRS Publication 1771 ‡ (search excerpts) — https://www.irs.gov/pub/irs-pdf/p1771.pdf
35. FTC: Rule on Unfair or Deceptive Fees FAQ (V); effective-date release — https://www.ftc.gov/business-guidance/resources/rule-unfair-or-deceptive-fees-frequently-asked-questions; https://www.ftc.gov/news-events/news/press-releases/2025/05/ftc-rule-unfair-or-deceptive-fees-take-effect-may-12-2025
36. California AB 488 ‡ — https://www.dwt.com/insights/2024/06/california-ab-488-charitable-funds-rules-in-effect; https://legiscan.com/CA/text/AB488/id/2436303
37. State registration and the Charleston Principles ‡ — https://www.harborcompliance.com/online-fundraising-charleston-principles; https://www.councilofnonprofits.org/print/pdf/node/133
38. Bloomerang reviews ‡ (competitor blogs) — https://givebutter.com/blog/bloomerang-reviews; https://www.zeffy.com/blog/bloomerang-reviews
39. Donorbox blog: Zeffy reviews ‡ (competitor; relays r/Charity) — https://donorbox.org/nonprofit-blog/zeffy-reviews
40. Eventbrite: 50% off Pro plans for nonprofits ‡ — https://www.eventbrite.com/blog/press/newsroom/eventbrite-offers-nonprofits-50-off-all-pro-plans-supercharging-their-individual-efforts-to-drive-positive-change/
41. Zeffy vs Eventbrite (competitor page) ‡ — https://www.zeffy.com/compare/zeffy-vs-eventbrite
42. The Givebutter Guarantee ‡ — https://givebutter.com/blog/givebutter-guarantee
43. G2 comparisons ‡ (search excerpts) — https://www.g2.com/compare/givebutter-vs-zeffy; https://www.g2.com/compare/donorbox-vs-zeffy
44. Jump research: Donation legal compliance (2026-10-08) — ./2026-10-08-donation-legal-compliance.md
