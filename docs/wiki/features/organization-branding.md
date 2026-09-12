# Organization Branding

**Status:** Implemented
**Last Updated:** 2026-09-12

## Overview

Organizations can upload a logo and cover image and pick a brand color. The brand color is inherited by buttons, prices, and links on the public organization page, venue pages, and event detail pages. The admin picker shows a live WCAG 2.1 AA contrast check so organizers know whether their color is ADA-friendly before saving.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | `Organization.logoUrl/logoImageId/coverUrl/coverImageId/brandColor` |
| `backend/src/api/routes/organizations.js` | PATCH (name/status/brandColor), logo + cover upload/delete, public endpoint, `verifyOrgOwnership` |
| `backend/src/api/validators/organizationValidators.js` | `normalizeHexColor`, `validateUpdateOrganization` |
| `backend/src/services/OrganizationService.js` | `updateOrganization`, `getPublicOrganization`, `setOrganizationLogo/Cover` |
| `backend/src/services/EventService.js` | `getEventById` emits `organizationBrandColor` |
| `backend/src/services/VenueService.js` | `getPublicVenueById` emits `venue.brandColor` |
| `backend/src/services/ImageService.js` | Shared image processing/storage (also used by event + venue logos) |
| `frontend/src/lib/color.ts` | Pure WCAG contrast math, hover/dark-mode derivation, presets, `brandCssVars` |
| `frontend/src/components/BrandScope.tsx` | Sets `--brand-*` CSS vars for a subtree |
| `frontend/src/components/BrandColorPicker.tsx` | Preset swatches, custom hex, reset |
| `frontend/src/components/ContrastBadge.tsx` | Pass/fail pill, three ratio rows, light/dark preview |
| `frontend/src/components/InfoTooltip.tsx` | Accessible `?` tooltip (hover + focus, Escape closes) |
| `frontend/src/app/admin/organizations/page.tsx` | Edit → Branding: logo, cover, brand color |
| `frontend/src/app/globals.css`, `frontend/tailwind.config.js` | `--brand` defaults and `brand` Tailwind tokens |
| `frontend/tests/unit/color.test.ts` | Vitest coverage of the color math |
| `frontend/e2e/admin-branding-color.spec.ts` | Playwright: picker, badge, save, inheritance, axe scans |

## Configuration

No new environment variables. Images use the existing `ImageService` storage configuration.

## How It Works

### Brand color

1. Admin opens **Admin → Organizations → Edit**. The Branding grid shows logo, cover image, and a **Brand color** row.
2. `BrandColorPicker` offers 12 presets (Tailwind 700/800 shades that pass AA), a native `<input type="color">`, and a debounced hex text field. Invalid text shows an inline error and never propagates.
3. `evaluateBrandColor(hex)` runs three checks, each needing ≥ 4.5:1:
   - button text (auto-picked white or `#111827`) on the brand color
   - the brand color as link text on the light page background `#f9fafb`
   - a **derived** lighter tint as link text on the dark page background `#0f172a`
4. `ContrastBadge` shows "Passes/Fails WCAG AA", the three ratios, a preview, and a `?` tooltip explaining the ADA/WCAG requirement.
5. **Save brand color** sends `PATCH /organizations/:id { brandColor }`. Failing colors are allowed (warn, not block) — the UI shows "You can save this color, but it may not meet ADA requirements."
6. The server normalizes to lowercase `#rrggbb` (3-digit expanded) and stores one field. `null` clears it.
7. Public pages fetch the color (`organization.brandColor`, `venue.brandColor`, `event.organizationBrandColor`) and wrap their root in `<BrandScope color={…}>`, which sets `--brand`, `--brand-hover`, `--brand-fg`, `--brand-link-light`, `--brand-link-dark` inline.
8. `globals.css` maps `--brand-link` to the light or dark var under `.brand-scope` / `.dark .brand-scope`, so theme switching stays in CSS (no hydration flash). Components use `bg-brand`, `hover:bg-brand-hover`, `text-brand-fg`, `text-brand-link`.
9. With no brand color, the tokens resolve to the platform defaults (`#2563eb` / `#1d4ed8` / `#818cf8`), identical to the previous hardcoded blue/indigo classes.

### Logo and cover

Uploads go through `uploadImage` (multer) → `ImageService.processUpload(..., 'org_logo' | 'org_cover')` → `setOrganizationLogo/Cover`. The previous image record is deleted after a successful replace or removal.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PATCH | `/organizations/:id` | Admin + org ownership (SYSTEM_ADMIN bypass) | Update `name`, `status`, `brandColor` (hex or `null`) |
| GET | `/organizations/:id/public` | None | `{ organization: { id, name, logoUrl, coverUrl, brandColor }, events }` |
| POST | `/organizations/:id/logo` | Admin + org ownership | Upload logo (multipart `logo`) |
| DELETE | `/organizations/:id/logo` | Admin + org ownership | Remove logo |
| POST | `/organizations/:id/cover` | Admin + org ownership | Upload cover image |
| DELETE | `/organizations/:id/cover` | Admin + org ownership | Remove cover image |
| GET | `/venues/:id` | None | Includes `venue.brandColor` |
| GET | `/events/:id` | None | Includes `organizationBrandColor` |

Validation error for bad hex: `400 "Brand color must be a hex value like #1d4ed8"`.

## Database

`Organization` — `logoUrl`, `logoImageId`, `coverUrl`, `coverImageId` (migration `20260912025043_add_org_logo_cover`), `brandColor String?` (migration `20260912042801_add_org_brand_color`). Image ids reference `Image` with `ON DELETE SET NULL`. See [Database Architecture](database-architecture.md).

## Gotchas

- **Use the tokens.** On public org/venue/event pages and `EventCard`, use `bg-brand`, `hover:bg-brand-hover`, `text-brand-fg`, `text-brand-link` — never raw `bg-blue-600` / `text-indigo-400` — or the brand color will not apply.
- **Defaults are pinned.** `--brand` defaults in `globals.css` must stay equal to `bg-blue-600` etc. or the unbranded `/events` listing shifts visually.
- **Tailwind opacity modifiers don't work on brand tokens** (`bg-brand/50`): the values are CSS vars, not RGB channels.
- **Dark-mode link color is derived**, not stored. A brand chosen for light backgrounds is tinted lighter until it reaches 4.5:1 on `#0f172a`; brand fidelity in dark mode is intentionally lower.
- **Server validates format, not compliance.** Any valid hex is accepted; the badge is advisory. If a hard block is ever needed, port the ~30-line luminance function from `lib/color.ts` into the validator.
- **Public venue response deliberately omits `organizationId`** (existing contract test). Only `brandColor` is exposed.
- **`PATCH /organizations/:id` now requires org ownership.** Non-system admins can only edit their own org; tests must use a user with `organizationId` set (see `tests/contract/organizations.test.js`).
- Event hero (white text on dark gradient) and the checkout page are not branded — follow-up work.
- Frontend unit tests run with `npm run test:unit` (vitest); `npm test` remains Playwright.

## Related Features

- [Organization Logo Box](organization-logo-box.md) — how the logo is rendered on the public org page
- [Venue Management](venue-management.md) — venue logo uploads share `ImageService`
- [Event Management](event-management.md) — event logo uploads, `organizationBrandColor` on detail
- [Theme System](theme-system.md) — `.dark` class drives `--brand-link` selection
- [Organization Settings](organization-settings.md) — business details for the same model
- [Multi-Tenant Architecture](multi-tenant-architecture.md) — ownership checks
