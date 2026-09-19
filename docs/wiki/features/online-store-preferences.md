# Online Store Preferences

**Status:** Implemented
**Last Updated:** 2026-09-19

## Overview

**Online store › Preferences** (`/admin/online-store/preferences`, nested under Online store next to Pages) holds two storefront-wide settings for the organization picked in the header switcher:

1. **Store access** — *Private mode* toggle, store *password*, and a *custom message to your visitors*. While private, every public storefront surface — the organization page (`/organizations/:orgId`, `/` on a custom domain), event pages, checkout, venue pages and application forms — shows a branded password page instead; a visitor who enters the password gets a token that unlocks the store on that browser. Events of private stores are also hidden from the public `/events` discovery list.
2. **Social sharing image and SEO** — *Homepage title* and *Meta description* for the storefront homepage, with a Google-style preview. The cover image from Online store › Branding is used as the `og:image`.

Each section saves on its own through one partial `PATCH`. The third section, *Automatic redirection › Language*, is documented in [Storefront Language Redirection](storefront-language-redirection.md).

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`model Organization`) | `storefrontPrivate`, `storefrontPasswordHash`, `storefrontMessage`, `seoTitle`, `seoDescription` |
| `packages/db/prisma/migrations/20260929000000_online_store_preferences` | Adds the five columns (defaults: public, no password) |
| `packages/db/src/index.{js,ts}` | `new PrismaClient({ omit: { organization: { storefrontPasswordHash: true } } })` — the hash is dropped from every query unless it opts in |
| `backend/src/services/StorefrontPreferencesService.js` | `get`, `update` (private-mode invariants), `unlock`, `accessToken`, `hasAccess` (comma-separated token list), `assertAccess`, `organizationIdFor`; `hashPassword` / `verifyPassword` (scrypt) |
| `backend/src/middleware/storefrontGate.js` | `gateStorefront(resolve)` + `gateByEventParam` / `gateByVenueParam` / `gateByEventBody`: 403 `StorefrontLockedError` on public event, venue, checkout and application form routes |
| `backend/src/middleware/errorHandler.js` | `StorefrontLockedError` → 403 `{ error: 'StorefrontLockedError', details: { locked, organization, message } }` |
| `backend/src/services/EventService.js` | `listPublishedEvents` filters `venue.organization.storefrontPrivate = false` |
| `backend/src/api/validators/storefrontPreferencesValidators.js` | `validateUpdateStorefrontPreferences` (partial, unknown fields rejected), `validateStorefrontUnlock` |
| `backend/src/utils/pageLimits.js` | `STOREFRONT_MESSAGE_MAX = 500`, `STOREFRONT_PASSWORD_MIN/MAX = 4/100`; SEO limits shared with Pages |
| `backend/src/api/routes/admin.js` | `GET` / `PATCH /admin/online-store/preferences` via `activeOrgFor(req)` |
| `backend/src/api/routes/organizations.js` | `GET /:id/public` (reads `X-Storefront-Access`), `GET /:id/public/meta`, `POST /:id/storefront-access` (rate limited) |
| `backend/src/services/OrganizationService.js` | `getPublicOrganization(id, { accessToken })` returns `locked: true` + message when gated; `getPublicMeta(id)` |
| `frontend/src/app/admin/online-store/preferences/page.tsx` | The three-section admin page |
| `frontend/src/app/organizations/[orgId]/page.tsx` | Server wrapper: `generateMetadata` from `/public/meta` (title, description, Open Graph) |
| `frontend/src/app/organizations/[orgId]/OrganizationStorefront.tsx` | Client storefront (the former `page.tsx`); renders the gate when `locked` |
| `frontend/src/components/StorefrontPasswordGate.tsx` | Branded password page; stores the token and refetches. Rendered by the org page, `events/[eventId]`, `checkout/[eventId]`, `venues/[venueId]` and `events/[eventId]/apply/ApplyShell.tsx` |
| `frontend/src/lib/storefrontAccess.ts` | `localStorage` token per organization (`jump.storefront-access.<orgId>`), `allStorefrontAccessTokens()`, `storefrontLockFrom(err)` |
| `frontend/src/services/api.ts` | Attaches every stored token as `X-Storefront-Access` (comma-separated) on each request |
| `frontend/src/services/api.ts` | `StorefrontPreferences`, `StorefrontPreferencesInput` |
| `backend/tests/{unit,contract}/storefrontPreferences.test.js`, `frontend/e2e/admin-preferences.spec.ts`, `frontend/e2e/public-storefront-private.spec.ts` | Tests |

## Configuration

No new variables. `AUTH_SECRET` signs the storefront access tokens (HS256 JWT, 30 days). `NEXT_PUBLIC_API_URL` is used server-side by `generateMetadata`.

## How It Works

### Store access

