# Multi-Tenant Architecture

**Status:** Active
**Last Updated:** 2026-09-13

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

1. **Organization** is created by an organizer through the self-serve `/signup` flow (spec 022 — see [Organization Onboarding](organization-onboarding.md)) or by SYSTEM_ADMIN via `POST /organizations`. An organization created by `/signup` is **pending** (`onboardingCompletedAt IS NULL`) until the flow finishes and is hidden from `GET /organizations` meanwhile; direct creates default to onboarded. The creator becomes an ADMIN `OrganizationMember`. Each organization has at most one `PlatformCustomer` — its relationship with Jump (owner, plan, Stripe Billing customer, survey answers), which is a different thing from its `Contact` rows (its own buyers and applicants). Fields: `name`, `slug` (unique URL-safe store handle, generated from the name with `-2`, `-3`… on clashes, stable across renames, editable via `PATCH /organizations/:id`; migration `20260926000000_organization_slug` backfilled existing rows), `status`, plus business details (address, EIN, etc.).
2. **Venues** are created under an org via `POST /organizations/:orgId/venues` with address, city, state, postalCode, timezone.
3. **Events** are created under an org but linked to a Venue (`event.venueId`). Org ownership is resolved transitively: `event.venue.organizationId`.
4. **OrganizationPerson** records track business reps. When `isAccountRepresentative` is set, a transaction first clears the flag on all existing reps, then creates the new one. A Prisma `P2002` error (unique constraint) on concurrent writes throws `ConflictError`.
5. **Business details** (EIN) are serialized with masking: only last 4 digits exposed via `einMasked` field (`--***XXXX`).
6. **User-org binding**: staff belong to organizations through `OrganizationMember(userId, organizationId, role)`; one user can hold several. `resolveActiveMembership` picks the active one (`X-Jump-Org` header from the admin org switcher, else the JWT `organizationId` claim, if either is a real membership; else the oldest). Settings routes resolve a concrete org with `activeOrgFor(req)` in `routes/admin.js` and pass it to the services — see [Org Switcher](org-switcher.md). `User.organizationId` was dropped in migration `20260913130000`. Buyers are `Contact` rows scoped per organization — see [Tenant Identity](tenant-identity.md).

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/organizations` | Admin | Create organization (already onboarded; creator becomes ADMIN member) |
| POST | `/signup` … | Any session | Self-serve onboarding — see [Organization Onboarding](organization-onboarding.md) |
| GET | `/organizations` | Organizer+ | Completed organizations: all for SYSTEM_ADMIN (`?includePending=1` adds pending ones), else the caller's memberships |
| GET | `/organizations/:id` | Admin | Get organization detail |
| PATCH | `/organizations/:id` | Admin | Update organization |

## Gotchas

- **Event org is resolved transitively** via `venue.organizationId`, not stored directly on the Event model. All org-scoped event queries use `where: { venue: { organizationId: orgId } }`.
- **OrganizationPerson DOB** is privacy-sensitive. Summary serialization intentionally omits it (only `id`, `firstName`, `lastName`, `isAccountRepresentative` returned).
- **Max 1 account rep per org** enforced by a transaction that clears existing reps before creating the new one. Concurrent requests can hit `P2002` and should retry.
- **EIN is never returned raw** -- only `hasEin` (boolean) and `einMasked` (last 4) are exposed.
- **Check-in scan/redeem is org-scoped** (`scannerOrgScope` in `middleware/scannerAuth.js`): staff see only their own organization's tickets; hardware readers with `X-Scanner-Key` are unscoped; SYSTEM_ADMIN follows `X-Jump-Org` and is unscoped only without it.
- **Org-param routes use `requireOrgMembership(param)`** from `middleware/orgScope.js` (SYSTEM_ADMIN bypasses). Do not reintroduce per-file `verifyOrgOwnership` helpers or read `User.organizationId`.

## Related Features

- [Event Management](event-management.md) -- events created under org-scoped routes
- [Venue Management](venue-management.md) -- venues belong to organizations
- [Organization Settings](organization-settings.md) -- business details and staff
