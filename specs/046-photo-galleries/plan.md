# Spec 046 — Photo galleries (Content › Galleries)

**Status**: Plan, 2026-10-07. Nothing built.
**Ask**: organizers create photo galleries under **Content**, split into sections, with every photo stored in **Content › Files**. A gallery can be placed on a classic (rich-text) page, a blog post or a full-width (Puck) page. Each placement shows it as a **masonry** grid, where a click opens a lightbox with previous/next, or as a **carousel**. The work must be mobile first, modern and simple, and meet **WCAG 2.2 AA**.
**Research**: [`docs/research/2026-10-07-photo-galleries.md`](../../docs/research/2026-10-07-photo-galleries.md) covers the competitor survey, the accessibility requirements with their success criteria, the library comparison and the code citations. Every `path:line` below points to origin/main a5cc88d.
**UI**: every frontend card is built with the `/frontend-ui-engineering` skill (§7). Admin screens follow the existing Tailwind/shadcn conventions; storefront screens use `brand` tokens through `BrandScope` (gotcha 6).

## 1. What exists today

| Piece | Where | Notes |
|---|---|---|
| `StoreFile` over the content-addressed `File` | `schema.prisma:251-276`, `:209-222` | Has `altText`, `width`, `height` (EXIF-corrected) and `imageId` |
| "Used in" | `StoreFileReference` + `ContentRefKind {PAGE, BLOG_POST, THEME}` (`schema.prisma:395-415`), `StoreFileService.syncReferences` (`:264-298`), `_resolveReferences` (`:368-420`) | Rebuilt on every save |
| Image variants | `ImageService.js:9-13` | `thumb` / `card` / `hero`, **all `fit: 'cover'` (cropped)**, generated when the file is uploaded. Unknown variant → 404 (`images.js:27-56`) |
| Original file URL | `StoreFileService.js:305-311` | Up to 20 MB. `HeroMedia` / `SlideBlock` render it directly |
| Content admin | `AdminSidebar.tsx:72-82` | Files, Forms, Menus, Blog posts |
| One-tree save precedent | Menus: `PUT /admin/menus/:id` (`routes/menus.js:47`), `MenuEditor.tsx` | Drag, plus Move up/down buttons, with live announcements |
| File picker | `components/content/FilePickerDialog.tsx:13-27` | Picks one file only. `UploadFilesDialog` already uploads several at once (`:153`) |
| Storefront dialog building blocks | `lib/useDialog.ts`, `ApplyDrawer.tsx:66-105` | Native `<dialog>` + `showModal()` |
| Carousel precedent | `HeroCarouselFrame.tsx` (spec 041), `UpcomingEventsSection.tsx:71-78` (peek row) | Hero gaps: the pause button comes after the slides, and phones get no arrows |
| Theme reference fields | `fields.js:33`, editor `fields.tsx:268-276`, `ThemeService._resolve` (`:533-556`) | Only `menu` resolves to a picker. Any other target falls back to a text box |
| Rich-text embed precedent | `components/editor/VideoEmbed.ts`, `sanitizeHtml.js:45-86` | An atomic node with a strict sanitiser transform |
| Page body pieces | `StorefrontPageBody.tsx:86-108` | `page_content` / `rich_text` / `contact_form` |
| Spec 038 plan | `specs/038-theme-editor/plan.md:398` | An inline `Gallery` section with up to 24 `GalleryImage` blocks. **This spec retires it** (§9.10) |

**Gaps**:
- No record holds a reusable, ordered set of photos.
- No uncropped resized images exist.
- The file picker cannot select several files.

## 2. Data model

