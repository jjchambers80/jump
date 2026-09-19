# Spec 027 — Content › Menus (storefront navigation)

**Status**: Proposed 2026-09-19. Third Content feature; depends on 025 Files (nothing directly) and 026 Blog posts (public page / blog routes and link targets).
**Reference**: Shopify admin *Content › Menus* — list (Menu ↕ | Menu items; *URL redirects*, *Create menu*) and the menu editor (Name, Handle, *Duplicate*; nested items with drag handles, collapse chevrons, inline Label + Link row with a grouped link picker — Online store › Home page, Search, Collections, Products, Pages, Blogs, Blog posts, Policies; Customer accounts › Orders, Profile; Apps — ✓ / 🗑, "Add menu item to X"). Screenshots reviewed 2026-09-19; UI only.
**Plan**: [plan.md](./plan.md).

## 1. Problem

The storefront has no navigation. Visitors land on the organization page and can only reach events listed there; pages and blog posts (026) are unreachable except by direct link. Organizers cannot expose About, Vendors, FAQ, Blog, external ticket partners, or a footer with policies.

## 2. Scope

### In

- `/admin/content/menus`: table **Menu** (sortable by name) | **Menu items** (top-level labels, comma-separated, truncated). Buttons: **URL redirects** (→ 028, hidden until it ships) and **Create menu**. Row click opens the editor.
- Two default menus per organization, created on first use: **Main menu** (`main-menu`: Home, Events) and **Footer menu** (`footer-menu`: Home). Defaults can be renamed and edited but not deleted; extra menus can be created, duplicated and deleted.
- `/admin/content/menus/[menuId]` editor: Name (handle shown read-only under it), **Duplicate** button; **Menu items** card with a hierarchical, drag-and-drop tree (three levels max): drag handle, collapse chevron when the item has children, Label, Link (picker), delete; **Add menu item** at the root and **Add menu item to <parent>** inside an expanded parent. Editing is inline (Shopify's Label + Link row with ✓ to confirm). Sticky save bar; nothing persists until **Save**.
- Link picker: search-as-you-type combobox with groups — **Storefront**: Home page, All events, Events › (upcoming published events), Venues ›, Pages ›, Blogs ›, Blog posts ›; **Account**: Buyer account; **Other**: External link (URL) — plus a typed URL becomes an External link. Existing target names are shown in the row; a deleted target shows a *Broken link* badge.
- Storefront rendering: the main menu in `OrganizationHeader` (desktop: horizontal bar under the identity strip with hover/click dropdowns for levels 2–3; mobile: hamburger → drawer with accordion) and a new **storefront footer** (top-level items as column headings, children as links; organization name and year). Both appear on the organization page, event pages, venue pages, public pages, blog listing and post pages. Neither appears on checkout, confirmation, application forms or the buyer account (focused flows).
- Links resolve to real paths: Home → org page, All events → org page events section / `/events?org=` listing, Event → `/events/:id`, Venue → `/venues/:id`, Page → `/organizations/:org/pages/:slug`, Blog → `/blogs/:handle`, Blog post → `/blogs/:blog/:post`, Buyer account → `/organizations/:org/account`, External → the URL (opens in the same tab unless the organizer ticks "Open in new tab"). On custom domains links use the short tenant paths.
- Items whose target no longer exists, or points at a hidden page / non-public post / unpublished event, are skipped when rendering (never a dead link on the storefront).

### Out (follow-ups)

- Mega-menu images, per-item icons, badges ("New").
- Customer-account menu (the buyer account keeps its own tabs).
- Search link type (no storefront search yet), Policies group (spec 023 legal pages are platform-level today; add a link type when org policies exist).
- Menu visibility scheduling, per-domain menus, localization.
- Automatic "Events" dropdown listing upcoming events (an item can link to one event or to All events; dynamic children are a later storefront spec).

## 3. User stories

1. As an organizer I add "Vendors" with children "Apply", "Floor plan (PDF)", "FAQ" to the main menu and see the dropdown on the storefront.
2. As an organizer I drag "Blog" from the footer to the main menu's second slot and Save; the storefront updates on next load.
3. As an organizer I link "Sponsor packet" to an external Google Drive URL that opens in a new tab.
4. As an organizer I delete the FAQ page; the menu editor shows *Broken link* and the storefront simply omits the item until I fix it.
5. As a visitor on a phone I open the hamburger, expand "Vendors", and tap "Apply".

## 4. Functional requirements

- FR-001 `Menu` and `MenuItem` are organization-scoped; `Menu.handle` unique per organization; `main-menu` and `footer-menu` are reserved handles with `isDefault = true`.
- FR-002 `PUT /admin/menus/:id` replaces the whole tree transactionally (`{ title, items: [{ id?, label, link: { type, targetId?, url?, newTab? }, children: [...] }] }`). Server validates: depth ≤ 3, ≤ 200 items, label 1–60 chars, exactly one of `targetId` / `url` per type, target belongs to the organization (404 → 400 `Unknown target`), external URLs `http`/`https`/`mailto`/`tel` only.
- FR-003 Reads return the tree with `position` ordering and, for admin, `target: { title, status: 'ok' | 'missing' | 'hidden' }`; for the storefront, `href` resolved and unrenderable items removed.
- FR-004 `GET /organizations/:id/public/menus` returns `{ main: [...], footer: [...] }` (resolved hrefs, `newTab`), gated by private store mode, `Cache-Control: public, max-age=60`. The storefront chrome fetches it once per page.
- FR-005 The editor is fully keyboard-operable: drag-and-drop has keyboard sensors (space to pick up, arrows to move / indent, space to drop) and every row has *Move up / down / Indent / Outdent* in its `⋯` menu as the non-drag path; `aria-live` announcements on move.
- FR-006 Duplicate creates `<title> copy` with handle `-copy`, `-copy-2`…, full deep copy of items.
- FR-007 Deleting a non-default menu removes its items; default menus return 400 on delete.
- FR-008 Rendering respects `BrandScope`: active / hover colors use brand tokens; dropdowns respect `prefers-reduced-motion`; nav is `<nav aria-label="Main">` / `<nav aria-label="Footer">` with `aria-current="page"` on the matching item.
- FR-009 Header and footer render nothing (no empty bar) when the respective menu has no renderable items, so existing storefronts look unchanged until an organizer edits a menu.
- FR-010 All admin routes `requireOrganizer` + `activeOrgFor(req)`.

## 5. Non-functional

- Tree editor handles 200 items without lag (virtualisation not needed; memoised rows).
- Public menu payload ≤ 20 KB; resolved in one query per target type (batched `findMany` by ids).
- Drag library adds < 40 KB gzipped (`@dnd-kit/core` + `sortable` + `dnd-kit-sortable-tree`).

## 6. Open questions — resolved 2026-09-19

| Question | Answer |
|---|---|
| Nesting depth | 3 levels (Shopify) |
| Default menus | Main menu + Footer menu; no buyer-account menu |
| Where rendered | Header in `OrganizationHeader`, new storefront footer; not on checkout / confirmation / apply / account |
| Link types | Home, All events, Event, Venue, Page, Blog, Blog post, Buyer account, External |
| "Redirects" | Separate URL redirects feature (028), linked from the Menus header |
