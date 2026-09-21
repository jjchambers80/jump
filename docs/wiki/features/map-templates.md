# Reusable Map Templates — spec 014 phase 3

Organization-scoped, event-independent map geometry snapshots. Templates contain vector layout data only — no booth state, tier ids, assignments, or vendor data. They seed new FloorMaps at creation time and serve as the canonical input for vector PDF export.

**Why templates exist independently of live maps**: a template is a JSON snapshot that can be created, validated, and browsed without database rows for every booth. A map created from a template materialises its booths as `Booth` rows inside a single transaction (`FloorMapTemplateService.materialise` → `MapService.create`), so the live inventory engine (`BoothService`, `FOR UPDATE` on purchase) never touches template JSON.

## Schema

```
FloorMapTemplate
├── id, organizationId, name, definition (Json), sourceMapId
├── createdById, createdAt, updatedAt
└── unique [organizationId, name]
```

`FloorMap` gained a nullable `createdFromTemplateId` field (informational only).

## Service

`backend/src/services/FloorMapTemplateService.js`

### Methods

| Method | Description |
|---|---|
| `list(organizationId)` | With org id → templates for that org; null → all orgs |
| `get(templateId, organizationId)` | Single template, 404 outside scope |
| `create(organizationId, { name, definition })` | Validates and persists |
| `update(templateId, orgId, { name?, definition? })` | Partial update |
| `remove(templateId, orgId)` | Hard delete |
| `saveFrom(mapPayload, orgId, { name, replaceTemplateId? })` | Snapshot any map payload into a template |
| `materialise(definition, { name?, tierBindings? })` | Deterministic output map with booth tiers resolved |
| `serialize(definition, options)` | Stable JSON for tests/export |
| `snapshotDefinition(mapPayload)` | Strip live IDs, state, assignments from a map into template form |
| `validateDefinition(definition)` | Normalise and validate; throws on any violation |
| `requireInScope(templateId, orgId)` | NotFoundError if missing or outside org |

### Definition schema

```js
{
  version: 1,
  width: <1–200>,
  height: <1–200>,
  unit: 'ft' | 'm',
  gridSize: <1–100>,
  orientation: 'AUTO' | 'LANDSCAPE' | 'PORTRAIT',
  elements: [{ id, kind, x, y, w, h, caption?, text?, size?, orientation? }],
  zones: [{ id, label, x, y, w, h }],
  booths: [{ label, kind, x, y, w, h, rotation, tierLabel }],
  legend: { title?, orientation?, tiers: [{ tierLabel, label, swatch }] } | null,
  metadata: { eventTitle?, subtitle?, brandColor?, themeMode? } | null,
}
```

Booth `tierLabel` is a non-database string referencing a tier by its readable name. At materialisation, `tierBindings` maps these to real ApplicationTier ids.

Definition validation rejects:
- Unknown top-level fields (event-tier ids, status, assignments)
- Booth labels referencing a tier that does not exist in the destination event
- Element/zone ids with non-alphanumeric characters
- Swatch indexes outside 0-5
- Vendor/payment-related metadata fields

### Snapshot → definition stripping

`snapshotDefinition` discards: `booth.id`, `booth.status`, `booth.applicationId`, `booth.holder`, `applicationId`, `vendorName`, `SOLD`/`HELD`/`RESERVED` booleans, tier DB ids (replaced with tier name). Booth `tierLabel` is resolved from the tier name when a `tierId` is present.

### Materialisation output

Maps `booths.tierLabel` → `booth.tierId` via the `tierBindings` map. Booth rows are created without `tierLabel`; the label is used only for the snapshot and for tier-to-id resolution. The output is symmetric so that `materialise(validateDefinition(snapshotDefinition(map)))` round-trips.

Output shape:

```js
{
  schemaVersion: 1,
  name?, width, height, unit, gridSize, orientation,
  layout: { version, elements, zones },
  booths: [{ label, kind, x, y, w, h, rotation, tierLabel?, tierId? }],
  legend, metadata,
}
```

Every booth has `status: 'AVAILABLE'` implicitly — templates do not persist state.

## Routes

```
/admin/maps/templates                           GET    → list
/admin/maps/templates                           POST   → create
/admin/maps/templates/:templateId               GET    → get
/admin/maps/templates/:templateId               PUT    → update
/admin/maps/templates/:templateId               DELETE → delete (204)
/admin/maps/:mapId/templates                    POST   → saveFrom (snapshot a live map)
```

All routes behind `requireAuth + requireOrganizer`. Save-from-map validates that the caller's org owns the source map.

## Create from template flow

```
POST /admin/maps { eventId, templateId, tierBindings: { "Standard": "tier_id_1" } }
```

1. `validateCreateMap` accepts `templateId` + `tierBindings`
2. `MapService.create` calls `FloorMapTemplateService.requireInScope(templateId, orgId)`
3. `FloorMapTemplateService.materialise(definition, { tierBindings })` validates each bound tier exists on the destination event
4. A single `$transaction` creates the FloorMap row and `Booth.createMany` for materialised booths
5. Override fields (width, height, name, layout) passed in the POST body take precedence over template defaults

## Key files

| File | Purpose |
|---|---|
| `packages/db/prisma/schema.prisma` | `FloorMapTemplate` model + `createdFromTemplateId` column on `FloorMap` |
| `backend/src/services/FloorMapTemplateService.js` | Validation, CRUD, materialisation, snapshot |
| `backend/src/config/maps.js` | Constants (MAX_BOOTHS, SWATCH_COUNT, etc.) |
| `backend/src/api/routes/maps.js` | `/templates` CRUD + `/:mapId/templates` save-from |
| `backend/src/api/validators/mapValidators.js` | `templateId` / `tierBindings` field acceptance |
| `backend/src/services/MapService.js` | `create({ templateId, tierBindings })` materialise path |
| `backend/tests/fixtures/floorMapTemplates.js` | `expoHallTemplate` fixture |
| `backend/tests/unit/floorMapTemplates.test.js` | 14 tests: validation, materialisation, snapshot, CRUD |
| `packages/db/prisma/migrations/20261005100000_floor_map_templates/` | Additive DDL |

## Tests

14 tests in `backend/tests/unit/floorMapTemplates.test.js`:
- **validateDefinition** (6): full fixture normalisation, boundary/missing/unknown fields, duplicate labels, zone bounds, id format, legend swatch range, metadata rejection
- **materialise** (3): stable output equality, booth tier-resolution, snapshot non-mutation
- **serialize** (2): byte-for-byte stable JSON
- **snapshotDefinition** (1): strips live ids, status, assignments, vendor data, resolves tier names
- **CRUD** (6): list, create, get, update, remove, conflict, org-scoped 404, input validation

`MapService`'s `create` with template path is covered by existing mock-based unit tests (the mock prisma path exercises the non-template branch; the template branch validates at the service level).

## Constraints

- Templates are purely informational about geometry — no booth state survives snapshot
- A template exists independently of any FloorMap; no cascade or FK enforcement
- Tier bindings are supplied at materialisation time and are validated to reference real ApplicationTier rows on the destination event
- Unique (organizationId, name) enforced by the database with 409 on conflict