---
type: research
title: Donations: US federal and state legal compliance for nonprofits and for Jump as the platform
status: reference
created: 2026-10-08
updated: 2026-10-08
project: jump
tags: [jump, research, donations, nonprofit, legal, compliance, irs, ftc, ab488, charitable-solicitation, stripe, sales-tax, privacy]
source: IRC and Treasury regulations, IRS publications and revenue procedures, CFR (FTC, FCC, CFPB, FinCEN), state statutes and AG/SOS guidance, NASCO Charleston Principles, Stripe legal pages and docs (see Sources); Jump code at origin/main
---

# Donations: legal and compliance research for Jump

> **Not legal advice.** This document lists obligations, cites the primary source for each, and turns them into product requirements. Every conclusion marked **Counsel** goes to the spec 023 counsel card (kanban `t_8a35c2fa`) before launch. Where a summary disagrees with its source, the source wins.

**Companion to** [Donation platforms](./2026-10-08-donation-platforms.md), which holds the market survey, pricing and the phased plan (D0, the new DV, then D1–D5). That plan's §9 now assigns every requirement in this document to a phase.

**How to read the citations.**

- A bracketed number points to the Sources list.
- **(V)** means the primary source was read on 2026-10-08.
- **‡** means the claim is unverified: it comes from a secondary mirror or a search excerpt, or rests on inference. The reason is given in §8.
- Jump code citations refer to `origin/main`. Read them with `git show origin/main:<path>`.

**Jump's payment model as it stands.** These facts drive most of the conclusions below:

- Stripe Connect Express with **destination charges and no `on_behalf_of`**. Jump's platform account is the merchant of record.
- Funds settle to Jump's balance, and the org's subtotal is then transferred to its connected account.
- The card statement reads `JUMP* ORG`.
- Jump computes and remits sales tax.

Sources: spec 010 plan §5.2/5.3, `specs/010-payments-settings/plan-phase-2.md:5`; spec 023 assumption A2.

---

## 1. Summary

### 1.1 What changes the plan

1. **Jump is probably a "charitable fundraising platform" in California, and also in Hawaii.**
   - **California.** AB 488 names Jump's model almost word for word. The statute's limb (E) covers a platform that "provides to charitable organizations a customizable internet-based website, software as a service, or other platform that allows charitable organizations to solicit or receive donations" [49]. The regulation's "solicitation type E" is a private-labeled SaaS under a license agreement [48] (V).
   - **The vendor exclusion does not help.** It protects only vendors serving *a platform*, not vendors serving a charity directly [49].
   - **What California requires:**
     - registration (PL-1, $625) and annual renewal (PL-2, $625, due January 15);
     - an annual report (PL-4, due July 15);
     - written consent from each charity;
     - a good-standing check before enabling a charity;
     - donations held in a **separate account**, never commingled;
     - payout within **5 business days**;
     - a per-donation report to the charity [48][49] (V).
   - **Hawaii.** HRS 467B, effective 2026-07-01, has a parallel definition. It applies "even if another entity receives, processes, holds, or distributes the funds" [50] (V).
   - **Status: launch blocker.** Either register in both states, or take a counsel-approved position that geofences them.
2. **Stripe says "You may not accept donations on behalf of someone other than yourself"** [41]‡.
   - Without `on_behalf_of`, "the platform is the business of record for the payment" [42] (V).
   - Stripe lists "fundraising conducted by nonprofits" and "crowdfunding platforms" as **restricted**, meaning they need Stripe's approval [40] (V).
   - **Status: launch blocker.** Get Stripe's written approval of the donation model, and agree with Stripe on the charge type used for gift lines.
3. **Destination charges are the weak point in four separate regimes**, all because the gift lands in Jump's balance first:
   - **FinCEN.** The payment-processor exemption is written around "the purchase of … a good or service" [37] (V). A gift is neither.
   - **NC Money Transmitters Act.** The agent-of-payee exemption needs a written agency agreement and a verification request to the Commissioner [38] (V).
   - **NC G.S. 131F.** A "fund-raising consultant" must never have "custody or control of contributions"; anyone paid who fails that test falls into "solicitor" [53] (V).
   - **California.** AB 488 forbids commingling [48] (V).

   **Recommendation: settle gifts on the charity's own connected account.** Use direct charges, or at least `on_behalf_of`, for donation payments. That makes the charity the merchant and moves custody to it. A gift and a ticket can't be split across two merchants in one Checkout payment, so this is a D0 architecture decision (§5.1).
4. **Jump, not Stripe, files the 1099-Ks for its Express accounts.** This applies to tickets today, not only donations.
   - Stripe files only where the connected account pays Stripe's fees (`controller.fees.payer = account`). For `application_express`, "the platform is responsible for filing" [18] (V).
   - Nonprofit payees get no blanket exemption under Treas. Reg. 1.6050W-1 [17] (V).
   - The threshold is above $20,000 **and** above 200 transactions for third-party settlement organizations (restored by OBBBA). Payment-card transactions have no threshold at all [17] (V). Which of those applies to Jump's payouts is a question for a tax advisor.
5. **Jump's Stripe Tax "admissions" code is wrong**, and has been for every Stripe-Tax region since spec 009.
   - `TaxService.js:14` uses `txcd_20060057`, which Stripe's catalog names **"Stenographic Services"** [46] (V, checked against the page source on 2026-10-08).
   - The admissions codes are `txcd_50010003` (spectator venues), `txcd_50011001` (cultural venues) and `txcd_50013001` (professional events).
   - Stripe has a **"Cash Donation"** code, `txcd_90000001` [46] (V).
   - Fix this in a separate PR. It is not donation work.

### 1.2 What stays as the earlier doc said, now sourced

- **$250 acknowledgment.** The receipt must carry:
  - the org's name;
  - the amount;
  - "no goods or services", or a description and good-faith value of what was provided.

  It must reach the donor before they file, email is fine, and no SSN is needed [8][9] (V).
- **Quid pro quo above $75.** The receipt must state that only the amount above the value received is deductible, plus a good-faith estimate of that value. The penalty is $10 per contribution, capped at $5,000 per event [10][11] (V).
- **2026 insubstantial-benefit limits** [13] (V):
  - low-cost article: **$13.90**;
  - 2% test: the lesser of 2% of the payment or **$139**;
  - minimum payment for the token rule: **$69.50**.
- **FTC fee rule.** It applies to Jump as a for-profit ticket seller even when the organizer is a nonprofit. Pre-checked or opt-out charges count as mandatory [23] (V). The FTC said the rule "has no bearing on" the IRS quid pro quo rules [23] (V).
- **Recurring gifts** are probably outside ROSCA and the CA, NY and NC automatic-renewal laws, because those laws regulate the sale of goods or services [35][36]‡.
  - **A membership with benefits is probably inside them.**
  - Build to the California standard regardless.
  - The FTC click-to-cancel rule was vacated on 2025-07-08 [34] (V). A new advance notice was published on 2026-03-13, with no rule yet [34] (V).
- **State charity registration is the nonprofit's own obligation.** Jump supplies the disclosure legends and the data. The legends are mandatory on solicitations and receipts in NC, FL, NY and PA, among others [53][54][55][56] (V).
- **Sales tax.** A truly voluntary gift is not taxable. NC expressly exempts "a donation that is deductible as a charitable contribution under section 170" from admission tax [62] (V). Anything required for entry is taxable admission, whatever it is called [65] (V).

### 1.3 Launch blockers for donations

The full list, with owners, is in §6.

1. Stripe approval of the donation model and the gift charge type.
2. California AB 488 and Hawaii HRS 467B: register, or take a counsel-approved geofence position.
3. Counsel's position on NC solicitor status and money transmission for the chosen charge type.
4. Nonprofit verification and per-org deductibility status before any "tax-deductible" wording appears.
5. Receipt wording approved by counsel.
6. A charity agreement (SaaS terms plus a donation annex) covering consent, agency, data and payout.
7. A 1099-K filing plan for Express accounts. This also blocks Connect for tickets.

---

## 2. Federal

### 2.1 Who can receive deductible gifts (IRC §170(c)) and how Jump verifies it

**Who qualifies.** Gifts are deductible only when made to the recipients listed in §170(c) [1] (V):

- governmental units, for public purposes;
- domestic charitable, religious, educational, scientific or literary organizations (the 501(c)(3) universe);
- veterans' organizations;
- fraternal lodges, for charitable use;
- nonprofit cemetery companies.

501(c)(4), (c)(6), (c)(7) and 527 organizations are **not** on the list.

**Verification data.** The IRS publishes all of the following as monthly bulk files:

- Pub 78 data, which carries a deductibility code;
- the automatic-revocation list;
- 990-N filers;
- the EO BMF extract (release dated 2026-09-08, about 1.96M records).

Sources: [2][4] (V). Pub 78 deductibility codes [3] (V):

- `PC` and `POF`: 50%, or 60% for cash.
- `PF`: 30%.
- `GROUP`: a central organization; its subordinates are not listed.
- `LODGE`, `UNKWN`, `EO`, `FED`, `FORGN`, `SO*`.

**Gap.** Churches, group-ruling subordinates and governmental units are often **absent** from Pub 78, because churches need not apply [5] (V). Verification therefore needs a manual path: a group-ruling letter, church attestation, or government entity.

**Product.**

