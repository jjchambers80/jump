---
type: research
title: Automatic event time zones — should the wizard hide the zone?
status: reference
created: 2026-10-18
updated: 2026-10-18
project: jump
tags: [jump, research, time-zones, event-wizard, venues, spec-033, spec-050, ux]
source: Jump code at main 6e368776; docs/wiki/features/venue-time-zones.md; vendor help docs and RFCs linked inline
---

# Automatic event time zones

**Question (product owner).** "Organizers should not have to think about time zones. Set it automatically in the background from the event's location. Do you recommend this? Research any business downsides."

**Context.** The wizard's "When is it?" step shows a grey line, "Time zone: EDT, New York (GMT-04:00)", above **Starts**. Under the input a helper reads "Sat, Oct 31, 2026 · 12:27 PM EDT at the venue". The question is whether to remove that line and resolve the zone silently.

**Short answer.** Jump already does the automatic part. The organizer never picks a zone on a normal US address (spec 033). Keep that. **Do not remove the zone from view.** Make it quieter: one line instead of a grey box, with the zone shown only once (the helper under the input). Make it loud only when the zone is uncertain or was never resolved. The real gap is not that the zone is visible. It is that the wizard's address path (Venues off) can silently save a **wrong or default** zone, with no way to see that it is uncertain or to correct it (§1.4).

## 1. What Jump does today

### 1.1 The zone comes from the venue, never from the organizer

- Every event has a venue: `Event.venueId` is required (`packages/db/prisma/schema.prisma:942`). `Venue.timezone` defaults to `America/New_York`, and `Venue.timezoneSource` (`DERIVED` / `MANUAL` / `DEFAULT`) records where the value came from (`schema.prisma:812-816`).
- `VenueService._resolveTimeZone` follows a fixed order: an explicit zone is `MANUAL`. Otherwise the address is run through `resolveVenueTimeZone` and the result is `DERIVED`. Failing both, the venue gets `defaultTimeZoneFor()` and `DEFAULT` (`backend/src/services/VenueService.js:35-46`). Today `defaultTimeZoneFor` always returns Eastern, because `Organization.timezone` (spec 021) has not been built (`VenueService.js:15-25`).
- An address edit re-derives the zone unless the venue is `MANUAL`. `timezone: null` clears an override (`VenueService.js:283-307`).

### 1.2 The resolver is US-only and table-based

`resolveVenueTimeZone` (`backend/src/utils/usTimeZones.js:160-203`, mirrored in `frontend/src/lib/usTimeZones.ts`):

| Input | Result |
|---|---|
| `country` other than US | `null`, reason `NON_US`: "Deliberately no worldwide resolver" (`usTimeZones.js:172-175`) |
| ZIP prefix in the override table | That zone. Not confident if the prefix straddles a line, or if it contradicts a single-zone state (`usTimeZones.js:181-192`) |
| State in the table (50 states, DC, PR, VI, GU…) | The state's zone. **Not confident** for split states AK, AZ, FL, ID, IN, KS, KY, MI, NE, ND, NV, OR, SD, TN, TX (`usTimeZones.js:29-53, 194-200`) |
| Nothing usable | `null`, reason `UNKNOWN` → the venue gets `DEFAULT` = Eastern (`usTimeZones.js:202`) |

The table covers the known edge cases. Arizona is `America/Phoenix` (no DST) but the Navajo Nation (ZIP prefix 865) is Mountain with DST (`usTimeZones.js:22, 132-133`). Indiana's Central corners have ZIP overrides (`usTimeZones.js:75-78`). Adak, Alaska is flagged as spanning (`usTimeZones.js:137`). Michigan's Upper Peninsula deliberately has no override, so it is not confident and the organizer has to confirm. The wiki gives the reason: "a silently wrong zone prints a wrong time on a ticket and someone misses a show" (`docs/wiki/features/venue-time-zones.md`, "Why a table and not a ZIP database").

### 1.3 Where the organizer sees it

