# Spec 037: Event workspace, vendor apply-then-choose, add-on library

Status: **complete 2026-09-26.** Approved with decisions §0 (they override the body). Shipped as PRs #211 (phase 0 customer fixes), #212 (1 Event Details), #213 (2 navigation + workspace), #214 (3 section editors + flyouts), #215 (4 saved add-ons + picker + receipt snapshot), #216 (5 apply-then-choose, with a review fix: superseded Checkout sessions are expired and never credited) and the phase 6 cleanup PR (`AddOn.productId` NOT NULL + `@@unique([eventId, productId])`, `ApplicationTier.mapBound` dropped). Production: `db:backfill:037-add-ons` linked 1 add-on; `db:backfill:037-applications` moved the 1 in-flight Game & Geek application (SUBMITTED + card on file → NOT_DUE, pending order cancelled); an end-to-end smoke (approve → select → saved test card → paid → refund → cleanup) passed in Stripe test mode.

**Deliberate deviation from §4.2:** `AddOn.name/description/scope/taxable` are **kept** as a write-through copy of the saved add-on instead of being dropped — checkout, fee math and the capacity SQL read the offering without a join, and `AddOnProductService` keeps them in step.
Created 2026-09-26 from `main` @ 3240a3c.

Scope, as requested:

1. The events list card opens a read-only **Event Details** page; each section has its own Edit.
2. Navigation: Participants and Tickets leave the main nav; Customers stays global.
3. Every purchase creates or attaches to a Customer (Contact); verify and fix gaps.
4. Tiers vs Tickets: audit, recommend a model, plan any migration.
5. Reusable add-on library under Events, referenced (not copied) by events.
6. Storefront: the vendor application no longer shows or sells booths. Apply → review → (approved) choose a location, in a list or on the map → pay.

---

## 0. Decisions, revision 1 (2026-09-26)

These override the body of the plan wherever the two differ.

**D1. Navigation.**
- Top level: Events · Venues · Maps · Orders · Customers · Check In · Analytics · Finance · Online store · Content · Settings.
- There is no Library section and no top-level Applications item. Tickets and Participants are removed from the top level.
- **Maps stays top level.** It lists event maps plus saved floor plans (the existing `FloorMapTemplate`). Actions: "Save as floor plan" and "Use on an event". A map is still one per event, because booth state (held or sold) belongs to the event. Reusing a floor plan means taking a copy of it for the new event.

**D2. No library pages. Saved items live where they are used.**
- Saved add-ons, tier presets and application templates are org-level records. They are managed **inside** the picker that uses them:
  - The event's add-on picker searches saved add-ons first and offers "Create '<typed name>'" only when no case-insensitive match exists.
  - Each option has Edit (a flyout) and Archive. Archived items leave the picker but keep their history.
- Where each one appears:
  - Tier presets: in the tier "Add tier ▾" menu.
  - Application templates: in "New form ▾ Blank / From template", and in the form's ⋯ menu as "Save as template".
  - Floor plans: under Maps.
- The data model is unchanged from §4.2. `AddOnProduct` is the saved add-on; the user interface never calls it a "library".

**D3. Applications stay per event.**
- `/admin/participants` is removed and there is no cross-event inbox.
- Cross-event vendor history lives on the customer: fix C2 lists every application on the Customer detail page, not just paid ones. Admin search still finds any application.
- A vendor becomes a Customer when their space order is paid. This already happens (paid orders of kind APPLICATION).

**D4. Categories are vendor space tiers.**
- `ApplicationTier` (for example Food truck, Table, Booth) is the category. The organizer picks it in the Approve dialog. It is required when the form has more than one active tier, and filled in automatically when there is exactly one.
- The vendor can then choose only spaces (booths) bound to that tier. The backend already enforces this in `BoothService.chooseBooth`.
- Without a map, the vendor pays for the tier and staff place them later through the existing assign flow.

