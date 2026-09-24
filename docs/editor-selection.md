# WYSIWYG Editor Selection — Jump Ticketing Platform

**Date:** 2026-09-23
**Task:** t_6b05bc1f
**Recommendation:** Stick with **TipTap v3.x** (already integrated).

## Summary

TipTap (built on ProseMirror) is already the editor used by Jump's frontend
(`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-image` at
`^3.31.3`). After researching the alternative candidates, the recommendation
is to stay on TipTap. It is the strongest fit for Jump's use case (organizer
WYSIWYG for blog posts and pages), and a migration to any alternative would
replace working, tested, production code with no material benefit.

---

## Candidates Compared

### 1. TipTap (in use) — MIT — ~45 KB gzipped (core + starter-kit)

| Criterion | Assessment |
|-----------|------------|
| License | MIT (core). Extensions are MIT. Collaboration hosting (Tiptap Cloud) is paid but optional |
| React/TypeScript | First-party `@tiptap/react` with full TS types |
| Styling | Headless — bring your own UI. Already styled with Tailwind + lucide-react icons in `RichTextEditor.tsx` |
| Bundle | Tree-shakable extensions; project has ~4 packages (starter-kit, image, pm, react) |
| Community | 37K GitHub stars, 55M+ monthly npm downloads, 50+ official extensions, active maintenance |
| Collaboration | Yjs via `@tiptap/extension-collaboration` or Tiptap Cloud (not needed today) |
| HTML output | ProseMirror JSON in, `getHTML()` out — paired with `sanitize-html` on the backend |
| Production maturity | v3.x stable, ProseMirror foundation battle-tested since 2015 |
| Jump integration depth | `RichTextEditor.tsx` (419 lines), `RichTextEditorField.tsx` (dynamic import, ssr: false), `sanitizeHtml.js` backend pipeline, `ContentHtml.tsx` storefront renderer, `BlogPostForm.tsx`, `PageForm.tsx` |

**Strengths for Jump:**
- Already shipped in blog posts and online store pages
- `sanitize-html` pipeline (backend/src/utils/sanitizeHtml.js) already tuned to
  TipTap's output — no serialisation mismatch risk
- Extension ecosystem covers everything Jump needs (headings, lists, links,
  images, blockquotes, horizontal rules) without any custom node work
- v3.x (3.31) moved to ProseMirror v2 internally, improving performance and
  collaboration readiness

---

### 2. Lexical (Meta) — MIT — ~22 KB gzipped core

| Criterion | Assessment |
|-----------|------------|
| License | MIT |
| React/TypeScript | First-party `@lexical/react` with full TS types |
| Styling | Headless — comparable to TipTap |
| Bundle | Smallest core of the three (22 KB) |
| Community | 23K GitHub stars, Meta-backed, pre-1.0 |
| Collaboration | Yjs via `@lexical/yjs` |
| HTML output | No built-in HTML serialization — needs custom `$generateHtmlFromNodes` |
| Production maturity | Stable since 2022 but never reached 1.0; Meta uses it internally |

**Why not for Jump:**
- No built-in HTML output: every TipTap `getHTML()` call becomes a custom
  serialiser, and the `sanitize-html` allowlist would need re-validation
- Smaller extension ecosystem — tables, mentions, and link handling need
  more manual work
- Pre-1.0 label, though stable in practice, introduces risk for a platform
  handling real content
- Migration would rewrite `RichTextEditor.tsx` from scratch with zero feature
  gain
- Lacks "pure decorations" (ProseMirror/Slate feature) — collaborative cursors
  and advanced overlays need DOM hacks

---

### 3. Slate — MIT — ~100 KB with React peer

| Criterion | Assessment |
|-----------|------------|
| License | MIT |
| React/TypeScript | `slate-react` with TS types |
| Styling | Most flexible — full control over document model |
| Bundle | Heaviest (~100 KB with React peer) |
| Community | 31K GitHub stars, no company backing, API has breaking changes between major versions |
| Collaboration | Community Yjs bindings |
| HTML output | Fully custom — you define serialisation |
| Production maturity | Officially still beta, has history of breaking changes affecting stored data |

