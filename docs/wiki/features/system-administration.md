# System Administration

**Status**: Implemented
**Last Updated**: 2026-10-09

## Overview

Users with the `SYSTEM_ADMIN` role get a platform-wide area at `/admin/system`. They open it from **System administration** in the user menu, and they land there after signing in. It has four pages:

- **Overview:** platform counts and recent signups.
- **Organizations:** search every organization, open one, suspend or reactivate it, and see its staff.
- **Users:** every user on the platform. Invite or promote system admins, and deactivate accounts.
- **Settings:** platform settings, moved here from the old Settings › Platform.

System admins must use two-step sign-in. Every change asks the person to confirm it's them first (step-up auth).

Built in PRs #376–#383 (2026-10-09). The plan was `~/.claude/plans/create-the-system-admin-compiled-bunny.md`.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/api/routes/adminSystem.js` | `/admin/system/*` router: `requireAuth` → `requireSystemAdmin`; mutations add `requireRecentAuth`. Never reads `X-Jump-Org` |
| `backend/src/services/SystemAdminService.js` | Overview, org detail + status, invite, user update; the self / last-admin guards; `SecurityEvent` writes |
| `backend/src/services/OrganizationService.js` | `listOrganizationsPage`, `getSystemOrganization` (paginated rows with member/venue counts, plan) |
| `backend/src/services/UserService.js` | `listUsers` with `q` + `isActive` filters; `updateUser(..., { tx })` |
| `backend/src/api/validators/systemAdminValidators.js` | List queries, status body, invite body, user PATCH body |
| `backend/src/services/EmailService.js` | `sendSystemAdminInvite`: Eventimus-branded, no org, says two-step is required |
| `backend/src/middleware/orgScope.js` | `OrganizationSuspendedError` (403 `ORGANIZATION_SUSPENDED`); memberships of suspended orgs grant nothing |
| `backend/src/middleware/storefrontGate.js` | `gateActiveOrg`, `activeOrgByApplicationParam`, `activeOrgByBuyer`: a suspension-only gate for application pay links |
| `backend/src/services/StorefrontPreferencesService.js` | `assertAccess` returns 404 for a suspended org. This is the choke point behind every `gateStorefront` route |
| `backend/src/services/DomainService.js` | `resolveHost` matches only ACTIVE orgs; `clearCache()` after a status change |
| `frontend/src/app/admin/system/layout.tsx` | Client guard: anyone who isn't SYSTEM_ADMIN goes to `/admin/dashboard`, and nothing renders until the role is known |
| `frontend/src/app/admin/system/page.tsx` | Overview tiles + recent signups |
| `frontend/src/app/admin/system/organizations/page.tsx`, `[id]/page.tsx`, `shared.tsx` | List (search, status filter, signup funnel, create), detail (members, Open, Suspend/Reactivate, Discard signup) |
| `frontend/src/app/admin/system/users/page.tsx`, `UserDialogs.tsx` | Users list, Invite dialog, per-row actions with confirm dialogs |
| `frontend/src/app/admin/system/settings/page.tsx` | Platform settings (agent access switch), formerly `/admin/settings/platform` |
| `frontend/src/components/AdminSidebar.tsx` | `systemNavItems`; system mode when the path starts with `/admin/system` (no setup guide, "Back to store admin") |
| `frontend/src/components/OrgSwitcher.tsx` | User menu: a keyboard menu (`role="menu"`, arrows, Escape returns focus); **System administration** item for SYSTEM_ADMIN; "Suspended" label on org rows |
| `frontend/src/middleware.ts` | `/auth/landing` → SYSTEM_ADMIN to `/admin`, others to `/events`. `/admin` → `/admin/system` or `/admin/dashboard` by role. `/admin/system*` is refused for anyone else |
| `frontend/src/app/auth/landing/page.tsx` | Fallback when the middleware didn't run; redirects to `/events` |
| `frontend/src/lib/sessionClaims.ts` | `isTwoStepSetupRequired(role, enabled, requiringMemberships)`; SYSTEM_ADMIN always requires two-step |
| `frontend/src/services/api.ts` | `systemAdminApi` |
| `frontend/next.config.mjs` | Redirects `/admin/settings/platform` → `/admin/system/settings` and `/admin/organizations` → `/admin/system/organizations` |

