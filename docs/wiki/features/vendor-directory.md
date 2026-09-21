# Public vendor directory

The public floor-map route (`/events/:slug/map`) includes an event-scoped vendor directory below the map. It is part of spec 014 phase 3 and uses the same uncached public map response as booth geometry.

## Visibility

A vendor appears only when all of these are true:

- the application belongs to the requested event;
- the application form is `PAID`;
- the application status is `APPROVED`;
- `Application.publicProfile` is enabled.

`publicProfile` defaults on. Organizers can change it from the application detail page. Turning it off also removes the vendor name from public booth state. Draft, submitted, waitlisted, rejected, withdrawn, free-form, other-event, and opted-out applications are not returned.

The backend deliberately selects no `Contact`, email, phone, internal note, tags, payment, or answer fields. Public entries contain the business name, description, website, social handles, first applicant-profile photo, application-form category, tier name, and public booth assignment.

## API

`GET /events/:eventId/map` returns a `vendors` array alongside `booths` and `legend`. Entries are sorted by business name and then application id for a stable tie-break. Vendor/application/profile/image updates participate in the map ETag, and the response remains `Cache-Control: no-store`.

The endpoint is protected by the normal storefront gate. An unpublished map is 404 and a private storefront is 403.

## Storefront behavior

The directory provides:

- responsive cards with a first-photo image or business-initial fallback;
- text search across name, description, category, tier, and booth;
- a category filter;
- website and social-profile display;
- a booth button that centers the map, highlights the booth, and opens its detail dialog;
- explicit empty and no-results states.

The map page retains its existing loading, private-store/error, and unpublished/not-found states.

## Key files

- `backend/src/services/MapService.js`
- `frontend/src/app/events/[eventId]/map/VendorDirectory.tsx`
- `frontend/src/app/events/[eventId]/map/PublicMapClient.tsx`
- `packages/db/prisma/migrations/20261004100000_application_public_profile/migration.sql`
- `backend/tests/unit/mapService.test.js`
- `backend/tests/contract/maps.test.js`
- `frontend/e2e/public-map.spec.ts`
