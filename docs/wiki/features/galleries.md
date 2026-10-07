# Content › Galleries

**Status:** Implemented (spec 046)
**Last Updated:** 2026-10-07 (deferred items built)

## Overview

**Content › Galleries** (`/admin/content/galleries`) holds reusable photo galleries. A gallery is ordered **sections** of photos, and every photo is a file in Content › Files. A gallery is placed on a page in two ways:

- **Full-width (Puck) pages and theme templates:** the **Photo gallery** theme section (category Media), which picks the gallery by id.
- **Classic pages and blog posts:** **Insert gallery** in the rich-text toolbar, which stores an empty `<figure data-jump-gallery="<id>" data-layout="masonry|carousel">` in the content.

Each placement chooses its own display, so one gallery can be a carousel on Home and a masonry grid on another page:

- **Masonry:** CSS columns. Every photo is a button that opens a lightbox (native `<dialog>`) with previous and next.
- **Carousel:** a scroll-snap row with the next photo peeking in and previous/next buttons at every width. Autoplay is optional, with the pause button first.

Spec: `specs/046-photo-galleries/plan.md`. Research: `docs/research/2026-10-07-photo-galleries.md`.

## Rules

- **Saving:** a gallery saves as one tree (`PUT /admin/galleries/:id`), like menus. There are no per-item endpoints, and `position` stays dense.
- **Limits:** at most 20 sections and 500 photos (`GALLERY_LIMIT`).
- **Files:** photos must be images from the same store's Files (`GALLERY_FILE_INVALID`).
- **Alt text:**
  - Every photo needs alt text, its own or the file's, or must be marked decorative (`ALT_TEXT_REQUIRED`).
  - Alt text set on a gallery photo is a per-gallery override. It is **never written back** to the file.
  - In the admin editor, Save lists the photos still missing alt text before calling the API.
- **Deleting a file** removes it from every gallery (`GalleryItem.file` cascades).
- **Used in:** saves write `StoreFileReference` rows of kind `GALLERY`, so the gallery appears in Files "Used in".
- **References by id:** pages, blog posts and themes reference a gallery by id with **no foreign key**, the same as menu items:
  - On the storefront, a deleted gallery renders nothing.
  - A deleted gallery never cascades into content.
  - `GalleryService._placementIndex` finds placements by searching page and blog post content and theme documents.
- **Whole images:** galleries never use the cropped `thumb` / `card` / `hero` variants on the storefront.
  - `ImageService` serves `w480` / `w960` / `w1600` / `w2400` (`fit: inside`, never enlarged, EXIF-rotated).
  - Each width is generated the first time it is requested, then stored, so files uploaded before galleries need no backfill.
  - `widthSources(image)` builds `src` and `srcset`.
- **Sanitising:**
  - The sanitiser keeps a gallery `figure` only in its exact shape: an id of `[a-z0-9]`, a layout of `masonry` or `carousel`, and no children.
  - `splitGalleryEmbeds` (`frontend/src/lib/galleries.ts`) matches that same markup and nothing looser.
  - `ContentWithGalleries` renders the HTML between embeds through `ContentHtml` and each gallery outside the prose styles.
