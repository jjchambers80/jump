# Implementation Plan: Participants (spec 019)

**Status**: Planned 2026-09-18. Not built.
**Spec**: [spec.md](./spec.md). Depends on spec 011 (all phases on `main`), spec 012, spec 018 phases 2–3 (on `main` at `26e4103`).
**Reference**: `docs/research/eventeny-submissions-list.png` (Eventeny "Submissions List", Game & Geek Expo, captured 2026-09-18).
**Branches**: plan on `plan/019-participants`; phases on `feat/019-participants-phase-1` → `-phase-2` → `-phase-3`, each merged to `main` alone (the spec 012 stacked-merge lesson: never merge a phase branch that contains an unmerged earlier phase).

---

## 0. Why this is not Transactions again

Spec 018 phase 1 was removed because it put a second **money** list next to Orders. Participants is the only organization-wide home for **submissions**; today they are reachable only per event. Two guard-rails keep this from becoming a parallel implementation:

1. **One table component.** `SubmissionsTable` renders both `/admin/participants` and `/admin/events/:eventId/applications`. The per-event tab passes `eventId` and loses the Event filter and column; everything else is identical. The 400-line per-event page is replaced, not duplicated.
2. **One detail page.** Rows link to the existing `/admin/events/:eventId/applications/:id`. Participants never grows its own detail route.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Per-event list with filters, `summary`, pagination, sort | `ApplicationService.list / _listWhere / _listOrder / _serializeRow` | `_listWhere` gains an `organizationId` scope and the wider `q`; `list` becomes a thin wrapper over `listInScope` |
| Bulk decisions (per-id results, APPROVE refused on PAID) | `ApplicationService.bulkDecide` | Org-wide bulk groups ids by `eventId` and calls the same method per event |
| CSV with one column per question / add-on | `ApplicationService.exportCsv` | Org-wide export: same builder over the scoped `where`, `event` (+ `organization`) columns prepended; add-on columns come from the rows' events |
| Decision dialog with rendered email, note, send toggle | `frontend/…/applications/DecisionDialog.tsx` (`useApplicationsApi(eventId)`) | Opened from the `⋯` menu with the row's `eventId`; fetches `get(id)` first so it keeps taking `AdminApplication` |
| Saved views (localStorage, URL is the shareable form) | `applications/page.tsx` `readSavedViews / writeSavedViews / viewKey` | Moved to `frontend/src/lib/savedViews.ts`, keyed by `jump.participants.views.<scope>` |
| Form CRUD + validation, `copyForms` | `ApplicationFormService.createForm / _validateFormFields / _validateTier / _validateQuestion / copyForms` | Template save validates through the same functions; create-from-template is `copyForms` with a template as the source |
| Form editor cards | `forms/[formId]/page.tsx` `SettingsCard`, `TiersCard`, `QuestionsCard` (callback props already) | Extracted to `frontend/src/components/applications/*Card.tsx`; the template editor mounts them with local-state callbacks |
| Org scope | `resolveOrgScope`, `isUnscoped`, `scopedOrgFor(req)` in `routes/admin.js`; `activeOrgFor(req)` | The new routes use the customers-route shape: unscoped → all, membership → org, none → empty |
| Profile photos → URLs | `ApplicantProfileService.serialize` (`imageService.formatImageResponse(...).urls`) | `logoUrl` = first image's `thumb` |
| Sidebar, `isActive` sub-route logic | `frontend/src/components/AdminSidebar.tsx` | One `navItems` entry |
| Events list "Applications" link | `frontend/src/app/admin/events/page.tsx:300` | Unchanged — still opens the per-event tab |

---

## 2. Design

### 2.1 Routes and pages

