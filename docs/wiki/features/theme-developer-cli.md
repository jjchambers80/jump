# Theme Developer CLI (Draft Themes, Preview Links, Developer Tokens)

**Status**: Implemented (spec 043, plus spec 038 cards J2 and K)
**Last Updated**: 2026-10-03

## Overview
A developer signs in to a store from the terminal with `npx jump login`, pulls the online store theme as JSON files, edits them by hand or by prompting their own AI assistant, and pushes to a private **development theme** they can preview before publishing. The workflow is modelled on `shopify theme dev`. Jump makes no LLM calls: the AI is the developer's own agent working on local files, and Jump supplies sign-in, file sync, validation and preview.

Three pieces make it work:
- **Draft themes** (038J2): an organization keeps up to 20 themes. One is live (`MAIN`); the rest are drafts (`UNPUBLISHED`) that can be duplicated, renamed, deleted and published.
- **Preview links** (038K): a signed link renders a draft on the real storefront without touching the live theme.
- **Developer tokens** (043A) and the **`@jump/cli` package** (043B): a browser sign-in issues a `jmp_` token that works only on the themes API.

## Key Files
| File | Purpose |
|------|---------|
| `packages/cli/bin/jump.js` | `jump` executable (run from the monorepo as `npx jump`) |
| `packages/cli/src/commands.js` | All commands: login, logout, whoami, theme list/pull/check/push/dev/preview/publish |
| `packages/cli/src/login.js` | Loopback listener + PKCE S256 + opens the browser |
| `packages/cli/src/themeDir.js` | Theme folder layout, lock file, change diff, local validation, agent kit (`AGENTS.md`/`CLAUDE.md`), `.jump/schema.json` |
| `packages/cli/src/config.js` | Credentials file (`~/.config/jump/credentials.json`, mode 0600) |
| `packages/cli/src/client.js` | `fetch` wrapper with the bearer token; `ApiError` carries the backend `code` |
| `backend/src/api/routes/developer.js` | Authorize, token exchange, whoami, self-revoke, Settings › Developers list/revoke |
| `backend/src/services/DeveloperTokenService.js` | Codes, PKCE check, token issue/authenticate/revoke, membership check |
| `backend/src/middleware/developerToken.js` | `allowDeveloperToken(scope)`: the only way a token is accepted |
| `backend/src/api/routes/themes.js` | Themes API; mounts `allowDeveloperToken('themes')`, draft routes, `preview-link` |
| `backend/src/services/ThemeService.js` | `rename`, `duplicate`, `publish`, `remove` (theme library section) |
| `backend/src/services/ThemePreviewService.js` | Mints and verifies preview tokens |
| `backend/src/api/routes/organizations.js` | `GET /organizations/:id/public/storefront/render` reads `X-Theme-Preview` |
| `frontend/src/app/admin/cli/authorize/page.tsx` | "Allow Jump CLI to edit themes for *Org*?" approval page |
| `frontend/src/app/admin/settings/developers/page.tsx` | Settings › Developers: token list + Revoke |
| `frontend/src/app/admin/online-store/ThemesOverview.tsx` | Online Store › Themes: draft list, duplicate/rename/delete/publish, Preview and Share preview |
| `frontend/src/app/api/storefront/preview/route.ts` | Turns `?token=` into the `jump_theme_preview` cookie; Exit expires it |
| `frontend/src/theme/PreviewBar.tsx` | Bar shown on a previewed storefront page, with Exit |
| `packages/theme/src/limits.js` | `THEMES_PER_ORG = 20` |

## Configuration
| Variable | Required | Description |
|----------|----------|-------------|
| `THEME_EDITOR_ENABLED` / `NEXT_PUBLIC_THEME_EDITOR_ENABLED` | Yes | Themes master switch (spec 038). The org's `themesEnabled` flag must also be on, or every themes route is 404 |
| `STOREFRONT_PREVIEW_SECRET` | No | HS256 key for preview tokens. Unset: derived from `AUTH_SECRET` with an HMAC label, never the raw session key |
| `RATE_LIMIT_DEVELOPER_TOKEN_LIMIT` / `_WINDOW_MS` | No | Override the `POST /developer/token` limiter (default 20 per 15 min per IP) |
| `JUMP_APP_URL` / `JUMP_API_URL` | No (CLI) | App and API base URLs for `jump login`. Default production (`https://frontend-production-43e9.up.railway.app` / `https://backend-production-7d5c.up.railway.app`); set them to `http://localhost:3001` / `http://localhost:3000` for local dev, or pass `--app-url` / `--api-url` per run |
| `JUMP_CONFIG_DIR` | No (CLI) | Credentials directory. Default `$XDG_CONFIG_HOME/jump` or `~/.config/jump` |

