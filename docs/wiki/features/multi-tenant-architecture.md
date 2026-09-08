# Multi-Tenant Architecture

**Status:** Active
**Last Updated:** 2026-09-07

## Overview

Organizations are the top-level tenant boundary in Jump. Each Organization owns Venues, which in turn host Events. All organizer-facing routes are scoped under `/organizations/:orgId/*`. The OrganizationPerson model tracks business representatives (with privacy-sensitive DOB), and a partial unique index ensures at most one account representative per org.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/OrganizationService.js` | Org CRUD, business detail serialization (EIN masking) |
| `backend/src/services/OrganizationPersonService.js` | Business rep management, account representative constraint |
| `backend/src/services/VenueService.js` | Venue CRUD scoped to organizations |
| `backend/src/api/routes/organizations.js` | Admin-only org endpoints (POST/GET/PATCH) |
| `backend/src/api/routes/venues.js` | Org-scoped venue endpoints |

## How It Works

1. **Organization** is created by an admin via `POST /organizations`. Fields: `name`, `status`, plus business details (address, EIN, etc.).
2. **Venues** are created under an org via `POST /organizations/:orgId/venues` with address, city, state, postalCode, timezone.
3. **Events** are created under an org but linked to a Venue (`event.venueId`). Org ownership is resolved transitively: `event.venue.organizationId`.
4. **OrganizationPerson** records track business reps. When `isAccountRepresentative` is set, a transaction first clears the flag on all existing reps, then creates the new one. A Prisma `P2002` error (unique constraint) on concurrent writes throws `ConflictError`.
5. **Business details** (EIN) are serialized with masking: only last 4 digits exposed via `einMasked` field (`--***XXXX`).
6. **User-org binding**: Users have an `organizationId` FK. `getBusinessDetailsForUser` and `updateBusinessDetailsForUser` operate through the user's org.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/organizations` | Admin | Create organization |
| GET | `/organizations` | Admin | List all organizations |
| GET | `/organizations/:id` | Admin | Get organization detail |
| PATCH | `/organizations/:id` | Admin | Update organization |

## Gotchas

- **Event org is resolved transitively** via `venue.organizationId`, not stored directly on the Event model. All org-scoped event queries use `where: { venue: { organizationId: orgId } }`.
- **OrganizationPerson DOB** is privacy-sensitive. Summary serialization intentionally omits it (only `id`, `firstName`, `lastName`, `isAccountRepresentative` returned).
- **Max 1 account rep per org** enforced by a transaction that clears existing reps before creating the new one. Concurrent requests can hit `P2002` and should retry.
- **EIN is never returned raw** -- only `hasEin` (boolean) and `einMasked` (last 4) are exposed.

## Related Features

- [Event Management](event-management.md) -- events created under org-scoped routes
- [Venue Management](venue-management.md) -- venues belong to organizations
- [Organization Settings](organization-settings.md) -- business details and staff
