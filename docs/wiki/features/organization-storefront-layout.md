# Organization Storefront Layout

**Status:** Implemented
**Last Updated:** 2026-09-25

## Overview

`/organizations/[orgId]` is the public storefront home. It stacks three bands top to bottom at every viewport width: the shared organization header, a bounded full-bleed cover image, then the upcoming-events grid inside a `max-w-7xl` container. The grid is one column on phones, two from `sm`, three from `xl`, which matches how `/events` and `/venues/[venueId]` already render `EventCard`.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/app/organizations/[orgId]/OrganizationStorefront.tsx` | Client half of the page: fetch, loading skeleton, error and empty states, hero band, events grid |
| `frontend/src/app/organizations/[orgId]/page.tsx` | Server half: `generateMetadata`, slug redirect |
| `frontend/src/components/EventCard.tsx` | One event; full-height flex column with the CTA pinned to the bottom |
| `frontend/src/components/OrganizationHeader.tsx` | Shared identity strip (see [Organization Logo Header](organization-logo-box.md)) |
| `frontend/src/components/storefront/StorefrontNav.tsx` | Main menu: desktop row, mobile drawer |
| `frontend/src/components/storefront/StorefrontFooter.tsx` | Footer menu columns |
| `frontend/src/components/BrandScope.tsx` | Applies brand colour and theme mode to the whole page |

## How It Works

### Band heights

The cover is a single `<img>` in a fixed-height band that steps up with the viewport, rather than a fixed aspect ratio:

| Breakpoint | Class | Height |
|---|---|---|
| base | `h-56` | 224px |
| `sm` (640) | `sm:h-64` | 256px |
| `md` (768) | `md:h-72` | 288px |
| `lg` (1024) | `lg:h-80` | 320px |
| `xl` (1280) | `xl:h-96` | 384px |

A fixed ratio is what made tablets bad: 16:9 at 834px is 469px of cover, which with the 170px header left no event above the fold. Bounded heights keep the brand impact on a wide screen without letting the cover grow without limit on a mid-size one.

### Document outline

`h1` is the organization name in the header. The events region is a `<section aria-labelledby="upcoming-events">` whose `h2` is "Upcoming events"; each `EventCard` name is an `h3`. Without that `h2` the outline jumped `h1` → `h3`.

### Card alignment

`EventCard` is `flex h-full flex-col` with a `mt-auto` block holding price, status and CTA. Every card in a grid row therefore ends at the same baseline. Sold-out events render a muted `View Details` in the same slot instead of omitting the CTA, which previously left ragged rows.

### States

| State | Render |
|---|---|
| `loading` | Skeleton shaped like the real page (header bar, cover band, three card placeholders) with `aria-busy` and an `sr-only` status line |
| `error` / no data | Centred "Organization Not Found" card |
| `locked` | `StorefrontPasswordGate` (see [Online Store Preferences](online-store-preferences.md)) |
| `events: []` | Dashed-border empty card: "No upcoming events" |

## Gotchas

- **The cover renders once.** An earlier version had a `xl:hidden` mobile `<img>` plus a desktop one for the same URL, so browsers fetched the cover twice. Keep it to one element.
- **`max-w-7xl` is shared.** `OrganizationHeader`, the events `<main>` and `StorefrontFooter` all use it. Change one and the logo stops lining up with the first card.
- **Tap targets.** Footer rows are `min-h-[2.25rem]`, the sign-in link and card CTA `min-h-[2.75rem]`, the mobile hamburger and drawer chevrons `h-11 w-11`. These are load-bearing on phones; do not collapse them back to bare text.
- **`EventCard` is shared.** `/events` and `/venues/[venueId]` render the same component in their own grids — check all three pages when changing it.
- **Card strings are asserted in e2e.** `View Details & Purchase`, `View Details & RSVP`, `N tickets available` and the `event-card-*` test ids are matched by `admin-branding-color.spec.ts` and `public-venue.spec.ts`.

## Related Features

- [Organization Logo Header](organization-logo-box.md) — the header band and `LogoBox`
- [Organization Branding](organization-branding.md) — cover upload, brand colour
- [Organization Theme Mode](organization-theme-mode.md) — `BrandScope` forcing light/dark
