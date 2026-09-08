# Admin Dashboard

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

The admin dashboard provides real-time event statistics for organizers. A stats endpoint returns capacity, sales, redemption, and revenue data. The frontend polls this endpoint every 5 seconds. All data is scoped to the current organizer's organization. Separate analytics pages exist for org-wide and per-event views.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/api/routes/admin.js` | Dashboard stats and admin API routes |
| `frontend/src/app/admin/dashboard/` | Dashboard UI components |
| `frontend/src/app/admin/analytics/` | Org-wide analytics page |
| `frontend/src/app/admin/events/[eventId]/analytics` | Per-event analytics page |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/dashboard/stats` | Returns dashboard statistics for the organizer's org |

### Stats Response Fields

| Field | Description |
|-------|-------------|
| `totalCapacity` | Total ticket capacity across org events |
| `ticketsSold` | Number of tickets sold |
| `remainingCapacity` | Unsold tickets remaining |
| `ticketsRedeemed` | Number of tickets redeemed/scanned |
| `revenue` | Total revenue generated |

## How It Works

1. Organizer navigates to `/admin/dashboard`.
2. Frontend calls `GET /admin/dashboard/stats` with the org context.
3. Backend aggregates capacity, sales, redemption, and revenue data scoped to the organizer's organization.
4. Frontend re-fetches every 5 seconds via polling.
5. Analytics pages at `/admin/analytics` and `/admin/events/[eventId]/analytics` provide deeper breakdowns.

## Gotchas

- Uses polling, not websockets (see ADR-004).
- Stats are scoped to the organizer's organization — no cross-org visibility.
- 5-second polling interval is hardcoded on the frontend.

## Related Features

- [RBAC](rbac.md) — dashboard requires ORGANIZER or ADMIN role.
- [Organization Settings](organization-settings.md) — org context that scopes dashboard data.