## Configuration

No new environment variables. Invite links use `FRONTEND_URL`, and invites share the `MEMBER_INVITE` rate-limit budget with Settings › Users.

To create the **first** system admin, update the database by hand (`User.role = 'SYSTEM_ADMIN'`). After that, system admins invite or promote others from Users.

## How It Works

1. **Entry and landing.** The sign-in page's default `callbackUrl` is `/auth/landing`. The edge middleware reads the fresh session cookie there:
   - A SYSTEM_ADMIN goes to `/admin`, and the middleware sends `/admin` on to `/admin/system`.
   - Everyone else goes to `/events`.
   - A two-step-pending SYSTEM_ADMIN goes through `/auth/two-step?callbackUrl=/admin` first.
   - An explicit `callbackUrl` always wins.
2. **Platform-wide, on purpose.** System pages call only `/admin/system/*` and `/admin/platform/*`, and neither router reads the active org. This is the one exception to "every admin page is one org at a time".
3. **Open an organization.** Open sets the active org through `OrgContext` (`X-Jump-Org`) and goes to `/admin/dashboard`. From there every org page works as usual. `resolveOrgScope` honours `X-Jump-Org` for SYSTEM_ADMIN without a membership.
4. **Suspend / reactivate.** `PATCH /admin/system/organizations/:id/status` writes `Organization.status` (`INACTIVE` = suspended), clears the domain cache and records `ORG_SUSPENDED` / `ORG_REACTIVATED`.
   - **Refused while suspended:**
     - storefront: every `gateStorefront` route (event, venue, map, `POST /orders`, apply + forms, RSVPs, pages, menus, blog, theme, contact) returns 404;
     - host resolution: custom domains and store subdomains don't resolve;
     - application pay/select/booth/update-card links;
     - OAuth agent tokens;
     - staff of the org: 403 `ORGANIZATION_SUSPENDED`.
   - **Keeps working:** Stripe webhooks, buyer `/buyer/me` tickets and orders, scanner-key scans, cancel-checkout/release, and SYSTEM_ADMIN via `X-Jump-Org` (so refunds stay possible). Public files are not gated.
5. **Users.** Every user change runs inside a transaction:
   - **Promote** (`role: SYSTEM_ADMIN`) deletes the user's org memberships; the dialog lists them first.
   - **Remove** sets `role: UNASSIGNED`, and is only valid on a system admin (400 `NOT_SYSTEM_ADMIN` otherwise).
   - **Deactivate** sets `isActive: false`.
   - **Demoting or deactivating** revokes every session at once.
   - **Inviting** an email upserts the user as SYSTEM_ADMIN. If the user already exists, the invite promotes them instead.
6. **Guards.**
   - Nobody changes their own access: 403 `CANNOT_CHANGE_SELF`.
   - The last active system admin can't be removed or deactivated: 409 `LAST_SYSTEM_ADMIN`. The count runs under `pg_advisory_xact_lock(hashtext('system-admins'))`, so two concurrent demotions can't both pass.
   - The UI also disables those actions and shows the reason.
7. **Account enforcement.**
   - The claims loader returns `null` for `isActive: false`, which ends the session at sign-in and at the 60 s refresh.
   - `POST /auth/password` returns 403 `ACCOUNT_DEACTIVATED`, but only after the password matches.
   - A SYSTEM_ADMIN without two-step is put into setup mode.
   - Turning two-step off returns 409 `TWO_STEP_REQUIRED_BY_ROLE`.
   - Deactivating a member in Settings › Users also revokes their sessions.

## API Endpoints