| Path | Page | Notes |
|---|---|---|
| `/admin/participants` | Submissions (default tab) | `SubmissionsTable` without `eventId` |
| `/admin/participants/applications` | Applications tab: forms across events + templates | ADMIN sees **New application** and **New template** |
| `/admin/participants/templates/[templateId]` | Template editor | Reuses the three editor cards |
| `/admin/events/[eventId]/applications` | Per-event Submissions | `SubmissionsTable eventId=…`; header/tabs unchanged (`ApplicationsHeader`) |
| `/admin/events/[eventId]/applications/forms[/[formId]]` | Unchanged | Editor gains **Save as template** (ADMIN) |

`ParticipantsHeader` mirrors `ApplicationsHeader`: title **Participants**, tabs **Submissions** / **Applications**.

### 2.2 Submissions table (the screenshot, mapped)

| Screenshot column | Jump column | Source |
|---|---|---|
| ☐ | ☐ | selection for bulk |
| Business Name: logo, name, contact, tag chips, `ID: XNKNHSCH`, Checked in / out | **Business**: `logoUrl` 40 px rounded square or initial; `businessName` → detail link; `contact.firstName lastName`; `ID: shortId`; (phase 3) check-in ticks on APPROVED | `_serializeRow` + `logoUrl`, `shortId` |
| Tags | **Tags**: `boothLabel` as one chip (phase 1), `tags[]` chips (phase 3) | |
| Application | **Application**: `formName`; second line `event.name · date` (hidden on the per-event mount) | `form`, `event` |
| Avg Score / Jurors | — | out of scope (follow-up §9) |
| Status ↓ | **Status** pill, sortable header | `status`, `sort=status|status_desc` |
| Proof of insurance | **Payment** pill for PAID forms (`PAYMENT_LABEL · $amount`, overdue in red) | `paymentStatus`, `applicantPays` |
| Date | **Submitted** `May 20, 2025` / `1:48 pm` on two lines | `submittedAt` |
| Actions ⋯ | **⋯ menu**: View · Approve · Waitlist · Reject · Withdraw (per `DECISIONS` transitions) · Copy status link · (phase 3) Edit tags | `DecisionDialog`, `statusUrl` |
| Search "business name, contact name, email address, application name, id, and tag" | Same placeholder; `q` | FR-002 |
| ⚙ filter button | Filter popover: Event, Form, Status, Payment, Add-on, Sort | URL params |
| Share & embed | — | not planned |

Above the table: status chips (`All N`, one per `STATUS_ORDER`) from `summary`, as today. Bulk bar as today. Pagination as today. Unscoped callers get an **Organization** column after Application.

Search / filter / sort are server-side; nothing is filtered in the browser.

### 2.3 Row shape (additions to `ApplicationRow`)

```ts
interface ApplicationRow {
  // existing per-event fields …
  eventId: string;
  event: { id: string; name: string; date: string };
  organization?: { id: string; name: string };   // unscoped callers only
  shortId: string;                                // id.slice(-8).toUpperCase()
  logoUrl: string | null;                         // first profile photo, thumb
  statusUrl: string;                              // derived token link (Copy status link)
  tags: string[];                                 // phase 3, [] before
  checkedInAt: string | null;                     // phase 3
  checkedOutAt: string | null;                    // phase 3
}
```

`statusUrl` is cheap (`statusUrlFor` is an HMAC over the id) and lets the menu copy the applicant's link without a detail fetch.

### 2.4 Query semantics

`_listWhere(scope, query)` where `scope = { eventId? , organizationId? }`:

- base: `status ≠ DRAFT`, plus `eventId` when given, plus `organizationId` when the caller is scoped. Both given on the per-event mount (the event must belong to the org; `requireEvent` already checks).
- `event` filter (org mount only): `eventId = …`, validated against scope (404 otherwise, like `requireEvent`).
- `q`: the existing four `OR` branches + `form.name contains` + `tags has` (phase 3; `boothLabel contains` before) + id: exact match, or `endsWith` case-insensitive when `q` is 6–25 `[a-z0-9]`. Prisma has no `endsWith … mode: insensitive` on cuids in one branch — cuids are lowercase, so lowercase the term and use `endsWith`.
- `tag` filter: `tags: { has }` (phase 3).
- `sort`: `_listOrder` gains `business_desc`, `status_desc`, `event` (`[{ event: { date: 'desc' } }, { submittedAt: 'desc' }]`).

