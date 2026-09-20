# Slug Implementation — URL Rules and Backward Compatibility

## URL Structure

```
Organizations  /organizations/:slug         (global, unique)
Venues         /venues/:slug                (global, unique)
Events         /events/:slug                (global, unique)
Blogs          /organizations/:orgSlug/blogs/:blogHandle/:postHandle  (post handle scoped to blog)
Pages          /organizations/:orgSlug/pages/:pageSlug                (slug scoped to org)
```

## Slug Rules

1. **Slug format**: `^[a-z0-9]+(-[a-z0-9]+)*$` — lowercase letters, digits, hyphens, max 60 chars.
2. **Default generation**: Title → NFKD normalize → strip combining marks → lowercase → collapse non-alphanumeric to `-` → trim leading/trailing `-` → truncate to 60.
3. **Custom slugs**: Explicitly typed values are preserved on title changes; generated slugs follow title renames.
4. **Resetting a custom slug**: Passing `slug: null` or `slug: ''` resets to title-derived behavior.
5. **Uniqueness**:
   - Custom slugs that clash return 409 Conflict (rejected immediately).
   - Generated slugs auto-suffix (`-2`, `-3`, ...) via `uniqueSlug`.
6. **Uniqueness scopes**:
   - Organization, venue, event slugs: global (across all records of that model).
   - Page slugs: scoped to `(organizationId, slug)`.
   - BlogPost handle: scoped to `(blogId, handle)`.
7. **BlogPost backward compatibility**: The `handle` column is the persisted slug. Serializers expose both `handle` and `slug` (aliased to handle). Validators accept both `slug` and `handle`, requiring them to match when both are supplied.

## Backward Compatibility

1. **Legacy IDs still work**: `findByPublicIdentifier` queries by ID first, then by slug. Every public route handler uses this, so old URLs with cuids continue to resolve.
2. **Canonical redirect**: The frontend server pages (`page.tsx`) fetch the canonical route (`GET /meta`), detect a slug mismatch with the URL param, and issue a 308 permanent redirect to the slug URL.
3. **Admin routes**: Admin routes continue to use IDs as params (`/:id`, `/edit`, etc.). Slugs are only used in public storefront URLs.
4. **Email URLs**: `storefrontUrl.js` resolves slugs server-side from the DB before generating links.
5. **Storefront gate**: `organizationIdFor` resolves by both ID and slug (`OR: [{ id }, { slug }]`) so the private-store gate works regardless of URL form.
6. **Custom domains**: The frontend middleware (`middleware.ts`) bypasses the frontend `permanentRedirect` for tenant hosts (CNAME'd domains), so legacy ID URLs still work on custom domains without redirecting.
7. **Backfill migration**: The schema migration (`20261001000000_shared_resource_slugs`) backfills existing CUID-slugged records—preserving NFKD accented normalization, existing custom values, second-order collision uniqueness, and the 60-char bound.
8. **Tenant route compatibility**: `catch-all [...rest]` pages on custom domains already handle 404 redirects via `GET /public/redirect`, which uses `findByPublicIdentifier`.

## Services that write slugs (all use `resolveUniqueSlug`)

| Service | Column | Scope |
|---|---|---|
| OrganizationService | `organization.slug` | global |
| VenueService | `venue.slug` | global |
| EventService | `event.slug` | global |
| PageService | `page.slug` | `organizationId` |
| BlogPostService | `blogPost.handle` | `blogId` |

## Frontend slug URL helpers

All in `frontend/src/lib/publicPaths.ts`:
- `organizationPath(slug)`
- `organizationAccountPath(slug)`
- `eventPath(slug)`
- `venuePath(slug)`
- `pagePath(orgSlug, pageSlug)`
- `blogPostPath(orgSlug, blogHandle, postHandle)`

## Known gaps (not regressions)

1. **Frontend SlugField component**: The t_a873fc3f task was expected to add a reusable SlugField component and wire it into all admin forms (events, venues, organizations, pages, blog posts). The backend handles slug auto-generation from title on all create paths, so forms without editable slug fields work correctly but users can't customize slugs from the admin UI yet.
2. **Frontend slug controls**: `SeoListingCard.tsx` has a URL handle field usable by pages and blog posts, but event/venue/organization admin forms don't have equivalent controls. The API accepts `slug` in all create/update payloads (validated by `normalizeCustomSlug`), so adding form controls on the frontend is additive.