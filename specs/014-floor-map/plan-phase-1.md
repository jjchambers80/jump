# Implementation Plan: Maps phase 1 — builder, booth inventory, manual assignment, public map (spec 014)

**Status**: Planned 2026-09-20. Not merged.
**Spec**: [spec.md](./spec.md) §3.3 (visual language), §4.1 (data model), §4.3 (public map), §4.4 (navigation), §5 phase 1, §6 decisions.
**Kanban**: JUMP-014A `t_462985aa`, decomposed by the daemon into `t_f0dd7dce` (data contracts, running 2026-09-20 22:43), `t_4b4f4a4a` (builder + inventory), `t_b643dca6` (manual assignment), `t_1f263e6f` (public map), `t_598d11cb` (verify). Phase 2 / 3 children were blocked 2026-09-20 until this phase merges (they had been dispatched out of order).
**Dependencies**: nothing new in `packages/db`; `react-zoom-pan-pinch@4.2` in `frontend`. No new backend package.
**Deliverable**: one PR on `feat/014-maps-phase-1` from an isolated worktree (never the main checkout — see §9). Migration is additive.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Admin org scope | `backend/src/api/routes/adminScope.js` `activeOrgFor(req)` | Every `/admin/maps*` handler resolves the org this way (Gotcha 19) |
| Whole-tree save | `backend/src/api/routes/menus.js` `PUT /:menuId` + `validateReplaceMenu` + `MenuService` | The builder saves geometry with one `PUT /admin/maps/:id/layout`; same validator shape (typed whitelist, size caps) |
| Content-style router registration | `backend/src/api/server.js` L150–152 (`/admin/menus`, `/admin/redirects`) | `app.use('/admin/maps', mapsRouter)`; public route on `eventsRouter` (`publicRouter`) |
| Storefront gate | `backend/src/middleware/storefrontGate.js` `gateByEventParam` | `GET /events/:eventId/map` (private store mode, hidden events) |
| Tier capacity locking | `ApplicationService._takeCapacity` / `_releaseCapacity`, `ApplicationTier.quantity*` | Untouched in phase 1. Publish only writes `quantityTotal` for `mapBound` tiers |
| Tier editor | `frontend/src/components/applications/FormEditorCards.tsx` (`EditorTier`, draft/edit state L243–245) | `quantityTotal` becomes read-only with a "from map" hint when `mapBound` |
| Application detail meta | `ApplicationService.updateMeta` (`boothLabel`, tags, check-in) | `boothLabel` stays; `BoothService` writes it on assign / move / unassign. The free-text field on the detail page becomes read-only once the application holds a booth |
| Submissions table | `frontend/src/components/applications/SubmissionsTable.tsx` (Gotcha 18) | Already shows `boothLabel`; no change in phase 1 |
| Files | `StoreFileService` (`GET /admin/files`, `syncReferences`), `frontend/src/app/admin/content/files` picker components | Underlay picker; `syncReferences(orgId, 'FloorMap', map.id, [underlayFileId])` on save so *Used in* is right (Gotcha 19) |
| Event duplicate | `EventService.duplicateEvent` (transaction, `applicationTierIdMap` from `copyForms`) | `MapService.copyForEvent(tx, fromEventId, toEventId, { applicationTierIdMap })` after add-ons copy |
| Event admin tabs | `frontend/src/app/admin/events/[eventId]/applications/ApplicationsHeader.tsx` (`tab` / `activeTab` idiom) | Event page gets a **Map** link into the builder |
| Sidebar | `frontend/src/components/AdminSidebar.tsx` `navItems` | `{ label: 'Maps', href: '/admin/maps', icon: Map }` after Participants |
| Public event page | `frontend/src/app/events/[eventId]/EventDetailClient.tsx` (`GetInvolved` at L592) | **Floor map** section below Get involved when published |
| Tenant routing | `backend/src/utils/redirectPath.js` `RESERVED` (`/^\/events(\/|$)/` already covers `/events/:slug/map`), `frontend/src/lib/storefrontHost.ts` `tenantResourceFor` (L116 regex matches only `/events/:id`, not sub-paths) | Extend `tenantResourceFor` to match `/events/:id/map` so a custom domain cannot render another org's map (Gotcha 22) |
| Brand + theme | `BrandScope`, `themeMode` (Gotchas 6–7) | Public map uses `brand` CSS vars for the selected state only; tier swatches and state greys are fixed tokens defined once in `frontend/src/lib/mapTheme.ts` |
| Admin date/time | `useAccountFormat()` | Maps list "Published …" |
| Tests | `backend/tests/contract/menus.test.js`, `applications.test.js`; `frontend/e2e/admin-menus.spec.ts`, `helpers/session.ts` | Templates for `maps.test.js`, `admin-maps.spec.ts` |

