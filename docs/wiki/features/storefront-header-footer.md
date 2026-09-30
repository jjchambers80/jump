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

`layout="bar"` is the header on pages built around a floor map (today `/events/:id/map`), modelled on Ticketmaster's seat-map header. It is full width (no `max-w-7xl`), one `min-h-14` row with a bottom border: menu button (always, all widths; `StorefrontNav variant="mobile" side="left"`), then the organization identity flush left (logo sized by height, 36 / 44 px, `LogoBox fit="height"`), then Sign in / Account flush right. The optional `subheader` row sits under it, aligned with the menu icon. Unlike the standard header it has a surface (`bg-white` / `dark:bg-slate-950`) and a bottom border, so it reads as one band over the map. The drawer slides in from the left in 200 ms (`motion-safe`). It reuses the skip link, sign-in link, menus and drawer of the standard layout, so the accessibility rules below apply unchanged. See [Public floor map](public-floor-map.md).

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
