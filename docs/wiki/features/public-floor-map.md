# Public Floor Map Page

**Status**: Implemented (PR #244, in prod 2026-09-29; event-page full-screen map 2026-09-29)
**Last Updated**: 2026-09-29

## Overview
`/events/:slug/map` is the public floor map of an event. Visitors see which booths exist, what they cost and which vendor holds each one. One column at every width, in the event page's order: event header, map, then the [vendor directory](vendor-directory.md). The map uses the same viewport as the vendor [spot chooser](spot-chooser.md), so vendors see the same map they bought from.

## Key Files
| File | Purpose |
|------|---------|
| `frontend/src/app/events/[eventId]/map/page.tsx` | Server wrapper: 308 from an event id to its slug, keeping `?booth=` (not on tenant hosts) |
| `frontend/src/components/OrganizationHeader.tsx` (`layout="bar"`), `frontend/src/components/storefront/MapEventSummary.tsx` | Map bar header and its event summary row |
| `frontend/src/app/events/[eventId]/map/PublicMapClient.tsx` | The page: header, map viewport (fit / zoom / centre), inline legend, booth dialog, 30 s ETag polling, `?booth=` deep links |
| `frontend/src/app/events/[eventId]/map/VendorDirectory.tsx` | Vendor search, category filter and cards; "View booth" focuses the booth on the map |
| `frontend/src/components/maps/MapCanvas.tsx` | Shared SVG canvas in `react-zoom-pan-pinch`. `fitOnInit` prop (default `true`) |
| `frontend/src/components/maps/Booth.tsx`, `MapElement.tsx`, `mapTheme.ts` | Shared booth and element rendering, tier swatches, legend state colours |
| `frontend/src/app/events/[eventId]/FloorMapButton.tsx` | **Floor map** pill in the event page hero; opens the map as a full-screen dialog on every width. Replaces the old preview section at the bottom of the event page |
| `frontend/e2e/public-map.spec.ts` | Legend, booth states, deep links, directory, phone order and full width, desktop containment, dialog focus, event-page full-screen map (desktop + phone) |

## Configuration
None. The page shows only a **published** map (`GET /events/:eventId/map` returns 404 otherwise).

## How It Works
1. **Data.** The client fetches `GET /events/:eventId` for the header and brand (name, date, venue name + time zone, org identity, brand colour, theme mode), and `GET /events/:eventId/map` for geometry, legend, booths and vendors. The map is polled every 30 s with `If-None-Match` while the tab is visible. A 304 keeps the current map.
2. **Header.** `OrganizationHeader layout="bar"`, the slim Ticketmaster-style bar used only on map pages: full width, the menu button at the far left (the drawer opens from the left, at every width, and no inline menu is rendered), the logo flush left beside it, sized by height (36 / 44 px tall, up to 9 / 13 rem wide, `LogoBox fit="height"`) so wordmarks stay legible: the one exception to the header's single logo size. The bar has its own surface (`bg-white` / `dark:bg-slate-950`) so it reads as one band over the map; the page body shares its 28 px gutter, so bar, summary and map line up on the left, Sign in / Account flush right. Its `subheader` is `MapEventSummary` (`components/storefront/MapEventSummary.tsx`): the event image from `sm` at its own aspect ratio, 64 px tall (whole, never cropped or letterboxed, decorative), a "Floor map" eyebrow, the event name as the page's only `h1`, then date · time (`formatEventDateTime` in the **venue's** zone, spec 033) · the venue name, underlined, linking back to the event page ("{venue} — back to {event}" for screen readers). `<main id="storefront-main">` is the skip link's target. While the event is loading, or if it fails, the page shows a plain "Back to the event" + `h1` block instead.
3. **Map.** On phones the map section runs edge to edge (`-mx-4`) and is square. From `sm` it sits inside the content column with a rounded border, 4:3, and 16:9 from `lg`. The box has a dotted floor background, zoom in / out / **Fit the whole map** buttons (44 px), and the legend under it (tiers with all-in price ranges, then booth states). The header row shows "N of M booths open", counting only booths with a tier.
4. **Fit.** `fit()` scales the whole floor (`width × gridSize` by `height × gridSize`) to 94 % of the box and centres it. It runs once when the map first loads and again when the box width changes by 24 px or more. Height changes (a phone's address bar) never undo the visitor's zoom, and polls never refit.
5. **Choosing a booth.** A click or Enter on a booth, a directory "View booth" link, or `?booth=` opens the booth dialog, pushes `?booth=<id>` and centres the booth at least twice the fit scale (never zooming out). From the directory the page also scrolls back up to the map. The highlight pulses for about 4.5 s. With reduced motion it stays until the dialog closes, and nothing animates.
6. **Deep links.** `?booth=` accepts the booth id (canonical) or its label (links sent before spec 014 phase 3). An unknown value shows an alert and opens nothing. The deep-link effect runs on the `booth` param and the first map load only, so a poll never reopens a dialog the visitor closed.
7. **Booth dialog.** One `role="dialog"` for every width: a bottom sheet on phones, centred from `sm`. It lists status (Available, Sold to X, Reserved for X, Not for sale, Being purchased), category, all-in price (the booth's own `price` wins over its tier's, spec 039) and the vendor. Sold or reserved booths with a vendor get a permanent link. Focus moves to **Close**, Tab is trapped, Escape or the backdrop closes it, and focus returns to what opened it. Closing replaces the URL without `?booth=`.
8. **From the event page.** The event hero's actions row (next to **Event Information** and the Get involved pills) shows a **Floor map** pill once `GET /events/:eventId/map` returns a published map; on 404 nothing renders. The pill opens a `role="dialog"` that fills the viewport (`fixed inset-0 h-dvh`) on phones and desktop alike: a top bar (Floor map eyebrow, event name, map name · N of M booths open, **Vendor directory** link to this page, 44 px **Close the floor map**), the map filling the rest (dotted floor, zoom / fit buttons, fitted on open and on real resizes), and the legend pinned at the bottom with safe-area padding. The map is refetched each time the pill opens. Choosing a booth opens the same booth sheet as this page (`BoothDetail`, exported from `PublicMapClient.tsx` with `Legend`, `toMapBooth` and `iconButton`); its permanent link points at `/events/:slug/map?booth=<id>`. Escape closes the booth sheet first, then the map; focus starts on Close, Tab stays inside, and focus returns to the pill. Page scroll is locked while open.

## API Endpoints
No new endpoints.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/events/:eventId/meta` | None | Slug for the server redirect |
| GET | `/events/:eventId` | None (store gate) | Header, brand and theme |
| GET | `/events/:eventId/map` | None (store gate) | Published map, legend, booths, vendors; ETag, `no-store` |

## Database
Read-only: `FloorMap`, `Booth`, tiers and approved vendor profiles through `MapService`'s public serialisation. See [Floor Maps](floor-maps.md) and [database-architecture.md](database-architecture.md).

## Gotchas
- **Pass `fitOnInit={false}` to `MapCanvas` when the page fits the map itself.** `react-zoom-pan-pinch` re-applies its own `fitOnInit` on every size change during its first seconds and silently undoes a custom fit. The public map, the event-page full-screen map and `SpotWorkspace` turn it off; the builder keeps the default.
- **Keep the two viewports alike.** The public map copies the spot chooser's box (dotted floor, zoom buttons, legend under the map, fit maths) so vendors recognise the map. A visual change to one usually belongs in both.
- **The full-screen map is not portalled.** It renders inside the event page's `BrandScope` so brand tokens and theme mode apply. Nothing above it in the hero may gain a `transform`, `filter` or `backdrop-filter`, or `fixed inset-0` would be trapped inside that box; its entrance animation (`animate-fade-in`) is opacity only for the same reason.
- **Nested dialogs, one Escape.** The full-screen map's key handler returns early while the booth sheet is open, so the sheet owns Escape and Tab.
- **One dialog, not a mobile and desktop copy.** The old page mounted both, which duplicated `id="booth-detail-title"`. Specs rely on exactly one visible dialog.
- **Brand tokens only** (`text-brand-link`, `bg-brand`) and `BrandScope` with the org `themeMode` (root gotchas 6 and 7).
- The page is in `<main id="main-content">`, and a "Skip the map" link jumps to the vendor directory heading. Keep new controls at 44 px and inputs at 16 px on phones (iOS zooms smaller inputs).
- Playwright: when a dev backend holds `:3002`, run with `FIXTURE_API_PORT=<free port> PLAYWRIGHT_PORT=<free port>`.

## Related Features
- [Floor Maps and Vendor Booth Purchases](floor-maps.md): publication, holds, sold state
- [Vendor directory](vendor-directory.md): the section under the map
- [Spot Chooser](spot-chooser.md): the vendor-side viewport this page mirrors
- [Vendor Space Selection](vendor-space-selection.md): per-spot prices
- [Venue time zones](venue-time-zones.md): the header date
- [Organization branding](organization-branding.md) and [theme mode](organization-theme-mode.md)