Already on disk from the running data-contracts worker (`t_f0dd7dce`): `packages/db/prisma/migrations/20261003100000_floor_map_booth_schema/migration.sql` matching spec §4.1 exactly (`FloorMap`, `Booth`, `FloorMapStatus`, `BoothKind`, `BoothStatus`, `ApplicationTier.mapBound`). This plan takes that migration as given; the Prisma models in §2 are the same shape.

Stray phase 3 files on the main checkout (not part of this PR; do not include): `backend/src/services/FloorMapTemplateService.js`, `backend/src/config/maps.js`, `backend/tests/unit/floorMapTemplates.test.js`, `VendorDirectoryService.js`, `routes/vendors.js`, `frontend/src/app/events/[eventId]/vendors/`, migration `20261002100000_public_vendor_directory`. Phase 1 defines its own `config/maps.js` constants (§3); if the phase 3 file is kept, merge the two — one constants module.

## 2. Data model

`packages/db/prisma/schema.prisma` — add relations on `Organization` (`floorMaps FloorMap[]`), `Event` (`floorMap FloorMap?`), `StoreFile` (`floorMapUnderlays FloorMap[]`), `ApplicationTier` (`mapBound`, `booths Booth[]`), `Application` (`booth Booth?`).

```prisma
enum FloorMapStatus { DRAFT PUBLISHED }
enum BoothKind { BOOTH TABLE }
enum BoothStatus { AVAILABLE HELD SOLD RESERVED BLOCKED }   // HELD unused until phase 2

model FloorMap {
  id              String         @id @default(cuid())
  organizationId  String
  eventId         String         @unique
  name            String
  status          FloorMapStatus @default(DRAFT)
  unit            String         @default("ft")
  gridSize        Int            @default(10)
  width           Int
  height          Int
  underlayFileId  String?
  underlayOpacity Int            @default(40)
  layout          Json           @default("{\"version\":1,\"elements\":[]}")
  publishedAt     DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  event        Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)
  underlay     StoreFile?   @relation(fields: [underlayFileId], references: [id], onDelete: SetNull)
  booths       Booth[]
  @@index([organizationId])
}

model Booth {
  id                String      @id @default(cuid())
  mapId             String
  label             String
  kind              BoothKind   @default(BOOTH)
  x Int
  y Int
  w Int
  h Int
  rotation          Int         @default(0)
  tierId            String?
  status            BoothStatus @default(AVAILABLE)
  applicationId     String?     @unique
  holdApplicationId String?
  holdExpiresAt     DateTime?
  assignedById      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  map         FloorMap         @relation(fields: [mapId], references: [id], onDelete: Cascade)
  tier        ApplicationTier? @relation(fields: [tierId], references: [id], onDelete: SetNull)
  application Application?     @relation(fields: [applicationId], references: [id], onDelete: SetNull)
  @@unique([mapId, label])
  @@index([mapId, status])
  @@index([tierId])
}
```

