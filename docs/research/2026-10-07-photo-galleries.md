---
type: research
title: Photo galleries — Content › Galleries, carousel + masonry/lightbox
status: reference
created: 2026-10-07
updated: 2026-10-07
project: jump
tags: [jump, research, content, galleries, theme-sections, accessibility, wcag, images]
source: platform help centres, W3C/WAI, MDN, CSSWG, WebKit/Chrome blogs, npm/GitHub (see Sources); Jump code at origin/main a5cc88d
---

# Photo galleries: research for Jump

**Question.** Organizers want a **photo gallery** under the admin **Content** section. A gallery holds photos split into **sections** (groups), and every photo is a file in **Content › Files**. A gallery can be placed on a page: a classic rich-text page or a full-width (Puck) page. It has two display options:

1. A **carousel**.
2. A **Pinterest-style masonry** layout, where clicking a photo opens a **lightbox** with previous/next navigation.

The brief also asks what else comparable products offer, and sets three requirements: mobile first, a modern and simple UX, and **WCAG 2.2 AA**.

**About the citations.** Every Jump `path:line` citation points to `origin/main` at `a5cc88d` (2026-10-06). The local checkout is detached at an older commit (`3240a3c`), so read the cited lines with `git show origin/main:<path>`. External claims carry a bracketed number that points to the Sources list. Four help centres refused direct fetches (SmugMug, Pixieset, Flickr, Webflow). Claims about those platforms are marked ‡ and rest on the official page's own text as quoted in search results.

---

## 1. TL;DR

**Recommendation.** Build a **Gallery** content record: one `Gallery`, ordered `GallerySection`s, and ordered `GalleryItem`s. Each item references a `StoreFile`, and a photo's alt text can be overridden per gallery. Show it through **one shared server component** with two layouts, `carousel` and `masonry`. Both page types use the same component:

- **Full-width / Puck pages** get a new `Gallery` theme section with `gallery: reference('Gallery', 'gallery')`. This follows the precedent of the Header's `menu` reference.
- **Classic rich-text pages and blog posts** get an atomic Tiptap `galleryEmbed` node, the same pattern as the existing `videoEmbed`. It stores `<figure data-jump-gallery="<id>" data-layout="masonry">`, and the storefront page body splits the HTML at those markers.

**Add no new dependencies.**

| Need | Build it from |
|---|---|
| Carousel | The CSS scroll-snap carousel Jump already ships (`HeroCarouselFrame`), plus the APG fixes listed below |
| Masonry | CSS multi-column, with `display: grid-lanes` behind `@supports` |
| Lightbox | Native `<dialog>` + `showModal()`, which `ApplyDrawer` already uses |
| Admin reordering | `@dnd-kit/sortable`, already installed, with Move up/down buttons |
| Pinch zoom | `react-zoom-pan-pinch`, already installed, later |

**One blocker on the image side.** Jump's only resized variants are **cover-cropped** (128², 400×300, 1200×630, `backend/src/services/ImageService.js:9-13`). Its public file URL serves the **original** (up to 20 MB, `backend/src/services/StoreFileService.js:305-311`). Masonry and the lightbox need whole, uncropped images, and project memory says never to use the cropped variants for whole-image fits. Galleries therefore need **width-bounded `fit: 'inside'` WebP variants**, for example 480 / 960 / 1600 / 2400 px wide, served through `srcset`/`sizes`. Generate them lazily on first request so existing files need no backfill. `StoreFile.width`/`height` already exist (`packages/db/prisma/schema.prisma:251-276`), so every tile can reserve its box with no layout shift (CLS).

**Libraries as a fallback.** If a hand-built lightbox ever proves too costly, use the smallest accessible pair: **yet-another-react-lightbox** (~12 KB gzip) plus **react-photo-album** (~4 KB, server-renderable masonry). Both are MIT and actively maintained [B5][B6].

---

## 2. Jump integration points (origin/main a5cc88d)

### 2.1 Files and images

| Fact | Where |
|---|---|
| `StoreFile` is an org-scoped asset over the shared content-addressed `File`. It has `altText`, `width`, `height` and an optional `imageId` | `packages/db/prisma/schema.prisma:251-276` |
| `File.width`/`height` hold the intrinsic size, with EXIF rotation applied | `schema.prisma:209-222`, `ImageService.js:36-43` |
| `StoreFileReference` with `ContentRefKind` (`PAGE`, `BLOG_POST`, `THEME`) is rebuilt on save and powers "Used in" | `schema.prisma:395-415` |
| `syncReferences(kind, targetId, fields, orgId)` takes HTML (it scans for file URLs) or arrays of ids | `StoreFileService.js:264-298` |
| `_resolveReferences` maps each kind to a title and an admin link. A gallery kind needs a branch here | `StoreFileService.js:368-420` |
| Deleting a file does **not** check its references. It just deletes and returns the count | `StoreFileService.js:218-235` |
| Variants are `thumb` 128×128, `card` 400×300 and `hero` 1200×630, **all `fit: 'cover'`**, generated eagerly at upload | `ImageService.js:9-13`, `:73-90`, `:122`, `:162` |
| Variant serving: `GET /images/:id/:hash/:variant`, `immutable`, ETag. Unknown variant → 404 | `backend/src/api/routes/images.js:27-56`, `ImageService.js:237-262` |
| `serialize()` exposes `url` (original), `thumbUrl` and `previewUrl` (card), plus `width`/`height`/`altText` | `StoreFileService.js:328-355` |
| Public `/files/:id/:hash/:name` is **not** gated by private store mode. The hash is the capability | `docs/wiki/features/content-files.md` (Gotchas) |
| Upload limits: 20 MB, 10 files per request, alt text ≤ 500 | `backend/src/utils/fileLimits.js:3-7` |
| Frontend helpers `imageVariantUrl` and `imageDimensions` (`?w=&h=`) reserve an image's box before load | `frontend/src/lib/assets.ts:17-40` |
| `next/image` is **not used anywhere**, and `next.config.mjs` has no `images` config. Storefront images are plain `<img>` | `frontend/src/middleware.ts:174` (only mention), `frontend/next.config.mjs` |

