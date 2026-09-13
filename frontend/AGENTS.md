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
├── orders/          # [orderId] detail (buyer session or staff) + lookup
├── venues/          # Venue pages
├── organizations/   # Public org page + [orgId]/account (buyer sign-in, orders, tickets)
├── api/auth/        # Auth.js API route handler (staff)
└── api/buyer/       # Buyer session proxies: request/verify/logout/me/* (httpOnly jump_buyer cookie)
```

## Key Files

- `auth.ts` — Auth.js v5 config (Google OAuth + magic link, JWT strategy, Prisma adapter). `auth.config.ts` is the edge-safe subset (providers, `trustHost`, HS256 cookie codec from `lib/authJwt.ts`) that `src/middleware.ts` also uses
- `services/api.ts` — All backend API calls go through here
- `components/` — Shared React components
- `lib/` — Utilities and helpers (`lib/color.ts` — WCAG contrast + brand CSS vars; `lib/fees.ts` — all-in fee math mirroring backend `FeeService`; `lib/buyerSession.ts` — server-only buyer cookie + backend proxy, signs the client IP for the backend rate limiter)

## Patterns

- **Server vs Client**: Default to server components. Add `'use client'` only when needed for interactivity
- **Data fetching**: Server components fetch directly; client components call `services/api.ts`
- **Admin pages**: `src/middleware.ts` redirects unauthenticated `/admin*` to `/auth/signin?callbackUrl=…` on the edge; pages keep `AdminRoute`/`ProtectedRoute` as the second layer. Add new admin pages to the sidebar navigation
- **Search params**: Always wrap `useSearchParams()` consumers in `<Suspense fallback={...}>`
- **Tenant hosts**: `src/middleware.ts` rewrites requests on an organization's custom domain (`/` → org page, `/account` → buyer account, admin/auth → 404) using `lib/storefrontHost.ts`. Pages receive the same `params.orgId` as on the platform host, so no page needs host awareness. Platform hosts come from `NEXT_PUBLIC_PLATFORM_HOSTS` / `AUTH_URL`
- **Buyer auth**: never call `/buyer/*` on the backend from the browser and never use Auth.js for buyers. Go through `app/api/buyer/*` route handlers so the session stays in the httpOnly cookie. There is no `/my-tickets`; buyers self-serve on `/organizations/[orgId]/account`. See `docs/wiki/features/buyer-accounts.md`
- **Org switcher**: `OrgContext` publishes the selection with `setActiveOrganizationId`; `services/api.ts` sends it as `X-Jump-Org` so admin data follows the switcher for multi-org staff
- **Brand colors**: On public organization/venue/event pages and `EventCard`, use the `brand` tokens (`bg-brand`, `hover:bg-brand-hover`, `text-brand-fg`, `text-brand-link`) instead of raw `blue-600`/`indigo-400` classes. Wrap the page root in `<BrandScope color={…} themeMode={…}>`. Color math lives in `lib/color.ts`; see `docs/wiki/features/organization-branding.md`
- **Settings editors**: Settings › General is read-only summary rows (`app/admin/settings/SummaryRow.tsx`) that open modals built on `app/admin/settings/SettingsDialog.tsx` (focus trap, Escape/backdrop, discard confirm, Cancel/Save header). New settings sections should reuse both rather than inline forms; each dialog PATCHes only its own fields. See `docs/wiki/features/organization-settings.md`
- **Public org logo**: `components/LogoBox.tsx` (square box, blurred backdrop for non-square logos) is only for the mobile cover on `/organizations/[orgId]`; desktop uses a plain `<img>`. Both are in the DOM at once, so tests assert visibility, not count. See `docs/wiki/features/organization-logo-box.md`
- **Fees in the cart**: All customer-facing fee math imports from `lib/fees.ts` (`computeOrderFees` for carts/orders, `computeTierAllInPrice` for a single tier card). Never copy `FEE_CONFIG` into a page. Cart lines render through `components/CartLineItem.tsx` (price = dotted-underline disclosure + breakdown accordion; down caret rendered only while open, never a closed-state caret) with `components/ExpandCollapseAll.tsx` on the heading row; open state lives in the page and is shared by desktop + mobile views. See `docs/wiki/features/cart-line-item-breakdown.md`
- **Org theme mode**: `BrandScope`'s `themeMode` prop forces light/dark/system on public org pages through `useThemeMode().setForced` → next-themes `forcedTheme`. Never call `setTheme` to force — it overwrites `localStorage.theme`. Types/options in `lib/theme.ts`; see `docs/wiki/features/organization-theme-mode.md`

## Auth in Frontend

```typescript
// Server component — get session
import { auth } from "@/auth"
const session = await auth()

// API call with auth — services/api.ts handles Bearer token injection
```
