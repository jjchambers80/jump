# Spec 032 — Customer detail: gap assessment against Shopify and triage plan

**Status**: Proposed (2026-09-20). Not implemented.
**Source**: Shopify Admin › Customers › customer detail screen (screenshot reviewed 2026-09-20), assessed against `frontend/src/app/admin/customers/[contactId]/page.tsx`, `CustomerService.getCustomerById` and the `Contact` model.
**Related**: spec 007 (per-org Contact, buyer accounts), spec 018 (customer aggregates), spec 019 (application tags pattern), spec 023 (legal / erasure), spec 024 (marketing provenance), spec 031 (customer accounts settings; store credit deferred there).

## 1. What Jump has today

`/admin/customers/[contactId]` shows: four stat tiles (amount spent with refunded hint, transactions split into orders / applications, customer since, last activity), an order-history list (ticket + application orders, linking to `/admin/orders/:id`), an applications list, a contact card (email + copy, email-subscription toggle, free-text location), and a single free-text note. `PATCH /admin/customers/:id` accepts `note`, `location`, `emailSubscribed` only.

`Contact` carries `firstName`, `lastName`, `email`, `location`, `note`, `emailSubscribed` (+ `emailSubscribedAt`, `emailSubscribedSource`, `emailUnsubscribedAt`), `accountCreatedAt`, `stripeCustomerId`. No phone, no address, no tags, no locale, no comments, no activity log.

A contact with no paid order is a 404 on the detail page and absent from the list (`customerPredicate()`): Jump shows customers, Shopify shows contacts including "Prospects".

## 2. Assessment of the Shopify screen