```prisma
model Gallery {
  id             String   @id @default(cuid())
  organizationId String
  title          String                 // admin list + lightbox dialog label
  handle         String                 // unique per org; reserved for a later /galleries/:handle
  description    String?                // plain text ≤ 500, admin-only in MVP
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  organization Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  sections     GallerySection[]
  @@unique([organizationId, handle])
}

model GallerySection {
  id        String  @id @default(cuid())
  galleryId String
  title     String?                     // null = untitled; a one-section gallery shows no heading
  position  Int
  gallery Gallery       @relation(fields: [galleryId], references: [id], onDelete: Cascade)
  items   GalleryItem[]
  @@index([galleryId, position])
}

model GalleryItem {
  id         String  @id @default(cuid())
  sectionId  String
  fileId     String                     // StoreFile, images only
  position   Int
  altText    String?                    // null = use StoreFile.altText
  decorative Boolean @default(false)
  caption    String?                    // plain text ≤ 300
  section GallerySection @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  file    StoreFile      @relation(fields: [fileId], references: [id], onDelete: Cascade)
  @@index([sectionId, position])
  @@index([fileId])
}

enum ContentRefKind { PAGE BLOG_POST THEME GALLERY }   // + GALLERY
```

Rules (decided, §9):
- **Save the whole gallery at once.** `PUT /admin/galleries/:id` replaces the title, sections and items in one transaction, as Menus does (gotcha 21). There are no per-item endpoints, and `position` stays dense.
- **Limits**: 20 sections and 500 items per gallery, enforced by the validator, which returns 400 `GALLERY_LIMIT`.
- **Alt text**: an item's own `altText` comes first, then the file's `altText`. If both are empty, the item must be marked `decorative`, or the save fails with 400 `ALT_TEXT_REQUIRED` and lists the item ids. Alt text entered in a gallery **is not written back to the file**.
- **Files only**: `fileId` must be an image `StoreFile` belonging to the same organization. An SVG is already rejected at upload.
- **File delete**: removing a file removes it from every gallery (the cascade above). `DELETE /admin/files/:id` already returns the reference count. The confirm dialog now names the galleries: "Used in 2 galleries: Photos 2026, Vendors. It will be removed from them."
- **"Used in"**: on every save, call `syncReferences('GALLERY', galleryId, { items: fileIds }, orgId)`; on delete, call `clearReferences`. `_resolveReferences` gains a `GALLERY` branch that returns the gallery title and `/admin/content/galleries/:id`.
- **Placements reference a gallery by id with no foreign key**, the same as `MenuItem.targetId` (gotcha 21). A deleted gallery renders nothing on the storefront and shows "Gallery not found" in editors. Deleting a gallery never cascades into pages or themes.

## 3. Images: uncropped width variants

Add four variants to `ImageService`: `w480`, `w960`, `w1600` and `w2400`, all `fit: 'inside', withoutEnlargement: true`, WebP.
- **Lazy generation**: `getVariantData` builds a width variant on its first request and stores it like the eager variants. No backfill is needed. Concurrent first requests run the same idempotent work, since the content is addressed by hash.
- **Serialized gallery items** carry `{ src, srcset, width, height, alt, caption }`. `srcset` lists only the widths smaller than the original, plus the largest one. `width`/`height` come from `StoreFile`, so the box is reserved and nothing shifts.
- **Rendering** uses a plain `<img>`, never `next/image` (research §5). Masonry `sizes` follows the column count, the lightbox uses `100vw`, and the carousel uses its slide width.
- **Loading**: `loading="lazy"` + `decoding="async"` on every image except the first visible one when the gallery opens the page, which gets `fetchpriority="high"`.
- Cropped variants are never used for a whole-image fit (project memory).

## 4. Organizer UX (admin)

### Content › Galleries list — `/admin/content/galleries`

Phone first: one card per row on phones, a table from `md` up.

```
Content › Galleries                                    [ New gallery ]
┌──────────────────────────────────────────────────────────────────────┐
│ [▣] Retro Expo 2026      84 photos · 3 sections   Used on 2 pages    │
│ [▣] Vendor booths        22 photos                Not placed yet     │
└──────────────────────────────────────────────────────────────────────┘
```

- **New gallery** opens a single-field dialog (Title) and then goes to the editor.
- **States**:
  - Loading shows skeleton rows.
  - Empty shows the heading "No galleries yet", one sentence and **New gallery**.
  - Errors show inline with **Retry**.
