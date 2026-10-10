# Spec 049 — Brand settings + Theme settings panel

**Status:** Card A PR #392 (2026-10-09). Card B built 2026-10-10 (stacked on #392). Card C in progress.
**Supersedes:** spec 038 D16 ("Brand card under Preferences"). Partially delivers 038F (F1: identity, colors, type) through card C.

## Context
Branding (logo, cover, brand color, theme mode) is edited in `OnlineStoreSettings`, which is mounted on Online store › Preferences (Brand card, themes on) and on `LegacyOnlineStore` (themes off). Slogan, short description and social links exist only per theme (`Theme.settings.brand` / `.social`, `packages/theme/src/settings.js`) with no UI except `settings.json` / CLI. The theme editor (Puck, spec 038) has no Theme settings panel: card 038F was never built, and typography/favicon settings are defined but read nowhere.

Goal (Shopify model):
1. Organization owns brand identity, edited at **Settings › General › Store assets › Brand**: default logo, square logo, colors (primary, secondary, theme mode), cover image, slogan, short description, social links.
2. Theme editor gets a **gear "Theme settings" panel** with Logo, Colors (schemes), Typography for now. Theme values override brand; empty theme values inherit the brand.

The local checkout is a stale detached HEAD at #210. All work branches from `origin/main` (fe20528) in worktrees (`./scripts/bootstrap-worktree.sh`).

Decisions (from the owner):
- Theme Colors = edit color schemes (spec 038 D7). The accent slot is `brand` (primary), `brand-secondary` or a hex.
- Brand colors = primary (existing `brandColor`) + new secondary; theme mode moves to Brand.
- Slogan, description and socials are owned by the org; the theme can override; a one-time copy runs from each org's MAIN theme into the org.
- Supersedes spec 038 D16 ("Brand card under Preferences").

## Card A — Org brand data + Settings › Brand page (backend + admin UI)
**Schema** (`packages/db/prisma/schema.prisma`, Organization ~:495):
- `squareLogoUrl String?`, `squareLogoImageId String?` + relation `"OrgSquareLogo"` → `Image`, mirroring `logoImageId`.
- `brandSecondaryColor String?`
- `slogan String?` (≤120), `shortDescription String?` (≤300)
- `socialLinks Json?`: the same keys and host rules as theme `SETTINGS_GROUPS.social`.

**Migration:** add the columns, then a data step. For each org whose MAIN theme has non-empty `settings.brand.headline/description` or `settings.social`, copy them into the empty org columns. Leave theme values in place: they remain overrides with identical values, so nothing changes visually.

**Backend:**
- `validateUpdateOrganization` (`backend/src/api/validators/organizationValidators.js:112`): accept `brandSecondaryColor` (reuse the hex normalizer), `slogan`, `shortDescription` and `socialLinks`. Validate `socialLinks` with `checkFields(SETTINGS_GROUPS.social.fields, …)` from `@jump/theme`, so there is one rule set. Whitelist the new fields in `OrganizationService.updateOrganization` (:246).
- `POST/DELETE /organizations/:id/square-logo` in `routes/organizations.js`, copying the logo handlers (:367/:397). Add `setOrganizationSquareLogo` and an `org_square_logo` variant (square crop) in `imageService`.
- Add the new fields to the public org identity serializers (`OrganizationService.getPublicOrganization`, `publicOrganizationIdentity` select) so storefront pages receive them.
- Audit: map any new model or field in `audit/features.js` if the audit trail requires it (spec 048 rule).

**Frontend:**
- `app/admin/settings/page.tsx`: new **Store assets** card with one `SummaryRow` "Brand — Logos, colors, slogan and social links", chevron, linking to `/admin/settings/brand`.
- New `app/admin/settings/brand/page.tsx` (SettingsNav keeps General highlighted) with sections, each saving only its own fields (partial PATCH pattern):
  - **Logos:** Default logo + Square logo (`ImageUploader`), Cover image.
  - **Colors:** Primary (`BrandColorPicker` + `evaluateBrandColor`), Secondary (same picker), Theme mode (`ThemeModePicker`).
  - **Slogan** and **Short description** (one card, counters).
  - **Social links:** one URL input per network; reuse the `SOCIAL_LABELS` and `SocialIcon` from the footer.
