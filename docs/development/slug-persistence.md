# Shared resource slug persistence

This contract is the persistence foundation for canonical public URLs for organizations, venues, events, pages, and blog posts.

## Stored fields and uniqueness

| Resource | Stored slug | Provenance flag | Database scope | Intended public namespace |
| --- | --- | --- | --- | --- |
| Organization | `Organization.slug` | `slugCustomized` | global | `/organizations/:slug` |
| Venue | `Venue.slug` | `slugCustomized` | global | `/venues/:slug` |
| Event | `Event.slug` | `slugCustomized` | global | `/events/:slug` |
| Page | `Page.slug` | `slugCustomized` | organization | `/organizations/:organizationSlug/pages/:slug` |
| Blog post | `BlogPost.handle` | `slugCustomized` | blog | `/organizations/:organizationSlug/blogs/:blogHandle/:slug` |

`BlogPost.handle` remains the physical field so the existing blog API and routes stay backward compatible. Downstream APIs may expose it as `slug`, but must keep accepting/returning `handle` until consumers have migrated.

Global uniqueness for venues and events is intentional: their canonical routes do not contain an organization or venue segment. Pages and blog posts retain their existing scoped unique indexes.

## Shared utility contract

`backend/src/utils/slug.js` is the only slug normalization and allocation implementation:

- `slugify(value)` applies NFKD normalization, strips combining marks, lowercases, replaces punctuation or whitespace runs with one dash, trims dashes, and caps the result at 60 characters.
- `resolveSlug({ title, customSlug, currentSlug, slugCustomized })` returns `{ slug, slugCustomized }`.
  - On create, omit `customSlug` to derive from `title`.
  - A non-empty `customSlug` is normalized and marks the row customized.
  - `null`, `""`, or whitespace resets the slug to a title-derived value and clears customization.
  - On rename, an omitted `customSlug` preserves a customized current slug and re-derives a generated current slug.
  - A value with no ASCII letters or digits after normalization is a validation error.
- `uniqueSlug(model, { scope, raw, exceptId, field, fallback })` allocates the normalized value, then `-2`, `-3`, and so on. `field` defaults to `slug`; blog code uses `handle`. `fallback` is optional and exists for legacy callers such as organizations whose non-ASCII-only names historically became `org`. The database unique index remains the final race-condition guard.

`uniqueHandle` is retained as a compatibility wrapper over `uniqueSlug`. Organization, page, application-form, blog, blog-post, and menu allocation now use the shared implementation.

## Migration and backfill

Migration `20261001000000_shared_resource_slugs`:

1. Adds `slugCustomized` with a false default to organizations, pages, and blog posts.
2. Does not rewrite any existing organization/page/blog-post slug or handle.
3. Marks an existing value custom when it differs from the NFKD-normalized title/name. The SQL backfill strips the same combining-mark range as the JavaScript utility so accented Latin titles retain generated provenance.
4. Adds and backfills venue/event slugs from names. Duplicates receive deterministic numeric suffixes; pathological second-order suffix collisions receive a deterministic, length-bounded id hash.
5. Makes venue/event slugs non-null and adds global unique indexes.
6. Adds `slugCustomized = false` for every new venue/event backfill row.

Prisma uses `@default(cuid())` on newly added venue/event slug fields as a short-lived compatibility default for direct Prisma creates and older create services. The API/service follow-up must always write a normalized title-derived or custom slug; the cuid default is not the public product behavior.

## Downstream create/update requirements

For each of the five resources:

1. Resolve provenance with `resolveSlug`.
2. Allocate with `uniqueSlug` using the scope in the table above.
3. Persist the slug and `slugCustomized` together in one write.
4. Translate a database unique-constraint race into the repository's standard 409 conflict response.
5. Continue resolving existing ID-based operations until canonical-route migration is complete.
6. For blog posts, map API `slug` to the persisted `handle` and keep the legacy `handle` contract during the compatibility window.