`layout.elements[]` (validated, never trusted): `{ id, kind: 'stage'|'entrance'|'restroom'|'food'|'info'|'firstAid'|'programming'|'label'|'wall', x, y, w, h, caption?, text?, size?: 'S'|'M'|'L', orientation?: 'h'|'v' }`. `id` is a client cuid kept stable across saves so undo / selection survive a refetch.

Dev DB: `npm run db:migrate` (the migration file exists); prod: Railway runs migrations on deploy — verify with `railway deployment list` (memory: CVE gate).

## 3. Backend

### 3.1 `backend/src/config/maps.js`

`MAX_MAP_WIDTH/HEIGHT = 200`, `MAX_BOOTHS = 1000`, `MAX_ELEMENTS = 500`, `MIN/MAX_BOOTH_SIZE = 1 / 50`, `ELEMENT_KINDS`, `BOOTH_KINDS`, `ROTATIONS = [0, 90]`, `LABEL_SIZES`, `UNITS = ['ft','m']`, `LABEL_MAX = 12`, `CAPTION_MAX = 40`, `SWATCH_COUNT = 6`.

### 3.2 Validators — `backend/src/api/validators/mapValidators.js`

- `validateCreateMap`: `{ eventId, name?, width?, height?, unit? }` — event must belong to the org (checked in service), 409 `MAP_EXISTS` if the event already has one.
- `validateUpdateMap` (partial whitelist, `validateUpdateBusinessDetails` style): `name`, `width`, `height`, `unit`, `gridSize`, `underlayFileId | null`, `underlayOpacity 0–100`.
- `validateReplaceLayout`: `{ elements: [...], booths: [{ id?, label, kind, x, y, w, h, rotation, tierId|null }] }` — bounds inside the map, sizes within limits, labels unique and ≤ `LABEL_MAX`, counts within caps, no two booths overlapping (AABB check; rotation swaps w/h), element kinds from the set, unknown keys rejected. Returns 400 with the offending index.
- `validateAssign`: `{ applicationId }`; `validateMove`: `{ toBoothId }`; `validateSetStatus`: `{ status: 'AVAILABLE'|'RESERVED'|'BLOCKED' }`.

### 3.3 `MapService` — `backend/src/services/MapService.js`

| Method | Behaviour |
|---|---|
| `list(orgId)` | Maps with `event { id, name, slug, date }`, `status`, counts `{ total, sold, reserved, blocked }` via `groupBy` |
| `create(orgId, { eventId, … })` | Event must be the org's (`Event → Venue → Organization`); defaults `name = event.name`, 50×40 |
| `get(orgId, mapId)` | Map + booths (ordered by label, natural sort) + tiers of the event's PAID forms (`{ id, name, price, formName, mapBound, quantityTotal }`) + booth holders (`application { id, profile.businessName, status, paymentStatus }`) |
| `update(orgId, mapId, fields)` | Partial; underlay must be an image `StoreFile` of the org; calls `storeFileService.syncReferences` |
| `replaceLayout(orgId, mapId, { elements, booths })` | One transaction: upsert booths by `id` (new ones get ids), delete booths absent from the payload **unless** `SOLD` / `HELD` / `RESERVED` → 409 `BOOTH_IN_USE` naming the labels; a label change on a held booth writes `Application.boothLabel`; `tierId` must be a tier of this event's PAID forms; write `layout`. Returns the full `get()` payload |
| `publish(orgId, mapId)` | Requires ≥ 1 booth; sets `PUBLISHED`, `publishedAt`; for each distinct `tierId` sets `ApplicationTier.mapBound = true` and `quantityTotal = count(booths with tierId)` (409 `TIER_OVERSOLD` if `quantityApproved + quantityReserved > count`); tiers previously bound but now without booths get `mapBound = false` (quantity left as is) |
| `unpublish(orgId, mapId)` | `DRAFT`; leaves `mapBound` and quantities untouched (a published-then-hidden map must not reopen capacity) |
| `remove(orgId, mapId)` | 409 if any booth is `SOLD` / `HELD`; else delete (cascade) and unbind tiers |
| `publicMap(eventId)` | Only when `PUBLISHED`: `{ id, name, width, height, unit, underlay { url, opacity }, elements, legend: [{ tierId, name, price (all-in via FeeService for the form's fee mode), swatch }], booths: [{ id, label, kind, x, y, w, h, rotation, tierId, status, vendorName? }] }`. `vendorName` = `profile.businessName` for `SOLD` / `RESERVED` (phase 3 adds opt-in profiles; phase 1 shows the name only — the interview asked for it and applications already agreed to be listed as a vendor). Response headers `Cache-Control: no-store`, `ETag` = `sha1(map.updatedAt + max(booth.updatedAt))`, 304 on `If-None-Match` |
| `copyForEvent(tx, fromEventId, toEventId, { applicationTierIdMap })` | Called by `EventService.duplicateEvent`: copies the map as `DRAFT`, every booth `AVAILABLE` with no holder, `tierId` remapped (unmapped → null), same underlay file |

