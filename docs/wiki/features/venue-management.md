# Venue Management

**Status:** Implemented
**Last Updated:** 2026-09-21

## Overview

Venues belong to organizations and are managed via org-scoped CRUD routes. Each venue has a name, address, timezone (IANA format), logo URL, and a public visibility flag. Logo upload is handled via multer middleware. Public venues are viewable at `/venues/[venueId]`. Venue timezone affects how event dates and times are displayed.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/VenueService.js` | Venue CRUD business logic |
| `backend/src/api/routes/venues.js` | Org-scoped venue API routes |
| `backend/src/middleware/logoUpload.js` | Multer middleware for logo file uploads |
| `frontend/src/app/venues/[venueId]/` | Public venue detail page |
| `frontend/src/app/admin/venues/page.tsx` | Admin › Venues: full form (slug, logo, public toggle) |
| `frontend/src/components/QuickVenueDialog.tsx` | Quick-add dialog on the event create/edit forms |

## How It Works

1. Venues are created and managed under an organization context (org-scoped routes).
2. Fields include name, address, timezone (IANA string), logoUrl, and isPublic flag.
3. Logo uploads go through multer middleware with file size limits.
4. Venues with `isPublic: true` are visible on the public `/venues/[venueId]` page.
5. The venue's timezone is used to correctly display event dates and times for that location.
6. The event create and edit forms carry a **+ New venue** action (and the empty state a *Create one* button) that opens `QuickVenueDialog` in place. It posts the same `POST /organizations/:orgId/venues` body (name, address, city, state, postal code, timezone; `isPublic: true`), then appends the venue to the select and picks it — no navigation, no refetch. Slug and logo stay on Admin › Venues. The dialog is rendered outside the event `<form>` because it is a form of its own. Covered by `frontend/e2e/admin-quick-venue.spec.ts`.

## Gotchas

- Venue timezone is critical for correct event time display — an incorrect timezone will show wrong times to attendees.
- Logo upload uses multer with file size limits; oversized uploads are rejected.
- The `isPublic` flag controls whether the venue page is accessible to unauthenticated users.
- Deleting a venue with associated events may require handling cascading references.

## Related Features

- [Org Switcher](org-switcher.md) — venue management is scoped to the currently selected organization.
- [Database Architecture](database-architecture.md) — Venue model defined in the shared Prisma schema.
