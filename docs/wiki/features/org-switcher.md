# Org Switcher & Admin Org Scoping

**Status:** Implemented
**Last Updated:** 2026-09-13

## Overview

The admin header has an organization switcher. Whatever it selects becomes the *active organization* for every admin request: the frontend sends it as the `X-Jump-Org` header, and the backend resolves it through one helper per route family so events, venues, Settings › General/People, and Settings › Domains all follow the switcher. Staff who belong to several organizations switch between them; `SYSTEM_ADMIN` (who belongs to none) picks any organization. The JWT's role and membership claims refresh from the database every 60 s, so promotions, new memberships, and soft-deletes take effect without signing out.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/OrgContext.tsx` | `OrgProvider`: fetches `GET /organizations`, holds `selectedOrgId`, publishes it to the api client **synchronously** in `setSelectedOrgId`; `refresh()`, `updateOrganization(id, patch)` |
| `frontend/src/components/OrgSwitcher.tsx` | Header dropdown; lists `organizations` from context, calls `setSelectedOrgId`, can create an org |
| `frontend/src/services/api.ts` | `setActiveOrganizationId(id)` module state; every request adds `X-Jump-Org` when set, plus `Authorization: Bearer` from `getSession()` |
| `frontend/src/auth.ts` | Auth.js `jwt` callback: loads role/name/email/first membership on sign-in and re-loads when the snapshot is older than `CLAIMS_REFRESH_MS`; returns `null` (session cleared) for a missing or soft-deleted user |
| `frontend/src/lib/sessionClaims.ts` | Pure helpers `shouldRefreshClaims(token, now)` / `applyUserClaims(token, claims, now)`; `CLAIMS_REFRESH_MS = 60_000` |
| `backend/src/middleware/auth.js` | `activeOrgFrom(req, decoded)`: `req.user.organizationId` = `X-Jump-Org` header (validated `[A-Za-z0-9_-]{1,64}`) else the JWT `organizationId` claim |
| `backend/src/middleware/orgScope.js` | `resolveActiveMembership(userId, preferredOrgId)`, `resolveOrgScope(userId, role, preferredOrgId)`, `isUnscoped(scope)` |
| `backend/src/api/routes/admin.js` | `activeOrgFor(req)` — the single org resolver for `/admin/settings/business-details`, `/admin/settings/people*`, `/admin/settings/domains*` |
| `backend/src/api/routes/organizations.js` | `GET /organizations` — everything for `SYSTEM_ADMIN`, else `listOrganizationsForUser` (memberships only); this is what the switcher lists |

## Configuration

No new environment variables. `AUTH_SECRET` must match between frontend and backend as before (`CLAUDE.md`).

## How It Works

### Selecting an organization (frontend)

1. `OrgProvider` mounts under `/admin`, calls `GET /organizations`, and auto-selects the previous selection if it is still listed, otherwise the first organization.
2. `setSelectedOrgId(id)` does three things in order: stores `id` in a ref, calls `setActiveOrganizationId(id)` on the api client, then `setState`. The api client is updated **before React commits**, so a child page whose effect fetches as soon as it sees the new `selectedOrgId` already sends the header.
3. Pages that depend on the selection read `useOrg()`. `loading` is true until the first `GET /organizations` resolves; a page should not fetch org-scoped data while `loading && !selectedOrgId`.
4. `refresh()` refetches the list (e.g. after Settings renames the store) and keeps the current selection when it still exists. It toggles `loading` again, so pages gate their refetch on the *selected id changing*, not on `loading` flipping (see Settings › General).

### Resolving the active organization (backend)

1. `requireAuth` verifies the Bearer JWT and sets `req.user.organizationId = X-Jump-Org header || decoded.organizationId`.
2. `resolveOrgScope(userId, role, preferredOrgId)`:
   - `SYSTEM_ADMIN` → scoped to `X-Jump-Org` when the header is sent (`{ organizationId: <header>, venueFilter }`); without it `{ organizationId: null, venueFilter: undefined }` (unscoped). Every main-nav page therefore shows one organization at a time for SYSTEM_ADMIN too; only `/organizations` is cross-org.
   - Otherwise `resolveActiveMembership`: the preferred org **if the user has an `OrganizationMember` row for it**, else the oldest membership, else `null`. A forged `X-Jump-Org` for an org the user does not belong to is silently ignored.
