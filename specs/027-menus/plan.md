# Implementation Plan: Content › Menus (spec 027)

**Status**: Built 2026-09-19 on `feat/027-menus`.
**Spec**: [spec.md](./spec.md). Depends on 026 Blog posts on `main` (public page / blog routes, `StorefrontContentShell`, `uniqueHandle`, `SaveBar`, `useUnsavedChanges`).
**Branch**: `feat/027-menus`, merged to `main` alone.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Org-scoped admin routes | `routes/adminScope.js` `activeOrgFor` | menus router |
| Handle derivation + clash suffix | `utils/uniqueHandle.js` (026) | menu handles, duplicate `-copy` |
| Save bar + dirty guard | `components/content/SaveBar.tsx`, `lib/useUnsavedChanges.ts` (026) | editor |
| Storefront header | `components/OrganizationHeader.tsx` (`as`, `layout`) | gains an optional `nav` prop rendered under the identity row |
| Storefront shell for content pages | `components/storefront/StorefrontContentShell.tsx` (026) | mounts `StorefrontChrome` (menus fetch, footer) |
| Public storefront pages | `OrganizationStorefront.tsx`, `events/[eventId]`, `venues/[venueId]`, pages, blogs | each mounts `StorefrontChrome`; checkout / confirmation / apply / account do not |
| Storefront gate | `gateByOrgParam` (026) | public menus route |
| Tenant host paths | `lib/storefrontHost.ts` `isPlatformHost`, tenant rewrites for `/account`, `/pages`, `/blogs` | `storefrontPath(orgId, path, host)` helper returns the short path on tenant hosts |
| Public event / venue / page / post lookups | `EventService.listPublishedEvents`, `VenueService`, `PageService.list`, `BlogService.list`, `BlogPostService.list` | link picker search + target resolution |
| Dialog primitives | `SettingsDialog` | Create menu, Delete menu |
| Motion / a11y conventions | `design-motion-principles`, `ui-ux-pro-max` skills | dropdown + drawer |

---

## 2. Design

### 2.1 Schema (migration `…_menus`)

```prisma
enum MenuLinkType {
  HOME
  EVENTS        // all events
  EVENT
  VENUE
  PAGE
  BLOG
  BLOG_POST
  ACCOUNT       // buyer account
  EXTERNAL
}

model Menu {
  id             String   @id @default(cuid())
  organizationId String
  title          String
  handle         String
  isDefault      Boolean  @default(false)   // main-menu / footer-menu: not deletable
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  items        MenuItem[]

  @@unique([organizationId, handle])
}

model MenuItem {
  id        String       @id @default(cuid())
  menuId    String
  parentId  String?
  position  Int
  label     String
  linkType  MenuLinkType
  targetId  String?      // EVENT / VENUE / PAGE / BLOG / BLOG_POST id (no FK: targets may be deleted)
  url       String?      // EXTERNAL
  newTab    Boolean      @default(false)

  menu     Menu       @relation(fields: [menuId], references: [id], onDelete: Cascade)
  parent   MenuItem?  @relation("MenuItemChildren", fields: [parentId], references: [id], onDelete: Cascade)
  children MenuItem[] @relation("MenuItemChildren")

  @@index([menuId, parentId, position])
}
```

`targetId` deliberately has no foreign key: a deleted page must not cascade-delete menu items (the organizer sees *Broken link* and fixes it). Resolution happens at read time.

### 2.2 Service — `MenuService`

```
ensureDefaults(orgId)                       → creates main-menu (Home, Events) + footer-menu (Home) when missing
list(orgId)                                 → menus with top-level labels
get(orgId, id)                              → tree with admin target status
create(orgId, { title })                    → handle from title
replace(orgId, id, { title, items })        → validate depth/count/labels/targets, then in one transaction: deleteMany items, createMany with fresh ids (client ids only used for focus restoration), positions from array order
duplicate(orgId, id)
remove(orgId, id)                           → 400 on isDefault
publicMenus(orgId)                          → { main, footer } resolved, cached 60 s in Redis when available (key menus:<orgId>), invalidated on replace
resolveTargets(orgId, items)                → batched lookups by type; returns href + status
linkPickerSearch(orgId, q)                  → { events, venues, pages, blogs, blogPosts } (≤ 8 each, public-ish: events published upcoming first, pages visible flag included)
```

Href resolution (platform paths; the frontend shortens on tenant hosts):

