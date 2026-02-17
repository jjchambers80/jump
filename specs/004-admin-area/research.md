# Research: Admin Area (004)

**Date**: 2025-02-15 | **Branch**: `004-admin-area`

## R1: Next.js App Router Layout Pattern for Role Guarding

**Decision**: Use a **server component** `layout.tsx` that renders a `'use client'` guard wrapper around `{children}`.

**Rationale**:

- Keeps layout as a server component (can export `metadata` if needed later).
- The layout mounts once and persists across all client-side navigations within `/admin/*` — the `useSession` check runs once on mount, subsequent page swaps don't re-trigger the guard flash.
- `useSession` requires `<SessionProvider>` higher in the tree — already satisfied by root `layout.tsx`.
- On hard refresh, `useSession` starts with `status: 'loading'` briefly. This is acceptable and is the standard Auth.js pattern.

**Alternatives considered**:

- **Option B**: Mark `layout.tsx` itself as `'use client'`. Works but loses server component benefits (metadata export, RSC). Rejected as less idiomatic.
- **Server-side auth() in layout**: Could call `auth()` from `auth.ts` in a server component layout. Would avoid loading flash but adds a server roundtrip on every navigation. The project's existing pattern is client-side with `AdminRoute` — sticking with it for consistency.

---

## R2: Redirect Pattern for `/admin` Root Page

**Decision**: Use `redirect('/admin/dashboard')` from `next/navigation` in a server component `page.tsx`.

**Rationale**:

- Server-side redirect (HTTP 307) — no JavaScript needed, no flash of content, no client-side hydration.
- This is the Next.js-recommended pattern for pages that only redirect.
- Simpler than a client component with `useRouter().push()` which would require mounting, hydrating, then redirecting.

**Alternatives considered**:

- **Client-side `useRouter`**: Requires hydration, creates a brief flash. Rejected.
- **Middleware rewrite**: Could rewrite `/admin` to `/admin/dashboard` in edge middleware. Rejected — adds complexity to middleware and obscures the routing intent.

---

## R3: Edge Middleware vs. Client-Side Authorization

**Decision**: Keep the current split — edge middleware for **authentication** (is user logged in?), `AdminRoute` client component for **authorization** (does user have ADMIN or ORGANIZER role?).

**Rationale**:

- This is the Auth.js v5 officially recommended two-file split pattern (`auth.config.ts` for edge, `auth.ts` for server).
- Edge middleware uses `auth.config.ts` which has no Prisma adapter — cannot query DB for role.
- The JWT **does** contain `role` (set by `jwt` callback in `auth.ts`), so in theory edge middleware could read `req.auth.role`. However, `auth.config.ts` doesn't have the `jwt` callback that populates it, and adding it would create inconsistency between the two auth configs.
- Backend API routes independently enforce RBAC — the client-side check is defense-in-depth, not the sole enforcement layer.

**Alternatives considered**:

- **Add `jwt` callback to `auth.config.ts`**: Could copy `role` through to edge middleware. Rejected — adds maintenance burden of keeping two jwt callbacks in sync, and role in JWT could be stale after role changes.
- **Server component auth() check**: Could replace `AdminRoute` with server-side `auth()` call. Would work but breaks the project's established client-component pattern. Rejected for consistency.

---

## R4: Page Migration Strategy (Dashboard → Admin)

**Decision**: Copy/move files from `/dashboard/*` to `/admin/*`, standardize all imports on `@/` path aliases, and remove per-page `<AdminRoute>` wrappers since the admin layout handles guarding centrally.

**Rationale**:

- The admin layout wraps all children in `<AdminRoute>`, so individual pages no longer need their own guard wrapper — this is one of the biggest wins of the layout approach.
- `@/` path aliases (already configured in `tsconfig.json` as `"@/*": ["./src/*"]`) are invariant to directory depth — prevents broken relative imports when pages are nested at varying depths (e.g., `/admin/events/[eventId]/analytics/page.tsx`).
- Clean cutover: remove `/dashboard` and `/scan` routes entirely. No backward-compatibility redirects needed (this is an internal admin tool, not a public-facing URL).

**Alternatives considered**:

- **Keep old routes as redirects**: Adds unnecessary complexity for an internal admin tool. Rejected.
- **Symlinks or re-exports**: Fragile, doesn't solve the import path problem. Rejected.

---

## R5: Sidebar Navigation Component

**Decision**: Build a lightweight sidebar within `admin/layout.tsx` using Tailwind CSS utility classes. No new component library needed.

**Rationale**:

- The project already uses Tailwind CSS extensively — adding a sidebar with `flex`, `w-64`, `min-h-screen` patterns is trivial.
- The sidebar contains ~8 navigation links — simple enough to be inline in the layout, though extracting to a separate component (`AdminSidebar.tsx`) is cleaner for testing and maintenance.
- Active link highlighting uses `usePathname()` from `next/navigation` to match the current route.

**Alternatives considered**:

- **Headless UI / Radix**: Overkill for a static sidebar nav. Rejected.
- **Keep sidebar inline in layout**: Works for a small nav, but extracting to a component aids testability. Slight preference for extracted component.

---

## R6: Navbar Simplification

**Decision**: Replace the 6 individual admin links in `Navbar.tsx` with a single "Admin" link pointing to `/admin`. Extend `isAdmin` check to include `ORGANIZER` role alongside `ADMIN`.

**Rationale**:

- Simplifies the public navigation — end users (CUSTOMER role) should not see admin clutter.
- The admin sidebar provides internal navigation once inside `/admin` — no need to expose individual admin pages in the top-level nav.
- `isAdmin` currently checks `role === 'ADMIN'` — needs `|| role === 'ORGANIZER'`.

**Alternatives considered**:

- **Show different link sets by role**: ADMIN sees all links, ORGANIZER sees subset. Rejected — overcomplicates Navbar for marginal benefit. Both roles get "Admin" link; the admin area itself can differentiate content if needed later.
- **Remove Navbar entirely in admin area**: Rejected — users need a way to navigate back to the public site.

---

## Summary of Resolved Items

| #   | Topic                | Decision                                                          | Risk |
| --- | -------------------- | ----------------------------------------------------------------- | ---- |
| R1  | Layout pattern       | Server component layout → client guard wrapper                    | Low  |
| R2  | Root redirect        | `redirect()` server-side                                          | None |
| R3  | Auth vs. authz split | Edge middleware = auth, AdminRoute = authz                        | None |
| R4  | Page migration       | Copy/move + `@/` aliases + remove per-page guards                 | Low  |
| R5  | Sidebar              | Extracted component with Tailwind, `usePathname` for active state | None |
| R6  | Navbar               | Single "Admin" link, extend `isAdmin` to include ORGANIZER        | None |

All NEEDS CLARIFICATION items have been resolved. No new dependencies required.
