# Event Media Card

**Status**: Implemented
**Last Updated**: 2026-09-24

## Overview
The admin create and edit event pages have a **Media** card directly below Event Details, modelled on Shopify's product Media section. Organizers add, replace or remove the event image there. There is one image per event for now; the card's grid layout leaves room for more later.

## Key Files
| File | Purpose |
|------|---------|
| `frontend/src/components/events/EventMediaCard.tsx` | The card: empty drop zone (**Upload new**), filled grid (image tile + dashed **Replace** tile + hover delete), client-side validation, upload spinner |
| `frontend/src/components/ImageUploader.tsx` | Older generic uploader (org / venue logos). Exports `ALLOWED_TYPES`, `MAX_SIZE_MB`, `MAX_SIZE_BYTES`, which the Media card reuses |
| `frontend/src/app/admin/events/[eventId]/edit/page.tsx` | Edit page: uploads and deletes immediately through `handleLogoUpload` / `handleLogoRemove`; shows the `?imageUpload=failed` notice |
| `frontend/src/app/admin/events/new/page.tsx` | Create page: holds the chosen file, uploads it after the event is created |
| `backend/src/api/routes/events.js` | `POST` / `DELETE /organizations/:orgId/events/:eventId/logo` |
| `backend/src/middleware/imageUpload.js` | `uploadImage` multer middleware: field `logo`, 5 MB, JPG / PNG / GIF / WebP |
| `backend/src/services/ImageService.js` | `processUpload(..., 'event_logo')`: MIME sniffing, variants, storage |
| `frontend/e2e/admin-event-form-layout.spec.ts` | Card position, filled state, create-with-image, failed-upload redirect |

## Configuration
No card-specific config. Image storage follows the `BUCKET_*` variables (S3-compatible bucket, or local `uploads/` when unset); see the root `AGENTS.md` environment table.

## How It Works

### Card states
- **Empty**: a dashed drop zone with an image icon, an **Upload new** button, "or drag and drop an image" and the accepted formats.
- **Filled**: a square grid. The first tile shows the image whole (`object-contain`) on a neutral background, with a delete button in its top-right corner (shown on hover or keyboard focus; always visible on devices without hover). The second tile is a dashed **Replace** button that also accepts a dropped file.
- **Uploading**: a spinner overlay with `role="status"`.
- Validation runs in the browser before any request (same types and 5 MB limit as the backend). Errors render under the card with `role="alert"`.

### Edit page
Choosing or dropping a file uploads it at once (`POST .../logo`, multipart field `logo`). Removing calls `DELETE .../logo`. Neither waits for **Save Changes**, which is how the image uploader already behaved before the card.

### Create page
The upload endpoint needs an event id, so the create page:
1. keeps the chosen `File` in state and previews it with `URL.createObjectURL` (revoked when the file changes or the page unmounts);
2. on **Create Event**, `POST /organizations/:orgId/events`, then uploads the file to the new event's `/logo`;
3. goes to `/admin/events` on success.

If the image upload fails, the event already exists. Staying on the create page would invite a duplicate on retry, so the page redirects to `/admin/events/:id/edit?orgId=…&imageUpload=failed`, where the edit page opens with the error "The event was created, but its image failed to upload. Add it again under Media."

## API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/organizations/:orgId/events/:eventId/logo` | Organizer | Upload / replace the event image (multipart field `logo`); deletes the previous `Image` |
| DELETE | `/organizations/:orgId/events/:eventId/logo` | Organizer | Remove the event image and its `Image` row |

## Database
`Event.logoUrl` (URL of the original variant) and `Event.imageId` → `Image`. No schema change for the card. See [Database Architecture](database-architecture.md).

## Gotchas
- The storage fields and endpoints are still named **logo** (`logoUrl`, `/logo`, multipart field `logo`) even though the UI now says "Media" / "event image". Do not rename the API without migrating every consumer: the public event page hero (`EventDetailClient.tsx`), event cards and emails read `logoUrl`.
- Only the create page defers the upload; the edit page writes immediately. A new field on the card must respect that split.
- The card has no "Select existing" link. Picking an image from [Content › Files](content-files.md) needs a backend endpoint that sets the event image from a stored file.
- Admin Playwright specs reach the hidden file input with `region('Media').locator('input[type="file"]').setInputFiles(...)`.

## Related Features
- [Event Management](event-management.md)
- [Events List](events-list.md)
- [Content › Files](content-files.md)
- [Organization Branding](organization-branding.md)