## How It Works

### Sign-in (RFC 8252 loopback + PKCE)
1. `jump login --store <slug>` starts a listener on `127.0.0.1:<random port>` and opens `/admin/cli/authorize?store=&redirect_uri=&state=&code_challenge=&name=` (name defaults to `Jump CLI on <hostname>`).
2. The page sits under `/admin`, so the edge middleware handles sign-in and two-step. It shows the store from `GET /developer/authorize` and asks for approval. Approval runs through `withReauth`, because `POST /developer/authorize` needs `requireRecentAuth`.
3. The backend stores a one-time code (sha256 only, 5 minutes) bound to the PKCE challenge and the loopback `redirectUri`, which must be plain http to `127.0.0.1`, `localhost` or `[::1]` with an explicit port. The browser redirects to the listener with `code` and `state`.
4. The CLI posts `{ code, codeVerifier, redirectUri }` to `POST /developer/token`. The code is burned before any check, so a wrong verifier still uses it up. The response contains the `jmp_` token exactly once: 90 days, scope `themes`, one organization.
5. Credentials are saved per store in `~/.config/jump/credentials.json` (mode 0600).

### Token authentication (deny by default)
- `allowDeveloperToken('themes')` runs only on routers that mount it: today `/admin/themes` and the `/developer/me` and `DELETE /developer/token` routes. It hashes the bearer, rejects revoked, expired or out-of-scope tokens and users who are no longer members, then sets `req.user` with `developerTokenId` and the token's organization. `lastUsedAt` is touched at most once a minute.
- `requireAuth` verifies only session JWTs, so a `jmp_` bearer gets 401 on orders, customers, settings and everything else.
- `X-Jump-Org` cannot move a token to another organization.
- `PUT /admin/themes/rollout` refuses tokens outright.