- `Organization.deductibilityStatus` takes one of `NOT_VERIFIED`, `DEDUCTIBLE_170C`, `EXEMPT_NOT_DEDUCTIBLE` or `NOT_EXEMPT`. Record the evidence (Pub 78 match with code, or document), `verifiedAt` and `verifiedBy`.
- Re-check monthly against the revocation file.
- Never print "tax-deductible" unless the status is `DEDUCTIBLE_170C`.

### 2.2 The "not deductible" notice for exempt orgs that aren't 170(c) (IRC §6113)

**Who it covers.** 501(c), 501(d) and 527 organizations that cannot receive deductible gifts and whose gross receipts are **normally over $100,000** (a three-year average). They must put an express statement, "in a conspicuous and easily recognizable format", in every fundraising solicitation [6] (V).

**Safe-harbour wording** (Notice 88-120): "Contributions or gifts to [org] are not deductible as charitable contributions for Federal income tax purposes" [6] (V).

**Format.** Print rules: the same type size as the main message, and either the first sentence of a paragraph or a paragraph of its own [6] (V). Notice 88-120 does not address web or email, so applying the print rules there is an inference ‡.

**Penalty.** $1,000 per day, capped at $10,000 per year. Intentional disregard has no cap [7] (V).

**Product.**

- For `EXEMPT_NOT_DEDUCTIBLE` orgs, every donation page, gift step and receipt shows the safe-harbour sentence in its own paragraph at body size.
- Show it whatever the org's size: Jump can't tell whether an org is under $100,000, and the sentence is harmless.

### 2.3 Contemporaneous written acknowledgment for gifts of $250 or more (§170(f)(8); Reg. 1.170A-13(f))

**Required contents** [8][9] (V):

1. The organization's name.
2. The amount of cash.
3. A description, but not the value, of any non-cash property.
4. A statement that no goods or services were provided, **or** a description and good-faith estimate of the value of goods or services provided.
5. If applicable, a statement that only intangible religious benefits were provided.

**Timing and form** [8][9] (V):

- The donor needs the acknowledgment by the earlier of the date they file the return and the return's due date, including extensions.
- Email and computer-generated acknowledgments are acceptable. Either one per gift or an annual summary works.
- "It isn't necessary to include either the donor's Social Security number or tax identification number."

**No aggregation.** Separate gifts under $250 are not added together [8][9] (V). Each monthly charge of a recurring gift is its own contribution.

**Who is responsible.** The **donor** loses the deduction without the acknowledgment. The charity isn't penalized under §170(f)(8) but "must assist" [8] (V). The statute says "by the donee organization". No primary source says whether an agent such as Jump may issue it ‡.

- **Product:** issue the acknowledgment **in the charity's name, as donee**, from a sender the charity has authorized in its agreement. Never present Jump as the donee.

**Gifts under $250** [14] (V). The donor still needs a bank record or a written communication showing the org's name, the date and the amount. Every receipt carries all three.

**2026 context** [16] (V). OBBBA adds a deduction for non-itemizers of up to $1,000 ($2,000 married filing jointly) for cash gifts to charities, excluding DAFs. Itemizers face a 0.5% floor. Small-gift receipts matter more to donors from 2026.

**Refunds** ‡. No IRS authority says how a charity handles a refunded gift. A gift the donor can get back is not deductible unless reversal is "so remote as to be negligible" [14]. A refund after the deduction falls under the tax-benefit rule, and §111 was not fetched here.

- **Product:** a refund voids the receipt, sends a corrected acknowledgment, and removes the amount from statements and exports.

### 2.4 Quid pro quo payments over $75 (§6115; Reg. 1.6115-1)

**Who and when.** Any 170(c) donee except a governmental unit must give a written statement "in connection with the solicitation or receipt" of a payment **over $75** that is partly a gift and partly a purchase [10] (V). The statement must:

- say the deductible amount is limited to the payment minus the value of goods or services received;
- give a **good-faith estimate** of that value, by "any reasonable methodology", including comparable goods.

Examples from the regulation: a museum gala valued at hotel-ballroom rates; a dinner plus a tour valued at the dinner alone [10] (V).

**Placement.** The statement must be likely to come to the donor's attention. Small print inside other material may fail [8] (V).

**Penalty.** $10 per contribution, capped at $5,000 per fundraising event or mailing. Reasonable cause is a defense [11] (V).

**Example.** A $100 ticket worth $40 is deductible up to $60. The disclosure is still required, because the payment is over $75 even though the deductible part is under $75 [8] (V).

**Exceptions:**

- insubstantial benefits (the token rule below);
- annual membership benefits for payments of **$75 or less**;
- intangible religious benefits;
- pure purchases with no gift element.

Sources: [8][9] (V).

**2026 insubstantial-benefit thresholds** (Rev. Proc. 2025-32 [13] (V); 2025 values in brackets):

| Rule | Value |
|---|---|
| Low-cost article (logo items) | **$13.90** [$13.60] |
| 2% test | benefits worth at most the lesser of 2% of the payment or **$139** [$136] |
| Token rule | payment of at least **$69.50** [$68], with only low-cost logo items received |

**Unused tickets** (Rev. Rul. 67-246) [12] (V). Not using a ticket doesn't make the payment more deductible. "The test … is whether the right was accepted or rejected." The deductible amount "should be stated in making the solicitation and clearly indicated on any ticket, receipt."

- **Product:** offer a **"Give without attending"** option, a pure gift with nothing received in return.

**Raffles and auctions.**

- Raffle tickets are never deductible [14] (V). For 2026 the W-2G threshold is $2,000 **and** 300× the wager [15] (V), and winnings above $5,000 are withheld at 24% [15] (V). Raffles also bring state gaming law. **Out of scope.**
- At an auction, only the amount paid above fair market value is deductible [14] (V).

**DAF grants** (§4967; Notice 2017-73) [21] (V).

- A DAF must not pay for a ticket or any other benefit. The IRS rejected splitting payment between the fund and the donor.
- The charity's acknowledgment goes to the sponsoring fund, not to the individual ‡.
- Employer matching gifts: not researched.

### 2.5 Form 1099-K and Jump's own reporting

**Thresholds.**

- Third-party settlement organizations: **more than $20,000 and more than 200** transactions. OBBBA restored this retroactively.
- Payment-card transactions: **no threshold** [17] (V).

**Who files under Stripe Connect.** Stripe files only where `controller.fees.payer = account`. For Express platforms (`application_express`), "the platform is responsible for filing any relevant 1099 forms" [18] (V). Jump is also an aggregated payee under Reg. 1.6050W-1(d)(1) [17] (V).

**Exempt payees.** Payments to tax-exempt organizations have no blanket exemption [17] (V). Gifts and ticket sales are reported together as gross.

**Open question (tax advisor):** card-transaction rules (no threshold) or TPSO rules ($20k / 200)?

**Product and ops:**

- Collect a W-9 (or the Stripe-collected TIN) per connected account.
- Enable Stripe's paid 1099 product for the platform, or file another way.
- This is spec 010 work that donations make urgent. Update `production-launch-checklist.md`. The spec 010 phase-2 plan line "Stripe files for Express accounts when enabled" (`plan-phase-2.md:341`) is **wrong** for `application_express` accounts.

### 2.6 Form 990 data Jump should export for the nonprofit

**Schedule B** [19] (V). It lists contributors who gave **$5,000 or more** in a year. For a 501(c)(3) public charity the threshold is the greater of $5,000 or 2% of line 1h. Only (c)(3) and 527 organizations report names and addresses to the IRS, but every filer must keep them.

- **Export:** donor name, address, total per year net of refunds, and the per-gift ledger.

**Part VIII** [20] (V). Split each gala ticket: the fair market value goes on **line 8a** (revenue) and the gift portion on **line 1c** (contribution). Example: a $100 ticket with a $25 meal is $75 on line 1c and $25 on line 8a.

- **Data:** store FMV and gift amounts per line.

**Schedule G** [20] (V). Part II is required when fundraising-event income plus contributions on lines 1c and 8a exceed **$15,000**. Part III (gaming) has the same threshold.

- **Export:** per event, gross receipts, the contribution portion and the revenue portion.

### 2.7 FTC: deceptive fees, junk fees and fundraising

**16 CFR Part 464, in force since 2025-05-12** [23] (V).

- **Total price.** "Total price" includes every mandatory charge. It is shown more prominently than any other pricing. Before payment, the buyer is told the nature, purpose and amount of every excluded charge.
- **Who it covers.** "Business" means any entity offering goods or services, and the FAQ names "third-party platforms" [23] (V). The FTC's jurisdiction excludes true nonprofits [24] (V), but Jump is a for-profit seller and displayer of tickets.
- **Pre-checked boxes.** Charges taken through "default billing, pre-checked boxes, or opt-out provisions" can't be called optional [23] (V).
- **Donations.** The rule text doesn't mention them. The preamble says the rule "has no bearing on" the IRS substantiation and quid pro quo rules. Misrepresenting where a tip goes violates §464.3 [23] (V).
- **Enforcement.** The FTC sued StubHub under the rule on 2026-04-09 [25] (V). No stay was found.

**Product:**

- A gift line is opt-in. It starts at **$0**, with no pre-selected amount.
- The cover-fee box starts unchecked in every ticket checkout.
- The gift appears as its own named line in the total before Pay.
- Never relabel a fee as a donation.

**FTC Act §5 and charity portals** [26][73] (V). The FTC's "Online Charitable Giving Portals" guidance tells platforms to disclose:

