# Event Setup Wizard

**Status**: Implemented and the only event editor. Phase 1 (cards A–O, Q) and phase 2 (R, S) merged; the owner signed the parity checklist, the flag went on in prod on 2026-10-11 (deploy 39f00a46), and 050-P removed the flag and the old create page, `EventEditor`, the Details flyouts and the event-level forms configuration pages.
**Last Updated**: 2026-10-11 (spec 051: application forms moved to their own flows)

Plan: [`specs/050-event-setup-wizard/plan.md`](../../../specs/050-event-setup-wizard/plan.md). Research: [`docs/research/2026-10-10-event-creation-wizard.md`](../../research/2026-10-10-event-creation-wizard.md). Donations hook-up: [`specs/047-donations/plan-d1.md`](../../../specs/047-donations/plan-d1.md) §0. PRs #400, #403, #409, #412–#414, #416, #417, #419–#423, #425, #428–#432, and 050-P.


> **Spec 057:** step 1 is now **What do you want to create?** (live or registration event). A registration event skips Tickets and sets up its one form in the `registration` slot between Image and Collect more; see [Registration Events](registration-events.md).

## Overview

Every **Create event** opens a Zeffy-style step wizard: name → venue → date (which creates the draft) → description, image, tickets or RSVP, add-ons, review and publish. Application forms (vendors with their floor map, special guests, volunteers, other applications) are set up afterwards, one form at a time, in their own [application setup flows](application-setup-flows.md) (spec 051), started from the event's Overview. The same wizard, run non-linearly, is the one editor for an existing event: each Edit control on the event's Details page opens `/admin/events/<id>/setup?step=<key>`. A live preview of the real event page (phone or desktop) sits beside the form, and a signed link opens the themed draft page in a new tab. Mobile first, WCAG 2.1 AA.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `STOREFRONT_PREVIEW_SECRET` | No | Existing (spec 038). Also signs event preview tokens; unset → derived from `AUTH_SECRET` (`ThemePreviewService.previewSecret()`) |
| `APPLICATIONS_PAYMENTS_ENABLED` | No | Existing. Off: Review cannot open PAID forms at publish (`PAID_FORMS_DISABLED`) |
| `NEXT_PUBLIC_DONATIONS_ENABLED` | No | Spec 047 D1, not built. `useDonationsEligible()` / `useDonationSuggestion()` return `false` until D1 wires them |

There is no wizard flag any more: `NEXT_PUBLIC_EVENT_WIZARD_ENABLED` was removed in 050-P and the wizard is always on. On the backend, the new routes, fields, permissions defaults (050-E), unpublish / close sales / delete draft (050-D), readiness at publish (050-C), previews (050-F), purpose (050-B), lineup (050-Q) are live (volunteer shifts, 050-R, were removed in October 2026) for every caller (wizard, CLI, MCP).

## Steps

Registry: `frontend/src/components/event-setup/steps.ts` (`EVENT_STEPS`, `WIZARD_TYPES = { event }`), with entries from `contentSteps.ts` (4–6) and `applicationSteps.ts` (8, 10–12). Progress bar, Back / Skip / Next, "Step n of N", resume and the Review checklist are all computed from the visible list. Rule: **R** required to publish, **S** skippable ("Skip for now" while incomplete), **C** conditional.

| Key | Title | Rule | Visible | Complete | Preview anchor | Saves |
|---|---|---|---|---|---|---|
| `name` | Name your event | R | always (also after the row exists, so N never shifts) | name set | `#event-hero` | create body / `PATCH {name, slug}`. "Edit URL" = `SlugField`; live-URL warning when a PUBLISHED slug changes. **Start from a past event** only before the row |
| `venue` | Where is it? | R | always | venue chosen | `#event-venue` | `PATCH {venueId, date, endDate}`: the typed wall clock stays and moves to the new venue's zone. Zone shown read-only as text (not `VenueTimeZoneField`, which edits the venue). "New venue" = `VenueFlyout`; `?venueId=` preselects. With Venues off or hidden for the role (`useCan('venues')`), `LocationStep` asks for an address instead and resolves it with `POST …/venues/from-address` to a private venue (see [rbac](rbac.md)) |
| `date` | When is it? | R | always | start set | `#event-date` | create: `POST …/events {setup:true}`; edit: `PATCH {date, endDate}` via `zonedInputToIso` |
| `description` | Describe it | S | always | description saved | `#about` | `PATCH {description, category}` (`RichTextEditorField`; Listing category lives here) |
| `image` | Add an image | S | always | image saved | `#event-hero-image` | `EventMediaCard` → `POST/DELETE …/logo`, saves on its own |
| `tickets` | Tickets or RSVP | R | always | see `contentSteps.ts` | `#tickets` | `PATCH {admissionMode, capacity, rsvpLimit, rsvpMaxPartySize}`; tier dialogs save on their own (`…/price-tiers`, incl. the new `DELETE`); `&tier=<id>` opens that tier's dialog |
| `attendee-questions` | — | reserved | never | — | — | — |
| `collect-more` | Collect more | S | **always** (050-O parity: RSVP events keep add-ons for application tiers) | `addOnCount > 0` | `#add-ons` | `AddOnsSection` + `SavedAddOnPicker` (`/organizations/:orgId/events/:eventId/add-ons`); D1 `EventGiftSettings` slot is a comment in `CollectMoreStep.tsx` |
| `discounts` | — | reserved | never | — | — | — |
| `reminders` | — | reserved | never | — | — | — |
| `review` | Review and publish | R | always | `setupCompletedAt` set | page top | `GET …/readiness`, `POST …/publish {openFormIds}`, `PATCH {setupCompleted:true}` |
| `done` | Your event is live / Saved as draft | — | never in the list; create flow only, after Review | — | page top | — |

