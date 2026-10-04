# Spec 043: Theme developer access (Jump CLI + prompt-driven theme edits)

Status: **Built 2026-10-03, in review** · PRs #276 (038J2 draft themes), #277 (038K preview links, stacked on #276), #278 (043A tokens + browser sign-in), 043B (this CLI) · Merge order: #276 → #277 → #278 → 043B

## Delivered vs this plan

- **Schema endpoint dropped.** The CLI builds `.jump/schema.json` from its own `@jump/theme`, so there is no `GET /admin/themes/schema`. The CLI therefore runs from this monorepo (`npx jump`); publishing it to npm means publishing or bundling `@jump/theme` with it.
- **Agent kit** is `AGENTS.md` plus a one-line `CLAUDE.md` (`@AGENTS.md`), not a separate skill folder.
- **No `theme/:id/preview-link` beyond 038K's**: the staff link (1 h) is what `jump theme dev` / `jump theme preview` print; `--share` gives the 14-day link.
- **Defaults** are production (`https://frontend-production-43e9.up.railway.app` app, `https://backend-production-7d5c.up.railway.app` API); local dev sets `JUMP_APP_URL` / `JUMP_API_URL` or passes `--app-url` / `--api-url`.
- 038K thumbnails (`/theme-thumbnail/[orgId]`) are not part of this work.

## Context

Roman (`/Users/jj/Projects/roman`, Shopify Dawn theme) shows the workflow to copy:
- **Auth:** `shopify theme dev|pull|push --store roman-skin.myshopify.com` signs in with an interactive browser login (the developer's own Shopify staff account); the CLI keeps the session. No Theme Access password and no `SHOPIFY_CLI_THEME_TOKEN` in roman. Admin API data scripts use a separate client-credentials flow (`scripts/shopify.js:26-60`), which is out of scope here.
- **Loop:** pull theme files, prompt Claude Code to edit them (skill `.agents/skills/roman-pdp-rollout`), run `shopify theme check`, push to an **unpublished dev theme** (`--theme <id> --only <files>`), review the preview URL (`?preview_theme_id=`), then push live with explicit `--live --allow-live` after recorded approval.
- **Key point:** Shopify has no AI. The AI is the developer's own agent working on local files. The platform supplies auth, file sync, validation and preview.

Jump today (on `origin/main` 1598440; this checkout is detached at 3240a3c and must be updated first):
- A theme is JSON: `Theme.settings` + `Theme.content` overrides + `ThemeDocument` Puck docs keyed `header|footer|home|events|…`.
- The only write is `PUT /admin/themes/:id/save` (`backend/src/api/routes/themes.js`, `ThemeService.save`, contracts C5). It is atomic with optimistic versions (409 `THEME_CONFLICT`), and it validates everything through `@jump/theme` (`validateDocument`, `validateSettings`, `validateContent`). No custom CSS/HTML/code exists (plan D13), so an AI edit can break the look but cannot inject code.
- **Missing:**
  - Draft themes and preview links (038J2/038K) are planned but not built. Every save on MAIN is live.
  - No machine credentials. `requireAuth` (`backend/src/middleware/auth.js:21-90`) accepts only Auth.js session JWTs, and `SCANNER_API_KEY` is global.
  - No CLI package.

**Outcome:** a developer runs `jump login --store <slug>`, `jump theme pull`, then prompts Claude Code (or any agent) to edit the JSON theme files, runs `jump theme check`, `jump theme push` to their dev theme, opens the preview URL, then runs `jump theme publish` or `push --live`. Jump makes no LLM calls; the spec 038 "no AI" non-goal stays true.

User decisions: CLI plus the developer's own AI (not an in-app panel); build draft themes first.

## Phase 0: prerequisites (existing 038 cards, unchanged scope)
- **038J2:** draft themes (duplicate, rename, delete, publish swap, 20-theme limit).
- **038K:** preview token and share link.
- The CLI's dev theme and preview URL depend on both cards. Build them as specified in `specs/038-theme-editor/plan.md` §15 and `contracts.md` C7. Add only one thing: `POST /admin/themes/:id/preview-link` returns a URL usable outside the browser session (needed by the CLI; check whether 038K's staff preview link already covers it).

