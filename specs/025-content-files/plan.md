# Implementation Plan: Content › Files (spec 025)

**Status**: Built 2026-09-19 on `feat/025-content-files`.
**Spec**: [spec.md](./spec.md). Depends on nothing new; reuses the image pipeline from `ImageService` and the Pages routes.
**Branch**: plan on `plan/025-028-content`; implementation on `feat/025-content-files`, merged to `main` alone (stacked-merge lesson from spec 012).
**Order**: 025 Files → 026 Blog posts → 027 Menus → 028 URL redirects. Blog posts need Files (featured image, editor images); Menus need Pages and Blog posts to link to.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Content-addressed bytes, dedupe on `hash`, `File` row | `ImageService.processUpload`, `hashBuffer`, `originalKey` | Images go through `processUpload(buffer, name, mime, 'store_file', focalX, focalY)` unchanged; PDFs get a sibling `StoreFileService._storeDocument` that writes `files/<hash>.pdf` and creates/reuses the `File` row |
| Variants + focal point | `Image` model, `generateVariants`, `GET /images/:id/:hash/:variant` | Thumbnails and the detail preview use the `thumb` / `card` variants; focal point PATCHes `Image.focalX/Y` |
| Storage backends (local disk / S3) | `services/storage/*` | `put`, `get`, `delete`, `exists`, `getPublicUrl` — no change |
| MIME sniffing | `ImageService.sniffMimeType` (`file-type`) | Shared; PDF is `application/pdf` from the same call |
| Public base URL for absolute links | `utils/publicUrl.js` `backendPublicUrl()` | Absolute `url` in every file payload (Copy link) |
| Multer memory upload with error mapping | `routes/applications.js:37–60` | Same shape, `limits: { fileSize: 20 MB, files: 10 }` |
| Org-scoped admin routes | `routes/admin.js` `activeOrgFor(req)` | New `routes/storeFiles.js` mounted at `/admin/files` uses the same helper (exported from a small `routes/adminScope.js` so it is not re-declared) |
| Orphan cleanup | `ImageService.cleanupOrphans` | Gains "no `StoreFile` and no `Image`" condition |
| Sidebar nested items | `AdminSidebar.tsx` `nested: true` | `Content` + nested `Files` |
| List page conventions (filters, pagination, bulk bar, `⋯` menu, row buttons with refs) | `components/applications/SubmissionsTable.tsx`, `admin/settings/tax` | Same idioms, no shared component extraction yet |
| Dialog primitives | `admin/settings/SettingsDialog.tsx` | Upload-from-URL dialog and delete confirm |
| Slug / name normalisation | `utils/slug.js` | Filename segment of the public URL (`slugify(name)` + extension) |

---

## 2. Design

### 2.1 Schema (one migration `…_content_files`)

```prisma
model StoreFile {
  id             String   @id @default(cuid())
  organizationId String
  fileId         String            // bytes (content-addressed, shared across orgs)
  imageId        String?  @unique  // images only: variants + focal point
  name           String            // display name without extension, editable
  extension      String            // "png" | "jpg" | "gif" | "webp" | "pdf", from the sniffed type
  altText        String?
  width          Int?
  height         Int?
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  file         File         @relation(fields: [fileId], references: [id])
  image        Image?       @relation(fields: [imageId], references: [id])
  references   StoreFileReference[]

  @@index([organizationId, createdAt])
  @@index([organizationId, name])
  @@index([fileId])
}

enum ContentRefKind {
  PAGE
  BLOG_POST      // 026
}

// Which content records use a file (featured image or an <img>/<a> in HTML).
// Rebuilt on every save of the referencing record; rows die with it.
model StoreFileReference {
  id       String         @id @default(cuid())
  fileId   String
  kind     ContentRefKind
  targetId String
  field    String         // "content" | "featuredImage" | "excerpt"

  file StoreFile @relation(fields: [fileId], references: [id], onDelete: Cascade)

  @@unique([fileId, kind, targetId, field])
  @@index([kind, targetId])
}
```

`File` gains `storeFiles StoreFile[]`; `Image` gains `storeFile StoreFile?`; `Organization` gains `storeFiles StoreFile[]`. Width/height are read with `sharp(buffer).metadata()` at upload (already loaded for variants).

### 2.2 Service — `backend/src/services/StoreFileService.js`

```
list(organizationId, { q, type, sort, page, pageSize=50 })  → { files, total, page, pageSize }
get(organizationId, id)                                      → file + references resolved to { kind, targetId, title, href }
createFromBuffer(organizationId, { buffer, originalName, claimedMime, userId })
createFromUrl(organizationId, { url, userId })               → fetch + createFromBuffer
update(organizationId, id, { name?, altText?, focalX?, focalY? })
remove(organizationId, id)                                   → deletes StoreFile (+ Image row); returns reference count it had
removeMany(organizationId, ids)                              → per-id results
syncReferences(kind, targetId, { content: html, featuredImage: fileId, … })   // used by PageService / BlogPostService
serialize(file)                                              → { id, name, extension, mimeType, sizeBytes, width, height, altText, url, downloadUrl, thumbUrl, focalX, focalY, referenceCount, createdAt, updatedAt }
```