3. `activeOrgFor(req)` in `admin.js` turns that into a concrete id for the Settings routes: scoped users get `scope.organizationId`; `SYSTEM_ADMIN` gets `req.user.organizationId` (the switcher header), then `?organizationId=`, then `body.organizationId`. Nothing resolvable → `404 No organization is assigned to this user`.
4. Services take the resolved `organizationId` (`getBusinessDetails(orgId)`, `updateBusinessDetails(orgId, data)`, `listPeople(orgId)`, `createPerson(actorId, orgId, data)`, `deletePerson(actorId, orgId, personId)`). There are no `*ForUser(userId)` variants any more.

### Keeping JWT claims fresh

1. On sign-in the `jwt` callback loads `role`, `name`, `email`, and the oldest membership's `organizationId` from `User` and stamps `claimsRefreshedAt`.
2. On every later `/api/auth/session` call (the api client calls `getSession()` per request), `shouldRefreshClaims` returns true when `claimsRefreshedAt` is missing or ≥ 60 s old; the callback reloads the same snapshot. Tokens minted before this field existed refresh on first use.
3. If the user row is gone or `deletedAt` is set the callback returns `null`; `@auth/core` clears the session cookie.
4. The `session` callback re-signs the backend `accessToken` from the (now fresh) token on every call, so the backend sees the new role on the next request.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/organizations` | Organizer+ | Switcher list: all orgs for `SYSTEM_ADMIN`, memberships otherwise |
| GET/PATCH | `/admin/settings/business-details` | Organizer+ | Active org via `activeOrgFor(req)` |
| GET/POST/DELETE | `/admin/settings/people[/:personId]` | Organizer+ | Active org via `activeOrgFor(req)` |
| GET/POST/… | `/admin/settings/domains*` | Organizer+ | Active org via `activeOrgFor(req)` (also accepts `?organizationId=` for `SYSTEM_ADMIN`) |

Header: `X-Jump-Org: <organizationId>` on every admin request from the frontend.

## Database

`OrganizationMember(userId, organizationId, role)` is the only source of truth for staff affiliation; `SYSTEM_ADMIN` accounts have no rows. See [Tenant Identity](tenant-identity.md) and [Database Architecture](database-architecture.md).

## Gotchas

- **Publish the selection synchronously, never from a provider `useEffect`.** React runs child effects before parent effects. When the header was set in `OrgProvider`'s effect, Settings › General fetched first and the request had no `X-Jump-Org` (PR #30). Anything else that must accompany a request in the same commit follows the same rule.
- **Wait for the switcher before the first org-scoped fetch.** A page that fetches on mount sends no header because `GET /organizations` has not resolved yet (PR #29). Gate on `useOrg().loading`.
- **Refetch on `selectedOrgId` change, not on `loading`.** `refresh()` toggles `loading`; refetching then remounts the page and drops focus (caught by the "updates the org switcher immediately" e2e).
- **`SYSTEM_ADMIN` has no memberships.** `resolveOrgScope` honours `X-Jump-Org` directly (no membership check) and returns unscoped only without the header; any route that needs a concrete org must use `activeOrgFor(req)` (or the same fallback chain). Resolving from "first membership" yields `null` and a 404 for every `SYSTEM_ADMIN` (PR #28).
- **Do not add `getXForUser(userId)` service methods.** They silently pick the first membership and ignore the switcher; a multi-org ADMIN would edit the wrong organization.
- **Stale JWT claims used to require re-login.** Before PR #27 the role and membership were set only at sign-in; a session minted as `ADMIN` kept sending `ADMIN` after promotion to `SYSTEM_ADMIN`, `GET /organizations` returned `[]`, and the admin looked like an empty database. Claims now refresh every 60 s; a demotion or soft-delete lands within a minute.
- **Empty switcher ≠ wiped data.** Check `OrganizationMember` rows and the JWT's `role` before assuming a migration destroyed anything.
- **Request logs strip the mount path.** The backend logger records `req.path` inside mounted routers, so `GET /organizations` shows as `GET /` in Railway logs; grep by correlation id.
- **E2E specs mock `GET /organizations`** because the switcher label and the `X-Jump-Org` value come from `OrgContext`, not from the settings endpoints. Route mocks match the exact URL, so do not append `?organizationId=` to requests that already rely on the header.

## Related Features

- [Tenant Identity](tenant-identity.md) — `OrganizationMember`, `resolveOrgScope`, `requireOrgMembership`.
- [Organization Settings](organization-settings.md) — Settings › General/People consume the active org.
- [Custom Domains](custom-domains.md) — Settings › Domains uses the same `activeOrgFor(req)`.
- [Auth.js Integration](authjs-integration.md) — session cookie, `accessToken`, claim refresh.
- [RBAC](rbac.md) — `requireOrganizer` / `requireAdmin` still gate the routes; scoping is a second step.
