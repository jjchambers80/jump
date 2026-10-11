# Roles & permissions (RBAC)

**Status:** Implemented
**Last Updated:** 2026-10-10

## Overview

Staff belong to organizations through `OrganizationMember` with a member role, **ADMIN** or **ORGANIZER**. What each role may see and do is a **permission catalog** that a system admin edits in **System administration › Roles** (`/admin/system/roles`):

- **Features** (`customers`, `maps`, `analytics`, `finance`, `onlineStore`, `content`, `developer`, …). Hiding one for a role removes it from that role's menu, redirects its pages to the dashboard and makes its API answer 403. Turning it off **platform-wide** hides it from everyone, Admins and system admins included, and its API answers 404.
- **Actions** (`orders.refund`, `settings.tax`, `customers.privacy`, …). These are privileged operations inside a feature.

The defaults:

- both roles see every feature;
- ADMIN has every action;
- ORGANIZER has only the event-configuration actions marked `organizer: true` in the catalog: `applications.forms` (event application forms, categories, questions, form templates) and `addOns.manage` (add-ons and saved add-ons). Spec 050-E opened them so an organizer can set up a whole event. Money (`applications.money`, `orders.refund`), every `settings.*` action standing forms (`applications.standingForms`, Content › Forms) and forcing a spot onto an application of another category (`maps.forceAssign`, enforced on `POST /admin/maps/:mapId/booths/:boothId/assign` with `force`) stay ADMIN.

`applications.standingForms` was split out of `applications.forms`. An override of `applications.forms` saved before the split also applies to it until System › Roles saves one of its own (`SPLIT_KEYS` in `PermissionService`).

The frontend stand-in that applies before `GET /admin/permissions` answers grants the same ORGANIZER defaults (`OrgContext.tsx`); keep the two in step.

**SYSTEM_ADMIN** is an account-wide role with no memberships. It bypasses the matrix, though not the platform-wide switches. **UNASSIGNED** grants nothing.

Authorization always uses the **role in the organization the request acts on**. `User.role` is ADMIN when *any* membership is ADMIN, so it never decides what someone may do inside one organization (fixed in PR #404).

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/permissions/catalog.js` | The only list of keys: features (with `adminPaths`), actions, the locked ones and the defaults |
| `backend/src/services/PermissionService.js` | `effective(role)`, `matrix()`, `save()`. Overrides live in `PlatformSetting` key `roles`, with a 30 s in-process cache |
| `backend/src/middleware/rbac.js` | `orgRoleFor(req)`, `requireOrganizer`, `requireFeature(key)`, `requirePermission(key)`, `can(req, key)`, plus the account-wide `requireRole` / `requireSystemAdmin` |
| `backend/src/api/routes/adminSystem.js` | `GET/PUT /admin/system/roles` |
| `backend/src/api/routes/admin.js` | `GET /admin/permissions`: the caller's `granted` keys and `hiddenPaths` in the active org |
| `frontend/src/components/OrgContext.tsx` | Loads permissions per selected org. Provides `useCan(key)`, `hasPermission`, `isHiddenPath` and `HiddenPathRedirect` |
| `frontend/src/app/admin/system/roles/page.tsx` | The matrix editor and the platform feature switches |

## How It Works

1. `requireAuth` verifies the JWT.
2. `orgRoleFor(req)` resolves the membership role in the org named by the route's `:orgId`, or otherwise the active org (`X-Jump-Org` when the user belongs to it, else their first membership). This is the same org `activeOrgFor(req)` acts on. The result is memoised per request.
3. `requireFeature(key)` / `requirePermission(key)` look the key up in `PermissionService.effective(role)`. An unknown key throws at boot.
4. Handlers that only shape a response (`canEdit` flags, "see every token") call `can(req, key)`.
5. The frontend fetches `GET /admin/permissions` whenever the org changes or the window regains focus. Until it answers, or if it fails, the account role stands in. That stand-in keeps mocked Playwright specs on the default behaviour.

### Storage

`PlatformSetting { key: 'roles', value: { ADMIN: {key: bool}, ORGANIZER: {key: bool}, disabled: [featureKey] } }` stores only values that differ from the defaults, so a key added to the catalog later gets its default automatically. Changes go into the audit trail (`Platform`), and each save also records a `ROLE_PERMISSIONS_CHANGED` security event.

### Locked keys

- Dashboard, Events, Venues, Orders and Settings are always visible, because the rest of the admin depends on them.
- `settings.users` is fixed: ADMIN always has it and ORGANIZER never does. Otherwise an Organizer could make themselves Admin, or an organization could end up with nobody able to manage users.

## Adding a feature or action

1. Add the key to `catalog.js`. For a feature, include `adminPaths` (its `/admin/...` pages).
2. Guard the routes: `router.use(requireFeature('x'))` on a feature router, or `requirePermission('x.y')` on a route. Never compare a role string.
3. In the UI, call `useCan('x.y')`. Nav items under a feature's `adminPaths` hide themselves.
4. `tests/unit/permissions.test.js` fails if an action is never enforced or a hideable feature is never gated.

## Gotchas

- Environment flags (`BILLING_ENABLED`, `AGENT_ACCESS_ENABLED`, `THEME_EDITOR_ENABLED`, …) stay separate. The platform switches cover only catalog features, so nothing has two off switches.
- Other backend instances see a change up to 30 s late (per-instance cache).
- Contract tests must not write the `roles` setting with overrides, because suites share one database. Pin `permissionService._cache` in the worker instead (see `tests/contract/orgRole.test.js`).
- Staff with no membership get 403 on admin routes, not empty lists.
- The frontend check is for UX only. The backend enforces every key.

## Related Features

- [System Administration](system-administration.md) — where the Roles page lives.
- [Staff users](staff-users.md) — who has which role in an organization.
- [Org switcher](org-switcher.md) — how the active organization is chosen.
