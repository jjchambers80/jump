# Spec 014 — Maps: booth floor plan builder, self-serve spot purchase, public map

**Status**: Proposed (2026-09-20). Not implemented. Number 014 was reserved for "floor map" in the spec 011 hand-offs (`specs/011-applications/plan.md` §hand-offs, `docs/roadmap.md` discovery table) and never specified — this document is that spec.
**Source**: Organizer discovery interview on Eventeny, 2026-09-15 — [docs/research/2026-09-15-eventeny-organizer-interview.md](../../docs/research/2026-09-15-eventeny-organizer-interview.md) (MAP-01…04, pain points 4 and 5, recommendations 4 and 11). Product direction 2026-09-20: a Ticketmaster-grade map with a **fixed visual language** (no free shapes, no colour picker); an approved vendor picks a spot and buys it; a bought spot is marked sold.
**Builds on**: spec 011 applications (`ApplicationForm` / `ApplicationTier` / `Application`, card on file, charge on approval, pay-now, `PAYMENT_DUE`), spec 012 add-ons, spec 024 one ledger (`Order kind: APPLICATION`), spec 025 Files (`StoreFile` underlay), spec 019 Participants (templates pattern, tags), spec 007 tenant identity (buyer account, custom domains), spec 020 abuse protection (limiter factory, sweeps).

## 1. What Jump has today

- `Application.boothLabel String?` — free text an organizer types on the application detail page (spec 011 §Out of scope: "Booth/table assignment and the floor map are spec 014"). No geometry, no inventory, no public surface.
- `ApplicationTier` — priced, capacity-limited (`quantityTotal / quantityApproved / quantityReserved`, `FOR UPDATE` locking through `ApplicationService._takeCapacity`). A tier is "10×10 booth — $275, 40 available"; nothing says *which* 10×10.
- Approval of a PAID application **reserves the tier and charges the saved card in one step**; a failed charge leaves `APPROVED + PAYMENT_DUE` with a pay-now Checkout link (`ApplicationService.payNow`, `payNowForContact`) and an hourly sweep for overdue balances.
- Public event page lists forms under "Get involved"; buyer account lists applications with pay-now. No map anywhere.
- Content › Files gives org-scoped image uploads with hash URLs — usable as a map underlay.

## 2. What the organizer asked for (interview) vs the 2026-09-20 direction

| Interview item | Verdict |
|---|---|
| MAP-01 builder with snapping, alignment guides, row duplication, numbered booths | **Build (phase 1)** — with a constrained palette: the organizer places booths, tables and a fixed set of venue markers; they never pick colours or free shapes |
| MAP-02 organizer assigns an approved vendor to a booth; public map updates immediately | **Build (phase 1 assign, phase 2 sale)** — kept as the manual path for comps, sponsors and moves. The primary path becomes **the vendor picks and buys** |
| Pain 4 stale public map (cache) | **Design constraint** — public reads are uncached in v1; any later cache must invalidate on every booth write (interview recommendation 4) |
| Pain 5 lopsided builder, poor mobile | **Design constraint** — grid snap, guides, one visual system; the public map is touch-first (pinch, tap, sheet) |
| MAP-03 vector PDF export of the current state | **Build (phase 3)** |
| MAP-04 message a vendor a link that highlights their booth | **Build (phase 3)** — `?booth=` deep link on the public map, used by the approval / assignment emails |
| QR → map → booth → vendor profile + alphabetical key | **Build (phase 3)** — profile opt-in per application (spec 011 plan: "organizer-only visibility until spec 014 opts a profile into a public directory") |
| **New:** approved vendor selects a spot and buys; spot marked sold | **Build (phase 2)** — the reason this spec exists now |

## 3. Technology research (2026-09-20)

### 3.1 Buy vs build