- "Used on" counts placements (§5, `GalleryService.placements`), so organizers can see what a delete would affect.

### Gallery editor — `/admin/content/galleries/:id`

One page with a sticky save bar. Nothing saves until **Save**, as in Files and Menus, and leaving with unsaved changes asks for confirmation.

```
← Galleries
Retro Expo 2026  [✎]                                         ⋯  [Save]
┌ Main floor ─────────────────────────────── ⋯ ┐
│ [img][img][img]                               │  phones: 3 columns
│ [img][img][!]  ← alt text missing             │  desktop: 5–6 columns
│ [ + Add photos ]                              │
└───────────────────────────────────────────────┘
┌ Cosplay contest ──────────────────────────── ⋯ ┐
│ …                                              │
└────────────────────────────────────────────────┘
[ + Add section ]
Photos fill each column from top to bottom on the page.
```

- **Sections**:
  - A section heading is optional and edited inline.
  - The section ⋯ menu offers Rename, Move up, Move down and Delete. Deleting asks "Move its 12 photos to…" or "Remove them".
- **Add photos** opens `FilePickerDialog` with a new `multiple` prop:
  - The grid gets checkboxes and the footer reads "Add 8 photos".
  - The dialog's **Upload** tab reuses `UploadFilesDialog` and uploads in sequential batches of 10.
  - Dropping files from the desktop onto a section uploads them to Files and appends them to that section in one step.
- **Photo tile** (a button named "Edit photo: <alt or file name>") opens the photo's settings: a bottom sheet on phones, a side panel from `md` up. It contains:
  - a large preview;
  - **Alt text**, prefilled from the file and marked "(from the file)" until it is edited;
  - **Decorative** checkbox: when checked, the alt text field is disabled and a note explains it;
  - **Caption**;
  - **Move up / Move down / Move to section…**;
  - **Remove from gallery**, which removes the photo from the gallery only, never the file.
- **Reorder** by drag with `@dnd-kit/sortable` (on touch: press and hold for 250 ms). Every move is also possible with the buttons above (2.5.7), and each move is announced in a polite live region: "Moved photo 3 to position 1 in Main floor".
- **Missing alt text**: the tile shows a warning badge (an icon plus "Alt text", never color alone). **Save** then shows an error summary at the top that lists each offender and moves focus to it, the `ContactFormSection` pattern.
- **Header ⋯ menu**: Copy id (for the CLI later) and Delete gallery. Delete asks for confirmation and lists where the gallery is placed.

Display options are **not** stored on the gallery. They are set wherever the gallery is placed (§5), so one gallery can be a carousel on Home and masonry on `/pages/photos`.

## 5. Placing a gallery

### 5.1 Full-width (Puck) pages — theme section `Gallery`

```js
// packages/theme/src/registry.js
Gallery: {
  label: 'Gallery', category: 'Media', groups: ['template'],
  settings: {
    gallery: reference('Gallery', 'gallery'),
    heading: text('Heading', { max: 120, default: '' }),
    layout: select('Layout', ['masonry', 'carousel'], 'masonry'),
    columnsDesktop: range('Columns on desktop', 2, 5, { default: 3 }),
    columnsMobile: range('Columns on phones', 1, 2, { default: 2 }),
    showCaptions: toggle('Show captions', false),
    showSectionTitles: toggle('Show section titles', true),
    autoplay: select('Autoplay (carousel)', ['off', '5s', '8s'], 'off'),
  },
},
```

| Layer | Change |
|---|---|
| Editor (`fields.tsx:268`) | A `target === 'gallery'` branch: a `select` populated from a new `ctx.galleries`, plus a "Manage galleries ↗" link and an "Empty gallery" hint |
| `ThemeService._resolve` (`:533`) | Collect the gallery ids from the document and load them, filtered to the organization, with their sections, items, files and §3 image data |
| Render | `GallerySection.tsx` (a server component inside `SectionShell`) holding the client islands (§6). Class constants go in `islandClasses.ts`. A missing or empty gallery renders nothing, like `BLOCKS_ONLY` |
| "Used in" | Pages reach files through the gallery's `GALLERY` rows. The theme adds no `THEME` file rows for galleries |
| Wording + tests | Follow the six-step "Adding a section" recipe in `docs/wiki/features/theme-sections.md` |