- how much, or what percentage, reaches the charity;
- how long the transfer takes;
- who distributes the funds;
- whether donor data is shared.

Joint FTC and state actions target for-profit fundraisers, for example Cancer Fund of America and Operation Donate with Honor [26].

- **Product:** add a "Where your gift goes" disclosure on every donation surface: the charity's legal name, the net amount it receives, transfer timing, Jump's role as payment platform, and the data-sharing statement.
- Only say "100% goes to [Org]" when it is literally true, which means the donor covered processing.

**Telemarketing Sales Rule** [27] (V). It reaches for-profit callers soliciting for charities. Jump makes no calls, so it doesn't apply. Revisit if phone or IVR giving is ever added.

### 2.8 Email and SMS

**CAN-SPAM** [28] (V).

- Receipts, recurring-gift notices and failed-payment emails are **transactional**.
- Messages that "do no more than solicit charitable contributions" are not regulated.
- A gala ticket promotion **is** commercial, even from a nonprofit.
- **Product:** every marketing send from the planned spec 013 carries an unsubscribe link, a postal address and an honest subject line. Transactional donation emails carry a manage link but no marketing.

**TCPA** [29] (V).

- Texts are "calls".
- A tax-exempt nonprofit may rely on "prior express consent", not written consent, for telemarketing to cell phones.
- The no-consent exemption in §64.1200(a)(3)(iv) covers **residential landlines only**.
- Jump sends no SMS today. Text-to-give is out of scope, and would need consent records and STOP handling.

### 2.9 Payments: PCI, card-network, Nacha and Reg E rules for recurring gifts

**PCI** [30] (V). Stripe Checkout and Elements keep card data off Jump's servers, so Jump qualifies for **SAQ A**, attested annually in the Stripe Dashboard. PCI DSS v4 page-script requirements were not reviewed ‡.

**Reg E §1005.10(b)** [32] (V).

- A recurring electronic debit needs a written or similarly authenticated authorization.
- "The person that obtains the authorization shall provide a copy."
- When the payee fails to do this, "it is the third-party payee that is in violation". As merchant of record, that payee is Jump.
- Whether recurring **debit-card** gifts count as preauthorized EFTs was not confirmed ‡. Treat them as if they do.

**Card networks** [33] (V). Visa's 2020 rules for trials and promotions require express consent to the terms. Stripe recommends stating the recurring nature clearly on signup.

**Nacha** (only if ACH is turned on) [31] (V).

- WEB debits need fraud screening.
- Fraud-monitoring Phase 2 applies to every originator from **2026-06-19**.
- Stripe Checkout collects the mandate and emails the mandate copy. Under destination charges the platform is the merchant named on the mandate.

**Product (recurring):**

- An affirmative "Give $X every month until I cancel" consent, showing amount, frequency, first charge date and how to cancel.
- Store the consent as a `LegalAcceptance` with a new `RECURRING_GIFT` document.
- Email a copy of the terms immediately.
- Online cancellation that is as easy as sign-up, in the patron account and in every email.
- Notice before any amount change.
- An annual reminder.

### 2.10 Recurring gifts and automatic-renewal laws

**Federal.** The FTC click-to-cancel rule was vacated in *Custom Communications v. FTC* (8th Cir. 2025-07-08). The FTC published a new advance notice on 2026-03-13, and no rule has followed [34] (V). ROSCA covers "goods or services sold … through a negative option feature" [35] (V). No authority was found applying it to a pure gift.

**States.**

- California's automatic-renewal law (BPC §17600 ff., as amended by AB 2863 from 2025-07-01) defines a consumer as someone who acquires "goods, services, money, or credit" [36]‡.
- NC G.S. 75-41 covers a person who "sells … products or services" [36] (V).
- NY GBL §527-a is framed on goods and services [36] (V).
- No AG guidance on recurring donations was found.

**Conclusion.** A pure recurring gift is probably outside these laws ‡. A **membership** that carries benefits, such as presales or member pricing, is probably inside them.

- **Product:** build every recurring gift to the California standard (§2.9).
- Treat a future "membership" product as a subscription under these laws, not as a gift.

### 2.11 Money transmission

**FinCEN** [37] (V).

- The 31 CFR 1010.100(ff)(5)(ii)(B) exemption covers a person who "acts as a payment processor to facilitate the purchase of, or payment of a bill for, a good or service … by agreement with the creditor or seller".
- FIN-2014-R009 requires the facilitation of goods or services.
- **A gift is neither.** No FinCEN ruling on charity or crowdfunding platforms was found.

**NC G.S. 53-208.44(a)(8)** [38] (V). It exempts a bona fide agent of the payee if all three hold:

- there is a written agreement;
- the payee holds the agent out as accepting payments on its behalf;
- payment to the agent counts as payment to the payee.

Under (b), anyone relying on the exemption must ask the Commissioner to verify it in writing. The CSBS model act's agent-of-payee language is likewise limited to goods and services [38]‡.

**Stripe.** Stripe Payments Company is a licensed money transmitter [39] (V). With destination charges, though, the gift sits in Jump's balance [42] (V).

**Conclusion (Counsel).** Ticket money fits the agent-of-payee exemptions. Gift money passing through Jump's balance is the weakest point of this review.

- The cleanest fix is architectural: settle gifts on the charity's connected account through a direct charge or `on_behalf_of`.
- Put agency language in the charity agreement.
- Have counsel decide whether to file the NC verification request.

### 2.12 OFAC and anti-terrorist financing

**OFAC** [22] (V). Civil liability is strict. Jump is a US person paying out to organizations. Stripe screens every connected account and pauses payouts on a possible match, emailing the platform [43] (V).

**Treasury's charity guidelines** [22] (V) are voluntary, and they apply to the charities, not to Jump.

**Product and ops:**

- Rely on Stripe KYC and screening, plus the §2.1 verification.
- Document a runbook for sanctions holds.
- Never let an org redirect transfers away from its verified account.

### 2.13 Refunds, disputes and chargebacks

**Who pays.** Under destination charges, disputes and refunds debit **Jump's** balance. Jump recovers the money with a transfer reversal [42][47] (V).

**Likely dispute reasons on gifts** [44] (V):

- fraudulent;
- unrecognized;
- subscription canceled.

Stripe's prevention advice: a recognizable descriptor, a receipt for every charge, clear recurring consent, and prompt cancellation.

**Product:**

- Gift refunds always use `reverse_transfer: true`.
- A refund voids or corrects the receipt (§2.3).
- The charity agreement covers recovering disputed gifts.
- Watch dispute rates per org. Stripe treats rates above 0.75% as excessive [44]‡.
- `refund.failed` puts money back in the platform balance [47] (V). Record it as owed to the donor. Under NC G.S. 116B-53(c)(7), "money or credits owed to a customer as a result of a retail business transaction" become reportable unclaimed property after **3 years** [71] (V). This is rare on card refunds.

---

## 3. State

### 3.1 Charitable fundraising platform laws: California and Hawaii

**California** (Gov. Code §12599.9; 11 CCR §§314–323; AG Registry of Charities and Fundraisers) [48][49] (V for the regulation and AG page; statute text from the FindLaw mirror ‡).

| Item | Rule |
|---|---|
| Who | "Charitable fundraising platform", limb (a)(1)(E): SaaS or customizable platform that lets charities solicit or receive donations. **Regulation §314(q) "type E"**: private-labeled, under a SaaS license, donations made to the charity. |
| Exclusions | (A) a charity's own platform soliciting only for itself. (B) vendors providing technical services, including payment processing, **to a charitable fundraising platform**. (C) DAF sponsors. (D)/(E) commercial fundraiser and commercial co-venturer tie-breaks. |
| Reach | "to persons in this state". Not limited to California charities. Whether a few incidental California donors are enough is untested ‡. |
| Register | PL-1 ($625) **before** enabling solicitation. Renew with PL-2 ($625) by January 15. Annual PL-4 report by July 15; fee data may be marked confidential. |
| Good standing | Before enabling a charity and at least monthly: good standing with the IRS, Franchise Tax Board and AG. Jump may rely on published lists, including the AG's "May Not Operate or Solicit" list. |
| Consent | Written consent signed by an authorized officer before using the charity's name. The agreement covers fees, payout timing, content review and data sharing (§318). |
| Funds | Held in a **separate account**. Misuse includes commingling (§12599.9(h); §314(f)). |
| Payout | Type E: no later than **5 business days** after the donation (§320(c)(1)). |
| Reporting | To the charity, per gift: date given, date sent, gross amount, fees, net amount (§321(c)(1)). |
| Donor disclosures | Statutorily required for types A–C only. Worth showing anyway (§3.5). |
| Penalties | Up to $1,000 per act or omission; up to $10,000 with intent to deceive (Gov. Code §12591.1) [49]‡. Automatic suspension for failing to renew. |

**Would Jump be covered?** Probably yes, under (E) **(Counsel)**:

- A 0% donation fee doesn't change that.
- Neither does the charity writing its own appeal copy.
- Neither does settling gifts on the charity's account. The definition turns on "permits or otherwise enables".

Moving custody fixes the commingling problem but not registration.

**Pending legislation.** AB 576 (2025–26) would have amended the law. It reportedly died on 2026-02-02 ‡.

