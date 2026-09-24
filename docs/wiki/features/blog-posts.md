# Content › Blog posts

**Status:** Implemented (spec 026)
**Last Updated:** 2026-09-19

## Overview

**Content › Blog posts** (`/admin/content/blog-posts`) lets organizers publish news, recaps and announcements on the storefront. A **Blog** is the Shopify-style container (the organizer's category) with its own handle and listing URL; every organization gets **News** (`news`) lazily. Posts have a WYSIWYG body (Tiptap), an optional excerpt, a search engine listing (SEO title, meta description, URL handle), Visible / Hidden / Scheduled visibility with a publish date, a featured image from Files, author, blog and tags. The editor never autosaves: a sticky save bar appears when the form differs from the saved record, and ‹ › move between posts (guarded when dirty).

Public routes: `/organizations/:orgId/blogs/:blogHandle` (listing, 12 per page) and `/organizations/:orgId/blogs/:blogHandle/:postHandle`, plus the public **Pages** route `/organizations/:orgId/pages/:slug` (pages were previously unrendered). On a custom domain the short forms `/blogs/…` and `/pages/…` rewrite to the same routes. All three wear the organization header, `BrandScope` and the private-store gate.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`Blog`, `BlogPost`) | Handles unique per org (blogs) / per blog (posts); `content` / `excerpt` are sanitised HTML; `isVisible` + `publishedAt` |
| `packages/db/prisma/migrations/20260930300000_blog_posts` | Adds both tables |
| `backend/src/utils/sanitizeHtml.js` | `sanitizeContentHtml` (allow-list, `h1→h2`, `rel=noopener`, no `data:`/`javascript:`), `htmlToText`, `excerptFromHtml` — the trust boundary for organizer HTML |
| `backend/src/utils/uniqueHandle.js` | `uniqueHandle(model, scope, raw, exceptId)` — `-2`, `-3` suffixing shared by blogs, posts (and menus) |
| `backend/src/services/BlogService.js` | `ensureDefault`, `list`, `create`, `update`, `remove(orgId, id, { moveToBlogId })` (409 while posts remain, 400 for the last blog) |
| `backend/src/services/BlogPostService.js` | `list` (q, status, blogId, sort, page + `summary`), `get` (+ `neighbors`), `create`, `update`, `remove`, `bulk`, `tags`, `publicList`, `publicGet`; `postStatus`, `normalizeTags` |
| `backend/src/api/routes/blogs.js` | `/admin/blogs*`, `/admin/blog-posts*` |
| `backend/src/api/routes/organizations.js` | `GET /:id/public/blogs/:blogHandle[/:postHandle]`, `GET /:id/public/pages/:slug` — `gateByOrgParam`, payload carries the organization identity |
| `backend/src/services/PageService.js` | Sanitises on write; `getPublic(orgId, slug)` (visible pages only) |
| `backend/scripts/sanitize-pages.js` | One-off: clean pages saved before sanitisation |
| `frontend/src/components/editor/RichTextEditor.tsx` (+ `RichTextEditorField.tsx`) | Tiptap StarterKit + Image, `immediatelyRender: false`, loaded with `next/dynamic` (`ssr: false`); toolbar (headings, marks, lists, quote, link popover, image from Files, divider, undo/redo); `variant="compact"` for excerpts |
| `frontend/src/styles/content.css` | `.jump-prose` shared by editor and storefront (`--storefront` uses `--brand-link`) |
| `frontend/src/components/content/{SeoListingCard,SaveBar,TagInput,FilePickerDialog,StatusPill}.tsx`, `lib/useUnsavedChanges.ts` | Shared editor pieces (`SeoListingCard` also powers Pages) |
| `frontend/src/app/admin/content/blog-posts/{page,BlogPostForm,PostEditorPage,useBlogApi}.tsx`, `new/`, `[postId]/` | List (tabs, search, blog filter, sort, bulk show/hide/delete), editor |
| `frontend/src/app/admin/content/blogs/page.tsx` | Manage blogs (add, rename, delete with move) |
| `frontend/src/components/storefront/{StorefrontShell,useStorefrontContent,ContentHtml,BlogPostCard,BlogListingView,BlogPostView,StorefrontPageView}.tsx` | Storefront rendering; `ContentHtml` is the only place stored HTML is injected |
| `frontend/src/app/organizations/[orgId]/blogs/**`, `pages/[slug]/page.tsx`, `lib/storefrontMeta.ts` | Server wrappers with `generateMetadata` (article Open Graph, featured image) |
| `frontend/src/lib/storefrontHost.ts` | `/pages/*`, `/blogs/*` tenant rewrites |
| `frontend/src/app/admin/online-store/pages/PageForm.tsx` | Pages now use `RichTextEditorField` + `SeoListingCard` |
| `backend/tests/{unit/blogPosts,contract/blogs}.test.js`, `frontend/e2e/{admin-blog-posts,public-blog}.spec.ts`, `tests/unit/storefrontHost.test.ts` | Tests |