### 5.2 Classic pages and blog posts — inline embed

- **Tiptap node**: `galleryEmbed`, an atomic, draggable node copied from `VideoEmbed.ts`. It serialises to `<figure data-jump-gallery="<cuid>" data-layout="masonry|carousel"></figure>`.
- **Editor**: an **Insert gallery** toolbar button opens a dialog with the gallery select and layout radios. Inside the editor, the node shows a cover tile: the first 4 photos, the title and the layout, plus Edit and Remove.
- **Sanitiser** (`sanitizeHtml.js`): `figure` may carry `data-jump-gallery` and `data-layout`, and nothing else. A transform keeps them only when the id matches the cuid regex and the layout is in the enum, and it drops the figure's children. Organizer HTML is still sanitised when it is saved (gotcha 20).
- **Render**: one helper, `splitGalleryEmbeds(html) → Array<{ html } | { galleryId, layout }>`.
  - `StorefrontPageBody` (`:86-108`) and the blog post body run it, alternating `ContentHtml` chunks with `GallerySection`.
  - The public page and blog post APIs return `galleries: { [id]: serialized }`, resolved for the organization.
  - An unknown id renders nothing.
- **Defaults**: an embed uses the section defaults (3 / 2 columns, captions off, section titles on, autoplay off). Per-embed settings come later.
- **Placements**: `GalleryService.placements(galleryId)` searches page and blog post content for the marker and theme documents for the id. It is used only for the admin "Used on" count and the delete warning.

### 5.3 Spec 042 page templates

There is no `gallery` template section type until a template author asks for one.

## 6. Storefront UX

All three components live in `frontend/src/components/storefront/gallery/`. Each stays under 200 lines.

| File | Role |
|---|---|
| `GalleryMasonry.tsx` | Server component: the grid |
| `GalleryLightbox.tsx` | Client island: the photo viewer dialog |
| `GalleryCarousel.tsx` | Client island: the carousel |
| `useGalleryKeys.ts` | Arrow-key and swipe handling, if needed |

### Masonry

- **Markup**: section titles are `h2` (`h3` when the placement has a heading). Each section is a `<ul role="list">` of `<li><button>` tiles.
- **Tile button name**: "Open photo 3 of 24: <alt>". Decorative photos are named "Open photo 3 of 24".
- **Columns**: CSS `columns: var(--cols)` with `break-inside: avoid` and a gap of 0.5rem on phones, 0.75rem from `md` up. Column counts come from the placement settings.
- **Progressive enhancement**: `@supports (display: grid-lanes) { display: grid-lanes; flow-tolerance: … }`.
- **Order**: DOM order is the visual order within each column. JS and `order` are never used to reorder (1.3.2 / 2.4.3).
- **Section jump bar**: shown when there are more than 3 sections. It is a `<nav aria-label="Gallery sections">` of anchor links that scrolls horizontally on phones.
- **Tile styling**:
  - The image keeps its own height, with `object-fit: cover` never used here.
  - A subtle hover lift that is turned off under reduced motion.
  - A focus ring visible over any photo: a white inner ring plus a `brand` outer ring.
  - `scroll-margin-top` clears the sticky header (2.4.11).
- **Captions** (when enabled) sit below the image in muted text, never only on hover.

### Lightbox

- **Container**: one native `<dialog>` per gallery placement, opened with `showModal()`.
  - `aria-labelledby` points to a visually hidden gallery title.
  - Focus moves to the dialog's Close button and returns to the opening tile when the dialog closes.
  - The visitor's scroll position is kept.
