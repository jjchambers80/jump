# Content › Files

**Status:** Implemented (spec 025)
**Last Updated:** 2026-09-19

## Overview

**Content › Files** (`/admin/content/files`) is the organization's asset library: images (JPG, PNG, GIF, WebP) and PDFs uploaded once and linked from pages, blog posts, emails or social. Every file has a public, hash-protected URL that keeps working after a rename and is served with immutable caching. The list shows thumbnail, name + type, alt text, date added, size and how many pages / blog posts reference the file; hovering a row reveals **Copy link**, **Download** and **Delete**. Rows open a detail page with the preview, an editable name and alt text, details, *Used in* links, a click-to-set focal point for images and a **Download** button. Nothing saves until the sticky save bar's **Save**.

**Content** is a new sidebar section (this feature adds it); **Menus** (spec 027) and **Blog posts** (spec 026) join it as nested items.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`StoreFile`, `StoreFileReference`, `ContentRefKind`) | Org-scoped asset over the shared content-addressed `File` row; optional `Image` row (variants + focal point); references from content records |
| `packages/db/prisma/migrations/20260930200000_content_files` | Adds both tables |
| `backend/src/services/StoreFileService.js` | `list` (q, type, sort, page), `get` (resolved references), `createFromBuffer`, `createFromUrl`, `update`, `remove`, `removeMany`, `syncReferences(kind, targetId, fields, orgId)`, `getPublic`, `getData`, `url`, `serialize`; exports `displayName`, `fileIdsInHtml` |
| `backend/src/utils/safeFetch.js` | `fetchPublicResource(url, { maxBytes })` — SSRF-guarded download for *Upload from URL*: http/https only, no credentials, DNS-resolved address must not be loopback / private / link-local / metadata, re-checked on every redirect (max 3), 15 s timeout, streamed size cap |
| `backend/src/utils/fileLimits.js` | `MAX_FILE_MB = 20`, `MAX_FILES_PER_UPLOAD = 10`, name / alt limits, allowed MIME → extension (mirrored in `frontend/src/lib/content.ts`) |
| `backend/src/api/routes/storeFiles.js` | `adminFilesRouter` at `/admin/files`, `publicFilesRouter` at `/files` |
| `backend/src/api/routes/adminScope.js` | `activeOrgFor(req)` extracted from `routes/admin.js` so Content routers share the org rule |
| `backend/src/api/validators/storeFileValidators.js` | PATCH whitelist (`name`, `altText`, `focalX`, `focalY`), from-url body, bulk ids |
| `backend/src/services/PageService.js` | Calls `syncReferences('PAGE', …)` on create / update |
| `backend/src/services/ImageService.js` | `cleanupOrphans` also requires no `StoreFile` and deletes `documents/<hash>.pdf` |
| `frontend/src/app/admin/content/page.tsx` | Redirects to Files |
| `frontend/src/app/admin/content/files/page.tsx` | List: type filter, search, sort, pagination, bulk delete, page-wide drop zone |
| `frontend/src/app/admin/content/files/[fileId]/page.tsx` | Detail: preview / focal point, Information card, Used in, save bar, delete |
| `frontend/src/app/admin/content/files/useFilesApi.ts` | `list`, `get`, `upload`, `fromUrl`, `update`, `remove`, `bulkDelete` |
| `frontend/src/components/content/*` | `UploadFilesDialog`, `UploadFromUrlDialog`, `CopyLinkButton`, `FileThumb`, `FocalPointPicker`, `ConfirmDialog`, `Toast` (`showToast` + `ToastHost`) — reused by later Content features |
| `frontend/src/lib/content.ts` | Types, limits, `formatBytes`, `formatDateAdded`, `validateLocalFile`, `copyText` |
| `backend/tests/{unit,contract}/storeFiles.test.js`, `frontend/e2e/admin-files.spec.ts` | Tests |

## API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/admin/files` | `q`, `type=image|pdf`, `sort=created_desc|created_asc|name|size_desc`, `page`, `pageSize` (≤ 50) → `{ files, total, page, pageSize }` |
| `POST` | `/admin/files` | multipart `files[]` (1–10, ≤ 20 MB each). 201 `{ files, errors: [{ name, message }] }` — partial success; 400 only when nothing was stored |
| `POST` | `/admin/files/from-url` | `{ url }`; 10/min per user |
| `POST` | `/admin/files/bulk-delete` | `{ ids }` → `{ deleted, failed }` |
| `GET` | `/admin/files/:fileId` | Adds `references: [{ kind, targetId, title, href }]` |
| `PATCH` | `/admin/files/:fileId` | Partial whitelist |
| `DELETE` | `/admin/files/:fileId` | 204 |
| `GET` | `/files/:id/:hash/:filename` | Public, `Cache-Control: public, max-age=31536000, immutable`, `ETag`, `Content-Disposition: inline` (`?download=1` → `attachment`). 404 unless `hash` matches. The filename segment is cosmetic |

All admin routes are `requireAuth` + `requireOrganizer` and act on `activeOrgFor(req)` (`X-Jump-Org`; SYSTEM_ADMIN may pass `?organizationId=`).

## Storage

- Bytes are content-addressed: images go through `ImageService.processUpload(…, 'store_file')` (`original/<hash>.<ext>` + `thumb`/`card`/`hero` variants); PDFs are stored once at `documents/<hash>.pdf`. Two organizations uploading the same bytes share one `File` row and one object, each with its own `StoreFile`.
- Public URL: `${BACKEND_URL}/files/:id/:hash/:slug.:ext`, or the bucket/CDN URL when `BUCKET_PUBLIC_URL` is set.
- Deleting a `StoreFile` deletes its `Image` row; the `File` and bytes are removed by `POST /images/cleanup` once nothing references them.

## Gotchas

- **Public file URLs are not gated by private store mode** (Shopify CDN parity). The 64-hex hash is the capability; never list files without it.
- **MIME comes from sniffing** (`file-type`), never the client. SVG is deliberately not accepted (inline SVG is an XSS vector).
- **`api.upload` now sends `X-Jump-Org`** — earlier callers (logo, cover) relied on membership defaults; SYSTEM_ADMIN uploads through the switcher now work everywhere.
- **References are rebuilt on save** of the referencing record (`syncReferences`), not searched at delete time. Any new content type that embeds file URLs must call it (kind in `ContentRefKind`) and clear on delete.
- Do not reformat `backend/src/api/routes/admin.js` with Prettier (not Prettier-clean); `activeOrgFor` now lives in `routes/adminScope.js`.
- Playwright: run with `PLAYWRIGHT_PORT=<free port>`; the Files spec mocks the backend and stubs the clipboard permission.

## Related Features

- [Online Store Pages](online-store-pages.md) — first *Used in* source
- [Organization Branding](organization-branding.md) — logo / cover uploads use the same image pipeline
