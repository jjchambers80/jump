# Spec 057 — Registration events (one wizard, two event types)

## Context
Today vendor/guest/volunteer/other applications are forms *attached to* a live event (Overview › "Add to this event" tiles → per-form flows `/admin/events/<id>/setup/<flow>`, Applications tab on the live event). The owner wants applications to become a first-class, generic **Registration event**: anyone (vendors or any entity the organizer chooses) registers through a fully customizable form, free or with an application fee. "Create event" becomes one wizard wrapping two types, chosen on a new first step modelled on Zeffy's "What campaign do you want to create?" screen (`/Users/jj/Downloads/Event/1.png`): **Live event** and **Registration event**.

Decisions (owner, 2026-10-17):
- New `Event.type` field. `admissionMode` (TICKETED | RSVP) stays a live-event-only concept and is unrelated.
- A registration event stands alone (own name, date, venue, page) and can **optionally link** to a live event (e.g. "Halloween Market vendors" → Halloween Market).
- **One form per registration event.** The form starts with only the contact minimum (email, spec 056/PR #477); every other field is added by the organizer.
- Existing event forms (Halloween, Christmas…) are **converted** into linked registration events by a backfill.
- Registration events are **listed on the storefront** with their own event page (main button = Register).
- Admin `/admin/events` lists both types. The Applications tab moves off the live event onto the registration event page, which mirrors the live event page layout with registration labels.

## Data (packages/db)
- `enum EventType { LIVE REGISTRATION }`; `Event.type EventType @default(LIVE)`.
- `Event.linkedEventId String?` self-relation (`onDelete: SetNull`) + index. A registration event links only to a LIVE event of the same organization (validated in the service).
- Venue stays required (org scoping is Event → Venue → Organization); the wizard defaults the date and venue from the linked event.
- Add `type` to backend `EVENT_SETUP_STEPS` only if the step is saved server-side (it isn't — the step is client-only, see below).

## Wizard (frontend `components/event-setup/`)
- New client-only first step `type` (`TypeStep.tsx`): radio cards "Live event — Sell tickets or take RSVPs" and "Registration event — Let vendors or anyone you choose register, free or with a fee". The Registration card only shows with `useCan('applications')`. The preview pane shows a sample page for the chosen type, as Zeffy does.
- `steps.ts`: `'type'` goes at the front of `StepKey`, `EVENT_STEPS` and `CLIENT_STEPS`; `SetupFields.type` is persisted in the sessionStorage draft. `WIZARD_TYPES` becomes `{ live, registration }` and `visibleSteps(ctx)` picks the list by `ctx.type`. Fix `resumeKey` and `StartFromPastEvent`, which assume `name` comes first.
- Live: the existing steps, unchanged after `type`.
- Registration: type → name (with an optional "Registering for" live-event picker that prefills venue and date) → venue → date (row created: `useSetupActions.create` sends `type`, `linkedEventId` and admissionMode) → description → image. It then hands off to the existing form flow under a new flow key `registration` (`formFlows.ts`): details (who registers = `purpose`, free/paid) → options* → payment* → floor-map** → fields → review. The progress bar counts the event steps too, so it reads as one wizard. The review step publishes the event and opens the form (`EventReadinessService` → 422 on blockers).
- Keep the backend `EVENT_SETUP_STEPS`, `eventSetupSteps.fixtures.json` and both parity tests in step if any new key is persisted.

## Backend
- `EventService.createEvent` / `createSetupEvent`: accept `type` and `linkedEventId` (validator + service check: same org, LIVE, not deleted). `type` is immutable after create.
- `ApplicationFormService.createForm`: forms may only be created on REGISTRATION events, at most one per event (replaces `_assertOnePerPurpose` for event forms). Standing forms are unchanged.
- `EventReadinessService`: REGISTRATION skips ticket, capacity and tier checks; it blocks with `FORM_MISSING` and warns as today on paid-forms-disabled and map-without-published-map.
- Floor map stays on the live event. Booth/space selection for a linked registration resolves the map through `form.event.linkedEventId ?? form.eventId`, and map queries that read `form: { eventId }` (e.g. `MapService.js:121`) also take forms of registration events linked to that event, so booths keep showing vendor names.
- `getEventWorkspace` / `getEventOverview` / `listOrgEvents` / summary / CSV return `type`, `linkedEvent {id,name,slug}` and, for a live event, `registrations: [{id,name,formStatus,toReview}]`. List and summary accept `?type=`.
- Public: `/events/:eventId/applications/forms` for a live event returns the open forms of its linked registration events, so the "Get involved" pills keep working. Registration event pages read their own single form.
- Permissions: registration events live under the existing `applications` feature (`requireFeature('applications')` on form routes, as today); the events list hides the type from roles without it. No new catalog key, since it isn't a new admin area. Add a contract test that a role with `applications` hidden gets 403 creating a REGISTRATION event.

## Backfill (`npm run db:backfill:057-registration-events`, DRY_RUN default true)
For each ApplicationForm with `eventId` on a LIVE event: create a REGISTRATION event (`name` = form name, unique slug, same venue/date/taxRate, status PUBLISHED if live event PUBLISHED and form not DRAFT, else DRAFT; `linkedEventId` = live event). Then move `eventId` on that form's `ApplicationForm`, `Application`, APPLICATION-kind `Order`s, application-scoped `AddOn`s and the form's `PriceTier`/`ApplicationTier` rows. `Ticket` (none for applications), `EventRsvp`, `EventGuest` and `FloorMap` stay put. `EventCancellation` rows are left on the live event. Run it inside one transaction per form, idempotently (skip a form already on a REGISTRATION event), and print a per-form report. The prod run happens after deploy, via railway ssh, dry run first.

## Admin UI
- `/admin/events` list (`EventListCard`, `EventsToolbar`, `EventsSummary`): a type chip ("Live" / "Registration") and a Type filter (All · Live events · Registration events). Registration cards show registrations and to-review counts instead of tickets/RSVPs.
- Live event page (`app/admin/events/[eventId]/page.tsx`, `EventWorkspace.tsx`): remove the Applications tab, the Applications stat tile, `ApplicationsSection` and `AddToEventCard`. Add a "Registrations" card listing linked registration events with a "Create registration event" button (wizard with `type=registration&linked=<id>` prefilled). Door check-in for vendors moves with the applications.
- Registration event page: the same shell (`EventHero`, `WorkspaceTabs`, aside cards). Tabs: Overview · Registrations (`SubmissionsTable` with `eventId`) · Map (if the linked event has one) · Door check-in · History. Stats: Registrations · To review · Approved · Collected (PAID). Aside: Date & venue, Registering for (linked event link), Form (status, opens/closes, Edit → the flow step), Payments. Every Edit deep-links into the wizard or flow; no second editor (Gotcha 39).
- `workspaceTabs()`, Overview, `EventHero`, `EventListCard` and the public `eventPage.ts` branch on `type` **first**, then `admissionMode` for live events only.

## Storefront
- The events list includes registration events with a "Registration" badge.
- `EventPageView`: for REGISTRATION, hide tickets/RSVP and show a primary **Register** button to `apply/[formSlug]` (the existing `ApplyShell` flow, payment after approval unchanged). The live event page shows linked registrations as Get-involved pills.

## Phases (one PR each, merge in order)
- **A** Schema + `type`/`linkedEventId` in create/list/overview APIs + readiness + one-form rule + map resolution + contract tests.
- **B** Wizard type step + registration path (handoff to the `registration` flow) + parity fixtures + Playwright.
- **C** Registration event detail page + live event page changes (remove Applications tab/tiles, Registrations card).
- **D** Events list type chip/filter + summary; storefront list badge + registration event page + Get-involved pills from linked events.
- **E** Backfill script + prod run (dry run → real) + remove the old "Add to this event" and `/setup/<flow>` entry points (keep redirects).
- **F** Wiki: `docs/wiki/features/registration-events.md`; update application-setup-flows, event-setup-wizard, participants; root `AGENTS.md` gotcha; `specs/057-registration-events/plan.md`.

## Critical files
- `packages/db/prisma/schema.prisma`, new migration, `backend/src/scripts/backfill-057-registration-events.js`
- `backend/src/services/EventService.js`, `EventReadinessService.js`, `ApplicationFormService.js`, `MapService.js`/`BoothService.js`, `backend/src/api/validators/eventValidators.js`, `backend/src/api/routes/events.js`, `applications.js`
- `frontend/src/components/event-setup/steps.ts`, `StepContent.tsx`, `useSetupActions.ts`, `sessionDraft.ts`, `formFlows.ts`, `FormFlowPage.tsx`, new `steps/TypeStep.tsx`
- `frontend/src/components/events/EventWorkspace.tsx`, `AddToEvent.tsx` (removed), `EventListCard.tsx`, `EventsToolbar.tsx`, `app/admin/events/[eventId]/page.tsx`, `app/admin/events/page.tsx`
- `frontend/src/components/storefront/*EventPageView*`, `GetInvolved.tsx`, `lib/eventPage.ts`

## Verification
- Jest contract: create REGISTRATION with or without link (cross-org / non-LIVE link → 400), a second form on a registration event → 409, a form on a LIVE event → 400, readiness blockers, list `?type=`, map booth names for linked forms, a permission 403. Backfill test on a fixture DB: forms, applications, orders and add-ons moved; money totals (`moneyOf`, refunds) unchanged; a rerun is a no-op.
- Vitest: step parity fixture, `visibleSteps` per type.
- Playwright: wizard type step → registration path → review publishes; live event page has no Applications tab and shows a Registrations card; events list filter; storefront registration page Register button; axe clean.
- Manual on local dev (3001/3002): create both types, link to a market, submit and approve a paid registration, choose a space on the live event's map, check the live event's Get-involved pill.
- Prod: deploy A–D dark-safe (old forms still render), run the backfill dry run, review the report with the owner, then run it for real; check Halloween/Christmas markets in the admin and storefront.
