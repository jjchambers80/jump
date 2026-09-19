# Spec 028 — Content › URL redirects

**Status**: Proposed 2026-09-19. Fourth Content feature; depends on 027 Menus (entry button on the Menus page) and 026 (tenant `/pages`, `/blogs` rewrites).
**Reference**: Shopify *Online store › Navigation › URL redirects* (list of *Redirect from* → *Redirect to*, create / edit / delete, CSV import/export). Only the list + form are in scope.
**Plan**: [plan.md](./plan.md).

## 1. Problem

Organizers migrating from WordPress / Eventeny / a previous domain have inbound links (`/vendor-info`, `/2025-tickets`, `/blog/recap`) printed on flyers, in old emails and indexed by search engines. On the custom domain those 404 today. Renamed page handles (026 lets handles change) also break old links.

## 2. Scope

### In

- `/admin/content/menus/redirects` (reached from the **URL redirects** button on Menus): table **Redirect from** | **Redirect to** | Created; search; **Create URL redirect** (dialog: *Redirect from* path, *Redirect to* path or full URL); row edit / delete; bulk delete.
- Runtime: a storefront request that would otherwise 404 on the organization's storefront is looked up in the organization's redirects and answered with **301** to the target. Applies on custom domains (any path) and on the platform host under `/organizations/:orgId/*`.
- Validation: *from* must start with `/`, be ≤ 255 chars, not contain a query string, be unique per organization (case-insensitive, trailing slash ignored); *to* is a relative storefront path (`/pages/faq`, `/blogs/news`) or an absolute `http(s)` URL; from ≠ to; no chains resolved (one hop only, so no loops).
- Reserved paths cannot be redirected from: `/`, `/account*`, `/events/*`, `/checkout/*`, `/orders/*`, `/venues/*`, `/api/*`, `/admin*`, `/auth*` — these are live routes.

### Out (follow-ups)

- CSV import/export, hit counters, regex / wildcard redirects, 302 option, redirects on the platform apex.

## 3. User stories

1. As an organizer I add `/vendor-info` → `/pages/vendors` so the flyer QR code still works on the new domain.
2. As an organizer I rename the FAQ handle and add `/pages/faq-2025` → `/pages/faq`.
3. As an organizer I send `/tickets` → `https://tix.partner.com/our-show` while a partner sells for us.

## 4. Functional requirements

- FR-001 `UrlRedirect` is organization-scoped; `fromPath` normalised (lowercase, leading `/`, trailing `/` stripped except root) and unique per organization.
- FR-002 `GET /organizations/:id/public/redirect?path=` returns `{ to }` or 404; not gated by private store mode (redirects reveal nothing; the target is gated). `Cache-Control: public, max-age=60`.
- FR-003 On a tenant host the Next middleware consults the redirect lookup only when its own routing yields `notFound`; on the platform host the `/organizations/[orgId]/[...rest]/not-found` path does the same in a server component before rendering the 404.
- FR-004 Relative targets are rewritten to the host form (`/pages/x` on the tenant host, `/organizations/:org/pages/x` on the platform host); absolute targets redirect as-is.
- FR-005 Admin routes `requireOrganizer` + `activeOrgFor(req)`; ≤ 5 000 redirects per organization (validation error beyond).
- FR-006 The table shows a *Target missing* hint when a relative target points at a page / blog that no longer exists (best-effort, resolved on read).

## 5. Open questions — resolved 2026-09-19

| Question | Answer |
|---|---|
| Separate feature or a link type? | Separate feature (Shopify parity), entry from the Menus page |
| Status code | 301 only |
| Wildcards | Out of scope |
