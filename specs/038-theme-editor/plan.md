# Spec 038: Online store themes (theme library, sections + blocks editor, header/footer groups, custom homepage)

Status: **Planned** · Written 2026-09-27 · Revised 2026-09-27 (Online Store themes page, draft themes, preview, default theme content, download/import, storefront speed strip) · Revised again 2026-09-27 (theme files carry images, scheduled publish, Theme settings rail, mobile preview toggle) · Hardened 2026-09-27 after review `10_Personal/10_Projects/jump--review--spec-038-theme-editor-plan.md` (contracts in §9a, MVP split in §15) · Hardened again 2026-09-27 after second review `10_Personal/10_Projects/jump--review--spec-038-hardened-plan.md`, checked against main at #223 (render route on `/organizations/:id/…` so the store gate binds, no storefront render cache in the MVP, transaction-scoped field references, SSR test fixture server, full-state revisions, starter sections + restore + live-edit note in the MVP, per-org rollout with a renderer kill switch) · **Spike 038-0 done 2026-09-28: GO** (`spike.md`); contracts agreed in `contracts.md`, which wins where it differs from this plan · Decisions in §3 · Kanban cards proposed in §15 (not created yet) · Related: 007 (custom domains), 020 (rate limits), 023/024 (legal links, consent text), 025 (Files), 026 (Pages, blog, `sanitizeHtml`), 027 (Menus), 028 (URL redirects / `isReservedPath`), 033 (venue time zones), 034 (RSVP), online store preferences (private store, homepage SEO, language), org branding / theme mode

Research: vault note `10_Personal/10_Projects/jump--research--theme-editor-sections-blocks.md` (2026-09-27) and the earlier `jump--research--storefront-page-builder-openpage-vs-puck.md` (2026-09-20). Reference implementation: `/Users/jj/Projects/Roman` (Shopify Dawn 15.2.0). Reference screenshots: the Shopify theme editor (page tree, section settings, page switcher) and the Shopify **Online Store** page (live theme card, theme ⋯ menu, Draft themes list, Import), attached to the requests.

## 1. Problem

Organizers cannot shape their storefront.

- **Fixed home page.** The org home page is hard-coded JSX (`frontend/src/app/organizations/[orgId]/OrganizationStorefront.tsx:108-214`): cover image, a "next event" overlay and events grouped by month.
- **Few settings.** The only settings are one brand color, the theme mode, a logo and a cover.
- **Missing pieces.** There is no homepage separate from the events list, no announcement bar, no way to add, reorder or hide content blocks, and no safe place to try a new design before it goes live.
- **Wrong landing page.** `/admin/online-store` today is a branding form (`OnlineStoreSettings`), not an overview of the store.
- **Repeated header/footer mounts.** The components (`OrganizationHeader`, `StorefrontFooter`, `StorefrontShell`) are shared, but they are mounted separately on about 8 routes, with no shared storefront layout.
- **Client-rendered content.** Storefront routes already have server page shells (metadata, slug redirects), but the page data and content load in the browser. That costs first paint and SEO.

Shopify's model is the one organizers already know:

- **Online Store page:** the live theme with desktop and mobile previews, a list of draft themes to experiment in, and a ⋯ menu per theme (Preview, Rename, Duplicate, Edit default theme content, Download theme file, Delete).
- **Editor:** a page tree (Header group, Template, Footer group) on the left, the live page in the middle where clicking a section selects it, and the selected section's settings on the right.

## 2. Goals and non-goals

**Goals**

- **Online Store page** at `/admin/online-store`, which the sidebar link opens (§10).
  - Header: store access (Public / Password-protected), View store, a ⋯ menu.
  - A storefront speed strip.
  - The active theme card with desktop and mobile previews, **Edit theme**, and a ⋯ menu: View, Rename, Duplicate, Edit default theme content, Download theme file.
  - A **Draft themes** list, each with a ⋯ menu (Preview, Rename, Duplicate, Edit default theme content, Download theme file, Delete), a Publish split button and Edit theme.
  - **Import** of a theme file.
- **Draft themes.** Duplicate a theme, edit it safely, **preview** it on the real storefront (with a shareable link), then **publish** it now or **schedule** it for a date and time. Publishing swaps it with the live theme.
- **Theme settings** open from a gear icon in the editor's left rail (§6.3, §11): logo and favicon, colors, typography, layout and grid, animations, buttons, inputs, cards, containers, media, pop-ups and drawers, badges, brand information and social media.
- **Theme editor** in Shopify's style (§11). Sections and blocks have settings generated from a schema. Organizers can add, reorder, duplicate, hide and remove them, with undo/redo, desktop/mobile preview and Save.
- **Custom homepage** built from sections. Today's org home becomes the **Events page**, and its list layout is configurable, the way Shopify's collection template is.
- **Header and footer groups** shared by every themed page, including a hideable, schedulable **announcement bar**.
- **Default theme content.** Organizers can override storefront wording such as "Get tickets", "Sold out" and "No upcoming events".
- **Download and import** of a theme file (a zip containing the theme JSON and every image it uses).
- One theme preset ships ("Eventimus Default"). The model supports more presets later.
- Themed storefront pages are **server-rendered**.

**Non-goals**

- **Discover themes / Theme Store / marketplace.** Excluded, including the "Add" flow from a catalog.
- **Edit code.** Excluded; see D13 for the research and the reasons.
- **AI.** No generation, no "Ask for changes", no LLM calls anywhere, and no Puck Cloud.
- **Tenant code.** No custom CSS, custom HTML or script sections, and no Liquid or other tenant-authored template language.
- **Theme updates.** No "Version X available" update flow; see D14.
- **Other pages.** No section changes to checkout, confirmation, apply, account or order lookup (gotcha 21). Legal and consent wording is never overridable (spec 023).
- **Email.** Emails keep using `Organization.brandColor` and the logo.

## 3. Decisions

**D1. Editor: Puck** (`@puckeditor/core`, MIT, pinned to an exact version, 0.23.x at the time of writing).
- The open-source core runs entirely in our bundle, with no account, API key or network calls.
- Puck's pricing page sells only **Puck Cloud** (hosted AI: metered, $199/mo or $799/mo). The editor is not licensed or metered, and we do not install Puck Cloud.
- The phase 0 spike (038-0) is a go/no-go gate. The fallback is our own editor on the dnd-kit and `dnd-kit-sortable-tree` packages already used by the Menus editor.
- Puck is imported only through `frontend/src/theme/editor/puck.ts`.

**D2. No template language.** Sections are React components, their settings are described by declarative field specs in `@jump/theme` (one spec drives validation and the Puck fields; contracts C12), and structure is JSON.

**D3. Page model.**

| Storefront page | Document kind | Notes |
|---|---|---|
| Homepage `/` | `PAGE` (key `home`), its own document | Falls back to the Events page until it is first saved on the active theme (D5) |
| Events page | `TEMPLATE` (key `events`) | Today's org home as a template (Shopify collection template) |
| Content › Pages | `PAGE` (key `page:<pageId>`), one document per page | Default document: page title and `Page.content` (locked) |
| Event detail | `TEMPLATE` (key `event`, alternates `event.<suffix>`) | Shared by every event. An event can pick an alternate |
| Blog listing / post | `TEMPLATE` (keys `blog`, `blog_post`) | Shared |
| Header / footer | `HEADER_GROUP` / `FOOTER_GROUP` | Shared by every themed page |

Every theme (live or draft) has its own full set of documents, settings and content.

**D4. Server rendering.**
- Themed pages (home, events, pages, blog, post and, in 038H, the event page) render on the server.
- Interactive parts stay client islands: the ticket panel, cart, nav drawer and store password form.

**D5. Routing.**
- `/` serves the active theme's `home` document. Until the organizer first saves a homepage, `/` renders the Events page, so existing orgs see no change on launch.
- The Events page gets its own path (§8).

**D6. Save model: theme-level drafts, the Shopify way.** This replaces the earlier per-document draft and publish.
- One theme per org is **Active** (`role MAIN`). The rest are **Draft themes** (`role UNPUBLISHED`, up to 20 per org).
- **Saving in the editor writes the theme directly.** On the active theme, that is live at once. On a draft theme, nothing is public.
- The safe way to experiment: **Duplicate** the active theme, edit the copy, **Preview** it, then **Publish**. Publishing swaps roles in one transaction, and the previously active theme becomes a draft, so going back is one click.
- When the organizer first saves on the active theme in a session, the editor shows a non-blocking note: "You're editing your live store. Duplicate it first to experiment."
- **Saves are atomic.** One Save commits the settings, content and every changed document in a single transaction, or none of them (§9a.2).
- Every save on the active theme writes **one** `ThemeRevision` holding the **full theme state after that save** (settings, content and every stored document), plus the list of keys the save changed for the revision label. The last 50 per theme are kept, and older ones are pruned in the same transaction.
- **Restore puts the whole theme back** to the state of that revision: settings, content and documents, including documents that did not exist then (they are deleted, so they fall back to the preset default). It is not an undo of one change. Restoring is itself a save, so it writes a new revision and can be undone by restoring the one before it.

**D7. Colors come from color schemes, never raw color pickers.**
- A theme has 1-8 schemes. Settings store a scheme id.
- The default preset derives scheme 1 from `brandColor` and `themeMode` (accent value `"brand"`), so current orgs look identical.

**D8. Live data is referenced by id and resolved when read.**
- This covers events, menus, pages, blog posts and files.
- A deleted target drops out silently, like `MenuItem.targetId` in gotcha 21.

**D9. Hidden, not deleted.**
- Every section and block has `hidden: boolean`, like Shopify's `disabled`.
- Hidden items keep their settings, are dimmed in the editor with an eye-off icon, and never render.

**D10. Locked sections.**
- These cannot be deleted, dragged or duplicated: `EventList` on the Events page, `EventMain` on the event template, `BlogPostBody`/`BlogPostList`, `PageContent`, `Header` and `Footer`.
- They can be restyled, and optional parts inside them can be hidden.
- Capacity, pricing and checkout logic never move into the editor.

**D11. Preview of draft themes** (Shopify "Preview" plus "Share preview").
- Staff open a draft theme on the real storefront through a signed, expiring preview token.
- A preview bar shows "Previewing *Theme name* · Share preview · Exit preview".
- A shareable link lasts 14 days and needs no sign-in, which is useful for sending to a client or co-organizer.
- Preview pages are `noindex`, bypass the cache and never change what other visitors see (§9).
- **Password-protected stores.** A staff preview link (1 h) and a thumbnail render past the store password for their own org, because only signed-in staff of that org can mint them. A **share link does not**: its visitor sees the store password gate first and needs the password too, so a share link never becomes a way around a private store (§9a.5).