`summary` groups by status over the same scope **without** the other filters (as today, so the chips are stable while filtering).

### 2.5 Templates

**Model**: a snapshot, not a live form.

```prisma
model ApplicationFormTemplate {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  kind           ApplicationFormKind
  definition     Json     // { intro, chargeTiming, feeMode, taxable, paymentDueDays, overduePolicy, tiers: [...], questions: [...] }
  sourceFormId   String?  // informational: the form it was saved from
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([organizationId, name])
  @@index([organizationId, updatedAt])
}
```

`ApplicationForm.createdFromTemplateId String?` (no relation, informational) so the editor can say "Created from *Exhibitor booths* template".

Why JSON and not `ApplicationForm` rows with a null `eventId` (option B): B reuses the editor routes unchanged but forks every service method on `eventId === null` (`requireEvent`, `_requireForm`, `_uniqueSlug`, `_addOnsForEvent`, public reads, `copyForms`), needs a partial unique index for slugs, and lets an `Application` accidentally point at a template. A snapshot has one write path (`PUT` the whole definition, validated), one read path, and materialisation is `copyForms` with a different source. The editor cards already take callbacks, so the template editor mounts them against local state and saves the whole definition on **Save**.

**Definition shape** (validated server-side, `backend/src/services/ApplicationTemplateService.js` — note the existing `ApplicationTemplateService` is *message* templates; the new service is `ApplicationFormTemplateService` to avoid the clash):

```ts
{
  intro: string | null,
  chargeTiming: 'APPROVAL' | 'SUBMIT', feeMode: 'PASS' | 'ABSORB', taxable: boolean,
  paymentDueDays: number, overduePolicy: 'WITHDRAW' | 'HOLD',
  tiers: { name, description, price, quantityTotal, isActive }[],        // PAID only; ids are array positions
  questions: { label, helpText, type, required, options }[],
}
```

Validation reuses `_validateFormFields(body, kind)`, `_validateTier(t, i)`, `_validateQuestion(q, i)` from `ApplicationFormService` (exported as module functions or called through the singleton). Limits: ≤ 50 tiers, ≤ 100 questions, `MAX_OPTIONS` per question — the first two are new constants in `config/applications.js` (forms have no tier / question cap today; the template cap keeps a hand-edited payload bounded).

**Operations**:

| Op | Route | Role | Behaviour |
|---|---|---|---|
| List | `GET /admin/application-templates` | ORGANIZER+ | `{ data: [{ id, name, kind, tierCount, questionCount, updatedAt }] }` in scope |
| Read | `GET /admin/application-templates/:id` | ORGANIZER+ | full definition |
| Create | `POST /admin/application-templates { name, kind, definition? }` | ADMIN | empty definition when omitted |
| Update | `PUT /admin/application-templates/:id { name?, definition }` | ADMIN | whole definition; 409 on name collision |
| Delete | `DELETE /admin/application-templates/:id` | ADMIN | hard delete; forms keep `createdFromTemplateId` |
| Save as | `POST /admin/events/:eventId/application-forms/:formId/save-as-template { name, replaceTemplateId? }` | ADMIN | snapshot of the form (non-archived questions, tiers without add-ons); `replaceTemplateId` overwrites an existing template's definition |
| Create form from | `POST /admin/events/:eventId/application-forms { name, kind, templateId }` | ADMIN | `kind` must equal the template's kind (400 otherwise); creates the form then tiers and questions from the definition in one transaction; `status DRAFT`, no window |

### 2.6 Tags and check-in (phase 3)

