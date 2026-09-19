# Implementation Plan: Content › Blog posts (spec 026)

**Status**: Planned 2026-09-19. Not built.
**Spec**: [spec.md](./spec.md). Depends on 025 Files on `main` (`StoreFile`, `StoreFileReference`, `useFilesApi`, `CopyLinkButton`, `Toast`).
**Branch**: `feat/026-blog-posts`, merged to `main` alone. Phases below are commits / review checkpoints inside one PR; split into PRs only if review size demands it (phase 3 is the natural cut).

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Page CRUD, partial validators, `_uniqueSlug`, `optionalText`, SEO limits | `PageService`, `validators/pageValidators.js`, `utils/pageLimits.js` | `BlogPostService` copies the shape; `_uniqueSlug` generalised into `utils/uniqueHandle.js` (`uniqueHandle(model, where, raw, exceptId)`) used by pages, blogs, posts (and menus in 027) |
| SEO listing card with counters + preview | `PageForm.tsx` | Extracted to `components/content/SeoListingCard.tsx`, used by pages and posts |
| Org-scoped admin routes | `routes/adminScope.js` `activeOrgFor` (025) | All blog routes |
| Files: picker, upload, references | 025 `useFilesApi`, `StoreFileService.syncReferences`, `UploadFilesDialog` | `FilePickerDialog` (grid of image files + upload tab) for featured image and editor image insert |
| Storefront chrome | `OrganizationHeader`, `BrandScope`, `StorefrontPasswordGate`, `storefrontLockFrom`, `lib/storefrontAccess.ts` | Public blog and page routes |
| Public meta pattern | `organizations/[orgId]/page.tsx` `generateMetadata` from `/public/meta` | Post and page `generateMetadata` |
| Storefront gate | `middleware/storefrontGate.js` `gateStorefront` | New `gateByOrgParam = gateStorefront(req => ({ organizationId: req.params.id }))` |
| Tenant host routing | `lib/storefrontHost.ts` `routeForTenantHost` | Add `/blogs/*` and `/pages/*` rewrites to `/organizations/:orgId/...` |
| List conventions | `SubmissionsTable` (tabs from summary, bulk bar, pagination, `⋯` menu), Files table (025) | Same idioms |
| Session user name | `useSession().data.user.name` | Author default |

---

## 2. Design

### 2.1 Schema (migration `…_blog_posts`)

```prisma
model Blog {
  id             String   @id @default(cuid())
  organizationId String
  title          String
  handle         String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  posts        BlogPost[]

  @@unique([organizationId, handle])
}

model BlogPost {
  id             String    @id @default(cuid())
  organizationId String
  blogId         String
  title          String
  handle         String
  content        String    // sanitised HTML
  excerpt        String?   // sanitised HTML, null = derive from content
  authorName     String
  tags           String[]  @default([])
  featuredFileId String?
  isVisible      Boolean   @default(false)
  publishedAt    DateTime?
  seoTitle       String?
  seoDescription String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  blog         Blog         @relation(fields: [blogId], references: [id])
  featuredFile StoreFile?   @relation(fields: [featuredFileId], references: [id], onDelete: SetNull)

  @@unique([blogId, handle])
  @@index([organizationId, updatedAt])
  @@index([blogId, isVisible, publishedAt])
}
```

`ContentRefKind` already has `BLOG_POST` (025). `Organization` gains `blogs`, `blogPosts`; `StoreFile` gains `featuredIn BlogPost[]`.

No seed migration for the default blog: `BlogService.ensureDefault(orgId)` creates **News** (`news`) when the organization has no blog; called from `list`, from post create, and from the public listing route. Idempotent via the unique index.

### 2.2 Sanitiser — `backend/src/utils/sanitizeHtml.js`