"Step n of N" counts visible steps up to Review (8 for a fresh ticketed event). Spec 051 moved the five application steps (`vendors`, `floor-map`, `special-guests`, `volunteers`, `other-applications`) into their own flows: a draft whose saved `setupStep` is one of them (`FORMER_STEPS` in `steps.ts`) resumes at Review, and `setup?step=<old key>[&form=<id>]` redirects to the form's flow (`legacyFlowHref` in `formFlows.ts`), so emails, bookmarks and readiness items keep working. Unknown keys fall back to the first step.

**Parity fixture:** backend `EVENT_SETUP_STEPS` (`backend/src/api/validators/eventValidators.js`, the keys a `PATCH setupStep` accepts: the registry minus the reserved slots) and the frontend `StepKey` list are asserted against one file, `backend/tests/fixtures/eventSetupSteps.fixtures.json`, from Jest (`tests/unit/eventSetupSteps.test.js`) and Vitest (`tests/unit/eventSetupSteps.test.ts`). Change all three together.

## How It Works

### Routes and shell

- `/admin/events/new` → wizard, steps 1–3, no row. `/admin/events/[eventId]/setup?step=<key>` → wizard on an existing event; no `?step=` resumes at `setupStep`. `/admin/events/preview-frame` → the chrome-less document the preview iframe loads.
- `AdminLayoutClient` `FULL_SCREEN` matches all three; they keep `AdminRoute`, `OrgProvider` and the edge guard. `src/middleware.ts` sends `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` for the exact path `/admin/events/preview-frame` only.
- `EventSetupPage` (container) → `useSetupFlow` / `useSetupData` / `useSetupForms` / `useSetupActions` / `useStepSave`; `SetupShell` (layout), `SetupHeader`, `SetupProgress` (the `role="progressbar"` fill only; the step list, step line, menu button, sheet and edit-mode rail were removed in spec 051: Back / Next move between steps), `SetupFooter`, `PreviewPane` + `PreviewDevice` (phone / laptop frames, spec 051), `StepContent`, `ErrorSummary`, `SaveIndicator` (in the footer, problems only since spec 051). `OrgFromUrlGate` selects `?org=` before anything loads.
- Step change: focus to the step h1 (`tabIndex={-1}`), polite live region "Step n of N, Title". A failed Next renders a focused `role="alert"` summary whose links focus the field, or open the step that owns it. Next is never disabled without a reason.
- Mobile (below lg): header [Menu] [Eye] [Exit / Save & exit], 44 × 44, labelled. The preview becomes a full-screen dialog (`useDialog`); while closed it is `hidden`, `inert`, `aria-hidden` (the frame keeps its state).

### Draft lifecycle

```
 [name] → [venue] → [date] ──POST /events {setup:true} + Idempotency-Key──▶ DRAFT, setupCompletedAt null
 (sessionStorage only)                                                       steps 4…12 autosave
 Review: Publish ──▶ PUBLISHED, setupCompletedAt = now, ticked DRAFT forms OPEN ──▶ Done
         Save as draft ──▶ PATCH {setupCompleted:true} (stays DRAFT) ──▶ Done
 PUBLISHED ── Unpublish (no live order / GOING RSVP / submitted application) ──▶ DRAFT
 PUBLISHED ── Close sales ⇄ Reopen sales (stays PUBLISHED)      DRAFT / CANCELLED ── Delete (soft when there is order history)
```