| Surface | What it shows | Can confirm / override? |
|---|---|---|
| Venue editor and the wizard's **Add venue** flyout (`VenueTimeZoneField`) | "Times: Eastern Time — New York · **Change**". When not confident, the picker opens with "Confirm the time zone — this address sits near a time zone line." (`frontend/src/components/VenueTimeZoneField.tsx:46-47, 84-88`; used at `VenueFlyout.tsx:235`, `app/admin/venues/VenueEditor.tsx:319`) | Yes |
| Wizard **Where is it?**, Venues on (`VenueStep`) | Hint: "Times for this event are in the venue's time zone: …" (`steps/VenueStep.tsx:95-99`) | No (read-only; the zone belongs to the venue) |
| Wizard **Where is it?**, Venues off (`LocationStep`) | "The address sets the time zone for every time on this event." Then "Times for this event are in …" (`steps/LocationStep.tsx:74, 119-121`) | **No** (§1.4) |
| Wizard **When is it?** (`DateStep`) | A grey box, "Time zone: EDT, New York (GMT-04:00)" or "choose a venue first", plus the per-field helper "… EDT at the venue" (`steps/DateStep.tsx:45-47, 70-72`) | No |
| Storefront, tickets, emails | Always the venue zone, with the abbreviation always shown (CLAUDE.md gotcha 28) | n/a |

The wizard cannot reach the date step without a venue. `validateDates` sends the organizer back with "Add where it happens first: the time is entered in its time zone" (`frontend/src/components/event-setup/steps.ts:137-139`). The `datetime-local` value is converted with the venue's zone (`steps.ts:122-125`, `useSetupFlow.ts:67-69`). Changing the venue keeps the wall-clock time the organizer typed and moves it to the new zone (`steps.ts:185-194`).

### 1.4 Gaps found while tracing (these matter more than the visible line)

1. **The Venues-off address path never shows uncertainty.** `LocationStep` posts to `POST …/venues/from-address` (`steps/LocationStep.tsx:50-56` → `backend/src/api/routes/venues.js:52-64` → `VenueService.venueForAddress`, `VenueService.js:89-108`). It never runs `VenueTimeZoneField`, so a split-state or straddling ZIP (Michigan UP, El Paso, the Florida panhandle, Navajo Nation) is saved as `DERIVED` with the majority zone and **no confirm prompt**. City, state and ZIP are all optional (`LocationStep.tsx:51-56`). An address with no state and no ZIP resolves `UNKNOWN` and silently becomes Eastern (`DEFAULT`). In this mode the venue editor is hidden too (Venues off), so the organizer has nowhere to correct the zone.
2. **The wizard cannot tell a guessed zone from a confirmed one.** `SetupVenue` carries only `timezone` (`steps/types.ts:4-11`). `zoneText` prints "Venue time zone not set" only when `timezone` is empty (`steps/VenueStep.tsx:21-25`), and the column is never empty (default `America/New_York`). So a `DEFAULT` venue reads exactly like a verified one: "Time zone: EDT, New York".
3. **Non-US addresses.** The resolver declines (`NON_US`), and the venue falls back to Eastern unless the organizer opens **Change** in the venue editor. The wizard's address form has a US `StateSelect` and sends no `country` (`LocationStep.tsx:142`), so a Toronto or London event entered there is stored as Eastern without any warning.
4. **Online events do not exist as a concept.** There is no online/virtual field in the schema (only "Online store" matches in `schema.prisma`), and every event needs a venue. So an online event today has to borrow a physical venue's zone. This matters for §2: every major platform treats online events differently.
5. **Registration events (spec 057)** use the same venue and date steps (`steps.ts:185-200`, `visible: always`). When one is linked to a live event before its row exists, it inherits that event's venue and date, with the date converted in the inherited venue's zone (`steps/LinkedEventField.tsx:40-54`). Same rules, same gaps.
6. **A wrong zone also breaks door entry.** Redemption refuses a `VALID` ticket once `event.date < now`, with 410 "Ticket has expired (event has passed)" (`backend/src/services/TicketService.js:472-482`; the same check runs in lookups at `:202`, `:286`, `:344`, `:591`). If the zone is one hour too far east (Eastern saved for a Central venue), tickets expire **an hour before the real start**, and the scanner turns people away at the door. Separately, expiring tickets at the *start* time rather than the end looks strict for late arrivals; it deserves its own check.
7. **`.ics` and reporting.** The RSVP calendar attachment writes `DTSTART` in UTC (`backend/src/services/EmailService.js:265-267, 1137-1141`). That is RFC 5545 form 2 (absolute time), which is correct, but it faithfully passes on whatever instant a wrong zone produced. Application payment deadlines use a hardcoded Eastern `DUE_ZONE` until spec 021 lands (`backend/src/services/applicationSelection.js:19-21`).