**Consequence.** `HeroMedia` and `SlideBlock` render `file.url`, which is the full original (`frontend/src/theme/sections/HeroSection.tsx:47-75`, `SlideBlock.tsx:30`). That is tolerable for one hero. For a 60-photo gallery it is not.

### 2.2 Content records and admin

- **Content nav:** Files, Forms, Menus and Blog posts (`frontend/src/components/AdminSidebar.tsx:72-82`). Add **Galleries** here.
- **Admin pages** live under `frontend/src/app/admin/content/{files,forms,menus,blog-posts,blogs}`.
- **Menus are the closest model.** The whole tree saves in one `PUT /admin/menus/:menuId` (`backend/src/api/routes/menus.js:47`), and there are no per-item endpoints. `MenuEditor` uses `dnd-kit-sortable-tree`, and every drag also has a Move up/down button path with live announcements (`frontend/src/app/admin/content/menus/MenuEditor.tsx:1-10`). A gallery is a two-level tree (sections → photos), so the same approach fits: save the whole gallery in one `PUT`.
- **Routers** register in `backend/src/api/server.js:161-168` (for example `app.use('/admin/menus', menusRouter)`). Admin content routers act on `activeOrgFor(req)` (`routes/adminScope.js`).
- **The file picker is single-select:** `FilePickerDialog` returns one `onPick(file)` (`frontend/src/components/content/FilePickerDialog.tsx:13-27`). `UploadFilesDialog` already takes `multiple` (`UploadFilesDialog.tsx:153`). Galleries need multi-select added to the picker.
- **Dialog building blocks:**
  - `useDialog` is the storefront focus-trap, Escape and return-focus hook (`frontend/src/lib/useDialog.ts:1-60`), used in `EventDetailClient.tsx:125-126`.
  - `ApplyDrawer` is a native `<dialog>` + `showModal()` with `onCancel`, backdrop-click close and `motion-safe` animation (`frontend/src/components/applications/ApplyDrawer.tsx:66-105`).

### 2.3 Theme sections and Puck

- **Registry:** `packages/theme/src/registry.js`. Section settings use field kinds from `packages/theme/src/fields.js`. `image()` requires alt text or `decorative: true` (`fields.js:94-105`). `reference(label, target)` holds an id (`fields.js:33`, validated at `:129-131`).
- **Reference precedent:** the Header and MenuColumn take `menu: reference('Menu', 'menu')` (`registry.js:62`, `:156`).
  - The editor renders the menu reference as a `select` filled from `ctx.menus` (`frontend/src/theme/editor/fields.tsx:268-276`). Any other target currently falls back to a **text box**, so galleries need a `target === 'gallery'` branch.
  - At render, `ThemeService._resolve` already resolves events, menus, links and files per organization (`backend/src/services/ThemeService.js:533-556`). Add `galleries` here, keyed by id and filtered to the org.
- **HeroCarousel (spec 041)** is a scroll-snap track (`HeroCarouselSection.tsx:64`) plus a client island (`HeroCarouselFrame.tsx`). The island has `aria-roledescription="carousel"`/`"slide"`, "Slide n of N" labels (`:72-73`, `:155-156`), and a polite live region that announces only after the visitor moves (`:181-183`). It also has arrows from `sm` up (`:188-206`), dots (`:210-235`), and a pause button with `aria-pressed` (`:239-249`). It never autoplays under reduced motion (`:62-63`).
  - **Gaps against the APG pattern [A1]:**
    - The pause button comes **after** the slides in DOM order. APG wants it first.
    - Phones get **no arrows**: swipe and dots only. The dots, at 28 px, do give a single-pointer alternative, so 2.5.7 holds, but that is thin.
- **UpcomingEvents `carousel`** is a multi-item `snap-x` row with no buttons and no autoplay (`UpcomingEventsSection.tsx:1-3`, `:71-78`). This "peek" row is the right shape for a gallery carousel that shows 1.2 / 2.5 / 3.5 photos.
- **`islandClasses.ts`** holds constants shared between a server section and a client island. Never export them from a `'use client'` file (`frontend/src/theme/sections/islandClasses.ts:1-6`, wiki gotcha).
- **Adding a section** is a six-step recipe: registry, component in `SectionShell`, render config, editor, wording, tests (`docs/wiki/features/theme-sections.md`, "Adding a section"). Render config entries for comparison are at `frontend/src/theme/render/config.tsx:77-107`.
- **`BLOCKS_ONLY`** (`ThemeService.js:76`) drops sections whose blocks are all gone. A gallery section should likewise render nothing when its gallery is missing or empty.
- **Spec 038 already planned a different shape:** a `Gallery` section with inline `GalleryImage` blocks (max 24, "columns, aspect ratio", card E) (`specs/038-theme-editor/plan.md:398`). This request **replaces** that with a reusable Content record. One gallery is then used on many pages, holds sections, has no 24-image cap, and appears in Files' "Used in". Record that decision in the spec.

### 2.4 Classic (rich-text) pages

- Organizer HTML is sanitised on write (`backend/src/utils/sanitizeHtml.js:8-92`).
  - `figure` and `figcaption` are allowed, but `figure` has **no allowed attributes**.
  - The iframe allowlist (`:45-86`) shows how to add a tightly transformed embed.
