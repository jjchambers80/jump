# Frontend — Scoped Agent Instructions

Loads when agent touches `frontend/` files. For root-level commands and env vars, see [`../AGENTS.md`](../AGENTS.md).

## Routing Structure

```
app/
├── admin/           # Organizer/admin dashboard (session-protected)
├── events/          # Public event browsing + detail pages
├── auth/            # Sign-in page
├── checkout/        # Cart + payment flow
├── confirmation/    # Post-purchase confirmation
├── my-tickets/      # Customer ticket list
├── orders/          # Order history
├── tickets/         # Individual ticket view (QR code)
├── venues/          # Venue pages
└── api/auth/        # Auth.js API route handler
```

## Key Files

- `auth.ts` — Auth.js v5 config (Google OAuth + magic link, JWT strategy)
- `services/api.ts` — All backend API calls go through here
- `components/` — Shared React components
- `lib/` — Utilities and helpers (`lib/color.ts` — WCAG contrast + brand CSS vars)

## Patterns

- **Server vs Client**: Default to server components. Add `'use client'` only when needed for interactivity
- **Data fetching**: Server components fetch directly; client components call `services/api.ts`
- **Admin pages**: Must check session server-side and add to sidebar navigation
- **Search params**: Always wrap `useSearchParams()` consumers in `<Suspense fallback={...}>`
- **Brand colors**: On public organization/venue/event pages and `EventCard`, use the `brand` tokens (`bg-brand`, `hover:bg-brand-hover`, `text-brand-fg`, `text-brand-link`) instead of raw `blue-600`/`indigo-400` classes. Wrap the page root in `<BrandScope color={…} themeMode={…}>`. Color math lives in `lib/color.ts`; see `docs/wiki/features/organization-branding.md`
- **Settings editors**: Settings › General is read-only summary rows (`app/admin/settings/SummaryRow.tsx`) that open modals built on `app/admin/settings/SettingsDialog.tsx` (focus trap, Escape/backdrop, discard confirm, Cancel/Save header). New settings sections should reuse both rather than inline forms; each dialog PATCHes only its own fields. See `docs/wiki/features/organization-settings.md`
- **Public org logo**: `components/LogoBox.tsx` (square box, blurred backdrop for non-square logos) is only for the mobile cover on `/organizations/[orgId]`; desktop uses a plain `<img>`. Both are in the DOM at once, so tests assert visibility, not count. See `docs/wiki/features/organization-logo-box.md`
- **Org theme mode**: `BrandScope`'s `themeMode` prop forces light/dark/system on public org pages through `useThemeMode().setForced` → next-themes `forcedTheme`. Never call `setTheme` to force — it overwrites `localStorage.theme`. Types/options in `lib/theme.ts`; see `docs/wiki/features/organization-theme-mode.md`

## Auth in Frontend

```typescript
// Server component — get session
import { auth } from "@/auth"
const session = await auth()

// API call with auth — services/api.ts handles Bearer token injection
```