- `Application.tags String[] @default([])`, GIN index `@@index([tags], type: Gin)`.
- `Application.checkedInAt DateTime?`, `checkedOutAt DateTime?`.
- `updateNotes` generalises to `updateMeta({ boothLabel, internalNote, tags, checkedIn, checkedOut })`: `tags` trimmed, deduped case-insensitively (first spelling wins), ≤ 20 × 40 chars; `checkedIn: true` sets `checkedInAt = now` when null, `false` clears it (same for out); both refused (409) unless `status = APPROVED`.
- `GET /admin/applications/tags` → distinct tags in scope (`SELECT DISTINCT unnest(tags)` via `$queryRaw`, scoped by `organizationId`), for the Edit tags autocomplete and the filter.
- `boothLabel` stays as-is (it is used by emails and the detail page). The Tags column shows `boothLabel` first (grey chip) then `tags` (amber chips, as in the reference).

---

## 3. Data model

| Phase | Migration | Change |
|---|---|---|
| 1 | `20260922000000_participants_list_index` | `@@index([organizationId, submittedAt])` on `Application` (re-adds the index dropped in `20260921000000_drop_transactions_indexes`; this time it backs the primary list query, not a union) |
| 2 | `20260923000000_application_form_templates` | `ApplicationFormTemplate`; `ApplicationForm.createdFromTemplateId` |
| 3 | `20260924000000_application_tags_checkin` | `Application.tags`, `checkedInAt`, `checkedOutAt`, GIN index |