- `ContentHtml` injects the stored HTML string as-is (`frontend/src/components/storefront/ContentHtml.tsx:10-16`), so it cannot host a React island in place.
- `StorefrontPageBody` already renders a list of typed pieces: `page_content`, `rich_text`, `contact_form` (`frontend/src/components/storefront/StorefrontPageBody.tsx:86-108`). Page templates (spec 042) whitelist those types (`backend/src/utils/pageTemplateManifest.js:24-40`).
- **Tiptap precedent:** `VideoEmbed` is an atomic, draggable block node that serialises to the exact markup the sanitiser keeps, and re-validates on parse (`frontend/src/components/editor/VideoEmbed.ts:1-40`). It is inserted from `InsertVideoDialog` (`RichTextEditor.tsx:462`).
- `PageService` sanitises content and calls `syncReferences('PAGE', …)` on create and update (`backend/src/services/PageService.js:132-145`, `:159`, `:199`).
- `Page.applicationFormId` (spec 044D) is a precedent for attaching one thing to a page by id (`schema.prisma:557-564`). It is the cheaper alternative to inline embeds (§8).

### 2.5 Public URLs

`isReservedPath` (`backend/src/utils/redirectPath.js:9-43`) and the live storefront routes (`frontend/src/lib/storefrontHost.ts:98-99`, `:156`) list `pages|blogs|account`. A standalone `/galleries/:slug` page or a deep-linked photo URL would need both lists extended (CLAUDE.md gotcha 22) and the storefront gate on the public route (`gateByOrgParam`, `backend/src/middleware/storefrontGate.js:28`). **Not needed for MVP:** galleries render inside pages, and the page route is already gated.

---

## 3. Competitor feature survey

Platform keys: SH = Shopify, SQ = Squarespace, WX = Wix Pro Gallery, WP = WordPress core Gallery block, JP = Jetpack (Tiled Gallery / Slideshow / Carousel), SM = SmugMug‡, PX = Pixieset‡, FL = Flickr‡, GP = Google Photos, WF = Webflow‡, FR = Framer. Cells give Y (yes), P (partial), N (no) or – (not found in docs), with source numbers in brackets.

| Feature | SH | SQ | WX | WP | JP | SM‡ | PX‡ | FL‡ | GP | WF‡ | FR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Grid | P[1] | Y[4][5] | Y[8] | Y[16] | Y[17] | Y[20] | Y[27] | – | – | P[42] | Y[45] |
| Masonry / justified rows | – | Y[4] (Masonry, Strips) | Y[8] | – | Y[17] (tiled) | Y[20] (collage) | Y[27] | – | – | – | – |
| Collage / mosaic | Y[1] | – | Y[8] | – | Y[17] | Y[20] | – | – | – | – | – |
| Slideshow / carousel | Y[1] | Y[4][5] (Simple, Full, Reel, Carousel) | Y[8] | – | Y[18] | Y[20] | Y[30] | Y[34] | – | Y[41] | Y[44] |
| Sections / sets inside one gallery | – | – | P[47] | – | – | P | **Y[26]** (sets) | Y[46] (collections of albums) | Y[37] (albums) | P[40] | – |
| Caption per photo | – | Y[5] | Y[12] | Y[16] | P[17][18] | Y[20] | – | – | P[37] | Y[40] | – |
| Separate alt text field | Y[2] | P[5] (caption doubles as alt) | Y[12][15] | P[16] | – | – | – | – | – | P[43] | – |
| Per-photo link | – | Y[5] | Y[12] | Y[16] | Y[17] | – | – | – | – | – | – |
| Drag reorder | – | Y[5][7] | Y[12][13] | Y[16] (+ move arrows) | Y[18] | – | – | Y[32] | Y[37] | – | – |
| Bulk upload | – | Y[5] (≤ 250) | Y[12][13] | Y[16] | – | – | Y[25] | – | Y[37] | Y[42] | Y[45] |
| Cover image | – | – | – | – | – | Y[20] | Y[27] (+ focal point) | Y[33] | Y[37] | – | – |
| Lightbox on click | P | Y[6] (grid layouts only) | Y[10] | Y[16] ("Enlarge on click") | Y[19] | Y[21] | – | – | – | Y[40] | – |
| Lightbox keyboard | – | – | – | – | Y[19] | Y[21] (←/→, Esc, F) | – | Y[34] | – | – | – |
| Lightbox swipe | – | – | Y[10] | – | Y[19] | – | – | – | – | – | – |
| Lightbox zoom / pinch | – | **N[6]** | Y[10] | – | Y[19] | – | – | – | – | – | – |
| Thumbnail strip | – | Y[5] | Y[8] | – | – | – | – | – | – | – | – |
| Autoplay + controls | – | Y[5] (1–10 s) | Y[8] | – | Y[18] (pause button) | – | Y[30] (desktop only) | Y[34] | – | Y[41] | Y[44] |
| Load more / progressive | – | – | P[14] | – | P[17] | – | – | – | – | – | – |
| Download | – | – | Y[11] | P[16] | – | Y[23] | Y[28][29] | Y[35] | P[38] | – | – |
| Share | – | – | Y[11] | – | – | Y[22] | Y[31] | Y[36] | Y[38] (link + QR) | – | – |
| Per-photo URL | – | – | – | P[16] | – | Y[22] | – | P[36] | – | – | – |
| Focal point / crop | Y[2] | Y[5] | P[8] | Y[16] | – | – | Y[27] | – | – | – | – |
| Columns / gap | – | Y[5] | Y[8][14] | Y[16] (1–8) | Y[17] | – | Y[27] | – | – | – | Y[44] |
| Separate mobile layout | – | P[4] | **Y[14]** | – | – | – | – | – | – | – | – |
| Favorites / likes / comments | – | – | Y[11] | – | Y[19] | – | Y[29] | – | Y[39] | – | – |

**Table stakes** (found on six or more platforms):
- A grid layout plus a slideshow layout.
- Drag to reorder.
- Bulk upload by dropping many files.
- A caption field.
- Click to open a lightbox with previous/next arrows.
- Autoplay with an interval setting.

