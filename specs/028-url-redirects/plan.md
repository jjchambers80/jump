# Implementation Plan: Content › URL redirects (spec 028)

**Status**: Built 2026-09-19 on `feat/028-url-redirects`.
**Spec**: [spec.md](./spec.md). Depends on 027 Menus on `main`.
**Branch**: `feat/028-url-redirects`, merged to `main` alone.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Tenant host routing | `frontend/src/middleware.ts`, `lib/storefrontHost.ts` (`routeForTenantHost` → `notFound`) | Redirect lookup on the `notFound` branch |
| Edge-safe backend calls from middleware | `middleware.ts` already resolves the host's org via the backend (custom domains) | Same fetch pattern, 2 s timeout, fail-open to 404 |
| Org-scoped admin routes, dialogs, table idioms | `adminScope.js`, `SettingsDialog`, Files / Menus tables | list + dialog |
| Path normalisation | new `utils/redirectPath.js` shared by validator and lookup | |

---

## 2. Design

### 2.1 Schema (migration `…_url_redirects`)

```prisma
model UrlRedirect {
  id             String   @id @default(cuid())
  organizationId String
  fromPath       String   // normalised: lowercase, leading "/", no trailing "/"
  toPath         String   // relative storefront path or absolute http(s) URL
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, fromPath])
}
```

### 2.2 Service — `UrlRedirectService`

`list(orgId, { q, page })`, `create`, `update`, `remove`, `bulkDelete`, `resolve(orgId, path)` (normalise → `findUnique`), `normalizeFrom(path)`, `isReserved(path)`. `resolve` is cached in Redis for 60 s when available (`redirect:<orgId>:<path>`), invalidated on write by org key prefix (small enough to delete the org's keys).

### 2.3 Routes

| Method | Path | Notes |
|---|---|---|
| `GET/POST` | `/admin/redirects` | list (search on both columns) / create 201, 409 on duplicate `from` |
| `PATCH/DELETE` | `/admin/redirects/:redirectId` | |
| `POST` | `/admin/redirects/bulk-delete` | `{ ids }` |
| `GET` | `/organizations/:id/public/redirect?path=` | `{ to }` / 404; `max-age=60`; not gated |

`routes/redirects.js`, `validators/redirectValidators.js`.

### 2.4 Runtime

- **Tenant host** (`frontend/src/middleware.ts`): when `routeForTenantHost` returns `{ kind: 'notFound' }`, call `GET /organizations/:org/public/redirect?path=` (edge `fetch`, 2 s timeout, no-store beyond the CDN header). On `{ to }`: relative → `NextResponse.redirect(new URL(to, request.url), 301)`; absolute → redirect as-is. On anything else fall through to the existing 404 rewrite.
- **Platform host**: `app/organizations/[orgId]/[...rest]/page.tsx` server component: resolve via the same endpoint; `redirect()` is 307 in Next, so use `permanentRedirect()` (308) — acceptable; documented. Relative targets are prefixed with `/organizations/:orgId`. Otherwise `notFound()`.
- Only paths that *would* 404 are consulted; live routes never redirect (FR reserved list mirrors `routeForTenantHost`'s `PUBLIC_PASS`).

### 2.5 Admin

`app/admin/content/menus/redirects/page.tsx`: header *URL redirects* with back link to Menus; search; table (from, to with `ExternalLink` icon for absolute targets, created, *Target missing* hint); **Create URL redirect** dialog (`SettingsDialog`: *Redirect from* with `/` prefix adornment, *Redirect to* with hint "Relative path like /pages/faq or a full URL"); row click → same dialog in edit mode; bulk delete. `useRedirectsApi()`.

Menus page: the **URL redirects** button links here (027 left it behind a constant).

---

## 3. Files

- schema + migration; `services/UrlRedirectService.js`; `utils/redirectPath.js`; `routes/redirects.js`; `validators/redirectValidators.js`; `server.js`; `routes/organizations.js` public lookup
- `frontend/src/middleware.ts`; `app/organizations/[orgId]/[...rest]/page.tsx`; `app/admin/content/menus/redirects/page.tsx`; `services/api.ts`; `lib/storefrontHost.ts` (`isReservedStorefrontPath`, `hostifyTarget`)
- Docs: `docs/wiki/features/url-redirects.md`, `custom-domains.md` (middleware now consults redirects), `specs/STATUS.md`

---

## 4. Tests

- **Unit**: `redirectPath.test.js` (normalisation, reserved list, absolute vs relative, loop `from === to`), `storefrontHost.test.ts` (`hostifyTarget`).
- **Contract** `redirects.test.js`: CRUD, duplicate 409 (case / trailing slash), reserved 400, public lookup hit / miss / normalised, cross-org 404, cap at 5 000.
- **E2E** `public-redirects.spec.ts`: tenant host `/vendor-info` → 301 `/pages/vendors` (backend stubbed via `page.route`), platform `/organizations/:id/vendor-info` → `/organizations/:id/pages/vendors`, live route untouched. `admin-redirects.spec.ts`: create, edit, delete.

---

## 5. Rollout

Additive migration; no env. Middleware change deploys with the frontend; the lookup fails open to 404, so a backend outage never breaks routing.

## 6. Decisions

- One hop, 301 only, exact-path matching — the 90 % case; wildcards later.
- Not gated by private store mode: a redirect leaks only the target path, which is gated itself.
- Lookup only on the 404 path so live storefront routes never pay for it.