`sanitize-html` (new backend dependency) with one exported config `CONTENT_HTML`:
- tags: `p h2 h3 h4 ul ol li blockquote a img strong b em i u s br hr pre code table thead tbody tr th td figure figcaption`
- attributes: `a: href title target rel`, `img: src alt width height`, `td/th: colspan rowspan`
- `allowedSchemes: ['http','https','mailto','tel']`, `allowedSchemesByTag.img = ['http','https']` (kills base64), `allowProtocolRelative: false`
- `transformTags.a` forces `rel="noopener"` when `target=_blank`
- `h1` downgraded to `h2` (the page title owns `h1`)

Applied in `BlogPostService.create/update` (content, excerpt) and `PageService.create/update` (content). Existing page rows: a one-off script `backend/scripts/sanitize-pages.js` run once after deploy (documented in rollout); until then the public page route sanitises at read time as well.

### 2.3 Services

`BlogService` — `list(orgId)` (with post counts), `create`, `update` (title, handle), `remove(orgId, id, { moveToBlogId })`, `ensureDefault`.

`BlogPostService`
```
list(orgId, { q, status: visible|hidden|scheduled, blogId, sort, page, pageSize=25 }) → { posts, total, summary: { all, visible, hidden, scheduled } }
get(orgId, id)                     → post + blog + featuredFile (serialised via StoreFileService) + neighbors
create(orgId, data, userId)        → default authorName from user, ensureDefault blog when blogId missing
update(orgId, id, data)            → partial; publishedAt rule (FR-002); handle re-derive on ""; sanitise; syncReferences
remove(orgId, id) / bulk(orgId, ids, action: delete|show|hide)
tags(orgId)                        → distinct tags sorted
publicList(orgId, blogHandle, page)  → public posts only, serialised for the storefront (excerpt: stored or first 40 words of text)
publicGet(orgId, blogHandle, postHandle)
```
`serialize` returns `status` computed server-side so the list and the pill never disagree. `neighbors` = `findFirst` before/after on `(updatedAt, id)` within the org.

### 2.4 Routes

| Method | Path | Notes |
|---|---|---|
| `GET/POST` | `/admin/blogs` | list with counts / create |
| `PATCH/DELETE` | `/admin/blogs/:blogId` | delete accepts `?moveToBlogId=`; 409 while posts remain |
| `GET` | `/admin/blog-posts` | filters per 2.3 |
| `GET` | `/admin/blog-posts/tags` | registered before `/:postId` |
| `POST` | `/admin/blog-posts` | 201 |
| `GET/PATCH/DELETE` | `/admin/blog-posts/:postId` | PATCH partial whitelist |
| `POST` | `/admin/blog-posts/bulk` | `{ ids, action }` |
| `GET` | `/organizations/:id/public/blogs/:blogHandle` | gated; `?page=` |
| `GET` | `/organizations/:id/public/blogs/:blogHandle/:postHandle` | gated; 404 when not public |
| `GET` | `/organizations/:id/public/pages/:slug` | gated; 404 when `!isVisible` |

Files in `routes/blogs.js` (admin) and additions to `routes/organizations.js` (public). Validators `validators/blogValidators.js` (`validateCreateBlog`, `validateUpdateBlog`, `validateCreateBlogPost`, `validateUpdateBlogPost`, `validateBulkPosts`) share one field checker like `pageValidators`.

### 2.5 Editor — `frontend/src/components/editor/RichTextEditor.tsx`

Dependencies: `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-image` (skip any already bundled by the installed StarterKit version — v3 ships Link and Underline inside StarterKit; confirm at install and drop duplicates). `useEditor({ immediatelyRender: false, extensions, content, onUpdate })` behind `next/dynamic(..., { ssr: false })`.

Props: `value: string` (HTML), `onChange(html)`, `variant: 'full' | 'compact'`, `onInsertImage?: () => Promise<{ url, alt } | null>` (opens `FilePickerDialog`; caller supplies), `id`/`aria-labelledby`.

Toolbar (`role="toolbar"`, lucide icons, `aria-pressed`): paragraph/H2/H3 select, Bold, Italic, Underline, Strike, Bulleted, Numbered, Quote, Link (popover with URL + "open in new tab"), Image (Files picker), Divider, Undo, Redo. Link extension: `openOnClick: false`, `defaultProtocol: 'https'`, `isAllowedUri` = http/https/mailto/tel. Image extension: block images, `allowBase64: false`, `HTMLAttributes: { loading: 'lazy' }`.