**Differentiators:**
- **Masonry or collage layouts:** SQ, WX, JP, SM, PX.
- **Named sets inside one gallery:** only Pixieset [26], which is exactly the "sections" the brief asks for.
- **Lightbox zoom:** WX, JP. Squarespace explicitly has no pinch-zoom on mobile [6].
- **Documented lightbox keys:** JP, SM.
- **Per-photo link copy:** SM [22].
- **Download PIN and favorites lists:** PX.
- **QR code for a shared album:** GP.

**UX details worth copying (mobile first):**
- **Editing on phones:**
  - Wix and Squarespace apps use **tap-hold-drag** to reorder and tap to edit the text [7][13].
  - Squarespace's app has a single "Show as" layout control and saves without a Save step [5][7]. Jump uses a save bar, so keep it (§7).
  - WordPress pairs drag with **move-left/right arrows** [16]. That is the 2.5.7-compliant path, and Jump's `MenuEditor` already does it.
- **Masonry and manual order:** Squarespace Masonry ignores manual order and packs by aspect ratio [4]. Jump's CSS-columns masonry keeps order **down columns**, so tell the organizer in the editor ("Photos fill each column from top to bottom").
- **Captions:** Squarespace shows lightbox captions on hover on desktop and behind a tap on mobile [6]. On a phone, show the caption **below** the photo in the lightbox, never only on hover.
- **Sets:** Pixieset presents sets as tabs or sections the viewer moves between [26]. In Jump: section headings with an optional jump bar of section links. Simple anchors, not tabs.
- **Alt text:** Webflow's lightbox images can't carry their own alt text [43]. Store alt text on the photo and reuse it in the grid and the lightbox.
- **Long galleries:** Wix's "Load more" [14]. Defer it: native `loading="lazy"` covers the MVP.

---

## 4. Accessibility requirements (WCAG 2.2 AA)

| # | Requirement | SC / source |
|---|---|---|
| 1 | Every photo has alt text, or the organizer marks it **decorative** (`alt=""`). Reuse `StoreFile.altText` as the default, with a per-gallery override. Saving is refused when neither is present, the same rule as theme `image()` (`fields.js:103`). An image of text puts its text in the alt | 1.1.1 [A3][A4][A5] |
| 2 | A masonry tile that opens the lightbox is a **functional image**: a `<button>` named by its purpose and content, e.g. "Open photo 3 of 24: crowd at main stage". It is not a bare `<img>` with a click handler | 1.1.1, 4.1.2 [A6] |
| 3 | The lightbox follows the APG modal dialog pattern: `aria-modal`, `aria-labelledby` (gallery title), focus moves in on open, Tab wraps, Escape closes, **focus returns to the tile that opened it**. Native `showModal()` gives top layer + inert background + Esc [A2][A7]. Handle backdrop click yourself: `closedby` is not in Safari release builds [A8] | 2.1.1, 2.1.2, 2.4.3, 4.1.2 |
| 4 | Lightbox prev/next are **buttons**, and ←/→ keys work too. The counter "3 of 24" sits in a polite live region that updates on visitor moves. Swipe is an extra, never the only path | 2.1.1, **2.5.7** [A9], 4.1.3 |
| 5 | The carousel follows the APG basic variant [A1]: container `aria-roledescription="carousel"` + label; each slide `role="group"`, `aria-roledescription="slide"`, `aria-label="n of N"`; prev/next buttons; the **rotation control is first** in the carousel's tab order; rotation stops on hover and focus; the live region is `off` while rotating and `polite` when stopped | 1.3.1, 4.1.2 |
| 6 | Autoplay: **off by default** for galleries. If enabled, a visible pause button, never under `prefers-reduced-motion`, and it stops for good once the visitor moves. Reuse the `HeroCarouselFrame` logic | **2.2.2** [A10]; 2.3.3 (AAA) [A11] |
| 7 | Phones get visible prev/next buttons in the gallery carousel. The hero relies on swipe + dots; galleries should not | **2.5.7** [A9] |
| 8 | Targets are ≥ 24×24 CSS px (aim for 44). Dots qualify only through the spacing or equivalent-control exception, so keep prev/next | **2.5.8** [A12] |
| 9 | Arrow and close buttons drawn over photos have a solid backing at ≥ 3:1. Focus rings are visible over any photo (a double ring: white + brand) | 1.4.11 [A13], 2.4.7 [A14] |
| 10 | Focused tiles are not hidden under the sticky storefront header: `scroll-margin-top` on tiles, the same offset as `--hero-offset` | **2.4.11** [A15] |
| 11 | At 320 CSS px: masonry is 1-2 columns, the carousel shows one slide with a peek, the lightbox has no horizontal page scroll, and long captions wrap | 1.4.10 [A16] |
| 12 | **Masonry order.** CSS multi-column fills column 1 top to bottom, then column 2 [A17], so Tab order runs down columns. That passes 1.3.2 / 2.4.3 only because the DOM order *is* the intended order and visual order matches it within each column. Never reorder with JS or `order` | 1.3.2, 2.4.3 [A18][A19] |
| 13 | `display: grid-lanes` (CSS Grid 3) places items in order-modified DOM order, but the draft warns placement can jump "in a seemingly arbitrary manner". Use `flow-tolerance` to reduce backtracking [A20]. It shipped in Safari 26.4 [A21] and sits behind a flag in Chrome with old `display: masonry` syntax [A22]. Firefox: treat as unsupported. Use it only as an `@supports` enhancement. `reading-flow` is Chrome-only [A23] | 1.3.2, 2.4.3 |
| 14 | Reduced motion: no smooth scroll or zoom animation, no autoplay. Keep motion short (CLAUDE.md motion rule) | 2.3.3 (AAA) |
| 15 | Section headings use real `h2`/`h3` under the page heading, and the jump bar is a `<nav aria-label>` of links | 1.3.1, 2.4.6 |
| 16 | Admin editor: every drag (reorder photos, move between sections) has buttons (Move up/down, "Move to section…") with live announcements, like `MenuEditor` | **2.5.7**, 4.1.3 |
| 17 | Don't adopt Chrome's CSS carousels (`::scroll-button`, `::scroll-marker`). They are Chrome-only, and accessibility specialists report wrong `tab` semantics and broken keyboard behaviour [A24][A25][A26] | — |