Swatches: `legend[i].swatch = i % 6` in tier `displayOrder` across forms — the client maps index → colour; the API never sends a hex.

### 3.4 `BoothService` — `backend/src/services/BoothService.js`

Every mutation is one transaction that starts with `SELECT … FROM "Booth" WHERE id = $1 FOR UPDATE` (and for `move`, both rows ordered by id to avoid deadlock).

| Method | Rule |
|---|---|
| `assign(orgId, mapId, boothId, applicationId, byUserId)` | Booth `AVAILABLE` or `RESERVED`; application belongs to the event, is `APPROVED`, holds no other booth (409 `APPLICATION_HAS_BOOTH`), and its `tierId` matches `booth.tierId` when the booth has one (409 `TIER_MISMATCH`, overridable with `force: true` by ADMIN — a comp on a bigger booth). Sets `SOLD`, `applicationId`, `assignedById`; writes `Application.boothLabel = label`. No money movement, no capacity change (the tier slot was taken at approval) |
| `unassign(orgId, mapId, boothId)` | `SOLD` / `RESERVED` with a holder → `AVAILABLE`, clears holder, `boothLabel = null` |
| `move(orgId, mapId, fromBoothId, toBoothId)` | From must have a holder; to must be `AVAILABLE` / `RESERVED` (empty) or hold another application (swap). Both `boothLabel`s rewritten |
| `setStatus(orgId, mapId, boothId, status)` | `AVAILABLE ↔ RESERVED ↔ BLOCKED` on booths without a holder; 409 otherwise |
| `assignableApplications(orgId, mapId, boothId, q)` | `APPROVED` applications on the event's PAID forms without a booth, filtered by tier match first, search on business name / contact |

Phase 2 adds `hold` / `release` / `sold` here; phase 1 leaves `HELD` unreachable.

### 3.5 Routes

`backend/src/api/routes/maps.js`, mounted `app.use('/admin/maps', mapsRouter)` after `requireAuth` + `requireRole('ORGANIZER')` like `menusRouter`; every handler `const orgId = await activeOrgFor(req)`.

```
GET    /admin/maps                         list
POST   /admin/maps                         create            (validateCreateMap)
GET    /admin/maps/:mapId                  get
PATCH  /admin/maps/:mapId                  update            (validateUpdateMap)
PUT    /admin/maps/:mapId/layout           replaceLayout     (validateReplaceLayout)
POST   /admin/maps/:mapId/publish          publish
POST   /admin/maps/:mapId/unpublish        unpublish
DELETE /admin/maps/:mapId                  remove             (ADMIN)
GET    /admin/maps/:mapId/booths/:boothId/assignable?q=
POST   /admin/maps/:mapId/booths/:boothId/assign     (validateAssign)
POST   /admin/maps/:mapId/booths/:boothId/unassign
POST   /admin/maps/:mapId/booths/:boothId/move       (validateMove)
POST   /admin/maps/:mapId/booths/:boothId/status     (validateSetStatus)
GET    /admin/events/:eventId/map          → { mapId } | 404   (event Map tab deep link)
GET    /events/:eventId/map                public, gateByEventParam, no-store + ETag
```