Styling: editor content and storefront rendering share `frontend/src/styles/content.css` (`.jump-prose` rules: headings, lists, blockquote, table, img max-width, links use `text-brand-link` on the storefront and indigo in admin). No `@tailwindcss/typography` dependency — a 60-line stylesheet keeps brand tokens in control.

`PageForm.tsx` (phase 3) swaps its contentEditable + `execCommand` for `RichTextEditor` (value = `content`, same submit payload). The `admin-pages.spec.ts` selectors move from the old toolbar buttons to the new ones.

### 2.6 Admin pages

| Path | Notes |
|---|---|
| `/admin/content/blog-posts` | `BlogPostsTable`: tabs from `summary`; search; blog filter select; sort select (Updated ↓ default, Title, Published); table per spec (thumb = featured `thumb` or `ImageOff` icon); bulk bar (Delete, Set as visible, Set as hidden); row `⋯` (View — public URL when public, Delete). Header buttons **Manage blogs** → `/admin/content/blogs`, **Add blog post** → `/new` |
| `/admin/content/blogs` | Table Title / Handle / Posts; **Add blog** dialog; row edit dialog (title, handle); delete dialog with "Move posts to" select when count > 0 (`SettingsDialog`) |
| `/admin/content/blog-posts/new`, `/[postId]` | `BlogPostForm` (one component, `initial?`): layout `lg:grid-cols-[1fr_20rem]`. Main: Title, Content (`RichTextEditor` full), Excerpt (disclosure "Add excerpt" → compact editor), `SeoListingCard` (URL preview `/organizations/:org/blogs/:blog/:handle`). Side: Visibility card (radios + "Set a publish date" date-time input, note "Scheduled" when future), Featured image card (preview, Change / Remove, `FilePickerDialog`), Organization card (Author input, Blog select + "Create new blog" inline dialog, Tags chip input with suggestions). Header: back link, title ("Add blog post" / post title), `‹ ›` (disabled at ends; navigate only after a dirty-check), **View** (`target=_blank`, disabled with `title="Post is not visible"`), `⋯` → Delete. Footer: **Delete blog post** (danger). `SaveBar` (new `components/content/SaveBar.tsx`: fixed bottom, "Unsaved changes" + Discard + Save, `beforeunload` + in-app navigation guard via a `useUnsavedChanges` hook) |

`useBlogApi()` in `services/api.ts` next to `useFilesApi`.

### 2.7 Storefront

| Path | Notes |
|---|---|
| `app/organizations/[orgId]/blogs/[blogHandle]/page.tsx` | Server component: fetch `/public/blogs/:handle?page=`; `generateMetadata` (blog title · org name); renders `StorefrontContentShell` (client: `BrandScope` with `themeMode`, `OrganizationHeader as="link"`, gate on `storefrontLockFrom`) + `BlogPostCard` grid + pager |
| `app/organizations/[orgId]/blogs/[blogHandle]/[postHandle]/page.tsx` | Server component: fetch post; `generateMetadata` per FR-010; body: `h1`, meta line (author · date · blog link), featured image (`hero` variant, focal point via `object-position`), `ContentHtml` component (renders the server-sanitised HTML inside `.jump-prose`; the only place stored HTML is injected — documented in AGENTS.md), tag chips |
| `app/organizations/[orgId]/pages/[slug]/page.tsx` | Same shell; `h1` title + `ContentHtml` |
| `lib/storefrontHost.ts` | `routeForTenantHost`: `/blogs/...` and `/pages/...` → rewrite to `/organizations/:orgId/...` |
| `services/api.ts` | `publicBlog`, `publicBlogPost`, `publicPage` helpers |

Because the private-store token is browser-side (`localStorage`), the server component tries an unauthenticated fetch for metadata and public content; on `403 locked` it renders the client shell, which fetches again with the token and shows the gate otherwise. Same two-step as the org page.