- **Steps 1–2 are client-only.** Name, slug, venue, dates and the current step live in React state mirrored to `sessionStorage` `jump:event-setup:<orgId>` (`sessionDraft.ts`, try/catch, renders without it). Header shows **Exit** (not Save & exit) until the row exists.
- **Create at the date step.** Next validates steps 1–3 and posts `{ setup: true, name, slug?, venueId, date, endDate?, admissionMode }` with an `Idempotency-Key` minted into the session draft *before* the request. The backend stores it as `Event.setupRequestId` (unique): a replay returns the existing row with 200, a concurrent replay loses the unique race and reads the winner, a key used by another org is 409. The client compares the returned name / venue / dates with what it sent and PATCHes any difference (lost-response case). Then `router.replace('/admin/events/<id>/setup?step=description')`, session draft cleared, h1 focused after the remount.
- **`setup: true` relaxes create**: no tiers, `capacity` optional (DB CHECK `Event_capacity_draft_check`: capacity non-null unless DRAFT or RSVP), status DRAFT, `setupCompletedAt: null`. Without it the old create path is unchanged and `setupCompletedAt` takes its column default `now()`; the migration's default backfilled every existing event as set up, so old events never show the linear flow or Continue setup.
- **`setupStep`** = the furthest step key reached (create mode only, recorded on Next). **`setupCompletedAt`** = set once by Review (publish or Save as draft) or any publish. Keys, not indexes, because visible steps vary per event.
- **Continue setup** (`continueSetupHref` in `lib/eventWizard.ts`: DRAFT, `setupCompletedAt === null`; `undefined` from an old payload never matches) replaces Publish on the events list card, the Details hero and the dashboard attention list, and opens `setup?step=<setupStep>`.
- **Start from a past event** (step 1, before the row): dialog with a searchable event picker (server `q`, native radios), new name, start typed in the **source** event's venue zone → `POST …/:eventId/duplicate {setup:true}` (only a literal `true`): the copy gets `setupCompletedAt: null`, `setupStep: 'date'`, then opens `setup?step=date`. Duplicate copies tiers (inventory reset), add-ons, forms (with `purpose`, `collectBusiness`), image and floor map; never the guest lineup.
- **Done** (`?step=done`) belongs to the create flow: it needs `setupCompletedAt` set (else it falls back to the resume step) **and** the tab's `jump:event-setup-done:<eventId>` marker (`doneMarker.ts`, set by Review before it opens Done; without it a set-up event is in edit mode and `?step=done` goes to Details). Cards: View / Preview the event page (a draft mints the signed link on arrival so the click is not popup-blocked), Copy the share link (published), Review applications or Set up door check-in; primary **Go to event**. `formResults` from the publish are listed as text.

### Saving: autosave on drafts, explicit on live events

`stepSaver.ts` (pure, Vitest) under `useStepSave`:

- **DRAFT**: autosave 800 ms after the last valid change, plus a flush on Next / Back. Invalid fields are never sent ("Not saved: fix N fields"). Every built step's payload is merged into one PATCH body, so moving between steps never loses a change. Unmount flushes a pending debounced change.
- **PUBLISHED**: **never autosaves and never flushes on navigation.** Saves only on Next, Save or Save & exit. Indicator shows "Unsaved changes".
- Indicator (`role="status"`): Not saved yet · Saving… · Saved · Unsaved changes · Not saved: fix N fields · Couldn't save — Retry.
- **Guard**: `beforeunload`, a confirm on Exit, `useHistoryGuard` (a guard history entry; browser Back past live, failed or invalid edits asks first) and `useLinkGuard` (one capture-phase click listener: every link that leaves the wizard — map builder, Settings › Brand / Tax, Go to event, template editor — asks first; same-path step links, new tabs and modified clicks pass).
- Dialog-based items (tiers, add-ons, forms, questions, guests) save on their own dialog Save, **on PUBLISHED events too**, then bump the preview revision.

### Preview

