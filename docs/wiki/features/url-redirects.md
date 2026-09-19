# Content › URL redirects

**Status:** Implemented (spec 028)
**Last Updated:** 2026-09-19

## Overview

**Content › Menus › URL redirects** (`/admin/content/menus/redirects`) sends visitors from an old or printed link to the right place. A storefront request that would otherwise 404 on the organization's storefront — any path on a custom domain, or `/organizations/:orgId/<anything>` on the platform host — is looked up in the organization's redirects and answered with a **301** (308 via `permanentRedirect` on the platform host). Targets are storefront paths (`/pages/faq`, `/blogs/news`, `/account`, `/`) or absolute `https://` URLs. One hop, exact path match, no wildcards.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`UrlRedirect`) | `fromPath` unique per organization (normalised), `toPath` |
| `packages/db/prisma/migrations/20260930500000_url_redirects` | Adds the table |
| `backend/src/utils/redirectPath.js` | `normalizeFromPath` (lowercase, leading `/`, no trailing `/`, no query/hash, accepts a full URL), `isReservedPath` (live routes: `/`, `/account*`, `/events/*`, `/checkout/*`, `/orders/*`, `/venues/*`, `/tickets/*`, `/confirmation`, `/api/*`, `/admin*`, `/auth*`, `/organizations/*`), `normalizeToPath` (path or `http(s)` only — no `javascript:`/`mailto:`), limits |
| `backend/src/services/UrlRedirectService.js` | `list` (search on both columns, 50/page), `create` (409 on duplicate, 5 000 cap), `update`, `remove`, `removeMany`, `resolve(orgId, path)` |
| `backend/src/api/routes/redirects.js` | `/admin/redirects*` |
| `backend/src/api/routes/organizations.js` | `GET /:id/public/redirect?path=` → `{ to, absolute }` / 404; **not gated** by private store mode; `Cache-Control: public, max-age=60` |
| `frontend/src/middleware.ts` | Tenant host: when `routeForTenantHost` yields `notFound`, ask the backend (2 s timeout, fail-open to 404) and `NextResponse.redirect(…, 301)` |
| `frontend/src/app/organizations/[orgId]/[...rest]/page.tsx` | Platform host catch-all: same lookup, `permanentRedirect` or `notFound()` |
| `frontend/src/lib/storefrontHost.ts` | `hostifyRedirectTarget(to, orgId, tenantHost)` — relative targets as-is on tenant hosts; `/`, `/pages/*`, `/blogs/*`, `/account*` prefixed with `/organizations/:orgId` on the platform |
| `frontend/src/app/admin/content/menus/redirects/{page,useRedirectsApi}.tsx` | List (search, bulk delete), Create / Edit dialog (`SettingsDialog`), delete confirm; **URL redirects** button on the Menus page |
| `backend/tests/{unit/redirectPath,contract/redirects}.test.js`, `frontend/e2e/admin-redirects.spec.ts`, `tests/unit/storefrontHost.test.ts` | Tests |

## API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/admin/redirects` | `q`, `page` → `{ redirects, total, page, pageSize }` |
| `POST` | `/admin/redirects` | `{ fromPath, toPath }` → 201; 400 reserved / self / bad target; 409 duplicate |
| `PATCH/DELETE` | `/admin/redirects/:id` | |
| `POST` | `/admin/redirects/bulk-delete` | `{ ids }` → `{ deleted }` |
| `GET` | `/organizations/:id/public/redirect?path=` | `{ to, absolute }` or 404 |

## Gotchas

- **Only 404 paths are consulted.** Live routes never pay for a lookup and can never be hijacked — the reserved list in `redirectPath.js` must stay in step with `routeForTenantHost` in `lib/storefrontHost.ts` when new public routes are added.
- **Fail-open**: a backend outage during the lookup renders the normal 404, never an error page.
- The lookup is not gated by private store mode (the target is gated itself); it reveals only that a path maps to another path.
- `fromPath` accepts a full URL and keeps only its pathname, so organizers can paste the old link.

## Related Features

- [Menus](menus.md) — entry point
- [Custom Domains](custom-domains.md) — the tenant middleware that performs the redirect
- [Online Store Pages](online-store-pages.md), [Blog posts](blog-posts.md) — typical targets