- **Public payloads:** `GET /organizations/:id/public/pages/:slug` (`page.galleries`) and the blog post route (`post.galleries`) resolve embedded galleries for **their own organization only**.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`Gallery`, `GallerySection`, `GalleryItem`, `ContentRefKind.GALLERY`) | Migration `20261027100000_photo_galleries` |
| `backend/src/services/GalleryService.js` | list / get / create / `replace` / remove, `placements`, `resolveForOrg`, `resolveInHtml`, `serializePublic`, `galleryIdsInHtml` |
| `backend/src/api/routes/galleries.js`, `validators/galleryValidators.js` | `/admin/galleries*` |
| `backend/src/services/ImageService.js` | `WIDTH_VARIANTS`, `_buildWidthVariant`, `widthSources` |
| `backend/src/services/ThemeService.js` | `_resolve` adds `resolved.galleries`; the editor preview resolves all of them |
| `backend/src/utils/sanitizeHtml.js` | Gallery `figure` transform and the "empty the embed" pass |
| `packages/theme/src/registry.js` (`Gallery`), `galleries.js`, `content.js` (`gallery.*`) | Theme section, id walker, visitor wording |
| `frontend/src/app/admin/content/galleries/*` | List, editor, `PhotoPanel` (bottom sheet / side panel), `GallerySectionCard`, `PhotoTile` |
| `frontend/src/components/content/FilePickerDialog.tsx` | `multiple` + `onPickMany` |
| `frontend/src/components/storefront/gallery/*` | `GalleryBlock`, `GalleryMasonry`, `GalleryLightbox`, `GalleryCarousel` |
| `frontend/src/components/storefront/ContentWithGalleries.tsx` | Rich-text embeds in pages and blog posts |
| `frontend/src/components/editor/{GalleryEmbed.ts,InsertGalleryDialog.tsx,GalleryListLoader.tsx}` | Tiptap node and Insert gallery |
| `frontend/src/theme/sections/GallerySection.tsx` | Theme section |
| Tests | `backend/tests/contract/galleries.test.js`, `backend/tests/unit/galleryEmbedSanitize.test.js`, `frontend/tests/unit/galleries.test.ts`, `frontend/e2e/{admin-galleries,storefront-gallery}.spec.ts`, `admin-pages.spec.ts` (Insert gallery) |

## Accessibility

- **Photo buttons** are named "Open photo n of N: alt".
- **Lightbox:** focus moves into the dialog and returns to the photo that opened it. ←/→/Home/End and the 44 px buttons move between photos; the buttons use `aria-disabled` at the ends so focus is never dropped. A polite counter announces the position.
- **Carousel:** follows the APG basic carousel. The rotation control comes first. Rotation stops on hover, on focus, and for good after the visitor moves the carousel, and never starts under `prefers-reduced-motion`.
- **Masonry order:** CSS columns fill top to bottom, so DOM order is focus order. Never reorder photos with JavaScript or `order`.
- **Admin:** every drag has a button alternative (section arrows, the panel's Move buttons), and moves are announced.

## Differences from the plan (code review, 2026-10-07)

- **Who can edit:** the routes use `requireOrganizer`, like every Content router, where the plan said ADMIN.
- **Alt text errors:** `ALT_TEXT_REQUIRED` lists `{ section, item, fileId }` positions, not item ids, because a whole-tree `PUT` sends no item ids.
- **Theme editor preview:** it resolves every gallery of the store (`allGalleries`), so a gallery picked in the section settings previews without reloading. That costs one query per editor load.
- **Embed ids:** the sanitiser accepts `[a-z0-9]{1,64}`, a superset of cuid, rather than a strict cuid regex.
- **First-photo priority:** only a rich-text embed that opens the content gets `fetchpriority="high"`. A theme section cannot tell where it sits on the page, so it never does.

## Editor and storefront details

- **Rich-text cover tile:** an embed in the editor shows its first four photos (`thumbUrls` from the gallery list), the title, the layout, and **Edit** and **Remove** buttons. A deleted gallery shows "Gallery not found".
- **Theme editor picker:** a custom field. It warns when the picked gallery is empty or was deleted, and has a **Manage galleries ↗** link (**Edit this gallery ↗** once one is picked).
- **Gallery editor:** **Copy id** copies the gallery's id, for the CLI and agents later.
- **Broken photos:** `GalleryImage` keeps a photo's reserved box when it fails to load and shows its alt text (or "Photo unavailable"). It also catches a failure that happened before hydration.
- **Shared rotation:** both carousels use `lib/useCarouselRotation.ts` (paused, holding, never under reduced motion).

## Later

Pinch zoom, links to a single photo, shareable `/galleries/:handle` pages, per-embed settings, focal-point crop grid, justified rows, thumbnail strip, load more, download / share, cover photo, CLI / MCP tools (plan §8).
