# Spike 038-0: Puck theme editor (report)

Date: 2026-09-28 · Branch: `spike/038-puck` (commit `df2381f`, throwaway, not for merge) · Base: main `1a36974` · Stack: Next 14.2.35, React 18.3, Tailwind 3.4.19, `@puckeditor/core` 0.23.0

## Verdict: **GO**, with the contract changes listed below

Puck 0.23 runs in our stack with no workaround. Its server `Render` works in a Next 14 Server Component, the editor handles three root slots and nested blocks, and theme settings fit inside Puck's own undo history. Everything the MVP needs was proven with real Jump components (`OrganizationHeader`, `EventStub`, brand tokens) by 22 Playwright tests. The dnd-kit fallback is not needed.

Two things 038D must build itself, because Puck's defaults are not good enough: a keyboard-operable plugin rail and the Sections outline. Both are small and were prototyped in the spike.

## What was built

| Piece | Spike file | Plan section |
|---|---|---|
| Presentational sections (Header, AnnouncementBar, Hero with `Button` blocks, RichText, EventList, Footer) | `frontend/src/theme/spike/sections.tsx` | §7 |
| RSC-safe render config + editor config | `config.render.tsx`, `config.editor.tsx` | §9a, C12 |
| Editor: plugin rail (Sections, Add, Theme settings), viewports, inspector toggle, Save split | `SpikeEditor.tsx`, `SectionsOutline.tsx`, `/spike/editor` | §11, D19, D20 |
| Server storefront page with the gate, unlock and clearing | `/spike/storefront/[orgId]`, `/api/storefront/access/[orgId]` | §8, §9a.1 |
| `ThemeScope` + `ThemeModeSync` + `ThemeProvider` change | `ThemeScope.tsx`, `ThemeModeSync.tsx`, `components/ThemeProvider.tsx` | §9a.6 |
| Cookie-free thumbnail | `/theme-thumbnail/[orgId]` | §9a.5 |
| SSR fixture server + Playwright config | `e2e/fixtures/server.mjs`, `playwright.spike.config.ts` | §16 |

Run it: `cd frontend && npx playwright test -c playwright.spike.config.ts` (starts the fixture server on 3102 and `next dev` on 3111).

## Results by spike item (plan §15, card 038-0)

| Item | Result | Evidence |
|---|---|---|
| Composition layout, three root slots with `allow`, nested slots | ✅ | Outline shows Header / Template / Footer; Hero's `blocks` slot holds two `Button`s; `editor.spec` "nested block…" |
| Outline overrides (eye, ⋯, 🔒) and permissions | ✅ with own outline | Puck's outline lists root slots **in reverse** and shows the empty `default-zone`, so Jump renders its own tree (`name: 'outline'` replaces the default). Locked sections have no ⋯ and no Delete/Duplicate on the canvas (`permissions`); `editor.spec` "locked sections…", "hide dims…" |
| Server/client config split | ✅ | `renderConfig` has no `'use client'`; `Render` from `@puckeditor/core/rsc` renders it in a Server Component; the editor spreads it |
| Iframe isolation of Tailwind, scheme variables, fonts | ✅ | Puck copies host styles into the iframe; brand and `--theme-*` variables apply; screenshots in the PR. Requires `src/theme/**` in Tailwind `content` |
| Plugin-rail Theme settings with live restyle; history | ✅ | Slider writes `root.props.themeSettings` via `setData` with `recordHistory`; canvas `--theme-page-width` changes at once and **Undo reverts it** (`editor.spec` "theme settings…"). No second history needed |
| Viewports and interactive/inspector mode | ✅ | Mobile viewport gives a ≤ 400 px iframe and canvas selection still works; inspector off stops click-to-select. `ui` is initial-only, so the toggle uses `setUi` |
| Keyboard paths through outline and fields | ⚠️ | Outline rows, eye and ⋯ menu are real buttons/menu items and reorder works by keyboard. **Puck's plugin rail items are not buttons** (no role, no tabindex): 038D must render its own rail buttons. Fields are labelled native inputs. axe was not run: `@axe-core/playwright` is not installed; 038D adds it |
| Payload size | ✅ | 20-section home 7.2 KB (19 KB with long rich text and images); 40 sections 13.7 KB; 8 color schemes 1.8 KB |
| Full-state revision snapshot | ✅ | 27 KB for a realistic theme; 50 revisions ≈ 1.3 MB per org. Full snapshots stay; no hash side table |
| Editor bundle; storefront impact | ✅ | Editor route first load 90.6 KB; Puck is lazy (`ssr: false`), ≈ 170 KB gzipped in two chunks. The themed storefront route loads **no Puck chunk** (checked in `next start` HTML) and its first load is 113 KB against 121 KB for today's client-rendered org page |
| Server render time, 20 sections, uncached | ✅ | `next start`, fixture API on the same machine, 40 requests after warm-up: 20 sections p50 61 ms / p95 89 ms; 4 sections p50 21 ms. The backend query cost is measured in 038A |
| `ThemeScope` no flash, 3 modes | ✅ after a fix | Found a real flip: next-themes applied the visitor's theme in its first effect before `ThemeModeSync` forced the org mode, so a DARK page went light for a frame after hydration. Fixed by having the blocking script set `data-jump-forced` and `ThemeProvider` read it as initial state. 4 mode/OS combinations pass three runs in a row; a control test shows today's `BrandScope` does flash; no hydration warnings |
| Cookie-based private-store render | ✅ | Server HTML shows the gate and no content; unlocking through the route handler sets an httpOnly, `SameSite=Lax`, host-only cookie; a stale cookie gets the gate and is expired by the `DELETE` route |
| Two (five) simultaneous thumbnails, mode in HTML | ✅ | Five sandboxed iframes at once, each its own theme; DARK renders dark with no script; the private store's thumbnail shows the theme, not the gate; no token → 404 |
| One storefront Playwright spec on the SSR fixture server | ✅ | `storefront.spec` + `console.spec` (13 tests) run against server-rendered pages with no backend |

