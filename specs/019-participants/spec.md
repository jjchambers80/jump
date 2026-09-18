# Feature Specification: Participants — organization-wide submissions list, application forms and templates

**Feature Branch**: `plan/019-participants`  
**Created**: 2026-09-18  
**Status**: Planned 2026-09-18 — see [plan.md](./plan.md); not built  
**Input**: Organizer request 2026-09-18 (session [01158zLwVnUE4g159VJBFE7w](https://claude.ai/code/session_01158zLwVnUE4g159VJBFE7w)): a **Participants** entry in the admin sidebar that lists every application submission the organization has received, modelled on the Eventeny "Submissions List" (reference screenshot: `docs/research/eventeny-submissions-list.png`, captured from https://www.awesomescreenshot.com/image/63709374?key=d30b0a0b9752b68f82b9364b39fac20f), plus an **Applications** section where an admin creates a new application form for an event or a reusable template.  
**Builds on**: spec 011 (`ApplicationForm`, `Application`, `ApplicantProfile`, admin list / decisions / bulk / CSV / saved views), spec 012 (add-on filter), spec 018 phases 2–3 (customers, corrections), spec 007 (org scope, `X-Jump-Org`).

## Vocabulary

**Participant** is the umbrella term for everyone who applies to take part in an event other than by buying a ticket — vendors, exhibitors, artists, sponsors, press, content creators, panelists, celebrity guests. A participant fills in an **application form** and becomes a **submission** (an `Application` row). The data model keeps the spec 011 names (`ApplicationForm`, `Application`); "Participants" is the navigation and page vocabulary only.

## Problem

Spec 011 put every organizer surface under **Events → (event) → Applications**. That is right for working one event, and wrong for the questions organizers ask across the season:

- "Who has applied to anything this year?" needs one event at a time. There is no organization-wide list of submissions, so a vendor who applies to three events is three separate lookups.
- The per-event list (`frontend/src/app/admin/events/[eventId]/applications/page.tsx`) is a dense table with no logo, no short reference id and no row actions; every decision needs the detail page. The Eventeny list the organizer is used to shows the business with its logo, contact and id, booth tags, the application name, the status and the date, with a `⋯` menu per row.
- Creating an application form means opening the event first, then the Forms tab. Organizers running the same "Exhibitor & Vendor Booths" form at every event rebuild the tiers and questions each time (event duplication copies forms only from a whole event, spec 011 phase 3).

Spec 018 phase 1 tried an organization-wide **Transactions** list and was removed the same day because a second *money* list beside Orders confused navigation (`specs/018-transactions/plan.md`). This spec is different in kind: submissions have no other organization-wide home, and the per-event tab becomes a filtered view of the same component rather than a second implementation.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Organizer sees every submission from one place (Priority: P1)

An ORGANIZER clicks **Participants** in the sidebar and sees every non-draft submission across the organization's events, newest first. Each row shows: a checkbox; the business (logo thumbnail or initial, business name linking to the detail page, contact name, short id); tags (booth label); the application (form name, with the event name and date underneath); the review status as a pill; the payment status for paid forms; the submitted date and time; and a `⋯` actions menu. The header has one search box that matches business name, contact name, email, application (form) name, short id and tag, a filter control (event, form, status, payment, add-on, sort), and Export CSV. Status counts sit above the table as clickable chips. Filters live in the URL; saved views work as they do on the per-event page.

**Why this priority**: This is the request. Everything else in the spec hangs off this list.

**Independent Test**: Two events in org A each with one submitted application, one submitted application in org B. `GET /admin/applications` as an org A ORGANIZER returns two rows with `event` on each; `?q=<org A business name>` returns one; `?event=<event 2>` returns one; SYSTEM_ADMIN sees three with `organization` on each. `?q=<last 8 characters of an id>` returns exactly that row.

**Acceptance Scenarios**:
1. **Given** a vendor applied to two events, **When** the organizer searches the business name, **Then** two rows appear, each naming its event, each linking to `/admin/events/:eventId/applications/:id`.
2. **Given** the list, **When** the organizer clicks the Status column header, **Then** the rows sort by status and the URL carries `sort=status`; clicking again reverses.
3. **Given** a row in `SUBMITTED`, **When** the organizer opens `⋯` and chooses Approve, **Then** the existing decision dialog opens with the rendered email, and after confirming the row updates in place without leaving the list.
4. **Given** rows from two events selected, **When** the organizer bulk-waitlists, **Then** each application is waitlisted through the existing per-event rules (Approve stays disabled when a PAID row is selected) and the result line reports successes and skips.
5. **Given** an ORGANIZER with no membership, **When** they open Participants, **Then** the list is empty (not every organization's rows).
6. **Given** the event's own Applications tab, **When** it is opened, **Then** it renders the same table pre-filtered to that event, with the same columns and actions — one implementation.

---

### User Story 2 — Admin creates an application form from Participants (Priority: P1)

Under Participants an **Applications** tab lists every application form across the organization's events (event, form name, kind, status, submission count, acceptance window) with links to the existing form editor. **New application** opens a dialog: pick an event (upcoming and draft events of the organization), name, kind (Free / Paid), and optionally **Start from template**. Creating lands on the existing editor for that event's new form.

**Why this priority**: The organizer asked to create applications from this section without going through Events first; the editor already exists.

**Independent Test**: As ADMIN, `POST /admin/events/:eventId/application-forms` from the dialog creates a DRAFT form; the Applications tab lists it under its event; ORGANIZER sees the tab read-only with no New button.

**Acceptance Scenarios**:
1. **Given** three events (one past), **When** the dialog opens, **Then** the event picker lists the two that have not ended, most recent first, and the organization's cancelled events are excluded.
2. **Given** a template chosen, **When** the form is created, **Then** it carries the template's settings, tiers (at full quantity) and questions, in DRAFT with no open window.

---

### User Story 3 — Admin keeps reusable templates (Priority: P2)

An ADMIN saves any existing form as a **template** (name, kind, settings, tiers, questions — never add-on attachments, windows or status), creates a template from scratch in an editor that looks like the form editor, edits and deletes templates, and picks a template when creating a form. Templates belong to the organization, not to an event.

**Why this priority**: Removes the per-event rebuild of the same form; depends on story 2.

**Independent Test**: Save form F (PAID, 2 tiers, 3 questions) as template T; `GET /admin/application-templates` lists T with counts; create form G on another event from T; G has 2 tiers at `quantityTotal` with `quantityApproved = 0`, 3 questions in order, `status = DRAFT`, no `opensAt / closesAt`; editing T afterwards does not change G.

**Acceptance Scenarios**:
1. **Given** a template with a PHOTO question, **When** a form is created from it, **Then** the question is a PHOTO question on the new form (types and options round-trip exactly).
2. **Given** a template whose tier has a negative price in a hand-edited payload, **When** saved, **Then** the API rejects it with the same validation message the form editor would.
3. **Given** ORGANIZER, **When** they call any template write route, **Then** 403.

---

### User Story 4 — Tags and day-of check-in on the list (Priority: P3)

Organizers tag submissions (booth numbers, "needs power", "returning") from the `⋯` menu, filter by tag, and on event day tick **Checked in** / **Checked out** on approved rows directly in the list.

**Why this priority**: Matches the reference list's Tags and Checked in / out affordances; not needed to launch the page.

**Independent Test**: `PATCH …/applications/:id { tags: ['148', 'power'] }` stores both; `GET /admin/applications?tag=148` returns the row; `PATCH { checkedIn: true }` sets `checkedInAt` and the row shows the tick; the decision log is unchanged (check-in is not a decision).

**Acceptance Scenarios**:
1. **Given** a tag with surrounding spaces or mixed case, **When** saved, **Then** it is trimmed and stored as typed (display), and the filter matches case-insensitively.
2. **Given** a `REJECTED` row, **When** viewed, **Then** no check-in control is shown.

---

### Edge Cases

- **Draft submissions** (`status = DRAFT`, abandoned checkout) never appear, as on the per-event list.
- **Deleted or cancelled events**: applications on a cancelled event still list (with the event name); the New application dialog does not offer cancelled events.
- **Template drift**: a form created from a template is a copy; later template edits never touch existing forms, and a form has no back-reference beyond an informational `createdFromTemplateId` for the "Save as template — replace?" prompt.
- **Add-ons on templates**: tiers in a template carry no add-on attachments (add-ons are event-scoped, spec 012); the editor says so under the tier list.
- **Short id collisions**: the short id is the last 8 characters of the cuid, shown uppercased; search matches `id` by suffix (case-insensitive) so a collision returns two rows rather than the wrong one.
- **SYSTEM_ADMIN** is unscoped: rows carry `organization { id, name }` and the table shows an Organization column; the New application dialog lists events across organizations grouped by organization.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001** `GET /admin/applications` lists non-draft applications for the caller's active organization (SYSTEM_ADMIN: all), paginated (default 25, max 200), with `summary` counts by status over the same scope, honouring `event, form, status, payment, tier, addOn, tag, q, sort, page, pageSize`.
- **FR-002** `q` matches business name, contact first / last name, email, form name, tag (all `contains`, case-insensitive) and application id (full, or suffix of ≥ 6 characters).
- **FR-003** `sort` accepts `submitted_desc` (default), `submitted_asc`, `business`, `business_desc`, `status`, `status_desc`, `event`.
- **FR-004** Each row carries `event { id, name, date }`, `shortId`, `logoUrl` (first profile photo, `thumb` variant, or null), and — when the caller is unscoped — `organization { id, name }`, in addition to the existing per-event row fields.
- **FR-005** `GET /admin/applications/export.csv` exports the current filter with the existing CSV columns plus `event` and `organization` (unscoped only).
- **FR-006** `POST /admin/applications/bulk { ids, decision, note? }` applies one decision across events; each id is checked against the scope and processed under the same rules as the per-event bulk route (APPROVE refused on PAID forms; per-id results).
- **FR-007** `GET /admin/application-forms` lists every form across the scope with `event { id, name, date, status }`, kind, status, `applicationCount`, acceptance.
- **FR-008** The Participants page has tabs **Submissions** and **Applications**; the per-event Applications tab renders the same submissions table locked to its event.
- **FR-009** The `⋯` menu offers View, the decisions valid for the row's status (APPROVE, WAITLIST, REJECT, WITHDRAW), Copy status link, and (phase 3) Edit tags. Decisions reuse `DecisionDialog`.
- **FR-010** Templates: `ApplicationFormTemplate` per organization with name, kind, settings, tiers and questions; routes `GET/POST /admin/application-templates`, `GET/PUT/DELETE /admin/application-templates/:id`, `POST /admin/events/:eventId/application-forms/:formId/save-as-template`, and `templateId` accepted by `POST /admin/events/:eventId/application-forms`.
- **FR-011** Template payloads are validated with the form editor's rules (`_validateFormFields`, `_validateTier`, `_validateQuestion`); a form created from a template is a `DRAFT` with no window, tiers at full quantity, questions in order.
- **FR-012** Tags: `Application.tags String[]`, `PATCH …/applications/:id { tags }` (≤ 20 tags, ≤ 40 chars each), `tag` filter, `GET /admin/applications/tags` returning distinct tags in scope for autocomplete.
- **FR-013** Check-in: `Application.checkedInAt / checkedOutAt`, `PATCH …/applications/:id { checkedIn?, checkedOut? }`, allowed on `APPROVED` only; shown as checkboxes on the row.
- **FR-014** Roles: ORGANIZER+ reads lists and decides; ADMIN creates forms and templates and saves as template; tags and check-in are ORGANIZER+.

### Non-functional

- **NFR-001** First page of the organization list returns in under 300 ms (p95) at 20,000 applications: one indexed Prisma query on `(organizationId, submittedAt)` plus one `groupBy`.
- **NFR-002** The table is keyboard-navigable and axe-clean; the `⋯` menu is a real menu (`role="menu"`, arrow keys, Escape) as `DecisionDialog` already is a dialog.

## Assumptions

- "Participants" is the sidebar label; the detail page stays at `/admin/events/:eventId/applications/:id` (linked from the list) — one detail page, not two.
- Eventeny's "Avg Score / Jurors" (jury scoring) and "Proof of insurance" (a pinned answer column) are out of scope; both are noted as follow-ups in the plan.
- Templates are organization-scoped snapshots, not live links; there is no "push template changes to forms".
- The per-event **Forms** tab stays as the event-scoped view; the Participants › Applications tab is the cross-event view of the same forms.
