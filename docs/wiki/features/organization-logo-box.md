# Organization Logo Header

**Status:** Implemented
**Last Updated:** 2026-09-19

## Overview

Every public storefront page opens with a full-width organization header: the organization logo (square box, 80px on mobile, 96px from the `sm` breakpoint) next to the organization name. On `/organizations/[orgId]` the name is the page `<h1>`; on event, apply, checkout and confirmation pages the whole header links back to the organization page. Logos of any aspect ratio fit the box with `object-contain` over a flat background — no blurred backdrop.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/OrganizationHeader.tsx` | Shared header: `LogoBox` + name; `as="h1"` (org page) or `as="link"` (default, links to `/organizations/:id`) |
| `frontend/src/components/LogoBox.tsx` | Square container with `object-contain` logo |
| `frontend/src/app/organizations/[orgId]/OrganizationStorefront.tsx` | Org page: header, then the cover band and the event stubs (see [Organization Storefront Page](organization-storefront.md)) |
| `frontend/src/app/events/[eventId]/page.tsx` | Event page: header above the hero card |
| `frontend/src/app/events/[eventId]/apply/ApplyShell.tsx` | Apply index / form / status pages |
| `frontend/src/app/checkout/[eventId]/page.tsx`, `frontend/src/app/confirmation/page.tsx` | Checkout and confirmation |
| `backend/src/services/EventService.js` | `_formatEventDetail` exposes `organizationLogoUrl` (alongside `organizationId`/`organizationName`) |
| `frontend/src/lib/assets.ts` | `resolveAssetUrl` — turns stored `logoUrl` into an absolute image URL |
| `frontend/e2e/public-org-logo.spec.ts` | Playwright: full-width and responsive header, square/landscape/portrait fit, no-cover/no-logo fallbacks, overflow, single accessible image |

## Configuration

No new environment variables. Images are served through the existing `ImageService` storage (`BUCKET_*` or local `uploads/`). The e2e spec mocks `GET /organizations/:id/public` and reads the backend origin from `NEXT_PUBLIC_API_URL` (default `http://localhost:3002`), so it runs against a worktree backend on another port.

## How It Works

### Where the header renders

| Page | Data source | Name element |
|------|-------------|--------------|
| `/organizations/[orgId]` | `GET /organizations/:id/public` → `organization` | `<h1>` |
| `/events/[eventId]`, `/events/[eventId]/apply/*` | `GET /events/:id` → `organizationId`, `organizationName`, `organizationLogoUrl` | link |
| `/checkout/[eventId]` | same event payload | link |
| `/confirmation` | `GET /orders/:id` → `event.organization*` | link |

The header renders only when `organizationName` is present; the logo box renders only when `logoUrl` is set. It sits inside the page's `BrandScope`, so brand colour and theme mode apply. Pages that previously carried their own vertical padding on `BrandScope` moved it onto the inner container so the header stays flush with the top.

### Aspect-ratio fitting (`LogoBox`)

`<div class="relative aspect-square overflow-hidden bg-gray-100 dark:bg-slate-800">` with the logo as `<img class="h-full w-full object-contain">`. Square logos fill the box; landscape logos are letterboxed, portrait logos pillarboxed, and the bands show the flat container background. There is no aspect-ratio measurement and no second image.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/organizations/:id/public` | None | `{ organization: { id, name, logoUrl, coverUrl, brandColor, themeMode }, events }` |
| GET | `/events/:id` | None | Includes `organizationId`, `organizationName`, `organizationLogoUrl`, `organizationBrandColor`, `organizationThemeMode` |

## Database

Reads `Organization.logoUrl` and `Organization.coverUrl` (see [Organization Branding](organization-branding.md)). No schema changes. Full schema in [Database Architecture](database-architecture.md).

## Gotchas

- **One header component.** Add new public storefront routes through `OrganizationHeader`; do not hand-roll a logo `<img>` so only one accessible logo image exists per page.
- **Only one `<h1>` per page.** Use `as="h1"` only on the organization page; event and checkout pages already have their own `<h1>`.
- **Header spacing is coupled to the responsive logo widths.** If the `w-20 sm:w-24` sizes change, verify the header's padding, long-name wrapping, and cover position at both mobile and desktop widths.

## Related Features

- [Organization Branding](organization-branding.md) — logo/cover upload endpoints and `ImageService`
- [Organization Theme Mode](organization-theme-mode.md) — `BrandScope` wrapper on the same pages
- [Theme System](theme-system.md) — `dark:` classes on the box background
