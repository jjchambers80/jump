# Spec 040 — Patron "My account"

**Status**: Proposed (2026-09-29). Not implemented.
**Source**: research into buyer accounts on Shopify (new customer accounts), Eventbrite, Ticketmaster, AXS, DICE, Tixr and Etix, plus GDPR / UK GDPR, CCPA/CPRA, CAN-SPAM and the 2024 Gmail/Yahoo bulk-sender rules; assessed against what Jump already ships for buyer accounts (spec 007, spec 031) and the privacy design in spec 023 (LR-12, LR-13, §8.3, §8.4).
**Plan**: [plan.md](./plan.md)

## 1. Why

Patrons (ticket buyers, RSVP guests, vendor applicants) sign in per organization on the organizer's storefront — `/account` on a custom domain, `/organizations/:id/account` on the platform host — with spec 031's passwordless link or code. The account is one page that lists orders, tickets (with self-serve refund), applications and the applicant profile.

A patron cannot:

- correct their name or phone, or change their email;
- see or cancel their RSVPs;
- stop marketing email without asking the organizer (unsubscribe is admin-only, spec 031 §6);
- print a receipt for a ticket order;
- sign out a lost device (buyer JWTs are stateless and last 30 days);
- download their data or delete their account.

The last three are rights the organizer owes its buyers under GDPR (Arts. 15, 16, 17, 20, 21, 7(3)), UK GDPR and CCPA/CPRA, and that CAN-SPAM and the Gmail/Yahoo sender rules require for any future marketing mail. Spec 023 designed export, anonymization and retention; none of it is built. Every comparable platform offers the same core: profile, tickets, orders and receipts, communication preferences, and a privacy area with download and delete.

## 2. Roles

The organizer is the **controller** of its buyers' data; Jump is its **processor**. Buyer identity is already per organization (`Contact` unique on `organizationId + email`, Gotcha 8). So:

- every patron action in this spec acts on **one Contact** — the one signed in on this storefront — and never on the same email at another organization;
- staff get the same export and anonymize operations for requests that arrive by email (processor duty to assist, Art. 28(3)(e));
- the cross-organization "delete me everywhere" request stays in spec 023 (`/legal/privacy-request`, SYSTEM_ADMIN queue).

## 3. Requirements

### Account shell
- **PA-01** The account becomes a section with its own routes under `/organizations/[orgId]/account/*` (and `/account/*` on custom domains, already covered by the `storefrontHost.ts` rewrite and the reserved `/account` path): Overview, Orders, RSVPs, Applications, Profile, Preferences, Privacy. Applications and RSVPs tabs hide when the patron has none.
- **PA-02** A shared layout owns the sign-in gate and form; the nav is a horizontally scrolling tab bar on phones and a sidebar from `lg`. Colours come from the org `brand` tokens through `BrandScope` with the org `themeMode` (Gotchas 6, 7); links go through `storefrontHref`.

### Profile and email (rectification)
- **PA-03** `PATCH /buyer/me` edits `firstName`, `lastName`, `phone`, `location` only (partial whitelist validator). Staff see the change on the customer timeline.
- **PA-04** Email change: the patron enters a new address, Jump sends a confirmation link to the **new** address (`BuyerLoginToken` purpose `EMAIL_CHANGE`, 15 min) and a notice to the old one. Confirming updates `Contact.email` and writes the existing `EMAIL_CHANGED` comment. If another Contact at the same organization already has that email, the change is refused (409 `EMAIL_IN_USE`) — merging contacts is out of scope.

### RSVPs, orders, receipts
- **PA-05** RSVPs tab: upcoming and past RSVPs with party size and status; **Cancel** calls the same `RsvpService.cancel` path as the emailed token link. Event times use the venue's zone (Gotcha 28).
- **PA-06** Orders tab keeps today's list and adds a **Receipt** link per paid order: a printable page (print CSS, no PDF library) built from the order detail the buyer can already read (`GET /orders/:orderId` with a buyer session). Shows organizer name, order ref, lines, add-ons, fees, tax, total, payment date, refunds.

### Communication preferences (objection, withdrawal of consent)
- **PA-07** Preferences tab: one toggle, "Email me news and offers from {org}". Turning it on writes a `LegalAcceptance` (`MARKETING`, source `ACCOUNT`) and sets `emailSubscribed`, `emailSubscribedAt`, `emailSubscribedSource = ACCOUNT`; turning it off sets `emailUnsubscribedAt`. Off is one click with no confirmation (Art. 7(3)). Transactional email (tickets, receipts, application status) is not affected and the page says so.
- **PA-08** One-click unsubscribe without sign-in: `GET`/`POST /buyer/unsubscribe?t=` with an HMAC token over contact id + organization id (no expiry). `POST` with body `List-Unsubscribe=One-Click` is accepted (RFC 8058). The storefront page `/account/unsubscribe` confirms and offers resubscribe. A `listUnsubscribeHeaders(contact)` helper is exported for spec 013 marketing sends; nothing sends marketing mail today.

### Devices
- **PA-09** **Sign out of all devices**: sets `Contact.buyerSessionsValidAfter = now()`; buyer auth refuses any token issued before it (401 `SESSION_REVOKED`, the frontend clears the cookie). The current device gets a fresh session. No device list in v1.