---

## 3. Files

### Phase 1 — data + admin list/editor
- schema + migration; `BlogService.js`, `BlogPostService.js`, `utils/sanitizeHtml.js`, `utils/uniqueHandle.js`; `routes/blogs.js`; `validators/blogValidators.js`; `server.js`
- `PageService.js` → `uniqueHandle` + sanitiser
- frontend: `components/editor/RichTextEditor.tsx`, `components/content/{SeoListingCard,SaveBar,FilePickerDialog,TagInput}.tsx`, `lib/useUnsavedChanges.ts`, `styles/content.css`, `app/admin/content/blog-posts/{page,new/page,[postId]/page,BlogPostForm}.tsx`, `app/admin/content/blogs/page.tsx`, `services/api.ts`, `AdminSidebar.tsx` (nested **Blog posts**)

### Phase 2 — storefront
- `routes/organizations.js` public endpoints + `gateByOrgParam`; `app/organizations/[orgId]/blogs/**`, `pages/[slug]`; `components/storefront/{StorefrontContentShell,BlogPostCard,ContentHtml}.tsx`; `lib/storefrontHost.ts`

### Phase 3 — Pages adopt the editor
- `PageForm.tsx` → `RichTextEditor` + `SeoListingCard`; `scripts/sanitize-pages.js`; `admin-pages.spec.ts` selectors

### Docs
- `docs/wiki/features/blog-posts.md`, `online-store-pages.md` (editor, public route, sanitiser), `AGENTS.md` gotcha (sanitise on write; `ContentHtml` is the only HTML injection point), `frontend/AGENTS.md` (editor + content.css), `specs/STATUS.md`

---

## 4. Tests

- **Unit**: `sanitizeHtml.test.js` (script/style/on*/javascript:/base64 stripped, `h1→h2`, `rel=noopener`), `blogPostService.test.js` (status derivation, publishedAt rule, excerpt derivation, neighbors, handle clash), `uniqueHandle.test.js`.
- **Contract** `blogs.test.js`: default blog ensured; CRUD; delete blog 409 / move; list tabs + search + sort + pagination; bulk actions; tags endpoint; references synced (featured + inline img → `StoreFileReference` rows; removed on delete); cross-org 404; public listing hides hidden + scheduled, 404 on hidden post, gate 403 on private store, page public route.
- **E2E** `admin-blog-posts.spec.ts`: create post with editor (type, bold, insert image from stubbed Files), set scheduled date, Save, pill = Scheduled; ‹ › navigation with dirty guard; bulk hide; delete. `public-blog.spec.ts`: listing + post render with brand color, metadata tags present. Vitest `storefrontHost.test.ts` for the new rewrites.

---

## 5. Rollout

1. `npm install` from root (Tiptap packages in `frontend`, `sanitize-html` in `backend`).
2. Migration additive. Run `node backend/scripts/sanitize-pages.js` once in prod after deploy.
3. No env changes. Custom domains pick up `/blogs` and `/pages` on deploy of the frontend.
4. `/doc-feature`; memory update.

---

## 6. Decisions

- Blog = Shopify container with its own handle; post URLs are `/blogs/:blog/:post` (resolved 2026-09-19).
- Default blog is created lazily (`ensureDefault`) rather than by migration — no data migration, works for orgs created later.
- Tiptap over Lexical/Slate: headless, React 18 + Next 14 support with `immediatelyRender: false`, HTML in/out matches the existing `Page.content` storage; ProseMirror schema keeps pasted HTML clean before the server sanitiser.
- Server-side sanitisation is the trust boundary; the storefront renders stored HTML through one `ContentHtml` component. Existing pages get a one-off script.
- Own `content.css` instead of `@tailwindcss/typography` so storefront links/headings use `brand` tokens (Gotcha 6).
- Author is free text (resolved); no comments.

## 7. Follow-ups

- Duplicate post, revision history, RSS feed, "Latest posts" block on the org home, per-blog SEO, comments, scheduled un-publish, Markdown paste.
- SVG in Files once the editor needs icons.
