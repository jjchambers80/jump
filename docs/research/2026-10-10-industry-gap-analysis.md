---
type: research
title: Industry research handoff vs Jump: gap analysis and triage items
status: reference
created: 2026-10-10
updated: 2026-10-10
project: jump
tags: [jump, research, gap-analysis, roadmap, ticketing, analytics, crm, marketing, event-day, finance, triage]
source: /Users/jj/Downloads/eventimus_industry_research_handoff.md (EVENTIMUS industry research handoff, prepared 2026-10-10); Jump code at origin/main 2ebf3ea; open PRs from `gh pr list` on 2026-10-10
---

# Industry research handoff vs Jump: gap analysis

**Question.** The handoff document lists what organizers and venues want from a ticketing and event platform. Which of those does Jump already do, which does it do partly, and which are missing? What should go on the board next?

**About the citations.** Jump paths point to `origin/main` at `2ebf3ea`. The local checkout is detached at an older commit (`3240a3c`, PR #210), so read them with `git show origin/main:<path>`. No web research was done. The handoff's external claims were not re-checked.

## 1. Source and summary

**Source:** `/Users/jj/Downloads/eventimus_industry_research_handoff.md`, "EVENTIMUS — Ticketing & Event Management Industry Research Handoff", prepared 2026-10-10. It calls itself a "discovery-stage strategic synthesis — not a validated product requirements document". When this analysis disagrees with that file, the file wins on what the handoff says. The code wins on what Jump does.

**What it says**

- **Thesis (§1).** Sell an "Event Revenue & Operations Platform", not a cheaper ticketing clone. It should help operators sell more, see profitability, own consented audience relationships, and do less admin work.
- **ICP (§1, §8).** Independent music venues and regional promoters running frequent shows.
- **Ten ranked gaps (§3).** 1 audience acquisition and conversion; 2 disconnected systems; 3 fan data ownership; 4 fees and checkout; 5 profitability forecasting; 6 payout timing; 7 rigid event setup; 8 event-day reliability; 9 resale and anti-abuse; 10 onsite revenue.
- **Six concepts (§4).** Revenue Intelligence (called the top differentiator), Unified Event Workspace, Permissioned Audience CRM, Transparent Commerce, Event Profitability + Settlement, Event-Day Control Center.
- **Roadmap (§7).** Phase 1 commerce foundation → 2 growth and intelligence → 3 venue and promoter operations → 4 connected ecosystem.
- **UX principles (§9).** Role-based IA, progressive complexity, action-oriented dashboards, auditability, accessible mobile checkout.

**How strong the evidence is.** The document is mostly secondary or unsourced. Treat its priorities as hypotheses.

| Claim | Source given | Strength |
|---|---|---|
| 64% of independent stages unprofitable in 2024 | NIVA *State of Live*. The link goes to the nivacalifornia.org chapter page, not a NIVA report PDF | Secondary. Re-check the original |
| 67% likely to switch; 47% want low fees; 36% call fees a major frustration | Loopyah 2026 survey (n=350), vendor-published | Directional only, as the doc itself says |
| Gap ranking §3 | None ("strategic judgments") | **Unsourced** |
| Value and effort scores §6 | None ("provisional") | **Unsourced** |
| "Observable pain" column in §3 | No citation on any row. Reddit threads in §13 are anecdotal | **Unsourced / anecdotal** |
| Competitor positioning §5 | vivenu and Eventbrite home pages only | Unverified ("not a completed audit") |

**ICP mismatch to flag.** The doc's ICP is music venues and promoters. Jump's built depth and live customers are conventions, vendor markets (applications, floor maps, booths, door check-in) and nonprofits (spec 047 donations). The ranking below weights fit with Jump's direction, so it differs from the doc's order. Several music-venue items (artist settlement, booking calendar, artist portals) rank low here for that reason. They are not low-value in general.

## 2. Capability matrix

Status key: **Shipped** · **Dark** (shipped, behind a flag that is off) · **Partial** · **PR** (open PR in flight) · **Planned** (spec or roadmap only) · **Missing**.

### Phase 1: commerce foundation (§7 Phase 1, §4.4)

| Market demand | Doc evidence / priority | Jump status | Evidence | Gap notes |
|---|---|---|---|---|
| Event creation, tiers, inventory | §7 P1; §6 "flexible event creation" 4/2 | Shipped | `Event`, `PriceTier` (sale windows, min/max, `TierVisibility` PUBLIC/PRIVATE/HIDDEN), `TierPreset`; `EventService.duplicateEvent` (`backend/src/services/EventService.js:163`); row-locked capacity | Single `Event.date` only (see recurring) |
| Branded checkout | §3 gap 4; §4.4 | Shipped | Custom domains (`OrganizationDomain`, spec 007/008), `BrandScope`, theme editor (spec 038), `frontend/src/app/checkout/[eventId]/page.tsx` | The payment step is Stripe-hosted Checkout |
| All-in price display | §3 gap 4; §4.4; §9 "trust by design" | Shipped | `docs/wiki/features/all-in-pricing.md`, `backend/src/services/FeeService.js` ↔ `frontend/src/lib/fees.ts` | — |
| Configurable fee allocation (absorb vs pass) | §3 gap 4; §4.4 "fee configuration" | Partial | `FeeMode { PASS ABSORB }` on `Order` and per line; application forms choose it. Ticket orders hard-code `feeMode: 'PASS'` (`backend/src/services/OrderService.js:347`, comment "ticket fees are always passed to the buyer") | Organizers cannot absorb ticket fees |
| Wallet payments (Apple/Google Pay, Link, BNPL) | §4.4 | Shipped | `backend/src/config/payments.js` (cards with Apple/Google Pay on the hosted page; Link, Cash App, Affirm…), Settings › Payments › Methods | — |
| Mobile wallet ticket passes | §4.4 (implied) | PR (draft, tabled) | PR #15 (spec 006) | Waiting on Apple/Google credentials |
| Attendee management | §7 P1 | Shipped | `/admin/events/[eventId]/attendees`, `PATCH /admin/tickets/:ticketId/attendee`, orders CSV with Tickets toggle (`GET /admin/orders/export.csv`) | No CSV on the attendees page itself |
| Payment reconciliation | §7 P1; §3 gap 6 | Shipped | One ledger (spec 024): `PaymentTransaction`, `Refund`, `Dispute` (`docs/wiki/features/disputes-chargebacks.md`), tax report `/admin/settings/tax/report`, `/admin/finance` | — |
| Basic reporting | §7 P1 | Shipped | `DashboardService.overview` (14-day trend, upcoming, attention list), `GET /organizations/:orgId/events/:eventId/analytics` (per-tier sales, redemption, revenue), add-on purchasers CSV, `/admin/analytics` | Retrospective only (see Phase 2) |
| Scanning + duplicate-scan handling | §7 P1; §4.6 | Shipped | `POST /tickets/scan` and `/redeem` (`backend/src/api/routes/tickets.js`; 409 on already redeemed/voided), `SCANNER_API_KEY`, `/admin/orders/scan` | Online only (see event-day) |
| Refunds | §7 P1 | Shipped | `RefundService.refundOrder`, `RefundPolicyService` (self-serve policy and fee, spec 031) | — |
| Accessible, mobile-first buyer flow | §9 | Shipped | `docs/wiki/features/checkout-conversion-ux.md` (WCAG 2.1 AA audit, CTA always on screen) | — |
| Operational reliability / anti-abuse | §7 P1; §3 gap 9 | Partial | Spec 020 phase 1 (limiters, per-buyer hold cap, abandoned-checkout sweep); `webhook-reliability.md`; `observability.md` | Spec 020 phases 2–3 (helmet/CSP, Turnstile, edge layer) open |

### Phase 2: growth and customer intelligence (§3 gaps 1 and 3, §4.1, §4.3)

| Market demand | Doc evidence / priority | Jump status | Evidence | Gap notes |
|---|---|---|---|---|
| Sales-velocity / pacing and attendance forecast | §4.1 (top differentiator); §6 5/3 | Missing | Only a 14-day org-wide trend (`DashboardService.js:10` `TREND_DAYS = 14`). No per-event cumulative curve or forecast | Data exists (`Order.paidAt`, tiers) |
| Comparison with comparable past events | §4.1; §7 P2 | Missing | — | Needs a "similar event" key (venue, category, day-of-week) |
| Campaign / channel attribution (UTM, tracking links) | §3 gap 1; §4.1 | Missing | No `utm`, `source` or `referrer` on `Order` (schema) | Small schema add plus checkout capture |
| Checkout funnel analytics | §4.4 | Missing | The abandoned-checkout sweep cancels PENDING orders but nothing reports funnel drop-off | — |
| Under-performance alerts / next-best action | §4.1; §9 "action-oriented dashboards" | Partial | Dashboard "attention" list (drafts, review queue) in `DashboardService.js`. No sales alerts | — |
| Customer CRM: history, segments | §3 gap 3; §4.3; §6 5/3 | Partial | `/admin/customers` with segments Prospect/New/Repeat/Lapsed (`backend/src/services/CustomerService.js:18`), tags, sources (tickets/rsvp/subscribed/form), timeline, comments (spec 032) | No LTV/spend ranking, genre/category affinity or cohort view |
| Marketing consent capture | §4.3 "critical constraint" | Shipped | `Contact.emailSubscribed` + `emailSubscribedAt/Source`, `Order.optInMarketing`, `/account/unsubscribe`, `LegalAcceptance` | — |
| Consented campaigns / automations | §3 gap 1; §4.1 "automated re-engagement"; §4.3 | Planned (roadmap only) | `docs/roadmap.md` candidate "013 messaging" (segment sends, delivery status, automations). Only transactional mail exists (`EmailService`: confirmations, RSVP reminders, application messages) | No spec. Store sender PR #280 is a prerequisite |
| Abandoned-checkout recovery | §3 gap 1 (conversion) | Missing | Sweep exists (spec 020); no email | Consent/legal check needed |
| Audience export | §4.3 "exportability" | Partial | Per-contact JSON export (`GET /admin/customers/:contactId/export`), orders CSV, buyer self-export | No customer-list CSV |
| Cross-party data sharing (artist ↔ venue ↔ promoter) | §4.3 | Missing | Tenancy is strictly per-org (`Contact` unique on `organizationId + email`) | Legal (controller/processor) first. Low fit |

### Phase 3: venue and promoter operations (§3 gaps 2, 5, 6; §4.2, §4.5)

| Market demand | Doc evidence / priority | Jump status | Evidence | Gap notes |
|---|---|---|---|---|
| One authoritative event workspace | §3 gap 2; §4.2 | Shipped | Spec 037 event workspace (Overview, Applications, Map, RSVPs, Attendees, Analytics, History tabs under `/admin/events/[eventId]/*`) | — |
| Audit trail | §9 "auditability"; §4.6 | Shipped | Spec 048 `AuditLog`, Settings › Activity log, event History tab (`docs/wiki/features/activity-log.md`) | — |
| Attendee comms when event details change | §4.2 | Partial / PR | Cancel emails RSVPs only (`EventService.js:450`, `sendCancellationNotification`). PR #180 (open) emails ticket holders and voids tickets | No "event changed" message or one-off message to ticket holders |
| Staff permissions, event-day roles | §4.2; §4.6; §9 role-based IA | Partial | `OrganizationMember` with `MemberRole { ORGANIZER ADMIN }`, staff invites (Settings › Users), 2FA. Roadmap candidate "check-in role" (SCANNER, kiosk, PII masking) | No scanner-only or per-event role |
| Production checklist / task assignment | §4.2 | Missing | Only the onboarding checklist (`/admin/onboarding`) | Low fit for small orgs |
| Event P&L, costs, break-even | §3 gap 5; §4.5; §6 5/3 | Missing | No cost/expense model. Revenue side exists (`PAID_ORDER_STATUSES`, `Order.orgReceives`) | — |
| Artist settlement (guarantees, % deals) | §4.5 | Missing | — | Music-venue ICP only |
| Payout schedule and visibility | §3 gap 6; §6 4/3 | Dark | Connect on the org's own Stripe account (spec 047 D0-S), payout interval/anchor (`PATCH /admin/settings/payments/connect/payouts`), `/admin/finance/payouts`. Behind `STRIPE_CONNECT_ENABLED` | Off in prod. No cash-flow estimate |
| Booking / calendar holds | §4.2; §7 P3 | Missing | — | Music-venue ICP only |
| Integrations / API | §4.2; §7 P4 | Partial | Remote MCP server with write tools (`mcp/src/writeTools.js`: events, venues, tiers, pages, blog), OAuth 2.1 (spec 045), developer tokens scoped `['themes']` only (`DeveloperTokenService.js:17`) | No outbound webhooks, no read API for orders/attendees, no accounting/POS connectors |

### Flexible setup, event day, onsite, resale (§3 gaps 7–10, §4.6)

| Market demand | Doc evidence / priority | Jump status | Evidence | Gap notes |
|---|---|---|---|---|
| Promo / discount / access codes | §3 gap 7 ("pricing rules"); §4.4 | Missing | No discount model. `TierVisibility` HIDDEN/PRIVATE gives unlisted tiers. `ADJUSTMENT` lines exist on application orders only | Table stakes for small organizers |
| Recurring events / series / multi-date | §3 gap 7; §9 progressive complexity | Missing | `Event.date` is one instant; no end date or series. Duplicate is the workaround | — |
| Season passes, memberships, packages | §3 gap 7; §2 performing arts | Missing | "subscription" hits are platform billing only (`BillingService`) | — |
| Timed entry | §9 | Missing | `CapacitySlot` is an application enum, not time slots | — |
| Reserved / assigned seating | §11 risk; §2 performing arts | Missing | Floor maps are vendor booths (`BoothKind { BOOTH TABLE }`) | Large. Outside current ICP |
| Ticket upgrades | §4.4 | Missing | — | — |
| Relevant add-ons (merch, parking, VIP) | §3 gap 10; §4.4 | Shipped | Spec 012 `AddOn`, `OrderAddOn`, `AddOnProduct`, sales report + purchasers CSV | Pre-sale only |
| Onsite POS / box office / comps | §3 gap 10; §6 4/4 | Missing for tickets | `OfflinePaymentMethod { CHEQUE CASH BANK_TRANSFER COMPED OTHER }` exists for **applications** only. No staff ticket sale or comp issuance | — |
| Revenue-per-attendee reporting | §3 gap 10 | Missing | Inputs exist (orders, add-ons, redemptions) | Small report |
| Offline-capable scanning | §3 gap 8; §4.6; §9 | Partial | Vendor door check-in queues offline (`frontend/src/app/admin/events/[eventId]/check-in/useDoorQueue.ts:150`). Ticket scanner is online-only | Reuse the door-queue pattern |
| Live occupancy / device status / incidents | §4.6 | Partial | Dashboard stats poll every 5 s (redeemed count), `checkedInToday` in overview | No live door view, device status or incident log |
| Waitlist for sold-out events | §3 gap 9 | Missing | `WAITLISTED` exists only on `ApplicationStatus` | — |
| Ticket transfer with history | §3 gap 9 | Missing | `Ticket.contactId` is fixed; no transfer path | — |
| Resale rules / verified exchange | §3 gap 9; §6 4/5 | Missing | — | Legal and fraud heavy (doc: effort 5) |
| Fraud / chargeback handling | §11 risk | Shipped | Disputes (spec 037), hold cap, rate limits | — |
| Multi-venue reporting | §7 P4 | Partial | Reports are org-wide across venues | No per-venue breakdown |
| Artist portal | §7 P4 | Missing | — | Low fit |
| Subscription + per-ticket business model | §8 | Dark | `BILLING_ENABLED`, `PlatformPlan { FREE STARTER }`, spec 022 phase 2 | Price and §9 decisions open |

**Not in the doc, checked for completeness:** SMS (none), embeddable checkout widget (none; `embed` hits are video/gallery/billing), multi-currency (`currency` defaults to `usd`; spec 021 is proposed and display-only), i18n (language toggle is stored only), donations (spec 047 D0 merged; D1/DV planned; no `Donation` model yet).

**Counts (52 rows):** Shipped 15 · Dark 2 · Partial 11 (one with open PR #180) · PR-only 1 · Planned 1 · Missing 22 (incl. POS, missing for tickets only).

## 3. Gaps ranked

Score = doc demand strength (§3 rank and §6 value) × size of gap × fit with Jump's direction (small/medium organizers, conventions and vendor markets, nonprofits). Each is High/Medium/Low.

| # | Gap | Demand | Gap size | Fit | Why here |
|---|---|---|---|---|---|
| 1 | Promo / access codes | H (gap 4/7, P1 foundation) | Full | H | Table stakes that every small-org competitor has. Low effort |
| 2 | Organizer-absorbed ticket fees | H (gap 4; 36% fee frustration, directional) | Small | H | Model and fee math already support ABSORB. One hard-coded line |
| 3 | Consented email campaigns | H (gaps 1+3, §6 5/3) | Full | H | Consent, segments and tags exist. Replaces Mailchimp exports. Roadmap 013 |
| 4 | Sales pacing + past-event comparison | H (§4.1 top differentiator) | Full | H | Data already in the ledger. The doc's headline differentiator |
| 5 | Channel attribution (UTM / tracking links) | H (gap 1) | Full | H | Cheap capture now. Data can't be backfilled later |
| 6 | Event-change and cancellation notices | M (§4.2) | Partial (PR #180) | H | Trust and support load. Mostly built |
| 7 | Offline ticket scanning + scanner role | M (gap 8, §4.6) | Partial | H | Pattern proven at the vendor door. Roadmap check-in role |
| 8 | Sold-out waitlist | M (gap 9) | Full | M | Recovers lost sales for conventions |
| 9 | Box office: door sales and comps | M (gap 10, §6 4/4) | Full for tickets | H | Conventions sell at the door. Offline methods exist for applications |
| 10 | Event P&L / break-even | H (gap 5, §6 5/3) | Full | M | Differentiator. Needs a cost model |
| 11 | Customer-list export + spend/LTV | M (§4.3) | Partial | H | Small. Answers the data-ownership objection |
| 12 | Recurring / multi-date events | M (gap 7) | Full | M | Monthly markets and series |
| 13 | Ticket transfer | M (gap 9) | Full | M | Support-ticket reducer |
| 14 | Payout transparency (turn on Connect) | M (gap 6) | Dark | H | Mostly ops and launch checklist work, not code |
| 15 | Checkout funnel + abandoned-checkout recovery | M (§4.4) | Full | M | Needs consent rules settled |
| 16 | Revenue per attendee | M (gap 10) | Full | M | One report over existing data |
| 17 | Outbound webhooks / read API | M (§7 P4) | Partial | M | Integration ask from larger orgs |
| — | Not recommended now: reserved seating, resale exchange, artist settlement/portal, booking calendar, season memberships, timed entry, cross-party data sharing | Doc P4 or ICP-specific | Full | L | Large or legally heavy, and fit the music/arts ICP that Jump isn't serving yet |

## 4. Triage items (priority order)

Each item is ready to paste as a Hermes card. "Doc" cites the handoff section.

### T1. Add promo and access codes to ticket tiers
- **Demand:** Doc §3 gap 7 (pricing rules), §4.4, §7 Phase 1. Unsourced but table stakes.
- **Build on:** `PriceTier` (`TierVisibility` HIDDEN/PRIVATE for unlocked tiers), `OrderService.createOrder`, `FeeService.js` ↔ `frontend/src/lib/fees.ts` (parity pair, Gotcha 12), `frontend/src/app/checkout/[eventId]/page.tsx`, abuse limiters (`makeLimiter`).
- **Scope:** M. Model is `DiscountCode` (percent/amount, tier scope, usage cap, window) plus an access-code unlock for hidden tiers.
- **Dependencies:** Fee parity fixtures. Tax base on the discounted price (spec 009). Refunds must prorate.
- **Open questions:** Does a code discount apply before or after add-ons? Can codes stack? Should the platform fee apply to the discounted price?

### T2. Let organizers absorb ticket fees
- **Demand:** Doc §3 gap 4, §4.4 "fee configuration"; §1 fee-frustration figures (vendor survey, directional).
- **Build on:** `FeeMode` PASS/ABSORB already in schema and `FeeService` per line. Remove the hard-coded `feeMode: 'PASS'` at `backend/src/services/OrderService.js:347`. Add an event- or org-level setting. Update the all-in display.
- **Scope:** S.
- **Dependencies:** `lib/fees.ts` parity. Must not drift from the all-in pricing rule (FTC).
- **Open questions:** Should it be set per event or per org? Should a split option be offered?

### T3. Send consented email campaigns to customer segments
- **Demand:** Doc §3 gaps 1 and 3, §4.1 "automated re-engagement", §4.3. Value 5 / effort 3 (§6, unsourced scores).
- **Build on:** `Contact.emailSubscribed` + provenance, tags, `CustomerService` segments and sources, `EmailService` (Resend), `/account/unsubscribe`, store sender PR #280 (`EMAIL_FROM_DOMAIN`), roadmap "013 messaging".
- **Scope:** L. Split it: (a) one-off send to a saved segment with unsubscribe and delivery status; (b) event-relative automations later.
- **Dependencies:** PR #280 merged. Verified sending domain. CAN-SPAM footer (spec 023 counsel). Rate limits.
- **Open questions:** Use Resend Broadcasts or our own sender? What is the deliverability plan per org domain? Is SMS out of scope?

### T4. Show per-event sales pacing vs past events
- **Demand:** Doc §4.1 (named top differentiator), §7 Phase 2, §9 "action-oriented dashboards".
- **Build on:** `getEventAnalytics` (`backend/src/services/EventService.js`), `DashboardService` day bucketing (`dayKey`, `lastDays`), `Order.paidAt`, the event workspace Analytics tab.
- **Scope:** M. Cumulative sales curve by days-before-event, overlaid with the org's prior events (same venue/category), plus a simple linear forecast and a "behind pace" flag.
- **Dependencies:** Venue time zones (spec 033) for the day axis.
- **Open questions:** How should "comparable" be defined? How many past events are needed before showing a forecast?

### T5. Capture UTM and tracking-link source on orders
- **Demand:** Doc §3 gap 1 ("attribution is fragmented"), §4.1 campaign ROI.
- **Build on:** `Order` (new `source`/`utm_*` columns), storefront event page → checkout carry-through, orders CSV, event analytics.
- **Scope:** S/M. Organizer-made tracking links come later.
- **Dependencies:** Privacy notice wording (spec 023).
- **Open questions:** Use first-touch or last-touch? Should it cover RSVPs too?

### T6. Notify ticket holders of event changes and cancellation
- **Demand:** Doc §4.2 "coordinated attendee communications".
- **Build on:** PR #180 (cancel → email + void), `sendCancellationNotification` (`EventService.js:450`), `audit` diff on event updates.
- **Scope:** S. Merge #180, then add a "notify attendees" prompt when date, time or venue changes.
- **Dependencies:** PR #180 review. Refund-on-cancel policy.
- **Open questions:** Should a cancellation auto-refund, or leave it to staff?

### T7. Make ticket scanning work offline; add a scanner role
- **Demand:** Doc §3 gap 8, §4.6, §9 "graceful offline operation"; roadmap "check-in role".
- **Build on:** `useDoorQueue.ts` offline queue (vendor door, spec 036), `POST /tickets/redeem` (409 on duplicate), `MemberRole`, `SCANNER_API_KEY`.
- **Scope:** M. Queue redemptions offline, cache the event's valid barcodes, add a `SCANNER` member role limited to scan screens, and add a live arrived/capacity counter.
- **Dependencies:** A conflict rule for a ticket redeemed on two offline devices.
- **Open questions:** Can offline mode accept a ticket the server would reject? Should PII be masked for volunteers?

### T8. Add a waitlist for sold-out tiers
- **Demand:** Doc §3 gap 9.
- **Build on:** `PriceTier` capacity and release paths (refunds, sweep, `AddOnService.release`), `EmailService`, `Contact`.
- **Scope:** M. Join list → notify-on-release with a time-boxed claim link.
- **Dependencies:** Capacity locking (`SELECT … FOR UPDATE`).
- **Open questions:** First-come or notify everyone? Should a claim hold inventory?

### T9. Sell and comp tickets from a staff box office
- **Demand:** Doc §3 gap 10, §6 "onsite POS" 4/4.
- **Build on:** `OfflinePaymentMethod` (CASH/COMPED…, applications today), `OrderService`, `PaymentSource.OFFLINE`, admin order pages.
- **Scope:** M for cash, comp and card-link. L if Stripe Terminal is added.
- **Dependencies:** One-ledger rules (Gotcha 17). Tax on cash sales. Scanner role (T7).
- **Open questions:** Is Stripe Terminal in v1? How should cash drawers be reconciled?

### T10. Track event costs and show an event P&L
- **Demand:** Doc §3 gap 5, §4.5, §6 value 5 / effort 3.
- **Build on:** Ledger revenue (`PAID_ORDER_STATUSES`, `Order.orgReceives`, fees, tax), application revenue (booth fees), add-ons, the event workspace.
- **Scope:** M. Add an `EventCost` model (category, amount, fixed or per-head), a P&L tab, and a break-even ticket count. Artist deal rules are out.
- **Dependencies:** None hard.
- **Open questions:** Should forecast and actual be shown side by side? Is export to accounting (CSV) enough?

### T11. Export the customer list with spend and LTV
- **Demand:** Doc §4.3 "exportability", "customer-lifetime-value".
- **Build on:** `CustomerService.filterAndSortCustomers`, `/admin/customers` filters, the audited CSV download pattern (`/admin/orders/export.csv`).
- **Scope:** S.
- **Dependencies:** Audit trail (download logging, spec 048). Erasure suppression.
- **Open questions:** Should the export include non-subscribed contacts? Should it be ADMIN-only?

### T12. Support recurring and multi-date events
- **Demand:** Doc §3 gap 7, §9 progressive complexity.
- **Build on:** `EventService.duplicateEvent` (`EventService.js:163`), event templates, venue time zones.
- **Scope:** L. Start with "create series" producing linked events. Avoid multi-session tickets in v1.
- **Dependencies:** Storefront listing grouping.
- **Open questions:** Should series be linked events or one event with occurrences? What do edits do (this one / all future)?

### T13. Let buyers transfer tickets to someone else
- **Demand:** Doc §3 gap 9 ("poor transfer experience").
- **Build on:** `Ticket.contactId`, patron account (spec 040), `Contact` per-org tenancy (`organizationId_email`), audit log.
- **Scope:** M.
- **Dependencies:** Reissue the barcode and void the old QR. Org setting to disable transfers.
- **Open questions:** Is cutoff time configurable? Do transfers carry refund eligibility?

### T14. Turn on Connect payouts and show payout status
- **Demand:** Doc §3 gap 6, §9 "clearly explained payout status".
- **Build on:** Spec 047 D0-S direct charges, `/admin/finance/payouts`, `STRIPE_CONNECT_ENABLED`, launch checklist.
- **Scope:** S of code. Mostly ops.
- **Dependencies:** `docs/wiki/config/production-launch-checklist.md` Connect steps.
- **Open questions:** Is an "upcoming payouts" cash-flow estimate worth it in v1?

### T15. Report checkout drop-off and recover abandoned carts
- **Demand:** Doc §3 gap 1 (conversion), §4.4 "checkout analytics", §10 KPI "checkout success".
- **Build on:** Abandoned-checkout sweep (spec 020), PENDING orders, `optInMarketing`.
- **Scope:** M.
- **Dependencies:** Legal check on emailing non-consented abandoners (spec 023).
- **Open questions:** Should recovery be transactional (allowed) or marketing (needs consent)?

### T16. Report revenue per attendee per event
- **Demand:** Doc §3 gap 10.
- **Build on:** Event analytics, `OrderAddOn`, ticket redemptions.
- **Scope:** S.
- **Open questions:** Should the denominator be tickets sold or tickets scanned?

### T17. Publish outbound webhooks and a read API
- **Demand:** Doc §4.2 "integrations", §7 Phase 4.
- **Build on:** `DeveloperTokenService` (scopes today `['themes']`), OAuth (spec 045), MCP tools, `AuditLog`.
- **Scope:** M (`order.paid`, `ticket.redeemed`, `application.approved` webhooks + `orders:read` scope).
- **Open questions:** Should there be a Zapier app? How should webhook retries and signing work?

**Not carded (revisit if the ICP decision moves to music venues or performing arts):** reserved seating, resale exchange, artist settlement and portal, booking calendar, memberships and season passes, timed entry, cross-party audience sharing.

## 5. Open decisions this raises

1. **ICP.** The handoff targets music venues and promoters. Jump's built depth is conventions, vendors and nonprofits. Pick one before carding T10 settlement-style work.
2. **Positioning.** The doc's §5 caveat says "all-in-one" and "AI-powered" won't differentiate. T4 (pacing) and T10 (P&L) are the most defensible differentiators that Jump's ledger makes cheap.
3. **Evidence.** Before external use, re-verify the NIVA 64% figure against the original national report and treat the Loopyah numbers as vendor marketing (doc §1, §13).
