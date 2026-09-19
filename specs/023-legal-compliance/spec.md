# Feature Specification: Legal and compliance foundation

**Feature Branch**: `plan/023-legal-compliance`  
**Created**: 2026-09-18  
**Status**: Proposed — engineering specification; no legal text drafted. **Built so far (2026-09-19)**: phase 0 scaffolding on `main` (PR #99: LR-01/02/03/04 route dark behind `NEXT_PUBLIC_LEGAL_PAGES_ENABLED`, LR-12 dead-code removal) and the consent capture from spec 024 phase 3 (PR #95: LR-05 `LegalAcceptance` on checkout + apply, LR-07 marketing provenance). See the *Built* notes on each LR. Every document and provision listed here needs review by a North Carolina attorney familiar with software, privacy, copyright, payments and startup law before it is published.  
**Input**: Request 2026-09-18 (session [015NmwW2FJfkUD5CKxNjGuR5](https://claude.ai/code/session_015NmwW2FJfkUD5CKxNjGuR5)) to inspect the app's real features, flows, data handling and business model, decide which policies and agreements are genuinely needed, and produce an engineering-ready implementation specification — not legal advice, not contract language.  
**Builds on**: spec 001/003 (guest checkout, orders, tickets, refunds), spec 007 (per-organization buyers, buyer accounts, custom domains), spec 009 (tax), spec 010 (payments settings, Stripe Connect, dark), spec 011/012 (applications, card on file, add-ons), spec 019 (participants), spec 020 (abuse protection, planned), spec 022 (organizer signup, Jump subscriptions, dark), `docs/wiki/config/production-launch-checklist.md`.  
**Not legal advice**: this document classifies obligations and turns them into product, data and process requirements. It cites statutes so counsel can confirm or correct them; every citation is marked *verify*.

## Vocabulary

**Jump** is the platform operator (legal entity name, state of formation and registered address are unknown — §12 Q1). **Organizer** is an organization that signs up through `/signup`, is represented by `User` rows with `OrganizationMember` memberships, and sells tickets and application slots to the public. **Buyer** is a member of the public who checks out (`Contact` row scoped to one organization, guest or account-enabled). **Applicant** is a vendor / sponsor / press / panel candidate who submits an `Application` with an `ApplicantProfile`. **Staff** are `User` rows (`ORGANIZER`, `ADMIN`, `SYSTEM_ADMIN`). **User-generated content (UGC)** is anything a non-Jump party writes or uploads and Jump stores, renders or emails. **Consent record** is a durable row proving who accepted which document version, when, and from where.

---

## 1. Executive summary

Jump is a consumer-facing, multi-tenant SaaS ticketing marketplace that (a) takes money from the public on behalf of third-party organizers with Jump as merchant of record, (b) stores personal data on buyers, applicants and organizer representatives, (c) hosts and publicly serves content written and uploaded by organizers and applicants on Jump's own domains and on organizers' custom domains, and (d) is about to charge organizers a subscription and route funds to their bank accounts through Stripe Connect. None of that is covered by a single published legal document today. The checkout page already says "By completing this purchase, you agree to our Terms of Service and Privacy Policy" and links to `/terms` and `/privacy` — **both routes return 404**. The one data-erasure endpoint in the codebase (`POST /customers/:customerId/delete-data`) queries a `prisma.customer` model that no longer exists and cannot run.

**Verdict: a spec is needed, and its first phase is a go-live blocker.** The minimum before real money: Terms of Service for buyers, a Privacy Policy, Organizer Terms (the platform agreement, including the Stripe Connect and subscription terms that ship dark), working links and a consent record, a refund and cancellation disclosure at checkout, an explicit card-on-file authorization on paid application forms, a copyright / content complaint intake, and a working data deletion path. An EULA alone is the wrong instrument — Jump distributes no software to install; the relationship is a hosted service governed by Terms of Service (buyer-facing) and a platform agreement (organizer-facing). No separate EULA is recommended.

What is **not** needed at this stage: AI disclosures (no AI integration exists), blockchain disclosures (no wallet, token or ledger code exists), a cookie consent banner (only strictly-necessary cookies, no analytics, no advertising — becomes required the day an analytics or ads script is added or EU/UK visitors are targeted), community guidelines as a separate document (an Acceptable Use section inside the Terms covers Jump's audience), and independent-contractor agreements (not an app concern).

Priority order: Phase 0 engineering scaffolding (routes, versioning, consent capture, dead-code removal, security contact) can be built now with placeholder-free pages that render whatever counsel delivers; Phase 1 publishes the attorney-reviewed documents and blocks launch; Phases 2–3 add the operational workflows (privacy requests, content reports, audit) and the conditional items (marketing email, cookies, subscription renewal disclosures) as those features turn on.

## 2. Assumptions

Each assumption changes a recommendation if wrong; §12 lists the question to resolve it.

| # | Assumption | Basis | If wrong |
|---|---|---|---|
| A1 | Jump is a North Carolina business and its organizers are initially US-based, with buyers anywhere in the US. | User instruction; NC tax region set to manual 7.25 % in prod (memory); no i18n, `countryCode` defaults `US`, currency `usd`. | EU/UK buyers or organizers bring GDPR / UK GDPR, cookie consent, a lawful-basis analysis and a representative requirement. Not addressed here beyond flags. |
| A2 | Jump is merchant of record for ticket and application charges, now and after Stripe Connect (destination charges). | `OrderService` creates Checkout Sessions on the platform account; Connect phase 2 is destination charges with `application_fee_amount`; launch checklist records the alternative (direct charges, organizer as MoR) as undecided. | If organizers become merchant of record, the buyer Terms change party, the refund/chargeback liability moves, and Stripe's Connected Account Agreement presentation becomes the organizer's obligation to their buyers. Flagged in §12 Q3. |
| A3 | Jump does not sell or share personal data for advertising and runs no third-party analytics. | No analytics, pixel, tag-manager or ad SDK in `frontend/` or `backend/` dependencies or source; only `localStorage` for theme, saved views and the org-switcher channel. | Adding any such script triggers cookie consent, "sale/share" disclosures under state laws, and a Privacy Policy rewrite. |
| A4 | Events are general-audience; none are directed at children under 13. | No age field, no age gate, no category signalling children's content. | Events directed at children trigger COPPA (verify) and an organizer-terms restriction; see §12 Q6. |
| A5 | Jump's own subscription (spec 022, `BILLING_ENABLED`) is sold to businesses, not consumers. | `/signup` creates an organization; `PlatformCustomer` records a business owner. | Sole-proprietor organizers may be consumers under NC's automatic-renewal statute (verify); §12 Q8. |
| A6 | Ticket resale, transfer between buyers, and secondary-market listing do not exist. | No transfer route, no resale model; tickets are bound to `contactId`. | NC ticket-resale statutes (N.C. Gen. Stat. §§ 14-344, 14-344.1, verify) and the federal BOTS Act become relevant. Out of scope until built. |
| A7 | No SMS is sent. | Phone numbers are collected (organization, applicant `PHONE` answers) but no SMS provider is integrated. | TCPA consent capture becomes a product requirement. |

## 3. Feature and data-flow findings

Inspected: `packages/db/prisma/schema.prisma` (1,196 lines, 50 models), `backend/src/api/server.js` and every route file, `backend/src/services/*`, `backend/src/middleware/*`, `frontend/src/app/**`, `frontend/src/auth.config.ts`, `frontend/src/lib/buyerSession.ts`, `docs/wiki/**`, `specs/**`, `docs/roadmap.md`, both `package.json` files. Nothing below is inferred from documentation alone unless marked.

### 3.1 Parties and accounts

| Party | Model | Auth | Data collected |
|---|---|---|---|
| Staff (organizer users, Jump admins) | `User`, `Account`, `OrganizationMember` | Auth.js v5: Google OAuth and Resend magic link; HS256 JWT session cookie (`frontend/src/lib/authJwt.ts`); claims refreshed every 60 s | email, name, first/last name, Google profile image URL, OAuth tokens (`Account.access_token`, `refresh_token`, `id_token`), role, memberships |
| Organizer (the business) | `Organization`, `OrganizationPerson`, `PlatformCustomer`, `OrganizationStripeAccount`, `OrganizationDomain` | via staff | company name, business type, address, phone, **EIN (plaintext)**, **representatives' full name and date of birth** (`OrganizationPerson.dateOfBirth`), Stripe customer / subscription / Connect account ids, onboarding survey answers (`PlatformCustomer.onboarding` JSON: goals, event types, events per year, attendance, previous platform, source), custom domain hostnames |
| Buyer | `Contact` (unique on `organizationId + email`), `BuyerLoginToken` | passwordless magic link; `jump_buyer` httpOnly cookie, 30 days | email, first/last name, `location`, **organizer-written `note` about the buyer** (admin PATCH `/admin/customers/:contactId`), `emailSubscribed`, account timestamp, Stripe customer id (applicants), orders, tickets |
| Applicant | `Contact` + `ApplicantProfile`, `ApplicantProfileImage`, `Application`, `ApplicationAnswer` | guest status-page token (`statusTokenHash`) or buyer session | business name, description, website, social handles, up to N profile photos, free-text / URL / email / phone / number / photo answers, saved card (`stripePaymentMethodId`), booth label, organizer tags and internal note |
| Hardware scanner | none (`X-Scanner-Key`) | shared static key | none |

The same person can be a buyer at several organizations and is a separate `Contact` at each — by design (spec 007). A privacy request therefore has to be resolved per organization or by email across organizations; §7.2.

### 3.2 Money

- **Orders**: guest checkout `POST /orders` → Stripe hosted Checkout on the platform account → `checkout.session.completed` webhook → `Order.status = PAID`, tickets issued. Jump is the merchant on the buyer's statement (`PREFIX* ORG` descriptor, spec 010). Fees: 5 % platform fee + 2.9 % + $0.30 processing, shown all-in on tier prices (`FeeService`, `frontend/src/lib/fees.ts`, "FTC junk fees compliance" comment) plus sales tax from `TaxRegion` (manual or Stripe Tax). Refunds: `PriceTier.isRefundable` per tier (default `false`), buyer self-service refund of a VALID refundable ticket from the account page, ADMIN full/partial refunds, append-only `Refund` and `PaymentTransaction` ledgers.
- **Applications** (spec 011): PAID forms take a card at submission in Stripe Checkout `mode: 'setup'` and charge it **off-session** at approval (`ApplicationPaymentService.js:102`, `:216`), with pay-now fallback, `paymentDueDays` and an overdue policy (`WITHDRAW` default). The apply page says "You will save a card now and be charged … only if your application is accepted" as informational copy; there is **no checkbox** and nothing records the authorization. Stripe's off-session mandate rules and card-network rules expect an explicit customer agreement to future charges (verify with counsel and Stripe docs).
- **Stripe Connect** (spec 010 phase 2, dark behind `STRIPE_CONNECT_ENABLED`): Express accounts, destination charges; organizer receives the ex-tax subtotal, Jump keeps fees + tax; Stripe files 1099-K if enabled. The launch checklist already flags the merchant-of-record decision as open.
- **Jump subscriptions** (spec 022 phase 2, dark behind `BILLING_ENABLED`): STARTER plan, 30-day trial, embedded Checkout on Jump's account, Stripe customer portal for cancel / card update / invoices. No plan terms, price, renewal, or cancellation text exists anywhere in the product.
- **Offline / waived money** (spec 018 phase 3): ADMIN can record offline payments and waive balances on applications.

### 3.3 User-generated content — hosted, stored, published, transmitted

| Content | Who creates | Where it goes | Public? |
|---|---|---|---|
| Event name, description, category, image; venue name, address, logo; organization name, logo, cover, brand colour | Organizer staff | `Event`, `Venue`, `Organization`, `Image` → `File` on S3-compatible bucket or local `uploads/` | **Yes** — `/events`, `/events/[eventId]`, `/organizations/[orgId]`, `/venues/[venueId]`, and on the organizer's custom domain |
| Price tier names, add-on names, application form name/intro/questions | Organizer staff | `PriceTier`, `AddOn`, `ApplicationForm`, `ApplicationQuestion` | Yes (storefront, apply page) |
| Application message templates (subject + body, merge fields) | Organizer staff | `ApplicationMessageTemplate` | **Transmitted** — rendered into emails Jump sends from Jump's Resend domain to applicants |
| Applicant profile: business name, description, website, socials, photos | Applicant (public, unauthenticated form) | `ApplicantProfile`, `ApplicantProfileImage` → `Image` | Organizer-visible; **image bytes are served unauthenticated** at `GET /images/:id/:hash/:variant` to anyone holding the URL (CSV exports include photo URLs, spec 011). The roadmap's spec 014 floor map plans a public map "with profiles". |
| Application answers incl. `PHOTO` and `LONG_TEXT` | Applicant | `ApplicationAnswer` → `Image` | Organizer-visible; image bytes as above |
| Organizer notes about buyers/applicants, tags, decision notes | Organizer staff | `Contact.note`, `Application.internalNote`, `Application.tags`, `ApplicationDecision` | Internal, but personal data about a third party |

Upload constraints today: JPG/PNG/GIF/WebP only, sniffed MIME (`ImageService`), size cap per photo (`MAX_PHOTO_MB`), content-addressed by hash, WebP variants. There is **no** moderation, reporting, takedown, or removal-by-request path other than an organizer deleting their own rows; `POST /images/cleanup` is an organizer housekeeping job. Conclusion for §5.3: Jump *does* host, store, publish and transmit user-submitted material that can be copyrighted (photos, descriptions, logos), can infringe trademarks (business names, logos on public pages), and can defame or expose private facts (descriptions, notes, message bodies). The DMCA question is therefore live — not because users can create accounts, but because organizer logos, event images and applicant photos are stored on Jump's bucket and served from Jump's URLs.

### 3.4 Communications

`EmailService` (Resend) sends: order confirmation (tickets, manage-tickets link), buyer login link, application messages using organizer templates (submitted / approved / rejected / waitlisted / withdrawn / payment due / add-ons changed, spec 011/012), event cancellation notice, organizer daily digest, staff magic links (Auth.js). All are transactional or relationship messages. **No marketing email is sent today**; `Contact.emailSubscribed` (unchecked by default at checkout and on the apply form) is stored for spec 013 (messaging), which is not built. There is no unsubscribe link, no `List-Unsubscribe` header, no sender physical address in any template — acceptable for transactional mail, not for spec 013.

### 3.5 Cookies, storage, tracking

Cookies: Auth.js session (httpOnly JWT, staff), `jump_buyer` (httpOnly, 30 days), Auth.js CSRF/callback cookies. Browser storage: theme choice, saved list views, org-switcher broadcast. Server: Redis (ioredis) for caching, in-memory `express-rate-limit` keyed on `req.ip` (buyer sign-in, application submit). Request logs record method, path, status, duration and correlation id — **not** IP or user agent (`server.js:106`). Prometheus `/metrics` is served without authentication (`server.js`; spec 020 only exempts it from rate limiting). No analytics, advertising, session replay, or fingerprinting. Stripe's hosted / embedded Checkout sets Stripe's own cookies on Stripe's origin and runs Radar fraud screening (disclosure needed in the Privacy Policy as a processor).

### 3.6 Third-party processors (sub-processors)

Stripe (payments, Tax, Connect, Billing, Radar, saved cards), Resend (email), Railway (hosting, Postgres, Redis, TLS for custom domains, bucket), the S3-compatible bucket provider (Railway Bucket per `CLAUDE.md`), Google (OAuth sign-in for staff only). Unknown: error tracking / log drain destination (§12 Q10), DNS provider used by `dnsProvider.js` (read-only lookups).

### 3.7 Deletion, retention, access

- `POST /customers/:customerId/delete-data` (`backend/src/api/routes/customers.js`, registered in `server.js:135`) references `prisma.customer`, `passwordHash`, `tx.session` — all removed in spec 003/007. It throws at runtime. **There is no working erasure path for buyers, applicants, staff, or organizations' Jump data.**
- `User.deletedAt` exists but nothing sets it; Settings › Users only toggles `isActive`.
- `OnboardingService` deletes abandoned pending organizations (row delete, cascade), and `DELETE /signup/:orgId` lets the owner abandon.
- Orders, `PaymentTransaction`, `Refund`, `ApplicationRefund`, `ApplicationAdjustment` are append-only ledgers by constitution — correct for financial retention; the erasure design must anonymize the linked `Contact`, not delete the ledger.
- `BuyerLoginToken` rows are never purged (`expiresAt` indexed, no sweep). `VerificationToken` (Auth.js) likewise.
- SYSTEM_ADMIN can read every organization's buyers, notes, applications and photos; nothing logs that access.
- Backups, log retention windows and bucket lifecycle are Railway-side and undocumented (§12 Q10).

### 3.8 Public surface and white-label

Public pages exist on the Jump host and on ACTIVE organizer custom domains (spec 007/008 tenant-host middleware). No page has a footer; there are no legal, contact, accessibility or copyright links anywhere in `frontend/src/app` outside the two dead checkout links and one `PaymentForm.tsx` component. On a custom domain the buyer sees only the organizer's brand; nothing tells them the contracting party or processor is Jump.

### 3.9 Not present (and therefore not triggering anything)

No AI/LLM integration (no `openai`, `anthropic`, `@ai-sdk`, `langchain` dependency or call site); no blockchain, wallet, NFT or on-chain ticket code; no advertising; no user-to-user messaging; no ticket transfer or resale; no SMS; no mobile app or downloadable software (rules out an EULA as the primary instrument); no password storage (magic links + OAuth only); no card data on Jump servers (Stripe Checkout hosted / embedded → PCI SAQ A scope, verify).

## 4. Required legal documents (required or strongly recommended)

For each: trigger → risk → source of obligation → what it takes (document / product / process) → what is missing before drafting. **All need NC attorney review.**

### 4.1 Terms of Service (buyers and applicants) — required

- **Trigger**: public checkout (`/checkout/[eventId]`), application submission (`/events/[eventId]/apply/[formSlug]`), buyer accounts, order lookup, self-service refunds, the existing "you agree to our Terms" sentence that links to a 404.
- **Risk**: no enforceable limitation of liability, no disclaimer for organizer-run events (cancellations, venue conditions, injury), no governing-law / venue / dispute clause, no license for content buyers submit, no basis to suspend abusive buyers (spec 020), unenforceable browsewrap if the link does not resolve.
- **Source**: contractual; federal (FTC Act § 5 deceptive-practice exposure if terms are referenced but unavailable, verify); best practice.
- **Needs**: document + product (working `/legal/terms` route, notice-and-link placement adjacent to the pay / submit buttons, version capture) + process (versioning, change notice).
- **Content requirements for counsel** (from the features): Jump as platform and merchant of record vs organizer as event host (A2); tickets are revocable licenses to attend, not property; organizer sets refundability per tier; event changes / cancellation handled by organizer, Jump refunds per organizer instruction or its own policy (needs decision, §12 Q4); all-in price disclosure; chargeback conduct; account (magic link) responsibility; application-specific terms — application is an offer, approval forms the contract, card-on-file authorization, withdraw / overdue consequences (`OverduePolicy`), organizer discretion; prohibited conduct (bots, holds, scraping, enumeration — mirrors spec 020); UGC license grant for applicant profiles and photos (needs scope decision, §12 Q5); termination; disclaimers; limitation of liability; indemnity; governing law North Carolina, venue, arbitration and class-action waiver decision (§12 Q2); children (A4); changes to terms.
- **Missing**: legal entity details, dispute-resolution choice, refund-policy allocation between Jump and organizers, UGC license scope.
- **EULA?** Not recommended. Jump ships no installable software; a hosted-service Terms of Service is the correct instrument. If a scanner app or a downloadable tool is ever distributed, add an EULA then.

### 4.2 Privacy Policy — required

- **Trigger**: collection of names, emails, locations, phone numbers, dates of birth, EIN, photos, saved payment methods (via Stripe), order history; cookies; processors in §3.6; organizer-written notes about individuals; SYSTEM_ADMIN cross-tenant access.
- **Risk**: FTC Act § 5 (unfair / deceptive, verify) for undisclosed practices; state privacy statutes for buyers who live in states with comprehensive laws once thresholds are met (CA, VA, CO, CT and others — thresholds are usually revenue or consumer counts Jump is unlikely to meet at launch, verify per state); Stripe and Google OAuth program requirements to publish a privacy policy (Google requires one for OAuth consent-screen verification, verify); NC Identity Theft Protection Act duties around SSN-like identifiers and breach notice (N.C. Gen. Stat. §§ 75-60 to 75-66, verify).
- **Source**: federal (FTC), state (NC ITPA; other states by buyer residency), contractual (Stripe, Google), best practice.
- **Needs**: document + product (`/legal/privacy`, link in footer, checkout, apply, signup, account pages; a working access / deletion mechanism it can point to) + process (privacy request handling, sub-processor list maintenance, breach response).
- **Content requirements for counsel**: categories and sources per party (§3.1); purposes (fulfilment, fraud screening via Radar, account sign-in, organizer CRM notes, digest emails, tax); the organizer as an independent recipient of buyer data (Jump processes for the organizer for order data; the organizer is the party the buyer transacts with) — the controller / processor framing needs a decision (§12 Q7); processors list; cookies and local storage (§3.5); retention (§8); rights and how to exercise them; children (A4); security summary; breach notice; NC and federal specifics; contact; effective date and versioning.
- **Missing**: entity details, retention periods (business decision), whether organizers are "customers" whose buyer data Jump processes on instruction (needs a DPA, §5.4) or co-recipients.

### 4.3 Organizer Terms (platform agreement) — required

- **Trigger**: `/signup` creates an organization and a `PlatformCustomer`; organizers upload content, set prices and refund rules, write messages sent under Jump's sending domain, collect buyer data, will receive payouts (Connect) and will pay a subscription (Billing). Nothing is accepted at signup today.
- **Risk**: no allocation of responsibility for event fulfilment, chargebacks, refunds, taxes, content, or misuse; no basis to suspend an organization (`OrganizationStatus` exists); no fee terms; Stripe's Connect platform agreement requires platforms to bind connected accounts to terms and to present Stripe's Connected Account Agreement (verify current Stripe requirements); subscription without renewal / cancellation terms.
- **Source**: contractual (Stripe Connect platform terms, card-network rules for merchant obligations), NC automatic-renewal statute if any organizer is a consumer (N.C. Gen. Stat. § 75-41, verify), best practice.
- **Needs**: document + product (explicit checkbox at the signup name step; re-acceptance on version bump; Connect onboarding gate; subscribe step disclosure) + process (suspension / termination workflow, fee change notice).
- **Content requirements for counsel**: fees (5 % + processing pass-through, subject to change), payout terms and Connect obligations, merchant-of-record allocation (A2), refunds and chargeback liability, taxes (organizer responsibility for tax settings, Jump's Stripe Tax registrations), content warranties and license to Jump to display and email it, acceptable use, data — the organizer's obligations toward its buyers' data (its own privacy notice? notes about buyers, marketing consent), custom domains, service levels / no-warranty, suspension, termination and data return / deletion on exit, subscription price, trial, renewal, cancellation via portal, indemnity, liability cap, governing law, and a clause on children-directed events (A4).
- **Missing**: STARTER price and gating (spec 022 §9), Connect model decision, whether organizers may run marketing sends from Jump (spec 013), data-return policy on organization closure.

### 4.4 Refund and cancellation disclosure — required (product + policy)

- **Trigger**: `PriceTier.isRefundable`, self-service refunds, ADMIN refunds, application refunds, `paymentDueDays` / `OverduePolicy`, event cancellation email.
- **Risk**: card-network rules require the refund / cancellation policy to be disclosed to the cardholder before purchase (verify — Visa / Mastercard merchant rules via Stripe); missing disclosure weakens chargeback defence; FTC Act § 5 for undisclosed non-refundability; NC unfair-practices exposure (N.C. Gen. Stat. § 75-1.1, verify).
- **Source**: contractual (card networks), federal / state consumer-protection.
- **Needs**: product (show refundability per tier and the organizer's policy text at checkout and in the confirmation email) + document section (in Terms) + business decision on what Jump does when an organizer cancels an event or disappears (§12 Q4).
- **Missing**: Q4 decision; whether organizers may write free-text policy (they cannot today — there is no field).

### 4.5 Card-on-file authorization for paid applications — required (product + text)

- **Trigger**: `mode: 'setup'` Checkout at submission, `off_session: true` charge at approval, `update-card`, pay-now.
- **Risk**: Stripe's saved-payment-method mandate expectations and card-network rules for merchant-initiated transactions require the customer's agreement to the terms of future charges (amount, timing, trigger) at the time the card is saved (verify); disputes on "I did not authorize this" without proof.
- **Source**: contractual (Stripe, networks).
- **Needs**: product (explicit checkbox with the exact charge amount / trigger / window, recorded in the consent table with the Checkout Session id; pass `consent_collection` / custom text to Checkout where Stripe supports it) + text (drafted with counsel; short).
- **Missing**: none blocking — the amount and trigger are already computed on the page.

### 4.6 Copyright / IP complaint procedure and DMCA agent — strongly recommended

Section 5.3 separates the four distinct things. Summary: publish an IP policy and intake now; register a DMCA agent before launch (cheap, required for the § 512(c) safe harbor, verify); build the takedown workflow in phase 2. Trigger and risk detailed in §5.3.

## 5. Recommended legal documents and controls (depending on final business model, or later)

### 5.1 Acceptable Use Policy — recommended as a section, not a separate document

Trigger: UGC, spec 020 abuse paths, hardware scanner keys. Put prohibited conduct inside the Terms and Organizer Terms; publish a separate `/legal/acceptable-use` only if counsel prefers a standalone page for suspension notices. Best practice; document + process (suspension via `OrganizationStatus`, buyer blocking — which needs a product surface, §6).

### 5.2 Community Guidelines — probably unnecessary at this stage

There is no social feed, comments, reviews or user-to-user messaging. Revisit with spec 013 (messaging) or spec 014 (public vendor profiles on the floor map).

### 5.3 Copyright, DMCA and content complaints — recommended now, safe harbor conditional

Four separate decisions, because they are often conflated:

| Item | Recommendation | Why |
|---|---|---|
| **Public IP / content policy page** (`/legal/copyright`) with a complaint address | Required before launch | Jump publishes organizer logos, event images and applicant photos. A visible route for complaints is the first line of defence for copyright, trademark, publicity-rights, privacy and defamation complaints alike; also expected by processors and domain registrars. Best practice; federal (17 U.S.C. § 512(c)(2), verify, requires the agent's contact info on the site). |
| **Registered DMCA designated agent** (copyright.gov directory; low fee; renew every three years, verify) | Strongly recommended before launch | Without registration the § 512(c) safe harbor is unavailable regardless of policy text. Cheap and fast. Needs a real person / role and a monitored address. |
| **Notice-and-takedown workflow** (intake, review, disable, notify the uploader, counter-notice, 10–14 business-day restore window, repeat-infringer policy, records) | Recommended; product build in phase 2, manual process from launch | Safe harbor conditions (verify): expeditious removal, notice to the poster, counter-notice handling, a reasonably implemented repeat-infringer policy, no interference with standard technical measures. Volume will be tiny at first; a ticket queue and a recorded process satisfy the process side while the admin UI is built. |
| **Qualifying for the safe harbor** | Conditional — counsel must confirm | Depends on Jump not having actual knowledge, not receiving a financial benefit directly attributable to infringing activity it controls, and the items above. Jump takes a percentage of ticket sales that may be promoted with an infringing image — counsel must assess the "financial benefit / right and ability to control" prong (verify). |

Non-copyright complaints (trademark, right of publicity, privacy, defamation) get the same intake and the same admin queue but a different disposition: no statutory safe-harbor process applies (47 U.S.C. § 230 may shield Jump from defamation liability for third-party content, verify), so the workflow ends in a documented decision under the Terms rather than a counter-notice cycle.

### 5.4 Data-processing terms with organizers — recommended depending on the controller decision (§12 Q7)

If Jump processes buyer data on the organizer's behalf (organizers see buyers as their customers, write notes, export CSVs, will run marketing), a DPA / data-processing addendum to the Organizer Terms clarifies roles, sub-processors, breach notice to the organizer, and deletion on exit. Under US state laws this is contractual best practice rather than a statutory must at Jump's size (verify); under GDPR it would be mandatory. Sub-processor DPAs in the other direction (Stripe, Resend, Railway, Google) are accepted online — process item: record where each is accepted and by whom.

### 5.5 AI disclosure and responsible-use policy — probably unnecessary

No AI provider, model, prompt or generated content exists in the codebase. Add when any AI feature (drafting event descriptions, message templates, support) lands; at that point disclose the provider, whether inputs are used for training, and human review.

### 5.6 Blockchain risk disclosures — unnecessary

No wallet, chain, token, or immutable ledger. The "append-only" `PaymentTransaction` table is an internal database convention, not a public ledger, and the Privacy Policy should not describe it as immutable in the blockchain sense: rows can be anonymized through the linked `Contact`.

### 5.7 Accessibility statement — recommended

Trigger: public consumer checkout; the product already ships a WCAG AA contrast checker for brand colours (`organization-branding.md`) and theme modes. Risk: ADA Title III web-accessibility suits are frequent against ticket sellers (verify current standard; DOJ Title II rule applies to public entities, not Jump, but private suits use WCAG 2.1 AA as the yardstick). Needs: document (`/legal/accessibility`: target standard, known gaps, contact) + process (periodic audit — `chrome-devtools-mcp:a11y-debugging` skill exists in this workspace) + product (fix findings). Best practice / litigation-risk reduction; not a statute Jump can be certified against.

### 5.8 Security and incident-response policy — strongly recommended (internal), summary public

Trigger: personal data plus payment routing; NC ITPA breach notification to affected NC residents and to the NC Attorney General's Consumer Protection Division (N.C. Gen. Stat. § 75-65, verify thresholds and timing); other states' breach statutes for their residents; Stripe's incident obligations. Needs: process (runbook: detection, containment, Stripe / Resend / Railway contacts, notification decision tree, template letters, 72-hour internal target), product (`/.well-known/security.txt`, `security@` address, audit log — §11), document (public security summary in the Privacy Policy, no separate page needed).

### 5.9 Cookie consent mechanism — probably unnecessary now; conditional

Only strictly-necessary cookies exist (§3.5) and no advertising / analytics. US federal and NC law do not require a banner for that (verify). A Privacy Policy cookie section suffices. Required the moment an analytics, ads, session-replay or A/B script is added, or if EU / UK visitors are targeted (ePrivacy). Engineering guard in §6.

### 5.10 Organizer / seller / marketplace / payment terms — covered by §4.3

Do not create a fourth document; keep Connect payout terms, subscription terms and the fee schedule as sections or short annexes of the Organizer Terms so acceptance is one event.

### 5.11 Refund and cancellation policy — covered by §4.4

### 5.12 Independent-contractor or partner agreements — out of scope for the app

Not triggered by any feature. If Jump hires contractors who touch production data, a confidentiality / data-handling clause is a process item under §11, not a product item.

### 5.13 Ownership and certifications — flag only

Nothing in the codebase depends on ownership structure. If Jump ever pursues a certification or funding tied to owner status (for example NC HUB or federal set-asides), eligibility must rest on genuine ownership, control and management; this spec makes no recommendation on it and refers the question to counsel. No product change.

## 6. Product and engineering requirements

Numbered `LR-` (legal requirement) for traceability to §14.

**Legal document hosting**
- **LR-01** *Built 2026-09-19 (PR #99), dark: `frontend/src/lib/legalContent.ts` + `app/legal/[slug]/page.tsx`, `marked`, `content/legal/README.md`; unknown slugs 404 via `dynamicParams = false`.* A `frontend/src/app/legal/[slug]/page.tsx` route renders attorney-supplied Markdown from `frontend/content/legal/<slug>.md` (`terms`, `privacy`, `organizer-terms`, `copyright`, `accessibility`, optionally `acceptable-use`). Static, server-rendered, no client JS needed, `<h1>` from front matter, printable.
- **LR-02** *Partly built: front matter parsed and required; the backend side is `backend/src/config/legal.js` `LEGAL_VERSIONS` (`terms`, `privacy`, `cardAuthorization`, `-draft` values) served by `GET /legal/versions` (spec 024 phase 3). Not built: the frontend `LEGAL_VERSIONS` mirror + `legalUrl` helper and the match test — the apply and checkout forms fetch versions from the backend instead.* Each file carries front matter `version` (semver or date), `effectiveDate`, `title`, `audience`. A build-time module `frontend/src/lib/legal.ts` exports `LEGAL_VERSIONS` and a `legalUrl(slug, host)` helper; the backend mirrors versions in `backend/src/config/legal.js` (same pattern as `fees.js` ↔ `fees.ts`; both must match, test enforced).
- **LR-03** *Built 2026-09-19 (PR #99): `next.config.mjs` redirects; `PaymentForm.tsx`, checkout and apply link through `LEGAL_PATHS` only when `NEXT_PUBLIC_LEGAL_PAGES_ENABLED`; off, the sentence renders without links rather than hidden (spec 024 phase 3 decision).* Legacy paths `/terms` and `/privacy` redirect (308) to `/legal/terms` and `/legal/privacy`; `PaymentForm.tsx` and the checkout page link to the new paths. Until counsel's text exists the route must not render a placeholder that looks like terms — the deploy that adds the route ships with the real text or stays dark (feature flag `NEXT_PUBLIC_LEGAL_PAGES_ENABLED`, default off; when off the checkout sentence is hidden too, because a promise to a 404 is worse than silence).
- **LR-04** *Partly built (PR #99): `/legal/*` in `PUBLIC_PASS`, Jump header line on the page. Not built: the footer on every public page and the "Powered by Jump" decision (§12 Q9).* On an organizer custom domain the legal pages render under the same paths with Jump's text and a header line identifying Jump as the platform; tenant middleware must not rewrite `/legal/*` to a storefront route. Footer on every public page (storefront, checkout, apply, status, account, order pages) links Terms, Privacy, Copyright / report content, Accessibility, and "Powered by Jump" on custom domains (the white-label decision — §12 Q9 — decides whether "Powered by" is mandatory or suppressible).

**Consent capture**
- **LR-05** *Built 2026-09-19 by spec 024 phase 3 (PR #95) for the first two capture points: `LegalAcceptance` (append-only; `document` TERMS / PRIVACY / CARD_AUTHORIZATION, `version`, `text` snapshot for the card authorization, hashed IP + `LEGAL_IP_SALT`, user agent, `orderId` / `applicationId`), `services/LegalAcceptanceService.js` (`assertCurrent`, `record`), `GET /legal/versions`, errors `LEGAL_VERSION_STALE` / `LEGAL_ACCEPTANCE_REQUIRED`; the checkout refusal is behind `LEGAL_ACCEPTANCE_REQUIRED` until the pages go live, the apply form always requires them. Not built: signup, Connect onboarding and buyer first-sign-in capture points.* New model `LegalAcceptance` (§8) written by the backend, never by the client alone. Capture points and exact placement:
  - Checkout `POST /orders`: request carries `acceptances: [{ document: 'terms', version }, { document: 'privacy', version }]` copied from `LEGAL_VERSIONS`; backend rejects (`400 LEGAL_VERSION_STALE`) if the version is not current and records the row on the `Order` (pending) — the acceptance is by the email on the order, subject type `CONTACT`, linked to the order id, so an abandoned checkout still shows what was shown. Notice text stays adjacent to the pay button (sign-in-wrap pattern) — counsel decides whether an unchecked checkbox is required for arbitration enforceability (§12 Q2); the UI supports both via a prop.
  - Application submit `POST /events/:eventId/applications`: same, plus `card_authorization` when the form is PAID with `chargeTiming = APPROVAL` — a **required checkbox** whose label includes the amount, the trigger ("only if approved"), the window (`paymentDueDays`) and the update-card path. The Checkout Session id is stored on the acceptance once created.
  - Organizer signup `POST /signup` (name step): required checkbox "I agree to the Organizer Terms and Privacy Policy" → `USER` subject, linked to the organization id. Subscribe step (`BILLING_ENABLED`): the embedded Checkout page shows plan price, trial length, renewal cadence and cancellation path above the form (NC § 75-41 style disclosure, verify) and records `subscription_terms`.
  - Connect onboarding start (`STRIPE_CONNECT_ENABLED`): re-confirm Organizer Terms version and record `connect_terms`; Stripe's own Connected Account Agreement acceptance is handled by Stripe's hosted onboarding (verify).
  - Buyer account first sign-in (`/organizations/[orgId]/account/verify`): show current versions and record a `CONTACT` acceptance if none exists for the current version.
- **LR-06** Version bump policy: `terms` / `organizer-terms` major bump → staff see a blocking interstitial in `/admin` until re-accepted (owner or ADMIN role); buyers are not blocked (guest checkout records the current version each time). Minor bump → banner only. Implemented as a `requireCurrentLegal` check in `AdminRoute` reading `GET /legal/status`.
- **LR-07** *Built 2026-09-19 by spec 024 phase 3 (PR #95): `Contact.emailSubscribedAt` / `emailSubscribedSource` (`CHECKOUT` / `APPLY` / `ADMIN` / `IMPORT`) / `emailUnsubscribedAt`, written by `services/ContactOptInService.js` and the admin customer PATCH (source `ADMIN`). Not built: the admin reason field, `List-Unsubscribe` (spec 013).* Marketing consent (`Contact.emailSubscribed`) gains provenance: `emailSubscribedAt`, `emailSubscribedSource` (`CHECKOUT` / `APPLY` / `ADMIN` / `IMPORT`), `emailUnsubscribedAt`; admin edits of `emailSubscribed` set source `ADMIN` and require a reason field. Spec 013 must consume these and add `List-Unsubscribe` + a one-click unsubscribe route before any marketing send (CAN-SPAM, 15 U.S.C. § 7701 et seq., verify; CASL if Canadian recipients).

**Refund and event terms surfaces**
- **LR-08** `Organization.refundPolicyText` (plain text, ≤ 2,000 chars) editable in Settings › General; `Event.termsNote` optional per-event text (age limits, entry conditions). Checkout shows per-tier refundability ("Refundable until the event starts" / "Non-refundable") derived from `isRefundable` plus the organizer's text; the order confirmation email repeats both; the apply page shows `paymentDueDays` and the overdue consequence in words. Jump's own policy text (what Jump does on cancellation, §12 Q4) lives in the Terms and is linked, not duplicated.

**Content reporting and takedown**
- **LR-09** Public `POST /legal/reports` (rate-limited under spec 020's factory) and page `/legal/report` collecting: complaint type (`COPYRIGHT`, `TRADEMARK`, `PUBLICITY`, `PRIVACY`, `DEFAMATION`, `OTHER`), the URL(s) or image ids, description, claimant name / org / address / email / phone, ownership statement, good-faith statement, accuracy-under-penalty-of-perjury statement (copyright only), signature. Creates a `ContentReport` (§8) and emails `LEGAL_CONTACT_EMAIL`.
- **LR-10** SYSTEM_ADMIN queue `/admin/system/reports`: view report, resolve the target (event image, org logo/cover, venue logo, applicant photo, answer photo, text field), actions **Disable content** (sets `Image.disabledAt` / `Image.disabledReason`; `GET /images/:id/:hash/:variant` returns 404 while disabled; text fields are replaced with "[removed following a complaint]"), **Notify uploader** (email to the organizer's account email or applicant's contact email with the notice summary and counter-notice instructions), **Record counter-notice**, **Restore** (only after the statutory wait, enforced as a minimum-date guard, verify 10–14 business days), **Close**. Every action appends a `ContentReportEvent`.
- **LR-11** Repeat-infringer bookkeeping: `ContentReport.strikeAgainst` (organization id or contact id); a query surfaces subjects with ≥ N sustained reports; suspension is a manual SYSTEM_ADMIN action via `OrganizationStatus.SUSPENDED` (exists) or a new `Contact.blockedAt`. The policy text (N, window, appeal) is counsel's; the product exposes the count.

**Privacy rights**
- **LR-12** *Phase-0 removal done 2026-09-19 (PR #99).* Remove `backend/src/api/routes/customers.js` and its `server.js` mount (dead code) in phase 0. Replace in phase 2 with:
  - Buyer / applicant self-service on the org account page: **Download my data** (JSON of Contact, orders, tickets, applications, profile, answers, acceptances) and **Delete my data** (anonymize per §8.4 after email re-verification via a `BuyerLoginToken` purpose `DELETE_CONFIRM`; 7-day cooling window with cancel link; hard-stop if any PENDING order, PAYMENT_DUE application or open refund exists — explain and defer).
  - Cross-organization request: `/legal/privacy-request` public form → `PrivacyRequest` row → SYSTEM_ADMIN queue `/admin/system/privacy-requests` that finds every `Contact` and `User` for the verified email, runs export or anonymization per organization, and records completion. Verification by magic link to the email in question.
  - Staff self-delete: Settings › Profile **Delete account** — refused while the user is the sole ADMIN of any organization or the `PlatformCustomer.ownerUserId`; otherwise sets `User.deletedAt`, scrubs name / image / email to a tombstone, deletes `Account` rows, keeps `ApplicationDecision.decidedById` / `Refund.initiatedBy` references intact (audit).
  - Organization closure: owner-initiated **Close organization** → 30-day grace, then anonymize all contacts, delete images, keep ledgers; Connect / Billing objects cancelled through Stripe first.
- **LR-13** Retention jobs (extend the existing sweep pattern in `server.js`): purge `BuyerLoginToken` and `VerificationToken` past `expiresAt + 7 d`; anonymize `Contact` rows with no order, application or account activity for `CONTACT_RETENTION_MONTHS` (default 36, decision §12 Q11); delete `Image` rows and blobs 30 days after `disabledAt` or after their last reference is gone (`/images/cleanup` becomes scheduled).

**Cookie / tracking guard**
- **LR-14** A frontend unit test asserts no `<script src>` to a non-allowlisted host and no known analytics globals; a `docs/wiki/config/privacy-register.md` entry is required to extend the allowlist. Adding a tracker therefore fails CI until someone consciously updates the register — the moment §5.9 flips.

**Sensitive fields**
- **LR-15** `Organization.ein` and `OrganizationPerson.dateOfBirth` are encrypted at rest with an application key (`FIELD_ENCRYPTION_KEY`, AES-256-GCM, key id prefix for rotation) and masked in API responses except on the People / Business details edit dialogs for ADMIN; SYSTEM_ADMIN reads are audit-logged (§11). Decision §12 Q12 on whether these fields are still needed at all now that Stripe Connect / Billing collect KYC on Stripe.

**Communications**
- **LR-16** Application messages sent from organizer templates are labelled in the email shell "Sent by {Organization} through Jump" with the organizer's postal address (from `Organization` address fields; require them before a PAID form can open) and Jump's platform footer. Reply-To is the organizer's `email`. This is both CAN-SPAM hygiene and a fraud-prevention statement (verify with counsel that transactional application mail is outside CAN-SPAM's commercial scope; the address costs nothing either way).

**Security contact**
- **LR-17** `frontend/public/.well-known/security.txt` (`Contact: mailto:security@…`, `Policy: /legal/security`, `Expires`), served on all hosts; backend `GET /.well-known/security.txt` proxies the same content.

## 7. Admin and operational workflows

Each has an owner role, an SLA target (business decision, defaults shown), a system of record and a template.

| Workflow | Trigger | Owner | Steps | Record |
|---|---|---|---|---|
| **7.1 Content complaint (copyright)** | `ContentReport` type `COPYRIGHT` | Designated DMCA agent (SYSTEM_ADMIN) | Validate completeness (§ 512(c)(3) elements, verify) within 1 business day → disable content (LR-10) → notify uploader with copy of notice → if counter-notice received, forward to claimant → restore after the statutory window unless claimant confirms suit filed → close; count strike | `ContentReport`, `ContentReportEvent`, emails archived |
| **7.2 Content complaint (other)** | type ≠ `COPYRIGHT` | SYSTEM_ADMIN | Assess under Terms (impersonation, privacy, defamation); may request more info; disable or decline with reason; notify both parties | same |
| **7.3 Privacy request** | `/legal/privacy-request` or self-service | SYSTEM_ADMIN (privacy contact) | Verify identity by magic link → locate all `Contact` / `User` rows → export or anonymize per organization → notify the organizer(s) that a buyer's record was anonymized (they keep the ledger) → respond within 45 days (CCPA-style default; NC has no fixed clock, verify) | `PrivacyRequest` |
| **7.4 Buyer self-delete** | account page | automated | verification email → 7-day window → anonymize (§8.4) → confirmation email | `PrivacyRequest` auto-created |
| **7.5 Organizer suspension / termination** | AUP breach, repeat strikes, chargeback rate, non-payment | SYSTEM_ADMIN | Warn (email + dashboard banner) → `OrganizationStatus.SUSPENDED` (storefront off, admin read-only, payouts paused via Stripe if Connect) → cure window → terminate: closure flow (LR-12) | `OrganizationStatusEvent` (new, §8) |
| **7.6 Buyer / applicant block** | abuse (spec 020), fraud, strikes | organizer ADMIN for their org; SYSTEM_ADMIN globally | `Contact.blockedAt` + reason → checkout / apply refuse with generic message | `Contact` fields, audit log |
| **7.7 Legal document release** | counsel delivers new text | Engineering + owner | Add file with new `version` + `effectiveDate` → PR review checks both version constants → deploy → LR-06 interstitial for majors → email notice to organizer owners for Organizer Terms majors (30 days ahead for material changes — counsel decides) | git history + `LegalDocumentRelease` row (optional; git suffices at this size) |
| **7.8 Security incident** | alert, report to `security@`, Stripe / Railway notice | Incident lead (owner) | Runbook in `docs/wiki/config/incident-response.md`: triage → contain (rotate `AUTH_SECRET`, Stripe keys, `SCANNER_API_KEY`, bucket keys) → scope affected rows → legal notification decision (NC § 75-65, other states, Stripe) → notify → post-mortem | incident doc in the vault + `docs/` |
| **7.9 Sub-processor change** | new vendor | Engineering | Add to `privacy-register.md` → Privacy Policy minor bump → organizer notice if DPA (§5.4) requires | register file |
| **7.10 DMCA agent renewal** | every 3 years (verify) | owner | calendar reminder; update `/legal/copyright` if contact changes | register file |

## 8. Database fields and records that must be retained

### 8.1 New models

```prisma
model LegalAcceptance {
  id             String   @id @default(cuid())
  subjectType    LegalSubject      // USER | CONTACT | ANONYMOUS_EMAIL
  subjectId      String?           // User.id or Contact.id; null when only an email is known
  email          String            // as entered; lets a pending checkout be matched later
  organizationId String?           // tenant context (null for organizer signup of a new org until created)
  document       LegalDocument     // TERMS | PRIVACY | ORGANIZER_TERMS | CARD_AUTHORIZATION | SUBSCRIPTION_TERMS | CONNECT_TERMS | MARKETING
  version        String
  source         LegalSource       // CHECKOUT | APPLY | SIGNUP | SUBSCRIBE | CONNECT | ACCOUNT | ADMIN_INTERSTITIAL
  referenceType  String?           // 'Order' | 'Application' | 'Organization' | 'CheckoutSession'
  referenceId    String?
  ipHash         String?           // sha256(ip + daily salt); never the raw IP
  userAgent      String?           // truncated to 255
  presentedText  String?           // exact label shown for CARD_AUTHORIZATION (amount, trigger, window)
  acceptedAt     DateTime @default(now())

  @@index([email, document])
  @@index([subjectType, subjectId])
  @@index([referenceType, referenceId])
}
```

`LegalAcceptance` is append-only (no `updatedAt`), like `PaymentTransaction`. Retention: life of the related ledger row (orders / applications are kept indefinitely for financial records — verify the period counsel wants, commonly 7 years); on anonymization the `email` is replaced by the tombstone but the row stays so the acceptance can still be proven for the order.

```prisma
model ContentReport {
  id              String   @id @default(cuid())
  type            ContentReportType  // COPYRIGHT | TRADEMARK | PUBLICITY | PRIVACY | DEFAMATION | OTHER
  status          ContentReportStatus // RECEIVED | INCOMPLETE | CONTENT_DISABLED | COUNTER_NOTICE | RESTORED | DECLINED | CLOSED
  targetType      String            // 'Image' | 'Event' | 'Organization' | 'Venue' | 'ApplicantProfile' | 'ApplicationAnswer'
  targetId        String
  targetUrl       String?
  organizationId  String?           // owner of the content
  strikeAgainst   String?           // 'org:<id>' | 'contact:<id>'
  claimant        Json              // name, org, address, email, phone
  statement       String
  swornStatements Json              // { goodFaith, accuracy, authority } booleans + signature text
  counterNotice   Json?             // same shape, from the uploader
  restoreNotBefore DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  events          ContentReportEvent[]
}

model ContentReportEvent {
  id        String   @id @default(cuid())
  reportId  String
  actorId   String?  // User.id (SYSTEM_ADMIN) or null for system
  action    String   // RECEIVED | DISABLED | NOTIFIED_UPLOADER | COUNTER_RECEIVED | FORWARDED | RESTORED | DECLINED | CLOSED | NOTE
  note      String?
  createdAt DateTime @default(now())
  report    ContentReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
}

model PrivacyRequest {
  id           String   @id @default(cuid())
  type         PrivacyRequestType   // ACCESS | DELETE | CORRECT | OPT_OUT
  email        String
  status       PrivacyRequestStatus // RECEIVED | VERIFIED | IN_PROGRESS | COMPLETED | REFUSED | CANCELLED
  verifiedAt   DateTime?
  scope        Json?                // organization ids touched, counts
  refusalReason String?
  requestedAt  DateTime @default(now())
  completedAt  DateTime?
  handledById  String?
}

model OrganizationStatusEvent {
  id             String   @id @default(cuid())
  organizationId String
  from           OrganizationStatus
  to             OrganizationStatus
  reason         String
  actorId        String?
  createdAt      DateTime @default(now())
}

model AuditLog {                       // §11
  id         String   @id @default(cuid())
  actorId    String?
  actorRole  String
  action     String                    // e.g. 'contact.read.cross_tenant', 'ein.reveal', 'export.csv', 'refund.create'
  targetType String
  targetId   String
  organizationId String?
  correlationId  String?
  createdAt  DateTime @default(now())
  @@index([actorId, createdAt])
  @@index([targetType, targetId])
}
```

### 8.2 New fields on existing models

| Model | Field | Purpose |
|---|---|---|
| `Contact` | `emailSubscribedAt`, `emailSubscribedSource`, `emailUnsubscribedAt`, `blockedAt`, `blockedReason`, `anonymizedAt` | consent provenance, blocking, erasure marker |
| `User` | `legalAcceptedVersions Json?` (cache of latest per document for the interstitial), `anonymizedAt` | LR-06, LR-12 |
| `Organization` | `refundPolicyText`, `legalContactEmail`, `closedAt`, `closeRequestedAt` | LR-08, closure |
| `Event` | `termsNote` | LR-08 |
| `Image` | `disabledAt`, `disabledReason`, `disabledReportId` | LR-10 |
| `Order` | `legalVersions Json` (`{terms, privacy}` shown at checkout) | belt-and-braces alongside `LegalAcceptance` |
| `Application` | `cardAuthorizationAcceptanceId` | proves the mandate for the off-session charge |
| `PlatformCustomer` | `subscriptionTermsAcceptanceId` | renewal disclosure proof |

### 8.3 Must be retained (never hard-deleted while the ledger exists)

`Order`, `OrderItem`, `OrderAddOn`, `PaymentTransaction`, `Refund`, `Application` money fields, `ApplicationRefund`, `ApplicationAdjustment`, `ApplicationDecision`, `LegalAcceptance`, `ContentReport*`, `PrivacyRequest`, `AuditLog`, `OrganizationStatusEvent`, tax report inputs (`Order.taxAmount`, `TaxRegion` history). Retention period: business decision with counsel (§12 Q11); default proposal 7 years from the transaction for financial rows, 3 years for content reports after closure, life of the account plus 1 year for acceptances tied to a live account.

### 8.4 Anonymization (what "delete" means)

`Contact` → `email = deleted-<id8>@anonymized.invalid`, `firstName = 'Deleted'`, `lastName = 'User'`, `location = null`, `note = null`, `emailSubscribed = false`, `stripeCustomerId` detached after deleting the Stripe Customer (payment methods go with it), `anonymizedAt = now()`; `BuyerLoginToken` rows deleted; `ApplicantProfile` text scrubbed and images disabled then purged; `ApplicationAnswer` text scrubbed for free-text types, photo answers purged; `Ticket.qrCodeJwt = null` (barcode kept — it holds no PII). Orders, tickets, applications and ledgers remain linked to the tombstone. `Refund.initiatedBy` / `ApplicationDecision.decidedById` keep the `User.id` even after that user is anonymized. Stripe-side data (charges, customers) is subject to Stripe's own retention — the Privacy Policy must say so.

## 9. User-interface requirements

| Surface | Requirement |
|---|---|
| **Global public footer** (storefront, event, venue, org pages, checkout, confirmation, order lookup / detail, apply, status, account) | Links: Terms · Privacy · Report content · Accessibility · Contact; "© {year} {Organizer}" on tenant pages plus "Powered by Jump" (Q9); Jump's footer on platform pages. Must render on custom domains. |
| **Checkout** | Refundability per tier line ("Non-refundable" badge) and organizer `refundPolicyText` block above the pay button; the acceptance sentence with working links immediately above the button; optional checkbox prop (Q2); versions posted with the order; marketing checkbox stays unchecked by default (already so); account checkbox unchanged. |
| **Order confirmation page + email** | Repeat refund terms, links to Terms and Privacy, organizer name and contact, "Jump is the payment processor / merchant" line (wording from counsel), link to manage / request refund. |
| **Apply form (FREE)** | Acceptance sentence + links above Submit; marketing checkbox unchecked. |
| **Apply form (PAID, approval charge)** | **Required checkbox**: card authorization text with amount, trigger, `paymentDueDays`, and how to update the card or withdraw; disabled Submit until checked; the same text appears on the Stripe setup page description (`custom_text` where supported, verify). |
| **Apply form (PAID, pay-now / resume)** | Acceptance sentence; no mandate checkbox needed for an on-session charge. |
| **Application status page** | Link to withdraw and to the policy on overdue payment. |
| **Buyer account page** | "Privacy & data" card: Download my data, Delete my data, marketing toggle (writes provenance), links to policies; first sign-in shows current versions (LR-05). |
| **Organizer signup — name step** | Required checkbox "I agree to the Organizer Terms and the Privacy Policy" with links; cannot continue unchecked; captured server-side. |
| **Signup — subscribe step** | Plan name, price, trial length and end date, renewal cadence, how to cancel (portal), "no charge until {date}" — above the embedded Checkout; records `SUBSCRIPTION_TERMS`. |
| **Settings › General** | Refund policy text card; legal contact email; Close organization (danger zone). |
| **Settings › Payments › Set up payouts** | Interstitial restating the payout / fee terms and Organizer Terms version before redirecting to Stripe. |
| **Admin interstitial** | Major Organizer Terms bump: full-screen accept-or-sign-out on `/admin` for ADMIN / owners; `ORGANIZER` role sees a banner "Your organization's admin must accept the updated terms" and continues. |
| **`/legal/report`** | Public complaint form (LR-09) with type selector that changes the required sworn statements; confirmation page with case id. |
| **`/legal/privacy-request`** | Public request form (LR-12); verification email; status by case id. |
| **`/admin/system/reports`, `/admin/system/privacy-requests`, `/admin/system/audit`** | SYSTEM_ADMIN only; not in the org-scoped main nav (memory: every main-nav page is org-scoped; these are platform pages and live under a separate "System" section). |
| **Accessibility** | Footer link to `/legal/accessibility`; all new forms keyboard-operable, labelled, AA contrast — run the a11y audit as an acceptance step. |

## 10. Email and notification requirements

| Email | Trigger | Required content |
|---|---|---|
| Order confirmation (exists) | paid order | + organizer name and contact, refundability per ticket, refund policy text, Terms / Privacy links, merchant line |
| Application messages (exist) | organizer actions | + "Sent by {Org} through Jump", organizer postal address, Jump footer, Reply-To organizer (LR-16) |
| Card authorization receipt (new) | PAID application submitted | The exact authorization text accepted, amount, trigger, due window, update-card link — doubles as the Stripe-recommended mandate confirmation (verify) |
| Approval charge receipt (exists as "approved") | off-session charge succeeds | + amount charged, last4, reference to the authorization date |
| Subscription confirmation (new, `BILLING_ENABLED`) | subscribe | Plan, price, trial end, renewal date, cancel path — auto-renewal disclosure copy (NC § 75-41 style, verify) |
| Renewal reminder (new, conditional) | 30 days before first paid renewal if counsel requires for consumer-like organizers | Price, date, cancel path |
| Organizer Terms update notice (new) | major version release | Summary of changes, effective date, link, what happens if not accepted |
| Privacy request verification / completion (new) | LR-12 | Magic link; then confirmation of what was anonymized per organization |
| Buyer deletion cooling-off (new) | self-delete | 7-day cancel link |
| Content report acknowledgement / uploader notice / counter-notice forward / restore notice (new) | LR-10 | Templates per DMCA step (counsel drafts); case id; deadlines |
| Suspension warning / suspended / terminated (new) | 7.5 | Reason, cure window, appeal contact |
| Security incident notice (template only) | 7.8 | NC § 75-65 contents (verify): what happened, data involved, steps taken, contact, credit-monitoring language if applicable |
| Marketing (spec 013, future) | organizer send | `List-Unsubscribe` + one-click, physical address, "why you got this" line, consent provenance check before send |

All templates stay in `EmailService` following the existing branded shell; Reply-To and From rules per LR-16.

## 11. Security and access-control requirements

- **SR-01 Audit log** (`AuditLog`, §8.1) written for: SYSTEM_ADMIN reads of buyer / applicant lists and detail across tenants (spec 019's `X-Jump-Org` scoping already narrows the surface), EIN / DOB reveal, CSV exports, refunds, content disable / restore, privacy request actions, role changes, scanner-key rotation. Viewer at `/admin/system/audit`; retention 2 years (decision Q11).
- **SR-02 Field encryption** for `ein` and `dateOfBirth` (LR-15); key in env, never logged; migration re-encrypts existing rows.
- **SR-03 Secrets and keys**: rotation runbook for `AUTH_SECRET`, Stripe keys, `SCANNER_API_KEY`, bucket credentials, `FIELD_ENCRYPTION_KEY`; `SCANNER_API_KEY` moves to per-device keys with revocation in a follow-up (noted in spec 020).
- **SR-04 Transport and headers**: spec 020 phase 2 (`helmet`, CSP) is a dependency of the public "security summary" statement; do not publish a claim the headers do not back.
- **SR-05 `/metrics`** behind a token or internal-only network before launch (spec 020).
- **SR-06 Access to production data** limited to named staff; SYSTEM_ADMIN accounts use Google OAuth with 2-step verification enforced at the Google Workspace level (process, not code); no shared logins.
- **SR-07 Backups**: document Railway Postgres backup cadence and restore test; bucket versioning or lifecycle; log retention window — all feed the Privacy Policy's retention statements.
- **SR-08 Incident runbook** (`docs/wiki/config/incident-response.md`) with the NC and multi-state notification decision tree and vendor contacts; tabletop once before launch.
- **SR-09 `security.txt`** (LR-17) and a monitored `security@` mailbox with an acknowledgement SLA (5 business days default).
- **SR-10 Data minimisation review**: decide whether `OrganizationPerson.dateOfBirth`, `Organization.ein`, the onboarding survey and `Contact.location` are needed (Q12); remove what is not — the cheapest compliance control is not having the field.
- **SR-11 Vendor DPAs**: record acceptance of Stripe's DPA, Resend's DPA, Railway's terms / DPA, Google's API Services User Data Policy compliance for OAuth (limited-use), in `docs/wiki/config/privacy-register.md`.

## 12. Open legal and business questions

Answers change the documents or the build. Owner in brackets; **bold** = blocks phase 1.

1. **Legal entity** — exact name, entity type, state of formation, registered agent, principal address, DBA "Jump"? [owner] → appears in every document, `security.txt`, DMCA registration, email footers.
2. **Dispute resolution** — arbitration with class-action waiver, or NC courts? If arbitration: provider, opt-out window, and whether an affirmative checkbox is required at checkout (drives LR-05 prop). [NC counsel]
3. **Merchant of record** — confirm Jump stays MoR under Connect destination charges (A2), and whether that is the intended long-term model. Already open on the launch checklist. [owner + counsel]
4. **Refund allocation** — when an organizer cancels an event, changes date / venue, or is unresponsive: does Jump refund buyers from the organizer's balance, from Jump's funds, or only on organizer instruction? Chargeback liability allocation to organizers? [owner + counsel] → Terms §, Organizer Terms §, LR-08 copy.
5. **UGC license scope** — what license Jump needs from organizers and applicants (display, resize, email, CSV export, future public vendor map, marketing use of organizer content?). [counsel]
6. **Children** — will Jump refuse events directed at under-13s, or accept them with organizer warranties? Age minimum for buyer accounts (13? 16? 18 for card on file)? [owner + counsel]
7. **Controller / processor framing** — is the organizer Jump's customer whose buyer data Jump processes on instruction (→ DPA, §5.4), or does Jump act as an independent business collecting buyer data for its own purposes as MoR? Likely both, per data category; counsel decides the framing, which decides whether organizers need their own privacy notice link at checkout. [counsel]
8. **Subscription renewal rules** — does NC § 75-41 (automatic renewal) or any FTC negative-option rule apply to Jump's organizer subscription given organizers may be sole proprietors (verify current status of the FTC rule, which was vacated in 2025)? Determines the subscribe-step disclosure and reminder emails. [counsel]
9. **White-label disclosure** — must "Powered by Jump" / Jump as merchant be visible on custom domains, or may organizers suppress it if the Terms disclose the platform? Card-network descriptor rules may force the merchant identity anyway. [counsel]
10. **Infrastructure facts** — Railway region (data location), backup cadence, log drain and retention, bucket provider / region, whether Redis holds any PII. [engineering]
11. **Retention periods** — financial rows, contacts with no activity, images, logs, audit log, content reports. [owner + counsel + accountant]
12. **Field necessity** — EIN, representative DOB, onboarding survey, `Contact.location`: still required for any purpose now that Stripe collects KYC? [owner]
13. **Marketing plans** — will organizers send marketing through Jump (spec 013) and from whose domain? Determines CAN-SPAM roles and consent provenance rules. [owner]
14. **Tax / seller of record** — already open in spec 009 §5.4; affects the Organizer Terms tax clause and the 1099-K statement. [accountant + counsel]
15. **Accessibility target** — WCAG 2.1 AA or 2.2 AA; published known-gaps list. [owner]
16. **DMCA agent identity** — named person or role, monitored address, physical address for the copyright.gov record. [owner]
17. **State-law thresholds** — confirm none of CCPA / other state comprehensive-privacy thresholds are met at launch and set a trigger to re-check (buyer counts are queryable). [counsel]
18. **Ownership / certification** — only if the business pursues one: confirm genuine ownership, control and management before any representation is made. No product impact. [owner + counsel]

## 13. Implementation phases

Branch pattern per memory: plan on `plan/023-legal-compliance`; phases on `feat/023-legal-phase-0` → `-1` → `-2` → `-3`, each merged to `main` alone.

### Phase 0 — Engineering scaffolding (no legal text required; can start now)

Ships dark behind `NEXT_PUBLIC_LEGAL_PAGES_ENABLED=false`.
- LR-01/02/03 legal route, Markdown renderer, version constants in both apps with a parity test, redirects, checkout sentence hidden while dark.
- LR-05 `LegalAcceptance` model + capture on `POST /orders`, `POST /events/:eventId/applications` (incl. the card-authorization checkbox with a **temporary engineering label** never shown while dark), `POST /signup`, buyer verify; `Order.legalVersions`, `Application.cardAuthorizationAcceptanceId`.
- LR-07 marketing consent provenance fields + admin reason.
- LR-08 `refundPolicyText`, `termsNote`, per-tier refundability at checkout and in the confirmation email (this part is safe to ship live — it is disclosure, not legal text).
- LR-12 first bullet only: delete `customers.js` and its mount.
- LR-13 token purge sweep.
- LR-14 tracker guard test + `privacy-register.md` with the current sub-processor list (§3.6) and the infrastructure facts once Q10 is answered.
- LR-15 field encryption for `ein` / `dateOfBirth` (or removal, per Q12).
- LR-17 `security.txt`.
- Docs: `docs/wiki/config/incident-response.md` skeleton; launch checklist gains a "Legal" go-live section.

### Phase 1 — Go-live blocker: publish the documents

Requires counsel's text for Terms, Privacy, Organizer Terms, Copyright / content policy, the card-authorization label, the refund clause, and the subscribe-step disclosure (dark until `BILLING_ENABLED`).
- Drop the files in `frontend/content/legal/`, set versions, flip `NEXT_PUBLIC_LEGAL_PAGES_ENABLED=true`.
- Footer on all public pages incl. custom domains (LR-04), acceptance sentence + optional checkbox per Q2, signup checkbox live, PAID-form mandate checkbox live with counsel's label.
- LR-09 public report form + email intake (queue handled by hand from a shared mailbox until phase 2).
- Register the DMCA agent; publish the agent contact on `/legal/copyright`.
- Manual privacy-request process documented (7.3) with a mailbox; the public `/legal/privacy-request` form can ship as a mail-to until phase 2.
- LR-16 application email labelling.
- Accessibility statement page (`/legal/accessibility`) after one audit pass.
- Launch checklist items ticked: entity details, DMCA registration, mailboxes (`legal@`, `privacy@`, `security@`, DMCA), vendor DPAs recorded.

### Phase 2 — Operational workflows in product

- LR-10/11 SYSTEM_ADMIN content-report queue, image disable, notices, counter-notice timers, strikes.
- LR-12 self-service export / delete, cross-org privacy request queue, staff self-delete, organization closure with grace period.
- LR-13 remaining retention jobs; image purge scheduling.
- SR-01 audit log + viewer; SR-05 metrics protection (may land with spec 020).
- LR-06 version-bump interstitial and release process (7.7).
- 7.5 suspension workflow with `OrganizationStatusEvent` and emails.

### Phase 3 — Conditional on feature flags and business changes

- `BILLING_ENABLED`: subscribe-step disclosures live, subscription confirmation / renewal emails, `SUBSCRIPTION_TERMS` acceptance; portal cancel verified.
- `STRIPE_CONNECT_ENABLED`: payouts interstitial, `CONNECT_TERMS` acceptance, Organizer Terms annex live.
- Spec 013 messaging: unsubscribe route, `List-Unsubscribe`, consent-provenance gate, sender address rules.
- Any analytics / ads / EU targeting: cookie consent banner and Privacy Policy cookie table (LR-14 will fail CI first).
- Spec 014 public vendor profiles: applicant consent to public display (new `LegalDocument` value `PUBLIC_PROFILE`), profile takedown path reuse.
- CCPA-style thresholds reached (Q17): "Do not sell or share" link and request metrics reporting.

## 14. Acceptance criteria and test cases

Grouped by requirement; contract tests in `backend/tests/contract/`, unit in `backend/tests/unit/` and `frontend/src/**/__tests__`, E2E in `frontend/e2e/` (sign in with `signInAsStaff`).

**Legal pages and versions**
- AC-01 `GET /legal/terms`, `/legal/privacy`, `/legal/organizer-terms`, `/legal/copyright`, `/legal/accessibility` return 200 with the front-matter title when the flag is on; `/terms` → 308 `/legal/terms`. E2E on the platform host **and** on a stubbed ACTIVE custom domain host header.
- AC-02 Unit: `LEGAL_VERSIONS` (frontend) deep-equals `LEGAL_VERSIONS` (backend); mismatch fails CI (same pattern as the fees fixtures).
- AC-03 With the flag off, the checkout page renders no "you agree" sentence and no `/legal` links; with it on, the sentence and links are present within the form above the pay button.

**Consent capture**
- AC-04 Contract: `POST /orders` with current versions creates one `LegalAcceptance` per document with `source = CHECKOUT`, `referenceType = 'Order'`, `email` = order email, `ipHash` set, raw IP absent; with a stale version → `400 LEGAL_VERSION_STALE` and no order or reservation.
- AC-05 Contract: PAID form with `chargeTiming = APPROVAL`: submission without `cardAuthorization: true` → 400; with it → `Application.cardAuthorizationAcceptanceId` set, `presentedText` equals the label the page showed (sent by the client and re-validated against the server-rendered template), and the Checkout Session id is attached after creation. FREE forms never require it.
- AC-06 Contract: `POST /signup` without `acceptOrganizerTerms: true` → 400; with it → `ORGANIZER_TERMS` + `PRIVACY` acceptances linked to the new organization and user.
- AC-07 Contract: buyer verify records a `CONTACT` acceptance once per version; a second sign-in on the same version adds none.
- AC-08 Contract: marketing flag changes from checkout, apply and admin set `emailSubscribedAt` / `emailSubscribedSource`; admin change without `reason` → 400; unsubscribe sets `emailUnsubscribedAt` and clears the flag.

**Refund disclosure**
- AC-09 E2E: checkout for a tier with `isRefundable = false` shows "Non-refundable" on that line; with `refundPolicyText` set on the organization the block is visible above the pay button; the confirmation email fixture contains both.

**Erasure and retention**
- AC-10 `backend/src/api/routes/customers.js` no longer exists; `GET /customers/x/delete-data` → 404.
- AC-11 Contract: buyer self-delete flow — request → verification token purpose `DELETE_CONFIRM` → confirm → after the cooling window the sweep anonymizes per §8.4: `Contact.email` tombstoned, `note = null`, tokens deleted, applicant images disabled, orders and `PaymentTransaction` untouched and still joinable, `LegalAcceptance.email` tombstoned but rows present; with a PENDING order the request is refused with `409 OPEN_TRANSACTIONS`.
- AC-12 Contract: cross-org privacy request for one email anonymizes every `Contact` with that email across organizations and records `scope` with each organization id.
- AC-13 Contract: staff self-delete refused while sole ADMIN or platform owner; otherwise `User` tombstoned, `Account` rows gone, `Refund.initiatedBy` unchanged.
- AC-14 Unit: token purge sweep deletes `BuyerLoginToken` / `VerificationToken` older than `expiresAt + 7 d` and nothing newer.

**Content reports**
- AC-15 Contract: `POST /legal/reports` with a copyright complaint missing any sworn statement → 400 listing the missing elements; complete → 201 with case id, `ContentReport.status = RECEIVED`, one `ContentReportEvent`, intake email sent; rate-limited per IP (spec 020 factory).
- AC-16 Contract: SYSTEM_ADMIN disable on an `Image` → `GET /images/:id/:hash/:variant` → 404 and the storefront renders the fallback; restore before `restoreNotBefore` → 409; after → 200 and image served again; every action appends an event with the actor id.
- AC-17 Contract: an `ORGANIZER` or `ADMIN` calling any `/admin/system/reports*` route → 403.

**Audit and security**
- AC-18 Contract: SYSTEM_ADMIN fetching `/admin/customers` with an `X-Jump-Org` for an organization they are not a member of writes an `AuditLog` row with `action = 'contact.list.cross_tenant'`; ADMIN of that org writes none.
- AC-19 Contract: EIN and DOB are absent from list responses, masked in detail responses (`***-**-1234`, year only) and revealed only by the explicit `?reveal=1` on the edit dialog endpoint, which writes an audit row; DB column holds ciphertext (assert not equal to plaintext and decrypts).
- AC-20 `GET /.well-known/security.txt` → 200 `text/plain` with `Contact:` and a future `Expires:` on both apps.
- AC-21 Unit (frontend): the tracker guard passes on the current tree and fails when a test fixture injects a `<script src="https://www.googletagmanager.com/...">`.

**Version bumps**
- AC-22 E2E: bump `ORGANIZER_TERMS` major in a test fixture → ADMIN sees the interstitial on `/admin`, cannot navigate until accepted, acceptance row `source = ADMIN_INTERSTITIAL`; `ORGANIZER` role sees the banner only.

**Emails**
- AC-23 Unit: application message rendering includes "Sent by {Org} through Jump", the organization's postal address, Reply-To = organization email; a PAID form cannot be opened (`status = OPEN`) while the organization's address is empty → 400 with a message pointing to Settings › General.
- AC-24 Unit: card-authorization receipt email contains the accepted `presentedText`, amount and due window; subscription confirmation (flag on) contains price, trial end, renewal date and the cancel path.

**Accessibility**
- AC-25 Chrome DevTools a11y audit on checkout, apply (PAID), signup name step, `/legal/report` and `/legal/terms`: no critical findings; all new checkboxes have programmatic labels and visible focus.

**Documentation**
- AC-26 `docs/wiki/config/production-launch-checklist.md` has a "Legal" section whose items map 1:1 to phase 1; `docs/wiki/config/privacy-register.md` exists and lists every host in the CSP / script allowlist and every sub-processor with the DPA reference; `specs/STATUS.md` row 023 updated per phase.

---

## Appendix A — Evaluation matrix (requested classification)

| Item | Classification | Trigger (feature) | Obligation type | Needs |
|---|---|---|---|---|
| Terms of Service (buyer / applicant) | **Required** | checkout, apply, accounts, dead `/terms` link | contractual; FTC § 5 exposure (verify) | doc + product + process |
| EULA | Probably unnecessary | no distributed software | — | — (revisit if a scanner app ships) |
| Privacy Policy | **Required** | all PII in §3.1; processors; Google OAuth; Stripe | federal (FTC), NC ITPA, contractual | doc + product + process |
| Organizer Terms / platform agreement (incl. Connect, subscription, fees) | **Required** | `/signup`, Connect, Billing, content upload, message templates | contractual (Stripe platform terms), NC § 75-41 if consumer (verify) | doc + product + process |
| Refund / cancellation policy disclosure | **Required** | `isRefundable`, self-service refunds, overdue policy | card-network rules, FTC / NC UDAP (verify) | product + doc section + decision Q4 |
| Card-on-file authorization | **Required** | `mode: 'setup'` + `off_session` charge | contractual (Stripe / networks) | product + short text |
| Copyright / content policy page + complaint intake | **Strongly recommended (launch)** | public images / text hosted on Jump URLs | 17 U.S.C. § 512 (verify), best practice | doc + product (form) + process |
| DMCA agent registration | **Strongly recommended (launch)** | same | federal (safe-harbor condition) | process |
| Takedown / counter-notice / repeat-infringer workflow | Recommended (phase 2 build; manual from launch) | same | federal (safe-harbor conditions) | product + process + doc |
| Safe-harbor qualification | Conditional — counsel | revenue share on ticket sales | federal | legal analysis |
| Trademark / publicity / privacy / defamation complaint handling | Recommended | public org / applicant content | best practice; § 230 (verify) | process + doc section |
| Acceptable Use Policy | Recommended as a Terms section | UGC, spec 020 abuse | best practice | doc section + suspension product |
| Community Guidelines | Probably unnecessary | no social features | — | revisit with spec 013 / 014 |
| Vendor / data-processing agreements | Recommended depending on Q7 | organizers see buyer data; sub-processors | contractual; GDPR only if EU | doc + register |
| AI disclosure | Unnecessary | no AI | — | — |
| Blockchain disclosures | Unnecessary | no chain | — | — |
| Accessibility statement | Recommended | public consumer checkout | ADA Title III litigation risk (verify) | doc + process + fixes |
| Security / incident-response policy | Strongly recommended | PII + payments | NC § 75-65, other states, Stripe (verify) | process + product (security.txt, audit) |
| Cookie consent mechanism | Probably unnecessary now; conditional | only necessary cookies | ePrivacy only if EU; none federal / NC (verify) | product guard (LR-14) |
| Organizer / seller / marketplace / payment terms | Covered by Organizer Terms | — | — | — |
| Independent-contractor / partner agreements | Out of app scope | — | — | process if contractors touch prod |
| Ownership / certification | Flag only | — | — | counsel if pursued |

## Appendix B — Files touched (indicative)

- `packages/db/prisma/schema.prisma` + migrations: §8 models and fields.
- `backend/src/config/legal.js`, `backend/src/services/LegalService.js` (acceptances, status), `ContentReportService.js`, `PrivacyRequestService.js`, `AuditService.js`, `FieldCrypto.js`; routes `legal.js`, `admin/system/*.js`; edits to `orders.js`, `applications.js`, `signup.js`, `buyerAuth.js`, `images.js`, `EmailService.js`, `server.js` (remove `customers.js`, sweeps, `security.txt`).
- `frontend/content/legal/*.md`, `frontend/src/lib/legal.ts`, `frontend/src/app/legal/[slug]/page.tsx`, `/legal/report`, `/legal/privacy-request`, `components/LegalFooter.tsx`, edits to checkout, apply, signup, account, confirmation, Settings › General, `AdminRoute.tsx`, `middleware.ts` (tenant passthrough for `/legal/*`), `next.config.mjs` redirects, `public/.well-known/security.txt`.
- Docs: `docs/wiki/config/production-launch-checklist.md` (Legal section), `privacy-register.md`, `incident-response.md`, `docs/wiki/features/legal-compliance.md` after phase 1 via `/doc-feature`, `specs/STATUS.md`.
