# Registration Events

**Status**: Implemented (spec 057, PRs #480–#484)
**Last Updated**: 2026-10-18

## Overview
"Create event" is one wizard for two types. A **live event** sells tickets or takes RSVPs. A **registration event** is a page with one form that vendors, sponsors, volunteers or anyone the organizer chooses register through, free or with a fee. A registration event can be **for** a live event (the vendors of a market): it then sells spots on that event's floor map, fills its special guest lineup, and shows on its page as a Get involved pill. Application forms no longer sit on live events.

## Key Files
| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | `enum EventType { LIVE REGISTRATION }`, `Event.type`, `Event.linkedEventId` (self relation, SetNull), capacity CHECK |
| `backend/src/services/EventService.js` | `type` / `linkedEventId` on create and PATCH (`_resolveLinkedEvent`), list / summary / CSV `?type=`, `registrationCount`, `_registrationLinks` on workspace and overview |
| `backend/src/services/ApplicationFormService.js` | One form per registration event (`_assertNoForm`, 409 `FORM_EXISTS`); `publicForms` of a live event adds its published registrations' forms (each carries `eventId`) |
| `backend/src/services/EventReadinessService.js` | Registration: no ticket checks, blocker `FORM_MISSING`, the linked event's map for the map warning |
| `frontend/src/app/events/[eventId]/GetInvolved.tsx` | The live event's pill for each linked registration form: its **Button label** (Form details), else its name |
| `backend/src/services/mapEvents.js` | `mapEventIdFor` / `eventIdsForMap`: the only place that knows a registration uses its live event's map and lineup |
| `backend/src/scripts/backfill-057-registration-events.js` | Moves every form on a live event onto a linked registration event |
| `frontend/src/components/event-setup/steps.ts` | `type` step, `registration` slot, `wizardProgress`, `registrationFlowSteps` |
| `frontend/src/components/event-setup/steps/TypeStep.tsx` | Step 1, "What do you want to create?" |
| `frontend/src/components/event-setup/steps/LinkedEventField.tsx` | "Registering for" on the Name step |
| `frontend/src/components/event-setup/formFlows.ts` | The `registration` flow (Who registers? → Form details → options / payment when paid → floor map when linked → Fields) |
| `frontend/src/components/event-setup/useFormFlow.ts` | Registration: one form, the flow sits inside the event wizard; live events: no new forms, special guests = lineup only |
| `frontend/src/app/admin/events/[eventId]/page.tsx` | Registration event page; live event's Registrations card |
| `frontend/src/components/events/EventWorkspace.tsx` | Tabs per type |
| `frontend/src/components/events/EventOverviewSections.tsx` | `RegistrationsCard`, `LinkedEventCard`, `ApplicationsSection` title |
| `frontend/src/components/events/EventsToolbar.tsx`, `EventListCard.tsx` | Type filter, registration card |
| `frontend/src/app/events/[eventId]/EventRegister.tsx` | Public registration page body: the form's fields inline (`ApplySteps` + `useApplyForm`) and one sticky Register submit button, no About section. The page is a narrow column (`EventPageView`: `max-w-3xl`, not `max-w-7xl`) with a smaller title (`sm:text-4xl`) so the full-width fields keep a readable length |
| `frontend/src/components/storefront/EventStub.tsx` | Storefront list: "Registration" eyebrow, Register button |

## Configuration
None. Registration events are part of the **`events`** catalog feature; creating one needs the **`applications.forms`** action (ORGANIZER by default), the same as building any application form. The Registration card on step 1 and **Create registration event** buttons hide without it.

## How It Works

### Creating one
1. **What do you want to create?** Live event or Registration event. `/admin/events/new?type=registration&linked=<id>` (the live event's Create registration event button) preselects both. The type is browser state until the event exists and fixed after.
2. **Name**, with an optional **Category** and **Registering for** (optional live event; an empty venue and date are filled from it).
3. **Venue**, 4. **Date** — the date step creates the event (`setup: true`, `type`, `linkedEventId`, `category`) and opens **Image**.
5. **Image**. There is no **Describe it** step (PR #496): what registrants read is the form's intro on **Form details**, so the event-level description would be a second one.
6. The `registration` slot hands off to `/admin/events/<id>/setup/registration`: **Who registers?** (name + charge + which optional checkboxes the form offers, creates the form; no type to pick, the form is generic). Before the form exists, every step's preview shows the blank form it starts as: an email and the privacy consent → **Form details** → **Options and pricing** and **How registrants choose and pay** (paid only) → **Floor map** (MAP forms of a linked event; edits the live event's map) → **Fields**.
7. **Collect more** (extras like power or tables), 8. **Review** publishes the event and opens the form.

One progress bar counts all of it (`wizardProgress`): a free form reads 10 steps, a paid one 12.

### Pages
- **Admin event page** (same hero, tabs and cards as a live event): stats Registrations · To review · Approved · Collected; the Registration form card; description; Date & venue; Registering for. Tabs: Overview · Registrations · Map (the linked event's) · Door check-in · History.
- **Live event page**: a Registrations card lists its registration events with form state and a Review link, and **Create registration event**. No Add to this event tiles.
- **Events list**: Type filter (All · Live · Registration); registration cards count registrations.
- **Storefront**: listed with a Registration eyebrow and **Register**; the page is the form itself: its intro, its fields and one sticky **Register** button that submits it (no About section, no separate apply page step). A successful registration opens the status page. `/events/<id>/apply/<slug>` still works for old links. Approved registrants of a paid form choose and pay from the status page as before. A live event's Get involved pills link to the registration event's page.

### Moving existing forms (backfill)
`cd backend && npm run db:backfill:057-registration-events` (dry run) then `DRY_RUN=false …`. Per form on a non-deleted live event, in one transaction: a REGISTRATION event (form name; venue, date, image, tax rate, category from the live event; PUBLISHED when the live event is and the form is not a draft, CANCELLED with a cancelled event), then the form, its applications and their APPLICATION orders move to it. Add-ons: an application-only one that only this form offers moves; a BOTH add-on stays for tickets and is copied application-only; one shared between forms is reported and the form is left for a look. Forms on deleted events are skipped. Idempotent; runs as the audited system job `backfill:057`.

## API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/organizations/:orgId/events` | Organizer (+ `applications.forms` for REGISTRATION) | `type`, `linkedEventId` (LIVE event of the org) |
| PATCH | `/organizations/:orgId/events/:id` | Organizer | `linkedEventId` (registration only); `type` and admission fields refused on a registration |
| GET | `/organizations/:orgId/events?type=` | Organizer | Filter; registration rows carry `registrationCount { total, toReview }` (also `summary`, `export.csv`) |
| GET | `/organizations/:orgId/events/:id/workspace`, `/overview` | Organizer | `type`, `linkedEvent`, `registrations[]` |
| GET | `/events/:id/applications/forms` | Public | A live event also returns its published registrations' forms (`eventId` on each) |
| GET | `/events/:id/map` | Public | A registration event answers with its live event's map |

## Database
`Event.type` (`EventType`, default LIVE), `Event.linkedEventId` (index, SetNull). `Event_capacity_draft_check` allows null capacity on REGISTRATION events. Migration `20261118120000_registration_events`. A registration event keeps `admissionMode = TICKETED`, no tiers and null capacity. See [Database Architecture](database-architecture.md).

## Gotchas
- **Branch on `type` first, then `admissionMode`** — and only for live events. A registration event's `admissionMode` is the default TICKETED and means nothing.
- **Never compare a form's or application's `eventId` with a map's `eventId`.** Go through `mapEvents.js`: a registration's map (and lineup) belong to its linked live event.
- One form per registration event. The `registration` flow opens the existing form; there is no Review step in it — the event wizard's Review publishes.
- The backend still accepts a form on a live event (MCP, CLI, old contract fixtures); the UI no longer offers it. Refusing it is a follow-up.
- Backfill tests must pass `organizationId` to `run()`: the suites share one database.
- `DESCRIBE_STEP` is hidden for registration events, so a link to `setup?step=description` on one resumes at the next visible step. **Category** has one home for every type: the Name step (Details › Edit listing and old `#event-listing` / `#event-category` links open it). Never add it back to Describe.

## Related Features
- [Event Setup Wizard](event-setup-wizard.md) · [Application Setup Flows](application-setup-flows.md) · [Applications](applications.md)
- [Floor Maps](floor-maps.md) · [Vendor Space Selection](vendor-space-selection.md) · [Event Details](event-details.md) · [Participants](participants.md)
