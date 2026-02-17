# Quickstart: Admin Area (004)

**Branch**: `004-admin-area`

## Prerequisites

- Node.js 18+
- pnpm (workspace package manager)
- Local development environment set up per `docs/development/setup.md`

## Setup

```bash
# 1. Switch to the feature branch
git checkout 004-admin-area

# 2. Install dependencies (from repo root)
pnpm install

# 3. Generate Prisma client (no schema changes, but ensures client is current)
cd packages/db && pnpm generate && cd ../..

# 4. Start the frontend dev server
cd frontend && pnpm dev
```

## Verify the Feature

### Manual Testing

1. **As ADMIN user**:
   - Navigate to `http://localhost:3000/admin`
   - Should redirect to `/admin/dashboard`
   - Sidebar should show all admin navigation links
   - All sub-pages should load correctly
   - Top Navbar should show single "Admin" link

2. **As ORGANIZER user**:
   - Navigate to `http://localhost:3000/admin`
   - Should redirect to `/admin/dashboard`
   - Sidebar should show all admin links EXCEPT "Users" (ADMIN-only)
   - Navbar should show single "Admin" link

3. **As CUSTOMER user**:
   - Navigate to `http://localhost:3000/admin`
   - Should see 403 Forbidden page
   - Navbar should NOT show "Admin" link

4. **As unauthenticated user**:
   - Navigate to `http://localhost:3000/admin`
   - Should redirect to `/auth/signin`

5. **Old routes removed**:
   - `/dashboard` should return 404
   - `/scan` should return 404

### Automated Testing

```bash
# Run Playwright E2E tests for admin area
cd frontend
npx playwright test e2e/admin-area.spec.ts

# Run all E2E tests to verify no regressions
npx playwright test
```

## Key Files

| File                                     | Purpose                                |
| ---------------------------------------- | -------------------------------------- |
| `frontend/src/app/admin/layout.tsx`      | Admin layout with sidebar + role guard |
| `frontend/src/app/admin/page.tsx`        | Redirect `/admin` → `/admin/dashboard` |
| `frontend/src/components/AdminRoute.tsx` | Role guard (ADMIN + ORGANIZER)         |
| `frontend/src/components/Navbar.tsx`     | Public nav with single "Admin" link    |
| `frontend/middleware.ts`                 | Edge auth protection for `/admin`      |

## Troubleshooting

| Problem                               | Solution                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 403 when logged in as ADMIN/ORGANIZER | Clear browser session, re-login. Check `AdminRoute.tsx` allows both roles.                      |
| Sidebar not showing                   | Verify `admin/layout.tsx` exists and is a valid React component.                                |
| Old `/dashboard` routes still work    | Verify the `dashboard/` directory under `app/` was deleted. Clear Next.js cache: `rm -rf .next` |
| Redirect loop at `/admin`             | Check `admin/page.tsx` redirects to `/admin/dashboard`, not `/admin`.                           |
