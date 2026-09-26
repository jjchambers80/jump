# Content › Menus

**Status:** Implemented (spec 027)
**Last Updated:** 2026-09-19

## Overview

**Content › Menus** (`/admin/content/menus`) is the storefront navigation editor. Every organization has two default menus created lazily — **Main menu** (`main-menu`: Home, Events) rendered as a nav row inside `OrganizationHeader`, and **Footer menu** (`footer-menu`: Home) rendered by `StorefrontFooter` — plus any extra menus the organizer creates (not rendered anywhere yet; available for future placements). The editor is a three-level drag-and-drop tree (`dnd-kit-sortable-tree`) with inline Label + Link rows, a grouped link picker (Home page, All events, Events, Venues, Pages, Blogs, Blog posts, Buyer account, External link), Move up / down and Indent / Outdent buttons as the non-drag path, live announcements, and a sticky save bar — the whole tree is saved in one `PUT`.

Link targets are resolved at read time: a deleted target shows **Broken link** in the editor, a hidden page / unpublished event / non-public post shows **Hidden target**, and the storefront skips both so visitors never hit a dead link.

Nav and footer render on the organization page, event pages, public pages and blog pages. They are deliberately absent from checkout, confirmation, application forms and the buyer account.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` (`Menu`, `MenuItem`, `MenuLinkType`) | `Menu.handle` unique per org, `isDefault` protects the two defaults; `MenuItem` tree via `parentId` + `position`; `targetId` has **no foreign key** on purpose |
| `packages/db/prisma/migrations/20260930400000_menus` | Adds both tables + enum |
| `backend/src/services/MenuService.js` | `ensureDefaults`, `list`, `get` (tree + target status), `create`, `replace` (validate + transactional rebuild), `duplicate`, `remove` (400 on defaults), `publicMenus` (resolved hrefs, unrenderable dropped), `linkTargets` (picker search); exports `buildTree`, `hrefFor`, `DEFAULT_MENUS`, limits |
| `backend/src/api/routes/menus.js` | `/admin/menus*` incl. `GET /link-targets` |
| `backend/src/api/routes/organizations.js` | `GET /:id/public/menus` — `gateByOrgParam`, `Cache-Control: public, max-age=60` |
| `frontend/src/lib/menus.ts` | Types, `LINK_TYPE_LABELS`, `MENU_MAX_DEPTH`, `looksLikeUrl` |
| `frontend/src/lib/storefrontPath.ts` | `storefrontHref(href, orgId)` — shortens `/organizations/:id/…` to tenant paths on custom domains |
| `frontend/src/app/admin/content/menus/{page,useMenusApi,MenuEditor,MenuItemRow,LinkPicker}.tsx`, `[menuId]/page.tsx` | List (name sort, Create menu dialog), editor |
| `frontend/src/components/storefront/{useStorefrontMenus,StorefrontNav,StorefrontFooter}.tsx` | Public menus hook (module cache, 60 s), desktop dropdowns + mobile drawer, footer columns |
| `frontend/src/components/OrganizationHeader.tsx` | New `nav` prop mounts `StorefrontNav` (mobile hamburger on the right below `md`, inline desktop row beside the identity from `md`) |
| `frontend/src/app/organizations/[orgId]/OrganizationStorefront.tsx`, `events/[eventId]/page.tsx`, `components/storefront/StorefrontShell.tsx` | Pass `nav` and render `StorefrontFooter` |
| `backend/tests/{unit,contract}/menus.test.js`, `frontend/e2e/{admin-menus,public-nav}.spec.ts`, `tests/unit/storefrontPath.test.ts` | Tests |

## API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/admin/menus` | ensures defaults; `{ menus: [{ id, title, handle, isDefault, itemLabels }] }` |
| `POST` | `/admin/menus` | `{ title }` → 201 with the tree |
| `GET` | `/admin/menus/link-targets?q=` | `{ events, venues, pages, blogs, blogPosts }` (≤ 8 each, `hint` for date / hidden / blog) |
| `GET` | `/admin/menus/:menuId` | `items[]` with `target: { title, status: ok|missing|hidden, href }` |
| `PUT` | `/admin/menus/:menuId` | `{ title?, items: [{ label, linkType, targetId?, url?, newTab?, children }] }` — depth ≤ 3, ≤ 200 items, label ≤ 60, targets must belong to the org, external URLs `http(s)`/`mailto`/`tel` |
| `POST` | `/admin/menus/:menuId/duplicate` | `<title> copy`, handle `-copy` |
| `DELETE` | `/admin/menus/:menuId` | 204; 400 for defaults |
| `GET` | `/organizations/:id/public/menus` | `{ main, footer }` with `href` (platform form) and `newTab` |

## Href resolution

| Link type | href | Renderable when |
|---|---|---|
| HOME | `/organizations/:org` | always |
| EVENTS | `/organizations/:org#events` | always |
| EVENT | `/events/:id` | event PUBLISHED and in the org |
| VENUE | `/venues/:id` | venue in the org |
| PAGE | `/organizations/:org/pages/:slug` | page visible |
| BLOG | `/organizations/:org/blogs/:handle` | blog exists |
| BLOG_POST | `/organizations/:org/blogs/:blog/:post` | post public |
| ACCOUNT | `/organizations/:org/account` | always |
| EXTERNAL | the URL | always |

The frontend rewrites `/organizations/:org…` to `/`, `/pages/…`, `/blogs/…`, `/account` on tenant hosts (`storefrontHref`).

## Gotchas

- **Every storefront now shows a nav row** (Home · Events) once this deploys, because the default main menu is seeded with items. Organizers edit it under Content › Menus.
- **No FK on `MenuItem.targetId`**: deleting a page must not delete menu items. Never "clean up" menu items from other services — the read-time resolver handles it.
- **Whole-tree PUT**: there are no per-item endpoints. The editor keeps the tree locally and saves once; failed validation leaves the stored tree untouched.
- **Public menus are not cached in Redis** (a page going hidden must disappear immediately); the route relies on `Cache-Control: max-age=60` and the frontend's 60 s module cache.
- The venue page does not yet mount the nav (its public payload lacks the organization identity) — follow-up.
- `StorefrontNav` mounts twice from the header (`variant="mobile"` below `md`, `variant="desktop"` inline in the same row from `md`; see [Storefront Header and Footer](storefront-header-footer.md)); keep them in sync when changing the item rendering.
- Playwright: register the catch-all `/admin/menus**` route before the specific ones; `getByRole('button', { name: 'Add menu item' })` needs `exact: true` because of the per-parent "Add menu item to X" buttons.

## Related Features

- [Online Store Pages](online-store-pages.md), [Blog posts](blog-posts.md) — link targets
- [Custom Domains](custom-domains.md) — tenant short paths
- [Organization Logo Box](organization-logo-box.md) — the header the nav lives in