### Download my data (access, portability)
- **PA-10** `GET /buyer/me/export` returns a JSON file (`{org-slug}-my-data-{date}.json`) with: the Contact, orders (lines, add-ons, payments, refunds — amounts, dates, statuses; no Stripe ids beyond the last four digits already shown), tickets (no `qrCodeJwt`), RSVPs, applications with answers, the applicant profile with image URLs, legal acceptances and the marketing opt-in history. Built synchronously (the data per contact is small); limited to 3 exports per contact per day.
- **PA-11** Staff: **Export data** on the admin customer detail page (ADMIN) downloads the same file.

### Delete my data (erasure)
- **PA-12** **Delete my data** opens a preview listing what will happen:
  - upcoming valid tickets that will be **cancelled with no refund** (with a link to request a refund first where the refund policy allows);
  - open or approved applications that will be withdrawn;
  - RSVPs that will be cancelled;
  - what is kept: order, payment, refund and consent records "as required by law", attached to an anonymous record.
- **PA-13** Hard stops (decision §5): a `PENDING` order, an application whose payment is `PROCESSING` or payment-due, or an open refund. The preview explains each and the request cannot proceed until they clear.
- **PA-14** The patron ticks a confirmation box, then enters a code emailed to them (`BuyerLoginToken` purpose `DELETE_CONFIRM`, spec 031 code UX). Deletion is then **scheduled** for `ERASURE_GRACE_DAYS` (default 7); an email confirms with a cancel link and the account shows a banner with **Cancel deletion**. The account stays fully usable during the grace period.
- **PA-15** When the grace period ends, a sweep re-checks the hard stops (if one appeared, it postpones and emails), then in order: voids the upcoming tickets and releases their tier and add-on capacity (no `Refund` row), withdraws open applications (`withdrawReason: 'erasure'`), cancels RSVPs, and **anonymizes** the Contact per spec 023 §8.4. A final email goes to the address captured before the scrub.
- **PA-16** Anonymization (spec 023 §8.4): email → `deleted-<id8>@anonymized.invalid`; `firstName` → `Deleted`, `lastName` → `User`; `phone`, `location`, `note` → null, `tags` → `[]`; `emailSubscribed = false`; the Stripe Customer is deleted and `stripeCustomerId` nulled; `BuyerLoginToken` rows deleted; `ApplicantProfile` text scrubbed; free-text `ApplicationAnswer`s scrubbed; profile and answer images disabled then purged; `Ticket.qrCodeJwt` nulled; `anonymizedAt` set. Orders, tickets, payments, refunds, applications, decisions and `LegalAcceptance` rows stay linked to the tombstone (spec 023 §8.3, Gotcha 17).
- **PA-17** An `ErasureSuppression { organizationId, emailHash }` row (salted SHA-256) keeps the address out of future imports and marketing without storing it. A later checkout, RSVP or application with the same email creates a normal new Contact.
- **PA-18** Staff: **Anonymize customer** on the admin customer detail page (ADMIN, step-up via `requireRecentAuth`, typed confirmation) runs the same erasure at once, no grace period, same hard stops. The customer timeline shows it.
- **PA-19** An anonymized Contact cannot sign in; `/buyer/auth/request` stays a silent 202. Money totals in the customers list, analytics, dashboard and tax report do not change; the name shows as "Deleted User".

### Retention
- **PA-20** The erasure sweep also deletes `BuyerLoginToken` rows older than `expiresAt + 7 days` (spec 023 LR-13, first part).

## 4. Out of scope
Ticket transfer; Apple / Google Wallet (spec 006); saved cards list; saved addresses; store credit (spec 031 §6); a buyer device list; the cross-organization privacy request queue and staff self-delete (spec 023 LR-12); Global Privacy Control and "Do Not Sell or Share" (no trackers today, spec 023 LR-14); an Art. 18 restriction flag; anonymizing inactive contacts on a timer (`CONTACT_RETENTION_MONTHS`, waiting on counsel, spec 023 §12 Q11); marketing sends themselves (spec 013).

## 5. Decisions taken
- **Delete while holding valid tickets: warn, then void** (2026-09-29). Deletion does not wait for the event; the preview names every ticket that will be cancelled without a refund and links to the refund flow. Only money in flight (pending order, payment processing or due, open refund) blocks the request. This departs from spec 023 LR-12's "hard-stop" wording for valid tickets, which DICE, Ticketmaster and Eventbrite use; the user chose fewer dead ends for the patron.
- **Scope: self-serve per organization plus staff tools** (2026-09-29). The platform-wide request queue stays in spec 023.
- **Voided tickets return to inventory.** A deleted patron's seat can be resold; capacity moves through the same `FOR UPDATE` path refunds use.
- **Sign-out-everywhere by timestamp, not a session table.** One column covers the lost-phone case; a device list can come later.
- **Synchronous export.** A contact's data is kilobytes; an async job with an emailed link adds a queue and a file store for no gain in v1.
- **Receipts are a printable page**, not a generated PDF.

## 6. Open questions (for spec 023 counsel)
- Retention periods behind "as required by law" (proposal: 7 years for financial rows, spec 023 §8.3).
- Whether the organizer DPA needs to name self-serve erasure as the processor's assistance mechanism.
- Final wording of the deletion preview and confirmation email.

## 7. Follow-ups
- Ticket transfer (name + email change on a ticket, new QR).
- Saved payment methods list backed by the Stripe Customer.
- Buyer device list (a `BuyerSession` table like staff `UserSession`).
- Contact inactivity anonymization once counsel sets `CONTACT_RETENTION_MONTHS`.
