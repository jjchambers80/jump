# Online Store Pages

**Status:** Implemented
**Last Updated:** 2026-09-19

## Overview

Organizers create custom content pages (About, FAQ, policies) under **Online store › Pages** in the admin. Pages are organization-scoped (`Page.organizationId`), carry a WYSIWYG HTML `content` snapshot, a visibility toggle, and a Shopify-style **search engine listing**: SEO page title (≤ 70 chars), meta description (≤ 160 chars) and a URL handle (`slug`, unique per organization). The list links each row to an edit form that shares one `PageForm` component with the create form.

Storefront rendering of pages (`/organizations/:orgId/pages/:slug`) is not built yet; the URL is shown as a preview in the form only.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`model Page`) | `title`, `slug`, `content`, `isVisible`, `seoTitle`, `seoDescription`; `@@unique([organizationId, slug])` |
| `backend/src/services/PageService.js` | `list`, `get`, `create`, `update`; `_uniqueSlug` derives the handle from the title and suffixes `-2`, `-3`… on clash within the org |
| `backend/src/api/validators/pageValidators.js` | `validateCreatePage` (full) / `validateUpdatePage` (partial) sharing one field checker |
| `backend/src/utils/pageLimits.js` | `SEO_TITLE_MAX = 70`, `SEO_DESCRIPTION_MAX = 160` (mirrored in `PageForm.tsx`) |
| `backend/src/api/routes/admin.js` | `GET/POST /admin/pages`, `GET/PUT /admin/pages/:pageId` — all through `activeOrgFor(req)` |
| `frontend/src/app/admin/online-store/pages/page.tsx` | List: title link + Edit action per row |
| `frontend/src/app/admin/online-store/pages/PageForm.tsx` | Shared form: title, contentEditable editor, visibility, search engine listing card with live preview + character counters |
| `frontend/src/app/admin/online-store/pages/new/page.tsx` | Create (POST) |
| `frontend/src/app/admin/online-store/pages/[pageId]/page.tsx` | Edit (GET + PUT), 404 shows the standard alert |
| `backend/tests/{unit,contract}/pages.test.js`, `frontend/e2e/admin-pages.spec.ts` | Tests |

## API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/admin/pages` | `{ pages: Page[] }`, newest first |
| `POST` | `/admin/pages` | `title`, `content` required; optional `isVisible`, `slug`, `seoTitle`, `seoDescription`. 201 with the page |
| `GET` | `/admin/pages/:pageId` | 404 when the page belongs to another organization |
| `PUT` | `/admin/pages/:pageId` | Partial: only fields present change. `slug: ""` re-derives the handle from the (new) title; `seoTitle: null` / `""` clears |

Validation errors are `400 { message: 'Validation failed', details: [{ field, message }] }`.

## Search engine listing

- **Handle** — `slugify(title)` (`backend/src/utils/slug.js`, max 60) unless the organizer types one. The frontend normalises the input on blur with the same rules (`previewHandle`) so the preview matches what the backend stores. Clashes inside one organization get `-2`, `-3`…; the same handle is free in another organization.
- **SEO title / meta description** — stored trimmed, blank → `null`. The preview card falls back to the page title and a placeholder snippet.
- Preview URL is `window.location.origin + /organizations/:orgId/pages/:handle`.

## Migration

`20260928000000_page_seo_listing` adds the three columns, backfills `slug` from the title (id when the title has no letters/digits, `slug-id` on an in-org clash), then adds the unique index. Verified against seeded rows before shipping.

## Gotchas

- **Do not reformat `backend/src/api/routes/admin.js` with Prettier** — the file is not Prettier-clean; a `--write` rewrites ~800 lines. Format only the new files.
- **`getByLabel('Title')` is ambiguous in tests** — the SEO "Page title" input also matches. Use `{ exact: true }`.
- **contentEditable is seeded once** (`useEffect` on mount) from `initial.content`; `PageForm` is keyed by `page.id` on the edit route so a different page remounts the editor.
- `SEO_*_MAX` live in both `backend/src/utils/pageLimits.js` and `PageForm.tsx`; change both.

## Related Features

- [Organization Branding](organization-branding.md)
- [Organization Settings](organization-settings.md)