**D5. The "approval guarantees a space" setting.**
- New per-form setting `ApplicationForm.reserveOnApproval`, default `true`.
- `true`: approval takes a slot in the tier. Approving is refused (Waitlist is offered instead) when the tier is full, so a vendor can never be approved without a space.
- `false`: approval takes nothing, and approved vendors choose on a first-come basis.
- In both cases the specific booth is chosen by the vendor, held for 15 minutes and paid.

**D6. One vendor flow only, no per-form switch.**
- Every PAID form moves to apply-then-choose, including open ones (Game & Geek 2026). The `spaceSelection` column from §4.3 is dropped.
- Migration of in-flight applications:
  - `tierId` becomes the assigned category.
  - APPROVED with a slot: moves to "awaiting space".
  - DRAFT stuck in `AWAITING_CARD`: submitted without a card.
  - A saved card is offered as "Pay with card ending 4242" at selection.
  - PENDING application orders with no payment are cancelled and recreated at selection.
- Smoke tests run on a throwaway test event and are deleted afterwards. Never on the real form.

**D7. There is no application fee for now.** FREE forms are unchanged.

**D8. Add-on dedupe targets `AddOn` rows copied by event duplication** (§4.2 backfill). Map items are out of scope.

**D9. Library price edits never change existing events.** An event's offering keeps its own price, which defaults to the saved price when the add-on is attached.

**D10. Section editors.**
- Full pages: Event details (description editor, media, venue) and Sales (tiers table).
- Flyouts, which become drawers on mobile: Admission, Listing, a single tier, add-on picks, and application form settings.

**D11. The Customers default list shows buyers only.** FREE applicants and RSVP-only contacts appear under "All contacts".

**D12. Checkout fills in a missing name only**; it never overwrites one (fix C4).

**D13. Ticket attendee edit.** The email change on the buyer's Contact is removed (bug C1). Named tickets are deferred.

---

## 1. Current architecture

### 1.1 Admin navigation (`frontend/src/components/AdminSidebar.tsx:48-84`)

One flat `navItems` array; no role or flag gating on any item today.

```
Dashboard        /admin/dashboard
Venues           /admin/venues
Events           /admin/events
Tickets          /admin/tickets          ← actually "Ticket Presets" (TierPreset CRUD)
Orders           /admin/orders           (Tickets toggle = issued-ticket rows)
Customers        /admin/customers
Participants     /admin/participants     (org-wide SubmissionsTable + forms/templates tab)
Maps             /admin/maps             (one map per event; list + builder)
Check In         /admin/orders/scan
Analytics        /admin/analytics
Finance          /admin/finance › Payouts
Online store     /admin/online-store › Pages, Preferences
Content          /admin/content › Files, Menus, Blog posts
Settings         (footer)
```

### 1.2 Per-event routes today

There is **no** `/admin/events/[eventId]` page. The per-event surfaces are scattered and do not link to each other:

| Route | What it is |
|---|---|
| `events/[eventId]/edit` | One 1,017-line form with anchor sections: Details, Media, Tiers (ticketed), Add-ons (saves immediately, outside the form), Date & venue, Admission, Listing |
| `events/[eventId]/applications` | Per-event `SubmissionsTable` + Forms tab + Door check-in link |
| `events/[eventId]/applications/[applicationId]` | Application detail (decision, payment, booth, add-ons) |
| `events/[eventId]/applications/forms[/formId]` | Form editor (tiers, questions, tier add-ons) |
| `events/[eventId]/check-in`, `rsvps`, `analytics` | Separate pages |
| `maps/[mapId]` | Map builder; links back to `/admin/maps`, never to the event |

Events list card (`components/events/EventListCard.tsx`): title and Edit button both go to `/edit`; ⋯ menu has View page, Applications, Duplicate, Copy link, Cancel.

### 1.3 Data model (relevant parts)