**Hawaii** (HRS 467B as amended by Act 205 (2024) and SB 1048 CD1 (2025); effective **2026-07-01**) [50] (V for the AG FAQ and the bill; HRS text not fetched ‡).

- **Who.** The definition expressly covers platforms that "provide charities with customizable online fundraising pages, fundraising software, or similar internet-based tools".
- **Exclusions.** The technical-vendor exclusion requires that the vendor "does not enable charitable solicitations on its own platform".
- **Reach.** The law applies to out-of-state platforms, and "even if another entity receives, processes, holds, or distributes the funds."
- **Registration.** $250, renewed by July 1. Late filing costs $20 a day, capped at $1,000.
- **Duties:**
  - good-standing checks;
  - pre-donation disclosures;
  - written consent from each charity;
  - receipts that comply with §170(f)(8);
  - a separate account;
  - prompt payout with a fee accounting;
  - records kept for 3 years.

**Other states.** No other platform-specific statute was found ‡.

**Product (both states):**

- The charity agreement carries the consent.
- A good-standing check runs before enabling a charity and monthly afterward (§2.1 verification plus the California list).
- Per-gift reporting to the charity (an Orders export with gross, fees, net and transfer date).
- Transfer at charge time, which meets the 5-business-day rule.
- A donor disclosure block (§3.5).
- `DONATIONS_GEO_BLOCK` (per state) as a fallback if counsel prefers not to register yet. Donation pages would refuse donors with California or Hawaii billing addresses.

### 3.2 Charitable solicitation registration: the nonprofit's obligation

Most states require a charity to register before soliciting their residents. The **Charleston Principles** [51] (V) are NASCO advisory guidance from 2001, and they "do not purport to state rules of law".

- **Home state.** A charity soliciting online must register in its home state.
- **Other states.** An out-of-state charity must register only if its interactive site either:
  - "specifically targets persons physically located in the state", or
  - receives gifts from the state "on a repeated and ongoing basis or a substantial basis".
- **Local charities.** A purely local charity whose site "makes clear in context that their fundraising focus is limited to that area" does not target other states.
- **Platforms (III(C)(2)).** Entities providing "solely administrative, supportive or technical services to charities without providing substantive content, or advice concerning substantive content, are not required to register". This holds unless they "actually solicit, promote a Web site". "Compensation for services based on the amount of funds raised may be a strong indication the entity is doing more than simply providing technical services."

**Shared filings.**

- The Unified Registration Statement has "limited utility today" [52] (V).
- NASCO's Single Portal appears stalled ‡.

**State table.** A ✓ in a cell means the statute was read in this pass. ‡ means the value comes from a secondary source, memory, or a fetch that failed (§8). "PFS/FC/CCV" is professional solicitor, fundraising counsel and commercial co-venturer.

| State | Statute / agency | Charity registration | Small-org exemption | Mandatory disclosure on solicitations / receipts | PFS / FC / CCV regulated | Sources |
|---|---|---|---|---|---|---|
| **NC** | G.S. 131F / Secretary of State, Charities | Yes ✓ | Under $50,000 in contributions per year **and** no paid officers, fundraisers or solicitors (131F-3(3)) ✓ | **Yes**, 9-point minimum, conspicuous (131F-9(c)) ✓. Text in §3.3 | Yes ✓ | [53] |
| **CA** | Gov. Code §12580 ff. / AG Registry | Yes (CT-1) ✓ | Narrow ‡ | No general legend ‡ | Yes, plus the **platform** law ✓ | [48][49] |
| **NY** | Exec. Law art. 7-A / AG Charities Bureau | Yes ✓‡ | Under $25,000 and no paid fundraiser (172-a(2)(d)) ✓‡ | **Yes** (174-b(1)): "upon request, a person may obtain from the organization or from the charities registry on the attorney general's website, a copy of the last financial report filed…" ✓‡ | Yes ✓‡ | [55] |
| **FL** | ch. 496 / FDACS Division of Consumer Services | Yes ✓ | Under $50,000 if volunteer-run (496.406) ✓ | **Yes** (496.411(3)), all caps: "A COPY OF THE OFFICIAL REGISTRATION AND FINANCIAL INFORMATION MAY BE OBTAINED FROM THE DIVISION OF CONSUMER SERVICES BY CALLING TOLL-FREE WITHIN THE STATE. REGISTRATION DOES NOT IMPLY ENDORSEMENT, APPROVAL, OR RECOMMENDATION BY THE STATE." Plus a toll-free number, a website and the registration number ✓ | Yes ✓ | [54] |
| **PA** | 10 P.S. §162.1 ff. / Dept. of State BCO | Yes ✓ | $25,000 or less, no paid solicitor (§6(a)(8)) ✓ | **Yes** (§13(c)), verbatim text ✓. Phone 1-800-732-0999 ‡ | Yes ✓ | [56][61] |
| **TX** | No general charity act; Occ. Code ch. 1803 covers public-safety groups only | No (general) ‡ | n/a | No ‡ | Limited ‡ | §8 |
| **IL** | 225 ILCS 460 / AG | Yes ‡ | $25,000 / volunteer ‡ | No ‡ | Yes ‡ | §8 |
| **HI** | HRS 467B / AG Tax & Charities | Yes ‡ | ‡ | ‡ | Yes, plus the **platform** law ✓ | [50] |
| **VA** | Code §57-48 ff. / VDACS | Yes ✓ | $5,000 or less and all-volunteer (§57-60) ✓ | Yes ‡ | Yes ‡ | [60][61] |
| **GA** | O.C.G.A. 43-17 / Secretary of State | Yes ‡ | $25,000 ‡ | Yes ‡ | Yes ‡ | §8 |
| **MA** | G.L. c.68 §19 ff. / AG | Yes ✓ | §20 ‡ | No ‡ | Yes ‡ | §8 |
| **NJ** | N.J.S.A. 45:17A-18 ff. / Consumer Affairs | Yes ‡ | $10,000 ‡ | Yes ‡ | Yes ‡ | [61] |
| **OH** | ORC 1716 / AG | Yes ✓ | $25,000 or less, no paid solicitor (1716.03) ✓ | No ‡ | Yes ‡ | [58] |
| **MI** | MCL 400.271 ff. / AG | Yes ‡ | $25,000 ‡ | ‡ | Yes ‡ | §8 |
| **WA** | RCW 19.09 / Secretary of State | Yes (19.09.065) ✓ | ‡ (the old 19.09.076 exemption was repealed) | Yes ‡ | Yes ✓/‡ | [61] |
| **MD** | Bus. Reg. §6-101 ff. / Secretary of State | Yes ‡ | $25,000 ‡ | Yes ‡ | Yes ‡ | [61] |
| **MN** | §309.50 ff. / AG | Yes ✓ | $25,000 or less, volunteer-run (309.515) ✓ | No ‡ | Yes ‡ | [59] |
| **CO** | C.R.S. 6-16 / Secretary of State | Yes ‡ | None ‡ | No ‡ | Paid solicitor ‡ | §8 |
| **SC / TN** | §33-56 / §48-101-501 | Yes ‡ | $20,000 / $50,000 ‡ | No ‡ | Yes ‡ | §8 |
| **MS / WV** | Secretary of State | Yes ‡ | ‡ | Yes ‡ | ‡ | [61] |
| No general registration ‡ | DE, ID, IN, IA, MT, NE, SD, TX, VT, WY | — | — | — | — | §8 |

**Conclusion.** Registration is **the nonprofit's** obligation. Jump states this in onboarding and the organizer terms and does not file for the charity.

**What Jump gives the charity:**

- **A per-org "State disclosures" setting.** Prefilled legends for NC, FL, NY, PA, VA, WA, NJ, MD, MS and WV, each with a configurable phone number or registration number. Rendered on the donation page, the gift step, confirmations, receipts and recurring reminders.
- **A "local focus" sentence** the org can switch on, for the Charleston local-charity position.
- **Gifts by donor state** in the export, so the charity can watch where it may need to register.

**What Jump avoids:** marketing any charity's page to out-of-state donors itself. That would be "promote a Web site" under III(C)(2).

### 3.3 North Carolina in depth (G.S. 131F)

**License (131F-5)** [53] (V). Any charity or sponsor that "intends to solicit contributions in this State" needs a license unless 131F-3 exempts it.

- **Renewal.** Annual, due on the 15th day of the fifth month after the fiscal year ends.
- **Fees (131F-8).** $0 below $5,000 in contributions; $50 below $100,000; $100 below $200,000; $200 above that.

**Exemptions (131F-3)** [53] (V). The main one, (3), covers an organization with less than **$50,000** in contributions a year **and** no paid officer, fundraiser or solicitor. Others cover religious institutions, government, accredited schools and their foundations, hospitals and their foundations, VFD and EMS, YMCA/YWCA, and more.

**Disclosure legend (131F-9(c), as amended by S.L. 2025-25)** [53] (V, current text read 2026-10-08). It goes on **"every printed solicitation, written confirmation, receipt, or reminder of a contribution"**, in a minimum 9-point type, made conspicuous by underlining, a border or bold:

> "Financial information about this organization and a copy of its license are available from the State Solicitation Licensing Branch at [telephone number]. The license is not an endorsement by the State."

- **Phone number.** The statute says "Branch" and leaves the number as a placeholder. The SOS Charities page lists **919-814-5280** and 1-888-830-4989. Older material cites 919-814-5400 [53]‡. Store the number in a setting, never hard-coded.