## Phase 1 (043A): developer tokens and browser login
**Schema** (`packages/db/prisma/schema.prisma`), model `DeveloperToken`:
- Fields: `id`, `organizationId`, `userId`, `name` (e.g. "CLI on jj-mbp"), `tokenHash` (sha256, unique), `prefix` (first 8 characters, for display), `scopes String[]` (only `themes` for now), `createdAt`, `lastUsedAt`, `expiresAt` (90 days), `revokedAt`.
- Short-lived `DeveloperAuthCode`: `codeHash`, `codeChallenge`, `userId`, `organizationId`, `expiresAt` (5 minutes), `usedAt`.

**Login flow:** loopback OAuth with PKCE, the same shape as Shopify CLI and `gh auth login`.
1. The CLI starts `http://127.0.0.1:<random port>/callback` and opens `<FRONTEND_URL>/cli/authorize?store=<slug>&port=&state=&code_challenge=`.
2. The frontend page `frontend/src/app/cli/authorize/page.tsx` asks for a staff session (edge middleware already redirects to sign-in; two-step is respected). It checks the user is ORGANIZER+ in that org and shows "Allow Jump CLI to edit themes for *Org*?". Approval goes through `withReauth` (`app/admin/account/useReauth.tsx`).
3. `POST /developer/authorize` (`requireAuth`, `requireRecentAuth`, membership check) stores the code and returns it. The page redirects to `http://127.0.0.1:<port>/callback?code=&state=`. Only a `127.0.0.1`/`localhost` redirect is allowed.
4. The CLI calls `POST /developer/token { code, code_verifier }` (public; rate-limited with `makeLimiter`, new limiter name `DEVELOPER_TOKEN`). The backend checks the PKCE S256 challenge, marks the code single-use and returns `jmp_<random 32 bytes>` exactly once.

**Token auth:** deny by default.
- New middleware `allowDeveloperToken('themes')` in `backend/src/middleware/developerToken.js`, mounted only on the themes router before `requireAuth`.
- For an `Authorization: Bearer jmp_…` header it:
  - hashes the token and looks it up;
  - rejects it if revoked, expired, missing the scope, or if the user is no longer an ORGANIZER+ member of that org;
  - sets `req.user = { id, role, organizationId, sid: null, developerTokenId }` and the active org;
  - updates `lastUsedAt` at most once a minute.
- `requireAuth` itself rejects any `jmp_` bearer. On every other router a token is treated as an invalid JWT, so it cannot reach orders, refunds or settings.
- Check how `activeOrgFor(req)` (`backend/src/api/routes/adminScope.js`) reads the org, and set the same field.
- Not allowed with a developer token: `PUT /rollout`, and publish without `--live` confirmation. Publish is allowed with a token, because roman's `--allow-live` equivalent is the CLI's own confirmation.

**Management UI:**
- `Settings › Developers` (`frontend/src/app/admin/settings/developers/page.tsx`) lists the org's tokens (name, user, prefix, last used, expires) with a Revoke button.
- Backend routes `GET/DELETE /admin/developer-tokens`: ADMIN can see and revoke every token in the org; ORGANIZER sees only their own.
- Revoking a token takes effect immediately, because there is no cache.
- ponytail: no Theme Access-style token minting for CI in phase 1. Add a "Create token" button later if CI pushes are wanted.

**Tests:** contract tests in `backend/tests/contract/developerTokens.test.js` covering:
- PKCE mismatch, code reuse, expired code, non-loopback redirect refused;
- the token works on `/admin/themes/*` and gets 401 on `/admin/orders`;
- revoked token, removed membership, cross-org theme 404.

## Phase 2 (043B): `@jump/cli` package
New workspace `packages/cli`: plain ESM Node, `bin: { jump: "bin/jump.js" }`. It depends on `@jump/theme` for offline validation and uses only Node built-ins: `fetch`, `node:http` loopback, `node:crypto` PKCE, `util.parseArgs`, `fs.watch`, `open` via `child_process`. No new dependencies.

**Credentials:** `~/.config/jump/credentials.json`, mode 0600, keyed by store `{ apiUrl, organizationId, token, name }`. `--api-url` overrides the default production API.

**Commands:**
- `jump login --store <slug>` / `jump logout` (revokes on the server) / `jump whoami`.
- `jump theme list`: id, name, role, updated.
- `jump theme pull [--theme <id>|--live]` writes to the current directory:
  ```
  jump.theme.json          # { store, themeId, themeVersion, documents: { key: version } }  (lock, versions for 409)
  settings.json            # overrides only
  content.json
  documents/<key>.json     # Puck data per document key
  .jump/schema.json        # section registry + settings schema dump (what the AI may use)
  AGENTS.md                # generated: file layout, rules, commands (if absent)
  ```