---

## 5. Libraries

Already in `frontend/package.json` (origin/main): `@dnd-kit/core` + `@dnd-kit/sortable`, `dnd-kit-sortable-tree`, `react-zoom-pan-pinch`, `lucide-react`. There is **no** Radix, shadcn, Embla, Swiper or lightbox library.

| Option | Size (min+gz) | License / activity | Fit |
|---|---|---|---|
| **Native**: scroll-snap [A27] + `<dialog>` [A7] + CSS columns | 0 | Baseline | **Recommended.** Jump already ships every piece: `HeroCarouselFrame`, `ApplyDrawer`, `useDialog` |
| yet-another-react-lightbox 3.32.2 [B5] | 11.9 KB | MIT, 1 open issue+PR, released 2026-07-30 | Best fallback lightbox. Ships `"use client"`, `role="dialog"`/`aria-modal`, live region off while autoplaying, `inert` offscreen slides, reduced motion, and zoom/thumbnails/captions plugins |
| react-photo-album 3.6.1 [B6] | 4.1 KB | MIT, same author, very active | Best fallback masonry/rows. Has a server/static entry point (no client JS), `@container` breakpoints for zero CLS, and generates `srcset`/`sizes` |
| PhotoSwipe 5.4.4 [B4] | 17.0 KB | MIT, last release 2024-05 (stale), 170 open issues+PRs | Good accessibility options, but stale and not React-native |
| Embla 8.6.0 [B1] (+ shadcn Carousel [B2]) | 7.3 KB (+1.1 autoplay) | MIT, active | v8 has no ARIA. The accessibility plugin is still a v9 RC. shadcn's wrapper has no rotation control or "n of N" labels. No gain over Jump's own carousel |
| Swiper 14.3 [B3] | 20.2 KB core | MIT, 237 open issues+PRs | Heavy. `swiper/react` has no `'use client'` |
| Radix Dialog 1.2 [B7] | 13.1 KB | MIT | Solid, but native `<dialog>` + `useDialog` already cover it |

**Why native.** Following the ponytail ladder, every needed behaviour already exists in Jump:

| Need | Where Jump already has it |
|---|---|
| Swipeable track | `HeroCarouselSection.tsx:64` |
| Rotation logic that meets 2.2.2 | `HeroCarouselFrame.tsx` |
| Modal | `ApplyDrawer.tsx:66-105` |
| Focus trap and return | `useDialog.ts` |
| Pinch zoom (later) | `react-zoom-pan-pinch`, used by `MapCanvas` |

The lightbox is the only genuinely new behaviour, at about 150 lines. Switch to yet-another-react-lightbox only if zoom, thumbnails and slideshow all land at once.

**Images.** Don't introduce `next/image`. Jump never uses it, the backend already serves immutable WebP variants, and `next/image` would need `remotePatterns` for every backend and custom-domain host while re-optimising bytes on the frontend service [C4]. Use a plain `<img>` instead:
- **Width variants:** `srcset` from the new width-bounded variants, with `sizes` matching the column count [C1].
- **Size and loading:** intrinsic `width`/`height` (from `StoreFile`) to prevent CLS [C1][C2], and `loading="lazy"` + `decoding="async"` off-screen.
- **Priority:** eager loading and `fetchpriority="high"` only for the first visible photo when the gallery is above the fold [C2][C3], and `fetchpriority="low"` on carousel slides that start off-screen [C3].

---

## 6. Data model sketch

```prisma
model Gallery {
  id             String   @id @default(cuid())
  organizationId String
  title          String            // admin + lightbox dialog label
  handle         String            // reserved for a later public /galleries/:handle
  description    String?           // plain text, optional
  coverItemId    String?           // later: cover for a gallery index
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  organization Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  sections     GallerySection[]
  @@unique([organizationId, handle])
}

model GallerySection {
  id        String  @id @default(cuid())
  galleryId String
  title     String?                // null = untitled (a gallery with one section shows no heading)
  position  Int
  gallery Gallery       @relation(fields: [galleryId], references: [id], onDelete: Cascade)
  items   GalleryItem[]
  @@index([galleryId, position])
}

model GalleryItem {
  id          String  @id @default(cuid())
  sectionId   String
  fileId      String                 // StoreFile (images only)
  position    Int
  altText     String?                // null = use StoreFile.altText
  decorative  Boolean @default(false)
  caption     String?                // plain text ≤ 300; no HTML in MVP
  section GallerySection @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  file    StoreFile      @relation(fields: [fileId], references: [id], onDelete: Cascade)
  @@index([sectionId, position])
}
```

**Design notes:**
- **Saves.** One `PUT /admin/galleries/:id` replaces the whole tree (title, sections, items) in a transaction. This matches Menus (gotcha 21), keeps `position` dense, and avoids per-item endpoints.
- **References.** Add `GALLERY` to `ContentRefKind` and call `storeFileService.syncReferences('GALLERY', galleryId, { items: fileIds }, orgId)` on save and `clearReferences` on delete. Files' "Used in" then lists the gallery (`StoreFileService.js:264`, `:300`, `:368`).
- **Deleting a file removes it from galleries.** This is the `onDelete: Cascade` on `GalleryItem.file`. Today a file delete only reports its reference count (`StoreFileService.js:218-235`), so the confirm dialog should say "Used in 2 galleries". The alternative, refusing the delete, is an open question.
- **Pages reference galleries by id** with no foreign key, like `MenuItem.targetId` (gotcha 21). A deleted gallery renders nothing on the storefront and shows "Gallery not found" in editors. Gallery deletes never cascade into pages or themes.
- **Limits (proposal):** 20 sections and 500 items per gallery. The serialized payload pages nothing in MVP.
- **Variants.** Add `w480`/`w960`/`w1600`/`w2400` with `fit: 'inside', withoutEnlargement: true` to `ImageService`, generated **on first request** in `getVariantData` and then stored. Existing files then work with no backfill. Return `srcset` candidates in the serialized item.