- Strip branding from `components/OnlineStoreSettings.tsx` (keep name and slug for Legacy). Replace the Preferences "Brand" card (`preferences/page.tsx:285-301`) and the Legacy branding block with a short "Brand moved to Settings › Brand" link row. Fix the stale "Online store › Branding" copy in Preferences.
- `SetupGuideService.js` "design" task href → `/admin/settings/brand`.
- Social-link labels: lift `SOCIAL_LABELS` into a shared module if the footer and the Brand page both need it.

**Tests:**
- Contract: PATCH accepts and validates the new fields (bad host → 400), square-logo upload/delete, and the org guard (`verifyOrgOwnership`).
- Migration-copy unit test.
- Update e2e specs `admin-branding-color`, `admin-org-theme-mode`, `admin-preferences` and `admin-online-store` to the new location. Add `admin-settings-brand.spec.ts` (`signInAsStaff`, `page.route` mocks).

## Card B — Theme inherits brand (storefront resolution)
**Built 2026-10-10.** As planned, with one change: `GET /admin/themes/:id` `resolvedSettings` stays the theme's own values (the Card C panel edits them; inheriting there would save the org values into the theme). The editor canvas applies `withBrand` client-side instead, so the preview still matches live. Draft previews render through `ThemeService.render`, so `ThemePreviewService` needed no change. Favicon ships through `app/organizations/[orgId]/layout.tsx` and `faviconUrl` on `/public/meta`.
- `packages/theme/src/settings.js`: add `withBrand(resolved, org)`. When a theme value is empty, it fills `brand.headline` ← `org.slogan`, `brand.description` ← `org.shortDescription` and `social.*` ← `org.socialLinks.*`. Call it wherever `resolvedSettings` is produced for render (ThemeService GET/render, ThemePreviewService) and in the editor canvas, so the preview matches live. `FooterSection` stays unchanged.
- Scheme accent: allow `brand-secondary` alongside `brand` in `checkSchemes`. In `frontend/src/theme/settingsCss.ts`, `schemeCss` maps it to the org secondary. `ThemeScope` adds `--brand-secondary` from `brandCssVars`-style helpers in `lib/color.ts`.
- Favicon: theme `logo.favicon` ?? org square logo ?? none. Emit it via the `icons` metadata on the storefront route segments that already build metadata (`getPublicMeta` path). Non-theme pages use the square logo only.
- `backend/src/services/storefrontLogo.js` is unchanged (theme logo ?? org logo already works). Emails keep using the org logo and color (`emailBrand.js`).

## Card C — Theme settings panel (gear rail): Logo, Colors, Typography
- `theme/editor/ThemeEditor.tsx`: add a gear button to `PanelButtons` (:96-110) and a `ThemeSettingsPanel` plugin. Hold the settings in Puck `root.props.themeSettings` so undo/redo covers them (validated in `spike.md` item 6). Save (:323) sends `{ themeVersion, documents, settings }`; the backend already validates (`ThemeService.js:269`).
- Panel: an accordion with one group open at a time, rendering only `logo`, `colors` and `typography` from `SETTINGS_GROUPS` with a small field renderer keyed on the field types in `packages/theme/src/fields.js` (image → StoreFile picker already used by section fields; range → slider + number; select).
  - **Logo:** the image shows "Using brand logo" plus a link to Settings › Brand when empty; widths; favicon ("defaults to square logo").
  - **Colors:** a scheme list with add/duplicate/remove (removal blocked when in use; surface the backend error). Three colors per scheme only — background, text, accent (owner decision 2026-10-10; text on accent is derived, older slots dropped) — each `auto` / `brand` / `brand-secondary` (accent) / hex, with a contrast warning via `evaluateBrandColor`.
  - **Typography:** one font family for the whole theme (owner decision 2026-10-10: no heading/body split, sizes, case or spacing; theme settings stay simple).
  - Each group has "Reset to theme defaults".