- `jump theme check` runs the same `@jump/theme` validators locally and prints per-key errors in the 400 format. It never touches the network.
- `jump theme push [--theme <id>]` diffs against the lock, sends one `/save` with only the changed keys plus their versions, and updates the lock.
  - Default target is the developer's dev theme. `--live` targets MAIN and requires an interactive "type the store slug" confirmation, or `--allow-live` for non-interactive use, as in roman.
  - On 409 it tells the user to `jump theme pull` and does not overwrite anything.
- `jump theme dev` finds or creates an UNPUBLISHED theme named `Development (<user name>)` by duplicating MAIN (038J2). It watches the directory, runs `check` then `push` on each change (debounced 500 ms), and prints the preview URL once.
- `jump theme publish [--theme <id>]` uses the 038J2 publish swap after a confirmation.

**Schema dump:**
- Backend `GET /admin/themes/schema` returns the registry from `@jump/theme`: section types, fields, allowed groups and limits. It reuses `registry.js`/`settings.js`/`limits.js` exports and adds no new source of truth.
- The CLI writes the result to `.jump/schema.json`. This is how a prompted agent knows what it may write.

**Tests:** CLI unit tests (`node --test`, in the existing style) for lock diffing, PKCE, 409 handling and credential file mode. Run them in CI with the backend unit job.

## Phase 3 (043C): agent kit + docs
- `jump theme pull` drops a short `AGENTS.md` and `.claude/skills/jump-theme/SKILL.md` (only if they don't exist). Content:
  - edit only `settings.json`, `content.json` and `documents/*.json`;
  - use only section types and fields in `.jump/schema.json`;
  - run `jump theme check` after every edit;
  - push to the dev theme; never `--live` without the user's say-so;
  - images are `{ fileId }` refs to Content › Files and cannot be invented.
- Docs:
  - `/doc-feature`, producing `docs/wiki/features/theme-developer-cli.md`;
  - an `AGENTS.md` gotcha (tokens are deny-by-default and only `allowDeveloperToken` routers accept them);
  - env table rows if any are added.
- `specs/043-theme-developer-access/plan.md` holds this plan, with Kanban cards 043A/B/C after 038J2 and 038K.
- Vault note: `Personal/10_Projects/jump--decision--theme-developer-cli.md`, linking to the roman research and the spec.

## Critical files
- New:
  - `backend/src/middleware/developerToken.js`
  - `backend/src/services/DeveloperTokenService.js`
  - `backend/src/api/routes/developer.js` (authorize, token, admin list/revoke), registered in `server.js`
  - `frontend/src/app/cli/authorize/page.tsx`
  - `frontend/src/app/admin/settings/developers/page.tsx`
  - `packages/cli/*`
- Changed:
  - `backend/src/api/routes/themes.js` (mount `allowDeveloperToken('themes')`, add `/schema`)
  - `backend/src/middleware/auth.js` (reject `jmp_` bearers)
  - `packages/db/prisma/schema.prisma` plus a migration
  - `frontend/src/services/api.ts`
  - root `package.json` workspaces
- Reuse:
  - `ThemeService.save` / validators (no new write path)
  - `requireRecentAuth` + `withReauth`
  - `makeLimiter` (spec 020)
  - `resolveOrgScope` / `OrganizationMember` membership checks
  - `@jump/theme` validators in the CLI

## Verification
1. `cd backend && npm test`: the new developer-token contract tests pass, and the existing themes tests are unchanged.
2. `node --test packages/cli`.
3. Manual end-to-end against local dev, with the pilot org on `themesEnabled` and `THEME_EDITOR_ENABLED=true`:
   - `npx jump login --store <slug> --api-url http://localhost:3000` signs in through the browser and writes the credential file.
   - `jump theme pull`, then prompt Claude Code "make the hero headline 'Retro night' and add an UpcomingEvents section", then `jump theme check`.
   - `jump theme dev`: open the preview URL and see the change; the live storefront is unchanged.
   - `jump theme publish`: the live site updates and the revision appears in the editor's History.
   - Revoke the token in Settings › Developers; the next CLI call gets 401.
   - `curl -H "Authorization: Bearer jmp_…" localhost:3000/admin/orders` returns 401.
4. CI green: ci.yml + e2e.yml, plus one Playwright spec for `/cli/authorize` (mocked API, `signInAsStaff`).