**Point-of-solicitation disclosures (131F-9(b))** [53] (V):

- the charity's name and principal state;
- the purpose of the solicitation;
- on request: a contact, the deductible amount, and a financial statement within 14 days.

**Jump's own exposure (Counsel)** [53] (V).

- **Fund-raising consultant.** Requires a fixed fee, no soliciting, **and** no custody or control of contributions. As merchant of record Jump fails the custody test.
- **Solicitor.** Anyone paid who "plans, conducts, manages, consults, whether directly or indirectly, in connection with the solicitation". Requirements:
  - a $200 license;
  - a $20,000–$50,000 bond;
  - deposit of gifts within 2 days into an account only the charity can withdraw from.
- **No exclusion.** The statute has no software or payment-processor exclusion.
- **Penalties.** Up to $10,000 per violation (civil); up to $1,000 per act (administrative); willful violation is a Class 1 misdemeanor.

**Jump's best position:**

- Charleston III(C)(2): technical services only.
- The charity writes all content.
- 0% on gifts, so pay is not tied to funds raised.
- No promotion by Jump.
- **Gifts settled on the charity's account**, which removes custody.

**Ask counsel, or NC SOS directly:** does Jump need any 131F license? Ask with the final charge model in hand.

**Commercial co-venturer (131F-18).** A for-profit organizer that advertises "proceeds benefit [charity]" is a co-venturer. It needs written consent from the charity and must give an accounting on request.

- **Product:** donation features only for verified charities giving **to themselves**. A non-charity organizer can't take gifts for a third party.

**First customer (Raleigh).** They need their own NC license unless they are under $50,000 and all-volunteer.

- **Product:** onboarding asks for the NC license number or an exemption, and the legend is on by default for NC organizations.

### 3.4 Professional fundraiser, fundraising counsel and commercial co-venturer: the pattern

**The pattern across NY, FL, PA and NC** [53][54][55][56] (V):

- "Counsel" or "consultant" status requires **no custody** and **no soliciting**.
- "Solicitor" or "professional fundraiser" is the catch-all for anyone paid who "plans, manages, conducts, … or assists". New York's definition is the broadest.
- None of those four statutes excludes software platforms. New York excludes only printing and mailing by people who never receive or have access to contributions (§171-a(10)) [55]‡.

**NASCO's guidance to platforms** (via the Colorado SOS) [57] (V). Platforms "may be classified as an unregulated vendor, or a moderately regulated commercial co-venturer or professional fundraising consultant, or a more actively regulated paid solicitor/commercial fundraiser". It tells them to:

- get written approval from each charity before collecting funds for it;
- disclose vetting, payout timing, fees and privacy;
- remove a charity on request.

**What keeps Jump a vendor:**

- the charity controls all content;
- flat fees, not a share of gifts;
- no promotion by Jump;
- **no custody**.

### 3.5 Donor-facing disclosures (combining FTC, California, Hawaii and NASCO)

One "About this gift" block, shown on the donation page and in the gift step, and summarized on the receipt [26][48][50][57]:

1. **The recipient.** The charity's legal name and EIN. "Your gift is made to [Legal Name], not to Eventimus."
2. **Deductibility.** The status from §2.1: deductible, or the §6113 sentence.
3. **Fees.** Jump's fee on the gift (0%) and the processing amount. Whether the charity receives the full amount depends on the cover-fee choice.
4. **Timing.** The gift reaches the charity's Stripe account at charge time. Payout to its bank follows its Stripe schedule.
5. **Data.** What Jump shares with the charity (everything, as its processor). Jump never sells donor data.
6. **State legends** from §3.2.
7. **Refunds.** Who to contact about refunds and how to do it.

### 3.6 Sales tax

**NC admissions.** The general rate applies to admission charges (G.S. 105-164.4(a)(10)), including service and processing fees (105-164.3) [62] (V).

**Exemptions in 105-164.4G(f)** [62] (V):

- **"a donation that is deductible as a charitable contribution under section 170"**, and the deductible part of a membership charge;
- separately stated amenities;
- school events;
- an event **sponsored solely by an exempt nonprofit**, if all three hold:
  - all proceeds go to its purposes;
  - no private inurement;
  - it **compensates no one** for participating in, performing at or producing the event. Paying a band or DJ breaks this.

The general nonprofit fundraising exemption in 105-164.13(35) **does not** cover admissions [62] (V).

- **Sourcing and rate.** Admissions are sourced to the place of entry. Wake County is **7.25%** [62] (V).
- **NC conclusions:**
  - A voluntary checkout gift is not taxable.
  - The FMV part of a gala ticket is taxable unless the sole-sponsor exemption applies.
  - The separately stated deductible part is arguably exempt as a §170 donation ‡. NCDOR gives no worked example.

**Other states.**

- **California.** "True donations are not taxable" (CDTFA Pub 18) [63] (V).
- **Texas.** Gifts are not taxable sales unless a taxable item of equal value is given back. Nonprofit-provided amusement services are exempt if every ticket shows the nonprofit as sole provider [64] (V).
- **New York.**
  - An exempt organization's admissions are exempt if all proceeds benefit it.
  - A "suggested donation" does "not, in and of itself" make a charge nontaxable.
  - Only "completely voluntary" amounts, chosen by the donor, are exempt (TSB-A-14(4)S) [65] (V).

**Product:**

- The donation line is `taxable: false`, always optional, and the donor picks the amount. A required "donation" for entry is a ticket tier, never a gift.
- Gala tiers carry `fairMarketValue`. Tax applies to the FMV part. The deductible part is a separate nontaxable line on the receipt, pending a per-state counsel or accountant decision (§7).
- A per-event "nonprofit sole-sponsor exemption" switch, set by the org. It drops admission tax to 0 for that event where the region allows it, and stores who set it and when. This is a spec 009 extension.
- If gifts are ever sent to Stripe Tax: `tax_code: 'txcd_90000001'` (Cash Donation) [46] (V). Today's `taxable: false` path never sends them, which is fine.
- **A separate spec 009 issue, not about donations:**
  - NC's admission-facilitator rules make the **venue operator** the retailer by default. A facilitator remits to it within 10 days of month end unless a dual-remittance contract says otherwise [62] (V).
  - Jump remits as merchant of record today. Counsel and the accountant should confirm that Jump's model fits (spec 023 Q14).

### 3.7 Privacy

**CCPA/CPRA** [66] (V).

- It applies to for-profit "businesses" above any one of these thresholds:
  - **$26,625,000** in revenue (2025 adjustment);
  - 100,000 consumers;
  - 50% of revenue from selling or sharing personal data.
- Nonprofits are generally outside it.
- Jump is probably below the thresholds today ‡ (spec 023 Q17).

**State laws that do cover nonprofits** [67][68][69][70]:

| State | Nonprofits covered | Threshold | Status |
|---|---|---|---|
| Oregon | from 2025-07-01 | 100,000 consumers | (V). Donor-list exchanges may be "sales" |
| Delaware | yes, 501(c)(3)/(4)/(6)/(12) | 35,000 consumers; reportedly 10,000 from 2027 | (V); the 2027 change ‡ |
| Minnesota | yes, from 2025-07-31 | 100,000 consumers | (V) |
| Maryland | yes | 35,000 consumers | (V) |
| Colorado | yes | — | ‡ |
| New Jersey | yes | — | ‡ |
| North Carolina | **no comprehensive law** | — | bills in committee ‡ |

A Raleigh nonprofit won't reach these thresholds soon. Payment-only data is excluded in Delaware, Minnesota and Maryland.

**Roles.** The nonprofit is the controller. **Jump is its processor.** Processor contracts must set out instructions, the nature and purpose of processing, data types, duration, and both sides' rights (e.g. Del. §12D-107(b)) [68] (V).

**Donor lists.** No general state law bans charities from selling donor lists ‡. The AFP Donor Bill of Rights (non-binding) gives donors the right to be removed from lists the charity intends to share [72]‡.

**Product:**

- A DPA in the organizer terms (spec 023 §5.4) with CO, OR, DE, MN and MD processor terms.
- A contractual promise that Jump never sells or shares donor data.
- Donor data covered by `BuyerDataExportService` and `ContactErasureService`. Erasure anonymizes the contact but keeps the gift ledger and receipts, because financial records are kept (spec 023 §8.4).
- The charity's own privacy-policy URL on the donation page.

### 3.8 Unclaimed property (brief)

See §2.13. A refund that fails comes back to Jump's balance. Record it as owed to the donor, and report it to the NC unclaimed property program after 3 years [71] (V). Rare.

---

## 4. Platform obligations for Jump: Stripe and the charge model

**Restricted business** [40] (V, list updated 2026-09-22). "Fundraising conducted by nonprofits, charities", "crowdfunding platforms" and "organizations fundraising for a charitable purpose" all need Stripe's due diligence and approval, "specific to each service offer". Prohibited: "Processing where there is no bona fide good or service sold, or donation accepted."

**Stripe's donation requirements** [41]‡. Gifts must be "tied to a specific charitable purpose" and "used for the charitable purpose described to the donor". Also: "You may not accept donations on behalf of someone other than yourself." The FAQ adds that merchants fundraising "on an approved crowdfunding platform using Stripe Connect" need no extra approval [40] (V). So the route is for **Jump to become an approved platform**.

**Charge types** [42] (V).