```
Organization ─ Venue ─ Event ─┬─ PriceTier ──────────── Ticket (issued, per unit)
                              │      └ PriceTierAddOn ┐
                              ├─ AddOn (per event) ───┤
                              │      └ ApplicationTierAddOn
                              ├─ ApplicationForm ─ ApplicationTier ─ Booth
                              ├─ FloorMap (1 per event) ─ Booth
                              ├─ EventRsvp
                              └─ Order (kind TICKET | APPLICATION) ─ OrderItem / OrderAddOn / PaymentTransaction / Refund
Organization ─ TierPreset (name, price, visibility, refundable; no qty, no window)
Organization ─ FloorMapTemplate (geometry only)
Organization ─ ApplicationFormTemplate (JSON snapshot; no add-ons)
Contact (organizationId + email unique) ─ Orders, Tickets, Applications, RSVPs
```

### 1.4 How purchases reach Customers

Only two code paths create an `Order`, and `Order.contactId` is `NOT NULL`, so every order has a Contact:

| Path | Contact | Order |
|---|---|---|
| Ticket checkout `POST /orders` (guest and signed-in buyer alike) | upsert on `organizationId_email`, `OrderService.js:291` | `kind TICKET` at creation (PENDING) |
| Vendor application, PAID form | upsert on `organizationId_email`, `ApplicationService.js:304` | `kind APPLICATION` at submission (PENDING); paid on approval / pay-now / booth choice |
| Vendor application, FREE form | same upsert | no order |
| RSVP | find-or-create on `organizationId_email`, `RsvpService.js:68` | no order (`EventRsvp`) |
| Add-ons, refunds, approval charge, pay-now, booth purchase | reuse the existing order and Contact | — |

Comp orders, box office and ticket transfer do not exist.

Customers list (`CustomerService.customerPredicate`) = contacts with at least one order in `PAID_ORDER_STATUSES`, **both kinds** — so a vendor who paid for a booth is already a customer, next to ticket buyers.

---

## 2. Findings per request

### 2.1 Customers (request 3) — the rule already holds; four gaps around it

Rule of the road, as it stands and as this plan keeps it:

> **A Customer is a Contact: one row per organization per email address.** Every order — ticket or vendor space — attaches to the Contact for `(organizationId, lower(trim(email)))`, creating it if missing. A Contact appears in the default Customers list once it has a paid order of either kind. Different organizations never share a Contact.

Gaps found (none create orphan orders):

| # | Gap | Proposed fix |
|---|---|---|
| C1 | **Ticket "attendee edit" rewrites the buyer's Contact** (`TicketService.updateTicketAttendee`, `:712`). Changing the email re-keys the customer and every sibling order; changing the name renames the buyer everywhere. | Bug. Either remove the email change (edit name only, and only when the ticket's order has one ticket), or add attendee fields to `Ticket` (see Q12). |
| C2 | Customer detail `applications[]` is built from **paid** application orders only (`CustomerService.js:330`). FREE, pending, due and cancelled applications show only in the timeline. | Read `contact.applications` directly so every application is listed, with its payment state. |
| C3 | Email normalization is duplicated per path; `OrderService` and `BuyerAuthService` lowercase but do not trim (safe today only because a validator regex rejects whitespace). | One `normalizeEmail()` helper used by every Contact upsert and lookup. |
| C4 | Checkout and application submit **overwrite** the Contact's name on every purchase; RSVP only fills blanks. Last buyer on a shared email wins. | Fill blanks only everywhere (RSVP behaviour); the order keeps its own name snapshot for receipts (Q11). |

Not a gap, but a question: FREE applicants and RSVP-only people have a Contact but no purchase, so they are hidden from the default list (visible under "All contacts"). That matches "record of purchases". See Q10.

### 2.2 Tiers vs Tickets (request 4) — your model is already the data model; the UI naming is the problem