`GET /admin/applications/:id` (existing detail) adds `booth: { id, label, mapId } | null` so the detail page can link to the builder.

### 3.6 Event duplicate

`EventService.duplicateEvent`: after `addOnService.copyForEvent(...)` add `await mapService.copyForEvent(tx, source.id, created.id, { applicationTierIdMap })`. The response gains `copiedMap: boolean`.

## 4. Frontend

### 4.1 Types and API — `frontend/src/services/api.ts`

`AdminMap`, `AdminMapDetail`, `MapBooth`, `MapElement`, `MapTierLegend`, `PublicMap`; functions `listMaps`, `createMap`, `getMap`, `updateMap`, `replaceMapLayout`, `publishMap`, `unpublishMap`, `deleteMap`, `assignableApplications`, `assignBooth`, `unassignBooth`, `moveBooth`, `setBoothStatus`, `getEventMapId`, `getPublicEventMap(eventId, { etag })`.

### 4.2 Shared map rendering — `frontend/src/components/maps/`

| File | Role |
|---|---|
| `mapTheme.ts` | Fixed tokens: 6 tier swatches (light + dark values), state styles (available / selected / sold / reserved / blocked / held), marker icon map (lucide: `Mic2`, `DoorOpen`, `Bath`, `Utensils`, `Info`, `Cross`, `Gamepad2`), text sizes. **No other file defines a map colour** |
| `MapCanvas.tsx` | `'use client'`. `react-zoom-pan-pinch` `TransformWrapper` around one `<svg viewBox="0 0 width*gridSize height*gridSize">`; renders underlay `<image>`, grid (editor only), `<MapElement>` and `<Booth>` children; props `interactive`, `selectedIds`, `onSelect`, `onPointer*` for the editor; fit-to-screen on mount and on resize; `prefers-reduced-motion` respected (no animated zoom) |
| `Booth.tsx` | `<g role="button" tabIndex={0} aria-label="Booth A12, 10 by 10, $275, available">` rounded rect + label (+ vendor short name when sold); keyboard Enter / Space → `onSelect` |
| `MapElement.tsx` | Marker blocks, text labels, wall lines |
| `MapLegend.tsx` | Tier swatches + price, state key; used by builder (right panel) and public map |
| `boothLabels.ts` | Natural sort, auto-number generator (`prefix`, `start`, `direction: 'row' | 'column'`, `snake`), row-tool geometry |
| `layoutOps.ts` | Pure functions: snap, AABB overlap, duplicate row / column, rotate, nudge; unit-tested with Vitest (`frontend/tests/unit/layoutOps.test.ts`, run through the existing `npm run test:unit` config) |

### 4.3 Builder — `frontend/src/app/admin/maps/[mapId]/page.tsx` (+ `MapEditor.tsx`, `EditorToolbar.tsx`, `EditorSidebar.tsx`, `BoothPanel.tsx`, `AssignDialog.tsx`, `useMapEditor.ts`)