All require a SYSTEM_ADMIN session. Mutations without `X-Jump-Reauth` return 401 `REAUTH_REQUIRED`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/system/overview` | SYSTEM_ADMIN | `{ organizations: {total, active, inactive, pending}, users: {total, active, inactive, systemAdmins}, onboarding: {windows, pending}, recentSignups[10] }` |
| GET | `/admin/system/organizations?q&status=ACTIVE\|INACTIVE\|PENDING&page` | SYSTEM_ADMIN | `{ organizations: OrgRow[], pagination }`, 20 per page. `PENDING` = signup not finished |
| GET | `/admin/system/organizations/:id` | SYSTEM_ADMIN | `{ organization: OrgRow, members[] }` |
| PATCH | `/admin/system/organizations/:id/status` | SYSTEM_ADMIN + step-up | `{ status: ACTIVE\|INACTIVE }` → OrgRow |
| GET | `/admin/system/users?q&role&status=ACTIVE\|INACTIVE&page` | SYSTEM_ADMIN | `{ users: UserRow[], pagination }` |
| POST | `/admin/system/users/invite` | SYSTEM_ADMIN + step-up | `{ email, name? }` → 201 `{ user, promoted, emailSent }`; 409 `ALREADY_SYSTEM_ADMIN` / `USER_DELETED` |
| PATCH | `/admin/system/users/:id` | SYSTEM_ADMIN + step-up | `{ role?: SYSTEM_ADMIN\|UNASSIGNED, isActive? }` → UserRow; 403 `CANNOT_CHANGE_SELF`, 409 `LAST_SYSTEM_ADMIN` |

`/admin/platform/*` (the agent access switch) is unchanged and is now shown on `/admin/system/settings`.

Hardening that shipped with this feature:
- `PATCH /users/:id` returns 403 `USE_SYSTEM_ADMIN_USERS` for any SYSTEM_ADMIN role change.
- `PATCH /organizations/:id` refuses `status` unless the caller is a SYSTEM_ADMIN.

## Database

No schema change. The feature uses:
- `User.role` / `isActive` / `twoStepEnabledAt`
- `Organization.status` (`ACTIVE` / `INACTIVE`)
- `OrganizationMember`
- `PlatformCustomer` (plan)
- `PlatformSetting`
- `SecurityEvent.type` (a string), with new types `SYSTEM_ROLE_GRANTED`, `SYSTEM_ROLE_REVOKED`, `SYSTEM_ADMIN_INVITED`, `USER_DEACTIVATED`, `USER_REACTIVATED`, `ORG_SUSPENDED`, `ORG_REACTIVATED`. User events go on the target user with `meta.actorId`; org events go on the actor with `meta.organizationId`.

See [Database Architecture](database-architecture.md).

## Gotchas

- **Promotion deletes memberships.** `UserService.updateUser` removes every `OrganizationMember` row when a user becomes SYSTEM_ADMIN. A system admin reaches orgs through `X-Jump-Org`, not memberships.
- **Two-step rollout.** An existing SYSTEM_ADMIN without two-step is forced into setup at the next 60 s claims refresh. Until then only `/account`, `/auth` and `GET /organizations` work for them.
- **Suspension lag.** The edge host cache can serve a suspended storefront for up to 60 s.
- **Where suspension is checked.** New public storefront routes must go through `gateStorefront`, or `gateActiveOrg` for buyer/payment-link routes. A route outside both stays up for a suspended org.
- **`ORGANIZATION_SUSPENDED` also fires** when the session's org is suspended and no `X-Jump-Org` is sent. Staff whose only org is suspended see that message on admin pages; there is no dedicated screen.
- **Role check runs three times.** The middleware reads `role` from the decoded cookie, which `auth.config.ts` `session` exposes at the edge; the layout guard re-checks it in the browser; and the backend `requireSystemAdmin` is the real gate.
- **Unfinished signups** aren't in the org switcher feed, so their detail page offers **Discard signup**, not Open.
- **Survey answers missing.** The old `/admin/organizations` survey chips aren't returned by the system API. To bring them back, add the onboarding data to `getSystemOrganization`.

## Related Features

- [Org Switcher](org-switcher.md): `X-Jump-Org`, `activeOrgFor`, claims refresh
- [Staff Users](staff-users.md): per-org staff (Settings › Users); `User.role` derived from memberships, SYSTEM_ADMIN never touched
- [User Management](user-management.md): legacy `/users` API
- [Two-step Authentication](two-step-authentication.md), [Account Security](account-security.md) (step-up proof), [Devices & Sessions](devices-sessions.md) (`revokeAll`)
- [Organization Onboarding](organization-onboarding.md): signup funnel, now on System › Organizations
- [Online Store Preferences](online-store-preferences.md): `gateStorefront` / private store mode