| | What it is today |
|---|---|
| `PriceTier` | Configuration: name, price, `quantityTotal/Sold/Reserved`, sale window, min/max per order, visibility, refundable, add-on attachments. Edited only inside the event editor. |
| `Ticket` | Issued inventory. Created **only** by the Stripe webhook (`TicketService.createTicketsForOrder`), one row per unit, with barcode + QR. Scanned, redeemed, voided on refund. No transfer. |
| `TierPreset` | Org-level starting points for tiers (no quantity or window). **This is what the "Tickets" nav item manages** — the page title is "Ticket Presets". |
| Issued-ticket list | Lives in Orders › Tickets toggle (`/admin/orders?view=tickets`). |

So there is no redundant ticket configuration. The confusion is that the nav item named "Tickets" edits tier presets, while actual tickets live under Orders. I agree with your model and recommend:

- **Tier** = configuration, edited in the event's **Sales** section. Tier presets move to **Events › Library › Tier presets**.
- **Ticket** = issued inventory, shown per event on an **Attendees** view (lookup, check-in, refund), which is the Orders tickets view pre-filtered to the event. The org-wide Orders › Tickets toggle stays for cross-event lookup.
- **No schema change and no data migration for Ticket/PriceTier.** Only routes move, with redirects.

Where I partly disagree: the real duplication is **`PriceTier` vs `ApplicationTier`** — two tier models (tickets vs vendor spaces) with different capacity semantics (reserved at checkout vs taken at approval/selection), different parents (event vs application form), and different order-line FKs. Merging them would touch the ledger (`OrderItem`), capacity locking, booths, fees and the tax report. I recommend keeping both models and presenting them together under Sales as **Ticket tiers** and **Vendor space tiers**, and not merging them in this spec (Q5).

### 2.3 Add-ons (request 5)

- `AddOn` is scoped to one event. The only "library" is 5 hard-coded presets in `AddOnService.js:13-19`, each click creating a new per-event row.
- The duplication comes from **event duplication**: `EventService.duplicateEvent` → `AddOnService.copyForEvent` creates a fresh row per add-on on the new event (and `MapService.copyForEvent` copies the map and booths).
- Map palette items (booth, table, stage, entrance, …) are a hard-coded frontend catalog stored in `FloorMap.layout`; they are not add-ons and are not a table. (Q7 checks which duplication you meant.)
- `OrderAddOn` has **no name snapshot**, so receipts read the live `AddOn.name`. A shared library would let a rename rewrite past receipts — this must be fixed before the library ships.

### 2.4 Vendor application → location purchase (storefront)

Most of "apply first, choose and pay later" already exists (spec 014 phase 2): after approval, a vendor on a map-bound tier sees `BoothPicker` on the application status page, holds a booth for 15 minutes, and pays (saved card or Checkout). Booth states AVAILABLE → HELD → SOLD, webhook-authoritative.

What does not match the new direction:

- The apply form still has a **Choose an option** step (tier radio list + add-ons + total) and, on PAID forms, sends the vendor to Stripe to **save a card** (APPROVAL timing) or **pay** (SUBMIT timing) before the application exists as SUBMITTED.
- A PAID application creates its `Order` at submission.
- Capacity is taken **at approval** against the tier the vendor picked at submission.
- **`ApplicationTier.mapBound` can never be turned on** outside tests — no validator, UI or map-publish path sets it — so the post-approval picker is unreachable in production today.
- The picker is map-only; there is no list/map toggle and no list-based choice for events without a map.

---

## 3. Proposed information architecture

### 3.1 Top-level nav

```
Dashboard
Events                         /admin/events
  ├ All events                 /admin/events
  ├ Applications               /admin/events/applications        (cross-event inbox; optional, Q2)
  └ Library                    /admin/events/library
      ├ Add-ons                /admin/events/library/add-ons
      ├ Tier presets           /admin/events/library/tier-presets
      ├ Map templates          /admin/events/library/map-templates
      └ Application templates  /admin/events/library/application-templates
Venues
Orders                         (Tickets toggle stays for cross-event ticket lookup)
Customers
Check In
Analytics
Finance › Payouts
Online store › Pages, Preferences
Content › Files, Menus, Blog posts
Settings (footer)
```