---

## 7. Admin UX (mobile first)

1. **Content › Galleries list:** title, cover thumbnail (the first photo), photo count, "Used in" count, updated. An **Add gallery** button opens a one-field create (title), then goes to the editor.
2. **Gallery editor** (one page, sticky save bar, nothing saves until **Save**, like Files and Menus):
   - **Header:** editable title, optional description.
   - **Sections:** cards, each with an editable heading (optional) and its photo grid of 3 columns on phones, 5-6 on desktop. **+ Add section** sits below. A section's ⋯ menu offers rename, move up/down, delete (with a "move photos to…" choice).
   - **Add photos** per section opens a **multi-select** `FilePickerDialog` (new `multiple` prop). The dialog's own **Upload** reuses `UploadFilesDialog`; batches of 10 are sent in sequence for bigger drops. Dropping files on a section uploads into Files and adds them in one step.
   - **Photo tile:** tap → a **bottom sheet** on phones (side panel on desktop) with a large preview, alt text (prefilled from the file, "Decorative" checkbox), caption, Move up/down, "Move to section…", Remove from gallery. Missing alt text shows a warning badge on the tile and blocks Save with a list of offenders.
   - **Reorder:** drag with `@dnd-kit/sortable` (touch: press-and-hold) plus the buttons above (2.5.7), with live announcements.
3. **Display options live where the gallery is placed, not on the gallery.** One gallery can be a carousel on Home and masonry on /pages/photos.

---

## 8. Placing a gallery

### 8.1 Puck / full-width pages

```js
// packages/theme/src/registry.js
Gallery: {
  label: 'Gallery', category: 'Media', groups: ['template'],
  settings: {
    gallery: reference('Gallery', 'gallery'),
    heading: text('Heading', { max: 120, default: '' }),
    layout: select('Layout', ['masonry', 'carousel']),
    section: text('Only this section', { max: 120, default: '' }),   // or a reference; open question
    columnsDesktop: range('Columns on desktop', 2, 5, { default: 3 }),
    columnsMobile: range('Columns on mobile', 1, 2, { default: 2 }),
    showCaptions: toggle('Show captions', false),
    showSectionTitles: toggle('Show section titles', true),
    autoplay: select('Autoplay (carousel)', ['off', '5s', '8s'], 'off'),
  },
},
```

The section needs these changes:

| Layer | Change |
|---|---|
| Editor (`fields.tsx:268`) | A `target === 'gallery'` branch: a `select` from a new `ctx.galleries`, plus a "Manage galleries ↗" link |
| `ThemeService._resolve` (`ThemeService.js:533`) | Load `galleries` for ids found in the document, scoped to the org, with items, files and variant URLs |
| Component | `GallerySection.tsx` in `SectionShell` (server), with `GalleryCarousel` / `GalleryLightbox` client islands. Class constants go in `islandClasses.ts` |
| Theme references | The theme document references the **gallery**, not its files, so Files' "Used in" reaches pages through `GALLERY` rows. No `THEME` file rows are needed |

### 8.2 Classic rich-text pages (and blog posts)

**Recommended: inline embed.**
1. Add a Tiptap atom node `galleryEmbed`, copied from `VideoEmbed.ts`. An **Insert gallery** toolbar button picks the gallery and layout.
2. It serialises to `<figure data-jump-gallery="<cuid>" data-layout="masonry|carousel"></figure>`.
3. The sanitiser allows those two attributes on `figure` only. A transform keeps them only when the id matches the cuid regex and the layout is in the enum, and drops the figure's children.
4. On render, `StorefrontPageBody` (`:86-108`) splits `page.content` at the markers and interleaves `ContentHtml` chunks with `GallerySection` (server). The page API resolves the referenced galleries for the org. One splitter helper serves pages and blog posts.

**Cheaper alternative: attach a gallery to the page.** Add `Page.galleryId` + `galleryLayout`, rendered after the body. This follows the `applicationFormId` precedent (`schema.prisma:557-564`), with no sanitiser or editor change, but there is one gallery per page and its position is fixed. Recommend it only if inline placement is not wanted.

**Spec 042 page templates:** add a `gallery` section type (`pageTemplateManifest.js:24`) only if a template author asks for it.

### 8.3 Storefront rendering

**Masonry:**
- A `<ul role="list">` of `<li><button>` tiles.
- Layout is CSS `columns: N` with `break-inside: avoid`, and `@supports (display: grid-lanes)` as an enhancement.
- Each `<img>` carries width/height and `srcset`/`sizes`.
- Section titles are `h2`/`h3`. A jump bar appears when there are more than three sections.

**Lightbox:**
- One `<dialog>` per gallery, holding: a figure (img with `w1600`/`w2400` `srcset`), a caption below, a "3 of 24" counter in a polite live region, and prev/next/close buttons of at least 44 px.
- Keys: ←/→ move, Esc closes.
- Swipe through a horizontal scroll-snap strip inside the dialog, preloading neighbours.
- Focus returns to the tile.
- Navigation crosses sections, and the counter is gallery-wide.