Dev DB: `npm run db:push` after each (the project's dev workflow); tests migrate `jump_test` automatically.

---

## 4. Backend

### 4.1 Services

**`ApplicationService`**
- `listInScope({ eventId = null, organizationId = null }, query)` — the body of today's `list` with the scope object; `list(eventId, organizationId, query)` calls it after `requireEvent`. Adds `event: { select: { id, name, date, venue: { select: { organization: { select: { id, name } } } } } }` and `profile.images (take 1) → image → file` to the include.
- `summaryInScope(scope)`.
- `exportCsvInScope(scope, query)` — refactor `exportCsv` so the row → CSV builder is shared; org-wide add-on columns are the union of active application add-ons across the rows' events.
- `bulkDecideInScope(organizationId, { ids, decision, note, byUserId })` — load `{ id, eventId }` for the ids in scope, group by `eventId`, call `bulkDecide` per group, merge results; ids not in scope come back `{ ok: false, error: 'Application not found' }`.
- `_serializeRow` adds `eventId`, `event`, `organization` (only when `unscoped`), `shortId`, `logoUrl`, `statusUrl` (via `statusUrlFor`), and in phase 3 `tags`, `checkedInAt`, `checkedOutAt`.
- Phase 3: `updateMeta` replaces `updateNotes` (old name kept as an alias for the detail page), `distinctTags(organizationId)`.

**`ApplicationFormService`**
- `listFormsInScope(organizationId | null)` — forms with `event { id, name, date, status }`, `applicationCount`, acceptance; ordered by event date desc, then `displayOrder`.
- `createForm(eventId, organizationId, body)` accepts `templateId`: loads the template (must be in scope, `kind` must match), and after creating the form materialises tiers and questions inside the same transaction. Extract the "tiers + questions from a plain definition" step out of `copyForms` into `_materialise(tx, formId, definition)` so both use it.
- `snapshotForm(form)` → definition (non-archived questions, tiers without add-ons, no status / window / slug).

**`ApplicationFormTemplateService`** (new): `list`, `get`, `create`, `update`, `remove`, `saveFrom(form, { name, replaceTemplateId })`, `validateDefinition(kind, definition)` (delegates to the form validators), `requireInScope(templateId, organizationId)`.

### 4.2 Routes (`routes/admin.js`, Applications block)

```
GET  /admin/applications                         organizer+   listInScope(scope, query)
GET  /admin/applications/summary                 organizer+
GET  /admin/applications/export.csv              organizer+
GET  /admin/applications/tags                    organizer+   (phase 3)
POST /admin/applications/bulk                    organizer+   bulkDecideInScope
GET  /admin/application-forms                    organizer+   listFormsInScope
GET  /admin/application-templates                organizer+   (phase 2)
POST /admin/application-templates                admin
GET  /admin/application-templates/:templateId    organizer+
PUT  /admin/application-templates/:templateId    admin
DELETE /admin/application-templates/:templateId  admin
POST /admin/events/:eventId/application-forms/:formId/save-as-template   admin   (phase 2)
POST /admin/events/:eventId/application-forms    admin   + templateId (phase 2)
PATCH /admin/events/:eventId/applications/:id    organizer+ + tags / checkedIn / checkedOut (phase 3)
```

Scope resolution copies the customers route: `resolveOrgScope(req.user.id, req.user.role, req.user.organizationId)`; unscoped → `organizationId = null`; scoped without membership → empty `{ data: [], total: 0, summary: {} }`. The `/admin/applications*` routes must be registered **before** `/admin/events/:eventId/applications` so Express does not treat `applications` as an `eventId` — the block already orders static paths first; add a contract test that `GET /admin/applications/summary` does not 404 as an event.

Validators (`applicationValidators.js`): `validateOrgBulkBody` (same as bulk), `validateTemplateBody` (name 2–80, kind, definition object), `validateSaveAsTemplateBody`, phase 3 `validateMetaBody` (tags array, booleans).

### 4.3 CSV

Same builder; columns `organization` (unscoped only), `event`, `eventDate` are prepended. Filename `participants-<yyyy-mm-dd>.csv`.

---

## 5. Frontend

### 5.1 Phase 1 — Participants page and shared table

New:
- `frontend/src/app/admin/participants/page.tsx` — `<ParticipantsHeader />` + `<SubmissionsTable />` (Suspense-wrapped; uses `useSearchParams`).
- `frontend/src/app/admin/participants/ParticipantsHeader.tsx` — title + Submissions / Applications tabs.
- `frontend/src/components/applications/SubmissionsTable.tsx` — the table from §2.2; props `{ eventId?: string }`. Owns query state (URL), summary chips, search box + filter popover, saved views, bulk bar, pagination, `⋯` menu, and mounts `DecisionDialog` for the active row.
- `frontend/src/components/applications/RowActionsMenu.tsx` — `role="menu"` button + list; items computed from `DECISION_TRANSITIONS` (new export in `lib/applications.ts` mirroring the backend `DECISIONS` table).
- `frontend/src/components/applications/FilterPopover.tsx` — Event (org mount only), Form, Status, Payment, Add-on, Sort; **Apply** writes the URL in one `router.replace`.
- `frontend/src/components/applications/BusinessCell.tsx` — logo / initial, name link, contact, short id, (phase 3) check-in ticks.
- `frontend/src/lib/savedViews.ts` — moved helpers, generic over a key.
- `frontend/src/app/admin/participants/useParticipantsApi.ts` — `list, summary, exportUrl, bulk, forms` for the org-wide routes; `templates*` in phase 2; `tags` in phase 3. Per-row actions keep using `useApplicationsApi(row.eventId)`.

Changed:
- `frontend/src/app/admin/events/[eventId]/applications/page.tsx` → `<ApplicationsHeader />` + `<SubmissionsTable eventId={…} />`; the old body is deleted.
- `AdminSidebar.tsx`: `{ label: 'Participants', href: '/admin/participants' }` after Customers.
- `lib/applications.ts`: `ApplicationRow` additions (§2.3), `DECISION_TRANSITIONS`, `shortId()`.

Data flow for a decision from the list: menu → `api.get(row.id)` (per-event client for `row.eventId`) → `DecisionDialog` → `onDecided(next)` → replace the row's `status / paymentStatus / decidedAt` from `next` and refresh `summary` (one `summary` call, not a full reload).

### 5.2 Phase 2 — Applications tab and templates

- `frontend/src/app/admin/participants/applications/page.tsx` — two sections. **Application forms**: table (Event · date, Form, Kind, Status pill, Submissions, Window) → Edit/View links to the existing editor, "Submissions" link to `/admin/participants?event=…&form=…`. **Templates**: cards (name, kind, tiers, questions, updated) → editor; Delete with confirm.
- `NewApplicationDialog.tsx` — event picker (`GET /admin/events?status=…` filtered client-side to not-ended, not CANCELLED, grouped by organization when unscoped), name, kind, "Start from template" select (templates of the same kind); `createForm({ templateId })` → `window.location.assign(editor)`.
- `NewTemplateDialog.tsx` — name + kind → `POST` → editor.
- `frontend/src/app/admin/participants/templates/[templateId]/page.tsx` — `SettingsCard` / `TiersCard` / `QuestionsCard` mounted on a local `definition` (tiers and questions get synthetic ids `t0…`, `q0…` so the cards' `editing` state works); **Save** `PUT`s the definition; unsaved-changes guard. Tier card hides the add-on picker (`onSetAddOns` omitted → hidden).
- Extract the three cards from `forms/[formId]/page.tsx` into `frontend/src/components/applications/` with no behaviour change; the form editor imports them. Add **Save as template** (ADMIN) to the form editor header → dialog: name, or "Replace existing" select.
- `AdminForm` type gains `event`, `createdFromTemplateId`.

### 5.3 Phase 3 — Tags and check-in

- `EditTagsDialog.tsx` — chip input with autocomplete from `GET /admin/applications/tags`; `PATCH` via the per-event client.
- `BusinessCell` shows **Checked in** / **Checked out** checkboxes on APPROVED rows; optimistic toggle, revert on error.
- Filter popover gains **Tag**; Tags column renders `boothLabel` + `tags`.
- Detail page: tags + check-in in the notes card (same `PATCH`).

---

## 6. Phases

### Phase 1 — Participants list (FR-001–FR-006, FR-008, FR-009 without tags)

Backend: `listInScope / summaryInScope / exportCsvInScope / bulkDecideInScope`, row additions, `listFormsInScope` (needed by the filter), five routes, index migration.
Frontend: everything in §5.1.
Tests: `backend/tests/contract/participants.test.js` — scope (org A / org B / unscoped / no membership), `q` on each field and on id suffix, every sort, `event` filter 404 outside scope, org bulk across two events with a PAID approve refused, CSV columns, route ordering (`/admin/applications/summary` is not an event id), p95 query shape (`EXPLAIN` uses the new index — assert via `prisma.$queryRaw` in one test). `frontend/e2e/participants.spec.ts` — sidebar entry, list with two events, search by short id, status header sort, `⋯` → Waitlist round-trip, bulk from mixed events, saved view, per-event tab shows the same table without the Event column; axe clean on both mounts. Existing `applications.spec.ts` list assertions updated for the new column set (`data-testid`s preserved: `applications-table`, `application-row-<id>`, `applications-bulk-bar`, `applications-summary`, `applications-export`, `applications-saved-views`).
Docs: `docs/wiki/features/participants.md`, `applications.md` Key Files updated, `AGENTS.md` route table.

### Phase 2 — Applications tab and templates (FR-007, FR-010, FR-011)

Backend: model + migration, `ApplicationFormTemplateService`, template routes, `save-as-template`, `templateId` on create, `_materialise` extraction (`copyForms` uses it — its tests stay green).
Frontend: §5.2.
Tests: `backend/tests/contract/applicationTemplates.test.js` — RBAC matrix, validation parity (a bad tier price rejected with the form validator's message), save-as (non-archived questions only, no add-ons, replace), create-from (DRAFT, no window, tiers at full quantity, questions in order, kind mismatch 400, template from another org 404), `listFormsInScope` scope + ordering, template edits do not touch created forms. `frontend/e2e/participants-templates.spec.ts` — New application from the tab lands in the editor, Save as template → Templates card, New application with Start from template shows the copied questions, template editor edit + Save + unsaved guard, ORGANIZER sees no write buttons.

### Phase 3 — Tags and check-in (FR-012, FR-013)

Backend: migration, `updateMeta`, `distinctTags`, `tag` filter + `q` on tags, validators.
Frontend: §5.3.
Tests: contract — tag normalisation and limits, `tag` filter, `q` matches a tag, check-in on APPROVED only, clearing, unscoped tags list; e2e — Edit tags with autocomplete, filter by tag, check-in tick persists on reload, no tick on a rejected row.

### Explicitly out of scope

- Jury scoring ("Avg Score / Jurors"), a pinned-answer column ("Proof of insurance"), "Share & embed" of the list.
- A Participants detail page (the event detail page is the detail page).
- Messaging participants from the list (spec 013).
- Pushing template edits to existing forms.

---

## 7. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 7.1 | Sidebar position | After **Customers**, before **Check In** — people lists together |
| 7.2 | Per-event Applications tab | Keep, rendering `SubmissionsTable eventId=…`. Removing it would break the events-list link and the digest email link (`/admin/events/:id/applications?status=SUBMITTED`) |
| 7.3 | Template storage | JSON snapshot (§2.5). Alternative B (template = `ApplicationForm` with null `eventId`) rejected for the reasons given there |
| 7.4 | Default page size | 25 on the org mount (the reference list shows ~12 per screen), `LIST_PAGE_SIZE` (50) unchanged on the per-event mount |
| 7.5 | Tags vs `boothLabel` | Keep both. `boothLabel` is one value used by emails and the detail page; `tags` are free-form. Do not migrate `boothLabel` into `tags` |
| 7.6 | Check-in vs spec 015 (floor map) / scanner | Timestamps on `Application` only; no QR, no `SCANNER_API_KEY` path. If spec 015 adds a scannable participant badge it reads the same columns |
| 7.7 | Events offered in New application | Not ended (`date ≥ today`), not `CANCELLED`, including `DRAFT` events; SYSTEM_ADMIN grouped by organization |
| 7.8 | Route naming | `/admin/applications` (API) vs `/admin/participants` (UI). API keeps the model name so the routes sit with the per-event block |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Replacing the per-event page breaks `applications.spec.ts` and the add-ons / corrections specs that start from that list | Keep every `data-testid` and the URL param names; run all four applications e2e specs in phase 1 CI |
| `/admin/applications/*` captured by `/admin/events/:eventId/*` | Different prefix (`/admin/applications` vs `/admin/events/…`), so no capture; the contract test in phase 1 pins it anyway |
| Org-wide bulk across events runs N sequential `decide` calls each with `FOR UPDATE` | Same cost as today's per-event bulk (already sequential); cap stays 200 ids |
| Org-wide CSV loads every application in scope in one query | Same as the per-event export; add `take: 10_000` and a 413 with a "narrow the filter" message beyond it |
| Template definition validated by functions written for request bodies (`_validateFormFields` reads `existing`) | Call them with `existing = null` and a synthetic body per tier / question; unit-test the parity with one bad value per rule |
| Logo thumbnails add a join per row | `profile.images take 1` on the list include; `thumb` variant is 128 px |
| Editor cards extracted with subtle behaviour changes | Extraction PR is mechanical (move + import); the existing form editor e2e covers it before the template editor is added |

---

## 9. Follow-ups noted, not planned

- **Pinned answer columns** — done 2026-09-18: `ApplicationQuestion.pinned` (≤ 2 live per form), `pinnedAnswers` on rows, per-question columns under a Form filter, one Answers column otherwise; templates carry the flag.
- **Jury scoring**: `ApplicationScore` per member, average on the row. Own spec.
- **Participant messaging** from a selection (spec 013).
- **Public participant directory** ("who's exhibiting") on the event page, fed by APPROVED rows and profile photos.
- **Digest link** — done 2026-09-18 after phase 3: per-event links inline to `/admin/participants?event=:id&status=SUBMITTED`, one org-wide **Open** button to `/admin/participants?status=SUBMITTED`.
