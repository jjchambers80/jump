# Spec 050 — Event setup wizard

**Status**: Plan, 2026-10-10. Nothing built.
**Ask**: replace the single-page **Create event** form with a Zeffy-style step wizard. Every "Create Event" click opens it. The same wizard, run non-linearly, becomes the one place to edit an event's fields and to configure its application forms. Mobile first, WCAG 2.1 AA.
**Research**: [Event creation wizard](../../docs/research/2026-10-10-event-creation-wizard.md) (cited as "research"). Zeffy screenshots: vault `10_Personal/70_Assets/jump--zeffy-event-wizard--00…17*.png`, indexed in `10_Personal/10_Projects/jump--research--zeffy-event-wizard-screens.md`.
**Code baseline**: `origin/main` `19c65b2` (PR #395). The main checkout is a stale detached HEAD; build from `origin/main` worktrees (`./scripts/bootstrap-worktree.sh`).

## 1. Problem

- Create is all-or-nothing (research §3.1). One `POST /organizations/:orgId/events` needs a venue, a future date, capacity and at least one tier (`eventValidators.js:27-55`). There is no partial draft, no resume point and no draft preview: "View page" on a draft opens a 404 (`EventService.js:580`).
- After create, the page redirects to the list, not the new event (`new/page.tsx:289`).
- A published event cannot go back to draft, and the only way to stop selling is Cancel (`EventService.js:462`).
- Application forms have no role. `GetInvolved.tsx:16-22` guesses it from the name, so "special guest" reads "Apply". Event forms must collect business details (`ApplicationFormService.js:223`, `:388`), which is wrong for volunteers.
- Form, template and add-on configuration are ADMIN-only (`admin.js:752-837`, `addOns.js:15`). An ORGANIZER can create an event but cannot add a vendor form to it.
- Every field has two or three forms today: the create page, the `/edit/details` and `/edit/sales` section editors (`EventEditor.tsx`, 1,060 lines), and the flyouts on the Details page (`EventFlyouts.tsx`).

## 2. Goals and non-goals

**Goals**

1. One wizard for create and edit (hybrid (c)). Each step has one form and one save call. Steps are a per-type list, so a donation campaign type can be added in front later.
2. A server draft from the date step on, autosaved, resumable through "Continue setup".
3. A live preview in the wizard (phone/desktop) and a signed full preview of the real, themed page.
4. Explicit Publish at Review, backed by one server readiness check shared with every Publish button.
5. Unpublish (guarded) and Close sales / Reopen sales next to Cancel.
6. `ApplicationForm.purpose`. Vendor, Special guest, Volunteer and Other-application steps, each holding any number of forms. The event-level Applications › Forms configuration UI is removed.
7. Every wizard step usable by ORGANIZER.
8. Special guest lineup on the event page.

**Non-goals (v1)**

- Campaign-type chooser (research header, §5.5). Discount codes, attendee questions, reminders/communications (§5.5 #11): slots reserved, not built.
- Per-event font, colour, theme mode, background or logo (gotchas 6/7, spec 049). Review shows the brand read-only and links to Settings › Brand.
- Multiple dates or recurrence (gap analysis T12). Virtual events (the venue owns org scoping).
- Ticket "Unlimited", pay-what-you-can, group tickets, e-ticket design, per-event time-zone input (gotcha 28).
- A per-event payments or transactions tab (gotcha 17: `/admin/orders` is the one money surface).
- Volunteer shifts in phase 1 (§8, cards 050-R/S are phase 2).
- Changes to submission review: the Applications tab and `SubmissionsTable` stay as they are (gotcha 18).

## 3. Binding decisions (research §5.5, 2026-10-10)

| # | Decision | Where it lands |
|---|---|---|
| — | No campaign-type chooser. Steps are a per-type list (`WIZARD_TYPES.event`) | §5.1, 050-H |
| 1 | Steps 1–2 (name, venue) stay client-only. The draft row is created at the date step | §4, 050-A, 050-H |
| 2 | `capacity` may be empty on drafts. Publish checks it | §6.1, 050-A, 050-C |
| 3 | `Event.endDate`, optional | §6.1, 050-A |
| 4 | Explicit Publish at Review. Form configuration moves into the wizard; the event-level Applications › Forms config UI is removed; review stays in `SubmissionsTable` | 050-C, 050-N, 050-P |
| 5 | Unpublish allowed, with guards (no orders, RSVPs or submissions) | 050-D |
| 6 | `ApplicationForm.purpose` places forms in steps | 050-B |
| 7 | Special guests = application form **and** public guest lineup | 050-L, 050-Q |
| 8 | Volunteers: custom questions always; shifts/roles allowed, new work | 050-L, 050-R/S (phase 2) |
| 9 | Floor map step optional. Vendors pick a list (TIERS) or a map (MAP); the map step shows only for MAP | 050-M |
| 10 | Every wizard step available to ORGANIZER. Event-scoped form, template and add-on config open to ORGANIZER. Refund, waive, offline payment, `RefundService` and org settings stay ADMIN. Standing forms keep their rule | 050-E |
| 11 | Discount codes, attendee questions, reminders deferred; slots reserved | §5.1 |
| 12 | Preview in the wizard + signed private full-preview link | 050-F, 050-H |
| 13 | Donation toggle in Collect more and suggested again at Review; gated on spec 047 D1 `acceptGifts`, Connect on, verified nonprofit | 050-K, 050-N, §10 |
| 14 | "Start from a past event" on step 1 via `duplicateEvent` | 050-I |
| 15 | Edit mode (c) hybrid: Details page stays; each section's Edit opens `/admin/events/[id]/setup?step=<key>` with "Jump to edit…", Save & exit, return to the event page. One form per field | 050-O |
| 16 | Close sales next to Cancel: stays published, checkout and new applications off, reopenable | 050-D |
| 17 | Several forms per step. Sponsor, press, panel live in one "Other applications" step with a purpose picker per form | 050-L |

**Planner decisions made here** (within those bounds, not reopened elsewhere):

- **Publish opens forms per form, not all at once.** Review lists each DRAFT form with "Open applications when I publish" (default on; disabled with a reason for a PAID form while `APPLICATIONS_PAYMENTS_ENABLED` is off). Publish sends `openFormIds`, opened in the same transaction.
- **Setup marker** = `setupStep` (last step key) + `setupCompletedAt`. Keys, not indexes, because visible steps vary per event.
- **Autosave only on DRAFT events.** On a PUBLISHED event, edits go live, so each step saves explicitly (Next, Save, Save & exit) behind a dirty guard. The indicator shows in both modes.
- **In-pane preview is an iframe** of a chrome-less admin route fed by `postMessage`. The event page uses `lg:` media queries (research §5.3), and only an iframe renders phone and desktop truthfully without rewriting breakpoints or adding a container-query plugin.
- **Close sales does not stop already-approved vendors** from choosing and paying for their space (`ApplicationService.select`). Those are commitments made before the close. It stops new ticket checkouts, new RSVPs and new application submissions only. Door scanning is untouched.
- **Floor map step sits right after Vendor applications**, because its visibility depends on a vendor form's `spaceSelection`.
- **Listing category moves into the Describe step**, and the slug ("Edit URL") into the Name step.
- **Flyouts on the Details page are removed** in edit mode (one form per field). A tier's Edit opens the Tickets step with that tier's dialog (`?step=tickets&tier=<id>`).
- **Special guest forms are FREE.** Guests are not charged to appear. Vendor forms may be PAID or FREE. Other-application forms may be PAID only when the purpose is SPONSOR.
- **`collectBusiness: false` is allowed on FREE event forms only.** PAID forms keep the business profile that approval, booth assignment and check-in read.

## 4. Draft lifecycle

```
            client only                 server row (DRAFT, setupCompletedAt null)
 [1 Name] → [2 Venue] → [3 Date] ──POST /events {setup:true}──▶ steps 4…12, autosave on each change
                                                        │
                       Review: Publish ──▶ PUBLISHED, setupCompletedAt = now, selected forms OPEN
                               Save as draft ──▶ DRAFT, setupCompletedAt = now
 PUBLISHED ──Unpublish (no orders/RSVPs/submissions)──▶ DRAFT
 PUBLISHED ──Close sales──▶ PUBLISHED + salesClosedAt ──Reopen sales──▶ PUBLISHED
 PUBLISHED (sales open or closed) ──Cancel (PR #180 voids tickets)──▶ CANCELLED
```

- **Before the server row.** Name and venue live in React state mirrored to `sessionStorage` (`jump:event-setup:<orgId>`, try/catch, renders without it). On steps 1–2 the header shows **Exit**, not Save & exit; leaving with input asks "Discard this event?".
- **Create.** Next on step 3 posts `{ setup: true, name, slug?, venueId, date, endDate?, admissionMode: 'TICKETED' }`, then `router.replace('/admin/events/<id>/setup?step=description')` and clears the session draft. A double click or a retried request must not create two rows: the button disables while pending, and the client sends an `Idempotency-Key` header that is stored as `Event.setupRequestId` (unique, §6.1). A replay returns the existing row. A database column, not process memory, because the backend runs more than one instance.
- **Resume.** A DRAFT with `setupCompletedAt = null` shows **Continue setup** on the list card, the Details hero and the dashboard attention list. It opens `/admin/events/<id>/setup?step=<setupStep>`.
- **Edit mode.** Any event with `setupCompletedAt` set opens the wizard non-linearly ("Jump to edit…" open by default on desktop, Save & exit returns to `/admin/events/<id>`). Existing events are backfilled as complete, so they never see the linear create flow or "Continue setup" (§9).

## 5. Steps

### 5.1 Step registry

`frontend/src/components/event-setup/steps.ts` defines `WIZARD_TYPES = { event: EventStep[] }`. Each step declares `key`, `title`, `visible(ctx)`, `rule` (R/S/C), `anchor`, `save`, and `complete(ctx)` (drives the progress icons and Review checklist). `ctx` = event (or client draft), org capabilities (`donationsEligible`, `applicationsPaymentsEnabled`), role, forms. The progress bar, step menu, Skip/Next, resume and "Step n of N" are computed from the visible list. A donation type later is a second key in `WIZARD_TYPES` plus a step 0.

Legend: **R** = required to publish, **S** = skippable ("Skip for now" when empty), **C** = conditional visibility. "Anchor" = the preview element the pane scrolls to.

| # | Key | Title (h1) | Content | Visible | Rule | Preview anchor | Save call |
|---|---|---|---|---|---|---|---|
| 1 | `name` | Name your event | Name, "Edit URL" (`SlugField`) collapsed. Secondary entry: **Start from a past event** (050-I), shown only before the row exists | always (050-H: stays visible after the row exists, so N is stable and the event can be renamed) | R | `#event-hero` | Client state. Edit mode: `PATCH /organizations/:orgId/events/:id {name, slug}` |
| 2 | `venue` | Where is it? | Venue select, "+ New venue" (`VenueFlyout`), zone shown read-only (`VenueTimeZoneField`). `?venueId=` preselects | always | R | `#event-venue` | Client state. Edit mode: `PATCH {venueId}` (re-anchors the typed time, research §7) |
| 3 | `date` | When is it? | Start `datetime-local` in the venue zone + zone label; "+ Add end time" (optional, after start, same zone) | always | R (start) | `#event-date` | Create mode: `POST /organizations/:orgId/events {setup:true,…}`. Edit: `PATCH {date, endDate}` |
| 4 | `description` | Describe it | `RichTextEditorField`; Listing category select | always | S | `#about` | `PATCH {description, category}` |
| 5 | `image` | Add an image | `EventMediaCard` | always | S | `#event-hero-image` | `POST/DELETE /organizations/:orgId/events/:id/logo` |
| 6 | `tickets` | Tickets or RSVP | `AdmissionModeField` (locked once orders/RSVPs exist). TICKETED: capacity, tiers (`TierCard`, `TierEditDialog`, `TierPresetMenu`, reorder, duplicate tier), capacity warning. RSVP: `RsvpSettingsFields` | always | R | `#tickets` / `#rsvp-pass` | `PATCH {admissionMode, capacity, rsvpLimit, rsvpMaxPartySize}`; `POST/PATCH/DELETE …/price-tiers`, `POST …/price-tiers/reorder` |
| — | `attendee-questions` | (reserved) | — | never in v1 | — | — | — |
| 7 | `collect-more` | Collect more | Add-ons (`SavedAddOnPicker`, price, quantity, which tiers). Donation toggle when D1 is live and eligible (§10) | TICKETED, or donations eligible | S | `#add-ons` | `/organizations/:orgId/events/:id/add-ons` routes; D1's gift fields via `PATCH` |
| — | `discounts` | (reserved) | — | never in v1 (T1) | — | — | — |
| 8 | `vendors` | Vendor applications | Forms with `purpose VENDOR` (§5.2) | always | S | `#get-involved` | Form routes (§7.3) |
| 9 | `floor-map` | Floor map | Blank map / from a saved floor plan / open builder; map status | some VENDOR form has `spaceSelection MAP` | S | `#floor-map` | `POST /admin/maps`, `mapsApi.createFromFloorPlan`; builder opens full screen with `returnTo` |
| 10 | `special-guests` | Special guests | Forms with `purpose SPECIAL_GUEST` (§5.2); guest lineup (050-Q) | always | S | `#guests` (lineup) / `#get-involved` | Form routes; lineup routes (§7.6) |
| 11 | `volunteers` | Volunteers | Forms with `purpose VOLUNTEER`, business step off by default; shifts in phase 2 | always | S | `#get-involved` | Form routes |
| 12 | `other-applications` | Other applications | Forms with `purpose` SPONSOR / PRESS / PANEL / OTHER, picked per form | always | S | `#get-involved` | Form routes |
| — | `reminders` | (reserved) | — | never in v1 | — | — | — |
| 13 | `review` | Review and publish | Readiness checklist (blockers link to their step), brand summary (read-only, link to Settings › Brand), resolved tax rate, forms with "Open applications when I publish", donation suggestion (§10), **Open full preview**, **Publish** / **Save as draft** (create) or **Publish** / status (edit) | always | — | page top | `GET …/readiness`; `POST …/publish {openFormIds}`; `PATCH {setupCompleted:true}` |
| 14 | `done` | Your event is live / Saved as draft | Cards: View page, Copy link, Go to event, Review applications (if forms) or Set up door check-in | create mode only, after Review | — | page top | — |

"Step n of N" counts visible steps 1–13 (Done is not a step). Steps 1–2 stay in the list and the count after the row exists (050-H), so N never changes under the organizer and the bar never moves backwards; after the create they PATCH like any other step. Only the name step's "Start from a past event" entry is limited to before the row exists.

### 5.2 Application steps (8, 10, 11, 12)

One container, `ApplicationsStep({ purposes, defaults })`, renders all four:

- **Empty state:** one sentence on what this form is for and a primary "Add a vendor application" (label per purpose). No form is created until the organizer asks.
- **Add:** a small dialog: name (prefilled "<Event> Vendor Application"), **Start from** (Blank with Jump defaults for the purpose, or the org's templates filtered to that purpose, falling back to same-kind templates without a purpose), and for vendors "Charge for space" (PAID) on/off. Other applications also asks the purpose.
- **List:** one card per form: name, purpose chip, status (Draft / Open / Closed), kind, question count, "Edit" (expands inline), Delete (only with no submissions; else Close).
- **Edit (inline, one form expanded at a time):** `SettingsCard`, `TiersCard` (vendor/sponsor PAID only), `QuestionsCard` from `FormEditorCards.tsx`, unchanged components; the wizard passes `mode="event"`. Vendors also choose **How vendors pick a space**: "From a list of categories" (TIERS) or "On a floor map" (MAP). Choosing MAP makes the Floor map step appear in the progress bar at once.
- **Defaults per purpose** live in `backend/src/services/applicationFormDefaults.js`, used by `createForm` when no template is given, so the CLI and MCP get the same forms:
  - VENDOR: PAID-capable, business step on, questions: products sold, power needed, table count.
  - SPECIAL_GUEST: FREE, business step on (bio, socials, photos fit the profile), questions: appearance fee expectations (long text), travel needs, A/V needs, availability (multi-choice days).
  - VOLUNTEER: FREE, business step **off**, questions: availability (multi-choice days), roles of interest (multi-choice), T-shirt size (single choice), emergency contact (short text).
  - SPONSOR / PRESS / PANEL / OTHER: current blank defaults.

### 5.3 Visibility and role

Every step is visible to ORGANIZER, ADMIN and SYSTEM_ADMIN once 050-E lands. UNASSIGNED never reaches `/admin`. Before 050-E merges, the wizard flag must stay off (050-P checklist).

## 6. Data model

All changes are additive. Migrations add columns or enum values, never drop or rename, and replay clean in CI's migration-safety job. No new model goes unmapped: `backend/src/audit/features.js` gains every new model (spec 048 unit test).

### 6.1 Event (050-A, 050-D)

```prisma
model Event {
  // existing …
  capacity          Int?        // was Int. Null only while DRAFT; publish requires it for TICKETED
  endDate           DateTime?   // optional end, venue wall clock, after `date`
  setupStep         String?     // last wizard step key reached (resume point)
  setupCompletedAt  DateTime?   @default(now())  // null = wizard create still running
  setupRequestId    String?     @unique          // idempotency key of the wizard create
  salesClosedAt     DateTime?   // 050-D: set = checkout, RSVPs and new applications off
  salesClosedById   String?     // 050-D: who closed (no FK, audit trail has the rest)
}
```

- **Migration `…_event_setup_wizard` (050-A):** `ALTER COLUMN capacity DROP NOT NULL`; `ADD COLUMN end_date`, `setup_step`, `setup_request_id` (+ unique index); `ADD COLUMN setup_completed_at TIMESTAMP(3) DEFAULT now()`. PG 11+ stores a non-volatile default without rewriting, and every existing row reads the migration timestamp, which **is** the backfill: no existing event can enter setup mode. A CHECK `capacity IS NOT NULL OR status = 'DRAFT' OR admission_mode = 'RSVP'` keeps nulls on drafts only.
- **Defaults keep old writers safe.** `createEvent` without `setup: true` (old form, CLI, MCP, seeds) sets `setupCompletedAt` by the column default and still requires capacity and tiers as today. Only `setup: true` writes `setupCompletedAt: null` and relaxes the rules (no tiers, no capacity, status DRAFT).
- **`endDate` validation:** must be after `date`; cleared with `null`. `duplicateEvent` shifts it by the same offset as `date`.
- **Capacity readers** (`.capacity` in `PriceTierService.js:39`, `:125`; `DashboardService.js:77`, `:167`; `admin.js:1057`, `:1191`; `EventService` analytics and summary; frontend `EventsSummary`, `UpcomingEvents`, analytics pages, `EventOverviewSections`, `EventFlyouts`) treat null as "not set": the tier-sum ceiling check is skipped while capacity is null (the Tickets step asks for capacity first and publish re-checks the sum), aggregates use `?? 0`, UI renders "Capacity not set". Types become `capacity: number | null`.
- **Migration `…_event_close_sales` (050-D):** `ADD COLUMN sales_closed_at`, `sales_closed_by_id`. Nullable, no backfill.
- **Audit:** `Event` is already mapped (`features.js:34`); the new columns need nothing.

### 6.2 ApplicationForm.purpose (050-B)

```prisma
enum ApplicationFormPurpose { VENDOR SPONSOR PRESS PANEL SPECIAL_GUEST VOLUNTEER OTHER }
model ApplicationForm { purpose ApplicationFormPurpose @default(OTHER) }
```

- **One migration** (the enum type is new; only `ALTER TYPE … ADD VALUE` would need its own transaction): `CREATE TYPE`, `ADD COLUMN purpose … NOT NULL DEFAULT 'OTHER'` (constant default, no rewrite), then a backfill `UPDATE` in the same migration that mirrors `GetInvolved.tsx:16-22` in order: `name ~* 'vendor|exhibit|booth|merchant|artist'` → VENDOR, `sponsor` → SPONSOR, `press|media` → PRESS, `panel|speaker|talk` → PANEL, `volunteer` → VOLUNTEER, `guest|celebrity|talent` → SPECIAL_GUEST; remaining PAID event forms → VENDOR; everything else stays OTHER. Standing forms get the same rules (harmless, used only for labels).
- **Templates:** `ApplicationFormTemplate` is a JSON snapshot; `purpose` becomes an optional snapshot key validated by the form validators and materialised through `_materialise` (gotcha 18). Old snapshots without it materialise as OTHER unless the caller passes a purpose. No migration.
- **Unit test** runs the backfill statement against fixture names (the spec 049 pattern, `orgBrandIdentityMigration.test.js`).
- **Audit:** `ApplicationForm` is mapped (`features.js:58`).

### 6.3 Guest lineup (050-Q, phase 1)

```prisma
model EventGuest {
  id            String   @id @default(cuid())
  eventId       String
  name          String          // ≤ 120
  role          String?         // "Voice actor", "Panel host" ≤ 80
  bio           String?         // plain text ≤ 600, rendered as text, never HTML
  imageId       String?
  links         Json?           // same host rules as socialLinks (SETTINGS_GROUPS.social)
  applicationId String?         // set when added from an approved SPECIAL_GUEST application
  isVisible     Boolean  @default(true)
  displayOrder  Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  event         Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)
  image         Image?       @relation(fields: [imageId], references: [id], onDelete: SetNull)
  application   Application? @relation(fields: [applicationId], references: [id], onDelete: SetNull)
  @@index([eventId, displayOrder])
}
```

- New table, no backfill. Audit: `EventGuest: { feature: 'Events', label: 'name', org: 'event.venue' }`.
- **Data rights (gotcha 30):** a row created from an application copies the applicant's name, bio, photo and links. `BuyerDataExportService.build` lists lineup rows linked to the contact's applications; `ContactErasureService.erase` deletes those rows (it is organizer-published content about the person, not a ledger record). Manually typed rows have no contact and are out of scope.
- `duplicateEvent` does **not** copy the lineup: guests are per edition.

### 6.4 Volunteer shifts (050-R, phase 2)

```prisma
model VolunteerShift {
  id String @id @default(cuid())
  formId String                 // VOLUNTEER form; the event comes through the form
  name String                   // role or shift label, ≤ 80
  startsAt DateTime?            // venue zone, optional (role without a time)
  endsAt DateTime?
  capacity Int?                 // null = unlimited
  description String?
  displayOrder Int @default(0)
  form ApplicationForm @relation(fields: [formId], references: [id], onDelete: Cascade)
  picks ApplicationShift[]
}
model ApplicationShift {
  applicationId String
  shiftId String
  assigned Boolean @default(false)   // organizer confirmed this shift on approval
  @@id([applicationId, shiftId])
}
```

New tables only. Audit: `VolunteerShift: { feature: 'Applications', label: 'name', org: 'form', event: 'form' }`, `ApplicationShift: { feature: 'Applications', org: 'application', event: 'application' }`. Capacity counts `assigned` rows (on approval), never submissions, so a popular shift never refuses an application. Export/erasure: shift picks belong to the application and go wherever its answers go.

## 7. API

All event routes stay `requireAuth → requireOrganizer → requireOrgMembership()` under `/organizations/:orgId/events` unless stated.

### 7.1 Event create and update (050-A)

- `POST /organizations/:orgId/events` accepts `setup: true`. With it: `name`, `venueId`, `date` required; `capacity` and `priceTiers` optional; `endDate` optional; header `Idempotency-Key` stored as `setupRequestId` (a replay returns the existing row, 200). Without it: unchanged.
- `PATCH /organizations/:orgId/events/:eventId` adds `endDate` (ISO or null), `setupStep` (one of the registry keys, validated against a backend list), `setupCompleted: true` (sets `setupCompletedAt` once), and `capacity: null` (DRAFT only; 409 `CAPACITY_REQUIRED` otherwise). Partial PATCH pattern (root AGENTS "Backend Patterns").

### 7.2 Readiness and publish (050-C)

- `GET /organizations/:orgId/events/:eventId/readiness` → `{ ready, blockers: [{ code, step, message }], warnings: [{ code, step, message }] }`. `EventReadinessService.check(orgId, eventId)` is the only implementation; `publishEvent` calls it and answers 422 `EVENT_NOT_READY` with the same `blockers`.
  - Blockers: `DATE_IN_PAST` (date), `CAPACITY_MISSING` (tickets, TICKETED), `NO_ACTIVE_TIER` (tickets, TICKETED), `TIERS_EXCEED_CAPACITY` (tickets), `END_BEFORE_START` (date).
    - `NAME_MISSING` (name): the name is blank.
    - `VENUE_MISSING` (venue): the event has no venue.
    - `PAYMENTS_UNAVAILABLE` (review, TICKETED): an active tier has a price while Connect is on and `ConnectService.chargeAccountFor` refuses. Settings › Payments fixes it, so organizers without `settings.payments` see "An admin needs to finish payments setup" instead of a link.
  - Warnings: `NO_DESCRIPTION`, `NO_IMAGE`, `MAP_FORM_WITHOUT_PUBLISHED_MAP` (floor-map), `PAID_FORMS_DISABLED` (vendors/other; `APPLICATIONS_PAYMENTS_ENABLED` off), `FORM_HAS_NO_QUESTIONS`, `TAX_RATE_UNRESOLVED` (Review; `TaxService` threw, gotcha 12).
  - RSVP events skip tier and capacity checks (gotcha 29: branch on `admissionMode`).
- `POST …/publish` body `{ openFormIds?: string[] }`. In one transaction: status PUBLISHED, `setupCompletedAt` if null, listed DRAFT forms → OPEN (PAID refused when the payments gate is off, reported per form in the response, never failing the publish). Tax refresh as today (`EventService.js:432`).

### 7.3 Forms, templates, add-ons: role change (050-E)

Drop `requireAdmin` (the admin router already applies `requireOrganizer`, `admin.js:75`) on:

- `POST /admin/events/:eventId/application-forms`, `PATCH|DELETE /admin/events/:eventId/application-forms/:formId`, `POST …/:formId/save-as-template`
- `POST /admin/events/:eventId/application-forms/:formId/tiers`, `PATCH|DELETE …/tiers/:tierId`, `PUT …/tiers/:tierId/add-ons`
- `POST …/:formId/questions`, `PATCH …/questions/reorder`, `PATCH|DELETE …/questions/:questionId`
- `POST /admin/application-templates`, `PUT|DELETE /admin/application-templates/:templateId`
- `addOns.js` writes (`/organizations/:orgId/events/:eventId/add-ons`): `POST /`, `POST /attach`, `POST /reorder`, `PATCH /:addOnId`, `POST /:addOnId/activate`, `POST /:addOnId/deactivate`, `DELETE /:addOnId` → `member` instead of `admin`.
- `savedAddOns.js` writes (`/organizations/:orgId/saved-add-ons`): `POST /`, `PATCH /:id`, `POST /:id/archive`, `POST /:id/unarchive` (the wizard's picker creates saved add-ons in place).

Unchanged (ADMIN): application refund, waive, offline payment (`admin.js:878`, `:899`, `:903`), `RefundService.refundOrder` callers, every `/admin/settings/*` write, standing forms (`admin.js:661-693`). Frontend `canEdit` checks in `AddOnsSection.tsx:70`, `templates/[templateId]/page.tsx:63`, `applications/forms/page.tsx:29` become organizer-or-above.

Form body additions (050-B): `purpose` (enum; immutable once the form has submissions), `collectBusiness: false` accepted for FREE event forms (`ApplicationFormService.js:223`, `:388`), and SPECIAL_GUEST/VOLUNTEER refuse `kind: PAID` (400 `PURPOSE_KIND_MISMATCH`). `GET /admin/events/:eventId/application-forms` and the public `GET /events/:eventId/applications/forms` carry `purpose`.

### 7.4 Unpublish, close and reopen sales (050-D)

- `POST …/:eventId/unpublish` → DRAFT. 409 `UNPUBLISH_BLOCKED` with `reasons` when any of: an `Order` for the event with status not in (`FAILED`, `CANCELLED`); a GOING `EventRsvp`; an `Application` with status other than DRAFT. Forms keep their status; their public pages 404 while the event is a draft (`ApplicationFormService.js:641`, `:653`). Clears `salesClosedAt`.
- `POST …/:eventId/close-sales` → sets `salesClosedAt`, `salesClosedById`. PUBLISHED only (409 otherwise), idempotent.
- `POST …/:eventId/reopen-sales` → clears them. PUBLISHED only, idempotent.
- Enforcement, one helper `assertSalesOpen(event)` (409 `SALES_CLOSED`) called in `OrderService.createOrder` (next to `:216`), `RsvpService` create (next to `:59`) and `ApplicationService.submit` (`:332`). Not in `ApplicationService.select`/pay, scanning or check-in.
- Public payload (`_formatEventDetail(publicView)`) gains `salesClosed: boolean`; the event page hides the cart and RSVP form and shows "Sales are closed"; `GetInvolved` hides apply pills; the apply page shows "Applications are closed".
- Admin: `EventActionsMenu` gets **Close sales…** / **Reopen sales** and **Unpublish…**. No pre-check endpoint: the unpublish dialog shows the 409 `reasons` in text when refused. Close sales sits directly above Cancel.

**Interaction with PR #180** (open, `paperclip/EVE-13`: cancel voids VALID tickets, notifies holders, blocks scans on cancelled events):

- Unpublish and #180 never overlap: unpublish is refused while any live order exists, so there are no tickets to void.
- Close sales keeps the event PUBLISHED, so Cancel from a sales-closed event still passes `cancelEvent`'s PUBLISHED guard and #180's void + notify apply. Cancel clears nothing it does not need: `salesClosedAt` stays as history.
- #180's `_assertEventNotCancelled` blocks scans on CANCELLED only; close sales must not add a scan check (tickets stay valid).
- A checkout in flight when sales close still completes through the webhook, same as a tier `saleEndDate` passing mid-checkout. Documented, not blocked.
- Both PRs edit `EventService.js` around `cancelEvent`. Land #180 first, or 050-D rebases on it; the 050-D tests include "close sales then cancel voids tickets" only once #180 is on main.

### 7.5 Previews (050-F)

- `POST /organizations/:orgId/events/:eventId/preview-link` → `{ url, expiresAt }`. `EventPreviewService.mint` mirrors `ThemePreviewService` (`ThemePreviewService.js:21-36`): HS256 on `STOREFRONT_PREVIEW_SECRET` (or the derived secret), **audience `event-preview`** (never valid as a theme or session token), payload `{ orgId, eventId }`, 1 h, staff only, no share variant. URL = `<storefront base>/api/events/preview?token=…`.
- Next route `frontend/src/app/api/events/preview/route.ts` verifies nothing itself: it sets a host-only, httpOnly `jump_event_preview` cookie (path `/`, 1 h) and redirects to the event path. The event page server fetch and `EventDetailClient` loader forward it as `X-Event-Preview`; `getEventById` accepts a DRAFT event when the header verifies for that event's org. Response adds `preview: true`; the page shows a "Preview, not published" bar, `noindex`, and disables checkout, RSVP and apply.
- `GET /organizations/:orgId/events/:eventId/preview-payload` (organizer) → the public event shape (`_formatEventDetail(event, { publicView: true })`) regardless of status, plus org identity (`publicOrganizationIdentity`, brand, theme mode), public forms with `purpose`, add-ons, gifts block when D1 exists, and `guests` (050-Q). The wizard overlays unsaved field values on it.

### 7.6 Guest lineup (050-Q)

- `GET|POST /organizations/:orgId/events/:eventId/guests`, `PATCH|DELETE …/guests/:guestId`, `POST …/guests/reorder { ids }`, `POST|DELETE …/guests/:guestId/image` (`ImageService`, `event_guest` square variant). ORGANIZER.
- `POST /admin/events/:eventId/applications/:applicationId/add-to-lineup` → creates a row from an APPROVED SPECIAL_GUEST application's profile (name, description → bio, first photo, socials). 409 when already in the lineup.
- Public event payload gains `guests: [{ id, name, role, bio, imageUrl, links }]` (visible rows, ordered).

### 7.7 Duplicate (050-I)

`POST …/:eventId/duplicate` accepts `setup: true`: the copy gets `setupCompletedAt: null`, `setupStep: 'date'`. Without it, unchanged (the list's Duplicate dialog creates a complete copy).

## 8. Frontend architecture

### 8.1 Routes and shell

- `/admin/events/new` → with `NEXT_PUBLIC_EVENT_WIZARD_ENABLED=true`, the wizard at steps 1–3 (no row yet); otherwise today's form. `/admin/events/[eventId]/setup?step=<key>` → the wizard on an existing event. `/admin/events/preview-frame` → chrome-less preview document for the iframe.
- `AdminLayoutClient.tsx:17` `FULL_SCREEN` gains `^/admin/events/(new|preview-frame|[^/]+/setup)/?$` (only when the flag is on for `new`). The wizard keeps `AdminRoute`, `OrgProvider` and the edge middleware guard.
- `useSearchParams()` (`step`, `venueId`, `tier`) lives inside a `<Suspense>` boundary (root AGENTS).
- Components, each under 200 lines, containers apart from presentation, in `frontend/src/components/event-setup/`:
  - `EventSetupPage` (container: loads event/org/forms/readiness, owns step state and save state)
  - `SetupShell` (layout only: header, progress, panes, footer slots)
  - `SetupHeader` (Exit / Save & exit, save-state indicator, mobile menu and eye buttons)
  - `SetupProgress` (`<ol>` progress)
  - `StepMenu` ("Jump to edit…", desktop side panel / mobile `Flyout`)
  - `SetupFooter` (Back / Skip for now / Next)
  - `PreviewPane` (frame, phone/desktop toggle, scaling) + `PreviewSheet` (mobile)
  - `useStepSave` (autosave/debounce/explicit save, error and retry), `useUnsavedGuard` (`beforeunload` + in-app navigation confirm, from `EventEditor`'s dirty snapshot pattern)
  - one file per step under `steps/`, each composing existing editors
- **Reused, not rewritten:** `SlugField`, `VenueFlyout`, `VenueTimeZoneField`, `lib/eventTime.ts` (`zonedInputToInstant`, `instantToZonedInput`, `formatEventTime`), `RichTextEditorField`, `EventMediaCard`, `AdmissionModeField`, `RsvpSettingsFields`, `TierCard`, `TierEditDialog`, `TierPresetMenu`, `SavedAddOnPicker`, `FormEditorCards` (`SettingsCard`, `TiersCard`, `QuestionsCard`), `Flyout` (focus trap, Escape, bottom sheet), `CapacityMeter`, `DuplicateEventDialog` fields. Where a component only lives inside `EventEditor.tsx` (tier form mapping `tierToForm`, `newTierForm`, `EventTaxSummary`), it moves to `components/events/` first so both the old editor and the wizard import it until 050-P deletes the editor.

### 8.2 `EventPageView` extraction (050-G)

`EventDetailClient.tsx` (1,003 lines) becomes:

- `EventDetailClient` (container): fetch, cart state, checkout handoff, dialogs.
- `EventPageView({ event, org, preview, cart?, on… })` (presentation) inside `BrandScope` with the org's `brandColor` and `themeMode` (gotchas 6/7, never `setTheme`).
- Section components: `EventHero` (`#event-hero`, `#event-hero-image`, `#event-date`, `#event-venue`), `EventAbout` (`#about`, via `ContentHtml`), `EventTickets` (`#tickets`, `TierStub`, all-in prices via `computeTierAllInPrice`), `EventRsvp` (`#rsvp-pass`), `EventAddOns` (`#add-ons`), `GetInvolved` (`#get-involved`, label from `purpose`), `FloorMapButton` (`#floor-map`), cart (desktop sticky + mobile sheet), and later `EventGuests` (`#guests`, 050-Q).
- `preview` disables cart, checkout, RSVP submit and dialogs, and renders unset fields as faded placeholders ("Add a date", "$ –").
- Ticket steppers stay usable in the 050-F draft preview (the container passes handlers; checkout stays off). Any control whose handler is missing (the wizard pane) is `aria-disabled` and stays focusable, with `aria-describedby` pointing to a visible note ("Checkout is off in preview", "RSVP is off in preview").
- No visual or behaviour change for buyers. Existing specs (`event-ticket-tiers`, `event-rsvp-pass`, `eventDescriptionHtml`, add-on and checkout specs) are the regression net.
- End time: the hero renders "4:00 – 8:00 PM EDT" (same zone, `formatEventTime`) when `endDate` is set.

### 8.3 Preview pane

- The iframe loads `/admin/events/preview-frame`. The parent posts `{ type: 'jump:event-preview', payload, anchor }` with `targetOrigin = window.location.origin`; the frame checks `event.origin` and renders `EventPageView` with `preview`. Only same-origin messages are honoured.
- **Phone** = 390 × 844 viewport frame; **Desktop** = 1280 wide scaled with `transform: scale()` to the pane width. The toggle is a two-option radio group ("Phone" / "Desktop"), not an icon-only switch.
- **Scroll to section:** on step change the parent posts the step's anchor; the frame scrolls its own document (`window.scrollTo` inside the iframe, `behavior: 'auto'` under reduced motion). Never `scrollIntoView` on the admin frame (`frontend/AGENTS.md:54`).
- **Themed orgs** render unthemed in-pane (content-accurate, research §5.3). "Open full preview" on Review (and in the header menu) mints the signed link (050-F) and opens the real themed page in a new tab.
- Before the row exists (steps 1–2) the payload is built client-side from the org identity and the chosen venue.

### 8.4 Edit links into the wizard (050-O)

With the flag on, on `/admin/events/[eventId]` (`page.tsx:139-140`, `:181`, `:230-248`):

| Details section | Opens |
|---|---|
| Hero "Edit event" | `setup?step=name` |
| When & where (`WhenWhereCard`) | `setup?step=date` (venue is one step back) |
| Description (`DescriptionSection`) | `setup?step=description` |
| Sales (`SalesSection`), tier Edit | `setup?step=tickets`, `&tier=<id>` opens that tier's dialog |
| RSVP (`RsvpSection`), Admission (`AdmissionCard`) | `setup?step=tickets` |
| Applications (`ApplicationsSection`) form settings | `setup?step=<step of the form's purpose>&form=<id>` (expanded) |
| Map (`MapCard`) | `setup?step=floor-map` when a MAP form exists, else the Map tab |
| Listing (`ListingCard`) | `setup?step=description` (category) |
| Add-ons | `setup?step=collect-more` |

- `AdmissionFlyout`, `ListingFlyout`, `TierFlyout`, `FormSettingsFlyout` stop being mounted (deleted in 050-P).
- `/admin/events/[id]/edit`, `/edit/details`, `/edit/sales` redirect to the matching step (hash → step map replaces `SALES_SECTIONS`, `edit/page.tsx:10`), so bookmarks and email links keep working.
- Save & exit always returns to `/admin/events/[id]` with a "Saved" notice.

### 8.5 Removing the event-level forms configuration (050-P)

- `applications/forms/page.tsx` and `applications/forms/[formId]/page.tsx` become redirects to `setup?step=<purpose step>[&form=<id>]`.
- The Applications tab (`applications/page.tsx`, `ApplicationsHeader.tsx`) keeps `SubmissionsTable`, filters, decisions, CSV; its "Forms" / "New form" entry becomes "Manage forms" → `setup?step=vendors` (or the step of the form in context).
- `SubmissionsTable` links that point at `applications/forms` (found by `grep`) point at the wizard step.
- The template editor `/admin/events/templates/[templateId]` stays (org-level saved item, gotcha 18 "saved items live where they are used"); "Start from" in the wizard is its entry.

## 9. Migration of existing events and forms

- **Events:** `setupCompletedAt` default `now()` marks every existing row (draft, published, cancelled) as set up. None shows "Continue setup" or opens the linear flow; Edit opens the wizard in edit mode. Existing drafts keep their capacity (non-null).
- **Forms:** the 050-B backfill gives every form a purpose; anything unmatched is OTHER and appears in the **Other applications** step, where the organizer can change its purpose (allowed while it has no submissions; with submissions, purpose is fixed and the step shows it read-only).
- **Prod dry run** before 050-B deploys: `SELECT purpose, count(*)` grouped after running the backfill on a snapshot; RRG's vendor, sponsor and press forms must land on VENDOR / SPONSOR / PRESS.
- **No data moves** for unpublish or close sales.
- **E2E rewrite (050-P):** `admin-event-form-layout.spec.ts`, `admin-venue-flyout.spec.ts` (`/admin/events/new`), and the forms-config parts of `applications.spec.ts`, `participants-templates.spec.ts`, `add-ons.spec.ts`, `applications-add-ons.spec.ts`, `event-ticket-tiers.spec.ts`, `admin-event-details.spec.ts` move to the wizard routes.

## 10. Donation toggle (spec 047 D1 dependency)

- 050 builds no gift columns and no gift UI. D1 owns `Event.acceptGifts`, `giftWithoutTicket`, `giftPresetAmounts`, `giftAppeal` and the eligibility answer.
- **D1 plan amendment needed:** D1 §4.6 puts its "Donations" card on the Sales editor (`admin/events/[eventId]/edit/sales`), which 050-P deletes. D1's card becomes a component mounted in the **Collect more** step, plus a one-line suggestion on Review ("Accept donations on this event?" → Collect more) for eligible orgs. Whichever of D1 and 050-K lands second wires it in. D1 §4.4 also edits `EventDetailClient`; if 050-G lands first, D1 targets `EventPageView`.
- Visibility rule in the registry: `NEXT_PUBLIC_DONATIONS_ENABLED` and the org eligibility flag from D1's payload (Connect direct charges on, DV-verified, `DONATION_TERMS` accepted). Until then the Collect more step is visible only for TICKETED events (add-ons).

## 11. UI design contract

Load the `frontend-ui-engineering` skill before implementing **any** UI card. The `ui-ux-pro-max`, `design-motion-principles` and taste skills are advisory within the limits in root AGENTS.

### 11.1 Job and primary action

- The screen's job: get an organizer from nothing to a correct, publishable event in one sitting, or back into one field of an existing event in one click.
- One primary action per screen: **Next** (steps), **Publish** (Review), **Go to event** (Done). Secondary actions are visually quieter (outline or text buttons). Destructive actions (delete form, remove tier) are text buttons with confirmation.

### 11.2 Layout

- **Full-screen shell**, no admin sidebar. Header (56 px): Eventimus mark or event name, **"Step n of N, <name>"** as text, save-state indicator, Exit / Save & exit. Under it a progress bar (4 px fill plus the `<ol>` steps, labels visible ≥ 1024 px).
- **Desktop (≥ 1024):** form pane (max 640 px content width, left) + live preview pane (right, remaining width, neutral `gray-50/slate-900` background, no dotted canvas). In edit mode the "Jump to edit…" list is a 240 px left rail that collapses to a button at 1024–1279.
- **Tablet (768–1023):** single form column, preview behind the eye button, step menu behind the menu button.
- **Mobile (320–767):** single column; header becomes [☰ step menu] [👁 preview] [Save & exit] (lucide `Menu`, `Eye`), each a 44 × 44 labelled button. Preview opens in a full-screen sheet (`Flyout` bottom-sheet variant), step menu in a sheet.
- **Footer:** sticky, `padding-bottom: max(12px, env(safe-area-inset-bottom))`: Back (left, text), Skip for now (when the step is S and empty) and Next (right, primary). On Review the primary is Publish.
- **Breakpoints to verify:** 320, 768, 1024, 1440. No horizontal scroll at 320; form controls full width below 768.
- **Tokens:** admin Tailwind/shadcn conventions (`inputClass`, `labelClass`, `hintClass`, `FormCard`, accent tokens); preview colours only from `BrandScope` `brand` tokens; icons lucide-react only. No indigo, no gradients, no `rounded-2xl` everywhere (cards `rounded-lg`), no stacked shadows (one border or `shadow-sm`), no oversized padding (form cards `p-4 sm:p-6`).

### 11.3 States (every step)

| State | Treatment |
|---|---|
| Loading | Skeleton of the step's own fields (not a page spinner); preview pane shows a skeleton frame |
| Empty | One-sentence purpose + one primary action (e.g. "No vendor applications yet" + "Add a vendor application") |
| Error (load) | Inline alert with what failed and **Try again**; the rest of the shell stays usable |
| Error (save) | Indicator "Couldn't save — Retry" (button), field-level messages where the API returned field errors |
| Success | Indicator "Saved" (with time on hover/title); Publish success moves to Done with the heading focused |
| Permission | UNASSIGNED never arrives; a 403 shows "You don't have access to change this" with a link back to the event, fields read-only |
| Locked | Disabled control + reason in text (e.g. admission mode locked once tickets sold, purpose fixed once submissions exist) |

### 11.4 Accessibility (WCAG 2.1 AA)

- **Step change:** focus moves to the step `<h1>` (`tabIndex={-1}`); a polite `aria-live` region announces "Step 4 of 12, Describe it". Browser history: each step is a URL (`?step=`), so Back works.
- **Progress:** `<ol aria-label="Setup steps">`, the current item `aria-current="step"`. Each item has text + icon for state: completed (`Check`, "Completed"), current, blocked (`AlertTriangle`, "Needs attention"), skipped ("Skipped"), visually hidden text where the label alone does not say it. Never colour alone.
- **Validation:** fields use `aria-invalid` and `aria-describedby` (hint + error ids). A failed Next renders an error summary at the top of the step (`role="alert"` container with links to each field), which receives focus; the first link jumps to the field.
- **Dialogs and sheets** (`Flyout`, `TierEditDialog`, add-form dialog): focus trap, Escape closes (with the dirty guard), focus returns to the opener.
- **Touch targets** ≥ 44 × 44 px. `prefers-reduced-motion`: no slide between steps, no smooth scrolling, no progress animation. Motion otherwise ≤ 200 ms, opacity/transform only.
- **"Jump to edit…" menu:** a `<nav aria-label="Jump to edit">` with a list of links; arrow keys not required (Tab order is the list order), each link names its state ("Tickets, needs attention"). In the mobile sheet, focus starts on the current step.
- **Preview pane:** `<section aria-label="Live preview of the event page">` with the iframe `title="Event page preview"`. It is not a focus trap; Tab moves past it. When hidden (mobile/tablet, sheet closed) it is `inert` and `aria-hidden`. Preview scrolling happens inside the iframe document only.
- **Contrast:** text and controls ≥ 4.5:1 (3:1 for large text and UI component boundaries) in light and dark; faded preview placeholders are real text ("Add a date", "$ –"), not `aria-hidden` and not colour alone, and keep 4.5:1 in light and dark.
- **Language:** plain verbs ("Add", "Publish"), sentence case, no "Oops".

### 11.5 Save behaviour

- Indicator text, in a `role="status"` element: **"Saved"**, **"Saving…"**, **"Couldn't save — Retry"**. Never only an icon.
- **DRAFT:** autosave 800 ms after the last valid change per field group, plus on Next/Back/step menu. Invalid fields are not sent; the indicator says "Not saved: fix 1 field".
- **PUBLISHED:** no autosave. Next = save and continue; a "Save" button replaces autosave; the indicator shows "Unsaved changes" while dirty.
- **Unsaved-changes guard:** `beforeunload` plus a confirm on Exit, step menu jumps and in-app navigation while a save is pending or failed.
- Dialog-based items (tiers, add-ons, forms, questions) save on their own dialog Save, as today.

### 11.6 Patterns to reject

- Indigo/violet accents, gradients, glassmorphism, dotted "canvas" backgrounds, emoji in UI copy.
- `rounded-2xl` on everything, card-in-card-in-card, shadow stacks, hero-sized padding on form screens.
- Icon-only buttons without an accessible name; a toggle switch for phone/desktop.
- Colour-only step states or error states.
- Disabled Next with no explanation (Next is always enabled; a failed Next shows the error summary).
- Auto-advancing steps, carousels, confetti on Done, a satisfaction survey.
- `scrollIntoView` or `#anchor` jumps in the admin frame.
- A second form for a field the wizard already owns (flyouts, section editors).
- Per-event colour, font or theme controls; `setTheme` anywhere.
- Ad-hoc all-in price maths (`lib/fees.ts` only, gotcha 12); time inputs outside `lib/eventTime.ts` (gotcha 28).

### 11.7 Per-card UI acceptance (applies to every UI card below)

1. `frontend-ui-engineering` skill loaded before implementing; components < 200 lines; containers separate from presentation.
2. Loading, empty, error, success and permission states implemented for every screen the card touches.
3. Renders without horizontal scroll at 320, 768, 1024, 1440 in light and dark.
4. Keyboard-only run of the card's flow; focus order and focus return verified.
5. Playwright: `signInAsStaff`, all API mocked with `page.route`, assertions scoped to visible elements (the preview duplicates names), one run at 390 × 844, and an axe scan (`@axe-core/playwright`, already used by e.g. `content-forms.spec.ts`) with zero serious/critical violations.

## 12. Cards

Each card is one PR with green required CI (`backend tests`, `frontend typecheck + unit`, `migration safety`, `playwright (1/3)–(3/3)`). Workers return PR URL, changed files, tests and results, migrations, commit SHA and remaining risks (`docs/development/kanban-workflow.md`). `--parent` = prerequisite. Backend foundations (A–F) can run in parallel worktrees. UI cards ship behind **`NEXT_PUBLIC_EVENT_WIZARD_ENABLED`** (frontend, build-time, default off) until 050-O reaches parity; then the flag is turned on in prod and 050-P deletes the old paths and the flag.

### Phase 1 — foundations (backend first)

**050-A Event draft fields** · parent: none
- Scope: §6.1 migration (capacity nullable + CHECK, `endDate`, `setupStep`, `setupCompletedAt` default now, `setupRequestId`); §7.1 create `setup: true` + idempotency; PATCH additions; null-capacity readers (backend + frontend types and "Capacity not set" rendering); `duplicateEvent` shifts `endDate`.
- Files: `packages/db/prisma/schema.prisma`, new migration, `eventValidators.js`, `EventService.js`, `PriceTierService.js`, `DashboardService.js`, `admin.js` (stats), frontend types in `services/` + the six capacity readers.
- Acceptance: old create path unchanged (contract tests still green); `setup: true` creates a DRAFT with no tiers and null capacity, `setupCompletedAt` null; replay with the same key returns the same row; `endDate ≤ date` → 400; `capacity: null` on PUBLISHED → 409; existing rows have `setupCompletedAt` set after migrate.
- Tests: contract (`events.test.js` additions), unit for the validators, migration replay in CI.

**050-B Form purpose** · parent: none
- Scope: §6.2 enum + column + backfill; `purpose` in form bodies, templates, admin and public payloads; `collectBusiness: false` on FREE event forms; purpose/kind rules; `applicationFormDefaults.js` (per-purpose defaults used by `createForm`); `GetInvolved` labels from `purpose` (regex deleted).
- Files: schema, migration, `ApplicationFormService.js`, `ApplicationFormTemplateService.js`, form validators, `admin.js` form routes, `GetInvolved.tsx`, `lib/applications.ts`.
- Acceptance: backfill maps fixture names correctly; a FREE VOLUNTEER form with `collectBusiness: false` submits without the business step (public apply page already supports it for standing forms); PAID SPECIAL_GUEST → 400; purpose change with submissions → 409; template round-trips purpose.
- Tests: migration-statement unit test, contract tests for create/patch/template/public forms, Playwright `get-involved-labels.spec.ts` (mocked forms by purpose, 390 px, axe).

**050-C Readiness and publish** · parent: 050-A
- Scope: `EventReadinessService`, `GET …/readiness`, `publishEvent` through it (422 with blockers), `openFormIds`, sets `setupCompletedAt`. Details page Publish shows the blockers it returns (text list linking to the old editors until 050-O).
- Files: new `services/EventReadinessService.js`, `EventService.js`, `routes/events.js`, `admin/events/[eventId]/page.tsx`, `EventListCard.tsx`.
- Acceptance: each blocker and warning code covered; RSVP skips tier checks; publish opens only listed DRAFT forms; PAID form refused per form while the gate is off and the publish still succeeds.
- Tests: unit for the service, contract for readiness + publish, Playwright for the blocker list on Details (mocked, axe, 390 px).

**050-D Unpublish and close sales** · parent: none (rebase on PR #180 if it merged; §7.4)
- Scope: §6.1 close-sales migration, §7.4 endpoints and enforcement, `salesClosed` in the public payload, event page / apply page / `GetInvolved` closed states, `EventActionsMenu` items + confirm dialogs, Details hero status ("Sales closed" pill with text).
- Files: schema, migration, `EventService.js`, `OrderService.js`, `RsvpService.js`, `ApplicationService.js`, `routes/events.js`, `EventActionsMenu.tsx`, `EventDetailClient.tsx`, apply page, `GetInvolved.tsx`, events list card.
- Also (owner, §14 #1): "Delete draft…" for DRAFT events under the unpublish guards, confirmed in a dialog, with a contract test per guard.
- Acceptance: unpublish refused with reasons for an order, a GOING RSVP, a submitted application; allowed otherwise and the public page 404s; close sales blocks checkout (409 `SALES_CLOSED`), RSVP and new applications, not approved-vendor selection or scanning; reopen restores; idempotent calls.
- Tests: contract per guard and per enforcement point; Playwright `admin-event-close-sales.spec.ts` + `event-sales-closed.spec.ts` (mocked, axe, 390 px).

**050-E ORGANIZER configures forms and add-ons** · parent: none
- Scope: §7.3 route list; frontend `canEdit` checks.
- Acceptance: ORGANIZER gets 2xx on every listed route; ORGANIZER still 403 on refund, waive, offline payment, `RefundService` routes and settings writes; UNASSIGNED 403 everywhere; standing forms still ADMIN.
- Tests: one table-driven contract test over the route list for both outcomes (keeps future routes honest).

**050-F Event previews** · parent: none
- Scope: §7.5: `EventPreviewService`, preview-link route, `/api/events/preview` route handler, `X-Event-Preview` on the server fetch and client loader, preview bar + noindex + disabled actions; `preview-payload` endpoint.
- Acceptance: a staff link renders a DRAFT on platform host, custom domain and themed org; the token is refused as a session or theme token and after 1 h; a token for org A cannot open org B's event; preview disables checkout/RSVP/apply.
- Tests: unit (mint/verify/audience), contract (link, payload, `getEventById` with header), Playwright `event-draft-preview.spec.ts` (mocked, axe, 390 px).

**050-G `EventPageView` extraction** · parent: 050-A
- Scope: §8.2. Pure refactor plus the end-time rendering and section anchor ids.
- Acceptance: buyer-facing pages pixel-equivalent (existing specs green, no snapshot changes beyond the end time); every file < 200 lines; `preview` mode renders placeholders and no interactive commerce.
- Tests: existing event-page specs; new Vitest for placeholder rendering of `EventHero`; Playwright `event-page-preview-mode.spec.ts` (axe, 390 px). UI card: load `frontend-ui-engineering`.

### Phase 1 — wizard (behind the flag)

**050-H Wizard shell, preview pane, steps 1–3** · parent: 050-A, 050-F, 050-G
- Scope: §8.1 shell and components, step registry, `FULL_SCREEN` route, `/admin/events/new` (flag) and `[eventId]/setup`, preview frame route + `postMessage` + phone/desktop + mobile sheet, save hook + indicator + guard, focus/live-region handling, steps `name`, `venue`, `date` (create and edit), session draft.
- Acceptance: §11 contract for the shell; draft created once at step 3 and the URL moves to `setup`; refresh resumes at `setupStep`; flag off = old page untouched.
- Tests: Vitest for the registry (`visible`, counting, resume key) and `useStepSave` (debounce, retry, published = no autosave); Playwright `admin-event-setup-shell.spec.ts`: keyboard run of steps 1–3, error summary focus on failed Next, step announcement, preview toggle, mobile sheets at 390 px, axe. Load `frontend-ui-engineering`.

**050-I Done screen, Start from a past event, Continue setup** · parent: 050-H
- Scope: Done step; step-1 "Start from a past event" dialog (event picker, name, date in the source venue zone) → `duplicate {setup:true}` (§7.7) → `setup?step=date`; "Continue setup" on the list card, Details hero and dashboard attention list; Create Event buttons (`EventsPageHeader.tsx:61`, `venues/[venueId]/page.tsx:371` with `?venueId=`) unchanged in URL (the flag swaps the page).
- Tests: contract for `duplicate {setup:true}`; Playwright `admin-event-setup-entry.spec.ts` (390 px, axe). Load `frontend-ui-engineering`.

**050-J Steps: Describe, Image, Tickets or RSVP** · parent: 050-H
- Scope: steps 4–6 composing existing editors; tier dialog deep link `&tier=`; capacity warning; admission lock; duplicate tier action; helpers moved out of `EventEditor.tsx` (§8.1).
- Acceptance: tier sum > capacity warns inline and blocks only at publish; switching to RSVP hides tiers (gotcha 29); all dates through `lib/eventTime.ts`; previews show all-in prices from `lib/fees.ts`.
- Tests: Playwright `admin-event-setup-tickets.spec.ts` (ticketed + RSVP paths, tier dialog focus return, 390 px, axe). Load `frontend-ui-engineering`.

**050-K Step: Collect more (add-ons)** · parent: 050-E, 050-H
- Scope: step 7 with `SavedAddOnPicker` (create saved add-on in place), price, quantity, tier attachment; visibility rule from §10 (donation part waits for D1).
- Tests: Playwright `admin-event-setup-add-ons.spec.ts` as ORGANIZER (mocked 2xx), 390 px, axe. Load `frontend-ui-engineering`.

**050-L Application steps** · parent: 050-B, 050-E, 050-H
- Scope: §5.2 `ApplicationsStep` for vendors, special guests (forms only), volunteers, other applications; add dialog with Start from; inline `FormEditorCards`; TIERS/MAP choice; `&form=` deep link.
- Acceptance: several forms per step; purpose defaults applied; FREE-only purposes cannot pick PAID; delete only without submissions; ORGANIZER can do all of it.
- Tests: contract for `createForm` defaults per purpose; Playwright `admin-event-setup-applications.spec.ts` (two vendor forms, a volunteer form without the business step, other-application purpose picker, 390 px, axe). Load `frontend-ui-engineering`.

**050-M Step: Floor map** · parent: 050-L
- Scope: step 9 visibility on MAP; create blank / from floor plan; "Open map builder" (`/admin/maps/[mapId]?returnTo=`, builder honours `returnTo` on Done/Back); map status and the readiness warning link.
- Tests: Playwright `admin-event-setup-floor-map.spec.ts` (step appears/disappears with TIERS↔MAP, 390 px, axe). Load `frontend-ui-engineering`.

**050-N Step: Review and publish** · parent: 050-C, 050-F, 050-H
- Scope: step 13: readiness checklist with step links, brand summary (read-only), tax rate (`EventTaxSummary`), forms with "Open applications when I publish", Open full preview, Publish / Save as draft; donation suggestion slot wired by D1 (§10).
- Acceptance: blockers match `/readiness` exactly; Publish failure shows the error summary with links; success lands on Done with focus on its heading.
- Tests: Playwright `admin-event-setup-review.spec.ts` (blocked, warning-only and ready cases, 390 px, axe). Load `frontend-ui-engineering`.

**050-O Edit mode: section Edit opens the wizard** · parent: 050-I, 050-J, 050-K, 050-L, 050-M, 050-N
- Scope: §8.4 (links, flyouts unmounted, `/edit*` redirects behind the flag), non-linear mode for set-up events ("Jump to edit…", Save & exit, explicit save on PUBLISHED).
- Acceptance: every Details section opens the right step; Save & exit returns with a notice; a PUBLISHED event never autosaves; with the flag off, Details behaves exactly as today.
- Tests: Playwright `admin-event-edit-mode.spec.ts` (each section link, published explicit save, unsaved guard, 390 px, axe). Load `frontend-ui-engineering`.

**050-P Parity, flag flip, retire the old paths** · parent: 050-O (+ ops: flag on in prod after the parity checklist)
- Parity checklist (owner sign-off on the card before the flip): every field of `/admin/events/new`, `/edit/details`, `/edit/sales` and the four flyouts has a wizard step; ORGANIZER end-to-end create with a vendor form; forms config reachable only through the wizard; RRG staging event created and published through the wizard.
- Ops: set `NEXT_PUBLIC_EVENT_WIZARD_ENABLED=true` on the frontend service, redeploy, `railway deployment list`, smoke the create flow in prod.
- Scope (PR after the flip): delete the old create page body, `EventEditor.tsx`, `edit/details`, `edit/sales` (keep redirects), the four flyouts, `applications/forms*` pages (redirects, §8.5), the flag and the `FULL_SCREEN` flag branch; rewrite the e2e specs in §9; `docs/wiki/features/event-setup-wizard.md` (via `/doc-feature`), update `event-details.md`, `event-editor.md`, `applications.md`; root AGENTS gotcha: "The event wizard (`components/event-setup/`) is the one form for every event field and every event application form; Details sections link into `setup?step=`; never add a second editor".
- Tests: full e2e suite green with the rewritten specs.

**050-Q Special guest lineup** · parent: 050-B, 050-G, 050-L
- Phase 1, built after or alongside 050-O; it does not gate the flip. Why phase 1: the owner asked for it as part of special guests (§5.5 #7), and it is self-contained: one table, CRUD, one public section, no money, capacity or checkout paths.
- Owner (§14 #2): guests can be added by hand without any special guest form.
- Scope: §6.3 model, §7.6 routes, "Add to lineup" on the application detail of an APPROVED SPECIAL_GUEST, lineup editor in the Special guests step (list, reorder buttons, image, visibility), `EventGuests` section on the event page (brand tokens, `alt` = guest name), export/erasure, audit mapping.
- Tests: contract (CRUD, add-to-lineup, org guard, public payload hides invisible rows), unit (erasure removes linked rows, export lists them), Playwright `event-guest-lineup.spec.ts` (storefront section and wizard editor, 390 px, axe). Load `frontend-ui-engineering`.

### Phase 2 — volunteer shifts

Phase 2 because shifts reach into the apply form, approval, capacity, CSV, digest and check-in (gotcha 15 territory), and the wizard reaches parity without them: v1 volunteers use a multi-choice availability question from the VOLUNTEER defaults. If the owner wants rosters, reminders or hour tracking, re-plan this as its own spec (051) before building.

**050-R Volunteer shifts: model and apply flow** · parent: 050-B
- Scope: §6.4 models + audit mapping; shift CRUD under `/admin/events/:eventId/application-forms/:formId/shifts` (ORGANIZER); public form payload lists shifts; apply page step "Pick your shifts" (VOLUNTEER only, multi-select, full shifts shown as "Full", still pickable as a preference); approval dialog assigns shifts within capacity (409 per full shift); CSV column; detail page section.
- Tests: contract (CRUD, submit with picks, approval capacity), Playwright apply-page shift step (390 px, axe). Load `frontend-ui-engineering`.

**050-S Volunteer shifts: wizard and roster** · parent: 050-R, 050-L
- Scope: shift editor in the Volunteers step (times in the venue zone), roster filter by shift in the Applications tab (`SubmissionsTable` scope extension, never a fork, gotcha 18).
- Tests: Playwright `admin-event-setup-volunteer-shifts.spec.ts` (390 px, axe). Load `frontend-ui-engineering`.

### Dependency summary

| Card | Parents | Can start |
|---|---|---|
| A, B, D, E, F | — | at once, in parallel |
| C, G | A | after A |
| H | A, F, G | after the foundations |
| I, J, N | H (N also C, F) | after H |
| K | E, H | |
| L | B, E, H | |
| M | L | |
| O | I, J, K, L, M, N | parity |
| P | O + prod flag flip | last |
| Q | B, G, L | alongside O/P |
| R → S | B; S also L | phase 2 |

## 13. Risks and gotchas

- **Nullable capacity has a long tail.** Thirteen files read `.capacity`; a missed reader shows "NaN" or breaks the tier ceiling. 050-A greps every reader and the CHECK keeps nulls on drafts only.
- **Concurrent schema PRs.** A, B, D each add a migration to `schema.prisma`; parallel worktrees will conflict in the file (not the SQL). Rebase in merge order A → B → D; never edit an applied migration (CI check 1).
- **PR #180 and 050-D** both edit `cancelEvent` neighbourhood (§7.4).
- **Spec 047 D1 collides twice:** its Sales-editor card (deleted by 050-P) and its `EventDetailClient` edits (split by 050-G). Amend D1 before either is built (§10).
- **Edit mode on live events.** A wizard that autosaves would push half-typed copy to a published page; hence explicit save on PUBLISHED (§11.5). Venue change on a published event re-anchors the time and refreshes tax (`EventService.js:386`); the step says so before saving.
- **Duplicate text in Playwright.** The preview iframe and mobile/desktop copies repeat names; scope assertions to the form pane or the frame (gotcha 11).
- **iframe preview needs same-origin and the admin guard.** `/admin/events/preview-frame` is under `/admin`, so the edge middleware protects it; `postMessage` must check origin both ways.
- **Preview token scope.** Separate audience from theme previews and sessions; the server never trusts the cookie without verifying org and event.
- **Venue time zones (gotcha 28).** Start, end and tier sale windows all go through `lib/eventTime.ts` in the venue zone; the zone label always renders, in the preview too.
- **RSVP ≠ Order (gotcha 29).** Readiness, Collect more visibility and the Tickets step branch on `admissionMode`.
- **Sanitize on write (gotcha 20)** stays in `updateEvent`; the preview renders description through `ContentHtml` only. Guest bios are plain text.
- **One `SubmissionsTable` (gotcha 18).** 050-P only rewires links; shift roster (050-S) extends the scope.
- **Opening config to ORGANIZER** widens who can set prices on vendor forms and add-ons. That matches tiers today; money movement stays ADMIN and the audit trail records who changed what (spec 048).
- **Close sales vs tier sale windows.** Two "stop selling" mechanisms; the event-level one wins and the Details page says which is active.
- **Old e2e specs** fail the day the flag code is deleted; 050-P rewrites them in the same PR.
- **`useSearchParams()` needs `<Suspense>`** on every wizard route (root AGENTS).

## 14. Open questions (new only)

None. Both were answered by the owner on 2026-10-10, choosing the defaults:

1. **Delete an unsold draft: yes, in 050-D.** `DELETE …/:eventId` is allowed for a DRAFT under the same guards as unpublish (no live order, GOING RSVP or submitted application). It appears as "Delete draft…" in `EventActionsMenu` with a confirm dialog.
2. **Lineup without a form: yes, in 050-Q.** Organizers can add guests by hand in the Special guests step. A special guest form is optional.