- `createFromBuffer`: sniff → if image, `imageService.processUpload(..., 'store_file')` and link `imageId`; if PDF, `_storeDocument` (hash, `files/<hash>.pdf`, `File` upsert by hash). Name = original filename without extension, trimmed to 200, fallback `file`.
- `url` = `${backendPublicUrl()}/files/${id}/${hash}/${slugify(name)}.${ext}` unless `BUCKET_PUBLIC_URL` is set, in which case `storage.getPublicUrl(key)` (images: original key; PDFs: `files/<hash>.pdf`). `thumbUrl` = image `thumb` variant or `null`.
- `syncReferences`: extracts file ids from HTML by matching `/files/([a-z0-9]+)/` in `src`/`href` attributes (server-side regex over the sanitised HTML — no DOM needed) plus explicit ids; deletes rows for `(kind, targetId)` and re-inserts in one transaction. Ignores ids that are not this organization's files.
- `get` resolves references: `PAGE` → `prisma.page.findMany({ where: { id: in } , select: { id, title } })` → `href: /admin/online-store/pages/:id`; `BLOG_POST` (026) → `/admin/content/blog-posts/:id`.

### 2.3 Upload from URL — `backend/src/utils/safeFetch.js`

`fetchPublicResource(url, { maxBytes, timeoutMs })`:
1. Parse; protocol must be `http:`/`https:`; no credentials in the URL.
2. `dns.lookup(host, { all: true })`; reject if any address is loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10), unique-local (fc00::/7), unspecified, or IPv4-mapped forms of these.
3. `fetch` with `redirect: 'manual'`; on 3xx re-run steps 1–2 on `Location`, max 3 hops.
4. Stream the body; abort past `maxBytes` (20 MB) with 400 `File is larger than 20 MB`.
5. Return `{ buffer, contentType, finalUrl }`; name from the last path segment of `finalUrl`.

Unit-tested with a stubbed `dns.lookup` and a local `http.Server`.

