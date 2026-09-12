# Organization Theme Mode

**Status:** Implemented
**Last Updated:** 2026-09-12

## Overview

Each organization chooses how its public pages (organization, venue, event detail) render in light/dark mode: **Light**, **Dark**, **System** (follow the visitor's OS), or **User choice** (default — the visitor's own saved theme applies). The setting lives in the admin **Organizations → Edit → Theme** section above Branding. Forcing never overwrites the visitor's stored preference and never affects the admin area.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | `enum ThemeMode { LIGHT DARK SYSTEM USER }`, `Organization.themeMode @default(USER)` |
| `backend/src/api/validators/organizationValidators.js` | `THEME_MODES`, `normalizeThemeMode`, `validateUpdateOrganization` |
| `backend/src/services/OrganizationService.js` | `updateOrganization` whitelist, `getPublicOrganization` emits `themeMode` |
| `backend/src/services/VenueService.js` | `getPublicVenueById` emits `venue.themeMode` |
| `backend/src/services/EventService.js` | `getEventById` emits `organizationThemeMode` |
| `frontend/src/lib/theme.ts` | `ThemeMode` type, `THEME_MODES` picker options, `themeModeToForced` |
| `frontend/src/components/ThemeProvider.tsx` | `ThemeModeContext` + `useThemeMode()`; resolves SYSTEM and passes `forcedTheme` to next-themes |
| `frontend/src/components/BrandScope.tsx` | `themeMode` prop forces the theme while mounted, releases on unmount |
| `frontend/src/components/ThemeToggle.tsx` | Hidden while a theme is forced |
| `frontend/src/components/ThemeModePicker.tsx` | Radio-card group for the admin panel |
| `frontend/src/app/admin/organizations/page.tsx` | Theme section with **Save theme** button |
| `frontend/e2e/admin-org-theme-mode.spec.ts` | Playwright: picker, save, forcing on each public page, release on client navigation |

## Configuration

No new environment variables. Seed sets `Jump Events Co.` to `DARK` so enforcement is visible locally.

## How It Works

### Semantics

| Value | Public org pages | Visitor preference |
|-------|------------------|--------------------|
| `LIGHT` | Always light | Ignored on these pages, left intact in `localStorage.theme` |
| `DARK` | Always dark | Same |
| `SYSTEM` | Follows OS `prefers-color-scheme`, live | Same |
| `USER` (default) | Visitor's saved choice (default system) | Honored |

### Flow

1. Admin opens **Admin → Organizations → Edit**. `ThemeModePicker` renders four native radios styled as cards (`data-testid="theme-mode-{light|dark|system|user}"`). **Save theme** is enabled only when the selection differs from the saved value and sends `PATCH /organizations/:id { themeMode }`.
2. The validator accepts the four enum values case-insensitively and stores uppercase. Anything else is `400 "Theme mode must be one of: LIGHT, DARK, SYSTEM, USER"`.
3. Public endpoints expose the value: `organization.themeMode`, `venue.themeMode`, `event.organizationThemeMode`.
4. Each public page passes it to `<BrandScope color={…} themeMode={…}>`. `BrandScope` maps LIGHT/DARK/SYSTEM to `'light' | 'dark' | 'system'` and calls `setForced(...)` from `useThemeMode()` in an effect; the cleanup calls `setForced(null)`.
5. `ThemeProvider` holds the forced state. `'system'` is resolved to light/dark with a `matchMedia('(prefers-color-scheme: dark)')` listener because next-themes skips re-applying a forced theme on OS changes. The resolved value is passed as `forcedTheme` to `NextThemesProvider`, which swaps the `html` class without touching `localStorage`.
6. `ThemeToggle` returns `null` when `useTheme().forcedTheme` is set. (The public navbar is currently not rendered, so this only matters if it is reintroduced; `OrgSwitcher` in admin is untouched because admin pages never force.)

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PATCH | `/organizations/:id` | Admin + org ownership (SYSTEM_ADMIN bypass) | Update `themeMode` alongside `name`, `status`, `brandColor` |
| GET | `/organizations/:id/public` | None | `organization.themeMode` |
| GET | `/venues/:id` | None | `venue.themeMode` (still no `organizationId`) |
| GET | `/events/:id` | None | `organizationThemeMode` |

## Database

`Organization.themeMode ThemeMode @default(USER)` — migration `20260912051759_add_org_theme_mode` creates the enum and the non-null column. See [Database Architecture](database-architecture.md).

## Gotchas

- **Never call `setTheme` to force.** That writes the visitor's `localStorage.theme` site-wide. Forcing goes through `useThemeMode().setForced` → `forcedTheme` only.
- **Nested `ThemeProvider`s are no-ops** in next-themes; the forced value must reach the root provider, which is why it is held in context there.
- **Org-scoped public pages must pass `themeMode` to `BrandScope`.** A page that only passes `color` gets brand colors but not theme enforcement.
- **Brief flash on first paint.** Public pages fetch client-side, so the visitor's theme shows until the org data arrives. SSR of the org fetch would remove this.
- **Full reloads release forcing automatically** (state is in memory). Client-side navigation relies on `BrandScope`'s effect cleanup — covered by the e2e "leaving a forced page" test.
- `/checkout/[eventId]` has no org data and is not forced — follow-up if needed.
- `frontend/e2e/theme-modes.spec.ts` expects a `theme-toggle` on `/events`; the public navbar was removed earlier (`ef3e89b`), so those tests fail independently of this feature.

## Related Features

- [Theme System](theme-system.md) — next-themes provider this builds on
- [Organization Branding](organization-branding.md) — `BrandScope`, same admin panel and propagation pattern
- [Multi-Tenant Architecture](multi-tenant-architecture.md) — ownership checks on PATCH
