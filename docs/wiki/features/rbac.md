# Role-Based Access Control (RBAC)

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Three roles govern access: CUSTOMER, ORGANIZER, and ADMIN. A middleware chain of `requireAuth` (JWT verification) followed by `requireRole` enforces authorization on backend routes. The frontend uses `session.user.role` for UI gating.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/middleware/rbac.js` | Role-checking middleware (`requireRole`) |
| `backend/src/middleware/auth.js` | JWT verification middleware (`requireAuth`) |

## How It Works

1. `requireAuth` verifies the JWT from the `Authorization: Bearer` header and attaches user context to the request.
2. `requireRole('ORGANIZER'|'ADMIN')` checks `req.user.role` against the allowed roles.
3. Routes are protected by chaining both middlewares: `requireAuth, requireRole('ADMIN')`.

### Role Permissions

| Role | Access |
|------|--------|
| **ADMIN** | `/users` CRUD, `/organizations` CRUD, all organizer capabilities |
| **ORGANIZER** | Org-scoped event/venue management, settings, dashboard |
| **CUSTOMER** | Order history, tickets |
| **Public (unauthenticated)** | Event browsing, guest checkout |

## Gotchas

- Organizer access is org-scoped — organizers can only manage resources belonging to their own organization.
- Frontend role gating is for UX only; backend middleware is the actual enforcement layer.
- `requireRole` must always follow `requireAuth` in the middleware chain.

## Related Features

- [Auth.js Integration](authjs-integration.md) — provides the JWT and session that RBAC depends on.
- [Admin Dashboard](admin-dashboard.md) — protected by ORGANIZER/ADMIN role requirement.
- [Organization Settings](organization-settings.md) — org-scoped access for organizers.
