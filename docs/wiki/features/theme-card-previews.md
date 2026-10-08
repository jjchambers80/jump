# Theme Card Previews

**Status**: Implemented
**Last Updated**: 2026-10-08

## Overview
The Online Store page shows what each theme actually looks like. The live theme card shows the store's real home page at desktop and phone size, and each draft theme row shows a small live preview of that draft's home page. Previews are live renders, not stored screenshots, so they always show the latest save.

Shipped in PR #353 (live card) and PR #355 (draft rows). This is the thumbnail half of spec 038 contracts C7 (`specs/038-theme-editor/contracts.md`, plan §9a.5).

## Key Files
| File | Purpose |
|------|---------|
| `frontend/src/app/admin/online-store/ThemeScreenshot.tsx` | Renders a page in an inert iframe, scaled to the container width. The iframe is a fixed 1280×800 (desktop) or 390×844 (mobile) viewport, scaled with a `ResizeObserver` |
| `frontend/src/app/admin/online-store/ThemesOverview.tsx` | Live card: desktop preview on a gray panel with a phone frame overlapping bottom-right. Draft rows: desktop preview on the left of each row. Loads `themesApi.thumbnails()` with the theme list |
| `frontend/src/app/theme-thumbnail/[orgId]/page.tsx` | Server page that renders a draft's home page from a `?t=` thumbnail token. It never reads or sets cookies, shows no preview bar, is `noindex`, and returns 404 otherwise |
| `frontend/src/theme/server/storefront.ts` | `storefrontGet` / `loadStorefrontFrame` take `{ thumbnail }`. With it, only `X-Theme-Thumbnail` is sent: no store-access or preview cookie is forwarded |
| `frontend/src/theme/ThemeFrame.tsx` | Hides `PreviewBar` when `preview.thumbnail` is set |
| `backend/src/services/ThemePreviewService.js` | `thumbnails(orgId)` mints one token per draft. `verify(token, orgId, audience)` checks preview or thumbnail tokens |
| `backend/src/api/routes/themes.js` | `GET /admin/themes/thumbnails` (registered before `/:themeId`) |
| `backend/src/api/routes/organizations.js` | Render endpoint reads `X-Theme-Thumbnail` before `X-Theme-Preview` |
| `backend/src/utils/redirectPath.js` | `/theme-thumbnail` is a reserved path, so a URL redirect can never shadow it |

## Configuration
None new. Thumbnail tokens use the same key as preview links.

| Variable | Required | Description |
|----------|----------|-------------|
| `STOREFRONT_PREVIEW_SECRET` | No | HS256 key for preview and thumbnail tokens. Unset: derived from `AUTH_SECRET` |
| `THEME_EDITOR_ENABLED` / `NEXT_PUBLIC_THEME_EDITOR_ENABLED` | Yes (for themes) | The Online Store themes page and the themed render only exist with the themes master switch on |

## How It Works

**Live theme card**
1. `ThemeScreenshot` frames the store's public home page (`/organizations/<slug>`) twice: desktop and mobile.
2. Each frame is `aria-hidden`, `tabIndex={-1}`, `pointer-events: none` and `loading="lazy"`, so it can't be focused or clicked.
3. Each page load renders the current live theme. Nothing is captured on save.

**Draft rows**
1. A draft is not on the public store, and the preview cookie (`jump_theme_preview`) is one per browser, so neither can feed several cards at once.
2. `ThemesOverview` calls `GET /admin/themes/thumbnails` → `{ thumbnails: { [draftId]: "/theme-thumbnail/<orgId>?t=<token>" } }`. Each token is HS256, `aud: 'theme-thumbnail'`, `{ orgId, themeId, page: 'home' }`, and expires after 10 minutes.
3. The iframe loads `/theme-thumbnail/<orgId>?t=…`. The Next server calls the render endpoint with `X-Theme-Thumbnail: <token>` only.
4. The backend verifies the token against the org and renders that draft past a private store's gate. It marks `preview: { …, thumbnail: true }`.
5. The page renders `ThemedStorefront` with no preview bar. A missing, forged, expired or published-theme token gets a 404 instead.
6. If the thumbnails call fails, draft rows show a gray placeholder. The previews are decorative.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/themes/thumbnails` | Org staff (themes enabled) | Thumbnail path per draft (`UNPUBLISHED`) theme, 10-minute tokens |
| GET | `/organizations/:id/public/storefront/render` | None + `X-Theme-Thumbnail` | With a valid thumbnail token, renders that draft past the store gate |
| GET | `/theme-thumbnail/:orgId?t=` (frontend) | Token | Draft home page for the card iframe; 404 without a valid token |

## Database
None. Reads `Theme` rows (`role: 'UNPUBLISHED'`). See [database-architecture.md](database-architecture.md).

## Gotchas
- **Two audiences, one secret.** A thumbnail token is never accepted as a preview token, and the reverse is also true (contract test `themePreview.test.js`). Keep the `audience` argument when calling `verify`.
- **Thumbnails bypass the store password**, like staff preview links. Only staff of that organization can mint them, and they last 10 minutes. Never lengthen the expiry or let a share flow hand them out.
- **The live card frames the public URL**, so a password-protected store's live card shows the password page. Draft rows don't have this problem.
- **Tokens expire after 10 minutes.** An Online Store tab left open still shows its loaded frames, but a frame that reloads after that gets a 404. `load()` mints fresh tokens.
- **Route order:** `/admin/themes/thumbnails` must stay above `router.get('/:themeId')`, or `thumbnails` is read as a theme id.
- **Tenant hosts:** `/theme-thumbnail` is not in `storefrontHost.ts`, so it returns 404 on a custom domain by default. The admin page always runs on the platform host.

## Related Features
- [Theme Developer CLI](theme-developer-cli.md): draft themes, preview links and the `jump_theme_preview` cookie
- [Theme Code Editor](theme-code-editor.md)
- [Storefront Theme Sections](theme-sections.md)
- [Online Store Preferences](online-store-preferences.md): store password and the gate thumbnails bypass
- [URL Redirects](url-redirects.md): reserved paths