| Shopify item | Jump today | Useful for event ticketing? | Verdict |
|---|---|---|---|
| **Amount spent** | Stat tile, refunded hint | — | Have |
| **Orders** count | "Transactions" tile with orders / applications split | — | Have |
| **Customer since** | Stat tile | — | Have |
| **RFM group** (Prospects / New / Active / At risk / …) | Nothing | Yes, lightly. Organizers want "repeat buyer" vs "lapsed" at a glance; a full RFM model is overkill for a few events a year | **Build lite (phase 2).** Derived *segment* badge from data already aggregated: `Prospect` (0 paid orders — only once prospects are visible), `New` (1 order), `Repeat` (2+), `Lapsed` (no paid order in 18 months). No stored field, no scoring |
| **Last order placed** card + **Create order** | Order history list exists; no manual / comp order anywhere in admin | Yes, strongly — box office, phone orders, comps for press/sponsors are core ticketing workflows | **Defer — own spec (manual orders / comp tickets).** Touches capacity locking, `PaymentTransaction` (offline or zero-amount), receipts and scanning. Too large for this spec; recorded in §6 |
| **Blocks** (app extensions) | No app platform | No | **Skip** |
| **Timeline** — staff comments (with @mention, #, attachments) + system events ("Customer was created") | Single `note` field, no history, no author, no events | Yes. Support cases ("refunded after phone call with X", "asked to move to Saturday") need dated, attributed entries; the single note gets overwritten | **Build (phase 2).** `ContactComment` rows (author, body, createdAt) + a derived event feed from existing data (orders paid / refunded, applications submitted / approved, account created, marketing subscribed / unsubscribed, comments). No @mention, #, or attachments in v1 |
| **Contact information** — email, "Will receive notifications in English", edit (…) | Email + copy. Name and email are not editable | Language: not until the storefront is localized (spec `autoRedirectLanguage` is stored only). Name edit: yes (typos at checkout). Email edit: yes but risky — `organizationId + email` is unique and is the buyer sign-in identity | **Build name + email edit (phase 1), skip language.** Email change is ADMIN, refuses a collision (409), and is written to the timeline. No locale field until localization ships |
| **Phone** (Shopify shows under contact info when set) | Nothing on `Contact` | Yes — day-of contact for will-call, vendors, refunds | **Build (phase 1).** Optional `Contact.phone` (E.164-normalised, free entry), editable inline like location. Checkout does not collect it in v1 |
| **Default address** | Free-text `location` ("City, State") | Marginal — no shipping; tax is by venue, not buyer | **Skip.** Keep `location`; revisit only if ticket mailing or buyer-location tax ever lands |
| **Marketing subscriptions** — per-channel status, provenance | Toggle only. `emailSubscribedAt` / `emailSubscribedSource` / `emailUnsubscribedAt` exist since spec 024 phase 3 but are neither shown nor set by the admin toggle | Yes — provenance is the LR-07 consent record; hiding it makes the admin toggle look like the source of truth | **Build (phase 1).** Show "Subscribed via checkout on Sep 3, 2026" / "Unsubscribed on …"; the admin toggle writes `emailSubscribedSource = ADMIN` (enum value already exists) and the timestamps. Email is the only channel; no SMS |
| **Tax details** — "Collect tax" / tax-exempt with exemption reason | Nothing; tax comes from the org `TaxRegion` per venue (spec 009) | Rarely for consumer tickets; occasionally for nonprofit vendors on PAID application forms | **Defer.** Would need per-order tax override in `FeeService` / `fees.ts` (Gotcha 12) and Stripe Tax exemption. Record as spec 009 follow-up |
| **Store credit** | Nothing | Yes (cancelled / rescheduled events) | **Deferred already** — spec 031 §6, own spec |
| **Tags** | Nothing on `Contact` (`Application.tags` exists, spec 019 phase 3) | Yes — "VIP", "press", "chargeback", "season-pass"; filters the list | **Build (phase 1).** `Contact.tags String[]` + GIN index, reuse `EditTagsDialog` chip input pattern and the tag autocomplete from scope, `?tag=` filter on `/admin/customers` |
| **Notes** | Have (single field) | — | Have; stays as the pinned summary above the timeline |
| **More actions** (edit, merge, delete / erase, export) | Nothing | Erase: yes, required by spec 023 (GDPR / CCPA). Merge: no (per-org unique email already prevents most duplicates). Export: the list CSV covers it | **Build partially.** Erase → spec 023 owns the workflow; this spec only reserves the menu slot. Add **Send sign-in link** (reuses `BuyerAuthService.requestLogin`) and **Copy account URL** here (phase 1) |
| **Prev / next customer** arrows | Nothing | Nice-to-have when working a list | **Build (phase 2).** Cheap: detail response carries `prevId` / `nextId` in the list order the user arrived from |

### Jump-specific gaps not on the Shopify screen

| Gap | Verdict |
|---|---|
| **Buyer account status** — `accountCreatedAt` is never shown; staff cannot tell a guest from an account holder or help a buyer who "can't sign in" | **Build (phase 1).** Account card: *Guest checkout* or *Account since Sep 3* + last sign-in (`BuyerLoginToken.usedAt` max), with **Send sign-in link** action |
| **Tickets summary** — orders show ticket counts but not upcoming events or check-in state | **Build (phase 2).** Small "Upcoming tickets" card: next 3 events with ticket counts and redeemed / valid state, linking to the event |
| **Prospects invisible** — a contact who subscribed on the apply form, created an account or holds only a PENDING / CANCELLED order is a 404 | **Decision needed (§5).** Recommended: keep the Customers list as money-collected by default, add a *Show all contacts* filter, and let the detail page render for any contact of the org (stat tiles show $0 / 0, segment `Prospect`) |

## 3. Triage plan

Cards follow `docs/development/kanban-workflow.md`, tenant `customers`, created 2026-09-20: phase 1 `t_a83fc473` (JUMP-032A), phase 2 `t_a1331b62` (JUMP-032B), phase 3 `t_007ba367` (JUMP-032C); 2 and 3 are children of 1. Each phase is one PR; phase 1 first, phases 2 and 3 independent of each other.

### Phase 1 — Contact record (schema + fields)

Outcome: staff can correct and enrich a customer record and see the consent / account facts Jump already stores.

- Schema: `Contact.phone String?`, `Contact.tags String[] @default([])` + `@@index([tags], type: Gin)`. One migration (`EmailSubscribedSource.ADMIN` already exists).
- `PATCH /admin/customers/:id` becomes a partial validator (whitelist: `firstName`, `lastName`, `email`, `phone`, `location`, `note`, `emailSubscribed`, `tags`) in the `validateUpdateBusinessDetails` style. `email` requires ADMIN, lower-cases, refuses a collision on `organizationId_email` (409 `EMAIL_TAKEN`). `emailSubscribed` writes the provenance columns.
- `GET /admin/customers/:id` adds `phone`, `tags`, `accountCreatedAt`, `lastSignInAt`, `emailSubscribedAt`, `emailSubscribedSource`, `emailUnsubscribedAt`, `accountUrl`.
- `POST /admin/customers/:id/send-sign-in-link` (staff, rate-limited through the existing `BUYER_AUTH_REQUEST` limiter key) → `BuyerAuthService.requestLogin`.
- `GET /admin/customers?tag=` filter; list rows include `tags`.
- UI: editable name in the header, phone + location inline edits, marketing card with provenance line, Tags card (chip input reused from `EditTagsDialog`), Account card with *Send sign-in link* / *Copy account URL*, **More actions** menu (send link, copy URL; erase slot disabled with a "spec 023" tooltip until it ships).
- Tests: unit (validator, collision, provenance write), contract (PATCH partials, 409, send-link 200 + limiter), Playwright (edit name, add tag, filter by tag) via `signInAsStaff`.
- Non-goals: language, address, tax exemption, erase.

### Phase 2 — Timeline, segment, navigation

Outcome: dated, attributed history per customer; quick orientation.

- Schema: `ContactComment { id, contactId, organizationId, authorUserId, body (≤ 2000 chars, plain text), createdAt }`, cascade on contact delete.
- `GET /admin/customers/:id/timeline` merges comments with derived events (order paid / refunded / partially refunded from `PaymentTransaction` + `Refund`, application submitted / approved / rejected, account created, marketing subscribed / unsubscribed, name / email changed — the phase 1 PATCH writes a comment-typed system entry for email changes). Newest first, cursor pagination by `createdAt`.
- `POST /admin/customers/:id/comments`, `DELETE …/comments/:commentId` (author or ADMIN).
- Segment: computed in `aggregates()` (`backend/src/services/CustomerService.js`) and shown as a badge in the stat row; list gains a `segment` column + filter.
- Prev / next: list passes its sort + filter in the query string; detail response includes `prevId` / `nextId` for that ordering.
- Upcoming tickets card from `Ticket` rows (`status`, `redeemedAt`) grouped by event with `date >= now()`.
- Tests: unit (timeline merge ordering, segment thresholds), contract (comment CRUD + authz, timeline pagination), Playwright (post a comment, see order events).
- Non-goals: @mention, hashtags, attachments, editing comments.

### Phase 3 — Prospects

Outcome: every contact of the org has a detail page; the list can show non-buyers.

- `customerPredicate()` becomes a list filter (`?scope=customers|all`, default `customers`); `getCustomerById` drops the "no money" 404.
- Stat tiles render $0 / 0; segment `Prospect`.
- Tests: contract (scope filter, prospect detail 200), Playwright (toggle filter).
- Unblocked by decision §5.1.

### Deferred to their own specs (recorded, not carded here)

- **Manual / comp orders** ("Create order") — own spec: offline `PaymentTransaction`, zero-amount comps, capacity via the existing `FOR UPDATE` path, receipt email, appears on the customer page like any order.
- **Store credit** — spec 031 §6.
- **Tax exemption per contact** — spec 009 follow-up.
- **Erase customer** — spec 023.
- **Notification language** — after storefront localization.

## 4. Requirements summary

| ID | Requirement | Phase |
|---|---|---|
| FR-01 | `Contact.phone`, `Contact.tags`; partial PATCH validator; ADMIN-only email change with 409 on collision | 1 |
| FR-02 | Marketing card shows provenance; admin toggle records `ADMIN` source and timestamps | 1 |
| FR-03 | Account card: guest vs account since, last sign-in, send sign-in link, copy account URL | 1 |
| FR-04 | Tags chip editor + `?tag=` list filter | 1 |
| FR-05 | `ContactComment` + merged timeline endpoint + comment CRUD | 2 |
| FR-06 | Derived segment badge + list column / filter | 2 |
| FR-07 | Prev / next navigation honouring list order | 2 |
| FR-08 | Upcoming tickets card with check-in state | 2 |
| FR-09 | Prospect contacts visible behind a list filter; detail page renders for any org contact | 3 |

## 5. Decisions taken (2026-09-20)

1. **Prospects are visible behind a list filter.** `/admin/customers` defaults to money-collected; `?scope=all` shows every contact of the org and the detail page renders for any of them. Phase 3 is no longer blocked.
2. **Email change is ADMIN-only.** It moves the buyer's sign-in identity and order history.
3. **`Lapsed` = no paid order in 18 months.** Fixed threshold; becomes an org setting only if organizers ask.

## 6. Follow-ups

- Manual / comp orders spec (see §3 deferred). The "Create order" button on the Shopify card is the single most valuable missing feature on this screen; it is deferred only because of size.
- Checkout could collect phone optionally once `Contact.phone` exists (organizer toggle under Settings › Customer accounts).
- Timeline entries for scan / check-in once the ticket summary ships.