Removed from top level: **Tickets** (→ Library › Tier presets), **Participants** (→ per-event Applications, optional cross-event inbox), **Maps** (→ per-event Map; templates → Library; Q3).

### 3.2 Per-event workspace

```
/admin/events/[eventId]                       Event Details (read-only summary; default landing)
  ├ /edit/details                             Details, media, date & venue, listing
  ├ /edit/sales                               Admission mode, capacity, ticket tiers, sales windows, ticket add-ons
  ├ /applications                             Application queue (SubmissionsTable, eventId-scoped)
  │   ├ /[applicationId]                      Application detail (unchanged)
  │   └ /forms[/formId]                       Form editor: questions, vendor space tiers, vendor add-ons
  ├ /map                                      Map builder (moved from /admin/maps/[mapId])
  ├ /attendees                                Issued tickets (lookup, check-in, refund) — or /rsvps for RSVP events
  ├ /check-in                                 Door check-in (unchanged)
  └ /analytics                                Unchanged
```

A shared per-event header (name, date, status, Publish / View page / ⋯) and a secondary tab bar (Overview · Sales · Applications · Map · Attendees · Analytics) sit on every page above, so the event is one workspace instead of six disconnected pages. Tabs that do not apply are hidden (Applications/Map when there is no form or map yet show an empty state with a "Set up" action instead).

### 3.3 Event Details sections (read-only, each with Edit)

| Section | Shows | Edit goes to |
|---|---|---|
| Header | Name, status, date (venue zone), venue, public URL, image | Publish / Duplicate / Cancel in ⋯ |
| Event details | Description (rendered via `ContentHtml`), category, slug, media | `/edit/details` |
| Date & venue | Date/time with zone, venue address, venue time zone | `/edit/details#when-where` |
| Admission | Ticketed or RSVP, event capacity, RSVP limit / party size | `/edit/sales` |
| Sales | Per-tier table: price, sold / reserved / total, sale window, visibility, refundable; add-ons with sold counts; gross, net (`orgReceives`), refunds; tax rate + source | `/edit/sales`; revenue links to Orders filtered to event |
| Applications | Per form: status, open/close dates, counts by status (submitted, waitlisted, approved, awaiting location, paid) | `/applications`, forms editor |
| Map & vendor spaces | Map status (draft/published), thumbnail, booths by status, vendor space tiers with price and booths | `/map` |
| Attendees / RSVPs | Tickets issued, checked in, RSVPs going / party total | `/attendees`, `/check-in`, `/rsvps` |
| Payments & fees | Fee mode, payment method summary, tax region (read from org settings) | Link to Settings › Payments / Tax |

Numbers come from one new `GET /organizations/:orgId/events/:eventId/overview` aggregate endpoint so the page is one request, not eight.

### 3.4 Storefront vendor flow

```
Event page ─ Get involved ─► /events/:id/apply/:formSlug
    Your details · Your business · Questions · Consent ─► Submit   (no tier, no booth, no payment)
            │
            ▼  status page /events/:id/apply/status/:applicationId  (email link)
    SUBMITTED ─► organizer reviews in Event › Applications
            │ approve
            ▼
    APPROVED · "Choose your space"
      [ List | Map ]  toggle (Map shown only if the event has a published map)
      List: vendor space tiers with price, spaces left, add-ons
      Map : BoothPicker; booth implies tier
            │ select ─► 15-min hold ─► Stripe Checkout (payment mode) ─► webhook ─► SOLD, order paid
```

---

## 4. Proposed data model changes

### 4.1 Tier / Ticket

No schema change. Route moves only (§6, phase 2). Optional follow-ups gated on answers: attendee fields on `Ticket` (Q12), `OrderItem` name snapshot already exists as `description`.

### 4.2 Add-on library

