# Organizer Interview — Eventeny pain points (Gaming Geek Expo)

**Type**: Customer discovery interview
**Date**: 2026-09-15
**Interviewee**: Organizer of Gaming Geek Expo (Raleigh Convention Center, ~160 vendors) and Raleigh Retro Gamers (smaller mall / parking-lot events). Potential Jump client.
**Current provider**: [Eventeny](https://www.eventeny.com) (transcribed as "Vintony").
**Source**: [transcripts/2026-09-15-eventeny-organizer-interview.md](./transcripts/2026-09-15-eventeny-organizer-interview.md) — the transcript wins where this summary disagrees.
**Purpose**: Feed the [roadmap](../roadmap.md). Everything below is what the organizer reported; figures are their recollection, not verified against Eventeny's published pricing.

---

## 1. Organizer profile

| | |
|---|---|
| Events | Gaming Geek Expo (annual convention, Raleigh Convention Center); Raleigh Retro Gamers (RRG) recurring smaller events at Triangle Town Center and a parking lot at Hidden Block Games |
| Scale | 160 vendors at Gaming Geek 2026; booths priced $275–$1,200; ticketed attendance |
| Participant types | Attendees, vendors, sponsors, press, content creators, panelists, celebrity guests (entered manually by staff), volunteers |
| Team | Small. 8 of 10 Eventeny seats used; a co-organizer (Madison) and a designer (Julia) named |
| Tool stack | Eventeny (convention ticketing, applications, messaging, map, POS) · Square (RRG payments, CRM, invoicing) · spreadsheets (RRG vendor management) · Google Workspace mail merge (all real vendor communication) · Canva (map source) · Adobe Illustrator via designer (printed map) · WordPress (gaminggeekexpo site, every action link points at Eventeny) · City of Raleigh portal (vendor power orders) |
| Payment processor | Stripe (Eventeny is Stripe-only). Square at 2.9% for non-Eventeny sales |

The organizer's stated ideal: one central system for tickets, applications, communication, pages, and the floor map — without the fee load and branding takeover they get from Eventeny today.

---

## 2. Pricing intelligence (Eventeny, as reported)

### Subscription

| Item | Reported figure |
|---|---|
| Top standard tier | **$360/month**, 10 seats. Highest tier available without an enterprise deal |
| Lower tiers | ~$90–100/month. The jump to $360 was forced by one feature: the interactive map |
| Paid Feb–Sep 2026 | ~$3,260 in subscription |
| Seats | 10 max on the top tier; not sold per seat |

### Transaction fees

| Product | Reported fee | Notes |
|---|---|---|
| Tickets | ~$3,400 charged to the organizer to date **plus** ~3% charged to each buyer | Organizer calls this "double dipping". Organizer can absorb or pass fees |
| Vendor booth | $275 booth → **$303 at checkout** ($28, ~10.2%) | No tax on booths, so the delta is pure fees. Same rate on $900 and $1,200 booths |
| Merch POS (tablet) | ~7.5–8% per sale | Unclear whether Stripe processing is on top |
| Vendor badge add-on | $10 → ~$13 to the buyer | Organizer absorbed the fee to avoid vendor backlash |
| Power add-on (invoiced) | $125 → $8 fee | Organizer split it: vendor paid $129, organizer netted ~$120 |
| Vendor marketing e-blast | ~$80–90 **per state** | Eventeny emails its vendor base in that state about your event. Bought VA + SC; produced sign-ups two years running |

### Rough annual spend on one convention

Subscription ~$3,260 + ticket fees ~$3,400 + vendor-side fees (160 booths × ≥$28) ≥ ~$4,500 + POS and add-on fees. **Order of $11k+/year** flowing to Eventeny from a single event with 160 vendors, before Stripe processing. Half of it is invisible to the organizer because it is charged to buyers and vendors.

### Positioning takeaways for Jump

- The organizer measures fees at the **vendor's checkout screen** ("$275 becomes $303"), not in a rate card. Fee transparency and lower vendor-side fees are the sales pitch.
- A single-feature tier cliff (4× price for the map) is resented. Price on seats/volume, not by holding one feature hostage.
- Seat limits bite small teams because day-of volunteers consume seats. Volunteer/scanner seats should be free or unlimited.
- Stripe-only is acceptable; Stripe's own dashboard is what the organizer trusts as source of truth.

---

## 3. Eventeny feature inventory (what Jump is competing against)

### Applications & participants
- Vendor space **tiers** presented like ticket tiers (size, cost, what it includes).
- Applicant account + profile: contact info, custom organizer questions (tax ID, "tell us about your business"), product photos, social links. Card captured at application.
- Application states: **Approve / Reject / Waitlist / Withdraw**.
- Charge timing configurable: at submission or **on approval** (organizer uses on-approval). Immediate success/failure feedback.
- Templated auto-messages per status action, editable per applicant before sending.
- **Sponsor tiers** use the same paid flow. **Press / content creator / panel** applications are free forms without tiers.
- **Guest (celebrity) CRM**: staff-entered records with photo, socials, agent contact.
- Add-ons at application time (power, extra badges) — supported, organizer did not configure them.
- **After-the-fact invoices** to approved applicants (used for power, badges, and to force a failed payment).

### Communication
- Mass messaging to segments (approved vendors, approved press, etc.).
- List export.
- No automations (no post-event survey, no scheduled follow-ups).

### Floor map
- Map builder: draw booth rectangles, duplicate rows, number them, assign an approved vendor per booth; programming areas (stages, esports) too.
- Public interactive map reached by on-site QR codes: tap a booth → vendor profile; alphabetical/booth-order "key" list beneath.
- Live changes can be messaged to a vendor ("here's where you are now").

### Commerce & operations
- Ticketing with fees charged to both sides.
- POS for merch with inventory upload, run on tablets.
- Check-in on iPads for vendors, press, creators.
- Owner home dashboard: ticket sales, revenue, check-ins.
- Custom per-user permissions; 10 seats.
- Stripe-only, organizer connects their own Stripe account.

### Marketing network
- Paid per-state vendor e-blasts promoting your event.
- Vendor-side "events near you" discovery emails.

---

## 4. Pain points (ranked by how much it cost the organizer)

| # | Pain | Impact | Quote / evidence |
|---|---|---|---|
| 1 | **Fees on both sides and hidden until checkout** | ~10% on booths, 7.5–8% on POS, ~3% buyer fee plus organizer fee on tickets. Organizer eats fees on small items to protect vendor goodwill | "a $275 vendor booth costs $303… That's on our cheapest vendor booth" |
| 2 | **Payment "pending" treated as paid** | A $900 booth approved on an ACH debit that later failed. Eventeny showed "not paid" only later; organizer spent a month arguing with the vendor and had to log into Stripe directly to prove no payment posted. Resolved by invoice with a 5 PM deadline the Monday of show week | "it approved her, it showed that the payment went through, but the payment was pending. And later it failed" |
| 3 | **Platform email lands in spam** | Organizer exports every list and runs Gmail mail-merge instead. Doing so lifted pre-show communication NPS to ~99 (28 vendor responses) | "a lot of Vintony emails go to spam… So therefore, I have to export the list" |
| 4 | **Interactive map serves stale assignments** | Booth reassignment updated in admin but public map (browser and phone) kept showing the old booth. Support could not fix. Vendors arrived confused about their location; organizer got blowback. This map is the sole reason for the $360 tier | "It was caching… we got blowback from that" |
| 5 | **Map builder quality** | No alignment guides (contrast: Canva), looks "lopsided", poor mobile responsiveness. A zoomable PDF on the org's own site beats it. Organizer still hand-builds a print map in Canva/Illustrator and releases it at the last minute because of churn | "PDFs are actually better than what that interactive map" |
| 6 | **Add-ons configured late → invoicing chaos** | Power and extra badges were invoiced after approval; fee splitting per invoice; co-organizer objected. Organizer will push power back to the venue's (bad, old) City of Raleigh portal next year rather than repeat it | "this year was fucking a disaster" |
| 7 | **Owner dashboard exposed on shared iPads** | Master admin login on check-in devices showed revenue and sales to volunteers. Fix required creating a separate user; permission names are unclear; press/creator check-in needed ever-more permissions, ending with over-privileged volunteers who can search attendee PII | "nothing you would want an employee or a volunteer to see, ever" |
| 8 | **Seat cap** | 10 seats on the top tier, 8 used by a small team | "I hate to know what people with big teams are using" |
| 9 | **No CMS → two systems, Eventeny brand dominates** | WordPress holds the informational site; every "buy ticket / apply" link leaves for eventeny.com/gaminggeek. Attendees don't care about the platform brand | "pretty much every link… sends it to a Vintony" |
| 10 | **No automations** | Post-event survey and follow-ups are manual through Gmail | "there's no automations that you can set up to follow up for you" |
| 11 | **Tool sprawl** | Eventeny + Square + spreadsheets + Gmail + Canva + Illustrator + WordPress + venue portal | Organizer wants one central system but sees value in keeping an informational site |
| 12 | **Vendor profiles benefit the platform, not the organizer** | Vendors build Eventeny profiles/directory; organizer gets nothing from that data | "And your organization doesn't get anything off of that." "No." |

### What they like and would expect Jump to match

- One system for vendors, sponsors, press, creators, panels, guests, with segment-level mass messaging.
- Templated messages per approve/reject/waitlist/withdraw, editable per applicant.
- Charge-on-approval with instant success/failure.
- After-the-fact invoicing and add-ons.
- QR → map → booth → vendor profile flow (when it isn't stale).
- Row duplication in the map builder.
- Cheap, geo-targeted vendor e-blasts that actually produced sign-ups; vendor-side event discovery.
- Stripe as the system of record they can audit themselves.

---

## 5. Pitfalls to avoid in Jump

1. **Never show a price that grows at checkout.** Jump's all-in pricing already covers tickets; extend the same rule to booths, sponsorships, add-ons, invoices, and POS. Show the fee line to the organizer at configuration time ("vendor will pay $303") not after launch.
2. **Do not charge both sides silently.** Whatever the fee model, make "who pays" a per-product organizer choice (absorb / pass / split) with the resulting buyer price previewed. Jump's `FeeService` and `lib/fees.ts` are the place to add an absorb/pass mode.
3. **Never confuse authorized/pending with paid.** Model `pending → succeeded | failed` from Stripe webhooks (`payment_intent.processing`, `.succeeded`, `.payment_failed`; ACH/bank debits settle days later). Approval must not flip a slot to "paid" on a processing intent; alert the organizer on async failure and auto-open a "payment required by <date>" state. Jump already routes all payment state through `POST /webhooks/stripe`; keep that rule for applications and invoices.
4. **Cache invalidation on public reads.** Any public read of assignment data (booth map, event page, schedule) must invalidate on write. The interviewer noted Jump has the same class of bug with Redis cache; fix that before shipping a map.
5. **Email deliverability is a feature.** Send from the organization's verified domain (SPF/DKIM/DMARC via Resend domains), one message per recipient, plain-text alternative, unsubscribe headers for marketing. Track delivered/opened/bounced per recipient so the organizer can see who did not get it. Jump already has custom domains and org-scoped email — extend to sending identity.
6. **Shared-device default must be least privilege.** A `SCANNER`/check-in role that sees only check-in tools; no revenue, no attendee search beyond the ticket in hand; PII masked; a "kiosk mode" login that cannot navigate to admin. Jump has `SCANNER_API_KEY` for hardware; add the human equivalent.
7. **Do not sell seats that volunteers consume.** Day-of scanner/check-in accounts should not count against paid seats.
8. **Do not gate one feature behind a 4× tier.**
9. **Platform brand stays out of the organizer's storefront.** Already the direction with spec 007/008 custom domains; hold the line on emails, checkout, map, and any hosted pages.
10. **Ship add-ons with the application, not as an afterthought.** Organizers learn this the hard way; make add-on setup part of the tier/booth creation wizard with sensible defaults (power, extra badges, tables/chairs).
11. **A hosted map must export a vector PDF** of the current state. Organizers will print and will post PDFs regardless; make Jump the source so the PDF is always current.
12. **Vendor data belongs to the organizer.** Application answers, photos, and contact info should be exportable and reusable across the organizer's own events (RRG + Gaming Geek), not locked in a platform-wide profile.

---

## 6. User stories

Format: As a `<persona>`, I want `<capability>` so that `<outcome>`. Priority reflects what wins this account: **P1** needed to replace Eventeny for the convention; **P2** strong differentiators; **P3** later.

### Organizer — applications & participants

| ID | Story | Pri |
|---|---|---|
| ORG-01 | As an organizer, I want to define vendor space tiers (name, size, price, what's included, quantity) per event, presented to applicants the same way ticket tiers are, so vendors self-select and capacity is enforced. | P1 |
| ORG-02 | As an organizer, I want sponsor tiers to use the same paid application flow as vendor tiers, so sponsorship sales are not a side process. | P1 |
| ORG-03 | As an organizer, I want free application forms (press, content creator, panel) with custom questions and no payment step, so all participant types live in one system. | P1 |
| ORG-04 | As an organizer, I want to add custom questions (text, choice, file/photo upload) to any application, so I can collect tax ID, business description, product photos, and social links. | P1 |
| ORG-05 | As an organizer, I want to approve, reject, waitlist, or withdraw an application, so I control who participates. | P1 |
| ORG-06 | As an organizer, I want to choose per tier whether the card is charged at submission or on approval, and to see success or failure immediately when I approve, so approval and payment happen in one action. | P1 |
| ORG-07 | As an organizer, I want each status action to send a templated message that I can edit before sending, so applicants get consistent, personal communication without extra work. | P1 |
| ORG-08 | As an organizer, I want to define add-ons (power, extra badges, tables) attached to a tier so applicants purchase them during application, so I do not have to invoice after the fact. | P1 |
| ORG-09 | As an organizer, I want to send an invoice to an approved applicant for an additional item with a due date, and see its paid/unpaid state, so late additions and failed payments have a clean path. | P2 |
| ORG-10 | As an organizer, I want to promote a waitlisted applicant into a released or added space, with charge-on-promotion, so cancellations backfill quickly. | P2 |
| ORG-11 | As an organizer, I want staff-entered participant records (celebrity guests: photo, socials, agent contact) that appear on the public event page, so guests are managed alongside everyone else. | P2 |
| ORG-12 | As an organizer, I want to reuse an applicant's prior answers and profile across my own events, so repeat vendors apply in seconds and the data stays mine. | P2 |

### Organizer — payments & fees

| ID | Story | Pri |
|---|---|---|
| PAY-01 | As an organizer, I want to choose per product (ticket tier, booth tier, add-on, invoice) whether fees are absorbed, passed through, or split, and preview the resulting buyer price, so no one is surprised at checkout. | P1 |
| PAY-02 | As an organizer, I want the buyer to see the all-in price before checkout for every product type, so "$275 becomes $303" never happens. | P1 |
| PAY-03 | As an organizer, I want an application to remain "payment processing" until Stripe confirms settlement, with an alert and an automatic "payment required by <date>" state if it fails, so a failed ACH never holds a booth for a month. | P1 |
| PAY-04 | As an organizer, I want to see the Stripe payment status and a link to the Stripe object for every order, application, and invoice, so I can audit without leaving Jump. | P1 |
| PAY-05 | As an organizer, I want to restrict application payments to instant methods (card) or allow bank debit explicitly, so I choose the settlement risk. | P2 |
| PAY-06 | As an organizer, I want a fee report per event showing platform fees, processing fees, and who paid them, so I know my true cost. | P2 |

### Organizer — communication

| ID | Story | Pri |
|---|---|---|
| COM-01 | As an organizer, I want to send a message to a segment (approved vendors, waitlisted, press, ticket buyers) as individual emails from my own domain, so messages arrive in inboxes and show my brand. | P1 |
| COM-02 | As an organizer, I want per-recipient delivery status (delivered, bounced, opened) on every send, so I know who did not get the message. | P1 |
| COM-03 | As an organizer, I want to export any segment as CSV, so I can use my own tools when I need to. | P1 |
| COM-04 | As an organizer, I want scheduled and event-relative automations (e.g., survey 7 days after event end, reminder 3 days before load-in), so follow-ups happen without me. | P2 |
| COM-05 | As an organizer, I want a post-event NPS/survey step with results in the dashboard, so I can measure communication quality year over year. | P3 |

### Organizer — floor map

| ID | Story | Pri |
|---|---|---|
| MAP-01 | As an organizer, I want to draw a floor plan with snapping, alignment guides, row duplication, and numbered booths, so the map looks clean without a designer. | P2 |
| MAP-02 | As an organizer, I want to assign an approved vendor (or stage/program) to a booth from a list, and have the public map reflect the change immediately, so reassignments never show stale data. | P2 |
| MAP-03 | As an organizer, I want to export the current map as a vector PDF, so my printed and hosted maps are always the latest state. | P2 |
| MAP-04 | As an organizer, I want to message a vendor their current booth with a link that highlights their location, so last-minute moves are clear. | P3 |

### Organizer — site & pages

| ID | Story | Pri |
|---|---|---|
| CMS-01 | As an organizer, I want to create simple pages (headings, text, images, buttons, embedded map/schedule) on my custom domain, so I do not need WordPress for the informational site. | P2 |
| CMS-02 | As an organizer, I want a mobile "day-of" page with big buttons (map, schedule, vendors, tickets) reachable by QR code, so on-site wayfinding is self-serve. | P2 |
| CMS-03 | As an organizer, I want an organization landing page that lists all my events (Gaming Geek, RRG dates), so my brand is the entry point and platform branding stays out of it. | P2 |

### Organizer — team & permissions

| ID | Story | Pri |
|---|---|---|
| TEAM-01 | As an organizer, I want a check-in role that can only scan/check in and sees no revenue, sales, or attendee search beyond the ticket presented, so volunteers on shared iPads are safe by default. | P1 |
| TEAM-02 | As an organizer, I want check-in/scanner accounts to be unlimited and free, so seats are not consumed by day-of volunteers. | P1 |
| TEAM-03 | As an organizer, I want each permission described in plain language with what screens it unlocks, so I can grant press/creator check-in without over-privileging. | P2 |
| TEAM-04 | As an organizer, I want a kiosk/device login that is pinned to check-in and cannot navigate to admin, so shared devices need no per-person accounts. | P2 |

### Organizer — commerce & growth

| ID | Story | Pri |
|---|---|---|
| POS-01 | As an organizer, I want to sell merch and badges on-site from a tablet with my inventory and Stripe Terminal, at a fee no higher than online sales, so I stop using a second POS. | P3 |
| GROW-01 | As an organizer, I want to promote my event to vendors who applied to similar events within driving distance, so applications fill when they taper off. | P3 |

### Vendor / sponsor / press

| ID | Story | Pri |
|---|---|---|
| VEN-01 | As a vendor, I want to see every available space with size, price, inclusions, and the all-in total before I apply, so there is no surprise at checkout. | P1 |
| VEN-02 | As a vendor, I want to apply with a card on file that is charged only if I am accepted, and receive a clear approve/reject/waitlist email, so I know where I stand. | P1 |
| VEN-03 | As a vendor, I want to buy power, badges, and other add-ons during application, so I do not have to chase invoices or use the venue's portal. | P1 |
| VEN-04 | As a vendor, I want a profile (photos, socials, description) shown on the event's vendor list and map, so attendees can find me. | P2 |
| VEN-05 | As a vendor, I want emails from the organizer to arrive in my inbox from the organizer's domain, so I do not miss pre-show logistics. | P1 |
| VEN-06 | As a sponsor, I want to pick a sponsorship tier and pay on approval like a vendor, so sponsoring is one step. | P1 |
| VEN-07 | As press or a content creator, I want a free application form with a clear status, so I know when my badge is confirmed. | P1 |

### Attendee

| ID | Story | Pri |
|---|---|---|
| ATT-01 | As an attendee, I want to scan a QR on site and get a fast mobile map that zooms crisply and shows the current booth assignments, so I can find vendors. | P2 |
| ATT-02 | As an attendee, I want to tap a booth and see the vendor's profile, and browse an alphabetical vendor key, so the map is useful zoomed in or out. | P2 |
| ATT-03 | As an attendee, I want the whole journey (site, tickets, map) on the organizer's domain and brand, so it feels like one event, not a platform. | P2 |

### Volunteer / staff

| ID | Story | Pri |
|---|---|---|
| STF-01 | As a volunteer at check-in, I want to scan a badge or search by name and see only what I need to check someone in, so I can work fast without seeing private data. | P1 |
| STF-02 | As a volunteer, I want to check in vendors, press, and creators from the same screen as ticket holders, so I do not need extra permissions per participant type. | P1 |

---

## 7. Feature candidates mapped to Jump

| Candidate | Existing Jump ground | Gap | Suggested spec |
|---|---|---|---|
| Applications (vendor/sponsor/press/panel) with tiers, statuses, charge-on-approval, custom questions | `PriceTier` + capacity locking, `Contact`, Stripe Checkout, email templates | New `Application`, `ApplicationTier`, `ApplicationQuestion`/`Answer`, status workflow, deferred capture (`capture_method: manual` or SetupIntent + off-session PaymentIntent on approval) | **011-applications** |
| Add-ons on tiers and applications | Fee breakdown per `OrderItem` | `AddOn` product type attachable to ticket tiers and application tiers; cart support | **012-add-ons** (interviewer said add-ons are already planned) |
| Invoices with due date and payment state | Stripe Invoices API not used | `Invoice` model + Stripe Invoice or Checkout link + webhook state | 011 phase 2 |
| Fee mode per product (absorb / pass / split) with buyer-price preview | `FeeService`, `lib/fees.ts`, all-in pricing, tax-inclusive math (spec 009) | Per-product fee mode field; preview in admin; buyer-side display for non-ticket products | Extend fee-calculation |
| Payment state fidelity (processing vs paid, async failure alerts) | Webhook-only payment truth | Handle `payment_intent.processing` / `payment_failed` for applications and invoices; organizer alert email; "payment required by" state | 011 phase 1 requirement |
| Org-domain email sending + per-recipient delivery tracking | Resend, custom domains (007/008), org-scoped email | Resend domain verification per org (DNS records alongside storefront CNAME), send-as org, webhook events for delivered/bounced/opened, segment sends | **013-messaging** |
| Automations (event-relative schedules, post-event survey) | None | Scheduler (cron/queue), automation rules, survey model | 013 phase 2 |
| Check-in role, kiosk mode, unlimited scanner seats | RBAC, `SCANNER_API_KEY`, QR scanning | `SCANNER` membership role, kiosk session, PII masking in scanner UI | Extend rbac / spec 005 |
| Floor map builder + public map + PDF export | None; note Redis cache invalidation issue | Map editor (SVG canvas with snapping/guides), booth ↔ application assignment, public map with vendor profiles, vector PDF export, cache invalidation on assignment write | **014-floor-map** |
| CMS pages, org landing page, day-of mobile page | Public org page, custom domains, branding | Page model with block editor, routing on tenant host | **015-pages** |
| POS (Stripe Terminal) | None | Later | P3 |
| Vendor marketing network / discovery | None | Requires cross-org vendor base; consent | P3 |

---

## 8. Open questions for the next conversation

1. Exact Eventeny fee schedule (organizer-side vs buyer-side percentages and fixed fees) — pull from their Stripe dashboard or Eventeny invoices.
2. Would they accept bank-debit payments from vendors at all, given the $900 failure?
3. What do they need from a map to stop paying a designer: alignment guides and PDF export, or is the interactive map optional if PDF export exists?
4. Volume for RRG events (currently Square + spreadsheets) — would they move those to Jump if applications and messaging existed?
5. Which application questions are mandatory for them (tax ID, product category, photos) and whether photos should be public.
6. Do they want vendor profiles shared across their own events only, or opt-in to a wider directory?
7. Demo request: the organizer offered to show the Eventeny back end; schedule a screen-share to capture the application admin and permission screens.
