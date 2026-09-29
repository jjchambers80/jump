# Spec 038 architecture contracts

Status: **Agreed** · Written 2026-09-28 by card 038-0 · Source: plan §9a, checked against main at `1a36974` (#223) and proven by the spike (`spike.md`, branch `spike/038-puck`).

These are the rules every 038 implementation card builds on. A card that needs to change one updates this file in its own PR and says so in the PR description. Where the spike changed a rule from the plan, the change is marked **(spike)**.

## Acceptance conditions (second review)

| # | Condition | Where |
|---|---|---|
| 1 | The render route is `GET /organizations/:id/public/storefront/render`, gated by `gateByOrgParam` on `:id` | C1 |
| 2 | No shared render cache in the MVP; access is never cached | C3, C4 |
| 3 | `syncReferences` takes `{ tx, onlyFields }` | C6 |
| 4 | SSR fixture server for Playwright | C9 |
| 5 | Revisions are full-state and `/save` can delete a document | C5 |
| 6 | Per-org rollout and the renderer kill switch | C10 |
| 7 | Preview redirect per host, private-store rules for preview/share/thumbnail, cookie clearing through route handlers, thumbnail mode in HTML, no flash claim for checkout/apply, 16 MB `theme.json` cap on export and import | C2, C4, C7, C8, C11 |

## C1. Render route and store gate

- Route: `GET /organizations/:id/public/storefront/render?page=<key>` in `backend/src/api/routes/organizations.js`, beside `/:id/public/pages/:slug`, with `gateByOrgParam`.
- **The parameter is `:id`.** `gateByOrgParam` reads `req.params.id` and passes it as `organizationIdentifier` (id **or slug**, `StorefrontPreferencesService.organizationIdFor`). Under any other name the identifier is `undefined`, `organizationIdFor` returns null and `assertAccess` returns without checking.
- Test 14 calls the route **as registered in `server.js`** for a private org with no token and expects the gate.
- Response shapes:
  - `{ renderer: 'legacy' }`: the org is not in the rollout (C10). No theme data.
  - `{ locked: true, organization: { id, slug, name, logoUrl, brandColor, themeMode }, message }`: private store and no valid token. Sent with `Cache-Control: private, no-store`. The status is 200 so the Next server renders the gate without error handling; `/public` already answers `locked: true` the same way.
  - `{ renderer: 'theme', organization, settings, content, documents: { header, template, footer }, resolved, preview? }`: hidden items and out-of-window announcements already removed.
- The org behind `:id` may be addressed by slug. The response always carries `organization.id`; the frontend uses it for cookie names and unlock calls.

## C2. Private store access on the server

- **Unlock:** Next route handler `POST /api/storefront/access/[orgId]` (storefront host) proxies `POST /organizations/:id/storefront-access`. `[orgId]` is the organization **id** (the backend unlock looks up by id only).
- **Cookie:** `jump_store_access_<orgId>`, `httpOnly`, `Secure` outside development, `SameSite=Lax`, `Path=/`, host-only (no `Domain`). `Max-Age` = the token's own remaining lifetime, read from its `exp` claim (30 d today, `ACCESS_TOKEN_TTL`). **(spike)** The backend returns only `{ token }`; there is no `expiresIn` field.
- **Forwarding (spike):** the server component forwards **every** `jump_store_access_*` cookie, at most 10, comma-separated, as `X-Storefront-Access`. The page URL may carry the slug while the cookie is keyed by id, and the backend already accepts up to 10 tokens (`MAX_TOKENS_PER_REQUEST`), exactly as the browser does today with its `localStorage` tokens.
- **Clearing:** a Server Component cannot delete cookies in Next 14. When a cookie was forwarded and the answer is `locked`, the gate mounts a client island that calls `DELETE /api/storefront/access/[orgId]` (route handler, `Max-Age=0`). Proven by the spike test "stale cookie cleared".
- **Transition:** `StorefrontPasswordGate` keeps writing `localStorage` too, because checkout and account stay client-rendered. The backend gate is unchanged.

## C3. Server fetches

- Every storefront render fetch uses `cache: 'no-store'` and a 5 s timeout. Reading `cookies()` makes the route dynamic, so the Full Route Cache never holds a themed page.
- **Server-side base URL (spike):** `INTERNAL_API_URL ?? NEXT_PUBLIC_API_URL`. `INTERNAL_API_URL` is optional (Railway private networking later); nothing sets it today.
- `generateMetadata` keeps its own short fetch (`/public/meta`, 2 s, `revalidate: 60`). It carries no access data and is safe to cache.

## C4. Cache contract

- **MVP: no shared render cache.** One backend read per page view.
- Backend render responses carry `Cache-Control: private, no-store` whenever a token (access, preview or thumbnail) was presented or the answer is `locked`. Preview and thumbnail responses also carry `X-Robots-Tag: noindex`.
- Card 038P (optional) may add a cache only with the three preconditions of plan §9a.3 and the revalidation contract of plan §9a.4 (`STOREFRONT_REVALIDATE_SECRET`, `aud: 'storefront-revalidate'`, 60 s token, `revalidateTag('storefront:<orgId>')`).
- Measured (spike): uncached server render of a 20-section page, fixture API on the same machine, `next start`: p50 61 ms, p95 89 ms; 4 sections: p50 21 ms. Backend query time is measured in 038A with a budget of p95 ≤ 150 ms for the render endpoint on the dev database.

## C5. Atomic save and revisions

- `PUT /admin/themes/:id/save` with `{ themeVersion, settings?, content?, documents?: { [key]: { data, version } } }` is the only write for editor content. `data: null` deletes the row (preset default applies again); `version: 0` means "does not exist yet".
- One `prisma.$transaction` with `SELECT … FOR UPDATE` on the theme row: versions (409 `THEME_CONFLICT` with the current versions, nothing written) → validation and sanitising (400 with per-key errors, nothing written) → writes → `syncReferences` on the transaction client (C6) → on a MAIN theme, one `ThemeRevision`.
- `Theme.version` goes up when settings, content or the name change. A document's `version` goes up when that document is sent.
- **Revisions are full state:** `snapshot = { settings, content, documents: { key: data } }` after the save; a key missing from `documents` means "no stored row". `changedKeys` labels the list. The last 50 per theme are kept, pruned in the same transaction.
- **Restore** = one `/save` of the snapshot: settings, content, every snapshot document, and `data: null` for every stored document missing from the snapshot. It writes its own revision.
- Measured (spike): a realistic full snapshot (8 schemes, rich 20-section home, events/event/blog/post documents) is 27 KB; 50 revisions ≈ 1.3 MB per org. No content-hash side table is needed.

## C6. File references

- `ContentRefKind` gains `THEME`; `targetId` = theme id; `field` = `settings`, `content` or a document key.
- `fileIdsInThemeJson(value)` in `@jump/theme` walks the whole value and collects every `{ fileId }` plus ids inside rich-text HTML (`fileIdsInHtml`).
- `StoreFileService.syncReferences(kind, targetId, fields, organizationId, { tx, onlyFields } = {})`:
  - a field value may be a string (id or HTML, as today) **or an array of ids**;
  - with `tx`, every query runs on the caller's transaction client (today it opens its own `prisma.$transaction` on the global client and would commit even if the outer save failed);
  - with `onlyFields`, it deletes only rows whose `field` is listed (today it deletes every row of the target, so saving `home` alone would drop the header's references).
- Existing `PAGE` / `BLOG_POST` callers pass neither option and keep today's behaviour. Test 15 covers both new options.

## C7. Preview tokens vs thumbnails

| | Interactive preview | Thumbnail |
|---|---|---|
| Token | HS256 `STOREFRONT_PREVIEW_SECRET`, `{ aud: 'theme-preview', orgId, themeId, share, exp }`; staff 1 h, share 14 d | Same secret, `{ aud: 'theme-thumbnail', orgId, themeId, page: 'home', exp: now + 10 min }` |
| Transport | `/api/storefront/preview?token=` sets host-only `jump_theme_preview` (httpOnly, `SameSite=Lax`), then redirects to `/organizations/:slug` on the platform host or `/` on a tenant host; forwarded as `X-Theme-Preview` | Query param on **`/theme-thumbnail/[orgId]?t=`**, forwarded as `X-Theme-Thumbnail`; never sets or reads cookies |
| Private store | Staff token passes the gate; share token does not (the visitor unlocks with the password first) | Passes the gate |
| Theme mode | `ThemeScope` script (C8) | **(spike)** No script runs in the sandbox: the page writes `class="dark"` (or `light`) on an **outer wrapper `div`**, not on `<html>` |
| Checked each render | Theme exists, belongs to `orgId`, not MAIN (a published theme shows live, no bar) | Theme exists and belongs to `orgId` |

- **(spike) The route is `/theme-thumbnail/[orgId]`, not `/_thumbnail`.** App Router treats `_folder` as a private folder, so `/_thumbnail` can never be a route.
- **(spike) Mode on a wrapper, not `<html>`.** The root layout owns `<html>`, and a nested page cannot set its class. Tailwind 3.4's class strategy matches any `.dark` ancestor, and `globals.css` has `.dark .brand-scope`, so the wrapper must be an ancestor of the `ThemeScope` div, not the same element.
- `/theme-thumbnail` is added to `isReservedPath` (backend) and `storefrontHost.ts` (frontend), is excluded from tenant routing and redirects, answers 404 without a valid token, and is `noindex`.
- Proven (spike): five sandboxed thumbnails load at once, each its own theme; the DARK one is dark with no script; the private one renders the theme, not the gate.

## C8. Server-safe theming (`ThemeScope`)

- `ThemeScope` (server component) renders the `brand-scope` wrapper with brand, scheme, font and theme-setting CSS variables and `data-theme-mode`.
- When the org forces a mode, it emits a blocking inline script built **only from the `ThemeMode` enum**. Before first paint it sets `dark`/`light` on `<html>`, `color-scheme`, and **(spike)** `document.documentElement.dataset.jumpForced = 'light' | 'dark' | 'system'`.
- **(spike) `ThemeProvider` reads `data-jump-forced` for its initial `forced` state** (and `matchMedia` for its initial system theme). Without this, next-themes applies the visitor's theme in its first effect before `ThemeModeSync` forces the org mode, and a DARK page flips to light for a frame after hydration. The spike reproduced that flip and fixed it this way. `setForced(null)` also deletes the attribute, so the visitor's choice returns on other pages (gotcha 7).
- `ThemeModeSync` (client) calls `setForced` after hydration and releases on unmount, as today.
- `BrandScope` keeps its API for checkout, apply and account and becomes `ThemeScope` + `ThemeModeSync` internally. **No no-flash guarantee on those pages**: they learn the mode only after a client fetch. Test 12 covers themed routes only.
- Proven (spike): first-paint class equals the final class for LIGHT, DARK and SYSTEM (OS light and dark), with no later flip; a control test shows today's `BrandScope` does flash, so the probe detects it; no hydration warnings.
- If a CSP is added later, the script needs a nonce.

## C9. SSR fixture server for Playwright

- `frontend/e2e/fixtures/server.mjs`: a Node HTTP server with canned JSON per organization id under `frontend/e2e/fixtures/storefront/`, no network, no Postgres, no Stripe. It implements the render route (with the `gate` rule and thumbnail bypass) and the unlock route.
- **(spike) It listens on the API port the e2e job already sets (`NEXT_PUBLIC_API_URL=http://localhost:3002`).** No new env var: the Next server's own fetches reach it, and browser-side `page.route` mocks still win because Playwright intercepts inside Chromium.
- Playwright starts it through a second `webServer` entry (`url: …/health`). The fixture set is the organization id in the URL, so tests stay independent across the 3 shards without headers.
- 038B migrates every storefront spec that loads a server-rendered route and adds the fixture server to `frontend/playwright.config.ts`.

## C10. Rollout and kill switch

- Master switch: backend `THEME_EDITOR_ENABLED`, frontend `NEXT_PUBLIC_THEME_EDITOR_ENABLED`, default off. Off → every org renders through the legacy client components and has no editor, whatever `themesEnabled` says.
- Per org: `Organization.themesEnabled Boolean @default(false)`, changed by `SYSTEM_ADMIN` only. The render endpoint answers `renderer: 'legacy'` when either is off; the page then renders today's component.
- Legacy components stay until every org is on themes, 038H has shipped and one release has passed.

## C11. Import/export ceiling

- `theme.json` ≤ 16 MB on **both** export (refused with a clear error) and import; each document inside ≤ 256 KB, settings and content at their save limits; zip ≤ 50 MB, ≤ 200 images, uncompressed ≤ 200 MB with a ratio check; entries limited to `theme.json` and `images/<sha256>.<ext>`.

## C12. Editor (Puck) integration

- `@puckeditor/core` pinned to **exactly `0.23.0`**, imported only through `frontend/src/theme/editor/puck.ts` (editor) and `@puckeditor/core/rsc` (server `Render`).
- **Config split:** `renderConfig` (no `'use client'`, render functions + slot declarations only; `Render` needs the slot fields) is shared by the server and the editor; `editorConfig` (`'use client'`) spreads it and adds fields, defaults, permissions and editor-only wrappers. Sections are presentational and read resolved data from Puck `metadata`.
- **One tree, three documents:** root props `header` / `template` / `footer` are slot fields with `allow` lists. Save splits them into the `header`, template/page and `footer` documents.
- **(spike) Theme settings live in `root.props.themeSettings` while editing**, written with `dispatch({ type: 'setData', recordHistory: true })`. Puck's own undo/redo then covers them, so no second history is needed; Save moves them to `Theme.settings`, and the editor's root render applies them as CSS variables on the canvas.
- **(spike) Puck always injects its default `blocks` and `outline` plugins.** A plugin with the same `name` replaces one, so Jump's Sections tree is registered as `name: 'outline'`.
- **(spike) The plugin rail items are not buttons** in 0.23 (no role, no tabindex): the rail is mouse-only. 038D renders its own labelled rail buttons that call `dispatch({ type: 'setUi', ui: { plugin: { current } } })` and hides Puck's rail.
- **(spike) `ui` on `<Puck>` is initial state only.** Toggles (inspector/interactive mode, viewport) go through `setUi`.
- **(spike) Slots render their own wrapper element.** Layout classes go on the slot (`<Blocks className="flex gap-3" />`), not on a parent.
- **(spike) Tailwind must scan `src/theme/**`** (`tailwind.config.js` `content`), or section classes are missing in both the storefront and the iframe.
- **(spike) Header and footer fetch menus on the client today.** Sections receive server-resolved menus; `OrganizationHeader` takes an optional `menus` prop and skips its fetch when given.
- Selecting a nested block on the canvas takes two clicks (the first selects the section). The outline selects either in one.
- Puck's slot `allow` is enforced by drag and drop only; `dispatch` can insert anything. The server `validateDocument` is the authority.