| type | href | renderable when |
|---|---|---|
| HOME | `/organizations/:org` | always |
| EVENTS | `/organizations/:org#events` | always |
| EVENT | `/events/:id` | event published, belongs to org |
| VENUE | `/venues/:id` | venue belongs to org |
| PAGE | `/organizations/:org/pages/:slug` | page `isVisible` |
| BLOG | `/organizations/:org/blogs/:handle` | blog exists |
| BLOG_POST | `/organizations/:org/blogs/:blog/:post` | post public (026 rule) |
| ACCOUNT | `/organizations/:org/account` | always |
| EXTERNAL | `url` | always |

### 2.3 Routes

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/menus` | ensures defaults, lists |
| `POST` | `/admin/menus` | `{ title }` 201 |
| `GET` | `/admin/menus/link-targets?q=` | picker search (before `/:menuId`) |
| `GET` | `/admin/menus/:menuId` | tree + statuses |
| `PUT` | `/admin/menus/:menuId` | replace |
| `POST` | `/admin/menus/:menuId/duplicate` | 201 |
| `DELETE` | `/admin/menus/:menuId` | 204 / 400 default |
| `GET` | `/organizations/:id/public/menus` | gated, `max-age=60` |

`routes/menus.js`, `validators/menuValidators.js` (`validateCreateMenu`, `validateReplaceMenu` — recursive item checker), registered in `server.js`.

### 2.4 Admin editor

Dependencies (frontend): `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `dnd-kit-sortable-tree`.

`app/admin/content/menus/page.tsx` — table with name sort, item labels cell, **URL redirects** (renders once 028 route exists; feature-flag by a simple constant until then), **Create menu** dialog → navigates to the editor.

`app/admin/content/menus/[menuId]/page.tsx` + `MenuEditor.tsx`:
- Card 1: Name input; `Handle: main-menu` caption; **Duplicate** in the header.
- Card 2: `SortableTree` (`indentationWidth = 32`, `maxDepth = 3` enforced by `canRootHaveChildren` / a `onItemsChanged` guard that rejects drops deeper than 3 and announces why), `TreeItemComponent = MenuItemRow`:
  - collapsed view: handle (`GripVertical`), chevron (when children), label, link summary (`Home page`, `Page › About`, `https://…` with `ExternalLink` icon, `Broken link` red badge), `⋯` menu (Edit, Add child — hidden at depth 3, Move up/down, Indent/Outdent, Delete).
  - editing view (Shopify row): Label input, `LinkPicker` combobox, ✓ confirm, 🗑. New items open in editing view with focus on Label.
  - "Add menu item" button at root; "Add menu item to <label>" row under an expanded parent (depth < 3).
- `LinkPicker`: `role="combobox"` + listbox popover; groups per spec; typing filters via `GET /admin/menus/link-targets?q=` (debounced 200 ms); typing something that parses as a URL offers *External link: <url>*; selecting External shows a URL input + "Open in new tab" checkbox.
- State: local tree (`TreeItems<MenuItemDraft>`), dirty vs. server snapshot; **Save** → `PUT` → replaces state with the response (server ids). `SaveBar` + `useUnsavedChanges`.
- Keyboard: `dnd-kit` `KeyboardSensor` with `sortableKeyboardCoordinates`; `⋯` move actions as the guaranteed path; `aria-live` region announces "Moved Apply under Vendors, position 2".
- Motion: 150 ms transform on layout changes; disabled with `prefers-reduced-motion`.

`useMenusApi()` in `services/api.ts`; types in `lib/menus.ts` (`MenuLinkType`, `MenuItemDraft`, `LINK_TYPE_LABELS`, `linkSummary()`).

`AdminSidebar.tsx`: nested **Menus** under Content (order: Files, Menus, Blog posts).

### 2.5 Storefront

- `components/storefront/StorefrontChrome.tsx` (client): fetches `/organizations/:id/public/menus` (once, `SWR`-less `useEffect` with a module cache keyed by org), renders nothing until loaded; passes `main` to `OrganizationHeader` via `nav` and renders `StorefrontFooter` at the page bottom. Pages that mount it: `OrganizationStorefront`, `events/[eventId]`, `venues/[venueId]`, `pages/[slug]`, `blogs/**`. It is not mounted on checkout, confirmation, apply, account.
- `OrganizationHeader` `nav?: PublicMenuItem[]`: when non-empty, a second row inside the same `<header>`: `<nav aria-label="Main">` — desktop `md:` horizontal list; items with children get a button (`aria-expanded`, `aria-controls`) opening a panel on hover-intent (150 ms) and click/Enter; level-3 items render as grouped sub-lists inside the panel; Escape closes, focus returns. Mobile: `Menu` icon button → slide-in drawer (`role="dialog"`, focus trap, accordion for children). Active item via `usePathname()` match.
- `StorefrontFooter`: `<footer>` with `<nav aria-label="Footer">`; top-level items become headings when they have children, otherwise plain links in a first column; org name + `© year`. Brand tokens for links.
- `lib/storefrontPath.ts`: `storefrontHref(href, orgId)` — on a tenant host (`!isPlatformHost(window.location.host, …)`) rewrites `/organizations/:org` → `/`, `/organizations/:org/pages/x` → `/pages/x`, `/organizations/:org/blogs/...` → `/blogs/...`, `/organizations/:org/account` → `/account`; platform host returns the href unchanged.

