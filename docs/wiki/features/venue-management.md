# Venue Management

**Status:** Implemented
**Last Updated:** 2026-10-10

## Overview

Venues belong to organizations and are managed via org-scoped CRUD routes. Each venue has a name, address, time zone, logo URL, and a public visibility flag. **The time zone is no longer typed in** — spec 033 derives it from the address and shows it as a line of text; see [Venue Time Zones](venue-time-zones.md). Logo upload is handled via multer middleware. Public venues are viewable at `/venues/[venueId]`. Venue timezone affects how event dates and times are displayed.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/VenueService.js` | Venue CRUD business logic |
| `backend/src/api/routes/venues.js` | Org-scoped venue API routes |
| `backend/src/middleware/logoUpload.js` | Multer middleware for logo file uploads |
| `frontend/src/app/venues/[venueId]/` | Public venue detail page |
| `frontend/src/app/admin/venues/page.tsx` | Admin › Venues list: cards, search + visibility filter in the URL (`?q=`, `?visibility=`) |
| `frontend/src/app/admin/venues/[venueId]/page.tsx` | Venue Details: read-only hero, events at the venue, location / time zone / public page / record cards, delete |
| `frontend/src/app/admin/venues/VenueEditor.tsx` | The one venue form: `/admin/venues/new` and `/admin/venues/[venueId]/edit` |
| `frontend/src/lib/venues.ts` | Admin venue types, address / public path / maps link helpers |
| `frontend/src/components/VenueFlyout.tsx` | Quick-add flyout on the event create/edit forms |

## How It Works

Admin pages follow the Events path (spec 037): **list → read-only Details → editor**.

- **List** (`/admin/venues`): one card per venue — logo or monogram, name (the card's link to Details), Public/Private badge, street and city line, time zone, event count, and icon buttons for the public page and the editor. Search (name, street, city, state, ZIP) and the All / Public / Private filter answer at once and are mirrored into the URL after a short pause by one writer, so admin search's *View all* (`/admin/venues?q=`) lands filtered.
- **Details** (`/admin/venues/:id`): writes nothing except **Delete venue**. `GET /organizations/:orgId/venues/:id` returns the venue plus every event held there (`VenueService.getVenueDetails`), so one request feeds the hero numbers (events, upcoming, next event, time zone) and the **Events at this venue** list, split into Upcoming and Past and cancelled, dated on the venue's clock. Each aside card links to the editor section that owns it (`#venue-location`, `#venue-visibility`). Delete is disabled while events use the venue (the backend refuses with 409 anyway) and confirms in a dialog.
- **Editor** (`/admin/venues/new`, `/admin/venues/:id/edit`): `EventFormShell` / `FormCard` / `EventSaveCard` from the event editor — Basics, Location (with the derived time zone), Logo; the public-page switch and the save card in the aside; a sticky save bar below `xl`. Nothing saves until Save, including removing the logo; a dirty form warns on leave. Saving lands on Details with a notice.

1. Venues are created and managed under an organization context (org-scoped routes).
2. Fields include name, address, `country` / `timezone` / `timezoneSource` (derived, see [Venue Time Zones](venue-time-zones.md)), logoUrl, and isPublic flag.
3. Logo uploads go through multer middleware with file size limits.
4. Venues with `isPublic: true` are visible on the public `/venues/[venueId]` page.
5. The venue's time zone is what every event date is rendered in — storefront, checkout, ticket, confirmation, emails and admin alike.
6. The event create and edit forms expose venue creation as the last option of the **Venue** select, **+ Add new venue…**. Choosing it opens `VenueFlyout` (`frontend/src/components/VenueFlyout.tsx`), a slide-over panel — full screen on phones, a right-hand panel from `sm` up — carrying every field of the venue editor: name, URL slug, street address, city, state, postal code, the derived **Times** line, the public-page toggle and the logo uploader. Save posts `POST /organizations/:orgId/venues`, uploads the logo when one was chosen, then closes the flyout back onto the event form with the new venue appended to the select and selected — no navigation, no refetch. A 409 renders as a slug error in the flyout; a logo upload that fails still selects the venue and surfaces a warning on the event page. The flyout renders outside the event `<form>` because it is a form of its own. Covered by `frontend/e2e/admin-venue-flyout.spec.ts`.

## Gotchas

- The venue time zone is critical for correct event time display — a wrong zone shows wrong times to attendees and prints them on tickets. It is derived from the address and always visible for that reason; an organizer can override it with **Change** (which pins it as `MANUAL`, immune to later address edits).
- Logo upload uses multer with file size limits; oversized uploads are rejected.
- The `isPublic` flag controls whether the venue page is accessible to unauthenticated users.
- Deleting a venue with associated events may require handling cascading references.

## Related Features

- [Org Switcher](org-switcher.md) — venue management is scoped to the currently selected organization.
- [Database Architecture](database-architecture.md) — Venue model defined in the shared Prisma schema.
