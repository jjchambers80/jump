# Frontend — Scoped Agent Instructions

Loads when agent touches `frontend/` files. For root-level commands and env vars, see [`../AGENTS.md`](../AGENTS.md).

## Routing Structure

```
app/
├── admin/           # Organizer/admin dashboard (session-protected)
├── events/          # Public event browsing + detail pages; [eventId]/apply/* application forms + status page (spec 011)
├── auth/            # Sign-in page
├── checkout/        # Cart + payment flow
├── confirmation/    # Post-purchase confirmation
├── orders/          # [orderId] detail (buyer session or staff) + lookup
├── venues/          # Venue pages
├── organizations/   # Public org page + [orgId]/account (buyer sign-in, orders, tickets, applications, applicant business profile)
├── api/auth/        # Auth.js API route handler (staff)
└── api/buyer/       # Buyer session proxies: request/verify/logout/me/* (httpOnly jump_buyer cookie); me/applications*, me/applicant-profile[/photos] forward JSON — the photos route forwards multipart
```

## Key Files

- `auth.ts` — Auth.js v5 config (Google OAuth + magic link, JWT strategy, Prisma adapter). `auth.config.ts` is the edge-safe subset (providers, `trustHost`, HS256 cookie codec from `lib/authJwt.ts`) that `src/middleware.ts` also uses
- `services/api.ts` — All backend API calls go through here
- `lib/addOns.ts` — Add-on types and helpers (spec 012): `offeredAddOns` (which add-ons a cart's tiers offer), `addOnAllInPrice`, `parseAddOnLines`. `components/AddOnPicker.tsx` renders the steppers; the event page carries lines to checkout as `?addOns=[{addOnId,quantity}]`. Admin section: `app/admin/events/[eventId]/edit/AddOnsSection.tsx` (saves through the API immediately, outside the event form). Applications (phase 2): the apply form renders `AddOnPicker` for the chosen tier's `addOns` (per-unit `applicantPays` from the API, total line is an estimate — the server allocates fees across lines), submits `addOns` in the payload; admin detail shows lines + `EditAddOnsDialog` (gated by `addOnsEditable`), the list has an `addOn` filter (saved views carry it) and column, the form editor's tier edit row sets "Add-ons offered" via `setTierAddOns`
- `lib/applications.ts` — Shared types, labels and helpers for spec 011; admin calls live in `app/admin/events/[eventId]/applications/useApplicationsApi.ts` (also `useTemplatesApi` for Settings › Applications). Admin list saved views are `localStorage` (`jump.applications.views.<eventId>`), never server state
- `components/` — Shared React components
- `lib/` — Utilities and helpers (`lib/color.ts` — WCAG contrast + brand CSS vars; `lib/fees.ts` — all-in fee math mirroring backend `FeeService`; `lib/buyerSession.ts` — server-only buyer cookie + backend proxy, signs the client IP for the backend rate limiter)

## Patterns

- **Server vs Client**: Default to server components. Add `'use client'` only when needed for interactivity
- **Data fetching**: Server components fetch directly; client components call `services/api.ts`
- **Admin pages**: `src/middleware.ts` redirects unauthenticated `/admin*` to `/auth/signin?callbackUrl=…` on the edge; pages keep `AdminRoute`/`ProtectedRoute` as the second layer. Add new admin pages to the sidebar navigation
- **Search params**: Always wrap `useSearchParams()` consumers in `<Suspense fallback={...}>`
- **Tenant hosts**: `src/middleware.ts` rewrites requests on an organization's custom domain (`/` → org page, `/account` → buyer account, admin/auth → 404) using `lib/storefrontHost.ts`. Pages receive the same `params.orgId` as on the platform host, so no page needs host awareness. Platform hosts come from `NEXT_PUBLIC_PLATFORM_HOSTS` / `AUTH_URL`
- **Buyer auth**: never call `/buyer/*` on the backend from the browser and never use Auth.js for buyers. Go through `app/api/buyer/*` route handlers so the session stays in the httpOnly cookie. There is no `/my-tickets`; buyers self-serve on `/organizations/[orgId]/account`. See `docs/wiki/features/buyer-accounts.md`
- **Org switcher**: `OrgContext` publishes the selection with `setActiveOrganizationId` *synchronously inside its setter* (child effects run before provider effects — never move this into a `useEffect`); `services/api.ts` sends it as `X-Jump-Org`. Org-scoped pages fetch only after `useOrg().loading` is false and refetch on `selectedOrgId` change, not on `loading` toggles (`refresh()` flips it). See `docs/wiki/features/org-switcher.md`
- **Brand colors**: On public organization/venue/event pages and `EventCard`, use the `brand` tokens (`bg-brand`, `hover:bg-brand-hover`, `text-brand-fg`, `text-brand-link`) instead of raw `blue-600`/`indigo-400` classes. Wrap the page root in `<BrandScope color={…} themeMode={…}>`. Color math lives in `lib/color.ts`; see `docs/wiki/features/organization-branding.md`
- **Settings editors**: Settings › General is read-only summary rows (`app/admin/settings/SummaryRow.tsx`) that open modals built on `app/admin/settings/SettingsDialog.tsx` (focus trap, Escape/backdrop, discard confirm, Cancel/Save header). New settings sections should reuse both rather than inline forms; each dialog PATCHes only its own fields. See `docs/wiki/features/organization-settings.md`. Settings › Tax (`app/admin/settings/tax/`) follows the Domains pattern: a `useTaxApi` hook that appends `?organizationId=` for SYSTEM_ADMIN, table rows as buttons with per-row refs for focus return, and a plain confirm dialog (not `SettingsDialog`) for the tax-inclusive switch — see `docs/wiki/features/tax-settings.md`. Settings › Payments (`app/admin/settings/payments/`) follows the Tax pattern (`usePaymentsApi`, `SettingsDialog` for the statement name, per-row `role="switch"` toggles with optimistic rollback on the methods sub-page) — see `docs/wiki/features/payments-settings.md`
- **Public org logo**: `components/LogoBox.tsx` (square box, blurred backdrop for non-square logos) is only for the mobile cover on `/organizations/[orgId]`; desktop uses a plain `<img>`. Both are in the DOM at once, so tests assert visibility, not count. See `docs/wiki/features/organization-logo-box.md`
- **Fees in the cart**: All customer-facing fee math imports from `lib/fees.ts` (`computeOrderFees` for carts/orders, `computeTierAllInPrice` for a single tier card; pass `event.taxInclusivePricing` as the third argument so tax-inclusive orgs price correctly). Never copy `FEE_CONFIG` into a page. Cart lines render through `components/CartLineItem.tsx` (price = dotted-underline disclosure + breakdown accordion; down caret rendered only while open, never a closed-state caret) with `components/ExpandCollapseAll.tsx` on the heading row; open state lives in the page and is shared by desktop + mobile views. See `docs/wiki/features/cart-line-item-breakdown.md`
- **Org theme mode**: `BrandScope`'s `themeMode` prop forces light/dark/system on public org pages through `useThemeMode().setForced` → next-themes `forcedTheme`. Never call `setTheme` to force — it overwrites `localStorage.theme`. Types/options in `lib/theme.ts`; see `docs/wiki/features/organization-theme-mode.md`

## Auth in Frontend

```typescript
// Server component — get session
import { auth } from "@/auth"
const session = await auth()

// API call with auth — services/api.ts handles Bearer token injection
```
