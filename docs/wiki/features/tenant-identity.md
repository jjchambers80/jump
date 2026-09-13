# Tenant Identity (Per-Organization Buyers, Staff Memberships)

**Status**: Implemented (spec 007 phase 1, shipped 2026-09-13)
**Last Updated**: 2026-09-13

## Overview

Buyers are `Contact` rows that belong to one organization: the same email buying from two organizations is two independent records with their own order history, note, and marketing consent. Staff (`User`) are global and belong to organizations through `OrganizationMember`, so one person can administer several organizations. Buyers never live in `User`.

This is the foundation for white-label custom domains (spec 007 phase 3): a storefront on an organization's own domain must only ever see that organization's buyers.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | `Contact` (unique on `organizationId + email`), `OrganizationMember`, `MemberRole` |
| `packages/db/prisma/migrations/20260913000000_contact_per_org_and_membership/migration.sql` | DDL + backfill in one transaction (splits multi-org contacts, copies memberships, guard raises on inconsistency) |
| `backend/src/middleware/orgScope.js` | `resolveOrgScope`, `resolveActiveMembership`, `getMemberships`, `requireOrgMembership` |
| `backend/src/services/CustomerService.js` | Customer admin queries filter `Contact.organizationId` directly |
| `backend/src/services/OrderService.js` | Checkout upserts `Contact` by `organizationId_email` (org taken from `event.venue`) |
| `backend/src/services/UserService.js` | Org assignment writes/clears `OrganizationMember` rows; response keeps `organizationId` + adds `organizations[]` |
| `backend/src/services/OrganizationService.js`, `OrganizationPersonService.js` | Resolve the caller's active org via `resolveActiveMembership` |
| `backend/src/api/routes/{venues,tierPresets,organizations}.js` | Use `requireOrgMembership(param)` instead of per-file `verifyOrgOwnership` copies |
| `frontend/src/auth.ts` | Auth.js JWT/session carry `organizationId` (first membership) |
| `backend/tests/contract/tenantIsolation.test.js` | Isolation contract: list/detail/patch, membership guards, JWT claim, legacy column ignored |

## Configuration

No new environment variables.

## How It Works

1. **Buyer = org-scoped Contact.** `Contact.organizationId` is required and `(organizationId, email)` is unique. Checkout (`OrderService.createOrder`) takes the organization from `event.venue.organizationId` and upserts by that composite key. `Contact.note`, `emailSubscribed`, and `accountCreatedAt` are therefore per organization by construction.
2. **Staff = User + memberships.** `OrganizationMember(userId, organizationId, role)` with `role` in `MemberRole` (`ADMIN | ORGANIZER`). `User.role` still carries `SYSTEM_ADMIN` (unscoped) and `CUSTOMER`; ADMIN/ORGANIZER semantics for a given org live on the membership. `User.organizationId` still exists but is never read or written (dropped in phase 4).
3. **Active organization.** `resolveActiveMembership(userId, preferredOrgId)` returns the membership matching `preferredOrgId` if the user really has it, else the oldest membership. `resolveOrgScope(userId, role, preferredOrgId)` wraps that into the `{ organizationId, venueFilter }` shape the admin routes already used; SYSTEM_ADMIN returns the unscoped shape. `preferredOrgId` comes from the JWT `organizationId` claim (`req.user.organizationId`), which Auth.js sets from the first membership at sign-in.
4. **Route guards.** `requireOrgMembership('orgId')` (or `'id'`) replaces the three duplicated `verifyOrgOwnership` helpers: SYSTEM_ADMIN passes, otherwise a membership row for `req.params[param]` must exist; sets `req.membership`.
5. **No membership = no data.** Admin routes that resolve scope check `!isUnscoped(scope) && !scope.organizationId` and return empty/404 rather than falling through to the unscoped path. `/admin/customers*` included.
6. **Backfill (one-time, in the migration).** For each contact: distinct organizations across all orders (any status) via `order → event → venue`; primary = earliest order, existing row keeps its id; one clone per additional org; orders and tickets repointed by org; zero-order contacts deleted (nothing references them); a `DO $$` guard raises and rolls back if any contact is unscoped or any order/ticket points at a contact of another org. Global `Contact_email_key` dropped, `Contact_organizationId_email_key` added. `emailSubscribed` default flipped to `false` (existing rows untouched).

## API Endpoints

No new endpoints. Behavior changes:

| Method | Path | Auth | Change |
|--------|------|------|--------|
| GET | `/admin/customers` | Organizer/Admin | Returns only the caller's active org's contacts; `note`/`emailSubscribed` are that org's values; empty for staff with no membership |
| GET/PATCH | `/admin/customers/:contactId` | Organizer/Admin | 404 for another org's contact or for staff with no membership |
| PATCH | `/users/:id` | Admin | `organizationId` replaces the user's memberships (null clears); memberships only exist for ADMIN/ORGANIZER; demotion to CUSTOMER/SYSTEM_ADMIN clears them |
| GET | `/users` | Admin | `organizationId` filter matches memberships; response adds `organizations: [{ id, name, role }]` |
| GET | `/orders/my`, `/tickets/my` | Auth | Match on `contact.email` relation (an email may own several Contact rows); staff-only legacy path, removed in phase 4 |

## Database

- `Contact`: `+organizationId` (FK → Organization, RESTRICT), `+accountCreatedAt DateTime?`, unique `(organizationId, email)`, `emailSubscribed @default(false)`, `userId` retained (legacy).
- `OrganizationMember`: `id, userId (FK cascade), organizationId (FK cascade), role MemberRole, createdAt`; unique `(userId, organizationId)`.
- `MemberRole` enum: `ORGANIZER | ADMIN`.
- `Organization` gains `members` and `contacts` relations; `User` gains `memberships`.

See [Database Architecture](database-architecture.md).

## Gotchas

- **Never look a Contact up by email alone.** Use `organizationId_email`. `prisma.contact.findUnique({ where: { email } })` no longer compiles.
- **`User.organizationId` is dead.** It still has data for old rows but nothing reads it; the tenant isolation test asserts that a mismatched legacy value is ignored. Write memberships instead.
- **Seed and test fixtures** must create contacts with `organizationId` and staff with `memberships: { create: … }`. Several older contract suites sign JWTs for users that do not exist in the DB and were already failing before this work; they are not a signal.
- **`_count.users` on organization responses** is now `_count.members` mapped back to the `users` key so the admin UI shape is unchanged.
- **Migration is all-or-nothing.** Railway runs `prisma migrate deploy` at boot. If it ever raises, the DB is unchanged; run `prisma migrate resolve --rolled-back 20260913000000_contact_per_org_and_membership` to clear P3009. Pre-deploy backup for the 2026-09-13 run: `~/Backups/jump/jump-prod-pre-007-20260912-2317.sql.gz` on JJ's machine.
- **One cookie per host.** Buyer sessions (see [Buyer Accounts](buyer-accounts.md)) are per organization but the Jump domain has one cookie, so signing in at org B replaces org A. Custom domains (phase 3) remove this.

## Related Features

- [Buyer Accounts](buyer-accounts.md) — checkout opt-in and passwordless sign-in built on org-scoped contacts
- [Multi-Tenant Architecture](multi-tenant-architecture.md) — organizations, venues, transitive event ownership
- [Guest Checkout](guest-checkout.md) — where the contact upsert happens
- [Role-Based Access Control](rbac.md) — `requireRole` on the JWT claim; `requireOrgMembership` for org-param routes
- [User Management](user-management.md) — org assignment now writes memberships
- Plan and decision record: `specs/007-tenant-identity/{spec,plan}.md`
