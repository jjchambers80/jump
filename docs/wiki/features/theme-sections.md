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

## Hero carousel (spec 041)

Up to six **Slide** blocks in the Hero's rounded frame. Each slide has an image (alt text or decorative), heading, subheading, a button label + link, and text alignment. Section settings: autoplay (off / 5s / 8s), height, overlay opacity, arrows, dots.

- Slides are a CSS scroll-snap track (`HeroCarouselSection`), so they swipe without JavaScript. `HeroCarouselFrame` adds arrows, dots, keyboard arrows and rotation.
- Rotation: pause button, holds on hover or when a slide's link has focus, never starts under reduced motion, off in the editor.
- Images use the Hero treatment (`HeroMedia`: fitted whole over a blurred copy, overlay on top) and load lazily.

## FAQ (spec 041)

Heading, intro and up to 30 **Question** blocks (question + rich-text answer). Each question is a native `<details>` disclosure. "Open one answer at a time" (default on) and "Open the first answer" are applied by the `FaqBehavior` island.

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