1. Admin turns on *Private mode* and sets a password (≥ 4 chars). `PATCH` stores `storefrontPrivate = true` and `storefrontPasswordHash = scrypt$<salt>$<hash>`. The API never returns the hash or the password — only `hasPassword`.
2. `GET /organizations/:id/public` selects the hash and calls `StorefrontPreferencesService.hasAccess(org, tokens)`. Without a valid token it returns `{ organization (branding only), locked: true, message, events: [] }`. Every other public storefront route (`GET /events/:id`, `GET /venues/:id`, `POST /orders`, `GET/POST /events/:id/applications/*`) runs `middleware/storefrontGate.js`, which resolves the owning organization and throws `StorefrontLockedError` — 403 with the same branding + message in `details`. Unknown ids fall through to the route's 404.
3. The storefront renders `StorefrontPasswordGate` (from `locked: true` on the org page, or `storefrontLockFrom(err)` on the others). `POST /organizations/:id/storefront-access { password }` returns `{ token }` or 401. The token is stored in `localStorage`; `services/api.ts` sends every stored token, comma-separated, as `X-Storefront-Access` because the browser does not know which organization an event belongs to before asking. The backend checks at most 10.
4. The token carries `{ sub: orgId, typ: 'storefront', ph: sha256(hash).slice(0,16) }`, so it is bound to one organization and is revoked by changing or removing the password.
5. *Remove password and make store public* sends `{ storefrontPrivate: false, password: null }` in one request (the two are only accepted together while private).

### Search engine listing

`PATCH { seoTitle, seoDescription }` (blank → `null`). `GET /organizations/:id/public/meta` returns `{ title: seoTitle || name, description, imageUrl: coverUrl }` and `page.tsx` turns it into `<title>`, `<meta name="description">` and Open Graph tags. The fetch has a 2 s timeout and revalidates every 60 s; failures fall back to the app defaults.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/online-store/preferences` | ORGANIZER+ | Preferences for the active organization (`hasPassword`, never the hash) |
| PATCH | `/admin/online-store/preferences` | ADMIN | Partial update: `storefrontPrivate`, `password` (string sets, `null` clears), `storefrontMessage`, `seoTitle`, `seoDescription`. 400 with `details[]` on invariant / limit violations |
| GET | `/events/:id`, `/venues/:id`, `/events/:id/applications/forms[/:slug]` | None | 403 `StorefrontLockedError` while private without a valid `X-Storefront-Access` |
| POST | `/orders`, `/events/:id/applications` | None | Same gate (by `body.eventId` / `params.eventId`) |
| GET | `/events` | None | Omits events of private storefronts |
| GET | `/organizations/:id/public` | None | Adds `locked` (+ `message` when locked); honours `X-Storefront-Access` |
| GET | `/organizations/:id/public/meta` | None | `{ id, name, title, description, imageUrl }` for `generateMetadata` |
| POST | `/organizations/:id/storefront-access` | None | `{ password }` → `{ token }`; 401 on mismatch or when the store is public; 10 attempts / 15 min per IP + org |

## Database

Five nullable/defaulted columns on `Organization` (see Key Files). Nothing else references them. Full schema: [database-architecture.md](database-architecture.md).

## Gotchas

- **The password hash is omitted globally** by the Prisma client. A query that needs it must pass `omit: { storefrontPasswordHash: false }` or an explicit `select` (both `StorefrontPreferencesService` and `getPublicOrganization` do). `GET /organizations/:id`, `/admin/settings/business-details` etc. therefore stay clean without per-route stripping.
- **Full lockout, enforced by the backend.** Any new public storefront route must add the gate (`gateByEventParam` etc.); the Next middleware is not involved, so pages on a tenant host are covered only because every page calls a gated API. Buyer account (`/buyer/me/*`), order confirmation and application status links are deliberately not gated — the person already transacted.
- **A locked 403 is not an error state on storefront pages**: check `storefrontLockFrom(err)` before falling into the generic error branch, and refetch after `onUnlocked`.
- **Typing a password flips Private mode on** in the form (and the hint warns when a password is saved while private mode is off) — a saved password alone does not protect anything; `storefrontPrivate` is the only gate.
- **Private mode needs a password**: `PATCH { storefrontPrivate: true }` without an existing or supplied password is a 400; so is `{ password: null }` while private. The admin page mirrors this (Save disabled + hint) and the e2e mock enforces it.
- **Tokens live in `localStorage`, per browser**, not in a cookie: they never reach the Next server, so `generateMetadata` and any future SSR of the storefront cannot rely on them.
- **`generateMetadata` needs the backend from the Next server.** In e2e (mocked at the browser) the fetch fails fast and the default title is used; that is expected.
- **`page.tsx` under `organizations/[orgId]` is now a server component.** Client logic lives in `OrganizationStorefront.tsx`; do not add `'use client'` back to `page.tsx` or the metadata export breaks.
- Limits are mirrored in the frontend page (`MESSAGE_MAX`, `PASSWORD_MIN/MAX`, and `SEO_*_MAX` imported from `PageForm.tsx`); change `backend/src/utils/pageLimits.js` too.
- `tests/unit/eventService.test.js` asserts the discovery `where` clause including the `storefrontPrivate` filter.
- Do not run Prettier `--write` on `backend/src/api/routes/admin.js`, `organizations.js` or `OrganizationService.js` — they are not Prettier-clean and the rewrite is hundreds of lines.

## Related Features

- [Online Store Pages](online-store-pages.md) — sibling nav item; shares the SEO limits and the listing preview pattern
- [Organization Branding](organization-branding.md) — cover image doubles as the sharing image; logo/brand color style the password page
- [Custom Domains](custom-domains.md) — `/` on a tenant host is the gated page
- [Storefront Language Redirection](storefront-language-redirection.md) — the *Automatic redirection › Language* section, shipped separately
