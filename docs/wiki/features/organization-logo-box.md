# Organization Logo Header

**Status:** Implemented
**Last Updated:** 2026-09-18

## Overview

On the public organization page (`/organizations/[orgId]`) a full-width page header contains the organization logo and name at every viewport size. The square logo box is 80px on mobile and 96px from the `sm` breakpoint upward. Logos of any aspect ratio fit the box: non-square logos are letterboxed/pillarboxed over a blurred copy of themselves so the empty bands pick up the logo's own colours.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/LogoBox.tsx` | Client component: square container, aspect-ratio detection, blurred backdrop for non-square logos |
| `frontend/src/app/organizations/[orgId]/page.tsx` | Public org page: full-width identity header followed by the existing cover and event layouts |
| `frontend/src/lib/assets.ts` | `resolveAssetUrl` — turns stored `logoUrl`/`coverUrl` into an absolute image URL |
| `frontend/e2e/public-org-logo.spec.ts` | Playwright: full-width and responsive header, square/landscape/portrait fit, no-cover/no-logo fallbacks, overflow, and accessible image count |

## Configuration

No new environment variables. Images are served through the existing `ImageService` storage (`BUCKET_*` or local `uploads/`). The e2e spec mocks `GET /organizations/:id/public` and reads the backend origin from `NEXT_PUBLIC_API_URL` (default `http://localhost:3002`), so it runs against a worktree backend on another port.

## How It Works

### Layout by viewport

| Viewport | Cover present | Logo rendering |
|----------|---------------|----------------|
| `< sm` | Yes / No | `LogoBox` in the full-width header at `w-20` (80px), followed by the organization name |
| `sm+` | Yes / No | `LogoBox` in the full-width header at `w-24` (96px), followed by the organization name |

The header is always before the cover/content layout and always exposes the organization name as the page's `<h1>`. When the org has no logo, only the heading is rendered.

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

- **One logo component is shared by every breakpoint.** Keep it in the page header rather than duplicating it in the mobile cover or desktop event column; this ensures only one accessible logo image exists.
- **`scale-125` on the backdrop is required.** `blur-xl` fades edges to transparent; scaling the blurred copy past the box hides the soft border. Remove it and a light ring appears around the box.
- **Cached images skip `onLoad`.** The `useEffect` that checks `img.complete` handles this; if you refactor `LogoBox`, keep it or square logos will stay `pending` on client navigations.
- **Header spacing is coupled to the responsive logo widths.** If the `w-20 sm:w-24` sizes change, verify the header's padding, long-name wrapping, and cover position at both mobile and desktop widths.
- **`SQUARE_TOLERANCE` is 2%.** A 200×204 logo is treated as square and gets no backdrop; a 200×210 logo gets one.

## Related Features

- [Organization Branding](organization-branding.md) — logo/cover upload endpoints and `ImageService`
- [Organization Theme Mode](organization-theme-mode.md) — `BrandScope` wrapper on the same page
- [Theme System](theme-system.md) — `dark:` classes on the box background