- Without `on_behalf_of`, the platform is the business of record. It pays Stripe's fees, carries disputes, and its descriptor appears on the statement.
- `on_behalf_of` makes the connected account the settlement merchant, with its own descriptor.
- Direct charges create the payment on the connected account itself.

**Options for gift lines (decision in plan D0):**

| Option | Custody | Merchant on statement | Ticket + gift in one payment | Tax model (spec 009) | Fit with §2.11 / §3.1 / §3.3 / Stripe |
|---|---|---|---|---|---|
| A. Today: destination charge, no `on_behalf_of` | Jump's balance | Jump | Yes | Unchanged | Weakest. Needs Stripe approval, and counsel on money transmission and NC solicitor status. Commingling under California law |
| B. Destination charge **with** `on_behalf_of` | Platform flow; the connected account is settlement merchant | Charity | Yes, but then the **ticket** also settles under the charity | Ticket merchant flips to the charity, so the seller of record changes | Better on Stripe's "on behalf of" rule and the descriptor. Custody facts only partly improved ‡ |
| C. **Direct charge** on the charity's account, with `application_fee_amount` for covered processing | The charity | Charity | Needs a **separate payment** for the gift, or the whole order goes direct | Ticket stays on the platform if the payments are split | Strongest: no custody, the charity is merchant, Stripe's nonprofit rate becomes reachable (spec 010 §11.1) |

**Recommendation:**

- **Donate-only orders** use C, or B, behind a per-org flag.
- **Ticket checkout + gift** needs one of:
  - (i) a second payment for the gift (two Checkout steps: worse conversion, cleanest law);
  - (ii) B for the whole order, if the charity is the venue operator or seller anyway;
  - (iii) A, only with Stripe's written approval and counsel's sign-off.

Decide this with Stripe and counsel before D1 starts.

**Under any option:**

- The receipt names the charity as donee. The card statement under option A won't.
- Gift refunds use `reverse_transfer`.
- Jump files 1099-Ks for Express accounts (§2.5).
- SAQ A attestation (§2.9).
- OFAC holds runbook (§2.12).

**Stripe's nonprofit pricing** [45] (V). The charity needs at least 80% of volume to be tax-deductible donations, applies through a support form, and the discount works on **its own** account. That is reachable only under option C. The Connect interaction isn't stated ‡.

---

## 5. Requirement map: obligation → product

**Legend:** **R** receipt field or text · **D** disclosure on page or checkout · **F** flag or setting · **Rec** record kept · **X** export · **Ops** process or contract.

| # | Obligation | Source § | Product requirement | Kind |
|---|---|---|---|---|
| 1 | Only 170(c) donees may say "deductible" | 2.1 | `Organization.deductibilityStatus` + evidence + `verifiedAt/By`; monthly revocation re-check; deductibility wording gated on `DEDUCTIBLE_170C` | F, Rec, Ops |
| 2 | §6113 notice for exempt orgs that aren't 170(c) | 2.2 | Safe-harbour sentence in its own paragraph on pages, gift step and receipts when `EXEMPT_NOT_DEDUCTIBLE` | D, R |
| 3 | $250+ acknowledgment | 2.3 | Every gift receipt: charity legal name, EIN, date, amount, goods/services statement or FMV, "keep for your tax records"; sent immediately; no SSN | R |
| 4 | Gifts under $250 need name, date, amount | 2.3 | Same receipt for every gift; recurring gifts get one receipt per charge | R |
| 5 | Annual summary allowed and expected | 2.3 | Annual giving statement per Contact by January 31; resend on request | R, X |
| 6 | Quid pro quo >$75 | 2.4 | `PriceTier.fairMarketValue`; the receipt **and the tier's sale page** state the deductible amount and the good-faith FMV when price > $75 | F, D, R |
| 7 | Insubstantial benefits | 2.4 | Per-tier "benefits are token" switch, valid only within the current Rev. Proc. limits (thresholds in config by tax year: 2026 $13.90 / $139 / $69.50); FMV 0 when on | F |
| 8 | Unused tickets | 2.4 | "Give without attending" option on gala events | D |
| 9 | Refunds void receipts | 2.3, 2.13 | `GiftReceipt` with `voidedAt` and `supersedesId`; corrected email; exports net of refunds | Rec, R |
| 10 | 990 Schedule B / Part VIII / Schedule G | 2.6 | Gift CSV: donor name, address, email, date, amount, FMV, deductible, campaign/event, refund state; per-donor yearly totals; per-event gross / contribution / revenue | X |
| 11 | 1099-K | 2.5 | W-9/TIN on connected accounts; Stripe 1099 product enabled for the platform; launch-checklist item | Ops |
| 12 | FTC fees rule | 2.7 | Gift and cover-fee start at $0 and unchecked in ticket checkout; gift shown as a named line before Pay; never call a fee a "donation" | D |
| 13 | FTC portal guidance + AB 488 + HI + NASCO | 2.7, 3.5 | "About this gift" block (§3.5) on page and gift step; summarized on receipt | D, R |
| 14 | Recurring authorization (Reg E, card networks, state renewal-law best practice) | 2.9, 2.10 | Affirmative recurring consent with terms; `LegalAcceptance` document `RECURRING_GIFT`; terms copy emailed; self-serve cancel; change notice; annual reminder | D, Rec, R |
| 15 | CAN-SPAM | 2.8 | Gift emails transactional with a manage link; marketing sends (spec 013) get unsubscribe + postal address | R |
| 16 | California AB 488 / Hawaii 467B | 3.1 | Registration (Ops) **or** `DONATIONS_GEO_BLOCK` by donor billing state; charity consent captured; good-standing check before enabling and monthly; per-gift charity report; transfer at charge time | Ops, F, Rec, X |
| 17 | State solicitation legends | 3.2, 3.3 | Per-org "State disclosures" with prefilled NC/FL/NY/PA/VA/WA/NJ/MD/MS/WV legends and editable phone or registration numbers; ≥9pt and bold on receipts; NC on by default for NC orgs | F, D, R |
| 18 | Charity registration is the org's job | 3.2 | Onboarding asks for state license numbers or exemption; organizer terms say registration is the org's responsibility; gifts-by-state export | Ops, X |
| 19 | NC solicitor / custody; FinCEN; NC MTA; Stripe "on behalf of" | 2.11, 3.3, 4 | Gift charge model (§4 table), decided in D0; agency clause in the charity agreement | Ops, F |
| 20 | Co-venturer | 3.3, 3.4 | Gifts only to the selling org itself; no "proceeds benefit X" claims by non-charity organizers | F |
| 21 | Stripe restricted business | 4 | Written Stripe approval before `DONATIONS_ENABLED` in production | Ops |
| 22 | Sales tax | 3.6 | Gift `taxable: false`, always optional; gala split; per-event NC sole-sponsor exemption switch; fix `txcd_20060057` | F, R |
| 23 | Privacy | 3.7 | DPA; no sale or sharing; export and erasure cover gifts; charity privacy URL on the page | Ops, D |
| 24 | OFAC | 2.12 | Rely on Stripe screening; sanctions-hold runbook | Ops |
| 25 | Disputes / refunds | 2.13 | `reverse_transfer`; dispute-recovery clause; per-org dispute-rate alert; `refund.failed` → owed-to-donor state | Ops, Rec |
| 26 | DAF | 2.4 | DAF grants can't buy tickets; any future DAF button gives the gift only | F |

**Proposed records.** New fields beyond those in the platforms doc's data model:

- **`Organization`:** `deductibilityStatus`, `deductibilityEvidence` (JSON: source, Pub 78 code, document file id), `deductibilityVerifiedAt`, `deductibilityVerifiedById`, `legalName`, `stateDisclosures` (JSON by state: enabled, phone or registration number, custom text), `privacyPolicyUrl`, `donationAgreementAcceptanceId` (a `LegalAcceptance` with a new `DONATION_TERMS` document).
- **`LegalDocument` additions:** `DONATION_TERMS` (charity agreement annex) and `RECURRING_GIFT` (donor authorization).
- **`GiftReceipt`** (append-only): `orderId`, `orderItemId?`, `contactId`, `organizationId`, `number`, `issuedAt`, `amount`, `fairMarketValue`, `deductibleAmount`, `goodsServicesText`, `orgSnapshot` (legal name, EIN, deductibility status, legends as shown), `kind` (`SINGLE` | `ANNUAL`), `voidedAt?`, `supersedesId?`, `emailedAt`.
  - Receipts must be reproducible as sent, so the snapshot is stored, not recomputed.

---

## 6. Launch blockers

| # | Blocker | Owner | Unblocked by |
|---|---|---|---|
| L1 | Stripe approval for fundraising on the platform + agreed gift charge type | owner + Stripe | Written approval in the launch checklist |
| L2 | California AB 488 / Hawaii 467B | counsel + owner | Registration filed **or** a counsel memo backing the `DONATIONS_GEO_BLOCK` position |
| L3 | NC solicitor / fund-raising consultant status and money transmission for the chosen charge model | counsel | Counsel memo; optional NC SOS inquiry |
| L4 | Deductibility verification process | engineering + ops | §5 #1 shipped; SYSTEM_ADMIN runbook |
| L5 | Receipt, annual statement, §6113, quid pro quo and "About this gift" wording | counsel | Text in `frontend/content/legal/` or templates, with versions |
| L6 | Charity agreement (donation annex: consent, agency, data, payout, disputes, registration responsibility) | counsel | `DONATION_TERMS` version published |
| L7 | 1099-K filing for Express accounts | owner + accountant | Stripe 1099 product enabled; also blocks `STRIPE_CONNECT_ENABLED` |
| L8 | Spec 023 phase 1 (Terms, Privacy, Organizer Terms) | counsel | Already a go-live blocker |

