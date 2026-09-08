# User Management

**Status**: Implemented
**Last Updated**: 2026-09-07

## Overview

Admin users can manage all user accounts in the system — view users, change roles, and toggle account status. Accessible only to ADMIN role users at `/admin/users`.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/api/routes/users.js` | User management endpoints |
| `backend/src/services/UserService.js` | User CRUD, role updates, pagination |
| `backend/src/middleware/rbac.js` | Admin-only access enforcement |
| `frontend/src/app/admin/users/page.tsx` | User management UI |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users` | Admin | List all users with pagination and filtering |
| PATCH | `/users/:id` | Admin | Update user role or active status |

## How It Works

1. Admin navigates to `/admin/users`
2. User list loaded with role/status filters and pagination
3. Admin can change a user's role (CUSTOMER → ORGANIZER → ADMIN)
4. Admin can deactivate/reactivate accounts via `isActive` flag
5. Soft delete via `deletedAt` timestamp (preserves audit trail)

## Gotchas

- Admin-only — Organizers cannot manage users
- Role changes take effect on next JWT refresh (existing tokens retain old role until expiry)
- Users with `organizationId` are org-scoped; changing role may require org assignment

## Related Features

- [RBAC](rbac.md) — Role definitions and middleware
- [Auth.js Integration](authjs-integration.md) — How users authenticate
