# Venue Management

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Venues belong to organizations and are managed via org-scoped CRUD routes. Each venue has a name, address, timezone (IANA format), logo URL, and a public visibility flag. Logo upload is handled via multer middleware. Public venues are viewable at `/venues/[venueId]`. Venue timezone affects how event dates and times are displayed.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/VenueService.js` | Venue CRUD business logic |
| `backend/src/api/routes/venues.js` | Org-scoped venue API routes |
| `backend/src/middleware/logoUpload.js` | Multer middleware for logo file uploads |
| `frontend/src/app/venues/[venueId]/` | Public venue detail page |

## How It Works

1. Venues are created and managed under an organization context (org-scoped routes).
2. Fields include name, address, timezone (IANA string), logoUrl, and isPublic flag.
3. Logo uploads go through multer middleware with file size limits.
4. Venues with `isPublic: true` are visible on the public `/venues/[venueId]` page.
5. The venue's timezone is used to correctly display event dates and times for that location.

## Gotchas

- Venue timezone is critical for correct event time display — an incorrect timezone will show wrong times to attendees.
- Logo upload uses multer with file size limits; oversized uploads are rejected.
- The `isPublic` flag controls whether the venue page is accessible to unauthenticated users.
- Deleting a venue with associated events may require handling cascading references.

## Related Features

- [Org Switcher](org-switcher.md) — venue management is scoped to the currently selected organization.
- [Database Architecture](database-architecture.md) — Venue model defined in the shared Prisma schema.
