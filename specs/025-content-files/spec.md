# Spec 025 — Content › Files

**Status**: Proposed 2026-09-19. First of four Content features (025 Files → 026 Blog posts → 027 Menus → 028 URL redirects); each ships as its own PR to `main`.
**Reference**: Shopify admin *Content › Files* (list with thumbnail, file name + type, alt text, date added, size, references; *Upload from URL* / *Upload files*; file detail with Information panel — name, alt text, details, added date, *Used in* — and click-to-set focal point). Screenshots reviewed 2026-09-19 (Roman Skin demo store); UI only, content irrelevant.
**Plan**: [plan.md](./plan.md).

## 1. Problem

Organizers need images and PDFs they can link from the storefront (blog posts, pages, menus, emails, social): sponsor packets, floor plans, vendor guides, hero photos. Today the only uploads are single-purpose (organization logo/cover, venue/event images, applicant photos, application file answers); none yields a stable URL an organizer can copy, and none is listed anywhere.

## 2. Scope

### In

- **Content** main navigation item in the admin sidebar with nested **Files** (this spec), **Menus** (027) and **Blog posts** (026). Landing `/admin/content` redirects to Files.
- `/admin/content/files`: table of the active organization's files — checkbox, thumbnail (image variant or type icon), file name + type, alt text, date added, size, references. Search (name, alt text), type filter (All / Images / PDFs), sort (date added ↓ default, name, size), pagination 50.
- Row hover reveals a **link** icon; click copies the public URL to the clipboard (toast "Link copied"). Row click opens the detail page. Row `⋯` → Copy link, Download, Delete. Bulk select → Delete.
- **Upload files** (multi-select + drag-and-drop): JPG, PNG, GIF, WebP, PDF; 20 MB per file; up to 10 per request. **Upload from URL**: the backend fetches the URL (SSRF-guarded) and stores the result with the same rules.
- `/admin/content/files/[fileId]`: preview (image, or PDF viewer / icon), **Download** button top-right, Information card — editable *Name* and *Alt text*, read-only *Details* (type · dimensions · size), *Added*, *Used in* (links to the referencing blog posts / pages), click-to-set **focal point** on images (existing `Image.focalX/Y`). Sticky save bar on unsaved changes. Delete.
- Public, unauthenticated, immutable-cached URL per file: `GET /files/:id/:hash/:filename` (or the bucket CDN URL when `BUCKET_PUBLIC_URL` is set). Not gated by private store mode, matching Shopify CDN behaviour — the URL is unguessable (content hash).
- **References** (*Used in*): a `StoreFileReference` table maintained by the page / blog-post save paths (this spec ships the model, the sync helper and wires Pages; 026 wires blog posts and featured images). Deleting a referenced file asks for confirmation and lists the usages.

### Out (follow-ups)

- Crop / resize / draw / background / generate tools (Shopify's image editor).
- SVG, video, audio, Office documents (SVG is an XSS vector when served inline; needs `Content-Disposition: attachment` or sanitisation — decide with 026 if organizers ask).
- Backfilling existing logo / cover / event images into Files. They stay where they are; a later "Add to Files" action can copy them.
- Folder / collection organisation, tags on files.
- Storage quotas per plan.

## 3. User stories

1. As an organizer I upload a sponsor packet PDF and paste its link into a blog post and an email.
2. As an organizer I upload ten booth photos at once and copy links for the vendor guide page.
3. As an organizer I rename a file and set alt text so blog images are accessible and the URL still works.
4. As an organizer I try to delete a hero image and am told it is used by two blog posts before I confirm.
5. As an organizer I paste an image URL from our Google Drive export and it becomes a file in the store.

## 4. Functional requirements

- FR-001 Files are organization-scoped (`StoreFile.organizationId`); the list and every admin route act on `activeOrgFor(req)`; SYSTEM_ADMIN follows the switcher (`X-Jump-Org`) like every other Content page.
- FR-002 Bytes are content-addressed through the existing `File` table and `StorageBackend`. Two organizations uploading the same PDF share one `File` row and one object; each has its own `StoreFile`. Images also get an `Image` row (`usageType = 'store_file'`) so variants (`thumb`, `card`, `hero`) and focal point work as everywhere else.
- FR-003 The public URL embeds the content hash; it returns `Cache-Control: public, max-age=31536000, immutable` and `ETag`, `Content-Disposition: inline; filename="<name>.<ext>"` (`?download=1` → `attachment`). Renaming a file changes the filename segment of new links; old links keep working because only `id` and `hash` are checked.
- FR-004 MIME type comes from sniffing (`file-type`), never from the client; PDF and the four image types are accepted, everything else 400.
- FR-005 Upload from URL: `http`/`https` only, DNS-resolved address must not be private / loopback / link-local / metadata (checked again after each redirect, max 3), 15 s timeout, 20 MB cap read as a stream, same sniffing rules.
- FR-006 *Used in* lists pages and blog posts that reference the file (featured image or `<img src>` / `<a href>` in content). References are recomputed on every save of the referencing record; deleting the record deletes its references.
- FR-007 Deleting a file removes `StoreFile`, its `Image` row and its references. The underlying `File` and bytes are removed by the existing orphan cleanup once nothing points at them (cleanup gains the `StoreFile` check).
- FR-008 Name is 1–200 characters, no path separators; alt text ≤ 500. Name is stored without the extension; extension is derived from the sniffed type.
- FR-009 Search matches name and alt text (case-insensitive contains). Sorting and filtering happen server-side.
- FR-010 All Content routes require `requireOrganizer` (ORGANIZER or ADMIN), including delete — consistent with Pages.
- FR-011 Copy link works over HTTPS and in local dev (`navigator.clipboard` with a `<textarea>` fallback), announces success via a toast and `aria-live`.
- FR-012 The Files table, upload dialogs and detail page meet the admin accessibility baseline: keyboard reachable rows, focus return after dialogs, labelled icon buttons.

## 5. Non-functional

- Uploads stream through `multer.memoryStorage()` (as today) with `limits.fileSize = 20 MB`; ten files max per request.
- The list endpoint responds in < 300 ms for 5 000 files (indexed `organizationId, createdAt`; search uses `ILIKE` on two columns — acceptable at this scale, revisit with `pg_trgm` if needed).
- Thumbnails come from the `thumb` variant (`/images/...`), never the original.

## 6. Open questions — resolved 2026-09-19

| Question | Answer |
|---|---|
| Alt text field? | Yes, phase 1 |
| Upload from URL? | Yes, phase 1, SSRF-guarded |
| References / Used in? | Yes, phase 1 (Pages wired here, blog posts in 026) |
| Focal point? | Yes, images only, reusing `Image.focalX/Y` |
| Public URL on private stores? | Served regardless of store access (hash-protected), like Shopify's CDN |
| Who can delete? | ORGANIZER and ADMIN (same as Pages) |