## 2. How other platforms handle it

| Platform | Derives from location? | Shows the zone to the organizer? | Organizer override? | Online events |
|---|---|---|---|---|
| **Luma** | Yes. In-person times use "the event location's timezone, which is set automatically" | Yes. Lists show "both the event's original time and your local time in parentheses when they differ" | **No**: "can't be changed manually" | Shown "in your timezone"; emails convert per guest ([Luma: Understanding timezones](https://help.luma.com/p/understanding-timezones)) |
| **Eventbrite** | Defaults from the venue settings | Under **Date and time › More options** | Yes, per event ([Eventbrite: Change your event's date and time](https://www.eventbrite.com/help/en-us/articles/764490/how-to-change-the-event-date-and-time/); page returned 403 to the fetcher, so this is the search-indexed text) | Attendees "see the time of your event in their timezone" ([Eventbrite: Set up an online-only event](https://www.eventbrite.com/help/en-us/articles/337081/how-to-set-up-an-online-only-event/)) |
| **Eventbrite API** | n/a | `start.timezone` / `end.timezone` (IANA) are **required** alongside the `utc` instant | Yes | Same fields ([Eventbrite: Creating an event](https://www.eventbrite.com/platform/docs/create-events)) |
| **Universe (Ticketmaster)** | "Timezone defaults based on the address of your event" | Listing Timezone shown in reports | Yes, but **"Once a ticket has been sold, you cannot change the timezone"** ([Universe: Change the location, date and/or time](https://support.universe.com/hc/en-us/articles/360002015971-Change-the-location-date-and-or-time-of-your-event); [Create a timed-entry event](https://support.universe.com/hc/en-us/articles/4419292112397-Create-a-Timed-Entry-Event); both 403 to the fetcher, search-indexed text) | n/a |
| **Ticketmaster Discovery API** | Venue-level `timezone` (e.g. `America/Los_Angeles`) | n/a | n/a | n/a ([Discovery API v2](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)) |
| **DICE** | Venue records carry a timezone | Start and end times always shown to fans | Not documented | Streamed events are sometimes listed at several times; "the timezone stated in the event description" is fixed ([DICE: How to view the event times](https://dicefm.zendesk.com/hc/en-gb/articles/36839407078673-How-to-view-the-event-times), search-indexed text) |
| **Meetup** | In person: "the time zone that the event happens in" | Yes | n/a | Online: the *viewer's* zone. Their research found "over 50% of participants didn't look at the time zone and got the actual start time wrong" ([Meetup engineering: Meetup On Time](https://medium.com/making-meetup/meetup-on-time-f216ea9642b0), 403 to the fetcher, search-indexed text) |
| **Zoom webinars** | No. "Zoom will use the time zone that you set in your Profile" | Yes, a dropdown | Yes ([Zoom: Scheduling a webinar](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060481)) | The whole product is online |
| **Google Calendar** | No. The event defaults to your calendar's zone | **Time zone** link next to the time | Yes, including separate start/end zones ([Google Calendar Help 37064](https://support.google.com/calendar/answer/37064)) | n/a |
| **Shopify event apps** | Not verified. No first-party Shopify events feature; the third-party apps (e.g. Evey) do not document zone behaviour in public help | — | — | — |

**The pattern.** Every ticketing platform derives the zone from the venue. None asks for it up front. None hides it entirely either: the zone stays printed next to the time. Luma goes furthest toward "silent" (no override at all), but it geocodes a full map address and still shows the zone. Universe adds a guardrail Jump lacks: the zone locks once tickets have sold. Online events are the exception everywhere: they are shown in the viewer's zone.

## 3. Business downsides of fully silent derivation

1. **A wrong zone costs money and goodwill, and it is invisible until doors.** The cases are real: split states and ZIPs (§1.2), the Venues-off path that skips confirmation (§1.4.1), an empty state/ZIP that falls back to Eastern (§1.4.2), non-US addresses (§1.4.3). A wrong zone moves the instant used everywhere: storefront, ticket, confirmation email, `.ics` (`EmailService.js:1140`), sale windows and ticket expiry. With expiry at the start time (`TicketService.js:472-482`), a zone that is too far east turns valid buyers away at the scanner. The cost is refunds (`RefundService.refundOrder`; staff refunds skip the refund policy, gotcha 23), chargebacks (spec 037 disputes land on the organizer's connected account under spec 047), support tickets and a lost organizer. Seeing "CDT" next to the time is the cheapest check there is: it catches the mistake before the first sale. Spec 033 made the same call: "A visible question beats false precision" (`docs/wiki/features/venue-time-zones.md`).
2. **The organizer stops trusting a time they cannot verify.** A touring promoter in New York booking a Denver room types "8:00 PM". Without the zone on screen they cannot tell whether Jump took that as 8 PM Mountain or 8 PM Eastern. This exact bug existed before spec 033: "A Denver 8:00 PM show entered by a New York organizer was stored as … 6pm MDT" (wiki, "The bug this fixed"). Hiding the zone brings that doubt back, even though the code is now correct. Meetup's finding (>50% of people misread a time when they ignore its zone) is why the label should stay next to the number.
3. **Online and hybrid events have no right answer from an address.** There is no online-event concept (§1.4.4). An organizer running a livestream picks *some* venue, and its zone silently becomes the event's. Luma, Eventbrite and Meetup all show online events in the viewer's zone. Silent derivation hides the one choice that matters here.
4. **Moving the venue silently moves the instant.** Changing the venue keeps the typed wall-clock time and moves it to the new zone (`steps.ts:185-194`). The wizard warns only on PUBLISHED events (`VenueStep.tsx:107-111`, `LocationStep.tsx:76-80`). If the zone is hidden, buyers who already hold tickets see the start time shift by an hour or more with no visible cause. Universe forbids that change once tickets have sold.
5. **Zones change by decree.** The IANA database says "current predictions will be incorrect after future governments change the rules" and "Timezone boundaries are not part of the stable interface" ([IANA tz: Theory and pragmatics](https://data.iana.org/time-zones/theory.html)). A ZIP→zone table goes stale too (US DST legislation is periodically proposed). A visible zone means the organizer sees the change; a silent one does not.
6. **The day boundary is a different zone and remains unsolved.** Reports and application due dates run on Eastern until `Organization.timezone` exists (`applicationSelection.js:19-21`; wiki, "Three zones, three jobs"). That is a separate field and does not belong in the event wizard, but a silent event zone makes it harder to explain why a Pacific organizer's "due Oct 6" behaves on Eastern.
7. **What hiding it saves is small.** Organizers do not *enter* a zone today. Removing the line saves reading one line, and the price is losing the main mistake check. Fewer things to read on a step is a real gain only if the line is noisy, which is the case for a box shown even when nothing is uncertain.

**Calendar invites (RFC 5545).** A `DATE-TIME` without `Z` or `TZID` is "floating" and is read in each recipient's own zone ([RFC 5545 §3.3.5](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.5)). Jump uses UTC (`Z`), which is correct as long as the stored instant is correct. Do not switch to floating times to "avoid" zones.

## 4. Recommendation

**Keep automatic derivation. Do not hide the zone. Make it quiet when the zone is certain and loud when it is not.** Fix the places where Jump is silently *wrong* today before any change to the copy.

### 4.1 "When is it?" step, concrete UI

- **Remove the grey "Time zone: …" box** (`DateStep.tsx:70-72`). It repeats the helper under each input.
- **Keep the helper under each time field**, exactly as today: "Sat, Oct 31, 2026 · 12:27 PM EDT at the venue" (`DateStep.tsx:45-47`). That is the one place the zone has to be, next to the number. Optionally add the city: "… 12:27 PM EDT (New York time)".
- **Add a second line only when the organizer's browser zone differs** (`Intl.DateTimeFormat().resolvedOptions().timeZone`), e.g. "That's 11:27 AM your time (CDT)". This is the touring-promoter check. Luma does the same for viewers (§2). A same-zone organizer sees nothing extra.
- **Turn it loud when the zone is uncertain**: the venue is `DEFAULT`, or `DERIVED` from a not-confident resolution. Show an amber note above Starts, "We couldn't confirm this venue's time zone. Check it before you sell tickets.", with a **Change** link (the existing `VenueTimeZoneField`/`TimeZoneSelect`). This requires sending `timezoneSource` (and the confidence) with `SetupVenue` (§1.4.2).

### 4.2 Where is it? step (the real fixes)

1. Run the same confirm flow on `LocationStep` (the Venues-off address path). Use `VenueTimeZoneField`, or call `resolveVenueTimeZone` client-side and open the picker when it is not confident. Send `timezone` when the organizer picks one (it becomes `MANUAL`).
2. Require state or ZIP on that path, or treat a `DEFAULT` result as uncertain (above), so that a blank address can no longer silently become Eastern.
3. Decide on non-US events: either refuse them in the wizard for now (honest), or add a country field plus an explicit zone picker. A geocoder such as the Google Time Zone API (lat/lng + timestamp → `timeZoneId`, [docs](https://developers.google.com/maps/documentation/timezone/overview)) would be needed for a worldwide automatic result. Spec 033 rejected a runtime API call for the US on cost, latency and failure modes (wiki); that holds until international demand exists.

### 4.3 Guardrails (cheap, high value)

- **Once tickets have sold, warn hard on any change that moves the instant** (a venue change into a different zone, or a zone override): "N ticket holders will see the start move from 8:00 PM EDT to 7:00 PM CDT." Today only a soft PUBLISHED warning exists. Universe goes further and blocks it.
- **Review step**: show "Starts Sat Oct 31, 8:00 PM CDT (Chicago)" in the readiness summary, so the publish moment is the last check.
- **Online events**, when built: no venue zone. Store an organizer zone and render in the viewer's zone (Luma, Eventbrite, Meetup pattern).

### 4.4 What I would not do

- Remove the zone everywhere and rely on silent derivation. The downside (a missed show, refunds, a chargeback) is large and rare. The upside (one fewer line to read) is small and constant.
- Show the zone only when it differs from the organizer's browser. The organizer wouldn't see the zone when the *derivation* is wrong but happens to match their own zone (e.g. a Navajo Nation venue entered from Phoenix in summer). Use the browser comparison only for the extra "your time" line, not to decide whether the venue zone is shown at all.

## 5. Sources

**Jump.** `frontend/src/components/event-setup/steps/DateStep.tsx`, `steps/VenueStep.tsx`, `steps/LocationStep.tsx`, `steps/LinkedEventField.tsx`, `steps/types.ts`, `steps.ts`, `useSetupFlow.ts`; `frontend/src/components/VenueTimeZoneField.tsx`; `backend/src/services/VenueService.js`; `backend/src/utils/usTimeZones.js`; `backend/src/api/routes/venues.js`; `backend/src/services/TicketService.js`; `backend/src/services/EmailService.js`; `backend/src/services/applicationSelection.js`; `packages/db/prisma/schema.prisma`; `docs/wiki/features/venue-time-zones.md`; CLAUDE.md gotcha 28.

**External.** [Luma: Understanding timezones](https://help.luma.com/p/understanding-timezones) · [Eventbrite: Change your event's date and time](https://www.eventbrite.com/help/en-us/articles/764490/how-to-change-the-event-date-and-time/) · [Eventbrite: Online-only event](https://www.eventbrite.com/help/en-us/articles/337081/how-to-set-up-an-online-only-event/) · [Eventbrite API: Creating an event](https://www.eventbrite.com/platform/docs/create-events) · [Universe: Change location/date/time](https://support.universe.com/hc/en-us/articles/360002015971-Change-the-location-date-and-or-time-of-your-event) · [Universe: Timed-entry event](https://support.universe.com/hc/en-us/articles/4419292112397-Create-a-Timed-Entry-Event) · [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/) · [DICE: Event times](https://dicefm.zendesk.com/hc/en-gb/articles/36839407078673-How-to-view-the-event-times) · [Meetup On Time](https://medium.com/making-meetup/meetup-on-time-f216ea9642b0) · [Zoom: Scheduling a webinar](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060481) · [Google Calendar Help 37064](https://support.google.com/calendar/answer/37064) · [RFC 5545 §3.3.5](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.5) · [IANA tz theory](https://data.iana.org/time-zones/theory.html) · [Google Time Zone API](https://developers.google.com/maps/documentation/timezone/overview).

Pages marked "403 to the fetcher" could not be fetched directly. Their claims come from the search engine's indexed text of that page. Re-check them before quoting externally.