**Carousel:**
- A peek row (UpcomingEvents style), whole images at a fixed height with `object-fit: contain`. No crop.
- Visible prev/next on every breakpoint.
- Autoplay off by default, with the `HeroCarouselFrame` rotation rules and the pause button first.

---

## 9. MVP vs later

**MVP:**
- Gallery / sections / items with whole-tree save.
- Alt text (required or decorative) and captions.
- Multi-select picker plus upload, drag and button reordering.
- "Used in" through `GALLERY` references.
- Lazy fit-inside width variants.
- The Puck `Gallery` section with **masonry + lightbox** and **carousel**.
- The rich-text `galleryEmbed` on pages (blog posts if the splitter is shared at no extra cost).
- Full keyboard, screen-reader and reduced-motion support; axe on phone + desktop in Playwright against the SSR fixture.

**Later, in rough priority order:**
1. Pinch and double-tap zoom in the lightbox (`react-zoom-pan-pinch`).
2. Deep-linkable photo URLs (`#photo-<itemId>`, opening the lightbox on load, the same as `ApplyDrawer`'s `#apply`).
3. A grid layout with aspect-ratio crop by focal point. This needs focal-point-aware cropped variants, which exist only for the cover today.
4. Justified rows (react-photo-album or hand-rolled).
5. Thumbnail strip in the lightbox.
6. "Load more" for galleries with more than 100 photos.
7. Standalone public gallery pages `/galleries/:handle` with an index (needs reserved paths + gate).
8. Download and share buttons.
9. A cover photo.
10. Per-photo links.
11. An event ↔ gallery link ("Photos from last year").
12. CLI and MCP tools for galleries (specs 043 / 045).
13. Blur-up placeholders: a tiny base64 or a dominant colour stored at upload.

**Not planned:** favourites, comments, download PINs and client proofing (photographer-delivery features: Pixieset, SmugMug) do not fit an event storefront.

---

## 10. Open questions for the user

1. **Inline embed or attached gallery on classic pages?** The inline Tiptap embed (recommended) can go anywhere and supports several per page. One attached gallery per page is cheaper.
2. **Sections on the storefront:** do they show as headings in one continuous grid (recommended), as tabs, or as a "show only this section" setting per placement? Should the lightbox cross section boundaries (recommended: yes)?
3. **Is the photo order meaningful?** CSS-columns masonry keeps order down each column, not across rows. If people must read across rows (for example a chronological story), use a JS-balanced or row-based layout instead.
4. **Deleting a file that a gallery uses:** remove it from the gallery silently (with a warning in the confirm dialog, recommended), or refuse until it is removed?
5. **Alt text:** should alt text set in a gallery write back to the file's own alt text, or stay a per-gallery override (recommended: override, with the file's alt text as the default)?
6. **Blog posts in MVP too,** or pages only?
7. **Carousel style:** a peek row of several photos (recommended for galleries), or one full-width slide like the Hero carousel?
8. **Do visitors need a public, shareable URL per gallery or photo** in v1?
9. **Limits:** 500 photos and 20 sections per gallery. Are those acceptable?
10. **Spec 038's inline `Gallery` / `GalleryImage` plan:** retire it in favour of this Content record?

---

## Sources

**Competitors** (‡ = page text taken from official search snippets because the site refused fetches)
1. https://help.shopify.com/en/manual/online-store/themes/theme-structure/sections-and-blocks
2. https://help.shopify.com/en/manual/online-store/images/theme-images
4. https://support.squarespace.com/hc/en-us/articles/360035636332-Gallery-sections
5. https://support.squarespace.com/hc/en-us/articles/206543407-Gallery-blocks
6. https://support.squarespace.com/hc/en-us/articles/205812708-Setting-images-to-open-in-a-Lightbox
7. https://support.squarespace.com/hc/en-us/articles/214199477-Editing-your-site-on-mobile-devices
8. https://support.wix.com/en/article/wix-pro-gallery-changing-the-layout-settings
10. https://support.wix.com/en/article/wix-pro-gallery-customizing-the-expand-mode-for-your-gallery
11. https://support.wix.com/en/article/wix-pro-gallery-customizing-the-gallery-settings
12. https://support.wix.com/en/article/wix-pro-gallery-downloading-images-from-a-gallery
13. https://support.wix.com/en/article/wix-pro-gallery-adding-and-managing-media-in-the-wix-app
14. https://support.wix.com/en/article/wix-pro-gallery-choosing-a-wix-pro-gallery-layout-for-your-mobile-site-custom-vs-presets
15. https://support.wix.com/en/article/accessibility-preparing-your-images-and-galleries
16. https://wordpress.org/documentation/article/gallery-block/
17. https://jetpack.com/support/jetpack-blocks/tiled-galleries/
18. https://jetpack.com/support/jetpack-blocks/slideshow-block/
19. https://jetpack.com/support/carousel/
20. ‡ https://help.smugmug.com/change-how-photos-display-in-my-galleries-rkMSlxPy4Sf
21. ‡ https://www.smugmughelp.com/hc/en-us/articles/18212803350036-Keyboard-shortcuts-for-SmugMug
22. ‡ https://www.smugmughelp.com/hc/en-us/articles/18212716776340-Share-my-photos
23. ‡ https://www.smugmughelp.com/hc/en-us/articles/18212774666004-Download-photos-from-my-SmugMug-site
25. ‡ https://help.pixieset.com/hc/en-us/articles/360058713951-Getting-started-with-Client-Gallery
26. ‡ https://help.pixieset.com/hc/en-us/articles/115003792812-Creating-collections-and-sets
27. ‡ https://help.pixieset.com/hc/en-us/articles/115003795652-Design-Settings-for-Your-Collections
28. ‡ https://help.pixieset.com/hc/en-us/articles/115003795572-Collection-download-settings
29. ‡ https://help.pixieset.com/hc/en-us/articles/115003733131-How-does-proofing-with-Favorites-work
30. ‡ https://help.pixieset.com/hc/en-us/articles/9731769811469-Customizing-slideshows-in-Client-Gallery
31. ‡ https://help.pixieset.com/hc/en-us/articles/115002976571-Can-I-turn-off-Sharing-for-a-Collection-
32. ‡ https://www.flickrhelp.com/hc/en-us/articles/4404064144660-Reorder-the-content-in-an-album
33. ‡ https://www.flickrhelp.com/hc/en-us/articles/4404078540052-Change-the-cover-photo-of-an-album
34. ‡ https://www.flickrhelp.com/hc/en-us/articles/4404058534036-View-Flickr-photos-in-a-slideshow
35. ‡ https://www.flickrhelp.com/hc/en-us/articles/4404079675156-Downloading-content-from-Flickr
36. ‡ https://www.flickrhelp.com/hc/en-us/articles/4404078014356-Share-your-Flickr-content
37. https://support.google.com/photos/answer/6128849
38. https://support.google.com/photos/answer/6131416
39. https://support.google.com/photos/answer/6280921
40. ‡ https://help.webflow.com/hc/en-us/articles/33961337084179-Lightbox
41. ‡ https://help.webflow.com/hc/en-us/articles/33961317173139-Slider
42. ‡ https://help.webflow.com/hc/en-us/articles/33961308586899-Multi-image-field-overview
43. ‡ https://help.webflow.com/hc/en-us/articles/33961346219923-Accessible-elements-in-Webflow
44. https://www.framer.com/academy/lessons/slideshow
45. https://www.framer.com/updates/cms-galleries
46. ‡ https://www.flickrhelp.com/hc/en-us/articles/4404064260884-How-to-create-and-manage-your-Flickr-collections
47. https://support.wix.com/en/article/cms-connecting-the-media-gallery-collection-field-type-to-a-pro-gallery