**Why not for Jump:**
- No built-in features — every toolbar button, link handler, and image
  insertion is entirely DIY
- Breaking change history is a real concern for a platform that stores HTML
  in the database
- Heaviest bundle
- Smallest community ecosystem
- Would require the most development effort for the least out-of-box
  functionality

---

## Detailed Comparison

| Dimension | TipTap (in use) | Lexical | Slate |
|-----------|-----------------|---------|-------|
| License | MIT | MIT | MIT |
| React/TS | First-party | First-party | First-party |
| HTML output | Built-in | Custom needed | Custom needed |
| Extension ecosystem | 50+ official | ~15 official | Community-driven |
| Collaboration path | Yjs official | Yjs supported | Yjs community |
| Bundle (gzipped) | ~18 KB | ~9 KB | ~40 KB |
| GitHub stars | 37K | 23K | 31K |
| Monthly npm downloads | ~55M | ~3M | ~2M |
| Production status | Stable (v3) | Pre-1.0 | Beta |
| Jump integration cost | $0 (already done) | Full rewrite | Full rewrite |
| Documentation | Excellent | Good, gaps | Good, examples |

## Why Not Others

**Quill (BSD):** No first-party React bindings (`react-quill` unmaintained,
`react-quill-new` fork exists). Delta model is less expressive than
ProseMirror for structured content. Not competitive with TipTap in a
React/TypeScript project in 2026.

**BlockNote (MIT):** Opinionated block-based (Notion-style) editor built on
TipTap. If Jump wanted a block editor with slash-commands and floated
toolbars it would be worth evaluating, but Jump's organizer content (blog
posts, pages) is prose, not block composition. Adds abstraction on top of
TipTap without solving a problem Jump has.

**Plate (MIT):** Plugin ecosystem on top of Slate. React-only, shadcn/ui
integration. Shares Slate's downsides (beta, breaking changes) and would
require the same migration effort.

**CKEditor / TinyMCE:** GPL or paid license. No headless UI — imposes its
own styling. Not appropriate for a codebase that already controls its UI
stack.

---

## Recommendation

**Stay with TipTap v3.x (currently ^3.31.3).**

No alternative provides a benefit that justifies replacing working code:

1. TipTap's extension ecosystem covers every feature Jump's organizers need
   (headings, lists, links, images, blockquotes, horizontal rules, tables
   if needed later).
2. The existing integration (`RichTextEditor.tsx`, `RichTextEditorField.tsx`,
   `sanitizeHtml.js`, `ContentHtml.tsx`) is clean, tested, and production.
3. The HTML-in-HTML-out model pairs naturally with Jump's `sanitize-html`
   backend — no custom serialisation.
4. Migration to Lexical or Slate would be a full rewrite of the editor
   component with zero user-facing benefit and risk of output differences
   in stored content.
5. v3.x (ProseMirror v2) gives the project a clear upgrade path if
   collaboration or advanced features are ever needed.

**If a need arises** that TipTap's ecosystem does not cover (e.g. a
truly custom document model for a new product), Slate remains the fallback.
Lexical would only be worth re-evaluating if bundle size becomes critical
(PWA, mobile) or if Meta ships a 1.0 with the HTML gap closed.

## Current Integration

- Package: `@tiptap/react ^3.31.3`, `@tiptap/starter-kit ^3.31.3`,
  `@tiptap/extension-image ^3.31.3`, `@tiptap/pm ^3.31.3`
- Component: `frontend/src/components/editor/RichTextEditor.tsx`
- Lazy wrapper: `frontend/src/components/editor/RichTextEditorField.tsx`
  (dynamic import, SSR-disabled)
- Backend sanitiser: `backend/src/utils/sanitizeHtml.js`
- Storefront renderer: `frontend/src/components/storefront/ContentHtml.tsx`
- Consumers: `BlogPostForm.tsx`, `PageForm.tsx`