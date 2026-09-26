# Storefront Header and Footer

**Status:** Implemented
**Last Updated:** 2026-09-26

## Overview

The public storefront chrome (`OrganizationHeader` and `StorefrontFooter`) is minimal: neither has a background colour or a border of its own. Both sit on the page surface set by `BrandScope` (`bg-gray-50` / `dark:bg-slate-900`) and are separated from the content by whitespace only. The layout is mobile-first and meets WCAG 2.2 AA: a skip link, 44 × 44 px touch targets, visible `focus-visible` rings in the brand colour, a focus-trapped menu drawer and `prefers-reduced-motion` respected on every transition.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/OrganizationHeader.tsx` | One-row header: identity (logo + name) left; main menu, sign-in and menu button right. Skip link |
| `frontend/src/components/storefront/StorefrontNav.tsx` | Desktop menu row with dropdowns; mobile drawer (right side, modal, Tab trap) |
| `frontend/src/components/storefront/StorefrontFooter.tsx` | Footer menu: grouped columns, then one row with `© year name` and the plain links |
| `frontend/src/components/storefront/StorefrontShell.tsx`, `frontend/src/app/organizations/[orgId]/OrganizationStorefront.tsx` | Loading skeletons mirror the new header (no white bar) |
| `frontend/e2e/public-nav.spec.ts` | Playwright: no background/border, skip link, drawer focus trap + focus return, 44 px menu button |
| `frontend/e2e/public-org-logo.spec.ts` | Playwright: logo box sizes (56 px mobile / 64 px desktop on the org page) |

## How It Works

### Header layout

| Breakpoint | Left | Right |
|------------|------|-------|
| < `sm` | logo (40 px, 56 px on the org page) + name | person icon (label is `sr-only`), hamburger |
| `sm`–`md` | logo (48 / 64 px) + name | "Sign in" / "Account" with icon, hamburger |
| ≥ `md` | logo + name | main menu inline, then "Sign in" / "Account" |

The name is the page `<h1>` on the organization page (`as="h1"`, `text-xl sm:text-2xl`) and a link to the organization page elsewhere (`text-base sm:text-lg`). The current page in the desktop menu is marked with `aria-current="page"`, the brand link colour and an underline, so the state never depends on colour alone.

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
