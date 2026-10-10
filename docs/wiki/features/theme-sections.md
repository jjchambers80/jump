# Storefront Theme Sections

**Status:** Implemented
**Last Updated:** 2026-10-10
**Specs:** [038 theme editor](../../../specs/038-theme-editor/plan.md), [041 hero carousel + FAQ](../../../specs/041-carousel-faq-sections/spec.md)

## Overview

Storefront pages are built from **sections** (Announcement bar, Header, Hero, Hero carousel, Rich text, Image with text, Feature grid, Stats, Checklist, Steps, Tiers, FAQ, Upcoming events, Call to action, Spotlight, Events hero, Event list, Footer, and Page content on full-width pages). A section can hold **blocks** (buttons, announcements, slides, features, stats, list items, steps, tiers, questions, footer columns). Organizers add, order, hide and edit them in the theme editor (Online store › Themes › Customize), which runs [Puck](https://puckeditor.com) over the same render functions the storefront uses, so the canvas is the store.

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
- `mobileLayout: 'button-bottom'` (full-bleed with an image or video, phones only): the heading and subheading center in the space above the buttons, which stack full width at the bottom of the hero (`pb-20` clears the video pause button). `stacked` (default) keeps the desktop layout.
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

## Landing sections

Two sections for pages that sell:

- **Image with text**: an image (alt text or decorative) beside a heading, rich text and up to two buttons. **Image position** left or right; side by side from `lg`, image first on phones. Without a resolved image the text stands alone, centered in a 3xl column.
- **Feature grid**: heading, intro and up to 12 **Feature** blocks (image, title, short text) in 2, 3 or 4 columns (one column on phones, two from `sm`), centered or left aligned. The grid is the Puck slot (`slotRender`), so the column count is a class on the slot. A new grid starts with three features; **+ Add feature** adds more.
- **Image with text: video**: a YouTube or Vimeo link (`videoUrl`, hosts checked by `httpsUrl`) puts a player in the image's place; the src is rebuilt by `videoEmbedSrc` (`lib/videoEmbed.ts`), so only the no-cookie YouTube or Vimeo player is ever embedded, and **Video title** is its iframe title. A link it cannot parse falls back to the image. **Heading level** `h1` makes the section the page's main heading, for a full-width page that leaves out Page content (use it once).
- **Stats**: heading, intro and up to 6 **Stat** blocks (number, label) as one `<dl>` (label first in the markup, number shown on top in the brand color); columns fit the width (`auto-fit`, two on phones). Values over 8 characters render a size smaller.
- **Checklist**: heading, intro, 1-3 columns and up to 30 **List item** blocks with a check (wanted) or cross (not allowed) marker. Every item carries both icons and the section hides one, so blocks need no section props; the icons are decorative and the heading carries the meaning. The slot is a `<ul role="list">` (a `forwardRef` element passed as the slot's `as`, because Puck forwards only `className`/`style`/`ref`).
- **Steps**: heading, intro and up to 6 **Step** blocks (title, rich text) as an `<ol role="list">`; the large `01`-style numbers are a CSS counter, so reordering never desyncs them.

- **Tiers**: heading, intro and up to 6 **Tier** blocks (name, tagline, benefits one per line, **Highlight this tier** with its label, default "Most popular") as a `<ul role="list">` of cards, one column on phones and two from `md`. Each benefit line becomes a list item with a decorative check; a highlighted tier gets a brand ring and its label on the card's top edge, after the name in reading order.
- **Spotlight**: a quiet band for a cause, partner or sponsor: a small **Badge or logo** (shown whole at 80/96 px, never cropped), an eyebrow, a short `h2`, one line of text and up to two buttons. Badge beside the text even on phones; buttons stack full width on phones and sit on the right from `md`. Raleigh Retro Gamers uses it on the home page for its Extra Life fundraiser.
- **Hero: heading level**: `h1` for a hero that opens a full-width page without Page content (use it once), like Image with text.

The Raleigh Retro Gamers Vendors page is the reference composition: `frontend/e2e/fixtures/vendorLanding.mjs` (served as `theme-vendors` in the SSR fixture, checked by `e2e/storefront-vendor-landing.spec.ts` with axe on phone and desktop). The Sponsors page (`sponsorLanding.mjs`, `theme-sponsors`, `e2e/storefront-sponsor-landing.spec.ts`) is the second: Hero, Feature grid, Tiers, Image with text, Steps, Call to action.

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

## Theme settings (spec 049 card C)

The gear button in the editor header (and the gear in Puck's plugin rail) opens **Theme settings**: an accordion, one group open at a time, with **Logo**, **Colors** and **Typography** (the rest of spec 038 §6.3 is card 038F F2).

- **Storage**: the theme's stored settings are partial (`Theme.settings`); an absent group or key means the theme default. While editing they live in Puck's `root.props.themeSettings`, so undo/redo covers them (spike item 6). **Save** sends `settings` (only when changed) with the dirty documents to `PUT /admin/themes/:id/save`; the backend validates (`validateSettings`) and refuses removing a scheme a stored document uses. "Reset to theme defaults" removes the group from the stored settings.
- **Panel**: `theme/editor/ThemeSettingsPanel.tsx` renders the `SETTINGS_GROUPS` field specs from `@jump/theme` (`image` = the section image picker, `range` = slider + number, `select`). Logo shows "Using your brand logo" with a link to Settings › Brand when empty; favicon "Defaults to your square logo" (favicon rendering is not wired yet). Colors (`ColorSchemesField.tsx`): add (up to 8), duplicate, rename, remove (disabled while a loaded page uses the scheme); each scheme has only three colors — **background**, **text** and **accent** (owner rule: theme settings stay simple) — each automatic / brand or secondary brand (accent only) / custom hex. Text on a custom accent is derived (`bestForeground`); slots stored before that rule (`accentForeground`, `border`, `muted`, …) are accepted and dropped by `validateSettings`. Contrast is checked as a WCAG warning (never a block). Accent options are `ACCENT_SPECIALS` in `settingsDraft.ts`.
- **Typography is one font for the whole theme** (`typography.font`): header, sections and footer alike. There is no heading/body split, size, case or spacing setting on purpose — theme settings stay simple, all or nothing. Older stored keys (`headingFont`, `bodyFont`, `headingScale`, …) fold into `font` through `normalizeTypography` (`@jump/theme`) on validate and resolve, so old revisions, `settings.json` uploads and CLI pushes still load.
- **CSS**: `settingsVars` sets `--theme-font`. `ThemeScope`'s `fontClassName` marks the scope (`data-theme-type`) and one `:where()` rule in `app/globals.css` sets `font-family` there; everything inside inherits it. The Hero section's retro text style keeps its own monospace face.
- **Fonts**: `theme/fonts.ts` declares the curated `FONTS` with `next/font/google` (`preload: false`, `display: 'swap'`, `--theme-font-<key>`); Inter is the app's own preloaded face (`lib/interFont.ts`, also the root layout's). `themeFontClasses(settings)` returns only the chosen font's class. 'system' is the system-ui stack.
- **Preview**: the editor resolves the draft over the preset (`resolveSettings`) into the canvas `SectionContext`, so edits restyle at once; the live storefront `ThemeFrame` uses the saved settings and the same fonts.
- **Undo and the panel**: Puck's undo restores its whole UI state; `PanelButtons` reopens the settings panel after an undo/redo that closed it. Puck's `iframe`, `viewports` and `plugins` props are module constants: inline literals re-ran Puck's viewport effect, which overwrote the first history entry and made the first edit impossible to undo.

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
- **`settings` is brand-filled (spec 049).** `ctx.settings.brand.headline` / `.description` and `ctx.settings.social` already fall back to the organization's slogan, short description and social links (`withBrand`, applied in `ThemeService.render` and the editor canvas). Sections read `settings` and never `organization.slogan` directly. A scheme accent can be `brand-secondary` (the org secondary color); sections keep using the `brand` tokens. See [Organization branding](organization-branding.md).
- **Blocks cannot hold blocks.** Put a slide's button on the slide as fields.
- In the editor, Puck wraps each slot child in its own element: style a track's children with `[&>*]:` selectors, not classes on the block.

## Related Features

- [Theme System](theme-system.md) — admin light / dark / auto.
- [Organization Theme Mode](organization-theme-mode.md) — storefront theme mode.
- [Content files](content-files.md) — images a section can use.