| Option | What it is | Fit | Cost | Verdict |
|---|---|---|---|---|
| **seats.io** | Hosted seat-map renderer + embeddable designer, per-used-seat pricing; supports booths and tables | Polished renderer; designer is generic (seats, sections, tables) and cannot be constrained to Jump's palette; assets live on their servers, so the "stale map" class of bug moves out of our control | Silver €450/yr for 2,500 used seats, €0.18/seat over; a used booth is billed per event | **No.** Per-object fee on every sold booth, third-party JS on the storefront, and the designer is the opposite of the fixed visual language asked for |
| **ExpoFP** | Floor-plan SaaS for expos; DWG/DXF/PDF import, exhibitor self-serve booth purchase, API | Whole product, not a component; iframe embed with their branding; own checkout | From $149/mo (≤100 booths DIY), $1,500–$2,100 per event designed | **No.** Duplicates Jump's applications, payments and ledger; violates "platform brand stays out of the storefront" |
| **Map D (Map Dynamics)**, **Map Your Show**, **A2Z**, **ExpoCAD** | Enterprise expo suites with booth sales | Same as ExpoFP, quote-based | Quote | **No** |
| **Mappedin** | Indoor-mapping SDK (wayfinding), from $55 / 1,000 m² / month | Built for malls and campuses; an event layer would be custom anyway | Per-area fee | **No** |
| **Build in-house** | SVG map rendered by React, constrained builder, booths as DB rows locked like `PriceTier` | Exactly the requested UX; storefront `brand` tokens; one ledger; no per-booth fee — the incumbent's $360/mo map tier cliff is the thing to avoid | Engineering time (three phases below) | **Yes** |

### 3.2 Rendering approach

| Approach | Notes | Decision |
|---|---|---|
| **SVG in React (DOM)** | Native hit-testing, hover/focus, CSS variables (`brand` tokens), keyboard access, `<title>` tooltips, trivially the same markup for the PDF export. Handles a few thousand elements; a 160–600 booth expo is far below that | **Chosen** for viewer and builder |
| Canvas via Konva 10 / react-konva 19 | Better past ~5k interactive shapes; loses DOM accessibility and CSS theming; needs its own text layout for PDF | Fallback only if a map ever exceeds ~3k elements (not expected) |
| WebGL (PixiJS 8) / MapLibre | Stadium scale or GIS; over-engineered | No |
| tldraw / Excalidraw / Fabric.js | Free-form drawing — the opposite of a constrained palette | No |

Supporting libraries (all current on npm 2026-09-20):

- `react-zoom-pan-pinch` 4.2 — viewport pan / wheel zoom / pinch for viewer and builder; `frontend` already ships React 18 and Next 14.2.
- Drag, resize, marquee and snapping in the builder are plain pointer events on SVG coordinates (`getScreenCTM().inverse()`); `@dnd-kit` (already a dependency) is a DOM-list DnD library and is **not** used on the canvas.
- Vector PDF (phase 3): server-side `pdfkit` + `svg-to-pdfkit` rendering the same SVG the storefront shows, so print and web are one source (interview recommendation 11).
- Underlay: an image from Content › Files (`StoreFile`), locked beneath the grid at a set opacity, exported as a raster layer in the PDF.

### 3.3 Visual language (fixed, not configurable)

Ticketmaster's seat map works because every object means one thing. Jump's map has exactly these objects and states:

| Object | Shape | Editable properties |
|---|---|---|
| **Booth** | Rounded rectangle, label centred | label, size (from the tier's preset or W×H in grid units), rotation 0° / 90°, tier |
| **Table** | Rounded rectangle, smaller radius, label | label, size, tier |
| **Stage**, **Entrance**, **Restroom**, **Food**, **Info**, **First aid**, **Programming area** | Neutral block with a fixed icon + optional caption | caption, size |
| **Text label** | Text only (aisle names, hall names) | text, size S / M / L |
| **Wall / aisle line** | 1-unit line, horizontal or vertical | length |

Booth colour is **derived**, never chosen: each `ApplicationTier` bound to the map gets one of six fixed categorical swatches (accessible in both theme modes) in tier display order; the legend lists tier name + all-in price. States override the swatch:

| State | Look |
|---|---|
| Available | tier swatch fill, label |
| Selected (by the viewer) | `brand` accent outline + fill, checkmark |
| Held (someone is checking out) | swatch at 40 % + clock glyph; not selectable |
| Sold | neutral grey, vendor short name under the label (public) / full name (admin), diagonal hatch in print |
| Reserved by organizer | swatch outline, dashed, "Reserved" |
| Blocked | dark grey, × — not for sale |

No fill picker, no font picker, no free polygons, no image stamps other than the underlay. Organizers who need a bespoke look export the PDF and finish it in their tools — the hosted map stays clean.

## 4. Design

### 4.1 Data model

```prisma
model FloorMap {
  id              String        @id @default(cuid())
  organizationId  String
  eventId         String        @unique          // one map per event in v1
  name            String
  status          FloorMapStatus @default(DRAFT) // DRAFT | PUBLISHED
  unit            String        @default("ft")   // display only
  gridSize        Int           @default(10)     // px per grid unit in the editor
  width           Int                            // grid units
  height          Int
  underlayFileId  String?                        // StoreFile
  underlayOpacity Int           @default(40)
  layout          Json                           // { version: 1, elements: [non-booth objects] }
  publishedAt     DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  booths          Booth[]
  @@index([organizationId])
}

model Booth {
  id              String      @id @default(cuid())
  mapId           String
  label           String
  kind            BoothKind   @default(BOOTH)    // BOOTH | TABLE
  x               Int                            // grid units
  y               Int
  w               Int
  h               Int
  rotation        Int         @default(0)        // 0 | 90
  tierId          String?                        // ApplicationTier that sells this booth
  status          BoothStatus @default(AVAILABLE) // AVAILABLE | HELD | SOLD | RESERVED | BLOCKED
  applicationId   String?     @unique            // SOLD / RESERVED holder
  holdApplicationId String?                      // HELD by (checkout in flight)
  holdExpiresAt   DateTime?
  assignedById    String?                        // staff who assigned manually, null when self-serve
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  @@unique([mapId, label])
  @@index([mapId, status])
  @@index([tierId])
}
```

Booths are **rows, not JSON**, so a purchase takes `SELECT … FOR UPDATE` on the booth exactly like tier capacity on `PriceTier` / `ApplicationTier` (Core constraint "Capacity"). Decorative objects stay in `FloorMap.layout` JSON (validated against a versioned schema on write). `Application.boothLabel` stays as the display string and is written from `Booth.label` whenever a booth is sold / assigned / moved, so every existing surface (submissions table, CSV, emails, digest) shows the booth without a join.

`ApplicationTier.mapBound Boolean @default(false)`: when true, `quantityTotal` is derived from the count of booths with that `tierId` on publish and is read-only in the tier editor; tier capacity and booth inventory can never disagree.

### 4.2 Purchase flow (phase 2)

Only PAID forms whose tiers are map-bound change behaviour; every other form keeps spec 011 exactly.

1. **Submit** — unchanged: profile, answers, add-ons, card on file (`CARD_ON_FILE`). No booth yet. Map-bound tiers require `chargeTiming = APPROVAL` (validator refuses `SUBMIT`, §6 decision 3).
2. **Approve** — `_takeCapacity` reserves the tier slot as today but **does not charge**. Application becomes `APPROVED + PAYMENT_DUE`, `order.dueAt = now + paymentDueDays`; the APPROVED template gains a **Choose your booth** button (status page or account) instead of "Paid".
3. **Choose** — the vendor opens the map filtered to their tier (other tiers dimmed, sold greyed), taps a booth, sees "Booth A12 · 10×10 · $275.00 all-in" and **Buy**.
4. **Hold** — `POST /applications/:id/booth { boothId }` (guest token or buyer session; `APPLICATION_SUBMIT`-class limiter): `FOR UPDATE` on the booth, `AVAILABLE → HELD` with `holdExpiresAt = now + BOOTH_HOLD_MS` (default 15 min). 409 `BOOTH_TAKEN` if not available; the map refetches.
5. **Pay** — card on file → the existing off-session charge path (`retryCharge` internals) runs immediately; no card → `payNow` mints a Checkout session with `metadata.boothId`. Either way the application is `PROCESSING` and the booth stays `HELD` until Stripe confirms (interview PAY-03: pending is not paid).
6. **Sold** — `payment_intent.succeeded` / `checkout.session.completed` (routed on `metadata.applicationId`, Gotcha 15) → `HELD → SOLD`, `applicationId` set, `boothLabel` written, `PAID`, receipt email with a `?booth=` map link.
7. **Failed / abandoned** — charge failure or hold expiry (minute sweep) → `HELD → AVAILABLE`; application stays `APPROVED + PAYMENT_DUE` and can choose again until `dueAt`; the existing overdue sweep applies.
8. **Release** — withdraw, reject after approval, full refund (`RefundService.refundOrder`) or tier change → booth `AVAILABLE`; partial refund keeps it. Deleting a `SOLD` / `HELD` booth in the builder is a 409.

Organizer manual path (phase 1, kept for comps / sponsors / moves): **Assign** an APPROVED application to any non-sold booth (`SOLD` with `assignedById`, no money movement — the application's own payment state is untouched), **Move** (swap two booths under one transaction), **Unassign**, **Reserve** / **Block**. A manual assignment to a vendor whose payment is still due keeps `PAYMENT_DUE`; the "Choose your booth" step is skipped and pay-now shows the assigned booth.

### 4.3 Public map

- Route `/events/:slug/map` on the storefront (platform host and custom domains), rendered inside `BrandScope` with `themeMode`; embedded as a section on the event page when the map is `PUBLISHED`. Add the path to `isReservedPath` (`backend/src/utils/redirectPath.js`) and `storefrontHost.ts` (Gotcha 22).
- `GET /public/events/:id/map` returns geometry + booth states + (phase 3) opted-in vendor profiles. **No Redis cache in v1**; `Cache-Control: no-store`, `ETag` from `FloorMap.updatedAt` + max `Booth.updatedAt`. If a cache is added later it must be invalidated by `BoothService` on every write — the interview's headline map failure.
- Touch-first: pinch zoom, tap → bottom sheet on mobile / popover on desktop; keyboard: booths are focusable, arrow keys move focus, Enter opens. Legend + "Find a vendor" search (phase 3).
- `?booth=A12` centres and pulses that booth (MAP-04).

### 4.4 Navigation — a top-level **Maps** item

Decision: add **Maps** to the admin sidebar (`frontend/src/components/AdminSidebar.tsx`) after **Participants**, icon `Map`, route `/admin/maps` (list of every event's map with status, booths sold / total) and `/admin/maps/[mapId]` (builder). The event admin page gets a **Map** tab that deep-links to the same builder — one component, two entry points, following the Participants / per-event Applications tab pattern (Gotcha 18).

Why not elsewhere:

- *Under Venues* — the hall is the venue's, but pricing, tiers and sales are per event; an org that runs three events in one hall wants three maps with different tier bindings. A "start from last event's map" copy (event duplicate already copies forms) covers reuse without making the venue own inventory.
- *Only a tab on the event* — the builder is a full-canvas surface that needs the width; organizers also want to see all maps across events (which are published, which have unsold booths).
- *Under Participants* — sales state lives there, but the map is also a public content surface and the builder is a distinct tool; nesting it two levels down hides the feature that drove the incumbent's price tier.

## 5. Triage plan

Cards follow `docs/development/kanban-workflow.md`, tenant `maps`, created 2026-09-20: phase 1 `t_462985aa` (JUMP-014A), phase 2 `t_147a5300` (JUMP-014B), phase 3 `t_ced07623` (JUMP-014C); linked 1 → 2 → 3. Each phase is one PR, in order; phase 3 items are independent of each other and can be split.

### Phase 1 — Builder, inventory, manual assignment, public read-only map

Outcome: an organizer draws a clean numbered floor plan for an event, binds booths to application tiers, assigns approved vendors, and publishes a public map that is never stale.

- Schema: `FloorMap`, `Booth`, enums, `ApplicationTier.mapBound`. One migration.
- Backend `MapService` / `BoothService` (routes `/admin/maps*`, `activeOrgFor(req)`): CRUD map, bulk booth upsert from the builder (one `PUT` of geometry, like Menus' whole-tree save, Gotcha 21), publish / unpublish (publish sets `mapBound` tiers' `quantityTotal`), assign / move / unassign / reserve / block with `FOR UPDATE`, 409 on deleting `SOLD` / `HELD` booths. `GET /public/events/:id/map`. `Application.boothLabel` written on assign / move / unassign. Event duplicate copies the map (`DRAFT`, all booths `AVAILABLE`, tier bindings remapped).
- Builder (`/admin/maps/[mapId]`, `'use client'`, SVG + `react-zoom-pan-pinch`): tool palette per §3.3, grid snap + alignment guides, marquee select, **Row tool** (drag out N booths with gap), **Duplicate row/column**, auto-number (prefix, start, direction), rotate, tier assignment on selection, underlay picker from Files (spec 025 `syncReferences` for *Used in*), undo / redo, autosave draft, Publish. Booth panel shows tier, price, status, holder; **Assign** opens a searchable list of APPROVED applications on that form.
- Maps list page + sidebar entry + event **Map** tab.
- Public map (`/events/:slug/map` + event-page section): states, legend, tooltip / sheet with booth label, size, tier price, vendor name when sold; `?booth=` highlight; no-cache headers.
- Tests: unit (layout schema validation, auto-number, publish sync of `quantityTotal`, assign / move locking with concurrent transactions), contract (`PUT` geometry, 409 delete sold booth, public route 404 for DRAFT), Playwright (draw a row, number it, assign, publish, public map shows the vendor) via `signInAsStaff`.
- Non-goals: self-serve purchase, PDF, profiles, templates.
- **Map templates (phase 3)**: `FloorMapTemplate` org-scoped JSON snapshots (schemas/014-phase-3/map-templates.md). Templates store geometry only — no booth state, tier ids, assignments, or vendor data. Create a map from a template via `POST /admin/maps { templateId, tierBindings }`; `MapService.create` materialises booths in one transaction. `saveFrom` on `POST /admin/maps/:mapId/templates` strips live IDs/state/assignments before persisting. Reusable template CRUD at `/admin/maps/templates*`. Definition validation rejects any event-specific field; `materialise()` output is deterministic and stable for downstream code. See `docs/wiki/features/map-templates.md`.

### Phase 2 — Vendor selects a spot and buys

Outcome: an approved vendor chooses their own booth from the map and pays; the booth is sold the moment Stripe confirms and never before.

- Purchase flow §4.2: approval branch for map-bound tiers (`PAYMENT_DUE` without a charge), `POST /applications/:id/booth` (guest token + `/buyer/me/applications/:id/booth`), hold with `FOR UPDATE`, off-session charge or Checkout with `metadata.boothId`, webhook transitions `HELD → SOLD`, hold-expiry sweep (`BOOTH_HOLD_MS`, `BOOTH_SWEEP_INTERVAL_MS`), release on withdraw / reject / full refund / tier change.
- Validator: map-bound tiers require `chargeTiming = APPROVAL`; tier editor shows the derived quantity read-only.
- Emails: APPROVED template variant "Choose your booth" (button + deadline), receipt with the booth and map link; organizer digest counts "approved, booth not chosen".
- Vendor UI: map picker on the application status page and in the buyer account (tier filter, Buy sheet with all-in price, "held for 15:00" countdown, taken-booth refetch), pay-now continues to work when a booth was assigned manually.
- Admin: submissions table gets a **Booth** column + "Booth not chosen" filter; application detail shows the booth with Move / Unassign; Orders detail shows the booth line description ("Booth A12 · 10×10").
- Tests: unit (state machine incl. failure and expiry, concurrent hold on one booth → exactly one wins), contract (choose → hold → webhook → SOLD; hold expiry; 409 `BOOTH_TAKEN`; refund releases), Playwright (approve, choose, pay with test card, map shows sold).
- Non-goals: choosing a booth at submission, sponsors on the map, multiple booths per application.

### Phase 3 — Public directory, deep links, PDF, templates

Outcome: the public map is the day-of wayfinding surface and the print source; layouts are reusable.

- **Vendor profiles on the map**: per-application `publicProfile` opt-in (organizer toggle, default on for APPROVED vendors; the applicant's business name, description, website, socials, first photo from `ApplicantProfile`), popover / sheet on sold booths, alphabetical **Key** list under the map with booth numbers and search, QR-friendly `/events/:slug/map` on custom domains.
- **Highlight link** (MAP-04): `?booth=` in approval / assignment / move emails and a "Copy map link" on the booth panel.
- **Vector PDF export** (MAP-03): `GET /admin/maps/:id/export.pdf` — `pdfkit` + `svg-to-pdfkit` over the same SVG, print styles (hatch for sold, greyscale-safe swatches), legend, key list, page size Letter / A3 / Tabloid, underlay as raster layer. "Download PDF" on the builder and the Maps list.
- **Map templates**: org-level `FloorMapTemplate` snapshots (save as / create from) mirroring `ApplicationFormTemplate` (Gotcha 18), materialised through one service method so event duplication and create-from share it.
- Menus link picker gains **Event map** as a target kind (spec 027).
- Tests: contract (public profile only when opted in and APPROVED; PDF content type + size), unit (key list ordering, template materialise), Playwright (search key list → booth highlighted).
- Non-goals: 3D, CAD import, wayfinding routes.

### Deferred (recorded, not carded)

| Item | Where |
|---|---|
| Choose a booth **at submission** (Ticketmaster order: pick, then pay, then organizer review) — needs multi-week holds and a hold-per-contact cap | Revisit after phase 2 data shows whether organizers want it; would reuse the hold path with `chargeTiming = SUBMIT` |
| Sponsors / programming with map placement but no booth sale | Phase 3 markers cover "programming area"; sponsor logo placement is a branding question |
| One application buying **several adjacent booths** | Own follow-up; today one application = one tier slot |
| Multi-hall / multi-floor events | One map per event in v1; second hall = second map is a schema-only change (`eventId` unique → index) |
| DWG / DXF import | Not for the target segment (Canva / Illustrator users); PDF/PNG underlay covers it |
| GA areas, seat-level ticketing on the same engine | Different product (ticket tiers, not applications); the SVG renderer and `Booth` locking are reusable if it ever comes |

## 6. Decisions taken (2026-09-20)

1. **Build in-house on SVG**; no seats.io / ExpoFP. Reason: constrained visual language, storefront branding, one ledger, no per-booth fee (§3.1).
2. **Top-level Maps sidebar item** plus an event **Map** tab to the same builder (§4.4).
3. **Money moves at spot selection, not at approval**, for map-bound tiers. Approval = capacity reserved + invitation to choose; sold only on Stripe confirmation. Map-bound tiers require `chargeTiming = APPROVAL` in v1.
4. **Booths are rows** locked with `FOR UPDATE`; decorative objects are JSON. Tier quantity is derived from bound booths.
5. **No public-read cache in v1**; ETag only. A cache later must be write-invalidated.
6. **One map per event**; reuse through event duplicate (phase 1) and templates (phase 3), never through a venue-owned map.
7. **Fixed palette**: six tier swatches auto-assigned in display order, fixed state colours, fixed marker set. No colour, font or shape configuration.

## 7. Requirements summary

- **FR-01** Organizer creates one map per event with grid units, optional underlay from Files, and the fixed object palette (§3.3); the builder snaps to grid, shows alignment guides, duplicates rows / columns and auto-numbers.
- **FR-02** Booths bind to an `ApplicationTier`; publishing sets that tier's `quantityTotal` to its booth count; the tier editor shows it read-only.
- **FR-03** Publishing exposes `GET /public/events/:id/map` and `/events/:slug/map`; a DRAFT map is 404 publicly. Public reads are never served from a cache that a booth write has not invalidated.
- **FR-04** Organizer can assign / move / unassign an APPROVED application, reserve and block booths; every write updates `Application.boothLabel`.
- **FR-05** For map-bound tiers, approval reserves capacity and invites the vendor to choose; `POST …/booth` holds one booth for `BOOTH_HOLD_MS` under a row lock; exactly one of N concurrent holds wins (409 `BOOTH_TAKEN` for the rest).
- **FR-06** A booth becomes `SOLD` only on a Stripe success event; failure or expiry releases it; withdraw, reject, full refund and tier change release it; deleting a `SOLD` / `HELD` booth is refused.
- **FR-07** Vendor sees the all-in price on the booth before Buy (spec 011 fee-mode rule); the receipt names the booth and links the map with `?booth=`.
- **FR-08** Public map: legend, six tier swatches, fixed state styles, touch and keyboard access, `?booth=` highlight, opted-in vendor profile and key list (phase 3).
- **FR-09** Vector PDF export renders the same SVG (phase 3).
- **FR-10** Event duplicate copies the map as DRAFT with all booths available; templates (phase 3) reuse the same materialiser.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Approval no longer charging surprises organizers used to spec 011 | Only map-bound tiers change; the form editor states it when a map is bound; submissions table filter "booth not chosen" + digest count |
| Hold abuse (a vendor holding booths repeatedly) | One active hold per application; `APPLICATION_SUBMIT`-class limiter on the choose endpoint; holds expire in 15 min |
| Webhook delay leaves a booth `HELD` past the countdown | Sweep never releases a `HELD` booth whose application is `PROCESSING`; it waits for the Stripe event (same rule as the order sweep grace) |
| Builder scope creep toward a general drawing tool | The palette in §3.3 is the contract; requests for colours or shapes are answered with the PDF export |
| Large maps slow in SVG | Budget: 1,000 booths + 500 markers at 60 fps pan on a mid-range phone; Konva fallback documented in §3.2 |

## 9. Follow-ups

- Wiki page `docs/wiki/features/maps.md` and `backend/AGENTS.md` gotcha (booth locking, boothLabel sync, no-cache) after phase 1; `CLAUDE.md` env rows for `BOOTH_HOLD_MS` / `BOOTH_SWEEP_INTERVAL_MS` after phase 2.
- Spec 013 messaging: "send vendors their booth" segment send once messaging exists (MAP-04 is a link until then).
- Spec 015 / 026 pages: embed the map in a page (`ContentHtml` block or menu target) — phase 3 adds the menu target only.

## Sources

- Seats.io pricing — https://www.seats.io/pricing (per used seat; Silver €450/yr / 2,500 seats; booths and tables count as seats)
- Seats.io embedded designer — https://docs.seats.io/docs/embedded-designer/introduction/
- ExpoFP — https://expofp.com/ and the 2026 market guide https://blog.expofp.com/the-11-best-event-floor-plan-software-tools-in-2026-full-market-guide/
- Map D — https://mapdevents.com/
- Konva seat-map and floor-plan sandboxes — https://konvajs.org/docs/sandbox/Seats_Reservation.html, https://konvajs.org/docs/sandbox/Interactive_Building_Map.html
- npm versions checked 2026-09-20: `konva` 10.6.0, `react-konva` 19.3.0, `react-zoom-pan-pinch` 4.2.0, `@dnd-kit/core` 6.3.1 (installed)
