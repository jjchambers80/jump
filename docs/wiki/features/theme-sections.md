# Storefront Theme Sections

**Status:** Implemented
**Last Updated:** 2026-09-30
**Specs:** [038 theme editor](../../../specs/038-theme-editor/plan.md), [041 hero carousel + FAQ](../../../specs/041-carousel-faq-sections/spec.md)

## Overview

Storefront pages are built from **sections** (Announcement bar, Header, Hero, Hero carousel, Rich text, FAQ, Upcoming events, Call to action, Events hero, Event list, Footer). A section can hold **blocks** (buttons, announcements, slides, questions, footer columns). Organizers add, order, hide and edit them in the theme editor (Online store › Themes › Customize), which runs [Puck](https://puckeditor.com) over the same render functions the storefront uses, so the canvas is the store.

## Key Files

| File | Purpose |
|------|---------|
| `packages/theme/src/registry.js` | `SECTIONS` and `BLOCKS`: labels, categories, groups, settings, allowed blocks and limits. The single definition the backend validates against and the editor builds fields from |
| `packages/theme/src/fields.js` | Field kinds (`text`, `textarea`, `richtext`, `select`, `radio`, `range`, `toggle`, `image`, `link`, `reference`, `datetime`, `colorScheme`) and their validation |
| `packages/theme/src/content.js` | Translatable storefront wording (`t(ctx, key)`) |
| `frontend/src/theme/sections/*` | One React component per section / block (server components; `'use client'` islands only for behaviour) |
| `frontend/src/theme/render/config.tsx` | RSC-safe Puck config: which component renders each type, which sections have a slot |
| `frontend/src/theme/editor/config.tsx` | Editor config generated from the registry + render config; `STARTER_BLOCKS` for newly added sections |
| `backend/src/services/ThemeService.js` | Save / validate / render; `_visible` drops hidden sections and blocks, and sections that are only their blocks (`BLOCKS_ONLY`) when none are left |

## Hero video, full window, edge to edge

The Hero takes a background **video** (`video`, optional `videoWebm`: `{ fileId }` of an MP4 / WebM in Content › Files) behind the text in the full-bleed layout. The Hero image becomes its poster.

- `HeroVideo` (client island) starts the video from script, muted and looping. It never starts under `prefers-reduced-motion` or in the editor; the poster stays. A pause / play button (`hero.pauseVideo` content key, `aria-pressed` = paused) is always shown (WCAG 2.2.2).
- `height: 'screen'` fills the window below the header: `HeroScreenOffset` measures the bottom of `[data-section="Header"]` into `--hero-offset`, and the section is `min-h-[calc(100svh-var(--hero-offset))]`.
- `sectionWidth: 'full'` is edge to edge: no gutters, square corners, and the image is cropped to fill (`HeroMedia cover`) instead of fitted over a blurred copy. Set `paddingTop: 0` to sit flush under the header.

## Hero carousel (spec 041)

Up to six **Slide** blocks in the Hero's rounded frame. Each slide has an image (alt text or decorative), heading, subheading, a button label + link, and text alignment. Section settings: autoplay (off / 5s / 8s), height, overlay opacity, arrows, dots.

- Slides are a CSS scroll-snap track (`HeroCarouselSection`), so they swipe without JavaScript. `HeroCarouselFrame` adds arrows, dots, keyboard arrows and rotation.
- Rotation: pause button, holds on hover or when a slide's link has focus, stops for good once the visitor moves the slides (arrow, dot, keyboard, swipe), never starts under reduced motion, off in the editor.
- The active dot fills over the interval (a hairline along the bottom edge when dots are off). That animation's end advances the slide, so the progress shown and the timer cannot drift, and holding simply pauses the animation.
- Arrows show from `sm` up; phones swipe and use the dots. After a visitor's own move, a hidden live region announces "Slide n of N"; automatic rotation announces nothing.
- The active slide's copy settles in, and FAQ answers ease in on open (`globals.css`, `prefers-reduced-motion: no-preference` only).
- Images use the Hero treatment (`HeroMedia`: fitted whole over a blurred copy, overlay on top) and load lazily.

### Editing slides

In the theme editor, open **Sections**. Under **Hero carousel**, each slide is listed as "Slide 2 · its heading". Click one to edit it: the canvas carousel scrolls to that slide. **+ Add slide** under the carousel adds a slide and selects it (up to 6). Use a slide's ⋯ menu to duplicate, reorder or remove it. FAQ questions work the same way: **+ Add question**, and a selected question opens on the canvas. Hero buttons get **+ Add button**.

Under the hood, `followSelection` (`theme/editor/config.tsx`) passes `editorSelected` to `Slide` / `FaqItem`. The slide marks itself `data-editor-selected`, and `HeroCarouselFrame` scrolls to it. The question renders `open`.

## FAQ (spec 041)

Heading, intro and up to 30 **Question** blocks (question + rich-text answer). Each question is a native `<details>` disclosure. "Open one answer at a time" (default on) and "Open the first answer" are applied by the `FaqBehavior` island.

## Full-width pages

A Content page (Online store › Pages) whose **Template** is **Full width** (built in, `Page.template = 'full-width'`, offered only when themes are on for the store) hands its body to the theme. Each such page has its own theme document `page:<pageId>`, edited in the theme editor like Home and Events: **Customize** on the page form opens `…/editor?page=page:<id>`, and the editor's page picker lists every full-width page as "Page: <title>".

- The document holds any template section plus **Page content** (`PageContent`, group `page`, at most one): the page's own title, text, contact form and Apply button (`StorefrontPageBody`, rendered as a `div` because the frame owns `main`). New documents start as just Page content, so switching a page to Full width changes nothing until sections are added. Remove it to build the page from sections alone.
- Give sections `sectionWidth: full` for edge-to-edge bands; a Hero with `paddingTop: 0` sits flush under the header.
- Storefront: the page route makes one render call, `page=page:<slug>`. The backend resolves the page through `PageService.getPublic` (hidden = 404), returns it as `resolved.page`, and adds the `page:<id>` document only for full-width pages; other pages get the frame and keep the fixed body. Orgs without themes render the default body (the template reads as `page_content` only).
- Saves of a `page:` key are refused (400) unless the page belongs to the organization; the editor's preview data includes hidden pages.
- Not yet: theme export/import of page documents, and a blog equivalent (rest of 038G).

## Layout widths

- **Theme page width**: `settings.layout.pageWidth` (1000-1600 px, default 1280 = the old `max-w-7xl`) sets `--theme-page-width` on the frame.
- **Page override**: a template document's `root.props.pageWidth` (same range, unset = theme value) sets `--theme-page-width` on that page's whole frame, header and footer included (`pageWidthVars` in `settingsCss.ts`; the editor's root field "Page width").
- **Section width**: every section has the common `sectionWidth` field: `page` (default), `narrow` (768 px), `wide` (1600 px), `full` (no max, side padding kept). `sectionWidthStyle` in `sections/context.ts` turns it into `--theme-section-width` on the section wrapper; only enum values reach CSS.
- One rule in `app/globals.css` applies both: `.brand-scope [data-section] .max-w-7xl { max-width: var(--theme-section-width, var(--theme-page-width, 80rem)) }`. Sections and the shared components they render (`OrganizationHeader`, `FooterMenu`, `EventsListing`, `EventsCover`) keep using `max-w-7xl` for their content container; outside a themed section the class is plain Tailwind. RichText/FAQ `width` sizes their text column inside that container and is separate.

## Adding a section

1. **Registry**: add the section (and any block) to `SECTIONS` / `BLOCKS` in `packages/theme/src/registry.js` with a `category` (Add-panel group), `groups` (`template`, `header`, `footer`) and `blocks: { types, max }`. Validation, migration, file references and hidden-block filtering are generic.
2. **Component**: add `frontend/src/theme/sections/<Name>Section.tsx`, wrapped in `SectionShell` (scheme + padding). Use `brand` tokens / scheme colors only, never raw colors (gotcha 6); render organizer HTML only through `ContentHtml` (gotcha 20).
3. **Render config**: register it in `frontend/src/theme/render/config.tsx`. Template-section blocks are a slot (`fields: { blocks: { type: 'slot', allow: [...] } }`); render the slot with `slotWrapper` (buttons) or `slotRender` (the section lays out the slot itself).
4. **Editor**: nothing, unless the section should start with blocks (`STARTER_BLOCKS`) or its blocks are array fields (header/footer only).
5. **Wording**: storefront text a visitor reads goes in `packages/theme/src/content.js` and `frontend/e2e/helpers/themeEditorMocks.ts`.
6. **Tests**: validator cases in `packages/theme/test/fixtures/cases.js` (run by Jest and Vitest), a render test in `frontend/tests/unit/themeSections.test.tsx`, the render payload in `backend/tests/contract/themes.test.js`, and Playwright against the SSR fixture (`frontend/e2e/fixtures/storefront.mjs`).

## Gotchas

- **Slot children get no props from their section.** Pass section-wide settings as CSS variables on the slot element or apply them from a client island that finds the children in the DOM (spec 041).
- **Constants shared by a server section and a client island** live in a plain module (`theme/sections/islandClasses.ts`). Exported from a `'use client'` file they reach the server component as a client reference and render as `[object Object]`. Vitest does not catch this; Playwright against the fixture does.
- **Blocks cannot hold blocks.** Put a slide's button on the slide as fields.
- In the editor, Puck wraps each slot child in its own element: style a track's children with `[&>*]:` selectors, not classes on the block.

## Related Features

- [Theme System](theme-system.md) — admin light / dark / auto.
- [Organization Theme Mode](organization-theme-mode.md) — storefront theme mode.
- [Content files](content-files.md) — images a section can use.
