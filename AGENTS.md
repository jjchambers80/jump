# Jump — Universal Agent Standards

Shared coding standards and architecture for all AI agents (Claude, Cursor, Copilot, etc.).
Project-specific commands and env vars are in [`CLAUDE.md`](./CLAUDE.md).

## Architecture

```
Organization → Venue → Event → PriceTier
                                    ↓
                    Contact → Order → OrderItem → Ticket
                                    ↓
                            PaymentTransaction (Stripe)
```

- **Contact ≠ User**: Contacts are ticket buyers (can be guests). Users are authenticated accounts.
- **Org scoping**: Events belong to orgs transitively: Event → Venue → Organization.
- **PaymentTransaction**: Append-only, no updatedAt. Immutable ledger.
- **Capacity**: Event.capacity is a ceiling; actual inventory lives on PriceTier (quantityTotal/Sold/Reserved).

## Tech Stack

Express.js 4.21 · Next.js 14 App Router · PostgreSQL via Prisma · Stripe (API v2024-11-20.acacia) ·
Auth.js v5 (JWT HS256) · Resend email · Redis caching · Railway deployment

## Backend Patterns

- **Layering**: Routes handle HTTP, validators check input, services contain business logic
- **Route registration**: New route files must be registered in `backend/src/api/server.js`
- **Auth middleware chain**: `requireAuth` → `requireRole('ORGANIZER'|'ADMIN')`
- **Public endpoints**: Event listing, guest checkout, ticket lookup — no auth required
- **Partial PATCH validators**: `validateUpdateBusinessDetails` validates only keys present in the body (whitelist + per-key rules). Follow that pattern when several UI cards save subsets of one record

## Frontend Patterns

- **App Router**: Admin pages under `/admin/`, public under `/events/`
- **API calls**: All go through `frontend/src/services/api.ts`
- **Client components**: Use `'use client'` directive; wrap `useSearchParams()` in `<Suspense>`
- **Admin pages**: Add to sidebar nav, protect with session check

## Commit Rules

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Subject ≤ 50 chars, imperative mood
- Body explains WHY, not WHAT (the diff shows what)

## Common Tasks

### New API endpoint
1. Route in `backend/src/api/routes/` → validator in `validators/` → logic in `services/`
2. Register in `server.js` if new file
3. Add auth middleware as needed

### New frontend page
1. Create `frontend/src/app/<path>/page.tsx`
2. API calls via `frontend/src/services/api.ts`

### Schema change
1. Edit `packages/db/prisma/schema.prisma`
2. `npm run db:migrate` then `npm run db:generate`
3. Update seed file if applicable

## Gotchas

1. AUTH_SECRET mismatch → silent JWT verification failure
2. Prisma client not regenerated after schema change → stale types
3. Stripe webhooks locally need: `stripe listen --forward-to localhost:3000/webhooks/stripe`
4. Capacity is per-tier, not per-event
5. Railway services need explicit PORT env var
6. Public org/venue/event pages use `brand` Tailwind tokens (CSS vars set by `BrandScope`), not raw blue classes — see `docs/wiki/features/organization-branding.md`
7. Org-scoped public pages must pass `themeMode` to `BrandScope`; never force a theme via `setTheme` (it overwrites the visitor's stored choice) — see `docs/wiki/features/organization-theme-mode.md`
8. Tenancy (spec 007): buyers are `Contact` rows scoped by `organizationId` (unique on `organizationId + email`); the same email at two orgs is two rows. Never look up a Contact by email alone — use `organizationId_email`. Staff org affiliation is `OrganizationMember`, resolved through `resolveOrgScope` / `requireOrgMembership` in `backend/src/middleware/orgScope.js`; `User.organizationId` and `Contact.userId` no longer exist. `UserRole.UNASSIGNED` is the default for fresh sign-ins and grants nothing. The admin org switcher sends `X-Jump-Org`; the backend honors it only for real memberships. Buyers sign in passwordlessly via `/buyer/*` + the `jump_buyer` httpOnly cookie set by `frontend/src/app/api/buyer/*`; never put buyers in `User` or Auth.js
9. Next middleware lives at `frontend/src/middleware.ts`. This project uses the `src/` layout, so a `frontend/middleware.ts` at the package root is silently ignored (the old Auth.js protection there never ran). Staff admin routes are guarded client-side; the middleware only does tenant-host routing for custom domains — see `docs/wiki/features/custom-domains.md`
10. Backend CORS (`backend/src/api/server.js`): `FRONTEND_URL` is a comma-separated allowlist; outside production any `localhost`/`127.0.0.1` port is also allowed, so worktree previews on other ports work without env changes. A running backend must be restarted to pick up the change. ACTIVE organization custom domains are also allowed dynamically (`DomainService.isActiveOrigin`)