- Layout: toolbar (Select, Booth, Table, Row, marker menu, Label, Wall · Undo / Redo · Auto-number · Duplicate · zoom · Save state · Publish), canvas centre, right panel (map settings / selection properties / legend). Full-width admin page (no max-width container); works to 1024 px; below that the builder shows a "use a larger screen" notice (the public map is mobile-first, the builder is not).
- `useMapEditor` holds `{ elements, booths }` with an undo stack (immutable snapshots, cap 100), dirty flag, autosave 2 s after the last change (`PUT …/layout`), manual **Save** button, `beforeunload` guard. Server 409 `BOOTH_IN_USE` re-inserts the booths and shows which labels are in use.
- Tools: click-drag a Booth / Table with grid snap (default size = the selected tier's preset if it parses `10x10` from the tier name, else 10×10); **Row tool** drags a run and fills it with N booths + gap; marquee select; drag move (snap + alignment guides to neighbouring edges/centres, magenta-free: guides use the admin indigo); resize handles; `R` rotates; arrow keys nudge; `⌘/Ctrl+D` duplicates; `Delete` removes (blocked for in-use booths with a toast).
- Selection properties: label, tier select (tiers of the event's PAID forms, grouped by form), kind, size, rotation; multi-select shows tier + auto-number.
- **Auto-number** dialog: prefix, start, direction, snake; previews on canvas before apply.
- Map settings: name, size, unit, grid, underlay (Files picker — reuse the picker from Blog featured image, image types only), opacity.
- **Booth panel** (selected booth, published or draft): status pill, holder (business name → application detail link), **Assign** (dialog: search `assignable`, tier-match rows first, "Force" checkbox for ADMIN), **Unassign**, **Move to…** (pick another booth on canvas — click mode), **Reserve** / **Block** / **Make available**.
- Publish: confirm dialog listing tiers that will become map-bound with their derived quantities; shows `TIER_OVERSOLD` in place. After publish a "View public map" link.

### 4.4 Maps list — `frontend/src/app/admin/maps/page.tsx`

Table: event (link to builder), status pill, booths (sold / total), published date (`useAccountFormat`), actions (Open, View public, Delete for ADMIN). **Create map** dialog: event picker (events of the active org without a map) → `POST /admin/maps` → builder. Empty state explains the flow (create map → add booths → bind tiers → publish).

### 4.5 Navigation

- `AdminSidebar.tsx`: `{ label: 'Maps', href: '/admin/maps', icon: Map }` after Participants. `admin-sidebar-sections.spec.ts` updated.
- Event edit page (`/admin/events/[eventId]/edit`) header actions: **Map** button → `getEventMapId` → builder, or "Create map" when none. `ApplicationsHeader` tabs stay as they are (Applications / Forms); the map is not a submissions view.
- Application detail page: **Booth** row with the label linking to `/admin/maps/:mapId?booth=:id` (the builder selects it on load); the free-text `boothLabel` input is read-only with "Managed by the map" when `booth` is set.

### 4.6 Public map

- Route `frontend/src/app/events/[eventId]/map/page.tsx` (server component fetches the event like `events/[eventId]/page.tsx`, then `PublicMapClient`): `BrandScope` with the org's `themeMode`, `OrganizationHeader` + `StorefrontFooter` (Gotcha 21 allows event pages), title "Floor map", `MapCanvas interactive` + `MapLegend`, tap / click → bottom sheet on `< md`, popover on desktop: label, size, tier + all-in price, vendor name when sold, "Not for sale" for blocked. `?booth=A12` → fit-to-booth + 3 pulses (none under reduced motion). 404 when the map is not published.
- `EventDetailClient.tsx`: below `GetInvolved`, a **Floor map** section (`getPublicEventMap` on mount; renders nothing on 404) with a compact non-interactive preview and "Open map" link.
- `storefrontHost.ts` `tenantResourceFor`: regex `^\/(events|checkout|orders|venues)\/([^/]+)(?:\/map)?\/?$` so custom domains check ownership of `/events/:id/map`. Redirect reserved list already covers `/events/*`.
- Polling: the public client refetches every 30 s with `If-None-Match` while visible (`document.visibilityState`) — cheap 304s, no cache.

## 5. Tests

Backend (`cd backend && npm test`):

- `tests/unit/mapValidators.test.js` — bounds, overlap (rotated), label uniqueness, caps, unknown keys, element kinds.
- `tests/unit/mapService.test.js` — publish derives `quantityTotal`, `TIER_OVERSOLD`, unpublish leaves quantities, `copyForEvent` remaps tiers and clears holders.
- `tests/unit/boothService.test.js` — assign rules (`APPROVED` only, `TIER_MISMATCH`, `force`), move swap rewrites both `boothLabel`s, status transitions, **two concurrent `assign` on one booth → exactly one succeeds** (two transactions with `FOR UPDATE`, as in the tier capacity tests).
- `tests/contract/maps.test.js` — CRUD + org scoping (member of org A gets 404 on org B's map, SYSTEM_ADMIN via `X-Jump-Org`), `PUT layout` round-trip, 409 `BOOTH_IN_USE`, publish / unpublish, public route 404 on DRAFT, `no-store` + `ETag` + 304, private store mode gate, event duplicate copies the map.

Frontend:

- `tests/unit/layoutOps.test.ts`, `tests/unit/boothLabels.test.ts` (Vitest).
- `e2e/admin-maps.spec.ts` (`signInAsStaff`, mocked API like `admin-menus.spec.ts`): create map, draw a row of 5, auto-number `A1…A5`, assign a tier, publish, assign an application from the booth panel, sidebar item + event Map button.
- `e2e/public-map.spec.ts`: published map renders legend + booths, sold booth shows vendor, `?booth=` focuses, unpublished → 404. Run with `PLAYWRIGHT_PORT` free (Gotcha 11).

## 6. Documentation and hand-off

- `docs/wiki/features/maps.md` via `/doc-feature`; `docs/wiki/README.md` index.
- `backend/AGENTS.md` gotcha: booths are row-locked; `Application.boothLabel` is written only by `BoothService`; public map reads are `no-store` — a cache must be invalidated by `BoothService` / `MapService` writes; `mapBound` tiers derive `quantityTotal` on publish.
- `CLAUDE.md` Gotchas: add a line under 18 (Participants) or a new 27 summarising the above; no new env vars in phase 1.
- `specs/STATUS.md` + `docs/roadmap.md` rows; spec §5 phase 1 marked built with the PR number.
- Hand-off to phase 2 (`t_147a5300`): `BoothService.hold / release / markSold`, `HELD` rendering already in `mapTheme.ts`, approval branch for `mapBound` tiers.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Publish changes tier quantities under organizers' feet | Confirm dialog lists every tier and its new quantity; `TIER_OVERSOLD` refuses rather than shrinking below approved + reserved |
| Concurrent builder sessions overwrite each other | `PUT layout` carries `updatedAt` seen by the client; 409 `STALE_LAYOUT` when it differs — the client refetches and replays the local undo stack |
| SVG performance on large maps | Booths render as plain `<rect>` + `<text>` with no filters; guides / hover use a single overlay layer; budget 1,000 booths at 60 fps pan tested manually on an iPhone-class device |
| `boothLabel` drift between free text and map | Only `BoothService` writes it once a booth is held; the input is read-only in that case |
| Worker collisions (see §9) | This phase ships from one worktree, one PR |

## 8. Build order (one PR, commits in this sequence)

1. Schema relations + `config/maps.js` + validators + `MapService` / `BoothService` + routes + contract tests.
2. `api.ts` types + `components/maps/*` + unit tests.
3. Builder page + Maps list + sidebar + event button + application detail booth row.
4. Public route + event-page section + `storefrontHost` regex + e2e.
5. Event duplicate hook + docs.

## 9. Process note (2026-09-20)

The daemon dispatched the phase 1, 2 and 3 children at once and the workers wrote into `/Users/jj/Projects/jump` directly instead of an isolated worktree (`docs/development/kanban-workflow.md` requires one). Phase 2 / 3 cards are blocked with `needs_input` until this phase merges. Whoever picks up `t_4b4f4a4a` / `t_b643dca6` / `t_1f263e6f` must: create `feat/014-maps-phase-1` in a worktree, include the `20261003100000_floor_map_booth_schema` migration, exclude the stray phase 3 / spec 032 files listed in §1, and run `cd backend && npm test` before `request-review`.
