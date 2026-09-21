# Map PDF Export — spec 014 phase 3

Print-ready vector PDF export for floor maps and vendor directories. Text renders as text (selectable, searchable), lines and shapes as vector primitives (no raster screenshots). Generated server-side using [pdfkit](https://www.npmjs.com/package/pdfkit).

## Endpoint

**`GET /admin/maps/:mapId/export`**

Admin/organizer only (uses `requireAuth` + `requireOrganizer` + `activeOrgFor` to scope to the request organization).

### Query parameters

| Param | Default | Description |
|-------|---------|-------------|
| `includeVendors` | `true` | When `false`, the PDF contains only the map page (no vendor directory pages). When `true`, SOLD / RESERVED booth holders are listed in a table sorted by booth label. |

### Response

- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="floor-map-{mapId}.pdf"`
- 404 `NotFoundError` if the map doesn't exist or the event is missing
- 400 `ValidationError` on invalid parameters

## PDF Structure

### Page 1 — Floor Map

- **Header**: Map name (brand color), event date, venue name, city/state
- **Map area**: The full map grid drawn to scale, fitting within a letter page
  - **Walls**: Dark grey filled rectangles
  - **Stages**: Dark filled rectangles with caption
  - **Entrances**: Green dashed outline with caption
  - **Labels**: Text at position (S/M/L sizes)
  - **Service elements** (restroom, food, info, firstAid, programming): Lightly filled rectangles with caption text
  - **Booths**: Rectangles with thin borders; swatch color indicates tier. SOLD/RESERVED booths have a 15% opacity fill of their tier color. Booth label rendered as centered text inside each booth
- **Legend**: Colored swatches with tier labels, positioned beside the map
- **Footer**: Generation timestamp, map dimensions, org name
- **PDF metadata**: Title, Author, Subject, Keywords, Creator

### Page(s) 2+ — Vendor Directory (optional)

One or more table pages listing booth assignments sorted by booth label (deterministic numeric-parsed order). Each vendor page starts on a new page.

| Column | Content |
|--------|---------|
| Booth | Booth label (e.g. A1, B2) |
| Vendor | `Application.profile.businessName` or "—" |
| Tier | `ApplicationTier.name` |
| Status | "Sold" / "Reserved" |

Rows have alternating background fills. Page numbers appear on each vendor page.

## Service

`backend/src/services/MapExportService.js`

### Methods

| Method | Description |
|--------|-------------|
| `exportMapPdf(organizationId, mapId, { includeVendors })` | Generates the PDF, returns a `Promise<Buffer>` |

The service reads from the database directly (not through MapService) so it can eagerly-include the event, venue, and booth data in one query.

### PDF generation details

- Page size: Letter (8.5×11)
- Orientation: Landscape when `map.width >= map.height`, portrait otherwise
- All measurements in points (1 pt = 1/72 inch)
- Margin: 48pt (0.67") all around
- Map scale: calculated to fit within the available width/height accounting for margins, header, and legend space
- Legend: positioned beside the map when `availWidth > 400`, with tier swatches as colored squares

## Tests

`backend/tests/unit/mapExport.test.js`

- 9 unit tests covering:
  - NotFoundError for missing map / event
  - Buffer generation with correct PDF header
  - Vector primitive verification (rect, fill, text calls)
  - Vendor directory addPage and text content
  - includeVendors=false skips directory
  - Edge cases: all AVAILABLE booths, all BLOCKED booths

The unit tests mock pdfkit so the draw calls are observable without actual file I/O. Contract tests (future) should verify the PDF opens correctly and contains expected text.

## Dependencies

- `pdfkit` (^0.20.2) — pure-JS vector PDF generation, no native dependencies