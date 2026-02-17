# Contracts: Admin Area (004)

No new API contracts are required for this feature.

This is a **frontend-only restructuring** that consolidates existing admin pages under the `/admin` route. All backend API endpoints remain unchanged — the admin area consumes the same APIs as before, just from a different URL path.

## Existing APIs Consumed (No Changes)

The admin pages use the following existing API endpoints (documented in `docs/api/openapi.yaml`):

- **Events**: `GET/POST /api/events`, `GET/PUT/DELETE /api/events/:id`
- **Organizations**: `GET/POST /api/organizations`, `GET/PUT/DELETE /api/organizations/:id`
- **Venues**: `GET/POST /api/venues`, `GET/PUT/DELETE /api/venues/:id`
- **Users**: `GET /api/users`, `GET/PUT /api/users/:id`
- **Analytics**: `GET /api/analytics/*`
- **Tickets**: `GET /api/tickets`, `POST /api/tickets/scan`
- **Orders**: `GET /api/orders`

All endpoints continue to enforce RBAC independently via backend middleware.
