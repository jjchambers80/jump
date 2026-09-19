# Spec 026 — Content › Blog posts

**Status**: Proposed 2026-09-19. Second Content feature; depends on 025 Files (featured image, editor images, references).
**Reference**: Shopify admin *Blog posts* list (tabs, search/filter/sort; columns thumbnail, Title, Visibility pill, Author, Blog, Updated ↕, Published; *Manage blogs*, *Manage comments*, *Add blog post*) and the Shopify blog post editor. Screenshots reviewed 2026-09-19; UI only.
**Plan**: [plan.md](./plan.md).

## 1. Problem

Organizers announce line-ups, vendor calls, recaps and sponsor news on WordPress or social because the storefront has no publishing surface. Pages (spec 015-lite, shipped) cover static content but are unlisted, unrendered on the storefront and edited in a bare contentEditable box.

## 2. Scope

### In

- **Blogs** (Shopify's container, the organizer's "category"): each has a title and handle; a default **News** blog exists for every organization. *Manage blogs* page: list, add, rename, delete (blocked while it has posts; offer "move posts to…").
- `/admin/content/blog-posts`: table — checkbox, thumbnail, Title, Visibility pill (Visible / Hidden / Scheduled), Author, Blog, Updated (default sort ↓), Published. Tabs All / Visible / Hidden / Scheduled; search (title, author, tags); filter by blog; sort by updated, title, published. Bulk bar: Delete, Set as visible, Set as hidden. Row `⋯`: View, Delete. **Add blog post** (primary), **Manage blogs** (secondary).
- `/admin/content/blog-posts/[postId]` editor: Title; Content in a **WYSIWYG editor** (headings, bold/italic/underline/strike, lists, quote, link, image from Files, horizontal rule, undo/redo); optional custom **Excerpt** (same editor, small); **Search engine listing** card (page title ≤ 70, meta description ≤ 160, URL handle with live preview URL); **Visibility** card (Visible / Hidden radio + optional publish date-time: future = Scheduled); **Featured image** card (choose from Files or upload; alt text from the file); **Organization** card — Author (text, defaults to the signed-in user's name), Blog (select + "Create new blog"), Tags (chip input with suggestions from existing tags). Header: back, **‹ ›** previous / next post (same order as the list), **View** (opens the public URL; disabled with tooltip when not publicly visible). Footer: **Delete blog post**. Sticky save bar: nothing persists until **Save**; discard restores; leaving with unsaved changes prompts.
- `/admin/content/blog-posts/new`: same form; first Save creates.
- Public storefront: `/organizations/:orgId/blogs/:blogHandle` (listing, newest published first, 12 per page, card = featured image, title, excerpt, date, author) and `/organizations/:orgId/blogs/:blogHandle/:postHandle` (post: title, meta line, featured image, content, tags). Both wear `OrganizationHeader`, `BrandScope`, the private-store gate, and `generateMetadata` (SEO title/description, Open Graph image = featured image). Custom-domain short paths `/blogs/...` rewrite in the tenant middleware.
- Public **Pages** route `/organizations/:orgId/pages/:slug` (and `/pages/:slug` on custom domains) using the same storefront content layout — Pages had no public rendering; Menus (027) must be able to link to them.
- Stored HTML is **sanitised on the server** (allow-list) for blog posts, excerpts and pages. Pages' `PageForm` moves to the same editor component (behaviour-preserving: HTML in, HTML out).
- Files references: featured image and every `<img>`/`<a>` to a file are synced into `StoreFileReference` (`BLOG_POST`).

### Out (follow-ups)

- Comments (*Manage comments*), RSS/Atom feed, related posts, author profiles, per-post Open Graph overrides beyond the featured image, post templates, revision history, Markdown import, scheduled un-publish, per-blog SEO fields, blog listing on the org home page (027 links to it; a "Latest posts" block on the storefront home is a later storefront spec).

## 3. User stories

1. As an organizer I write "Vendor applications open" with a hero image from Files, tag it *vendors*, schedule it for Monday 9 am, and share the link in the Monday email.
2. As an organizer I fix a typo across three recap posts using ‹ › without returning to the list.
3. As an organizer I hide an outdated post in bulk with two others.
4. As a visitor on the custom domain I open `/blogs/news/recap-2026`, see the org's header and brand colors, and share it — the preview card shows the featured image.
5. As an organizer I see in Files that the hero image is used by two posts before deleting it.

## 4. Functional requirements

- FR-001 `Blog` and `BlogPost` are organization-scoped; handles are unique per organization (blogs) and per blog (posts); derived from the title unless typed; clash → `-2`, `-3` (Pages rule, `_uniqueSlug`).
- FR-002 Public visibility = `isVisible && (publishedAt == null || publishedAt <= now)`. Status pill: Hidden (`!isVisible`), Scheduled (`isVisible && publishedAt > now`), Visible otherwise. `publishedAt` is set to `now()` on the first switch to Visible when unset, so *Published* shows a date.
- FR-003 Content, excerpt and page content are sanitised server-side with an allow-list (block elements, inline marks, `a[href|title|target=_blank|rel]`, `img[src|alt|width|height]`, `hr`, `br`, `pre`, `code`, `table` family); `javascript:`/`data:` hrefs and inline styles/scripts/events are stripped. The frontend renders the stored HTML as-is.
- FR-004 Images inserted from the editor and the featured image are `StoreFile`s; the editor never uploads to a separate path. Base64 images are rejected by the sanitiser.
- FR-005 Tags are free-form, trimmed, ≤ 40 chars, ≤ 20 per post, unique per post; `GET /admin/blog-posts/tags` returns the organization's distinct tags for suggestions.
- FR-006 Author is free text ≤ 100, defaults to the session user's name on create.
- FR-007 Previous / next follow the list's default order (updated ↓) within the organization, ignoring filters; the API returns `neighbors: { prevId, nextId }` with the post.
- FR-008 Deleting a blog with posts is refused (409) unless `moveToBlogId` is supplied; the default blog cannot be deleted while it is the only one.
- FR-009 Public endpoints are gated by private store mode (`gateByOrgParam`) and hide non-public posts with 404 (never "hidden"). Listing pagination is `page` / `pageSize=12`.
- FR-010 `generateMetadata` uses `seoTitle ?? title`, `seoDescription ?? plain-text excerpt (≤ 160)`, `og:image` = featured `card` variant absolute URL, `og:type = article`, `article:published_time`.
- FR-011 Every admin route is `requireOrganizer` + `activeOrgFor(req)`; cross-org ids 404.
- FR-012 Save bar and unsaved-changes guard: no field autosaves; the Save button is disabled until the form is dirty and valid (title non-empty, blog chosen).
- FR-013 Accessibility: editor toolbar is a `role="toolbar"` with `aria-pressed` states and keyboard shortcuts (⌘/Ctrl+B/I/U/K); public pages have one `h1`, images carry alt text; contrast follows `BrandScope`.

## 5. Non-functional

- Editor bundle (Tiptap StarterKit + Link + Image) is loaded only on admin editor routes (`next/dynamic`, `ssr: false`).
- Public post pages are server-rendered (`page.tsx` server component fetches then renders a client body only for interactive bits), cache `revalidate = 60` on the fetch.
- Sanitiser runs on every write; content ≤ 200 KB per post.

## 6. Open questions — resolved 2026-09-19

| Question | Answer |
|---|---|
| Category model | Shopify-style Blog container with handle and listing URL; default "News" |
| Author | Free text, defaults to the signed-in user's name |
| Scheduling | Yes: Visible / Hidden + optional publish date |
| Comments | Out of scope |
| Storefront rendering in this PR | Yes: blog listing, post page, and the public Pages route |
| Editor | Tiptap; Pages migrate to it in the same PR (phase 3) |
