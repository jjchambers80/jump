# ADR: Admin Layout Pattern

**Status**: Accepted  
**Date**: 2025-01-15  
**Spec**: 004-admin-area

## Context

We needed to consolidate admin-related pages (previously scattered under `/dashboard/*` and `/scan`) into a unified `/admin/*` route with consistent navigation, role-based access control, and responsive design.

Key decisions were required around:

1. How to implement route-level authorization (server vs client)
2. Layout structure (shared sidebar vs per-page)
3. Where to enforce RBAC (edge middleware vs component-level)

## Decision

### Nested Layout with Client-Side Guard (R1)

We use Next.js App Router nested layouts:

```
admin/
  layout.tsx          ← Server component (metadata only)
  AdminLayoutClient.tsx ← Client component (AdminRoute + sidebar)
  page.tsx            ← Server redirect to /admin/dashboard
  dashboard/page.tsx
  events/page.tsx
  ...
```

**Why client-side guard**: Next.js App Router `layout.tsx` does not re-execute on client-side navigation between child routes. A server-side `redirect()` in layout would only run on hard refresh, not SPA navigations. The `AdminRoute` client component correctly intercepts every render.

### Two-Layer Auth Strategy (R3)

1. **Edge middleware** (`middleware.ts`): Handles authentication — redirects unauthenticated users to `/auth/signin`. Uses `auth.config.ts` (edge-safe, no Prisma).

2. **AdminRoute component**: Handles authorization — checks user role against `ALLOWED_ROLES = ['ADMIN', 'ORGANIZER']`. Shows 403 for unauthorized roles.

This separation follows Next.js best practices: edge middleware for fast auth checks, component-level for role-based access that needs session data.

### Server Redirect for `/admin` (R2)

The `/admin` route uses `redirect('/admin/dashboard')` in a server component. This provides an instant redirect without loading the admin layout, ensuring users always land on a content-rich page.

### Extracted Sidebar Component (R5)

`AdminSidebar` is a standalone component with:

- Role-aware navigation (items can specify `roles: ['ADMIN']` to restrict visibility)
- Active state highlighting via `usePathname()`
- Mobile overlay pattern with backdrop + slide animation
- Close-on-navigate behavior for mobile

### Single Navbar Link (R6)

The public `Navbar` replaces 6 individual admin links (Dashboard, Orgs, Venues, Events, Analytics, Scan) with a single "Admin" link. This:

- Reduces navbar clutter
- Works for both ADMIN and ORGANIZER roles
- Highlights when user is in the admin area (`/admin/*`)

## Consequences

### Positive

- Consistent admin UX with persistent sidebar across all admin pages
- Clear separation of authentication (edge) and authorization (component)
- Role-based sidebar filtering is declarative and extensible
- Mobile-responsive out of the box
- Old routes (`/dashboard/*`, `/scan`) cleanly removed

### Negative

- Client-side guard means brief loading spinner on initial admin page load
- AdminRoute must be a client component, so the layout wrapper cannot be a pure server component
- Adding new admin pages requires both a page file and a sidebar entry

### Neutral

- No database schema changes required
- No new API endpoints needed
- Existing page components reused with minimal modifications (AdminRoute wrapper removal, import alias updates)

## Alternatives Considered

1. **Server-only layout guard**: Rejected because Next.js layout.tsx doesn't re-run on client navigations
2. **Per-page AdminRoute wrapping**: Original pattern, replaced with layout-level wrapping for DRY
3. **Middleware-only RBAC**: Rejected because edge middleware can't access Prisma for role lookups (edge runtime limitation)
