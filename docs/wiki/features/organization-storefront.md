# Organization Storefront Page

**Status**: Implemented
**Last Updated**: 2026-09-26

## Overview
`/organizations/:orgId` (or `/` on an organization's custom domain) is the store home. It shows the organization header, the cover image as a full-width band with a **Next up** overlay linking to the first event, and the upcoming events as ticket stubs grouped by month. The page was redesigned in PR #201 to match the RSVP admission pass on the event page (PR #199).

## Key Files
| File | Purpose |
|------|---------|
| `frontend/src/app/organizations/[orgId]/page.tsx` | Server component: `generateMetadata` from `/public/meta`, slug redirect, renders the client storefront |
| `frontend/src/app/organizations/[orgId]/OrganizationStorefront.tsx` | Client page: fetch, password gate, cover band + Next up, month groups, `#events` scroll, skeleton, empty and not-found states |
| `frontend/src/components/storefront/EventStub.tsx` | One event as a ticket stub: date tile, perforation, name / time / venue, price, scarcity, CTA |
| `frontend/src/lib/dateTile.ts` | `dateTile(date, zone)` → `{ weekday, month, day, year }` in the venue zone; shared with `RsvpPass` |
| `frontend/src/app/globals.css` | `.event-stub` notch mask and `.event-stub-shadow` drop-shadow / hover lift |
| `frontend/src/components/OrganizationHeader.tsx` | Shared header (`as="h1"`, `nav`, sign-in link) |
| `frontend/e2e/public-org-storefront.spec.ts` | Playwright: month grouping in the venue zone, scarcity / sold-out / RSVP stubs, Next up link, no band without cover, `#events` scroll |

## Configuration
None. Colors come from the organization's brand color via `BrandScope`. Theme mode, logo, cover and menus come from their own settings.

## How It Works
1. The page fetches `GET /organizations/:id/public`. If `locked: true`, it renders `StorefrontPasswordGate` instead (see [Online Store Preferences](online-store-preferences.md)).
2. **Cover band.** When there is a cover, it renders once, flush on mobile (16:9) and rounded inside the `max-w-7xl` column from `sm` (21:9, 5:2 at `lg`). If there are events, a gradient and a single link overlay the cover. The link reads "Next up · name · date · time" and points to the first event. On desktop it also shows a white "Get tickets" / "RSVP" pill.
3. **Month groups.** `groupByMonth` buckets events by `dateTile(event.date, venue.timezone)`, so an event at 23:30 local on Oct 31 stays in October even though it is Nov 1 in UTC. Labels drop the year for the current year ("October") and keep it otherwise ("January 2027"). Each group is a `<section aria-labelledby>` region. On `lg` the month label is a sticky left column.
4. **Stubs.** The date tile is `bg-brand text-brand-fg`, or grey when sold out. A dashed perforation sits between the tile and the details, with two notches cut by the CSS mask at `--notch-x` (the tile width). The details show category, name, time with zone abbreviation, venue, and price ("From $X" when tiers differ, "Free" for RSVP). "Only N left" appears only at ≤ 10 tickets. The CTA is "Get tickets", "RSVP", or a "Sold out" chip.
5. **Motion.** Stubs enter with `animate-card-in`, staggered 45 ms per item and capped at 8 items. Hover lifts a stub 2 px. Both respect `prefers-reduced-motion`.
6. **`#events`.** The list renders after the fetch, too late for the browser's own anchor jump. An effect scrolls `#events` into view once data arrives.
7. **Loading.** The page shows neutral skeleton stubs, because the brand color is not known until the organization loads.

## API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/organizations/:id/public` | None (storefront token if private) | Organization identity + published events (`formatEventSummary`) |
| GET | `/organizations/:id/public/meta` | None | Title / description / Open Graph image for `generateMetadata` |
| GET | `/organizations/:id/public/menus` | None | Header / footer menus |

## Database
No schema changes. Reads `Organization` branding fields and published `Event`s with their venue (`timezone`) and active `PriceTier`s. See [Database Architecture](database-architecture.md).

## Gotchas
- **The mask clips box-shadow and outlines.** Shadows live on the `.event-stub-shadow` wrapper as `filter: drop-shadow`, which follows the notched shape. The focus ring is `ring-inset` on the link. Never add an outer `shadow-*` or `outline` to `.event-stub`.
- **`--notch-x` must equal the date tile width** (`w-20` = 5rem, `sm:w-28` = 7rem). Change both together.
- **Dark-mode contrast:** `brand-link-dark` is derived against the slate-900 page, but stubs sit on slate-800. Brand-colored prices stay `text-xl font-bold`, which counts as WCAG large text (3:1). Smaller brand-link text on a stub fails axe. The header sign-in link is neutral (`dark:text-slate-100`) for the same reason.
- **Tile text has no opacity.** Faded month or weekday text on `bg-brand` fails AA for some brand colors.
- **Event dates use the venue zone** via `dateTile` / `formatEventDate` / `formatEventTime`, never the viewer's (spec 033). Never group or label with `new Date().getMonth()`.
- **Venue pages keep `EventCard`** (grid of vertical cards). `EventStub` is a horizontal row and does not fit a 3-column grid.
- **Test ids are stable:** `event-card-<id>` and `event-card-name-<id>` are on the stub, and several specs rely on them.

## Related Features
- [RSVP Events](rsvp-events.md) — the admission pass this stub mirrors
- [Organization Branding](organization-branding.md) — brand tokens and contrast
- [Organization Theme Mode](organization-theme-mode.md)
- [Organization Logo Header](organization-logo-box.md)
- [Online Store Preferences](online-store-preferences.md) — private store gate, homepage SEO
- [Content › Menus](menus.md) — header nav (an "Events" item can point at `#events`)
- [Venue Time Zones](venue-time-zones.md)
