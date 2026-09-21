# Floor Map, Booth, and Assignment Data Contracts (spec 014 phase 1)

## Schema (`packages/db/prisma/schema.prisma`)

### New models

| Model | Purpose | Key constraints |
|-------|---------|-----------------|
| `FloorMap` | One per event (`eventId @unique`). Grid-plane geometry plus layout JSON for non-booth elements (walls, markers, labels). | `onDelete: Cascade` to Event; `organizationId` index |
| `Booth` | Individual booth/table row locked `FOR UPDATE` on write. Tracks state (AVAILABLE/HELD/SOLD/RESERVED/BLOCKED), tier binding, and holder. | `@@unique([mapId, label])`; `applicationId @unique`; indexes on `(mapId, status)` and `tierId` |

### New enums

`FloorMapStatus` (DRAFT, PUBLISHED), `BoothKind` (BOOTH, TABLE), `BoothStatus` (AVAILABLE, HELD, SOLD, RESERVED, BLOCKED)

### Modified models

- `Event` → `floorMap FloorMap?` (one-to-one)
- `ApplicationTier` → `mapBound Boolean @default(false)` (derived quantityTotal on publish)
- `ApplicationTier` → `booths Booth[]` (relation)
- `Organization` → relation was already present (`floorMapTemplates FloorMapTemplate[]`)
- `StoreFile` → `FloorMap[]` underlay relation (already in schema)

### Migration: `20261003100000_floor_map_booth_schema/migration.sql`
Additive SQL migration creating enums, tables, foreign keys, and the `ApplicationTier.mapBound` column.

## Services

### `MapService` (`backend/src/services/MapService.js`)
- `list(orgId)` — maps with event summaries + booth counts (total/sold/reserved/blocked)
- `create(orgId, data)` — validates org ownership, 409 on duplicate, defaults 50×40
- `get(orgId, mapId)` — map + booths + PAID-form tiers + holder business names
- `update(orgId, mapId, fields)` — partial patch of map metadata
- `remove(orgId, mapId)` — 409 if any SOLD/HELD booth exists
- `replaceLayout(orgId, mapId, { elements, booths })` — whole-tree save (like Menus): upserts booths by label, deletes absent ones unless SOLD/HELD/RESERVED (409 BOOTH_IN_USE)
- `publish(orgId, mapId)` — `TIER_OVERSOLD` check, syncs mapBound tier quantities, sets PUBLISHED
- `unpublish(orgId, mapId)` — reverts to DRAFT, leaves quantities
- `publicMap(eventId)` — published map only, no-cache + ETag, returns booth tiers + vendor names
- `copyForEvent(tx, fromEventId, toEventId, { applicationTierIdMap })` — event duplicate, DRAFT all AVAILABLE

### `BoothService` (`backend/src/services/BoothService.js`)
Every mutation uses `SELECT … FOR UPDATE` on affected booth rows.
- `assign(orgId, mapId, boothId, applicationId, byUserId, { force })` — APPROVED only, tier match check (`TIER_MISMATCH` overridable with force)
- `unassign(orgId, mapId, boothId)` — SOLD → AVAILABLE, clears `boothLabel`
- `move(orgId, mapId, fromBoothId, toBoothId)` — locks both rows sorted by id (deadlock-safe), swaps holder
- `setStatus(orgId, mapId, boothId, status)` — AVAILABLE/RESERVED/BLOCKED transitions only
- `assignableApplications(orgId, mapId, boothId, q)` — tier-match-first search

### `EventService` — duplicate hook
`copyForEvent` called in duplicateEvent transaction after add-on copy. Response includes `copiedMap: boolean`.

## Routes

| Method | Path | Handler |
|--------|------|---------|
| GET | `/admin/maps` | list |
| POST | `/admin/maps` | create (validateCreateMap) |
| GET | `/admin/maps/:mapId` | get |
| PATCH | `/admin/maps/:mapId` | update (validateUpdateMap) |
| DELETE | `/admin/maps/:mapId` | remove |
| PUT | `/admin/maps/:mapId/layout` | replaceLayout |
| POST | `/admin/maps/:mapId/publish` | publish |
| POST | `/admin/maps/:mapId/unpublish` | unpublish |
| GET | `/admin/maps/:mapId/booths/:boothId/assignable?q=` | assignableApplications |
| POST | `/admin/maps/:mapId/booths/:boothId/assign` | assign |
| POST | `/admin/maps/:mapId/booths/:boothId/unassign` | unassign |
| POST | `/admin/maps/:mapId/booths/:boothId/move` | move |
| POST | `/admin/maps/:mapId/booths/:boothId/status` | setStatus |
| GET | `/public/events/:eventId/map` | publicMap (no-store, ETag) |

All admin routes are mounted at `/admin/maps` behind `requireAuth` + `requireOrganizer`, using `activeOrgFor(req)` for org scoping.

## Tests

**17 unit tests passing** (0 failing):
- `mapService.test.js` — create validation (eventId/org/duplicate), publish tier sync, copyForEvent null, remove sold-booth refusal
- `boothService.test.js` — assign rules (org/booth-status/tier/approved), unassign status requirement, setStatus boundaries (invalid value, SOLD refusal), move source-status requirement

## Deliverables
- 12 new files (services, routes, validators, config, migration, tests)
- 3 modified files (schema.prisma, EventService.js, server.js)
- Branch: `maps/t_f0dd7dce` (worktree at workspace dir)