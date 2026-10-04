# Theme Code Editor (Online Store › Edit code)

**Status**: Implemented
**Last Updated**: 2026-10-03

## Overview
A VS Code-style editor in the admin for the files `jump theme pull` writes: `settings.json`, `content.json`, `documents/<key>.json` and a read-only `.jump/schema.json`. Staff can make the same edits a CLI session makes (widths, section props, wording) without a terminal. It runs the server's own checks in the browser and saves through the same `PUT /admin/themes/:id/save` as the visual editor and `jump theme push`. A theme has no CSS, HTML or script, so there is none to edit here either.

## Key Files
| File | Purpose |
|------|---------|
| `frontend/src/app/admin/online-store/themes/[themeId]/code/page.tsx` | Route; full screen (`FULL_SCREEN` in `AdminLayoutClient.tsx`), Monaco loaded only here |
| `frontend/src/theme/code/CodeEditor.tsx` | Explorer, tabs, breadcrumb, Monaco, problems panel, status bar, save / 409 / revision history |
| `frontend/src/theme/code/files.ts` | Files ↔ texts, `checkTexts` (server checks per file), `rangeFor` (validator path → text range via `jsonc-parser`), `saveBody` (only changed keys + versions) |
| `frontend/src/app/api/monaco/[...path]/route.ts` | Serves `monaco-editor/min` same-origin, so no CDN and offline tests |
| `packages/theme/src/files-check.js` | `checkTheme` and `themeSchema`, shared with the CLI (`jump theme check`, `.jump/schema.json`) |

## How It Works
- Entry points: **Edit code** in a theme's row menu (Online Store › Themes) and in the visual editor's `…` menu. The code editor links back with **Customize**.
- Load: `GET /admin/themes/:id` (settings overrides), `/content` (overrides), `/documents/:key` per `DOCUMENTS` key. Texts are `JSON.stringify(value, null, 2)`, like the CLI.
- Check: 250 ms after typing stops, `checkTexts` parses every file and runs `checkTheme` (the server validators). Problems go to the status-bar count, the Problems panel (click to jump) and Monaco markers (owner `jump-theme`). Monaco's JSON mode marks syntax errors itself.
- Save (button or Cmd/Ctrl+S): refused while there are problems. `saveBody` compares parsed JSON, so formatting-only edits send nothing. A 409 keeps the edits in `sessionStorage` and offers **Reload** then **Apply them again**, like the visual editor.
- Monaco: `@monaco-editor/react` with one model per path (undo history survives tab switches); `loader.config({ paths: { vs: '/api/monaco/vs' } })`.

## Gotchas
- **Monaco is pinned to 0.56.0** with root `overrides` for `monaco-editor` and `dompurify` 3.4.16: 0.57 depends on a dompurify with a HIGH advisory, which Railway's CVE gate blocks. Bump all three together and run `npm audit --omit=dev -w frontend`.
- The Monaco route finds the package on disk (`node_modules` in `frontend/` or the repo root), not with `require.resolve`: webpack tries to bundle that, and the package's exports map hides `package.json`.
- Playwright drives edits through `window.monaco` models (`e2e/theme-code.spec.ts`); typing into Monaco fights its bracket auto-closing.
- Not built: cross-file search, outline/timeline panes, JSON Schema autocomplete, "reset file to default" (the CLI does it by deleting the file).

## Related Features
- [Theme Developer CLI](theme-developer-cli.md): the same files from the terminal
- [Storefront Theme Sections](theme-sections.md): section registry and layout widths