**Accessibility and CSS**
- A1. WAI-ARIA APG, Carousel pattern: https://www.w3.org/WAI/ARIA/apg/patterns/carousel/
- A2. WAI-ARIA APG, Dialog (Modal) pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- A3. Understanding 1.1.1: https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html
- A4. WAI images tutorial, decorative: https://www.w3.org/WAI/tutorials/images/decorative/
- A5. WAI images tutorial, images of text: https://www.w3.org/WAI/tutorials/images/textual/
- A6. WAI images tutorial, functional: https://www.w3.org/WAI/tutorials/images/functional/
- A7. MDN `<dialog>`: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
- A8. `closedby` support: https://web-platform-dx.github.io/web-features-explorer/features/dialog-closedby/ ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/closedBy ; Safari TP 249: https://webkit.org/blog/18182/release-notes-for-safari-technology-preview-249/
- A9. Understanding 2.5.7: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- A10. Understanding 2.2.2: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- A11. Understanding 2.3.3: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html ; MDN `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- A12. Understanding 2.5.8: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- A13. Understanding 1.4.11: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- A14. Understanding 2.4.7: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- A15. Understanding 2.4.11: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- A16. Understanding 1.4.10: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- A17. CSS Multi-column Layout 1: https://drafts.csswg.org/css-multicol-1/
- A18. Understanding 1.3.2: https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html
- A19. Understanding 2.4.3: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
- A20. CSS Grid Layout 3 (grid-lanes, Editor's Draft 2026-09-02): https://drafts.csswg.org/css-grid-3/
- A21. WebKit, Safari 26.4 features: https://webkit.org/blog/17862/webkit-features-for-safari-26-4/ ; field guide: https://webkit.org/blog/18098/introducing-the-field-guide-to-grid-lanes/
- A22. Chrome masonry update: https://developer.chrome.com/blog/masonry-update ; Chrome 157 notes: https://chromestatus.com/release-notes/157
- A23. MDN `reading-flow`: https://developer.mozilla.org/en-US/docs/Web/CSS/reading-flow
- A24. Chrome, CSS carousels: https://developer.chrome.com/blog/carousels-with-css ; support: https://web-platform-dx.github.io/web-features-explorer/features/scroll-markers/
- A25. Sara Soueidan, CSS carousels accessibility: https://www.sarasoueidan.com/blog/css-carousels-accessibility/
- A26. Adrian Roselli: https://adrianroselli.com/2025/05/my-request-to-google-on-accessibility.html
- A27. MDN CSS scroll snap: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll_snap

**Libraries** (versions and sizes from npm, bundlephobia and the GitHub API, 2026-10-07)
- B1. Embla: https://www.npmjs.com/package/embla-carousel-react ; https://www.embla-carousel.com/docs/plugins/accessibility ; https://github.com/davidjerleke/embla-carousel
- B2. shadcn/ui Carousel: https://ui.shadcn.com/docs/components/carousel ; source https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/carousel.tsx
- B3. Swiper: https://www.npmjs.com/package/swiper ; https://swiperjs.com/swiper-api#accessibility-a11y
- B4. PhotoSwipe: https://photoswipe.com/options/ ; https://github.com/dimsemenov/PhotoSwipe
- B5. yet-another-react-lightbox: https://yet-another-react-lightbox.com/documentation ; https://github.com/igordanchenko/yet-another-react-lightbox
- B6. react-photo-album: https://react-photo-album.com/documentation ; https://github.com/igordanchenko/react-photo-album
- B7. Radix Dialog: https://www.radix-ui.com/primitives/docs/components/dialog

**Performance**
- C1. MDN `<img>` (srcset/sizes, width/height, loading, decoding, fetchpriority): https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img
- C2. web.dev, browser-level lazy loading: https://web.dev/articles/browser-level-image-lazy-loading
- C3. web.dev, fetch priority: https://web.dev/articles/fetch-priority
- C4. Next.js 14 `next/image`: https://nextjs.org/docs/14/app/api-reference/components/image