### Theme folder
```
jump.theme.json        lock: store, themeId, themeName, role, themeVersion, document versions
settings.json          setting overrides of the preset
content.json           default-content overrides
documents/<key>.json   one Puck document per key (header, footer, home, events, …)
.jump/schema.json      every section type and field the AI may use (from @jump/theme)
AGENTS.md, CLAUDE.md   rules for AI assistants, written once, never overwritten
```
Widths are plain JSON too: `settings.json` `layout.pageWidth`, a document's `root.props.pageWidth`, and each section's `props.sectionWidth` (see [Storefront Theme Sections](theme-sections.md#layout-widths)). Folders pulled before this change keep their old `AGENTS.md` (written once); `.jump/schema.json` is rewritten on every pull, so `jump theme pull` picks up the new fields.

`jump theme check` runs the same `@jump/theme` validators as the server and never touches the network.

### Developer loop
1. `jump theme pull`: the live theme, or the theme named in the lock.
2. Edit the JSON yourself or prompt an assistant; the agent kit tells it to edit only these files, use only types in `.jump/schema.json`, never invent `fileId`s, and run `jump theme check`.
3. `jump theme dev` finds or creates `Development (<email>)` by duplicating the live theme, carries the folder onto it, prints a 1-hour preview link, then watches the folder and pushes valid changes (500 ms debounce). It stops on Ctrl+C or SIGTERM.
4. `jump theme push` sends one `PUT /admin/themes/:id/save` with only the changed keys and their versions. A 409 `THEME_CONFLICT` tells the developer to pull again; nothing is overwritten. Pushing to the live theme needs `--live` plus typing the store slug, or `--allow-live` when non-interactive.
5. `jump theme preview [--share]` prints a staff link (1 h) or a share link (14 days).
6. `jump theme publish` swaps the draft to `MAIN` after a confirmation (`--yes` skips it). The old live theme becomes a draft, so going back is one more publish.
7. `jump logout` revokes the token on the server and removes it locally.

### Draft themes and preview
- `duplicate` deep-copies settings, content and every document, and records the copy's Content › Files references. `publish` and `remove` lock the organization row; the live theme cannot be deleted.
- A preview link opens `/api/storefront/preview?token=` on the store's own host. The route keeps the token in the host-only httpOnly `jump_theme_preview` cookie, and the themed server pages forward it as `X-Theme-Preview`. The backend re-verifies it on every render, adds `X-Robots-Tag: noindex`, and when the token is no longer valid it tells the Next server to drop the cookie.
- Staff links pass a private store's password gate, because only signed-in staff can mint them. Share links do not.

## API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/developer/authorize?store=` | Staff (ORGANIZER+) | Store the CLI asked for, if the user may approve for it |
| POST | `/developer/authorize` | Staff + step-up | One-time code for the loopback redirect |
| POST | `/developer/token` | Public, rate limited | Code + PKCE verifier → `jmp_` token (once) |
| GET | `/developer/me` | Developer token | whoami |
| DELETE | `/developer/token` | Developer token | Revoke the calling token (`jump logout`) |
| GET | `/admin/developer-tokens` | Staff | Org's tokens: ADMIN sees all, ORGANIZER only their own |
| DELETE | `/admin/developer-tokens/:id` | Staff | Revoke, effective at once |
| GET | `/admin/themes` | Staff or token | Theme list |
| PATCH | `/admin/themes/:id` | Staff or token | Rename (`themeVersion` check) |
| DELETE | `/admin/themes/:id` | Staff or token | Delete a draft |
| POST | `/admin/themes/:id/duplicate` | Staff or token | Copy to a new draft (409 `THEME_LIMIT` past 20) |
| POST | `/admin/themes/:id/publish` | Staff or token | Make a draft live |
| POST | `/admin/themes/:id/preview-link` | Staff or token | `{ share? }` → `{ url, expiresAt, share }`; drafts only |
| PUT | `/admin/themes/:id/save` | Staff or token | The only write path for theme content (spec 038) |

## Database
- `DeveloperToken`: `organizationId`, `userId`, `name`, `tokenHash` (unique sha256), `prefix`, `scopes String[]`, `lastUsedAt`, `expiresAt`, `revokedAt`. Cascades with its organization and user.
- `DeveloperAuthCode`: `codeHash`, `codeChallenge`, `redirectUri`, `userId`, `organizationId`, `name`, `expiresAt`, `usedAt`.
- Migration `20261024100000_developer_tokens`. Draft themes reuse `Theme.role` (`MAIN` / `UNPUBLISHED`); no schema change for 038J2 or 038K.

See [database-architecture.md](database-architecture.md) for the full schema.

## Gotchas
- **Never widen tokens by accident.** A new scope or a new router that mounts `allowDeveloperToken` needs a contract test proving the token still gets 401 on every other router. See root `AGENTS.md` gotcha 32.
- **Skip `requireAuth` explicitly.** A router that accepts tokens must skip `requireAuth` when `req.user.developerTokenId` is set (see the top of `routes/themes.js`), since `requireAuth` would reject the bearer.
- **Membership is re-checked per request**, so removing someone from the organization kills their tokens immediately. SYSTEM_ADMIN can approve for any active store.
- **The CLI is monorepo-only for now.** It validates with its own `@jump/theme` and writes `.jump/schema.json` from it; there is no server schema endpoint. Publishing `@jump/cli` means publishing or bundling `@jump/theme` too.
- **The live theme has no preview link** (400): view the store instead.
- **`jump theme dev` names the theme by email.** Two people get two development themes, and each counts toward the 20-theme limit.
- **Preview cookie is host-only.** A link minted for a custom domain works only on that domain; the route never redirects off-site (`safePath`).

## Related Features
- [Theme Code Editor](theme-code-editor.md): the same files edited in the browser
- [Storefront Theme Sections](theme-sections.md): section registry the schema dump comes from
- [Account Security](account-security.md): `withReauth` / `requireRecentAuth` step-up used by the approval page
- [Two-step Authentication](two-step-authentication.md): enforced before `/admin/cli/authorize` renders
- [Abuse Protection](abuse-protection.md): `makeLimiter` and the `DEVELOPER_TOKEN` limiter
- [Content Files](content-files.md): image `fileId` references copied by `duplicate`
- [Org Switcher](org-switcher.md): `activeOrgFor(req)`, which tokens pin to one organization
- Plan: `specs/043-theme-developer-access/plan.md`