---

## 3. Files

### Backend
- schema + migration `…_menus`; `services/MenuService.js`; `routes/menus.js`; `validators/menuValidators.js`; `server.js`; `routes/organizations.js` public menus; `services/StorefrontPreferencesService.js` untouched (gate reused)

### Frontend
- `app/admin/content/menus/{page,[menuId]/page,MenuEditor,MenuItemRow,LinkPicker}.tsx`
- `components/storefront/{StorefrontChrome,StorefrontFooter,StorefrontNav,MobileNavDrawer}.tsx`, `components/OrganizationHeader.tsx` (`nav` prop)
- `lib/menus.ts`, `lib/storefrontPath.ts`, `services/api.ts`, `AdminSidebar.tsx`
- Mount `StorefrontChrome` in: `organizations/[orgId]/OrganizationStorefront.tsx`, `events/[eventId]/page.tsx`, `venues/[venueId]/page.tsx`, `organizations/[orgId]/pages/[slug]`, `blogs/**`

### Docs
- `docs/wiki/features/menus.md`, `organization-logo-box.md` (header now optionally carries nav), `frontend/AGENTS.md` (chrome mounting rule: every new public storefront page except checkout-like flows mounts `StorefrontChrome`), `AGENTS.md` gotcha, `specs/STATUS.md`

---

## 4. Tests

- **Unit** `menuService.test.js`: validation (depth 4 rejected, 201 items rejected, bad URL scheme, foreign targetId), href resolution table, unrenderable items dropped, duplicate handle suffixing, defaults idempotent.
- **Contract** `menus.test.js`: defaults created on first GET; create / replace (tree round-trips with positions) / duplicate / delete (default → 400); link-targets search scoped to org; public menus gated on private store, cache header, hidden page omitted, deleted event omitted; cross-org 404.
- **E2E** `admin-menus.spec.ts`: open Main menu, add "Vendors" with link to a page (picker search), add child via "Add menu item to Vendors", keyboard move via `⋯ › Move up`, Save, reload shows tree; delete item; Broken link badge after page hidden (API-stubbed). `public-nav.spec.ts`: header dropdown open/close with keyboard, mobile drawer at 390 px, footer columns, `aria-current` on active page, custom-domain short hrefs (host header stub as in `public-storefront-private.spec.ts`). Axe on both.
- Vitest `storefrontPath.test.ts`.

---

## 5. Rollout

1. `npm install` from root (dnd-kit packages).
2. Migration additive; defaults appear lazily on the first admin or public read. Because the seeded main menu already holds Home · Events, every storefront gains a one-line nav row under the identity strip on deploy — an expected visual change, called out in the PR and the wiki. Footer renders Home only.
3. Redis cache optional (falls back to no cache).
4. `/doc-feature`; memory update.

---

## 6. Decisions

- Whole-tree `PUT` instead of per-item endpoints: matches the "nothing saves until Save" requirement, keeps positions consistent, and avoids partial trees on the storefront.
- `dnd-kit-sortable-tree` over hand-rolling on `@dnd-kit/sortable`: ships depth projection, collapse, keyboard sensors and ghost handling; small; MIT.
- No FK on `MenuItem.targetId`: broken links are shown, not silently deleted.
- Header nav lives inside `OrganizationHeader` (one header component rule, `organization-logo-box.md`) rather than a second header.
- Chrome is opt-in per page (`StorefrontChrome`) so checkout, confirmation, apply and account stay distraction-free.
- Three levels max (Shopify parity; deeper trees do not fit a dropdown).

## 7. Follow-ups

- Dynamic "Events" children (auto-list upcoming events), Search link type, Policies group when org policies exist (spec 023), per-item icons, menu preview inside the editor, buyer-account menu.