**D12. Duplicate, download and import keep images.**
- **Duplicate** (same org) copies every setting, content override and document. Image settings point at the same `StoreFile` rows, so images come along with nothing re-uploaded. `syncReferences` records the copy as a new "Used in" entry.
- **Download** produces `eventimus-theme-<name>-<yyyy-mm-dd>.zip`, containing:
  - `theme.json`: format version, preset key and version, name, settings, default content and every document.
  - `images/<sha256>.<ext>`: every image the theme uses (logo override, favicon, section and block images). `theme.json` refers to images by that file name, never by a `StoreFile` id.
- **Import** reads the zip into a **new draft theme**. It is validated with the same checks as a save and never applied to the active theme directly.
  - Each image goes through the normal upload pipeline: MIME sniffing, SVG refused, size limits, the content-addressed `File` table. Identical images are therefore stored once. Each image becomes a `StoreFile` of the importing org, and its references are rewritten to the new ids.
  - Data references that don't belong to the importing org (events, pages, blog posts, menus) are dropped and listed as import warnings. A design moves between orgs with its images, never with another org's data.
- **Caps:** 50 MB per zip, 200 images, and 16 MB for `theme.json`. Inside it, each document is held to the same 256 KB limit as a save (§6.2), and settings and content to their save limits. Export refuses a theme over the same 16 MB ceiling with a clear error, so every theme that exports also imports. Zip entries are checked against path traversal and zip bombs (uncompressed total ≤ 200 MB, compression ratio check).

**D13. "Edit code" is excluded.**
- **What it is on Shopify.** It opens the theme's Liquid, CSS, JS and schema files in a code editor. It exists because a Shopify theme *is* code that the merchant owns a copy of.
- **Why Jump has no equivalent.**
  - Our section code is shared platform code. A tenant-editable copy would mean tenant-authored code running on shared and custom domains: XSS, bypassing `sanitizeHtml`, BrandScope and the checkout/capacity guards, and pages that can't be migrated when sections change (§13).
  - The one safe variant, a raw JSON editor for the theme documents, adds nothing over Download, edit, Import, which already goes through full validation. It is also error-prone for non-technical organizers.
- **Decision.** No "Edit code" item in the menu. Support staff (`SYSTEM_ADMIN`) can inspect a theme through Download.
- **Revisit** only if Jump opens a partner theme program.

**D14. Theme version, no update flow.**
- Cards show "Eventimus Default · v1.0" (preset key and version).
- Shopify's "Version 16.0.0 available" exists because each merchant owns a frozen copy of the theme code. Our section code is shared and always current, so organizers get fixes and new sections automatically.
- Stored documents are upgraded on read by `migrateDocument` (`schemaVersion`). Nothing needs an "update" button.

