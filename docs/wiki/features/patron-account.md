# Patron Account ("My account")

**Spec**: [040 — Patron "My account"](../../../specs/040-patron-account/spec.md) · PRs #251 (A), #253 (B), #254 (C), D
**Related**: [Buyer Accounts](buyer-accounts.md) (sign-in, cookie, opt-ins), [Customer Accounts Settings](customer-accounts-settings.md) (refund policy, sign-in method), spec 023 (legal compliance, retention)

## What it is

The storefront account a ticket buyer, RSVP guest or vendor applicant uses at one organization — `/account` on a custom domain, `/organizations/:id/account` on the platform host. Everything in it acts on **one Contact at one organization**: the organizer is the data controller, and the same email at another organizer is a different record (Gotcha 8).

| Section | Route | What the buyer does |
|---|---|---|
| Tickets | `/account` | Applications waiting on them (choose space, pay), upcoming ticket stubs with self-serve refund (spec 031), past tickets |
| Orders | `/account/orders` | Order history; **Receipt** (printable) for paid orders |
| RSVPs | `/account/rsvps` | Upcoming / past RSVPs, cancel (tab only when they have RSVPs) |
| Applications | `/account/applications` | Applications + business profile (tab only when they have applications) |
| Profile | `/account/profile` | Name, phone, city; email change by a link to the new address; **Sign out of all other devices** |
| Email preferences | `/account/preferences` | One switch for news and offers from this organizer |
| Privacy | `/account/privacy` | **Download my data**; **Delete my data** |

Token pages outside the sign-in gate: `/account/verify` (sign-in link), `/account/email-confirm` (new-address link), `/account/unsubscribe` (one-click unsubscribe).

## How it works

- **Shell**: `account/(member)/layout.tsx` holds the sign-in gate, `OrganizationHeader`, the section nav (`components/account/AccountNav.tsx` — one element: a scrolling tab row on phones, a sticky sidebar from `lg`) and `AccountContext` (org, buyer, applications, RSVPs, `href()` for custom domains). A grace-period banner shows while a deletion is scheduled.
- **Backend**: `BuyerAccountService` (profile, email change, RSVPs, marketing, revoke sessions), `OrderService.getReceiptForContact`, `BuyerDataExportService`, `ContactErasureService`; routes in `backend/src/api/routes/buyerAuth.js`, proxied by `frontend/src/app/api/buyer/*` (`proxyBuyer` clears the cookie on a 401).
- **Email change**: `BuyerLoginToken` purpose `EMAIL_CHANGE` (1 h, payload `{ newEmail }`); a newer request supersedes the old link; 409 `EMAIL_IN_USE` if another contact at the organization has the address. The old address gets a notice on request and on completion.
- **Marketing**: turning it on writes a `MARKETING` `LegalAcceptance` (`MARKETING_CONSENT_VERSION`, the label as `presentedText`, source `ACCOUNT`); off is one click. `utils/unsubscribeToken.js` signs the one-click link (HMAC over contact + org) and builds RFC 8058 `List-Unsubscribe` headers for future marketing sends (spec 013).
- **Sign out everywhere**: `Contact.buyerSessionsValidAfter`; `requireBuyer` refuses older sessions (401 `SESSION_REVOKED`).
- **Download my data**: one JSON file, this organization only, no Stripe ids / QR JWTs / token hashes; 3 per 24 h, each logged as a `DATA_EXPORTED` timeline line. Staff **Export customer data** (ADMIN) adds staff notes and tags.
- **Delete my data**: preview → checkbox → emailed `DELETE_CONFIRM` code → scheduled after `ERASURE_GRACE_DAYS` (7) → the hourly sweep anonymizes. Upcoming tickets are **voided with no refund** and their seats return to sale (`services/ticketInventory.js`, shared with refunds); submitted / waitlisted applications are withdrawn; RSVPs cancelled. Blockers: a pending order, an application payment in progress, a pending refund, or an **approved** application (its place and any booth belong to the organizer to cancel). Anonymization follows spec 023 §8.4 (tombstone name and email, notes and staff comments deleted, profile and answers scrubbed, photos deleted, Stripe Customer deleted, sign-in tokens deleted, sessions revoked) and writes a salted-hash `ErasureSuppression`. Orders, payments, refunds, tickets and legal acceptances stay. Staff **Erase customer data** (ADMIN + step-up) does the same at once.

## Gotchas

- **Never delete a Contact row** — erasure is `ContactErasureService` only; the ledger must keep its customer.
- New buyer-data models must be added to `BuyerDataExportService.build` (access) and `ContactErasureService.erase` (scrub).
- Account pages a signed-out visitor must reach go **outside** the `(member)` route group.
- `LegalAcceptance.email` is kept after erasure: it is the consent evidence spec 023 §8.3 retains.
- A contact whose scheduled erasure meets a blocker is postponed a day and emailed.