---

## 7. Counsel-only questions

These can't be settled by engineering. Add them to the spec 023 counsel card.

1. **AB 488 / HRS 467B:** is Jump a type-E platform? If so, register before the first California or Hawaii donor, or geofence? Does settling gifts on the charity's account change anything?
2. **NC 131F:** is Jump a "solicitor" or "fund-raising consultant" under each charge option? Should Jump ask NC SOS?
3. **Money transmission:** under option A, do the FinCEN and NC agent-of-payee exemptions reach gifts? Should Jump file the NC 53-208.44(b) verification request?
4. **Agent-issued acknowledgments:** may Jump issue §170(f)(8) acknowledgments in the charity's name? What authority must the charity agreement grant?
5. **Receipt and disclosure wording:** the gift receipt, annual statement, §6113 sentence, quid pro quo statement and "About this gift" block.
6. **Gala split and sales tax:** is the deductible part of a gala ticket exempt in NC under 105-164.4G(f)? Per-state treatment? Who carries the risk of the org's FMV estimate?
7. **NC admission facilitator vs retailer:** spec 009 Q, raised by this research.
8. **Membership products:** confirm they fall under the renewal laws, and what that requires.
9. **Refunds of receipted gifts:** the corrected-acknowledgment practice.
10. **1099-K:** card vs third-party-network treatment of Jump's payouts; exempt-payee handling (accountant).
11. **Dispute recovery:** may Jump reverse transfers for gifts the charity has already spent? What does the charity agreement say?
12. **Privacy:** the controller/processor framing for donor data (extends spec 023 Q7).

---

## 8. Not verified

- **Statute text from mirrors or AG summaries:**
  - California Gov. Code §§12599.9 and 12591.1 and BPC §17601 came from FindLaw; leginfo returned 403.
  - Hawaii HRS 467B text was not fetched; the definitions are quoted from the AG FAQ.
  - NY Exec. Law and GBL §527: nysenate.gov returned 403; values come from the research agent's read of mirror text.
- **California scope:** whether California covers a platform whose California donors are only incidental. AB 576's death on 2026-02-02 comes from a secondary source.
- **NC 131F-9:** what S.L. 2025-25 changed, and which phone number is current (5280 or 5400).
- **State table cells marked ‡:** the IL site failed a TLS check, GA returned 403, TX returned 402, some sections were not fetched, and some legend wording comes from The Nature Conservancy's compiled page [61]. The no-registration state list is from memory.
- **Single Portal:** current status.
- **Stripe's donation-requirements quote** [41]: fetched twice by WebFetch; curl returned no body.
- **Stripe's nonprofit rate:** the rate and how it works with Connect.
- **Stripe Services Agreement and Connected Account Agreement** clauses on donations were not read.
- **§6113 for web and email** is an inference from the print rules.
- **No-authority gaps:**
  - no authority on agent-issued acknowledgments;
  - none on refunded-gift handling (§111 not fetched);
  - charity receipts to individual DAF advisors: inferred.
- **Reg E and debit cards:** whether recurring debit-card gifts are preauthorized EFTs.
- **Renewal laws:** whether any of them reaches pure recurring gifts. No authority either way. VA, CO and IL renewal laws were not checked.
- **MTMA text:** read from an excerpt. NC's MTMA adoption was not confirmed.
- **Privacy laws:** Colorado and New Jersey statutes and Delaware HB 380 were not read. NC privacy bill status comes from secondary sources.
- **Out of scope:** PCI DSS v4 script requirements, carrier text-to-give, employer matching and Pub 1828 were not researched.
- **Dispute rate:** the 0.75% "excessive" figure comes from the research agent's reading of Stripe docs and was not re-checked.

---

## Sources (accessed 2026-10-08)