- **In-pane**: an iframe of `/admin/events/preview-frame` inside `<section aria-label="Live preview of the event page">`, `title="Event page preview"`. The frame loads `GET …/preview-payload` itself and re-fetches when the parent's save `revision` changes; the parent posts only an unsaved **overlay** (name, venue, dates, admission mode), the step's anchor and the revision (`{ type: 'jump:event-preview', … }`, ready handshake `jump:event-preview-ready`).
- **Origin checks both ways**: `targetOrigin` is `window.location.origin`, never `*`; each side checks `event.origin` and `event.source` (the iframe's `contentWindow` / `window.parent`). Messages are shape-validated (`previewMessages.ts`: id and anchor format, finite revision, overlay types) and ids are `encodeURIComponent`-ed into the API path.
- Before the row exists the frame builds the event from the overlay and the selected organization. Unsaved description HTML is never overlaid: the pane shows the server-sanitised description after the save (gotcha 20).
- **Phone / Desktop** is a native radio group in a fieldset (arrow keys work): phone = 390 × 844, desktop = 1280 wide scaled with `transform: scale()`.
- **Scroll**: the frame scrolls its own window to the anchor (`window.scrollTo`, `behavior: 'auto'` under reduced motion), falling back to `#event-hero` when the target has no client rects. Never `scrollIntoView` (it scrolls the admin frame too).
- The pane renders `EventPageView` (spec 050-G split of `EventDetailClient`) with `preview`: checkout, cart, RSVP submit and dialogs off; disabled controls are `aria-disabled` with a visible reason; unset fields are real-text placeholders ("Add a date", "$ –"). Themed orgs render unthemed in-pane.
- **Signed full preview** (050-F): `POST /organizations/:orgId/events/:eventId/preview-link` → `{ url, expiresAt }`, `EventPreviewService.mint`: HS256, audience **`event-preview`**, payload `{ typ, orgId, eventId }`, **1 h**, no share variant, URL on the org's storefront base (custom domain / subdomain wins). `app/api/events/preview/route.ts` sets the host-only httpOnly `jump_event_preview` cookie (path `/`, ≤ 1 h) and redirects to the event; the page forwards it as `X-Event-Preview`; `GET /events/:id` (and `/meta`) serves a DRAFT only when the token verifies for **that event and its org**, with `preview: true`, `X-Robots-Tag: noindex`, `Cache-Control: private, no-store`, past the private-store gate (render endpoint: `page=frame` only). The frontend never trusts the cookie: the preview bar shows only on the backend's `preview: true`. Review mints the link on load and re-mints 5 min before `expiresAt` and on tab focus; the link is `rel="noopener noreferrer"`. The token never verifies as a theme preview or a session (`typ` + audience).

### Readiness and publish (050-C, 050-N)

- `EventReadinessService.check(orgId, eventId)` is the one implementation (pure `evaluate()` inside, no Stripe call). `GET …/readiness` → `{ ready, blockers, warnings }`, items `{ code, step, message, formId? }`.
- **Blockers**: `NAME_MISSING` (name), `VENUE_MISSING` (venue), `DATE_IN_PAST` (date), `END_BEFORE_START` (date), and for TICKETED only `CAPACITY_MISSING`, `NO_ACTIVE_TIER`, `TIERS_EXCEED_CAPACITY` (sum of every tier's `quantityTotal`, inactive included) (tickets), `PAYMENTS_UNAVAILABLE` (review: a paid active tier or PAID form while Connect is on and `ConnectService.chargeAccountFor` refuses; never fires while `STRIPE_CONNECT_ENABLED` is off).
- **Warnings**: `NO_DESCRIPTION`, `NO_IMAGE`, `PAID_FORMS_DISABLED` (per PAID form, gate off), `FORM_HAS_NO_QUESTIONS` (per form), `MAP_FORM_WITHOUT_PUBLISHED_MAP` (floor-map), `TAX_RATE_UNRESOLVED` (review; read from `TaxRegion.lastError`, gotcha 12). Form items carry the step of the form's purpose.
- RSVP events skip tier, capacity and payments checks (branch on `admissionMode`, gotcha 29).
- `POST …/publish { openFormIds?: string[] }`: 409 if not DRAFT; runs readiness → **422 `EVENT_NOT_READY`** with `details: { blockers, warnings }`. In one transaction: PUBLISHED, `setupCompletedAt` if null, listed **DRAFT** forms of this event → OPEN. Each listed form is reported in **`formResults`** (`OPEN` or `REFUSED` + code: PAID with the gate off, not a draft, foreign id, or an `_assertCanOpen` 4xx such as no tier / map not ready); a refusal never fails the publish. Malformed `openFormIds` → 400.
- Review (`components/event-setup/review/`): checklist straight from `/readiness` with "Must fix:" / "Check:" text, each linking `setup?step=` (`wizardReadinessHref`); payments / tax fixes keep their settings link or say an admin must act; `EventTaxSummary` for TICKETED; brand summary read-only from the org context with a link to Settings › Brand; every form with "Open applications when I publish: <form>" (default ticked, disabled with the reason on `PAID_FORMS_DISABLED`); Open full preview; **Publish** + **Save as draft** (create mode), Publish only (edit mode on a DRAFT), status text (live / cancelled). Both actions flush pending edits first; Back is `aria-disabled` while a publish is out. A 422 renders the focused `PublishBlockers` with step links and refetches readiness.
- Details and the list card Publish buttons show the same blockers (`PublishBlockers`, `readinessHref`: each blocker opens its wizard step, `&org=` added).

### Edit mode (050-O)

An event with `setupCompletedAt` set opens the wizard in edit mode: the same fill bar; Back / Next move between steps. **Save & exit** returns to `/admin/events/<id>?saved=1` (or `?saved=0` after "Leave anyway" on a failed save); Details announces "Saved." / "Your latest changes were not saved." in an always-mounted `role="status"`, drops the marker, and returns focus to the exact Edit control used (`lib/detailsReturn.ts`, href + accessible name in `sessionStorage`).

Every Details Edit links into the wizard (`detailsEditLinks` in `lib/eventWizard.ts`, all with `withOrg` → `&org=`):

| Details section | Opens |
|---|---|
| Hero "Edit event" | `step=name` |
| Hero image tile "Edit image" | `step=image` |
| Date & venue (Edit / "Change venue") | `step=date` / `step=venue` |
| Event details (description), Listing | `step=description` |
| Sales, Admission, RSVPs | `step=tickets`; a tier `&tier=<id>` |
| Add-ons ("Edit add-ons" on Sales and RSVPs) | `step=collect-more` |
| An application form | its flow at Form details: `setup/<flow>?step=details&form=<id>` (`formEditHref`) |
| **Create registration event** (Registrations card, spec 057) | `/admin/events/new?type=registration&linked=<id>` |
| Floor map | the vendor flow's `step=floor-map&form=<id>` while a VENDOR MAP form exists, else the Map tab |
| Special guests (lineup card: count, first four names, hidden ones marked) | `setup/special-guests?step=lineup` |

The four Details flyouts were deleted in 050-P. **Redirects** (kept for bookmarks and email links) (`WizardRedirect`, carries `?orgId=` / `?org=` as `org=`): `/edit` by hash and `/edit/details`, `/edit/sales` via `legacyEditStep` (every old `event-*` id mapped, `event-rsvp-*` by prefix, fallback `name` / `tickets`); `applications/forms` → the vendor flow; `applications/forms/<id>` → the form's flow at Form details. Submission review (Applications tab, `SubmissionsTable`, detail pages) does not move; the tab's header has **Add a form** (a disclosure listing the four flows), and its empty state links to the Overview. There are no form templates since spec 056; `/admin/events/templates/*` 308s to Contacts › Forms.

Edit-mode extras: **View event** in the header (public page, or a signed preview for a draft), read-only tax summary on Tickets, live-URL warning on Name.

### Application forms by purpose (050-B, 050-L; flows since spec 051)

The rules below still hold; the editing UI moved to the [application setup flows](application-setup-flows.md). `ApplicationsStep`, `FormRow`, `InlineFormEditor` and `AddFormDialog` were removed (Start step = `steps/StartFormStep.tsx`).

- `ApplicationForm.purpose` (enum `VENDOR SPONSOR PRESS PANEL SPECIAL_GUEST VOLUNTEER OTHER`, default OTHER) places a form in a step: `vendors` (VENDOR), `special-guests` (SPECIAL_GUEST), `volunteers` (VOLUNTEER), `other-applications` (SPONSOR / PRESS / PANEL / OTHER; null → OTHER). `GetInvolved` labels come from `PURPOSE_CTA` (`lib/applications.ts`), not the form name.
- *(spec 050, replaced by spec 051)* One `ApplicationsStep` container rendered all four. **Several forms per step**: list (`FormRow`: name, purpose chip, status, kind, counts), add dialog (`AddFormDialog`: name prefilled `<Event> Vendor Application`, **Start from** Blank or the org's templates for that purpose + kind, falling back to same-kind templates without a purpose, "Show templates for all purposes", template **Edit** / **Delete**, "Charge for space" on vendors, purpose picker on Other applications), inline editor (`InlineFormEditor` over the unforked `FormEditorCards` `SettingsCard` / `TiersCard` / `QuestionsCard`, plus Created from, View applications, Save as template, View public form). `&form=<id>` expands a form (and moves to the right step). Delete only with no applications, else Close with the reason in text.
- Vendors choose **How vendors pick a space** (TIERS / MAP, spec 039) in `SettingsCard`; MAP adds the Floor map step at once.
- Rules (backend): SPECIAL_GUEST and VOLUNTEER are FREE only (400 `PURPOSE_KIND_MISMATCH`); purpose is fixed once a non-DRAFT application exists (409 `PURPOSE_LOCKED`); `collectBusiness: false` allowed on FREE event forms only (PAID → 400). `createForm` with no questions starts blank; from the setup flows (`setup: true`, spec 056) it asks for an email only. `collectBusiness: false` is allowed on any form since spec 056.
- Form open / close times are edited on the **venue's** clock with the zone shown (`FormEditorCards`, also on the old pages); standing forms have no venue and keep the browser clock.
- Preview: `preview-payload` returns DRAFT forms too, so new forms show in the pane's Get involved strip.

### Floor map step (050-M, a vendor flow step since spec 051)

Visible only while the vendor form has `spaceSelection: MAP`. No map: **Create a blank map** (`POST /admin/maps`) or **Start from a floor plan** (`mapsApi.createFromFloorPlan`) — the same calls as Event › Map. With a map: name, Draft / Published, booth count, bound tiers, `MAP_FORM_WITHOUT_PUBLISHED_MAP` text, **Open map builder** → `/admin/maps/<id>?returnTo=<encoded flow URL>` (`FloorMapStep` takes `returnTo`). The builder's Back ("Back to setup"), its **Done** and its error-screen button honour `returnTo` through `safeAdminReturnTo` (`lib/returnTo.ts`: same-origin `/admin…` path only after normalisation) and leave through `useLeaveAfterSave` (waits for the in-flight autosave, saves, stays on failure).

### Guest lineup (050-Q)

`EventGuest` rows (name ≤ 120, role ≤ 80, plain-text bio ≤ 600, image, links validated with `SETTINGS_GROUPS.social`, `isVisible`, `displayOrder`, optional `applicationId` **unique**). Edited in the special guests flow's Lineup step (`lineup/*`: add by hand without any form, edit, up / down reorder announced in `role="status"`, visibility, delete); **Add to lineup** on an APPROVED SPECIAL_GUEST application's detail copies name, description → bio, first photo (its own `Image` row), passing links (no profile → the applicant's name); 409 `ALREADY_IN_LINEUP`. Public payload `guests: [{ id, name, role, bio, imageUrl, links }]` (visible rows, ordered) → `EventGuests` section `#guests` on the event page; preview payload carries every row. Export lists rows linked to the contact's applications; erasure deletes them; hand-typed rows stay. Not copied by duplicate. A Details lineup card is a 050-P follow-up.

### Volunteer shifts (removed)

Volunteer shifts (050-R, 050-S) were removed in October 2026 because there is no use case yet. Migration `20261109120000_drop_volunteer_shifts` drops `VolunteerShift` and `ApplicationShift`; volunteer forms are start · details · questions · review.

### Close sales, unpublish, Delete draft (050-D)

`EventActionsMenu` → `EventLifecycleDialog` (focus trap, reasons listed as text on refusal):

- **Close sales…** (directly above Cancel) / **Reopen sales**: PUBLISHED only, idempotent; sets `salesClosedAt` / `salesClosedById`. `assertSalesOpen` (409 `SALES_CLOSED`) refuses new ticket checkouts, RSVPs and application submissions; approved vendors still select and pay, scanning and check-in are untouched, an in-flight checkout still completes via the webhook. Public payload `salesClosed`; event page shows "Sales are closed", apply pages "Applications are closed" (`acceptance.reason: 'sales_closed'`), `GetInvolved` hidden. "Sales closed" pill on the Details hero and list card. Cancel still works from a sales-closed event.
- **Unpublish…**: PUBLISHED → DRAFT, clears the sales close; 409 `UNPUBLISH_BLOCKED` + `details.reasons` while there is an order not FAILED / CANCELLED, a GOING RSVP or a non-DRAFT application. Runs under the Event row lock (see Gotchas).
- **Delete draft… / Delete event…**: `DELETE …/:eventId` (`EventService.deleteEvent`). PUBLISHED is refused (409, cancel first). A DRAFT keeps the unpublish guards (409 `DELETE_BLOCKED`). A DRAFT with no order history is removed for good (draft applications, RSVPs and tiers deleted; forms / maps / add-ons cascade). A CANCELLED event, a DRAFT with past checkouts, or one a restricting FK (`P2003`) protects is **soft-deleted**: `Event.deletedAt` is set, the event leaves the admin list, summary counts, dashboard, admin search, menu targets and the setup guide, and admin URLs 404, while its orders, payments, refunds and tax rows keep pointing at it. Money rows are never cascaded. There is no restore UI.
- **Cancel event…** shows only on a PUBLISHED event; a refused cancel shows its message inside the dialog (`CancelEventDialog` `error`).

### Permissions (050-E)

**Visibility setting:** the wizard is a sub-area of the catalog feature **`events`** (`backend/src/permissions/catalog.js`; locked, `adminPaths` `/admin/events` and `/admin/create-event`, which covers `/admin/events/new`, `/admin/events/<id>/setup` and `/admin/events/preview-frame`). It adds no feature key of its own. The `events` actions it uses are `applications.forms`, `applications.money` and `addOns.manage`; it also uses `maps.forceAssign` (feature `maps`) and `applications.standingForms` (feature `content`).

| Key | Default | Covers |
|---|---|---|
| `applications.forms` | ADMIN + **ORGANIZER** | event forms, tiers, tier add-ons, questions |
| `addOns.manage` | ADMIN + **ORGANIZER** | event add-ons and saved add-ons |
| `applications.standingForms` | ADMIN | standing forms (Contacts › Forms); split from `applications.forms` (`SPLIT_KEYS`: an old `applications.forms` override applies until one of its own is saved) |
| `maps.forceAssign` | ADMIN | `force` on booth assign (a spot of another category), enforced on the server; `BoothPanel` shows the toggle with `useCan` |
| `applications.money`, `orders.refund`, `settings.*` | ADMIN | refunds, waivers, offline payments, every settings write |

Event routes (create, PATCH, publish, readiness, unpublish, close / reopen sales, delete, duplicate, preview link / payload, price tiers, guests) are `requireAuth → requireOrganizer → requireOrgMembership()`. Every wizard step works for ORGANIZER. See [Roles & permissions](rbac.md).

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/organizations/:orgId/events` `{setup:true,…}` + `Idempotency-Key` | Organizer | Wizard draft; replay 200 |
| PATCH | `/organizations/:orgId/events/:eventId` | Organizer | + `endDate`, `setupStep` (registry key), `setupCompleted: true`, `capacity: null` (DRAFT only, else 409 `CAPACITY_REQUIRED`) |
| GET | `…/events/:eventId/readiness` | Organizer | Blockers and warnings |
| POST | `…/events/:eventId/publish` `{openFormIds?}` | Organizer | 422 `EVENT_NOT_READY`; `formResults` |
| POST | `…/events/:eventId/unpublish`, `/close-sales`, `/reopen-sales` | Organizer | Lifecycle (050-D) |
| DELETE | `…/events/:eventId` | Organizer | Delete a DRAFT |
| POST | `…/events/:eventId/duplicate` `{setup:true}` | Organizer | Copy into setup mode |
| POST | `…/events/:eventId/preview-link` | Organizer | Signed 1 h draft link |
| GET | `…/events/:eventId/preview-payload` | Organizer | `{ event, organization, forms, guests }`, any status, DRAFT forms included |
| GET | `/events/:eventId` + `X-Event-Preview` | Token | DRAFT with `preview: true` |
| DELETE | `…/events/:eventId/price-tiers/:priceTierId` | Organizer | 204; 409 `TIER_IN_USE` |
| GET / POST / PATCH / DELETE | `…/events/:eventId/guests[/:guestId]`, `POST …/guests/reorder`, `POST\|DELETE …/guests/:guestId/image` | Organizer | Lineup |
| POST | `/admin/events/:eventId/applications/:applicationId/add-to-lineup` | Organizer | From an approved special guest |

`…` = `/organizations/:orgId`. Overview (`GET …/overview`) forms now carry `purpose` and `spaceSelection`; the dashboard `attention.draftEvents` carries `setupStep` / `setupCompletedAt`.

## Database

Migrations (all additive): `20261101100000_event_setup_wizard` (`capacity` nullable + CHECK, `endDate`, `setupStep`, `setupRequestId` unique, `setupCompletedAt DEFAULT CURRENT_TIMESTAMP` = the backfill), `20261101110000_application_form_purpose` (enum + column + name-regex backfill; VOLUNTEER / SPECIAL_GUEST only for FREE rows, remaining PAID event forms → VENDOR), `20261101120000_event_close_sales`, `20261101130000_volunteer_shifts` (dropped by `20261109120000_drop_volunteer_shifts`), `20261101140000_event_guests`. New models are mapped in `backend/src/audit/features.js`. See [Database Architecture](database-architecture.md).

## Tests

- Backend: `eventSetupDraft`, `eventReadiness`, `eventPreview`, `eventCloseSales`, `organizerFormConfig` (table-driven over every opened and kept route), `applicationFormPurpose`, `applicationFormDefaults`, `eventGuests`, `priceTiers` contract suites; unit `eventSetupSteps`, `eventValidators`, `eventReadiness`, `eventPreviewService`, `applicationFormPurposeMigration`, `eventGuestDataRights`.
- Vitest: `eventSetupSteps`, `stepSaver`, `tierForm`, `eventWizard`, `eventReadiness`, `returnTo`, `eventHero`.
- Playwright (one dev server since 050-P): `admin-event-setup-{shell,entry,tickets,add-ons,floor-map,review}`, `admin-event-application-flows` (spec 051), `admin-event-edit-mode`, `event-guest-lineup`, `admin-venue-flyout` (venue step's New venue), `admin-event-details` (every Edit href into the wizard, Special guests card), `applications-add-ons` and `participants-templates` (form editor, Start from, Save as template and pinned columns on the wizard step), `admin-event-publish-blockers`, `admin-event-close-sales`, `event-sales-closed`, `event-draft-preview`, `event-page-preview-mode`, `get-involved-labels`. 050-P moved the old editor specs' still-valid checks into the wizard specs (admission radio keys, 24 px reorder targets, image replace / remove, tier quantity floor, add-on sales counts and read-only without `addOns.manage`) and deleted `admin-event-form-layout`.
- Pages opened in `beforeAll` (no test fixtures) use `BASE_URL` from `e2e/helpers/session.ts`.
- Wizard specs warm `/admin/events/new`, `setup` and `preview-frame` in `beforeAll` (desktop viewport, else the preview is hidden), run axe with `reducedMotion: 'reduce'` (the `motion-safe` fades otherwise catch axe mid-opacity), wait for Tiptap before scanning the Describe step, and scope assertions to `<main>` or the frame (the preview repeats every name).

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/event-setup/steps.ts` | Step registry, visibility, completion, resume, `StepKey` |
| `frontend/src/components/event-setup/contentSteps.ts`, `applicationSteps.ts` | Steps 4–6; application types by purpose, `formsOnStep`, `stepForPurpose` (flows: [application setup flows](application-setup-flows.md)) |
| `frontend/src/components/event-setup/EventSetupPage.tsx`, `useSetupFlow.ts`, `useSetupData.ts`, `useSetupForms.ts`, `useSetupActions.ts` | Container: load, step state, create, Save & exit, publish hand-off |
| `frontend/src/components/event-setup/stepSaver.ts`, `useStepSave.ts`, `SaveIndicator.tsx`, `useHistoryGuard.ts` | Autosave / explicit save, indicator, history + link guards |
| `frontend/src/components/event-setup/SetupShell.tsx`, `SetupHeader.tsx`, `SetupProgress.tsx`, `PreviewDevice.tsx`, `SetupFooter.tsx`, `StepContent.tsx`, `ErrorSummary.tsx`, `stepFocus.ts` | Shell and a11y plumbing |
| `frontend/src/components/event-setup/PreviewPane.tsx`, `PreviewFrame.tsx`, `previewMessages.ts`, `usePreviewChannel.ts` | In-pane preview |
| `frontend/src/components/event-setup/sessionDraft.ts`, `doneMarker.ts`, `StartFromPastEvent.tsx`, `PastEventPicker.tsx`, `ContinueSetupLink.tsx`, `ViewEventLink.tsx`, `OrgFromUrlGate.tsx`, `WizardRedirect.tsx` | Pre-row draft, entry points, redirects |
| `frontend/src/components/event-setup/steps/*` | One file per step: Name, Venue, Date, Describe, Image, Tickets (`TierList`, `useTierActions`), CollectMore, Done; the form flows' Start (`StartFormStep`), Review (`ReviewFormStep`), FloorMap |
| `frontend/src/components/event-setup/review/*` | Review: checklist, forms, brand, actions, publish outcome, donation slot |
| `frontend/src/components/event-setup/lineup/*` | Guest lineup editor |
| `frontend/src/lib/eventWizard.ts` | `continueSetupHref`, `wizardStepHref`, `withOrg`, `detailsEditLinks`, `legacyEditStep` |
| `frontend/src/lib/eventReadiness.ts`, `components/events/PublishBlockers.tsx` | Blocker links |
| `frontend/src/lib/detailsReturn.ts`, `lib/returnTo.ts` | Focus return on Details; safe builder `returnTo` |
| `frontend/src/app/admin/events/new/page.tsx`, `[eventId]/setup/page.tsx`, `preview-frame/page.tsx` | Routes |
| `frontend/src/app/events/[eventId]/EventPageView.tsx` + section components, `EventGuests.tsx`, `app/api/events/preview/route.ts`, `components/storefront/EventPreviewBar.tsx` | Event page split, lineup section, signed preview |
| `frontend/src/components/events/tierForm.ts`, `EventTaxSummary.tsx`, `EventLifecycleDialog.tsx` | Tier form helpers, tax summary, lifecycle dialogs |
| `backend/src/api/validators/eventValidators.js` | `EVENT_SETUP_STEPS`, setup create / PATCH rules |
| `backend/src/services/EventService.js` | `createSetupEvent`, publish, unpublish, close / reopen sales, delete draft, duplicate `{setup}`, preview payload |
| `backend/src/services/EventReadinessService.js`, `EventPreviewService.js`, `salesOpen.js` | Readiness, preview tokens, `assertSalesOpen` |
| `backend/src/services/applicationFormDefaults.js`, `ApplicationFormService.js` | Purposes, purpose rules, blank start |
| `backend/src/services/EventGuestService.js` | Lineup |
| `backend/src/permissions/catalog.js` | `applications.forms`, `addOns.manage` (organizer), `applications.standingForms`, `maps.forceAssign` |

## Gotchas

- **One editor.** `components/event-setup/` is the only form for event fields and event application forms (the form flows live there too, spec 051). Never add a flyout or section editor for a field a step owns; link to `setup?step=` or `formFlowHref`.
- **PUBLISHED events never autosave**, and navigation never flushes their pending edits (`go()` flushes only DRAFT). Tier / add-on / form / guest dialogs still save immediately, as before the wizard.
- **Step keys live in three places** (backend `EVENT_SETUP_STEPS`, frontend `StepKey`, the shared fixture); the parity tests fail otherwise. A new step = registry entry + backend key + fixture + `StepContent`.
- **Visibility is not completion.** The Floor map step exists only in the vendor flow of a MAP form, while the readiness `MAP_FORM_WITHOUT_PUBLISHED_MAP` warning looks at any PAID MAP form (it carries that form's `formId` since spec 051, so the link opens its flow).
- **The tier-sum ceiling is relaxed on wizard drafts only** (`setupCompletedAt` null) in `PriceTierService` create / update and the `updateEvent` capacity floor; the Tickets step warns inline and publish blocks with `TIERS_EXCEED_CAPACITY`. Completed events and the CLI keep the hard 400.
- **Locks.** Unpublish takes `Event FOR UPDATE`; checkout takes `Event FOR SHARE` as the first statement of its transaction and application submit takes `FOR SHARE` + re-checks status and `assertSalesOpen` after it (RSVP create already holds `FOR UPDATE`), so no sale lands between unpublish's count and its write. Tier delete locks the `PriceTier` row (`FOR UPDATE OF pt`) and recounts tickets and order lines (`OrderItem.priceTierId` is `SET NULL`, so a line must never lose its tier).
- **Admission lock on the client is derived from the overview**; the server (any order of any kind → 409 `ADMISSION_MODE_LOCKED`) wins.
- **Preview frame**: same-origin only, under `/admin` (edge guard). Never post with `'*'`, never `scrollIntoView` inside it, never overlay unsanitised HTML.
- **The preview link lives 1 h**; Review and Done re-mint it, a stale tab gets a plain 404 for the draft.
- **Duplicate text in Playwright**: the iframe and the mobile / desktop copies repeat names; scope to the form pane or the frame (gotcha 11).
- **`useSearchParams()`** (`step`, `venueId`, `tier`, `form`, `org`) sits inside `<Suspense>` on every wizard route.
- **Old paths are redirect-only.** `/edit`, `/edit/details`, `/edit/sales` and `applications/forms*` render `WizardRedirect` and nothing else. Link new code straight at `setup?step=` or a form flow (`wizardStepHref`, `formFlowHref`, `detailsEditLinks`, `readinessHref`). The dashboard Needs-attention Publish posts to a route that does not exist (`adminService.publishEvent`, PR #412 review FYI; still open).
- **Donations (spec 047 D1)** plug in at the `collect-more` comment slot (`EventGiftSettings`) and `DonationSuggestion` on Review; `useDonationsEligible` is a stub returning `false`.

## Related Features

- [Event Details](event-details.md) — the read-only home whose Edit controls open the wizard
- [Event Editor](event-editor.md) — retired in 050-P; what the old routes redirect to
- [Event Management](event-management.md) — lifecycle and API
- [Application setup flows](application-setup-flows.md) — spec 051: vendors, special guests, volunteers and other applications, one form per run
- [Applications](applications.md), [Participants](participants.md) — forms, review
- [Add-ons](add-ons.md), [Price Tiers](price-tiers.md), [RSVP Events](rsvp-events.md)
- [Floor Map Builder](map-builder.md), [Vendor Space Selection](vendor-space-selection.md)
- [Roles & permissions](rbac.md), [Venue Time Zones](venue-time-zones.md), [Content › Blog posts](blog-posts.md) (`RichTextEditorField`, sanitise on write)
