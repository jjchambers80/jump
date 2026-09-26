# Event Editor (Admin)

**Status**: Implemented
**Last Updated**: 2026-09-25

## Overview
The admin event create and edit pages (`/admin/events/new`, `/admin/events/:eventId/edit`) share one two-column layout: content on the left, event settings in the right-hand aside. The edit page (redesigned in PR #196) is laid out like a run sheet. It is titled by the event itself, numbers its sections, and opens the aside with a ticket-stub summary: the event as buyers will meet it, and how its capacity splits across tiers. A save card stays pinned to the bottom of the screen and tracks unsaved changes.

## Key Files
| File | Purpose |
|------|---------|
| `frontend/src/components/events/EventFormLayout.tsx` | Shared shell (`EventFormShell`, 8/4 grid, flex-column aside, mobile sticky save bar), `EventFormHeader` (eyebrow + title + meta line), `FormCard` (numbered `step`, `id` anchor, staggered entrance), `FormPanel`, `EventFormActions`, `EventFormActionsCard` (Create page's top-pinned save card), `AdmissionModeField`, `RsvpSettingsFields`, `TierHeaderActions` |
| `frontend/src/components/events/EventEditSummary.tsx` | Edit page only: `EventEditSummary` (stub: image band, date tile, venue/time, perforation, capacity meter, tier legend, section links), `EventSaveCard` (bottom-pinned save state + actions), `EventStatusPill`, `tierAccent(index)` |
| `frontend/src/app/admin/events/[eventId]/edit/page.tsx` | Edit page: load, dirty snapshot + `beforeunload` guard, section list / step numbers, PATCH + tier create/patch/reorder on save |
| `frontend/src/app/admin/events/new/page.tsx` | Create page (same shell, no summary, no step numbers) |
| `frontend/src/components/events/EventMediaCard.tsx` | Media card (event image), optional `step` |
| `frontend/src/app/admin/events/[eventId]/edit/AddOnsSection.tsx` | Add-ons (saves through its own API immediately), optional `step` |
| `frontend/src/components/TierEditDialog.tsx` | `TierCard` (optional `accentClass`: edge strip + sold bar) and `TierEditDialog` |
| `frontend/tailwind.config.js` | `animate-card-in` keyframe |
| `frontend/e2e/admin-event-form-layout.spec.ts` | Layout, sticky save, keyboard radios, media, summary / dirty state / section jump |

## Configuration
None.

## How It Works

### Header
`EventFormHeader` takes `eyebrow`, `title` and `meta`. On the edit page the `<h1>` holds the "Edit event" eyebrow and the event's live name, so its accessible name is "Edit event Summer Music Festival" (tests match `/edit event/i`). The meta line shows `EventStatusPill`, `formatEventDateTime(instant, venueZone)` and the venue name. Event times use the venue's wall clock (spec 033).

### Numbered sections
The page builds one ordered `sections` list (main column first, then the aside). Tiers appear only for `TICKETED`. `stepOf(id)` gives each `FormCard` / `EventMediaCard` / `AddOnsSection` its `step`. The number is `aria-hidden` and never part of the region name, so `getByRole('region', { name: 'Event Details' })` still works. `FormCard` now sets `id={id}` on the `<section>` so it can be linked to.

### Summary stub (xl only)
`EventEditSummary` is read-only and derives everything from the page's form state:
- **Image band**: the event image (blurred, cover), or a striped placeholder with the event's initial.
- **Date tile**: month / day / weekday, split from `formatEventDate(instant, zone)`, so it uses the venue zone like every other event date.
- **Capacity meter** (`role="img"` with a full-sentence `aria-label`): one segment per tier, sized against `max(capacity, sum of tier quantities)`. The sold part is solid, the rest tinted, and capacity no tier holds is hatched. Tiers over capacity add a red ring and "N over capacity". RSVP events show the headcount cap instead.
- **Tier legend**: colors come from `tierAccent(index)`, which `TierCard` also uses, so a row matches its segment.
- **Section links**: `jumpTo(id)` scrolls only the nearest scrolling ancestor (the admin `<main>`), then focuses the section (`tabindex="-1"`, `outline-none`).

### Save card and unsaved changes
`EventSaveCard` is the last aside item: `xl:sticky xl:bottom-6 xl:mt-auto`. It stays pinned to the bottom of the viewport while the aside runs past the screen, and rests at the end of the column (flush with the content's end) once reached. Below `xl` it is hidden and the shell's bottom bar is the only Save button.

The dirty state is a `JSON.stringify` snapshot of every field the Save button sends (name, slug, description, venue, date, capacity, category, admission mode, RSVP settings, tiers). It is compared with the baseline taken once tiers are initialised. Media and add-ons save on their own, so they are excluded. While dirty, the card shows "Unsaved changes" (amber, `role="status"`) and a `beforeunload` listener warns before leaving.

## API Endpoints
Unchanged by the redesign. See [Event Management](event-management.md) and [Price Tiers](price-tiers.md).

## Database
None.

## Gotchas
- **Never use a plain `#anchor` or `scrollIntoView` to reach a section.** The admin frame is `h-screen overflow-hidden` with `<main>` scrolling inside it. Both scroll every ancestor, including the frame, which pushes the sidebar off screen with blank space below. Use `jumpTo` (or scroll `<main>` directly).
- **The save card is pinned to the bottom on purpose.** A tall top-pinned card covers the aside cards (Date & venue, Admission, Listing) as they scroll under it. The Create page still uses the small top-pinned `EventFormActionsCard`.
- **The aside is `flex flex-col gap-6`, not `space-y-6`.** `space-y-*` sets `margin-top` with higher specificity than `mt-auto` and would stop the save card from resting at the column's end.
- **`animate-card-in` uses `backwards` fill only.** A lingering `transform` on a card would become the containing block for fixed-position children, and `TierEditDialog` renders inside the Price Tiers card.
- The dirty baseline is taken after load. `RichTextEditor` sets content with `emitUpdate: false`, so loading a description does not mark the form dirty. Keep it that way.
- Any new aside or main section should be added to `sections` on the edit page to get a number and a jump link.

## Related Features
- [Event Management](event-management.md)
- [Price Tiers](price-tiers.md)
- [Add-ons](add-ons.md)
- [RSVP Events](rsvp-events.md)
- [Venue Time Zones](venue-time-zones.md)
- [Events List](events-list.md)
