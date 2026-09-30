# Storefront Header and Footer

**Status:** Implemented
**Last Updated:** 2026-09-26

## Overview

The public storefront chrome (`OrganizationHeader` and `StorefrontFooter`) is minimal: neither has a background colour or a border of its own. Both sit on the page surface set by `BrandScope` (`bg-gray-50` / `dark:bg-slate-900`) and are separated from the content by whitespace only. The layout is mobile-first and meets WCAG 2.2 AA: a skip link, 44 × 44 px touch targets, visible `focus-visible` rings in the brand colour, a focus-trapped menu drawer and `prefers-reduced-motion` respected on every transition.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/OrganizationHeader.tsx` | One-row header: identity (logo, or the name when there is no logo) left; main menu, sign-in and menu button right. Skip link |
| `frontend/src/components/storefront/StorefrontNav.tsx` | Desktop menu row with dropdowns; mobile drawer (right side, modal, Tab trap) |
| `frontend/src/components/storefront/StorefrontFooter.tsx` | Footer menu: grouped columns, then one row with `© year name` and the plain links |
| `frontend/src/components/storefront/StorefrontShell.tsx`, `frontend/src/app/organizations/[orgId]/OrganizationStorefront.tsx` | Loading skeletons mirror the new header (no white bar) |
| `frontend/e2e/public-nav.spec.ts` | Playwright: no background/border, skip link, drawer focus trap + focus return, 44 px menu button |
| `frontend/e2e/public-org-logo.spec.ts` | Playwright: logo box sizes (90 px mobile / 120 px desktop) |
| `frontend/e2e/storefront-themed.spec.ts` (themed event page) | Playwright: the event page sits in the theme frame; logo and header height equal the home page's at 390 and 1440 px |

## How It Works

### Header layout

| Breakpoint | Left | Right |
|------------|------|-------|
| < `sm` | logo (`--theme-logo-width-mobile`, default 90 px), or name without a logo | person icon (label is `sr-only`), hamburger |
| `sm`–`md` | logo (`--theme-logo-width`, default 120 px), or name | "Sign in" / "Account" with icon, hamburger |
| ≥ `md` | logo, or name | main menu inline, then "Sign in" / "Account" |

With a logo the name is `sr-only`: the logo alone is painted, while the `<h1>` and the link's accessible name keep the organization name. Without a logo the name is the visible identity. The name is the page `<h1>` on the organization page (`as="h1"`) and a link to the organization page elsewhere; both are `text-xl sm:text-2xl`.

**One header on every page.** Logo size, name size and padding never depend on the page. The logo width is `var(--theme-logo-width-mobile, 90px)` / `var(--theme-logo-width, 120px)`: inside a theme frame the org's Logo settings apply, anywhere else the same defaults (`packages/theme/src/settings.js`). For themed organizations the event page (tickets and RSVP) is framed by the theme like home, events, pages and blog: `app/events/[eventId]/page.tsx` reads `organizationId` from `GET /events/:id/meta`, calls `loadStorefrontFrame(orgId, 'frame')` and renders `EventDetailClient chrome={false}` inside `ThemedStorefront`. Legacy and locked stores keep the client page with its own header.

**Current page.** `currentMenuPath` (`lib/menus.ts`) picks one menu path: an exact match, else the longest item path the URL sits under. Only that item gets `aria-current="page"` (brand link colour and an underline, so the state never depends on colour alone). Before this, Home — the org root — was also "current" on every page under it, so Home and Events were both underlined on `/events`.

### Bar layout (map pages)

`layout="bar"` is row 1 of `EventMapHeader` (`components/storefront/EventMapHeader.tsx`), the header of every page built around a floor map (the public map and the spot chooser), modelled on Ticketmaster's seat-map header: **one dark band** (the event poster blurred under a dark scrim, `.dark` scope, brand rule at the bottom) holding two rows on the same background. Row 1 is `OrganizationHeader layout="bar"`: the menu button at the far left (drawer from the left, every width, no inline menu), the logo flush left beside it (sized by height, 36 / 44 px, `LogoBox fit="height"`: the one exception to the header's single logo size), the account link (icon, label from `sm`) flush right. Row 2 is the event row: a round back button to the event page directly under the menu button, the date tile, the page title as the only `h1` ("Floor map", "Your application"), the event name, then date · time (venue zone, spec 033) · venue. The bar itself is transparent: `EventMapHeader` owns the background, and its `.dark` scope makes the bar's text, icons and drawer read on it; focus rings are white in the bar. The subheader row uses the bar's gutter (`px-2 sm:px-4`), so the back button sits exactly under the menu button. The drawer slides in from the left in 200 ms (`motion-safe`). It reuses the skip link, sign-in link, menus and drawer of the standard layout, so the accessibility rules below apply unchanged. See [Public floor map](public-floor-map.md) and [Spot chooser](spot-chooser.md).

### Skip link

The first focusable element in the header is **Skip to content**, visually hidden until focused. It moves focus to the header's next sibling element (adding `tabindex="-1"` if needed), so no page needs a shared `#main` id.

### Drawer (below `md`)

`role="dialog"` + `aria-modal`, opens from the right edge next to the menu button. Focus moves to **Close menu**; Tab and Shift+Tab wrap inside the drawer; Escape or the scrim closes it and focus returns to **Open menu**. Rows are at least 48 px tall; the accordion toggles are 44 px.

### Footer

Top-level footer items with children become columns (2 on mobile, 3 from `sm`, 4 from `lg`). Plain top-level items sit on the bottom row beside the copyright line. Links are 44 px tall on touch widths and compact from `sm`. The footer still renders nothing when the footer menu is empty.

## Gotchas

- **No surface of its own.** Do not add `bg-*` or `border-*` to the header or footer; `public-nav.spec.ts` asserts a transparent background and zero border width. Popovers (the dropdown panel, the drawer) keep their own surface because they overlay content.
- **Touch targets.** Keep `min-h-11` on header controls and footer links; WCAG 2.5.8 needs 24 px, the storefront targets 44 px.
- **Sign-in text.** The label is `sr-only sm:not-sr-only`, one span, so `toHaveText('Account')` keeps working and the accessible name matches the visible label from `sm` up.
- **Brand colours.** Active and hover states use `brand-link`; focus rings use `ring-brand`. Never hardcode a colour in the header or footer (Gotcha 6 in `AGENTS.md`).

## Related Features

- [Organization Logo Header](organization-logo-box.md) — `LogoBox` fitting and where the header renders
- [Content › Menus](menus.md) — the Main and Footer menus rendered here
- [Customer Accounts Settings](customer-accounts-settings.md) — the sign-in link toggle
- [Organization Theme Mode](organization-theme-mode.md) — the `BrandScope` surface both sit on
