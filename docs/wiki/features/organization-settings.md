# Organization Settings

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Organization settings manage business details and staff. Organizers can update their org name, EIN, and address. Staff management uses the OrganizationPerson model to add/remove team members and designate an account representative. Only one account rep per org is allowed, enforced by a partial unique index.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/api/routes/admin.js` | Settings API routes |
| `backend/src/services/OrganizationService.js` | Organization CRUD and business detail logic |
| `backend/src/services/OrganizationPersonService.js` | Staff management and account rep designation |
| `frontend/src/app/admin/settings/` | Settings UI |

## How It Works

1. Organizer navigates to `/admin/settings`.
2. Business details (org name, EIN, address) can be viewed and updated.
3. EIN is masked in all API responses (e.g., `***-**-1234`).
4. Staff members are managed via OrganizationPerson records — add, remove, or change roles.
5. Account representative designation is exclusive: only one person per org can hold the role, enforced by a partial unique index in the database.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/settings` | Retrieve organization settings |
| PUT | `/admin/settings` | Update organization business details |
| POST | `/admin/settings/staff` | Add a staff member |
| DELETE | `/admin/settings/staff/:id` | Remove a staff member |

## Gotchas

- DOB is stored for business verification purposes but is never exposed in list or create API responses, nor in logs.
- EIN is masked on read — the full value is never returned from the API.
- Only 1 account representative per organization is allowed (partial unique index enforces this).
- Settings access is org-scoped — organizers can only manage their own organization.

## Related Features

- [RBAC](rbac.md) — organizer role required for settings access.
- [Admin Dashboard](admin-dashboard.md) — org context shared with dashboard.