- **Phone layout**: full screen with a dark backdrop. The photo is centered with `object-fit: contain`, and the caption, the "3 of 24 · Main floor" counter and the buttons sit in a bar at the bottom, within the thumb zone, with safe-area padding.
- **Desktop layout**: the photo is limited to the viewport, prev/next sit at the left and right edges, and Close is at the top right.
- **Navigation**:
  - Prev and next are buttons at least 44 px with a solid backing (contrast at least 3:1), and they work across sections.
  - ← / → and Home / End move between photos; Esc closes.
  - Swipe is an extra, using a horizontal scroll-snap strip inside the dialog.
  - Prev and next are disabled at the ends; the gallery does not wrap.
  - Neighbouring photos preload.
  - The counter is a polite live region that updates only when the visitor moves.
  - Clicking the backdrop closes the dialog (handled by the component; `closedby` is not used).
- **Motion**: a cross-fade under 200 ms, removed under `prefers-reduced-motion`.

### Carousel

- **Layout**: a peek row in the UpcomingEvents style: 1.15 slides on phones, 2.5 from `md` and 3.5 from `lg`. Slides have a fixed height (`clamp(14rem, 50vw, 28rem)`) and show the whole image with `object-fit: contain` on a neutral surface, never cropped.
- **APG basic carousel**:
  - The container has `aria-roledescription="carousel"` and an `aria-label`.
  - Each slide has `role="group"`, `aria-roledescription="slide"` and `aria-label="3 of 24"`.
  - Prev/next buttons are visible **on every breakpoint**.
- **Autoplay**: off by default.
  - When it is on, the **pause button comes first** in tab order.
  - Rotation stops on hover or focus and stops permanently after the visitor's first interaction.
  - Autoplay never runs under reduced motion.
  - The live region is `off` while rotating and `polite` when stopped.
  - The rotation logic is reused from `HeroCarouselFrame`.
- **Click**: a slide opens the same lightbox.

### States

- An empty or missing gallery renders nothing on the storefront.
- An image that fails to load keeps its reserved box and shows the alt text in muted type.

## 7. Frontend engineering rules (`/frontend-ui-engineering`)

- **Mobile first**: base styles target phones and expand at `sm` / `md` / `lg`. Every card is checked at **320, 768, 1024 and 1440 px**, with no horizontal page scroll (1.4.10).
- **Composition**: `GallerySection` composes `GalleryMasonry` / `GalleryCarousel` with `GalleryLightbox`. Data fetching stays in the page / `ThemeService`, and the components only render. No component may exceed 200 lines.
- **State**: local `useState` for the open index and the editor draft. There is no global store. The editor keeps one draft tree and sends it with one `PUT`.
- **Tokens only**:
  - Storefront components use `brand` tokens (gotcha 6) and admin components use the existing Tailwind/shadcn scale.
  - No raw hex values and no arbitrary pixel values outside the spacing scale.
  - No gradients, `rounded-2xl` or heavy shadows (avoid the generic "AI look").
- **Required states**: loading (skeleton), empty, error with Retry, success (save toast) and permission (non-ADMIN sees nothing, as in Content today), on every admin screen.
- **Accessibility**: the full checklist is research §4, rows 1–17. Every card's Playwright spec runs axe at 390 and 1280 px, plus a keyboard-only pass.

## 8. Phases (Kanban cards, each a PR with green CI)

1. **046A — Model, variants and API**:
   - Migration (`Gallery`, `GallerySection`, `GalleryItem`, `ContentRefKind.GALLERY`).
   - `GalleryService`: list, get, create, whole-tree `PUT`, delete, `placements`.
   - Validator: limits, the alt-text rule, files from the same organization only.
   - Routes `/admin/galleries` (ADMIN, `activeOrgFor(req)`, registered in `server.js`).
   - `syncReferences` / `_resolveReferences` `GALLERY` branch; file-delete gallery names.
   - Lazy `w480`–`w2400` variants and the item serializer with `srcset`.
   - Contract tests:
     - one org cannot read or use another org's gallery or file;
     - `PUT` replaces the tree and keeps positions dense;
     - `ALT_TEXT_REQUIRED` and `GALLERY_LIMIT` are returned;
     - deleting a file removes its items and the gallery's "Used in" updates;
     - a variant is generated on first request and then cached;
     - `w2400` is never larger than the original.