```prisma
model AddOnProduct {             // org library item — the shared definition
  id             String     @id @default(cuid())
  organizationId String
  name           String
  description    String?
  defaultPrice   Decimal    @db.Decimal(10, 2)
  scope          AddOnScope @default(BOTH)     // TICKET | APPLICATION | BOTH
  taxable        Boolean    @default(true)
  isArchived     Boolean    @default(false)
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  organization   Organization @relation(...)
  offerings      AddOn[]
  @@unique([organizationId, name])
}

model AddOn {                    // becomes the per-event offering of a library item
  ...existing columns
  productId      String            // nullable during phase 4a, required after backfill
  product        AddOnProduct @relation(...)
  @@unique([eventId, productId])   // one offering per item per event: no duplicates
}

model OrderAddOn {
  ...existing columns
  name           String            // new: snapshot at purchase, backfilled from AddOn.name
}
```

Field ownership:

| Shared (library, edit once) | Per event (offering) |
|---|---|
| name, description, scope, taxable | price (defaults to library price), quantityTotal, maxPerOrder, isActive, displayOrder, tier attachments (`allTiers`, `PriceTierAddOn`, `ApplicationTierAddOn`) |
| | quantitySold / quantityReserved (inventory is per event and must stay so for capacity locking) |

`AddOn.name/description/scope/taxable` stay as columns during the transition and are dropped in phase 6 once reads go through `product`. Existing capacity SQL (`AddOnService.reserve/release/commit/unsell`) is untouched — it only uses per-event counters.

Event duplication: `copyForEvent` creates offerings pointing at the same `productId` (no new library rows). The 5 hard-coded presets become seed suggestions that create library items.

**Dedupe backfill** (`npm run db:backfill:037-add-ons`, dry run unless `DRY_RUN=false`, same pattern as `db:backfill:event-descriptions`):

1. Group every `AddOn` by `(event.venue.organizationId, lower(trim(name)), scope, taxable)`.
2. Create one `AddOnProduct` per group: name = most recent spelling, description = most recent non-null, `defaultPrice` = most common price (ties → most recent).
3. Point every `AddOn` in the group at it. Price differences stay on the offering, so no event's price changes.
4. Same name but different `scope`/`taxable` → separate products, suffixed and listed in the report for manual merge.
5. Two offerings of one product on the **same event** (possible today) → reported, not merged automatically: both have their own sales and inventory. The `@@unique([eventId, productId])` constraint is added only after the report is clean.
6. Backfill `OrderAddOn.name` from the current `AddOn.name` before any rename is possible.
7. Report: products created, offerings linked, conflicts. Run on dev, review, then prod.

### 4.3 Vendor apply-then-choose

Per-form switch so in-flight applications keep their current path:

```prisma
enum SpaceSelection { AT_SUBMISSION  AFTER_APPROVAL }
model ApplicationForm { ... spaceSelection SpaceSelection @default(AFTER_APPROVAL) }  // existing rows backfilled AT_SUBMISSION
```

Behaviour for `AFTER_APPROVAL` forms:

| Step | Today (AT_SUBMISSION) | New (AFTER_APPROVAL) |
|---|---|---|
| Submit | tier required, add-ons, Checkout to save card / pay, `Order` created PENDING | no tier, no add-ons, no Stripe, **no order**; status SUBMITTED immediately |
| Approve | takes tier capacity; charges saved card, or PAYMENT_DUE | no capacity taken; status APPROVED, payment `AWAITING_SELECTION` (new enum value); email "choose your space" |
| Choose | map-bound only, via BoothPicker | list (tier) or map (booth); hold 15 min; **order created here**; add-ons chosen here |
| Pay | saved card or pay-now | Stripe Checkout, payment mode; webhook marks paid, booth SOLD, tier `quantityApproved`++ |
| Overdue | `paymentDueDays` from approval | same clock starts at approval; sweep withdraws or holds per `overduePolicy` |