1. 26 U.S.C. §170 — https://www.law.cornell.edu/uscode/text/26/170
2. IRS Tax Exempt Organization Search bulk data downloads (Pub 78, revocations, 990-N) — https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads
3. IRS TEOS deductibility status codes — https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-deductibility-status-codes
4. IRS EO Business Master File extract — https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf
5. IRS churches, integrated auxiliaries and conventions — https://www.irs.gov/charities-non-profits/churches-integrated-auxiliaries-and-conventions-or-associations-of-churches
6. 26 U.S.C. §6113 — https://www.law.cornell.edu/uscode/text/26/6113 ; Notice 88-120 — https://www.irs.gov/charities-non-profits/notice-88-120-1988-2-cb-454 ; IRS solicitation notice — https://irs.gov/charities-non-profits/solicitation-notice
7. 26 U.S.C. §6710 — https://www.law.cornell.edu/uscode/text/26/6710
8. IRS Publication 1771 (Rev. 11-2023) — https://www.irs.gov/pub/irs-pdf/p1771.pdf ; IRS written acknowledgments — https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments
9. Treas. Reg. §1.170A-13 — https://www.law.cornell.edu/cfr/text/26/1.170A-13
10. 26 U.S.C. §6115 — https://www.law.cornell.edu/uscode/text/26/6115 ; Treas. Reg. §1.6115-1 — https://www.law.cornell.edu/cfr/text/26/1.6115-1 ; IRS quid pro quo — https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-quid-pro-quo-contributions
11. 26 U.S.C. §6714 — https://www.law.cornell.edu/uscode/text/26/6714
12. Rev. Rul. 67-246 — https://www.irs.gov/pub/irs-tege/rr_67_246.pdf
13. Rev. Proc. 2025-32 (tax year 2026) — https://www.irs.gov/pub/irs-drop/rp-25-32.pdf ; Rev. Proc. 2024-40 (2025) — https://www.irs.gov/pub/irs-drop/rp-24-40.pdf
14. IRS Publication 526 — https://www.irs.gov/publications/p526 ; Treas. Reg. §1.170A-1 — https://www.law.cornell.edu/cfr/text/26/1.170A-1
15. Instructions for Forms W-2G and 5754 (Rev. 01/2026) — https://www.irs.gov/instructions/iw2g ; Publication 3079 — https://www.irs.gov/pub/irs-pdf/p3079.pdf
16. IRS: new and enhanced deductions (OBBBA) — https://www.irs.gov/newsroom/new-and-enhanced-deductions-for-individuals ; OBBB provisions — http://irs.gov/newsroom/one-big-beautiful-bill-provisions
17. IRS FS 2025-08, 1099-K threshold reverts to $20,000 — https://www.irs.gov/newsroom/irs-issues-faqs-on-form-1099-k-threshold-under-the-one-big-beautiful-bill-dollar-limit-reverts-to-20000 ; 1099-K FAQs — https://www.irs.gov/newsroom/form-1099-k-faqs-general-information ; Treas. Reg. §1.6050W-1 — https://www.law.cornell.edu/cfr/text/26/1.6050W-1
18. Stripe Connect tax reporting (1099) — https://docs.stripe.com/connect/tax-reporting
19. Instructions for Schedule B (Form 990) — https://www.irs.gov/instructions/i990sb
20. Instructions for Form 990 — https://www.irs.gov/instructions/i990 ; Instructions for Schedule G — https://www.irs.gov/instructions/i990sg ; 990-series filing thresholds — https://www.irs.gov/charities-non-profits/form-990-series-which-forms-do-exempt-organizations-file-filing-phase-in
21. 26 U.S.C. §4967 — https://www.law.cornell.edu/uscode/text/26/4967 ; Notice 2017-73 — https://www.irs.gov/pub/irs-drop/n-17-73.pdf
22. OFAC Framework for Compliance Commitments — https://ofac.treasury.gov/media/16331/download?inline= ; OFAC enforcement guidelines, 31 CFR 501 App. A — https://www.law.cornell.edu/cfr/text/31/appendix-A_to_part_501 ; Treasury Anti-Terrorist Financing Guidelines for U.S.-Based Charities — https://home.treasury.gov/system/files/136/archive-documents/0929-finalrevised.pdf
23. 16 CFR §464.1 — https://www.law.cornell.edu/cfr/text/16/464.1 ; §464.2 — https://www.law.cornell.edu/cfr/text/16/464.2 ; FTC fees rule FAQ — https://www.ftc.gov/business-guidance/resources/rule-unfair-or-deceptive-fees-frequently-asked-questions ; final rule and statement of basis — https://www.ftc.gov/system/files/ftc_gov/pdf/r207011_udf_rule_2024_final_0.pdf ; effective-date release — https://www.ftc.gov/news-events/news/press-releases/2025/05/ftc-rule-unfair-or-deceptive-fees-take-effect-may-12-2025
24. 15 U.S.C. §44 — https://www.law.cornell.edu/uscode/text/15/44
25. FTC v. StubHub complaint (S.D.N.Y. 1:26-cv-02924) — https://www.ftc.gov/system/files/ftc_gov/pdf/StubHub-Complaint.pdf
26. FTC: Online Charitable Giving Portals — https://www.ftc.gov/business-guidance/resources/online-charitable-giving-portals ; Cancer Fund case — https://www.ftc.gov/news-events/news/press-releases/2015/05/ftc-all-50-states-dc-charge-four-cancer-charities-bilking-over-187-million-consumers ; Operation Donate with Honor — https://www.ftc.gov/news-events/news/press-releases/2018/07/ftc-states-combat-fraudulent-charities-falsely-claim-help-veterans-servicemembers
27. 16 CFR §310.3 — https://www.law.cornell.edu/cfr/text/16/310.3 ; §310.4 — https://www.law.cornell.edu/cfr/text/16/310.4
28. FTC CAN-SPAM compliance guide — https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business ; 73 FR (2008-05-21) — https://www.federalregister.gov/documents/2008/05/21/E8-11394/definitions-and-implementation-under-the-can-spam-act
29. 47 CFR §64.1200 — https://www.law.cornell.edu/cfr/text/47/64.1200
30. Stripe PCI guide — https://stripe.com/guides/pci-compliance ; Stripe integration security guide — https://docs.stripe.com/security/guide
31. Nacha WEB debit fraud detection — https://www.nacha.org/rules/supplementing-fraud-detection-standards-web-debits ; Fraud monitoring phase 2 — https://www.nacha.org/rules/risk-management-topics-fraud-monitoring-phase-2 ; Stripe ACH Direct Debit — https://docs.stripe.com/payments/ach-direct-debit
32. CFPB Regulation E §1005.10 and official interpretation — https://www.consumerfinance.gov/rules-policy/regulations/1005/10/
33. Stripe: 2020 Visa trial and subscription requirements FAQ — https://support.stripe.com/questions/2020-visa-trial-subscription-requirement-changes-faq
34. *Custom Communications, Inc. v. FTC*, No. 24-3137 (8th Cir. July 8, 2025) — https://ecf.ca8.uscourts.gov/opndir/25/07/243137P.pdf ; ANPRM, 2026-03-13 — https://www.federalregister.gov/documents/2026/03/13/2026-04952/rule-concerning-the-use-of-prenotification-negative-option-plans
35. 15 U.S.C. §8403 (ROSCA) — https://www.law.cornell.edu/uscode/text/15/8403
36. Cal. Bus. & Prof. Code §17601 ‡ (FindLaw mirror) — https://codes.findlaw.com/ca/business-and-professions-code/bpc-sect-17601/ ; N.C. G.S. 75-41 — https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_75/GS_75-41.html ; N.Y. GBL §527-a — https://www.nysenate.gov/legislation/laws/GBS/527-A
37. 31 CFR §1010.100 — https://www.law.cornell.edu/cfr/text/31/1010.100 ; FinCEN FIN-2014-R009 — https://www.fincen.gov/sites/default/files/administrative_ruling/FIN-2014-R009.pdf
38. N.C. G.S. 53-208.44 — https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_53/GS_53-208.44.html ; CSBS Money Transmission Modernization Act ‡ — https://www.csbs.org/sites/default/files/2023-02/CSBS%20Money%20Transmission%20Modernization%20Act.pdf
39. Stripe Payments Company licenses — https://stripe.com/legal/spc/licenses
40. Stripe restricted businesses — https://stripe.com/legal/restricted-businesses ; Stripe prohibited and restricted businesses FAQ — https://support.stripe.com/questions/prohibited-and-restricted-businesses-list-faqs
41. Stripe: requirements for accepting tips or donations ‡ — https://support.stripe.com/questions/requirements-for-accepting-tips-or-donations
42. Stripe Connect charge types — https://docs.stripe.com/connect/charges ; destination charges — https://docs.stripe.com/connect/destination-charges
43. Stripe Connect risk management best practices — https://docs.stripe.com/connect/risk-management/best-practices
44. Stripe dispute categories — https://docs.stripe.com/disputes/categories
45. Stripe nonprofit fee discount — https://support.stripe.com/questions/fee-discount-for-nonprofit-organizations
46. Stripe Tax product tax codes — https://docs.stripe.com/tax/tax-codes ; custom integration — https://docs.stripe.com/tax/custom
47. Stripe refunds — https://docs.stripe.com/refunds
48. California AG: charitable fundraising platforms and platform charities — https://oag.ca.gov/charities/pl ; 11 CCR §§314–323 — https://oag.ca.gov/system/files/media/Cal-Code-Regs-titl-11-secs-314-323.pdf ; PL-1 definitions — https://oag.ca.gov/system/files/media/PL-1Definitions.pdf
49. Cal. Gov. Code §12599.9 ‡ (FindLaw mirror) — https://codes.findlaw.com/ca/government-code/gov-sect-12599-9/ ; §12591.1 ‡ — https://codes.findlaw.com/ca/government-code/gov-sect-12591-1/ ; AB 576 status ‡ — https://calmatters.digitaldemocracy.org/bills/ca_202520260ab576
50. Hawaii AG FAQ: charitable fundraising platforms and platform charities — https://charity.ehawaii.gov/charity/static/FAQs-CFPs-and-Platform-Charities.pdf ; SB 1048 CD1 (2025) — https://data.capitol.hawaii.gov/sessions/session2025/bills/SB1048_CD1_.pdf
51. NASCO Charleston Principles (2001) — https://static1.squarespace.com/static/682e13ebf6c80409236c7bdd/t/68cc0e47921dfc31da8ccdd3/1758203463356/Charleston-Principles.pdf ; NASCO history — https://www.nasconet.org/history
52. Multi-State Filer Project (URS) — https://multistatefiling.org/
53. N.C. G.S. Chapter 131F — https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_131F.html ; §131F-9 — https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_131F/GS_131F-9.html ; NC SOS Charities — https://www.sosnc.gov/divisions/charities ; licensing requirements — https://www.sosnc.gov/divisions/charities/licensing_requirements
54. Fla. Stat. ch. 496 (2025) — https://www.flsenate.gov/Laws/Statutes/2025/Chapter496/All
55. N.Y. Exec. Law §§171-a, 172-a, 174-b ‡ (nysenate.gov returned 403) — https://www.nysenate.gov/legislation/laws/EXC/171-A ; https://www.nysenate.gov/legislation/laws/EXC/174-B
56. Pennsylvania Solicitation of Funds for Charitable Purposes Act, 10 P.S. §162.1 ff. — https://www.legis.state.pa.us/WU01/LI/LI/US/HTM/1990/0/0202..HTM
57. NASCO "Internet and Social Media Solicitations: Wise Giving Tips" (Colorado SOS copy) — https://www.sos.state.co.us/pubs/charities/internetTips.html ; NASCO public statements — https://www.nasconet.org/publicstatements
58. Ohio Rev. Code §1716.03 — https://codes.ohio.gov/ohio-revised-code/section-1716.03
59. Minn. Stat. §309.515 — https://www.revisor.mn.gov/statutes/cite/309.515
60. Va. Code §57-60 — https://law.lis.virginia.gov/vacode/title57/chapter5/section57-60/
61. The Nature Conservancy, charitable solicitation disclosures ‡ (compiled state legends; secondary) — https://www.nature.org/en-us/about-us/who-we-are/accountability/charitable-solicitation-disclosure/
62. N.C. G.S. 105-164.4 — https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_105/GS_105-164.4.html ; 105-164.3 — https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_105/GS_105-164.3.html ; 105-164.4G — https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_105/GS_105-164.4G.html ; 105-164.13 — https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_105/GS_105-164.13.html ; NCDOR Sales and Use Tax Bulletins (2026) — https://www.ncdor.gov/sutb-2026pdf/open ; NCDOR State Taxation and Nonprofit Organizations — https://www.ncdor.gov/documents/files/state-taxation-and-nonprofit-organizations/open ; NC current rates — https://www.ncdor.gov/taxes-forms/sales-and-use-tax/sales-and-use-tax-rates/current-sales-and-use-tax-rates
63. CDTFA Publication 18, Nonprofit Organizations — https://www.cdtfa.ca.gov/formspubs/pub18.pdf
64. Texas Comptroller 94-183 — https://comptroller.texas.gov/taxes/publications/94-183.php ; 96-122 — https://comptroller.texas.gov/taxes/publications/96-122.php
65. NY Tax Bulletin: admission charges — https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/admission_charges.htm ; TSB-A-14(4)S — https://www.tax.ny.gov/pdf/advisory_opinions/sales/a14_4s.pdf
66. CCPA/CPRA text — https://cppa.ca.gov/regulations/pdf/cppa_act.pdf ; CPPA CPI adjustment — https://cppa.ca.gov/regulations/cpi_adjustment.html
67. Oregon DOJ: privacy law FAQs for nonprofits — https://www.doj.state.or.us/consumer-protection/for-businesses/privacy-law-faqs-for-nonprofits/
68. Delaware Personal Data Privacy Act, 6 Del. C. ch. 12D — https://delcode.delaware.gov/title6/c012d/index.html
69. Minn. Stat. §325M.12 — https://www.revisor.mn.gov/statutes/cite/325M.12
70. Colorado AG: Colorado Privacy Act ‡ — https://coag.gov/resources/colorado-privacy-act/
71. N.C. G.S. 116B-53 — https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_116B/GS_116B-53.html
72. AFP Donor Bill of Rights ‡ — https://afpglobal.org/sites/default/files/attachments/2018-10/DonorBillofRights.pdf
73. FTC consumer advice: donating through crowdfunding and fundraising platforms — https://consumer.ftc.gov/articles/donating-through-crowdfunding-and-fundraising-platforms