### 2.4 Routes

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/files` | `q`, `type=image|pdf`, `sort=created_desc|created_asc|name|size_desc`, `page` |
| `POST` | `/admin/files` | multipart `files[]` (1–10). 201 `{ files: [...], errors: [{ name, message }] }` — partial success per file |
| `POST` | `/admin/files/from-url` | `{ url }`. 201 with the file |
| `GET` | `/admin/files/:fileId` | with resolved references |
| `PATCH` | `/admin/files/:fileId` | partial: `name`, `altText`, `focalX`, `focalY` (validator whitelists keys, Pages pattern) |
| `DELETE` | `/admin/files/:fileId` | 204 |
| `POST` | `/admin/files/bulk-delete` | `{ ids }` → `{ deleted, failed: [{ id, message }] }` |
| `GET` | `/files/:id/:hash/:filename` | public, no auth, no store gate; `?download=1` → attachment. 404 unless `hash` matches. Images stream the original; the filename segment is ignored |

Validators in `validators/storeFileValidators.js` (`validateUpdateStoreFile`, `validateFromUrl`, `validateBulkIds`). Routes in `routes/storeFiles.js` (admin router mounted at `/admin/files` after `requireAuth` + `requireOrganizer`, plus the public router at `/files`) and registered in `server.js`. Rate-limit `POST /admin/files/from-url` (10/min per user) — it triggers outbound fetches.

### 2.5 Frontend

| Path | Component | Notes |
|---|---|---|
| `/admin/content` | `page.tsx` → `redirect('/admin/content/files')` | Sidebar top-level target |
| `/admin/content/files` | `FilesPage` | Header: *Files* + **Upload from URL** (secondary) + **Upload files** (primary). Toolbar: type select (All / Images / PDFs), search, sort. Table per spec. Hover link icon (`Link` from lucide) on the name cell, visible on focus too; `⋯` menu; bulk bar with count + Delete. Drop zone over the whole table (`dragover` overlay). Empty state with upload CTA |
| `/admin/content/files/[fileId]` | `FileDetailPage` | Two columns from `lg`: preview (image `card` variant on a checkerboard, PDF in `<iframe>` with fallback icon) and Information card. Header: back to Files, name, **Download** top-right, `⋯` → Copy link, Delete. Focal-point click on the image (`FocalPointPicker`: click sets `focalX/Y`, shows a marker, arrow keys nudge 1 %). Sticky save bar appears when name / alt / focal differ from the saved record; `beforeunload` guard |
| `components/content/UploadFilesDialog.tsx` | drag-drop + file input, per-file progress, per-file errors, closes on success and refetches | Reuses the validation constants from `lib/content.ts` |
| `components/content/UploadFromUrlDialog.tsx` | URL input, "Fetch" | `SettingsDialog` |
| `components/content/CopyLinkButton.tsx` | clipboard write + fallback, toast via a tiny `useToast` (`components/Toast.tsx`, `aria-live="polite"`) | Reused by blog/pages later |
| `components/content/DeleteFilesDialog.tsx` | lists "Used in" when any selected file has references | |
| `lib/content.ts` | `StoreFile` type, `FILE_TYPES`, `MAX_FILE_MB = 20`, `formatBytes`, `fileKind(ext)` | mirrored from `backend/src/utils/fileLimits.js` |
| `services/api.ts` | `useFilesApi()` hook style like `useTaxApi` — `list`, `get`, `upload(files, onProgress)` (XHR for progress), `fromUrl`, `update`, `remove`, `bulkDelete` | appends `?organizationId=` for SYSTEM_ADMIN as the other hooks do |
| `AdminSidebar.tsx` | `Content` (`/admin/content`) + nested `Files` (`/admin/content/files`); `Menus` / `Blog posts` added by 027 / 026 | `isActive` sub-route logic already handles nesting |

Design notes: admin keeps Tailwind conventions (no storefront brand tokens). Icons from `lucide-react` (`Link`, `Download`, `FileText`, `Image`, `Trash2`, `Upload`). Motion: 150 ms opacity on the hover icon, respects `prefers-reduced-motion`.

### 2.6 Pages wiring

`PageService.create/update` call `storeFileService.syncReferences('PAGE', page.id, { content })` after the write; `PageService.remove` does not exist yet (no delete for pages) — nothing to do. Cascade covers org deletion.

---

## 3. Files

### Backend
- `packages/db/prisma/schema.prisma` — `StoreFile`, `StoreFileReference`, `ContentRefKind`, relations; migration `…_content_files`
- `backend/src/services/StoreFileService.js` (new)
- `backend/src/utils/safeFetch.js` (new), `backend/src/utils/fileLimits.js` (new: `MAX_FILE_BYTES`, `ALLOWED_MIME`, `MIME_TO_EXT` shared with ImageService)
- `backend/src/api/routes/storeFiles.js` (new), `backend/src/api/routes/adminScope.js` (extract `activeOrgFor`; `admin.js` imports it)
- `backend/src/api/validators/storeFileValidators.js` (new)
- `backend/src/api/server.js` — register both routers
- `backend/src/services/ImageService.js` — `cleanupOrphans` condition; export `sniffMimeType` helpers
- `backend/src/services/PageService.js` — reference sync

### Frontend
- `frontend/src/app/admin/content/page.tsx`, `files/page.tsx`, `files/[fileId]/page.tsx`
- `frontend/src/components/content/{UploadFilesDialog,UploadFromUrlDialog,CopyLinkButton,DeleteFilesDialog,FocalPointPicker}.tsx`, `components/Toast.tsx`
- `frontend/src/lib/content.ts`, `frontend/src/services/api.ts`
- `frontend/src/components/AdminSidebar.tsx`

### Docs
- `docs/wiki/features/content-files.md` (via `/doc-feature`), `docs/wiki/README.md`, `AGENTS.md` env table (no new vars) + gotcha on public file URLs, `specs/STATUS.md`

---

## 4. Tests

- **Unit** `backend/tests/unit/storeFileService.test.js`: name/extension derivation, `url` with and without `BUCKET_PUBLIC_URL`, `syncReferences` id extraction (ignores other orgs' ids), `safeFetch` guards (private IP, redirect to private IP, size cap, non-http).
- **Contract** `backend/tests/contract/storeFiles.test.js`: upload PNG + PDF (fixtures), dedupe across two orgs (one `File`, two `StoreFile`), reject `.exe` renamed to `.png`, list filters/sort/pagination/search, PATCH whitelist, public `GET /files/...` 200 / wrong hash 404 / `download=1` header, delete with references returns count, bulk delete partial, org isolation (404 across orgs), SYSTEM_ADMIN via `X-Jump-Org`.
- **E2E** `frontend/e2e/admin-files.spec.ts` (`signInAsStaff`): upload two files via the dialog, hover → copy link (stub clipboard, assert toast), open detail, rename + alt + save, focal point click updates the request body, delete with confirm, bulk delete. Axe on list + detail.

---

## 5. Rollout

1. Migration is additive; no backfill.
2. No env changes. On Railway with a private bucket the public route streams from S3 as `/images` does; with `BUCKET_PUBLIC_URL` links point at the CDN.
3. Local dev stores under `uploads/files/`.
4. After merge run `/doc-feature`; update memory `project_content_plan.md`.

---

## 6. Decisions

- Files are their own model (`StoreFile`) over the shared `File` table rather than adding `organizationId` to `File`: `File` is a global dedupe table and several relations already hang off it.
- Public URLs are not gated by private store mode (Shopify parity; hash acts as a capability). Documented as a gotcha.
- Delete is ORGANIZER (Pages parity), not ADMIN-only. Revisit if roles tighten (spec 005).
- References are materialised on save rather than searched at delete time so *Used in* is O(1) and survives content that only links a file.
- The Content sidebar entry ships in this PR even though Menus / Blog posts arrive later; nested items appear as their PRs land.

## 7. Follow-ups

- SVG (with `attachment` disposition or sanitisation), video.
- "Add to Files" from logo / cover / event image pickers; pick-from-Files in those pickers.
- Storage usage per organization on Settings › Plan.
- Trigram index on `name` / `altText` if search slows.
