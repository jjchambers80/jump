# Organization Logo Box

**Status:** Implemented
**Last Updated:** 2026-09-12

## Overview

On the public organization page (`/organizations/[orgId]`) the org logo is rendered differently by viewport. On phones and tablets (below the `xl` breakpoint, 1280px) a square "logo box" sits on the cover image, vertically centred on its bottom edge, so the logo straddles the cover and the event list. On desktop the header shows the plain logo image with no box. Logos of any aspect ratio fit the square box: non-square logos are letterboxed/pillarboxed over a blurred copy of themselves so the empty bands pick up the logo's own colours.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/LogoBox.tsx` | Client component: square container, aspect-ratio detection, blurred backdrop for non-square logos |
| `frontend/src/app/organizations/[orgId]/page.tsx` | Public org page: places `LogoBox` on the mobile cover, plain `<img>` header at `xl+` |
| `frontend/src/lib/assets.ts` | `resolveAssetUrl` — turns stored `logoUrl`/`coverUrl` into an absolute image URL |
| `frontend/e2e/public-org-logo.spec.ts` | Playwright: square/landscape/portrait fit, straddle position, desktop plain logo, no-cover fallback, single accessible image |

## Configuration

No new environment variables. Images are served through the existing `ImageService` storage (`BUCKET_*` or local `uploads/`). The e2e spec mocks `GET /organizations/:id/public` and reads the backend origin from `NEXT_PUBLIC_API_URL` (default `http://localhost:3002`), so it runs against a worktree backend on another port.

## How It Works

### Layout by viewport

| Viewport | Cover present | Logo rendering |
|----------|---------------|----------------|
| `< xl` | Yes | `LogoBox` (`w-24`, `rounded-lg`, `shadow-lg`) absolutely positioned `bottom-0 left-4 translate-y-1/2` inside the 16:9 cover wrapper; the content column gets `pt-20` to clear the 48px overhang and the normal org header is hidden |
| `< xl` | No | Plain `<img>` header (`max-h-[85px] object-contain`) |
| `xl+` | Yes / No | Plain `<img>` header; the mobile cover block (and its `LogoBox`) is `xl:hidden` |

When the org has no logo the header falls back to the org name as an `<h1>` at every width.

### Aspect-ratio fitting (`LogoBox`)

1. Renders `<div class="relative aspect-square overflow-hidden">` with the logo as `<img class="h-full w-full object-contain">`.
2. On `onLoad` (or immediately in an effect if the cached image is already `complete` before hydration) it compares `naturalWidth / naturalHeight` to 1 with a 2% tolerance (`SQUARE_TOLERANCE`).
3. Square → nothing else; the logo fills the box.
4. Non-square → a second `<img>` of the same `src` is mounted behind it: `absolute inset-0 object-cover scale-125 blur-xl opacity-80`, `aria-hidden`, empty `alt`. Landscape logos span full width, portrait logos span full height, and the blurred copy fills the remaining bands.
5. Fit state is exposed as `data-logo-fit="pending" | "square" | "backdrop"` on the `data-testid="logo-box"` element; the backdrop carries `data-testid="logo-box-backdrop"`.

## API Endpoints

Consumes only the existing public endpoint:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/organizations/:id/public` | None | `{ organization: { id, name, logoUrl, coverUrl, brandColor, themeMode }, events }` |

## Database

Reads `Organization.logoUrl` and `Organization.coverUrl` (see [Organization Branding](organization-branding.md)). No schema changes. Full schema in [Database Architecture](database-architecture.md).

## Gotchas

- **Two logo `<img>`s exist in the DOM when there is a cover.** The mobile `LogoBox` and the desktop header both render; only one is displayed at a time via `xl:hidden` / `hidden xl:block`. Tests must assert visibility (`toBeHidden`, `getByRole` which skips hidden elements), not element count.
- **`scale-125` on the backdrop is required.** `blur-xl` fades edges to transparent; scaling the blurred copy past the box hides the soft border. Remove it and a light ring appears around the box.
- **Cached images skip `onLoad`.** The `useEffect` that checks `img.complete` handles this; if you refactor `LogoBox`, keep it or square logos will stay `pending` on client navigations.
- **Straddle math is coupled to `w-24`.** The overhang is half the box height (48px). If you change the box size, adjust the content column's `pt-20` (80px = 48px overhang + 32px gap) in `page.tsx`.
- **`SQUARE_TOLERANCE` is 2%.** A 200×204 logo is treated as square and gets no backdrop; a 200×210 logo gets one.
- **Desktop deliberately has no box.** Do not reintroduce `LogoBox` at `xl+`; the two-column layout already shows the cover full-height on the right.

## Related Features

- [Organization Branding](organization-branding.md) — logo/cover upload endpoints and `ImageService`
- [Organization Theme Mode](organization-theme-mode.md) — `BrandScope` wrapper on the same page
- [Theme System](theme-system.md) — `dark:` classes on the box background