**D15. Default theme content** (Shopify's "Edit default theme content").
- A catalog of storefront strings in `@jump/theme` (§6.5) can be overridden for each theme.
- Wording that carries legal or payment meaning (consent text, refund policy text, fee and tax labels, checkout step text) is **not** in the catalog and cannot be overridden.

**D16. Online Store page replaces the branding form.**
- `/admin/online-store` becomes the themes overview.
- The current branding form (`OnlineStoreSettings`: logo, cover, brand color, theme mode) moves to a **Brand** card on Online store › Preferences.
- Logo and brand color stay organization identity, used by email and as the scheme-1 seed.

**D17. Storefront speed strip** (Shopify's LCP, INP, CLS and sessions row).
- The storefront reports Core Web Vitals from real visitors to a first-party endpoint. Raw samples are kept 90 days. The Online Store page shows a 7-, 30- (default) or 90-day P75 value with Good / Needs improvement / Poor and the change against the previous 30 days.
- No third parties, cookies or personal data: a random id per tab in `sessionStorage` counts sessions.
- It is its own card (038M) and can ship last or be dropped without affecting the rest.

**D18. Scheduled publish.**
- The Publish ▾ menu on a draft offers **Schedule publish…**: a date and time picker shown in the organizer's account time zone (gotcha 28, "when it happens to me"), with the zone abbreviation shown.
- One scheduled theme per org. Scheduling another replaces the first after a confirm dialog.
- The draft row and the editor show "Scheduled to publish Oct 3 at 9:00 AM EDT · Cancel". The active card shows "Will be replaced by *X* on …".
- A backend sweep (`THEME_PUBLISH_SWEEP_INTERVAL_MS`, default 60 s) publishes due themes with the same swap transaction as Publish.
- Storefront renders are uncached until card 038P (§9a.3), so the published theme shows on the next request. Once 038P ships, publishing also calls the internal revalidation contract (§9a.4).
- Deleting or publishing the theme by hand clears the schedule. A theme that fails validation at publish time (for example after a preset migration) is not published: the schedule is marked failed and the organizer sees an error on the Online Store page. This mirrors `TaxRegion.lastError`.

**D19. Theme settings live in the editor's left rail (the gear icon).**
- Like Shopify, the left rail has two panels: **Sections** (the outline tree) and **Theme settings** (gear). App embeds are not offered.
- Puck 0.21+ has a plugin rail for custom left panels. Theme settings is a Jump plugin in that rail. It renders our accordion form, reusing Puck's `AutoField` for field widgets where it fits.
- The values are `Theme.settings`, not page data. The iframe preview picks them up live through `BrandScope` CSS variables, so changing a font or radius restyles every section at once without touching the documents.
- Undo/redo covers theme settings too: while editing they live in `root.props.themeSettings` and ride Puck's own history; Save moves them to `Theme.settings` (spike, contracts C12).
- Puck's rail items are not keyboard-operable in 0.23, so Jump renders its own rail buttons that switch panels through `setUi` (spike, contracts C12).

**D20. Mobile preview.**
- Puck's viewports provide it. A phone icon in the top bar switches the iframe to a centered 390 px frame, and a desktop icon switches back.
- Selecting and editing work the same in both views, including selecting a single block such as a heading.
- An **inspector** toggle (the cursor icon) turns hover outlines and click-to-select on and off, so organizers can click links and menus in the preview. Puck supports this through its interactive preview mode (0.20).

## 4. How the Shopify model maps to Jump

| Shopify | Jump |
|---|---|
| Theme code + `settings_schema.json` | `ThemePreset` in `@jump/theme` (code): section registry, default settings, default content, default documents |
| A merchant's theme (live or draft) | `Theme` row (`role MAIN` or `UNPUBLISHED`) |
| `settings_data.json` | `Theme.settings` |
| `locales/*.json` ("Edit default theme content") | `Theme.content` (overrides of the string catalog) |
| `templates/*.json`, `page.faq.json` | `ThemeDocument` kinds `TEMPLATE` / `PAGE` |
| `header-group.json` / `footer-group.json` | `ThemeDocument` kinds `HEADER_GROUP` / `FOOTER_GROUP` |
| Section `{% schema %}` | Section definition: zod settings, Puck `fields`, allowed blocks, `limit`, `maxBlocks`, `groups`, preset |
| Block | Nested item in the section's `blocks` slot |
| `disabled: true` | `hidden: true` |
| `enabled_on: {groups: [...]}` | `groups` on the definition, enforced by Puck slot `allow` and by the server |
| Color schemes | `Theme.settings.colorSchemes` → `.scheme-<id>` CSS variable classes via `BrandScope` |
| `?preview_theme_id=` + Share preview | Signed preview token and preview bar (D11) |
| Download theme file (zip) / Import (zip, GitHub) | Download zip (JSON + images) / Import zip (D12). No GitHub |
| Publish ▾ Schedule | Scheduled publish (D18) |
| Editor gear icon → Theme settings | Theme settings plugin in the left rail (D19) |
| Phone icon (mobile preview) | Puck viewports (D20) |
| Edit code | Not offered (D13) |
| Theme version + update available | Preset version label only (D14) |
| Theme Store / Discover themes | Not offered |

## 5. Data model (`packages/db/prisma/schema.prisma`)

```prisma
enum ThemeRole { MAIN UNPUBLISHED }
enum ThemeDocumentKind { HEADER_GROUP FOOTER_GROUP TEMPLATE PAGE }

model Theme {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String       // ≤ 50 chars
  presetKey      String       // "eventimus-default"
  presetVersion  String       // "1.0" (D14)
  role           ThemeRole    @default(UNPUBLISHED)
  settings       Json         // global settings (§6.3)
  content        Json         @default("{}") // default-content overrides (§6.5)
  version        Int          @default(1)    // optimistic lock; bumped once per committed save that touched settings, content or the name (§9a.2)
  publishedAt    DateTime?    // last time it became MAIN
  lastSavedAt    DateTime     @default(now()) // any save to settings, content or a document ("Last saved")
  lastSavedById  String?      // plain id, no FK: user deletion leaves it as-is and the UI shows "a former member"
  importedFrom   String?      // original file name when imported
  scheduledPublishAt   DateTime? // D18; at most one per org (partial unique index below)
  scheduledById        String?
  scheduleError        String?   // set when a scheduled publish failed validation
  documents      ThemeDocument[]
  revisions      ThemeRevision[]
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  @@index([organizationId, role])
}
// One MAIN per org: partial unique index in the migration SQL:
// CREATE UNIQUE INDEX "Theme_one_main_per_org" ON "Theme"("organizationId") WHERE "role" = 'MAIN';
// CREATE UNIQUE INDEX "Theme_one_scheduled_per_org" ON "Theme"("organizationId") WHERE "scheduledPublishAt" IS NOT NULL;

model ThemeDocument {
  id            String            @id @default(cuid())
  themeId       String
  theme         Theme             @relation(fields: [themeId], references: [id], onDelete: Cascade)
  kind          ThemeDocumentKind
  key           String            // "header", "footer", "home", "events", "event", "event.festival", "blog", "blog_post", "page:<pageId>"
  data          Json
  version       Int               @default(1)   // optimistic lock; bumped only when this document changes in a committed save
  schemaVersion Int               @default(1)
  updatedById   String?           // plain id, no FK (same rule as lastSavedById)
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  @@unique([themeId, key])
}

model ThemeRevision {               // one row per committed save on the MAIN theme (D6); last 50 kept
  id          String   @id @default(cuid())
  themeId     String
  theme       Theme    @relation(fields: [themeId], references: [id], onDelete: Cascade)
  snapshot    Json     // FULL theme state after this save: { settings, content, documents: { key: data } }; a key missing from documents means "no stored row, preset default"
  changedKeys String[] // what this save wrote ("settings", "content", document keys), for the revision list label only
  savedById   String?  // plain id, no FK
  createdAt   DateTime @default(now())
  @@index([themeId, createdAt])
}

model StorefrontVital {             // 038M only; 90-day retention (7/30/90-day views)
  id             String   @id @default(cuid())
  organizationId String
  metric         String   // LCP | INP | CLS | SESSION
  value          Float
  pageKind       String   // home | events | event | page | blog | post
  device         String   // mobile | desktop
  createdAt      DateTime @default(now())
  @@index([organizationId, metric, createdAt])
}
```

Plus:
- `Event.themeTemplate String?` (null means `event`) for alternates in 038H.
- `Organization.themesEnabled Boolean @default(false)`: the per-org rollout switch (§15 Launch flags). Only `SYSTEM_ADMIN` can change it.

Revision size: a full snapshot is at most the per-document caps summed, and a realistic theme is well under 1 MB, so 50 of them per org is acceptable. The spike measures a realistic snapshot; if it is large, revisions store documents by content hash in a side table instead, with the same restore semantics.

- **Lazy creation.**
  - Storefront reads with no `Theme` row render the preset from code, with no database write.
  - The first visit to the Online Store page (or the editor) creates the MAIN theme from the preset. This is idempotent: one MAIN per org, enforced by the partial unique index plus a `SELECT … FOR UPDATE` on the organization in `ThemeService.ensureMain`.
  - Documents missing from a theme (for example a page created later) are served from the preset default until first saved.
- **Cascades.** Deleting a `Page` deletes `page:<id>` documents in every theme of the org (`PageService.delete`). Event alternates that no longer exist fall back to `event`.
- **Files.** Image settings store `{ fileId }` objects nested anywhere in settings and documents. `StoreFileService.syncReferences` only reads top-level ids or HTML today, and `ContentRefKind` has only `PAGE` and `BLOG_POST`. This spec adds:
  - `THEME` to `ContentRefKind`, with `targetId` = theme id and `field` = `settings`, `content` or a document key.
  - `fileIdsInThemeJson(value)` in `@jump/theme`: a recursive walk that collects every `fileId`, plus the ids inside rich-text HTML settings through the existing `fileIdsInHtml`.
  - `syncReferences` is extended in two ways, and today's `PAGE` / `BLOG_POST` callers keep their behaviour:
    1. **Arrays of ids per field.**
    2. **An options argument `{ tx, onlyFields }`.** With `tx`, every query runs on the caller's transaction client, so the references commit or roll back with the save. Today the helper opens its own `prisma.$transaction` on the global client, which would commit even if the outer save failed. With `onlyFields`, it deletes only rows whose `field` is in that list (`deleteMany({ where: { kind, targetId, field: { in: onlyFields } } })`) before recreating them. Today it deletes every row of the target, so saving only `home` would wipe the header and footer references.
  - A save calls `syncReferences('THEME', themeId, { home: [...ids] }, organizationId, { tx, onlyFields: ['home'] })` with exactly the fields it wrote. Duplicate and import, which write every field, pass all of them. Content › Files shows "Used in: Theme *name*". Deleting a theme deletes its `THEME` rows in the same transaction.
- **Limits.** 20 themes per org (409 `THEME_LIMIT`). Only UNPUBLISHED themes can be deleted.

## 6. `@jump/theme` package (new workspace `packages/theme`)

It is shared by the backend (validation, export/import) and the frontend (editor, render), like `@jump/db`. It is plain ESM JS with JSDoc types, so both Jest and Vitest import it.

### 6.1 Document format

This is Puck's native `Data` shape:

```json
{
  "root": { "props": { "title": "Home" } },
  "content": [
    { "type": "Hero", "props": { "id": "Hero-a1b2", "hidden": false, "colorScheme": "scheme-1",
        "heading": "Summer Series 2027", "image": { "fileId": "sf_123" },
        "blocks": [ { "type": "Button", "props": { "id": "Button-c3", "label": "Get tickets", "link": { "type": "EVENTS" } } } ] } },
    { "type": "UpcomingEvents", "props": { "id": "UpcomingEvents-d4", "layout": "grid", "limit": 6 } }
  ]
}
```

- **Blocks** live in a slot prop (`blocks`), and slot `allow` lists are generated from the definitions.
- **Links** use the menu-item union (HOME, EVENTS, EVENT, PAGE, BLOG, BLOG_POST, VENUE, ACCOUNT, EXTERNAL `https://` only) and resolve through `MenuService.hrefFor`. Shortening for custom domains goes through `lib/storefrontPath.ts`.

### 6.2 Section registry

Each definition has these fields:

- `type`, `label`, `icon` and `category`.
- `settings`: a zod object.
- `fields`: Puck field configs derived from `settings`. Field kinds:
  - text and textarea (with length caps)
  - `richtext` (Tiptap, sanitized on write)
  - select / radio
  - range (min, max, step, unit)
  - toggle
  - color scheme picker
  - image (StoreFile picker, alt text required unless marked decorative)
  - link picker
  - event, menu and blog pickers
- `blocks` (allowed types, `maxBlocks`, per-type `limit`), `limit`, `groups`, `locked` and `preset`.
- `validateDocument(kind, data, ctx)`: the backend check on every save and import. It covers type allowlists, limits, groups, slot contents, id uniqueness, string caps, link and URL rules, depth ≤ 2, ≤ 40 sections and ≤ 256 KB.

### 6.3 Theme settings (the gear panel, D19)

These are the accordion groups in the Theme settings panel, in Shopify's order. Every value is an enum, a range or a reference, so nothing free-form reaches CSS. Each group maps to CSS variables that `BrandScope` emits, and sections read only those variables.

| Group | Settings | Shopify equivalent / note |
|---|---|---|
| **Logo** | logo (default "Use organization logo", or a StoreFile override for this theme), desktop logo width 50-300 px, mobile logo width 30-150 px, **favicon** (StoreFile, scaled to 32×32 and 180×180) | Logo. The organization logo stays the one used in email |
| **Colors** | schemes 1-8: {name, background, foreground, accent (`"brand"` or hex), accent foreground, secondary button label, border, muted, shadow}. "Add scheme"; delete only when unused | Colors › Schemes |
| **Typography** | heading font + scale 90-150 %, body font + scale 90-130 %, heading case (as typed, uppercase), letter spacing (tight, normal, wide). Help text: "Selecting a different font can affect the speed of your store" | Typography |
| **Layout** | page width 1000-1600 px, space between template sections 0-100 px, grid horizontal space 4-40 px, grid vertical space 4-40 px | Layout + Grid |
| **Animations** | reveal sections on scroll (off, fade, slide up), hover effect (none, lift, zoom). Always off under `prefers-reduced-motion` | Animations |
| **Buttons** | shape (square, rounded, pill), radius 0-40, border thickness 0-4, shadow (none, subtle, strong), label case | Buttons |
| **Inputs** | radius, border thickness, shadow (search, newsletter, store password form) | Inputs |
| **Event cards** | style (standard, card), image ratio (none, 16:9, 4:3, 1:1), radius, border, shadow, text alignment, date badge style (tile, text) | Product cards. Card defaults used by `EventList`, `UpcomingEvents` and `FeaturedEvent` |
| **Blog cards** | same fields as event cards, plus show excerpt | Blog cards |
| **Content containers** | radius, border, shadow (FAQ, testimonials, rich text boxes) | Content containers |
| **Media** | radius, border, shadow (images, video, gallery) | Media |
| **Dropdowns and pop-ups** | radius, border, shadow (nav dropdowns, dialogs) | Dropdowns and pop-ups |
| **Drawers** | border, shadow (mobile nav drawer) | Drawers |
| **Badges** | position on event cards (top left, top right, bottom left), shape (rounded, pill), scheme for "Sold out" and "Few left" | Badges |
| **Brand information** | headline, short description (≤ 300), logo on footer (toggle). Used by the Footer `BrandInfo` block | Brand information |
| **Social media** | Instagram, TikTok, Facebook, X, YouTube, LinkedIn, Threads, website (each an `https://` URL on that platform's host). Used by the Footer `SocialLinks` block | Social media. The org has no social links today |

**Left out on purpose:** variant pills, collection cards, search behaviour, cart and currency format. These are commerce settings with no equivalent in ticketing, or they belong to checkout, which stays outside the theme.

**Validation.**
- Contrast is checked with the AA helpers from `frontend/src/lib/color.ts`, mirrored in the package. The editor warns but does not block the save.
- A scheme that is still in use cannot be deleted. The panel lists the sections that use it.

### 6.4 Presets

- `presets/eventimus-default/` holds `preset.json` (key, name, version `1.0`, description), `settings.json`, `content.json` (catalog defaults) and `documents/{header,footer,home,events,event,blog,blog_post,page}.json`.
- The `events` document must reproduce today's `OrganizationStorefront`: `EventsHero` (cover plus the next-event overlay) and the locked `EventList` (grouped by month, venue time zones).

### 6.5 Default content catalog (D15)

- `content/catalog.js` is a flat map of `key → { default, maxLength, group, description }`.
- Groups:
  - **Header & navigation:** "Menu", "Account", "Sign in"
  - **Events list:** "Upcoming events", "No upcoming events", "Date TBA", "View all events"
  - **Event page:** "Get tickets", "RSVP", "Sold out", "Sales ended", "Tickets on sale {date}", "Doors open"
  - **Announcement bar:** "Pause announcements", "Close"
  - **Blog:** "Read more", "Posted {date}"
  - **Store password page:** "This store is private", "Enter password"
  - **General:** "Back", "Search", "Share"
- Variables such as `{date}` are validated and must survive an override.
- `Theme.content` stores overrides only. The storefront uses `t(key, vars)` from a server context.
- `Organization.autoRedirectLanguage` is stored but not used for routing yet (online store preferences), so v1 has a single language. Later, the catalog shape allows `content[locale][key]`.

## 7. Section library

v1 is split across cards 038B/C/S/E/G/H. Card S (MVP) ships the four starter homepage sections so the first homepage editor has something useful to place. Every section has `hidden`, a `colorScheme`, and top/bottom padding (0-80 px).

| Section | Placed in | Settings (beyond common) | Blocks | Card |
|---|---|---|---|---|
| **AnnouncementBar** | header, limit 1 | rotate (off, 5 s, 8 s) with a pause button (WCAG 2.2.2), dismissible | `Announcement` {text ≤140, link, startsAt?, endsAt?} max 5 | B |
| **Header** | header, limit 1, locked | logo position (left, center), menu (default `main-menu`), sticky (off, always, on scroll up), separator, show account link | — | B |
| **Footer** | footer, limit 1, locked | show legal links (spec 023 flag), "Powered by Eventimus", copyright text | `MenuColumn`, `Text`, `BrandInfo` and `SocialLinks` (both read Theme settings), `Newsletter` (hidden until opt-in exists) | B |
| **EventsHero** | template | cover image (defaults to org cover), next event overlay, height | — | C |
| **EventList** (locked on the Events page) | template | layout (grid, list, grouped by month), columns desktop 2-4 / mobile 1-2, card image ratio, show price, venue and date badge, filters (category, venue), sort, page size 12-48, empty-state text | — | C |
| **Hero** | template | heading, subheading, image or video, layout (full-bleed, split left, split right), overlay, alignment, height | `Button` max 2 | S |
| **UpcomingEvents** | template | heading, count 3-12, layout (grid, list, carousel), category filter, "View all" link | — | S |
| **FeaturedEvent** | template | event picker, show description, ticket CTA | — | E |
| **RichText** | template | heading, body, alignment, width | `Button` max 2 | S |
| **ImageWithText** | template | image, side, heading, body | `Button` max 2 | E |
| **ImageBanner** | template | image, heading, height, overlay | `Button` max 2 | E |
| **Gallery** | template | columns, aspect ratio | `GalleryImage` max 24 | E |
| **FAQ** | template | heading | `FAQItem` {question, answer richtext} max 30 | E |
| **LogoStrip** | template | heading, grayscale | `Logo` {image, link?} max 24 | E |
| **Testimonials** | template | heading, layout | `Testimonial` max 12 | E |
| **CallToAction** | template | heading, text | `Button` max 2 | S |
| **BlogPosts** | template | blog, count, excerpt | — | E |
| **Countdown** | template | event or date, label; static text under reduced motion | — | E |
| **Video** | template | StoreFile video or YouTube/Vimeo id (allowlist, `youtube-nocookie`), poster | — | E |
| **Spacer / Divider** | template | height, line | — | E |
| **PageContent** (locked) | page | width | — | G |
| **BlogPostBody** / **BlogPostList** (locked) | blog templates | author, date, share | — | G |
| **EventMain** (locked) | event template | image position, venue map link, time zone note | — | H |
| **EventDescription**, **VenueInfo**, **RelatedEvents** | event template | — | — | H |

## 8. Routing and rendering

**Routes**

| Page | Platform host | Tenant host | Change |
|---|---|---|---|
| Home | `/organizations/:slug` | `/` | Active theme's `home` if it has ever been saved, else the Events page |
| Events | `/organizations/:slug/events` (new) | `/events` (new rewrite) | In `routeForTenantHost`, exact `/events` rewrites to `/organizations/:id/events`; `/events/:id` keeps passing to event detail |
| Pages / blog | unchanged | unchanged | Server-rendered |
| Theme preview | `/api/storefront/preview?token=` (new) | same | Sets the preview cookie and redirects to the org's home **on that host**: `/organizations/:slug` on the platform host (where `/` is Jump's own home page), `/` on a tenant host (D11) |

- `isReservedPath` already reserves `/events` and `/organizations`. Assert both in tests (gotcha 22).
- `MenuService.hrefFor` `EVENTS` changes from `/organizations/:slug#events` to `/organizations/:slug/events`. No stored menus change.

**Rendering pipeline (server)**

1. The route's server component calls `GET /organizations/:id/public/storefront/render?page=<key>` (§9) with `cache: 'no-store'` (§9a.3). If the response says `renderer: 'legacy'` (the org is not in the rollout, §15 Launch flags), the route renders today's client component instead.
2. The backend loads the active theme and returns:
   - settings and content (catalog merged with the overrides)
   - the header, template and footer documents, with hidden items removed and announcements filtered to their active window
   - a `resolved` map of referenced data: events with the venue zone (gotcha 28), menus, file URLs, posts and the org identity
3. `<ThemeFrame>` (server) emits `ThemeScope` (§9a.6) plus the scheme classes and fonts, then renders with Puck's server `Render` and our config. Section components are presentational: they read resolved data and `t()` from props or context, never fetch, and render the same way in the editor iframe.
4. Client islands: nav drawer, `EventList` filters (URL params), announcement rotation, ticket panel (038H).
5. **Private store mode** is enforced by the render endpoint. The server component reads the store-access cookie (§9a.1), forwards it as `X-Storefront-Access`, and the gate renders on the server.
6. **Caching.** None in the MVP: every storefront render is a fresh backend call, so store access, visibility and theme changes are correct on the next request (§9a.3). A shared render cache is a separate, later card (038P) with its own preconditions.
7. **Preview (D11).** When the `jump_theme_preview` cookie holds a valid interactive preview token for this org (§9a.5), the server component passes it through. The endpoint renders that theme instead of the active one, and the response is `no-store`, `noindex` and marked `preview: {themeId, name, expiresAt}`, so `ThemeFrame` shows the preview bar. An invalid or expired token falls back to the live theme, and the cookie is cleared through a route handler (§9a.1, Clearing), because a Server Component cannot delete cookies.

**Pages outside the theme** (checkout, confirmation, apply, account, map) stay **organization-branded only**. They keep `brandColor` + `themeMode` through `BrandScope`, as today, and do not read the active theme. This matches the structural non-goal and needs no new data path. If they should pick up theme fonts or schemes later, that is its own spec, with an API that carries them.

## 9. Backend API

**Admin routes**

Admin routes are org-scoped through `activeOrgFor(req)` and use `requireAuth` → `requireRole('ORGANIZER'|'ADMIN')`. Routes go in `backend/src/api/routes/themes.js`, validators in `validators/themeValidators.js`, logic in `services/ThemeService.js` plus `ThemeTransferService.js` (export/import) and `ThemePreviewService.js`. Register the file in `server.js`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/themes` | `ensureMain`, then list: id, name, role, presetKey/Version, lastSavedAt, lastSavedBy name, publishedAt |
| GET | `/admin/themes/:id` | Settings, content, version, document index {key, kind, updatedAt} |
| PATCH | `/admin/themes/:id` | `{name, themeVersion}`: rename (1-50 chars) |
| POST | `/admin/themes/:id/duplicate` | Deep copy to UNPUBLISHED named "Copy of <name>" (truncated to 50); 409 `THEME_LIMIT` |
| POST | `/admin/themes/:id/publish` | UNPUBLISHED only. One transaction: current MAIN → UNPUBLISHED, this → MAIN, `publishedAt = now`, clears any schedule (revalidation only once 038P adds a cache) |
| PUT / DELETE | `/admin/themes/:id/schedule` | `{publishAt}` (must be in the future, ≤ 1 year; `{replace: true}` needed if another theme is scheduled) / cancel (D18) |
| DELETE | `/admin/themes/:id` | UNPUBLISHED only (409 `THEME_ACTIVE`); clears file references |
| PUT | `/admin/themes/:id/save` | **The only write for editor content** (§9a.2): `{themeVersion, settings?, content?, documents?: {key: {data, version}}}`; one transaction, all or nothing |
| GET | `/admin/themes/:id/content` | Catalog + current overrides (saving goes through `/save`) |
| GET | `/admin/themes/:id/documents/:key` | `{data (stored ?? preset), version, isDefault}` |
| GET | `/admin/themes/:id/revisions` / POST `.../revisions/:rid/restore` | MAIN theme history (one row per save, labelled from `changedKeys`). Restore takes `{themeVersion}` and runs as one `/save` of the full snapshot: settings, content, every snapshot document, and a delete for every stored document missing from the snapshot. It is itself one revision (D6) |
| GET | `/admin/themes/:id/preview-data?page=` | `resolved` map for the editor iframe (hidden items included) |
| POST | `/admin/themes/:id/preview-link` | `{share: boolean}` → `{url, expiresAt}`. Interactive preview: staff 1 h, share 14 days (§9a.5) |
| GET | `/admin/themes/thumbnails` | Signed, cookie-free thumbnail URLs for the listed themes, 10 min each (§9a.5) |
| GET | `/admin/themes/:id/export` | Streams the zip (`theme.json` + `images/`) as `Content-Disposition: attachment` (D12) |
| POST | `/admin/themes/import` | Multipart zip ≤ 50 MB: check the zip, validate format and version, run `migrateDocument`, upload images as org `StoreFile`s and rewrite references, drop foreign data references, create UNPUBLISHED → `{theme, warnings[]}`. Images are uploaded before the theme row is created; on failure, images uploaded in this attempt are released |
| GET | `/admin/online-store/vitals?days=30` | 038M: P75 LCP/INP/CLS, session count, the same metrics for the previous period, and the rating for each |

**Public routes**

- `GET /organizations/:id/public/storefront/render?page=…` lives in `backend/src/api/routes/organizations.js` beside the existing `/:id/public/pages|blogs|menus` routes and uses `gateByOrgParam`.
  - **The parameter must be `:id`.** `gateByOrgParam` reads `req.params.id`. Under any other name it gets `undefined`, `organizationIdFor` returns null, and `assertAccess` returns without checking, so a private store would render for anyone. A contract test hits the **registered** route for a private org with no token and expects the gate (§16, test 14).
  - It follows the spec 026 404 rules for hidden or unpublished content, and accepts `X-Theme-Preview` / `X-Theme-Thumbnail` tokens forwarded by the Next server (§9a.5).
  - It answers `renderer: 'legacy'` with no theme data when the org is not in the rollout.
- `POST /organizations/:id/public/storefront/vitals` (038M) takes `{sessionId, metric, value, pageKind, device}`. It is sampled to 25% of sessions, has a new `VITALS` limiter (spec 020), validates values against sane ranges, and is always 204.

**Preview token**

- The full contract is §9a.5. Interactive previews and thumbnails use different tokens and different transports.
- A token is checked against the current theme on every render, so a deleted theme or one that moved to another org stops working at once.
- The Next route `/api/storefront/preview` sets the httpOnly, `SameSite=Lax` cookie `jump_theme_preview` on whichever host the link was opened on, which covers custom domains.

**Export file format (v1)**

```
eventimus-theme-summer-refresh-2026-09-27.zip
├── theme.json
└── images/
    ├── 3f9a…c1.webp
    └── 88b0…4e.jpg
```

```json
{ "format": "eventimus-theme", "formatVersion": 1,
  "preset": { "key": "eventimus-default", "version": "1.0" },
  "name": "Summer refresh", "exportedAt": "2026-09-27T12:00:00Z",
  "settings": { "logo": { "image": { "asset": "images/3f9a…c1.webp", "alt": "…" } }, … },
  "content": { … },
  "documents": { "header": { "kind": "HEADER_GROUP", "schemaVersion": 1, "data": { … } }, "home": { … }, "page:<id>": { … } } }
```

- In `theme.json`, image settings use `{ "asset": "images/<sha256>.<ext>" }` in place of `{ "fileId": … }`. Export and import each rewrite them in one pass.
- It contains no organization ids, user ids or email addresses.
- Page documents are exported with their page slug as a hint. On import, a `page:` document attaches to a page of the importing org with the same slug, or is dropped with a warning.

## 9a. Architecture contracts (card 038-0, written before 038A)

These contracts came out of the plan review. 038-0 writes them into `specs/038-theme-editor/contracts.md`, and the spike proves each one before any implementation card starts.

### 9a.1 Private store access on the server

- **Today:** unlocking stores a token in `localStorage` (`frontend/src/lib/storefrontAccess.ts`), and the client sends it as `X-Storefront-Access`, which `backend/src/middleware/storefrontGate.js` checks. A server-rendered page cannot see it.
- **New:** a Next route handler `POST /api/storefront/access/[orgId]` on the storefront host proxies the existing unlock call (`POST /organizations/:id/storefront-access`).
  - On success it sets a first-party cookie `jump_store_access_<orgId>`: httpOnly, `Secure` outside development, `SameSite=Lax`, `Path=/`, host-only (no `Domain`, so it works per custom domain), and `Max-Age` equal to the token's lifetime.
  - The server components read that cookie and forward it as `X-Storefront-Access`.
- **Transition:** the client keeps writing `localStorage` and sending the header for the client-rendered pages that remain (checkout, account). Once they move, localStorage is removed. The backend gate is unchanged.
- **Clearing:** a wrong or expired token makes the render endpoint answer `locked`, and the gate renders on the server. Next 14 lets only a Route Handler or Server Action delete cookies, not a Server Component. So when a cookie was sent and the answer is `locked`, the gate mounts a small client island that calls `DELETE /api/storefront/access/[orgId]` (a route handler that expires the cookie). The invalid preview cookie is cleared the same way through `DELETE /api/storefront/preview`.
- **Access is never cached.** Every storefront request checks access against the backend at render time (§9a.3), so turning on password protection takes effect on the next request.

### 9a.2 Atomic save

- **Request:** `PUT /admin/themes/:id/save` with body `{ themeVersion, settings?, content?, documents?: { [key]: { data, version } } }`.
  - `data: null` **deletes** that document's row, so it falls back to the preset default. Restore uses this for documents that did not exist in the revision. The editor exposes it as "Reset to theme default" on a template. Page documents are still deleted only by the `Page` cascade.
- **Transaction** (`prisma.$transaction`, `SELECT … FOR UPDATE` on the theme row):
  1. **Versions.** `themeVersion` must equal `Theme.version`, and every sent document's `version` must equal its row (0 means the document does not exist yet). Any mismatch is a 409 `THEME_CONFLICT` with `{ theme?: currentVersion, documents: { key: currentVersion } }`, and nothing is written.
  2. **Validation.** Everything sent is validated (`validateDocument`, settings schema, content catalog), and rich text is sanitized. Any failure is a 400 with per-key errors, and nothing is written.
  3. **Write.** The changed rows are written.
     - `Theme.version` goes up by 1 if settings or content were sent. Each document's version goes up by 1 if it was sent.
     - `lastSavedAt` and `lastSavedById` are set.
     - `syncReferences('THEME', themeId, fields, organizationId, { tx, onlyFields })` runs **once, on the transaction client**, with exactly the fields written (§5 Files). References of unchanged fields are untouched, and a later failure rolls the reference changes back with everything else.
  4. **Revision.** If the theme is MAIN, one `ThemeRevision` holds the full theme state after the write plus `changedKeys` (D6), and revisions beyond the latest 50 are deleted.
- **After commit:** nothing else in the MVP, because renders are uncached (§9a.3). With 038P, a MAIN save then triggers revalidation (§9a.4).
- **Rename** uses the same `themeVersion` rule. Publish, schedule and delete lock the theme row but do not change `version`.

### 9a.3 Cache contract

**MVP: no shared render cache.** Every storefront request calls the render endpoint with `cache: 'no-store'`.
- **Why.** A tagged, time-based cache would serve stored content after the store turns private, a page is hidden or a post is unpublished, because none of those revalidate the tag. A 60 s `revalidate` is also no bound: Next 14 serves the stale entry once after expiry while it refreshes in the background, and keeps serving it if the refresh fails ([Next 14 caching](https://nextjs.org/docs/14/app/building-your-application/caching)).
- **Cost.** One backend read per page view, the same as today's client fetches, now made from the server. The spike measures server render time for a 20-section page; if it is acceptable, caching waits for traffic data.

| Request | Backend call | Next caching | Response headers |
|---|---|---|---|
| Anonymous, public store | render with no token | `cache: 'no-store'` | normal |
| Private store, no cookie | render → `locked` | `cache: 'no-store'` | `private, no-store` |
| Private store, access cookie | render with `X-Storefront-Access` | `cache: 'no-store'` | `Cache-Control: private, no-store` |
| Interactive preview cookie | render with `X-Theme-Preview` | `cache: 'no-store'` | `private, no-store`, `X-Robots-Tag: noindex` + `<meta name="robots" content="noindex">` |
| Thumbnail URL | render with `X-Theme-Thumbnail` | `cache: 'no-store'` | `private, no-store`, `noindex`, `X-Frame-Options: SAMEORIGIN` scoped to the admin origin |

- Reading `cookies()` makes these routes dynamic in Next 14, so the Full Route Cache never holds a page.
- The backend render endpoint sends `Cache-Control: private, no-store` whenever a token was presented or the answer is `locked`, so no CDN in front of it can share one.

**Card 038P (later, optional): shared render cache.** It may start only when all of these are in its scope:
1. **Access fails closed and is never cached.** Each request makes a fresh, uncached access check (store private? token valid?) before any cached content is served. If the check errors, the gate renders.
2. **Every visibility trigger revalidates:** theme save, publish, scheduled publish and restore; store access changes (private toggle, password change); page, blog and post publish/hide/schedule; event publish, unpublish and sale-state changes; menu saves; org identity (name, slug, logo, brand); domain changes.
3. **Staleness is stated honestly.** It is "until the next successful revalidation", not "60 s".
4. **A production-build Playwright suite** (`next build && next start`, because `next dev` does not cache) covers a warm cache going public → private, including a failed revalidation call, and checks that the gate still renders.

### 9a.4 Internal revalidation (ships with 038P)

Nothing is cached until 038P, so nothing needs revalidating before it. The contract below is fixed now so 038P does not reopen it.

- **One contract for every trigger** listed in 038P precondition 2.
- **Auth.** The backend calls `POST <FRONTEND_URL>/api/storefront/revalidate` with `Authorization: Bearer <token>`, where the token is an HS256 JWT signed with a **separate** secret `STOREFRONT_REVALIDATE_SECRET` (in the backend and the frontend). The token carries `{ aud: 'storefront-revalidate', orgId, exp: now + 60 s }`.
- **Body and behaviour.** The body is `{ orgId }`. The route verifies the token and calls `revalidateTag('storefront:<orgId>')`. It never accepts a staff session, so there is no second path.
- **Unset secret** (local dev, tests): the backend skips the call. 038P refuses to enable caching in production without the secret, rather than relying on expiry.
- **Server placement.** Admin actions call `ThemeService`, which triggers revalidation on the server after commit, so the browser never calls the route.

### 9a.5 Preview tokens vs thumbnails

| | Interactive preview (D11) | Thumbnail |
|---|---|---|
| Purpose | Browse a draft on the real storefront | Scaled, non-interactive image of one theme on the Online Store page |
| Token | HS256, `STOREFRONT_PREVIEW_SECRET`, `{ aud: 'theme-preview', orgId, themeId, share, exp }`; staff 1 h, share 14 d | HS256, same secret, `{ aud: 'theme-thumbnail', orgId, themeId, page: 'home', exp: now + 10 min }` |
| Transport | `/api/storefront/preview?token=` sets host cookie `jump_theme_preview` (httpOnly, host-only, `SameSite=Lax`), then redirects to the org's home on that host (`/organizations/:slug` on the platform host, `/` on a tenant host) | Query param on a dedicated route `/theme-thumbnail/[orgId]?t=` that never sets or reads cookies (not `/_thumbnail`: App Router folders starting with `_` are private) |
| Private store | Staff token (`share: false`): renders past the store gate. Share token: the store gate applies first; the visitor must unlock with the password (D11) | Renders past the store gate (staff-minted, org-bound, 10 min) |
| Theme mode | `ThemeScope` script as on live pages (§9a.6) | No script runs in the sandbox, so the server writes the mode straight into the HTML: `class="dark"` on an outer wrapper `div` for DARK (the root layout owns `<html>`), `light` otherwise, and SYSTEM renders as LIGHT |
| Many at once | One per browser per host; opening another preview replaces it (by design) | Unlimited: each iframe carries its own token |
| Rendering | Full storefront with preview bar, islands on | No islands, no animation, no preview bar, no vitals reporter |
| Checks on every render | Theme still exists, still belongs to `orgId`, not MAIN (a published theme shows live with no bar) | Theme exists and belongs to `orgId` |
| Exit | "Exit preview" clears the cookie | Not applicable |

- `/theme-thumbnail` is excluded from tenant routing and redirects. It is added to `isReservedPath` and to `storefrontHost.ts`, and it answers 404 without a valid token.

### 9a.6 Server-safe theming (`ThemeScope`)

- **Today.** `BrandScope` is a client component. It computes `brandCssVars` during render, which is server-safe, but applies a forced theme mode in `useEffect` through `ThemeProvider`, which flashes on server-rendered pages. Tailwind uses `darkMode: 'class'` on `<html>`, so forcing a mode needs a class on `<html>`, not just the wrapper.
- **Split:**
  1. **`ThemeScope`** (server component) renders the wrapper `div` with the brand and scheme CSS variables, the font variables and `data-theme-mode`.
  2. **A blocking inline script**, emitted by `ThemeScope` when the org forces a mode. Before first paint it sets or removes `dark` on `<html>` (LIGHT, DARK, or `matchMedia` for SYSTEM), the same technique `next-themes` uses, and records the mode as `<html data-jump-forced>`. `ThemeProvider` reads that attribute as its initial forced state; without it next-themes applies the visitor's theme in its first effect and the page flips for a frame (found in the spike). There is no CSP today. If one is added, the script needs a nonce.
  3. **`ThemeModeSync`** (client, tiny) calls `setForced` after hydration so `ThemeProvider` agrees with the script, and releases on unmount. This keeps today's rule (gotcha 7): the org mode is forced while on the org's pages and the visitor's own choice returns elsewhere, never overwritten through `setTheme`.
- **`BrandScope` keeps its API** for the non-themed pages (checkout, apply, account) and internally becomes `ThemeScope` + `ThemeModeSync`. Behaviour is identical.
  - **The no-flash guarantee does not extend to those pages.** They learn the org's `themeMode` only after their client fetch, so the blocking script cannot know the mode at first paint, and they may flash as they do today. Fixing that means passing the mode from their server shells; that is out of scope for 038. Test 12 covers themed routes only.
- **Invariants to keep** (PRs #2, #3, #12, #91, #199, #201, #202, #206, #220, #221):
  - LIGHT/DARK/SYSTEM semantics.
  - Storefront colors only from brand/scheme tokens.
  - Accessible header and nav (drawer focus, skip link).
  - Aligned content widths.
  - The torn-ticket visual language on event and ticket UI.
  - Locked conversion and payment flows.
  - Each invariant gets a test in 038B (§16).

## 10. Online Store page (`/admin/online-store`, D16)

The sidebar "Online store" link opens this page. Its children stay **Pages** and **Preferences**, and the old branding form moves into Preferences as a Brand card. `adminSearch.ts` gains the entries "Themes", "Edit theme", "Default theme content" and "Import theme".

```
┌ 🏪 Online Store                                         [👁 Public ▾] [View store] [⋯] ┐
├ [🗓 30 days] │ LCP P75 1.4 s ▼17% ●Good │ INP P75 48 ms ▲26% ●Good │ CLS 0 │ Sessions 117 ┤  (038M)
├ ┌───────────────────────────────────────────────────────────────────────────────────┐ ┤
│ │    [ desktop preview, scaled iframe ]            [ mobile preview ]               │ │
│ ├───────────────────────────────────────────────────────────────────────────────────┤ │
│ │ Summer refresh  [Active]                                        [⋯] [Edit theme]  │ │
│ │ Last saved: Sep 26 at 4:14 pm · Eventimus Default v1.0                            │ │
│ └───────────────────────────────────────────────────────────────────────────────────┘ │
├ Draft themes                                                        [Import ▾]        ┤
│ [thumb] Copy of Summer refresh        Last saved: Sep 19   [⋯] [Publish|▾] [Edit theme] │
│ [thumb] Holiday test                   Last saved: Sep 15   [⋯] [Publish|▾] [Edit theme] │
│                               ⌄ Show all (N)                                          │
└ Learn more about themes (→ docs/wiki link)                                             ┘
```

**Header**
- **Store access** dropdown: "Public" or "Password protected". It reads and writes the existing store-access preference (`storefrontPrivate`). Choosing "Password protected" without a password opens Preferences to set one.
- **View store** opens the storefront (custom domain if active) in a new tab.
- **⋯ menu:** Preferences, Pages, Menus, Domains.

**Speed strip (038M)**
- A 30-day range picker (7, 30 or 90 days).
- Metric tiles, each with a tooltip explaining the metric and its thresholds (LCP ≤ 2.5 s good / ≤ 4 s needs improvement; INP ≤ 200 / 500 ms; CLS ≤ 0.1 / 0.25).
- Change against the previous period, and the session count.
- "Not enough data yet" below 50 samples.
- The status is always a word, never only a color.

**Active theme card**
- Scaled previews: `<iframe>` at 1280 wide scaled down, and one at 390, with `loading="lazy"`, `pointer-events: none`, `aria-hidden`, `tabIndex=-1` and a sandbox without scripts. The src is a **cookie-free signed thumbnail URL** (§9a.5) that renders the theme's home with islands and animation off. Thumbnails never touch the preview cookie, so any number can load at once.
- Name, **Active** badge, "Last saved" (account time zone via `useAccountFormat()`, gotcha 28) and the preset version.
- **Edit theme** (primary) opens the editor.
- **⋯ menu:** View (opens the live store), Rename, Duplicate, **Edit default theme content**, **Download theme file**. Delete is not offered on the active theme.

**Draft themes**
- Rows with a thumbnail (one scaled iframe, loaded when visible), name, "Last saved" and preset version.
- **⋯ menu:** Preview, Rename, Duplicate, Edit default theme content, Download theme file, **Delete** (red, last, with a confirm dialog that names the theme).
- **Publish** split button. The main action opens a confirm dialog: "Publish *X*? It replaces *Y* on your live store. *Y* moves to Draft themes." The ▾ offers **Schedule publish…**, Preview and Share preview link.
- **Scheduled status.** A scheduled draft shows "Scheduled · Oct 3, 9:00 AM EDT" with **Cancel schedule** and **Change**. A failed schedule shows the error and a **Publish now** retry.
- **Edit theme** opens the editor on the draft.
- Five rows show, then **Show all (N)**. An empty state explains duplicating.

**Import ▾:** "Upload theme file" (.zip). It shows a progress bar, because images upload one by one. A result dialog lists the warnings: dropped references, invalid sections removed and images refused (with the reason, e.g. "SVG not allowed").

**Dialogs**
- **Rename:** 1-50 characters. A 409 on the version says someone else changed it.
- **Duplicate:** creates the copy, toasts "Copy created" and scrolls to it.
- **Share preview:** a read-only URL field with Copy and "Expires on <date>".

**Default theme content page** (`/admin/online-store/themes/[id]/content`)
- A search box and a list grouped by catalog group.
- Each row shows the default as a placeholder, a text input, a "Reset" link and a character counter.
- Required variables are shown as chips, and a save that drops one is refused with an inline message.
- Save uses the page's sticky save bar, like other admin forms, and goes through `PUT /admin/themes/:id/save` with `content` only (§9a.2).

## 11. Theme editor (`/admin/online-store/themes/[id]/editor`)

It is full-screen outside `AdminLayoutClient`, with `AdminRoute` (gotcha 24), and Puck is loaded with `dynamic(..., { ssr: false })`.

```
┌ [←] [☰ Sections][⚙ Settings] │ Summer refresh · Active │ [Home ▾] │ [⌖ inspector][📱/🖥] [↶][↷] [⋯] [Save] ┐
├ LEFT RAIL PANEL ──────────────┬ CENTER (Puck.Preview iframe) ─────────┬ RIGHT (Puck.Fields) ──────┤
│ ☰ Sections (Puck.Outline)     │  hover: outline + label chip          │ Header  ⋯ ✕               │
│ Header                        │  click: select section or block       │ Logo position  [Left ▾]   │
│   ▸ Announcement bar   👁̸     │  "+" between sections → Add section   │ Menu           [Main ▾]   │
│   ▾ Header 🔒                 │                                       │ Sticky header  [On scroll]│
│   ⊕ Add section               │  📱 = centered 390 px frame           │ Color scheme   [Aa][Aa]   │
│ Template                      │                                       │ Padding  ──●── 20 px      │
│   ▸ Events hero               │                                       │                           │
│   ▾ Event list 🔒  ⊕ Add block│                                       │                           │
│ Footer                        │                                       │                           │
│   ▸ Footer 🔒   ⊕ Add section │                                       │                           │
│ ───────────── or ──────────── │                                       │                           │
│ ⚙ Theme settings (plugin)     │                                       │                           │
│  ▸ Logo  ▸ Colors ▸ Typography│                                       │                           │
│  ▸ Layout ▸ Animations ▸ …    │                                       │                           │
└───────────────────────────────┴───────────────────────────────────────┴───────────────────────────┘
```

- **Top bar.**
  - The theme name, with its **Active** or **Draft** badge.
  - The **page switcher**: Home, Events, Pages ›, Blog, Blog post ›, and in 038H Event ›. Unsaved edits are kept per document and marked in the switcher.
  - **Inspector** toggle (D20), **mobile/desktop** toggle (D20), undo/redo and **Save**.
  - A ⋯ menu: Preview (draft), Share preview, Edit default theme content, Download theme file.
  - On a draft theme there is also **Publish ▾** (Publish now, Schedule publish…; same dialogs as §10).
- **Left rail** (Puck plugin rail, D19).
  - **Sections** is the outline tree.
  - **Theme settings** (gear) is the accordion from §6.3. It shows one group open at a time, has search at the top, and a "Reset group to theme defaults" item in each group's ⋯.
  - Changes restyle the preview live through CSS variables and mark the theme dirty for Save.
- **One editor tree, three documents.**
  - One Puck `Data` has three root slot fields: `header` (allow = header-group sections), `template` and `footer`. Save splits it into three documents.
  - Spike 038-0 proves this approach. The fallback is three stacked `<Puck>` instances sharing one selection store.
- **Outline items.** Icon, label, eye toggle, and a ⋯ menu (Duplicate, Move up, Move down, Remove, with a confirm if the section has blocks). Locked items show 🔒 and have no drag handle.
- **Add section.** Grouped by category, with search and preset thumbnails. It lists only sections allowed in that group and under their `limit`.
- **Save.**
  - One `PUT /admin/themes/:id/save` carries every changed document, the settings and the content, each with its version (§9a.2). All of it commits or none of it does. A 409 lists what changed elsewhere and offers "Reload" (keeping a copy of the local edits for the session).
  - On the active theme, the first save of a session shows the D6 note. A save on the active theme is visible on the next storefront request (no render cache, §9a.3).
- **History (⋯ › Revision history), active theme only.** A list of the last 50 saves (who, when, what changed) with **Restore**, behind a confirm dialog: "Restore the whole theme to how it was on *date*? Newer changes are replaced; you can restore them again from this list." It ships in the MVP with the editor (038D), so live editing never ships without a way back.
- **Guards and history.** A guard for unsaved changes (`beforeunload`, Exit, page switch). Undo/redo through Puck history (⌘Z / ⇧⌘Z).
- **Viewports.** Desktop (full width of the canvas) and mobile (390, centered), switched by the phone icon (D20).
- **Data.** `preview-data` is loaded once per page and passed through Puck metadata/context. Pickers use the existing admin APIs.

## 12. Storefront speed (038M, D17)

- **Collection.** `frontend/src/components/storefront/WebVitalsReporter.tsx` (client) is mounted by `ThemeFrame`.
  - It uses Next's `useReportWebVitals` for LCP, INP and CLS.
  - `sessionId` is a random UUID in `sessionStorage`, with a SESSION beacon once per tab.
  - It sends with `navigator.sendBeacon` to the backend public route, sampled to 25% of sessions.
  - It is not mounted in preview, thumbnail or editor iframes.
- **Aggregation.** `percentile_cont(0.75)` for each metric over the window and the previous window of the same length. The session count is scaled by 1 ÷ sample rate and labelled "estimated".
- **Retention.** The existing hourly sweep pattern deletes rows older than 90 days (`VITALS_SWEEP_INTERVAL_MS`, default 24 h).
- **Privacy.** No IP, user agent string, cookie or URL query is stored: only org, metric, value, page kind and device class.
- **Counsel check.** Confirm the privacy policy wording before launch (spec 023 counsel gate). This is added to the launch checklist.

## 13. Security

- **No tenant HTML, CSS or script.** Rich text is Tiptap output sanitized on write (gotcha 20) and rendered through `ContentHtml`. Every other string is text, and style is limited to enums and ranges mapped to our classes.
- **URLs and embeds.** Only `https://` or storefront paths (`normalizeToPath`). Video embeds are built from ids parsed against an allowlist.
- **Caps.**
  - 256 KB per document, 40 sections, and section and block limits, all enforced on the server.
  - Import zips ≤ 50 MB and 200 images; `theme.json` ≤ 16 MB with the per-document caps applied inside it, the same ceiling export enforces (D12). Zip entries are checked for path traversal (only `theme.json` and `images/<sha256>.<ext>` are accepted) and zip-bomb limits. Each image goes through the normal upload checks (MIME sniffing, no SVG, size), and its hash must match its name.
  - Social links must be `https://` URLs on that platform's host.
  - Default-content strings are capped and variables validated. The catalog excludes legal, consent and payment wording.
- **Tenancy.**
  - Every admin query is scoped by `organizationId` through the theme.
  - Resolved and imported references are filtered to the org.
  - Preview tokens are bound to org and theme and re-checked on every render.
  - Contract tests cover cross-org access, forged references and forged or expired tokens.
- **Previews** are `noindex`, `no-store`, and cannot be cached by a CDN.
- **Private stores.** The render route binds the store gate through `:id` (§9). Share preview links never bypass the store password (D11).
- **Thumbnails** are sandboxed iframes without scripts.

## 14. Accessibility (WCAG 2.2 AA)

- **Storefront**
  - `<section aria-labelledby>` for each section with a heading, and one `<h1>` per page.
  - Alt text is required unless an image is marked decorative.
  - The announcement bar, carousels and countdown have pause controls and stop under `prefers-reduced-motion`.
  - Scheme contrast is checked.
  - The preview bar is a labelled `region` with keyboard-reachable Exit and Share.
- **Online Store page**
  - Theme cards are `<article aria-labelledby>`.
  - ⋯ menus follow the `RowActionsMenu` keyboard pattern (spec 019): arrows, Escape, focus return, and a name such as "More actions for Holiday test".
  - The Publish split button has two labelled buttons.
  - Status badges are text. The speed tiles carry their rating as a word.
  - Targets are ≥ 24 px.
- **Editor**
  - The outline and fields are keyboard operable, with visible focus and labelled icon buttons.
  - Every canvas action also exists in the outline ⋯ menu, because Puck's canvas is weak for keyboard users.

## 15. Delivery: proposed Kanban cards

Each card is its own worktree and PR, and closes only when the required checks are green. PRs include screenshots at 1440 and 390 px.

### Phase 0: contracts and spike (gate)

| Card | Title | Scope | Depends on | Size |
|---|---|---|---|---|
| **038-0** ✅ GO 2026-09-28 | Contracts + Puck spike (go/no-go) | Write `contracts.md` (§9a.1–9a.6). Then, on a throwaway branch, prove each contract with **real Jump components** (header, `EventList`, a Hero with nested `Button` blocks) in Puck 0.23 inside Next 14.2 / React 18. The spike must cover: <br>• composition layout (§11) and three root slots with `allow`; nested slots <br>• outline overrides (eye, ⋯, 🔒) and permissions <br>• a **server/client config split**: an RSC-safe config for `Render`, the editor config adding fields and overrides <br>• iframe isolation of Tailwind, scheme variables and fonts <br>• the plugin-rail Theme settings panel with live CSS-variable restyle, and whether history can cover settings <br>• viewports inside the composition layout (it sizes its own preview) and interactive/inspector mode <br>• keyboard paths through outline and fields <br>• payload size of a realistic home document, and of a full-state revision snapshot (§5) <br>• editor route bundle size and storefront bundle impact (must be zero) <br>• server render time for a 20-section page, **uncached** (§9a.3) <br>• `ThemeScope` with no flash in all 3 modes <br>• cookie-based private-store render <br>• two simultaneous thumbnails, with the mode written into the HTML (§9a.5) <br>• one storefront Playwright spec running against the SSR fixture server (§16) <br>Report in `specs/038-theme-editor/spike.md` with a go/no-go and any contract changes.<br>**Acceptance conditions `contracts.md` must state** (second review): <br>1. The render route is `/organizations/:id/public/storefront/render`, gated by `gateByOrgParam` on `:id` (§9) <br>2. No shared render cache in the MVP; access is never cached (§9a.1, §9a.3) <br>3. `syncReferences` takes `{ tx, onlyFields }` (§5 Files, §9a.2) <br>4. SSR fixture server for Playwright (§16) <br>5. Revisions are full-state and `/save` can delete a document (D6, §9a.2) <br>6. Per-org rollout and the renderer kill switch (Launch flags below) <br>7. Preview redirect per host, private-store rules for preview/share/thumbnail, cookie clearing through route handlers, thumbnail mode in HTML, no flash claim for checkout/apply, 16 MB `theme.json` cap on both export and import | — | M |

### Phase 1: MVP (one active theme, homepage, Events page, editor)

This is the smallest path that proves the model end to end: organizers edit and save the active theme, see the live-store warning, can restore any of the last 50 saves, have a small set of homepage sections to build with, and the storefront renders on the server. Any org can be switched back to today's renderer.

| Card | Title | Scope | Depends on | Size |
|---|---|---|---|---|
| **038A** | Theme package, schema, core API | `packages/theme` (registry skeleton, validator, preset, `fileIdsInThemeJson`, `migrateDocument`); Prisma models + partial unique indexes + `ContentRefKind.THEME` + `Organization.themesEnabled`; `syncReferences` accepts id arrays and `{ tx, onlyFields }`; `ThemeService` (`ensureMain`, get, **atomic `/save`** §9a.2 including `data: null` deletes, full-state revisions + pruning, restore); render endpoint on `/organizations/:id/public/storefront/render` (answers `renderer: 'legacy'` for orgs not in the rollout) + preview-data endpoint; contract tests (validation, limits, 409 all-or-nothing, one-MAIN invariant under concurrency, nested reference extraction, **unchanged references kept + reference rollback**, **restore is full state**, **private store gate on the registered route**, cross-org 404, sanitization) | 038-0 go | L |
| **038B** | Server frame, access cookie, header/footer groups, SSR test harness | `ThemeScope` + `ThemeModeSync` (§9a.6, `BrandScope` rebuilt on them); store-access cookie route + `DELETE` clearing route (§9a.1); uncached render contract (§9a.3); `ThemeFrame`; Header, Footer, AnnouncementBar sections; server-render org, page and blog routes. **Pages and blog render their current fixed body** (`Page.content`, post list, post body) inside `ThemeFrame` with the header/footer groups; they get editable templates only in 038G. Renderer switch: legacy client components stay in the tree and render when the org is not in the rollout or the kill switch is off (Launch flags). **SSR fixture server** and migration of the existing storefront Playwright specs to it (§16); invariant tests (§16) | A | L |
| **038C** | Events page + homepage routing | `/organizations/:slug/events` + tenant `/events` (exact) vs `/events/:id`; `EventsHero` + locked `EventList` reproducing today (screenshot parity); `/` → home or fallback; `hrefFor` `EVENTS`; reserved paths + custom-host shortening tests | B | M |
| **038S** | Starter homepage sections | `Hero` (with `Button` blocks), `RichText`, `CallToAction`, `UpcomingEvents` (§7 rows marked S): schemas, presets, render tests, and a preset `home` document that uses them | B | M |
| **038D** | Editor shell | §11 for Header, Footer, Home and Events on the **active theme**: outline, fields, iframe, page switcher, one-call Save + 409 dialog, undo, viewports, inspector, hide, lock, guards, **the D6 "editing your live store" note**, **revision history with full-state Restore** (§11 History); Playwright (`signInAsStaff`, mocked API) + axe | A, B, C, S | L |
| **038J1** | Online Store page (minimal) | `/admin/online-store`: header (store access dropdown, View store), active theme card (name, Active, last saved, version, **Edit theme**, ⋯ with View), placeholder previews (static preset image until 038K); branding form moved to Preferences › Brand; admin search entries | A | M |

**MVP exit criteria:**
- `THEME_EDITOR_ENABLED` on, and `themesEnabled` on for **one pilot org only**; every other org still renders through the legacy renderer.
- Home (built from the starter sections) and Events are edited and saved in the editor, and pages are server-rendered with no theme flash.
- The pilot org has restored an earlier revision, and has been switched back to the legacy renderer and forward again with no data loss.
- The private store works on the server, including public → private with no stale content on the next request.
- All §16 MVP tests pass in CI.

### Phase 2: theme library and safe experimentation

| Card | Title | Scope | Depends on | Size |
|---|---|---|---|---|
| **038J2** | Draft themes + management | Draft list, ⋯ menus (Rename, Duplicate, Delete), Publish swap + confirm, 20-theme limit | J1, D | M |
| **038K** | Draft preview + thumbnails | Interactive preview token + cookie route (per-host redirect) + preview bar + share links (store password still applies); cookie-free thumbnail route and signed URLs with the mode in the HTML (§9a.5); scaled iframe previews on the Online Store page; `noindex` / `no-store` | B, J2 | M |
| **038I** | Docs | `/doc-feature` → `docs/wiki/features/online-store-themes.md`; gotcha 30 in `AGENTS.md`; env table rows (`THEME_EDITOR_ENABLED`, `STOREFRONT_PREVIEW_SECRET`, `THEME_PUBLISH_SWEEP_INTERVAL_MS`, `VITALS_SWEEP_INTERVAL_MS`; `STOREFRONT_REVALIDATE_SECRET` with 038P) | D, J2 | S |

### Phase 3: breadth (after the core path is proven)

| Card | Title | Scope | Depends on | Size |
|---|---|---|---|---|
| **038E** | Section library v1 | §7 rows marked E, presets + thumbnails, schema unit tests, render snapshot per section | D | L (may split E1 content / E2 events + media) |
| **038F** | Theme settings panel (gear rail) | §6.3 in full, each group wired to `ThemeScope` variables and read by every section; undo/redo for settings; contrast warnings | D | L (may split F1 identity, colors, type, layout / F2 component styles) |
| **038G** | Pages + blog templates | `page:<id>` documents with locked `PageContent`; `blog` / `blog_post` with `BlogPostBody` / `BlogPostList`, replacing the fixed bodies from 038B; "Customize" from `PageForm`; cascade on page delete across themes | D | M |
| **038N** | Theme file download / import with images | Zip export/import (D12) through the upload pipeline; reference rewriting; zip safety; 16 MB `theme.json` ceiling on both sides; warnings + progress; contract tests (round-trip including a theme near the size ceiling, cross-org import, traversal / zip-bomb / SVG / hash mismatch refused, partial-failure cleanup) | A, J2 | M |
| **038O** | Scheduled publish | D18: schedule routes, sweep (`FOR UPDATE SKIP LOCKED`), same swap transaction, failure state, dialogs and badges; contract tests (due, cancel, replace, manual publish clears, validation failure, racing sweeps) | J2 | M |
| **038L** | Default theme content | Catalog (§6.5) wired through sections; content page; variable validation; tests that consent, legal and payment wording is absent | B, J2 | M |
| **038H** | Event page template | Server-render the event page; locked `EventMain` wrapping the ticket panel as a client island (cart, capacity and checkout unchanged); alternates + picker; full checkout e2e regression | D | L |
| **038M** | Storefront speed strip | `StorefrontVital` (90-day retention), reporter, beacon + `VITALS` limiter, 7/30/90-day aggregation, strip on the Online Store page; counsel wording check | B, J1 | M |
| **038P** | Shared render cache (optional) | Only if spike and production render times call for it. Every precondition in §9a.3 (fail-closed uncached access check, full trigger list, honest staleness), internal revalidation (§9a.4, `STOREFRONT_REVALIDATE_SECRET`), production-build Playwright suite (warm cache public → private, failed revalidation) | B, M data | M |

**Order.**
- 0 → A → B → C and S → D, with J1 alongside B and C. That is the MVP.
- Then J2 → K and I.
- Phase 3 cards run in parallel, in priority order: E, F, G, then N, O, L, then H, then M. P only on evidence.

**Launch flags and rollback:**
- **Master switch:** backend `THEME_EDITOR_ENABLED` and frontend `NEXT_PUBLIC_THEME_EDITOR_ENABLED`, both default off. Off means every org gets the legacy renderer and no editor, whatever `themesEnabled` says. This is the **renderer kill switch**: flipping it restores today's storefront everywhere on the next deploy, with no data change.
- **Per-org rollout:** `Organization.themesEnabled` (default false), set by `SYSTEM_ADMIN` only. With the master switch on, an org with `themesEnabled` gets the themed server renderer, the editor and the Online Store themes page; every other org gets the legacy renderer and today's Online Store page. Rolling back one org is setting it to false.
- **Legacy renderer lifetime.** Today's client components (`OrganizationStorefront` and the page/blog clients) stay in the tree until every org is on themes, 038H has shipped and one release has passed. Removing them is its own PR.
- **With the master switch off**, `/admin/online-store` shows today's page, so the branding form stays where organizers know it until their org is enabled; for enabled orgs it moves to Preferences › Brand.
- **New secrets, both services:**
  - `STOREFRONT_PREVIEW_SECRET` (§9a.5). Unset in dev and tests means previews are disabled. Production sets it before 038K ships.
  - `STOREFRONT_REVALIDATE_SECRET` (§9a.4) only with 038P.

## 16. Testing

- **`@jump/theme`**
  - Validator, catalog and migration tests run in **both** Jest and Vitest against one fixture set (`packages/theme/test/fixtures/`), the pattern from gotcha 28.
  - Preset documents validate.
  - Export → import round-trips to equal data within the same org, including a theme near the 16 MB `theme.json` ceiling with documents at the 256 KB cap.
- **Backend contract tests**
  - every §9 route
  - the one-MAIN invariant under two concurrent publishes
  - delete refused on MAIN
  - theme limit
  - the preview token cannot be used for another org, expires, and stops working when the theme is deleted
  - import drops foreign references with warnings
  - render removes hidden items and inactive announcements
  - the private store returns the gate, tested against the **registered** render route (not a hand-built router), so a wrong parameter name fails the test
  - staff preview and thumbnail tokens render past the store gate; a share token does not
  - vitals beacon validation and rate limit (with `RATE_LIMIT_ENFORCE_IN_TESTS=1`)
- **Frontend**
  - A render test per section.
  - An SSR smoke test per themed route.
  - The Events page matches today's `OrganizationStorefront` in a screenshot diff at 1440 and 390.
- **SSR test harness (038B).** CI's Playwright job starts `next dev` with no backend and mocks the API with `page.route`, which only intercepts **browser** requests. Server-rendered storefront pages fetch from the Next server, so those mocks cannot reach them.
  - 038B adds a deterministic **fixture server**: a small Node HTTP server started by Playwright's `webServer` next to Next, serving canned JSON per organization id from `frontend/e2e/fixtures/storefront/`, with no network, no Postgres and no Stripe. It listens on the API port the e2e job already sets (`NEXT_PUBLIC_API_URL=http://localhost:3002`), so the Next server's fetches reach it with no new env var (contracts C9).
  - Specs choose a fixture set through the organization id in the URL, so tests stay independent under the 3 shards.
  - 038B migrates every existing storefront spec that loads a server-rendered route to it. Browser-side calls (checkout, cart) keep `page.route`.
  - A **production-build suite** (`next build && next start`) is needed only when 038P adds caching, because `next dev` does not cache.
- **Playwright** (mocked API and the fixture server, no network):
  - Online Store page: ⋯ menus by keyboard, rename, duplicate, delete confirm, publish confirm swapping the badges, import warnings dialog, share-preview copy.
  - Editor: select from canvas and outline, add, hide and reorder, undo, 409, save, the live-store note on the first active-theme save, revision restore with confirm.
  - Storefront: preview bar, announcement hidden and shown, tenant `/events`, `/` fallback.

**Acceptance tests from the plan review.** Each names the card that owns it.

| # | Test | Card |
|---|---|---|
| 1 | Private store, **locked**: server HTML contains the gate and no store content. **Unlocked** (cookie): full page. Wrong or expired cookie: gate, and the `DELETE` route handler expires the cookie | B |
| 2 | No stale access: a public page is viewed, the store turns private, and the next anonymous request gets the gate. The same for a page hidden and a post unpublished. Personalized and `locked` responses carry `private, no-store` | B, K |
| 3 | `noindex` meta + `X-Robots-Tag` on preview and thumbnail responses; absent on live pages | K |
| 4 | Cookies: host-only (custom domain and platform host kept apart), `Max-Age` equals token lifetime, "Exit preview" clears, a cross-org token is refused | B, K |
| 5 | Atomic save: a stale version on one document → 409 and **no** row changed (settings, content and other documents untouched); a validation error on one document → 400 and nothing changed; one revision per save; pruning at 50 | A |
| 6 | Nested reference extraction: a `fileId` inside block props inside a slot, in settings, and in rich-text HTML all appear in `StoreFileReference` (`THEME`); removing them removes the rows | A |
| 7 | Two and five thumbnails load at once, each showing its own theme; the interactive preview cookie is unchanged afterwards | K |
| 8 | Routing: tenant `/events` → Events page, `/events/<id>` → event detail, `/events/` → Events page; platform `/organizations/:slug/events`; `/theme-thumbnail` reserved | C, K |
| 9 | Custom-host shortening: menu and section links render `/events`, `/pages/x` on the tenant host and full platform paths on the platform host | C |
| 10 | Screenshot parity: the Events page matches today's org home at 1440 and 390, in light and dark | C |
| 11 | axe (WCAG 2.2 AA) on the editor, the Online Store page and each themed storefront route | D, J1, J2 |
| 12 | Theme mode: no flash (first-paint class equals final class) in LIGHT, DARK and SYSTEM; the visitor's own mode returns on non-org pages (gotcha 7) | B |
| 13 | Invariants: storefront colors only from tokens (lint for raw color classes in `frontend/src/theme/sections`), header and nav keyboard behaviour, aligned widths, checkout flow unchanged (existing e2e stays green) | B, H |
| 14 | Render route gate: `GET /organizations/:id/public/storefront/render` for a private org with no token returns the gate, through the route as registered in `server.js` | A |
| 15 | References: saving only `home` keeps the header, footer and settings `StoreFileReference` rows; a save that fails after `syncReferences` (forced validation error on a later step) leaves the reference rows as they were | A |
| 16 | Restore is full state: change colors, then the homepage; restoring the color revision also brings back the old homepage. A document created after the revision is deleted on restore and falls back to the preset | A, D |
| 17 | Rollback: with `themesEnabled` false (or the master switch off) the org renders the legacy storefront, and turning it back on shows the saved theme unchanged | B |
| 18 | Preview redirect: a preview link opened on the platform host lands on `/organizations/:slug`, on a tenant host on `/`. A share link on a private store shows the password gate first | K |
| 19 | Thumbnails of a DARK theme render dark with no script; a thumbnail of a private store renders the theme, not the gate | K |

## 17. Risks

| Risk | Mitigation |
|---|---|
| Puck is pre-1.0; features could move to Cloud | Pinned version, a single import site, MIT versions stay MIT, dnd-kit fallback |
| Three groups in one Puck tree | Spike first; stacked-instance fallback |
| Saving on the active theme is live immediately | D6 note on first save and full-state restore both ship in the MVP (038D); Duplicate / Preview / Publish flow in phase 2 |
| Server rendering regresses a live storefront | Per-org `themesEnabled` rollout starting with one pilot org; master switch falls back to the legacy renderer everywhere; legacy components kept until H + one release; test 17 |
| Moving storefront data to the server breaks CI's browser-only mocks | SSR fixture server and spec migration are in 038B's scope, so B cannot close without them (§16) |
| Iframe thumbnails cost performance on the Online Store page | Lazy loading, one iframe per draft row, cookie-free thumbnail route renders without islands (§9a.5); fall back to a preset image if the page gets heavy |
| Server rendering the event page could regress checkout | 038H last, ticket panel unchanged, full checkout e2e, flag |
| Web vitals data and privacy | No personal data, sampling, counsel check; card can be dropped |
| Import files crafted to attack | Same validator as saves, zip entry allowlist + zip-bomb limits, images through the upload pipeline with hash check, size caps, no ids trusted, rich text re-sanitized |
| Stale or personalized pages served from a cache | No shared render cache in the MVP (§9a.3); `private, no-store` on the backend and in Next; 038P only with a fail-closed access check, the full trigger list and a production-build suite; tests 1–2 |
| A private store renders through a mis-bound gate | Render route on `:id` beside the existing public org routes; test 14 on the registered route |
| Theme-mode flash after SSR | `ThemeScope` + blocking script (§9a.6); test 12 |
| Theme settings panel is outside Puck's page data | Plugin rail proven in the spike; settings state kept outside Puck with its own history if needed; drawer fallback |
| Scheduled publish misses or double-fires | Sweep takes a row lock (`FOR UPDATE SKIP LOCKED`) and is idempotent on `role`; renders are uncached, so the swap is visible on the next request |
| Theme JSON drifts from the registry | `schemaVersion` + `migrateDocument` on read and import; unknown types dropped with a log |

## 18. Open questions

1. **Homepage menu default.** When a homepage is first saved, should the main menu gain "Home" automatically? The default menu already has Home and Events. Proposed: no change.
2. **Events page SEO.** `seoTitle` / `seoDescription` on the `events` document root. Proposed: yes.
3. **Curated fonts.** Inter, Poppins, Montserrat, Playfair Display, DM Serif Display, Lora, Work Sans, Space Grotesk, Oswald, Archivo, Libre Baskerville, System.
4. **Newsletter block.** Out of v1 until a storefront opt-in exists. Proposed: yes, out.

**Resolved 2026-09-27**

- **Theme files carry their images.** Duplicate reuses the same files, and download/import bundle them in a zip (D12, card 038N).
- **Scheduled publish is in v1** (D18, card 038O).
- **Theme settings open from the gear icon in the editor's left rail** (D19, card 038F), limited to what Puck's plugin rail supports. The spike confirms it.
- **The mobile preview toggle uses Puck viewports** (D20).