- `mapBound` is replaced by derivation: a tier is map-bound when the event's published map has booths on it. Map publish sets `quantityTotal` for those tiers (existing logic, minus the flag).
- Waitlist semantics change: approval no longer guarantees a space; spaces are first-come among approved vendors. The organizer can still assign a booth or tier directly (existing `BoothService.assign`), which creates the order for them.
- Spec 024's rule "a PAID application is an Order from submission" becomes "from selection" for these forms. `Order.applicationId` stays unique; money still lives only on the order.
- FREE forms (press, panels) are unchanged.
- `chargeTiming` stays for legacy forms; new forms do not show it.

### 4.4 Customer linkage

No schema change. Code fixes C1–C4 (§2.1).

---

## 5. Admin applications consolidation

- The per-event **Applications** page becomes the one review surface: queue (`SubmissionsTable` with `eventId`), forms, check-in link, and a new **Awaiting space** filter. It is reachable from the Event Details Applications section and the event tab bar.
- `/admin/participants/*` is removed. Its org-wide table survives only as Events › Applications if you want a cross-event inbox (Q2); templates move to Events › Library.
- `useParticipantsApi` moves to `components/applications/` (it is imported by four event-scoped files).
- Redirects in `next.config.mjs`: `/admin/participants` → `/admin/events/applications` (or `/admin/events`), `/admin/participants/templates/:id` → library, `/admin/tickets` → `/admin/events/library/tier-presets`, `/admin/maps/:mapId` → `/admin/events/:eventId/map` (needs a lookup, so a small server redirect page, not a static rule), `/admin/events/:id/edit` → `/admin/events/:id/edit/details`.
- Link updates: `SetupGuideService.js:63`, `lib/adminSearch.ts:48`, `AdminSearchService.js:18` (event results → Details page), `TemplateDialogs.tsx:208`, forms editor, e2e specs (`participants*.spec.ts`, `admin-maps.spec.ts`, `signup.spec.ts`, `admin-setup-guide.spec.ts`).

---

## 6. Phased implementation (each phase ships on its own)

| Phase | Contents | Schema | Risk |
|---|---|---|---|
| **0. Customer fixes** | C1 attendee-edit bug, C2 detail lists all applications, C3 `normalizeEmail`, C4 fill-blanks names. Contract tests per path. | none | low |
| **1. Event Details page** | `/admin/events/[id]` read-only overview + `overview` endpoint; card becomes a link, Edit button removed; shared event header + tab bar linking to existing edit/applications/map/rsvps/analytics pages; admin search event results → Details. | none | low |
| **2. Navigation** | Remove Tickets, Participants, Maps from sidebar; Events children (All events, Applications?, Library); tier presets, map templates, application templates pages under Library; per-event `/map` and `/attendees`; redirects; link + e2e updates; `useParticipantsApi` move. | none | medium (many links) |
| **3. Section editors** | Split the 1,017-line editor into `/edit/details` and `/edit/sales` over the same PATCH (plus tier + add-on endpoints). Each Edit on the Details page opens its editor and returns to Details on save. | none | medium |
| **4. Add-on library** | 4a: `AddOnProduct`, nullable `AddOn.productId`, `OrderAddOn.name` + backfill script (dry run → review → apply). 4b: Library › Add-ons pages; event Sales / form editor pick from library ("Add from library" + "Create new item"); duplication references products. 4c: `productId` required + `@@unique([eventId, productId])`. | yes | medium |
| **5. Apply-then-choose** | `spaceSelection` column (existing forms backfilled `AT_SUBMISSION`); submit without tier/payment; approval without capacity; choose-your-space page with List / Map toggle; order + hold at selection; derived map binding; emails, digest, sweep; admin "Awaiting space" filter. Behind the per-form switch, so existing open forms are untouched. | yes | high (money + capacity) |
| **6. Cleanup** | Drop `mapBound`; drop `AddOn.name/description/scope/taxable`; switch remaining legacy forms after their events end; wiki + AGENTS.md. | yes | low |

Phases 0–3 are UI and correctness only and can ship independently. Phase 4 and 5 are independent of each other. Every phase: worktree, PR, required CI green, `/doc-feature`.

---

## 7. Open questions

See the chat reply for the numbered list (Q1–Q12); answers will be recorded here.