2. **046B — Admin editor** (`/frontend-ui-engineering`):
   - Sidebar entry and the Galleries list.
   - The editor: sections, tiles, the photo bottom sheet / side panel, drag plus button reordering with announcements, and the save bar with the error summary.
   - `FilePickerDialog` `multiple`, with upload and drop to append.
   - Playwright with `signInAsStaff` and a mocked API at 390 and 1280 px: create a gallery, add photos, fix missing alt text, reorder by keyboard, save; plus axe.
3. **046C — Storefront rendering and Puck section** (`/frontend-ui-engineering`):
   - `GalleryMasonry`, `GalleryLightbox` and `GalleryCarousel`.
   - The `Gallery` theme section: registry, editor gallery picker, `ThemeService._resolve`, render config, wording.
   - Vitest for the index/key reducer.
   - Playwright against the SSR fixture at 390 and 1280 px:
     - Tab to a tile, Enter, ←/→, Esc returns focus;
     - carousel prev/next;
     - autoplay pause is first and reduced motion means no autoplay;
     - axe, plus a CLS check that every image has its box reserved.
4. **046D — Rich-text embed**:
   - The `galleryEmbed` node and the Insert gallery dialog.
   - The sanitiser `figure` attribute transform (Jest: hostile attributes stripped, a bad id dropped).
   - `splitGalleryEmbeds`, shared by `StorefrontPageBody` and the blog post body, and `galleries` in the public page and blog post payloads.
   - The `placements` content search.
   - Playwright: an embed between two paragraphs renders in place on a page and on a blog post.
5. **046E — Hero carousel accessibility fixes** (small, independent): move the `HeroCarouselFrame` pause button first in DOM order and show prev/next on phones. Update its Playwright spec.
6. **Later** (not in this spec):
   - pinch and double-tap zoom (`react-zoom-pan-pinch`);
   - `#photo-<itemId>` deep links;
   - shareable `/galleries/:handle` pages (reserved paths plus the storefront gate, gotcha 22);
   - per-embed settings;
   - a focal-point crop grid;
   - justified rows;
   - a thumbnail strip;
   - load more past 100 photos;
   - download and share;
   - a cover photo;
   - per-photo links;
   - linking a gallery to an event;
   - CLI and MCP tools;
   - blur-up placeholders.

Merge order: A → B and C in parallel → D. E can merge at any time.
After 046D, write a `/doc-feature` wiki page at `docs/wiki/features/galleries.md` and add a CLAUDE.md gotcha (galleries are referenced by id with no foreign key, width variants are lazy, a one-tree `PUT`).

## 9. Decisions (2026-10-07, the research recommendations accepted)

1. **Classic pages**: an inline Tiptap embed, which allows several galleries per page anywhere in the text. The page does not get a `galleryId` column.
2. **Sections on the storefront**: headings within one continuous gallery (with a jump bar when there are more than 3). No tabs and no per-placement section filter. The lightbox and its counter cross sections.
3. **Masonry order**: CSS columns, filled from the top of each column down. The editor says so.
4. **Deleting a file used in a gallery**: it is removed from the gallery, and the confirm dialog names the galleries first.
5. **Alt text**: a per-gallery override that defaults to the file's alt text and is never written back to the file. Every photo needs alt text or the decorative mark.
6. **Blog posts are in the MVP** (the splitter is shared with pages).
7. **Carousel**: a multi-photo peek row with whole, uncropped images. It is not a full-width hero slide.
8. **No public gallery or photo URLs in v1.** Galleries live inside pages, which are already gated.
9. **Limits**: 500 photos and 20 sections per gallery.
10. **Spec 038's inline `Gallery` / `GalleryImage` section is retired.** This Content record replaces it, and `specs/038-theme-editor/plan.md` card E should point here.
11. **No new dependencies.** Native `<dialog>`, scroll-snap, CSS columns and the already-installed `@dnd-kit`. If the lightbox grows past zoom plus thumbnails plus slideshow, the fallback is yet-another-react-lightbox + react-photo-album.