## API

| Method | Path | Notes |
|--------|------|-------|
| `GET/POST` | `/admin/blogs` | `{ blogs }` with `postCount`; create `{ title, handle? }` |
| `PATCH/DELETE` | `/admin/blogs/:blogId` | delete `?moveToBlogId=`; 409 `This blog still has posts` |
| `GET` | `/admin/blog-posts` | `q` (title, author, exact tag), `status=visible|hidden|scheduled`, `blogId`, `sort=updated_desc|updated_asc|title|published_desc`, `page`, `pageSize` → `{ posts, total, page, pageSize, summary }` |
| `GET` | `/admin/blog-posts/tags` | `{ tags: [{ tag, count }] }` |
| `POST` | `/admin/blog-posts` | `title` required; `authorName` defaults to the session user's name |
| `GET/PATCH/DELETE` | `/admin/blog-posts/:postId` | GET/PATCH include `neighbors: { prev, next }` (list order, updated ↓); PATCH is a whitelist; `handle: ""` re-derives from the title |
| `POST` | `/admin/blog-posts/bulk` | `{ ids, action: delete|show|hide }` → `{ affected, failed }` |
| `GET` | `/organizations/:id/public/blogs/:blogHandle?page=` | public posts only, `content` omitted, `excerpt` = stored or first 40 words |
| `GET` | `/organizations/:id/public/blogs/:blogHandle/:postHandle` | 404 when hidden / scheduled |
| `GET` | `/organizations/:id/public/pages/:slug` | 404 when hidden |

## Visibility rules

- `status` is computed server-side (`postStatus`): `hidden` when `!isVisible`; `scheduled` when visible with a future `publishedAt`; otherwise `visible`.
- The first switch to visible stamps `publishedAt = now` when it is unset; an explicit date (past or future) is kept; hiding keeps the date.
- Bulk *show* stamps missing dates the same way.

## Gotchas

- **Sanitise on write is the trust boundary.** Every path that stores organizer HTML (`BlogPostService`, `PageService`, `EventService`) runs `sanitizeContentHtml`; the storefront renders through `ContentHtml` only. Run `node backend/scripts/sanitize-pages.js` once after deploying to clean pre-existing pages.
- **`sanitize-html` is pinned to 2.16.x**: 2.17 pulls an ESM-only `htmlparser2` that Jest (no transform) cannot load.
- **Tiptap must not render on the server** — always mount through `RichTextEditorField` (`next/dynamic`, `ssr: false`) and keep `immediatelyRender: false`. StarterKit v3 already bundles Link and Underline; do not add those extensions again.
- The editor emits `''` (not `<p></p>`) when empty; `RichTextEditor` pushes external value changes (Discard) with `setContent` and skips its own emissions.
- Blog post handles are unique **per blog**; moving a post to a blog with a clashing handle suffixes it.
- Playwright: register the catch-all `/admin/blog-posts**` route **before** the specific ones — Playwright runs later-registered routes first.
- Session mock in `e2e/helpers/session.ts` now includes `name` (the author default depends on it).

## Related Features

- [Content › Files](content-files.md) — featured image and inline images; *Used in* lists posts
- [Online Store Pages](online-store-pages.md) — same editor, SEO card and public route pattern
- [Online Store Preferences](online-store-preferences.md) — private-store gate on the public routes
