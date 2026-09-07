# Handoff: Settings > General fields

Date: 2026-09-07
Repository: `/Users/jj/Projects/jump`
Branch: `005-create-event-rbac`
Source session: @session:personal/20260904_163706_69284f

## User request

Make the fields appear on Settings > General for the logged-in `admin@jump.events` account, and preserve the work from the source session.

## Source-session context

The source session implemented the Business Details People feature from:

`/.hermes/plans/2026-09-04_162042-business-details-people.md`

That work added:

- Business Details display and edit flow under `/admin/settings`.
- Organization-scoped People list/add/delete endpoints.
- Prisma `OrganizationPerson` model and migration.
- Add Person dialog with date-only DOB handling and representative assignment.
- RBAC, tenant isolation, validation, privacy-safe responses/logging, and tests.

The source session reported its feature checks as passing, including Prisma validation/generation, People unit/contract tests, and the admin-settings Playwright suite. It did not identify the environment mismatch that prevented a real seeded admin session from seeing the fields.

## Root cause

The frontend Auth.js process and backend API were using different PostgreSQL configurations:

- `frontend/.env.local`: PostgreSQL port `5432`, with credentials that were not accepted by the API database
- `backend/.env` and `packages/db/.env`: PostgreSQL port `5433`, with the working database credentials

The browser session was correctly signed in as `admin@jump.events`, but Auth.js issued a token for the admin row in the frontend database. The backend looked up that token's user ID in its own database, could not find an organization assignment, and returned `404 No organization is assigned to this user`. The UI then rendered its intended no-organization state instead of the business fields.

This was not an authorization/RBAC defect. The backend database contains `admin@jump.events` with role `ADMIN` and an assigned organization.

## Change made

Updated only the local frontend database target:

`frontend/.env.local`

Changed the `DATABASE_URL` to exactly match the backend database configuration, including the port and credentials. The credential value was copied locally without printing or exposing it. No application secret was changed.

The frontend dev server was restarted so Auth.js loaded the corrected environment.

## Verification

- Backend health: `GET http://localhost:3002/health` returned `{"status":"ok", ...}`.
- Frontend route: `GET http://localhost:3001/admin/settings` returned HTTP success.
- Before the fix, the live browser showed `No organization assigned` despite the correct email.
- The stale browser session was signed out and re-authenticated through the non-secret development sign-in flow.
- The database query confirmed the backend DB row for `admin@jump.events` has role `ADMIN` and a non-null organization.
- After the configuration change, the frontend-configured database also resolves `admin@jump.events` to a user with a non-null organization.
- A live authenticated request to `GET http://localhost:3002/admin/settings/business-details` returned HTTP 200 with the `Jump Events Co.` business-details payload.
- After the credential alignment, the development email sign-in completed successfully and redirected to `/admin/dashboard`.
- The authenticated browser then rendered the Settings > General card for `Jump Events Co.` with all business-detail fields visible.

## Current manual verification

Open:

`http://localhost:3001/admin/settings`

If an existing browser tab still shows the old state, hard-refresh or sign out and use `admin@jump.events` with `Dev Sign-In (instant)`. The browser must obtain a new Auth.js session after the frontend restart.

Expected result: Settings > General shows the organization business-details card and its fields. Click `Edit` to see the editable fields and the People section.

## Important working-tree note

The branch already had substantial unrelated modified/untracked work before this handoff. Do not reset, clean, or commit that work without explicit instruction. The source session also intentionally created many feature files and did not create a commit.

## Coding-model note

The user requested DeepSeek 4 for coding tasks because OpenAI credits are unavailable. This handoff records that preference; model/provider selection is controlled by the agent runtime rather than by this repository change.
