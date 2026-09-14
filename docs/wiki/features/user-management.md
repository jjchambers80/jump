# User Management

**Status**: Implemented
**Last Updated**: 2026-09-13

## Overview

Admin users can manage all user accounts in the system — view users, change roles, and toggle account status. Lives under **Settings › Users** at `/admin/settings/users` (the legacy `/admin/users` URL redirects there); the section link and page are limited to ADMIN / SYSTEM_ADMIN.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/api/routes/users.js` | User management endpoints |
| `backend/src/services/UserService.js` | User CRUD, role updates, pagination |
| `backend/src/middleware/rbac.js` | Admin-only access enforcement |
| `frontend/src/app/admin/settings/users/page.tsx` | User management UI (Settings › Users) |
| `frontend/src/app/admin/settings/SettingsNav.tsx` | Settings section list; hides Users for non-admin roles |
| `frontend/next.config.mjs` | Permanent redirect `/admin/users` → `/admin/settings/users` |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users` | Admin | List all users with pagination and filtering |
| PATCH | `/users/:id` | Admin | Update user role or active status |

## How It Works

1. Admin opens **Settings** from the sidebar footer and picks the **Users** section (`/admin/settings/users`)
2. User list loaded with role/status filters and pagination
3. Admin can change a user's role (CUSTOMER → ORGANIZER → ADMIN)
4. Admin can deactivate/reactivate accounts via `isActive` flag
5. Soft delete via `deletedAt` timestamp (preserves audit trail)

## Gotchas

- Admin-only — Organizers cannot manage users. `SettingsNav` hides the Users section for them and the page renders "Access Denied" on direct navigation
- Users is not in the main sidebar list (moved to Settings 2026-09-13); `AdminSidebar` no longer has a role-gated item
- Role changes take effect on next JWT refresh (existing tokens retain old role until expiry)
- Org affiliation is `OrganizationMember`, not `User.organizationId`. `PATCH /users/:id { organizationId }` replaces the user's memberships (null clears); memberships exist only for ADMIN/ORGANIZER and are cleared when a user is demoted to CUSTOMER or promoted to SYSTEM_ADMIN. Responses expose the first membership as `organizationId` / `organizationName` plus `organizations: [{ id, name, role }]`. See [Tenant Identity](tenant-identity.md)

## Related Features

- [RBAC](rbac.md) — Role definitions and middleware
- [Auth.js Integration](authjs-integration.md) — How users authenticate