## Contract changes the spike made

All are written into `contracts.md` (marked **(spike)**) and folded into the plan.

1. **`/_thumbnail` → `/theme-thumbnail`.** App Router treats `_folder` as private, so `/_thumbnail` can never be a route.
2. **Thumbnail mode goes on a wrapper `div`, not `<html>`.** The root layout owns `<html>`; Tailwind's class strategy and `.dark .brand-scope` both work from an ancestor wrapper.
3. **The server forwards every `jump_store_access_*` cookie (≤ 10).** URLs may carry the slug while cookies are keyed by id; the backend already accepts 10 comma-separated tokens. `Max-Age` comes from the token's `exp` (the unlock returns only `{ token }`).
4. **`ThemeProvider` reads the forced mode at first render** (`data-jump-forced`), not only after `ThemeModeSync`'s effect.
5. **The fixture server listens on the API port CI already sets (3002)**, so no new env var is needed. `INTERNAL_API_URL` is an optional server-only base URL.
6. **Theme settings ride Puck's history** in `root.props.themeSettings` while editing; Save splits them out. The plan's "own settings history" fallback is not needed.
7. **Puck's default outline and rail are replaced**: Jump's Sections tree registers as `outline`, and 038D ships keyboard-operable rail buttons.
8. **Sections get resolved menus**: `OrganizationHeader` gains an optional `menus` prop so the server-rendered header does not fetch on the client.
9. **Tailwind `content` includes `src/theme/**`.**

## Risks confirmed or retired

- **Puck pre-1.0:** 0.23.0 pinned exactly. It depends on `@tiptap/*` ^3.11, which dedupes to our 3.31.3; no duplicate editor stack. It also lists `happy-dom` as a runtime dependency; nothing from it reaches the storefront bundle.
- **Three groups in one tree:** retired. The stacked-instance fallback is not needed.
- **Settings panel outside Puck's data:** retired (item 6).
- **Theme-mode flash after SSR:** retired for themed routes (item 4); checkout/apply keep today's behaviour, as the plan says.
- **Slot `allow` is enforced only by drag and drop.** `dispatch` can insert anything, so the server validator stays the authority (already planned).
- **New, small:** selecting a nested block on the canvas takes two clicks (the first selects its section). The outline selects either in one. Acceptable; noted for 038D copy/help.

## Not covered (owned by later cards)

- axe runs (038D adds `@axe-core/playwright`).
- Real backend timing of the render endpoint (038A, budget p95 ≤ 150 ms on the dev database).
- Group `allow` behaviour when dragging from the Add panel (038D; the server validator is the authority regardless).
- `AutoField` reuse inside the settings accordion (038F).