- Typography CSS: `settingsVars` sets `--theme-font`; one rule on the theme scope sets `font-family`, inherited by the header, sections and footer. Legacy heading/body keys fold into `font` (`normalizeTypography`).
- Fonts: one `frontend/src/theme/fonts.ts` that declares the 11 non-system `FONTS` with `next/font/google` (`preload: false`, `display: 'swap'`, a `variable` each), matching the existing `Inter` usage in `app/layout.tsx`. Map the font key → CSS variable; `ThemeScope` applies only the chosen font's class.
- Live preview: the canvas `ThemeScope` reads `root.props.themeSettings`, so edits restyle at once.

**Tests:**
- Vitest for the settings→CSS var mapping and the field renderer.
- Playwright `admin-theme-settings.spec.ts`: open the gear, change the heading font and a scheme accent, Save sends `settings`, undo reverts.
- Contract test: save with an invalid scheme accent → 400.

## Order and docs
Order: A → B → C. A and C are independent and can run in parallel worktrees; B needs A's columns.

Docs:
- Write the spec at `specs/049-brand-and-theme-settings/plan.md`.
- Mark spec 038 D16 superseded and 038F partially delivered (F1 identity/colors/type).
- Update `docs/wiki/features/organization-branding.md`.
- Add a "Theme settings" section to `theme-sections.md`.
- Run `/doc-feature` per card.
- Add a gotcha line to AGENTS.md: brand = org identity (email, non-theme pages); theme settings override it; empty = inherit.

## Verification
- `cd backend && npm test` (contract + unit), `cd frontend && npx tsc --noEmit -p . && npm run test:unit`, plus the Playwright specs above with `PLAYWRIGHT_PORT`.
- Manual, in the dev app with an org that has a MAIN theme:
  1. Set the slogan, socials, secondary color and square logo in Settings › Brand. The footer and favicon show them.
  2. Override the slogan in the theme's `settings.json`; the theme value wins.
  3. In the editor gear panel, change the font and a scheme accent to `brand-secondary`. The preview restyles, Save persists it, and the live storefront matches.
- Migration dry run on a prod snapshot: RRG socials copied to the org and the footer unchanged.
- After deploy: `railway deployment list`, then check the RRG footer, favicon and fonts in prod.

## Card A — as built
- Migration `20261031110000_org_brand_identity`: six `Organization` columns plus the one-time copy from each MAIN theme (`settings.brand.headline` → `slogan`, `.description` → `shortDescription`, https `settings.social` → `socialLinks`), only into empty columns. Theme values stay in place. The copy is asserted by `backend/tests/contract/orgBrandIdentityMigration.test.js`, which runs the migration's own `WITH main AS …` statement.
- The square logo is stored as the lazy `square` image variant (512 × 512 cover crop, `ImageService`), warmed by the upload route so a public bucket has it too. `squareLogoUrl` points at it.
- `socialLinks` reuses `checkFields(SETTINGS_GROUPS.social.fields, …)`; blank entries are dropped and an empty object is stored as `NULL`.
- Public identity payloads (`getPublicOrganization`, `publicOrganizationIdentity`) carry `squareLogoUrl`, `brandSecondaryColor`, `slogan`, `shortDescription`, `socialLinks` (`BRAND_IDENTITY_SELECT`). Nothing renders them yet: card B does.
- Admin: Settings › General › **Store assets** › Brand → `/admin/settings/brand` (four cards, each a partial PATCH). Online store (legacy) keeps name + handle; Preferences and the legacy page link to Settings › Brand (`BrandSettingsLink`). Setup guide "design" → `/admin/settings/brand`.
