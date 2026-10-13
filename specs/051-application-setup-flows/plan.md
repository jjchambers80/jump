# Spec 051 — Application setup flows, split out of the event wizard

**Status**: Implemented on `feat/051-application-flows` (2026-10-11). Owner decisions recorded below. Wiki: [`docs/wiki/features/application-setup-flows.md`](../../docs/wiki/features/application-setup-flows.md).


## Context

The spec 050 setup wizard is 12 visible steps for a new ticketed event; five of them
(Vendor applications, Floor map, Special guests, Volunteers, Other applications) configure
application forms, each step a long scroll of inline `FormEditorCards`. Owner wants event
setup short and focused: event setup = one task; each application type = its own task,
started from the event Overview ("Add a vendor application", …) and walked step by step in
the **same wizard shell** (uniform look, progress, footer, step menu).

Decisions (owner, 2026-10-11):
- **One form per run.** "Add a vendor application" creates one form and walks its steps;
  editing a form re-enters the same flow. A second vendor form = a second run.
- **Special guests lineup is the first step of the guest flow**, the form is optional after it.

Still true after this change: gotcha 39 "one editor" — the form flows live in
`components/event-setup/` and are the only editor for event application forms. No schema
change; no new catalog key (routes sit under `/admin/events`, actions keep
`useCan('applications.forms')`).

## Event wizard after the split

`EVENT_STEPS` (`frontend/src/components/event-setup/steps.ts`) drops `vendors`, `floor-map`,
`special-guests`, `volunteers`, `other-applications`. New ticketed event: name · venue · date ·
description · image · tickets · collect-more · review = 8 steps (was 12).

- Backend `EVENT_SETUP_STEPS` (`backend/src/api/validators/eventValidators.js:21`) and
  `backend/tests/fixtures/eventSetupSteps.fixtures.json` drop the same five keys (both suites
  assert the fixture).
- `resumeKey` (steps.ts:233): a stored `setupStep` no longer in the list (old drafts) resumes at
  `review`.
- **Legacy redirect** in `useSetupFlow.ts` (~line 90): `?step=<old app key>[&form=<id>]` →
  `router.replace(formFlowHref(...))`. `floor-map` without `form` → first VENDOR form with
  `spaceSelection === 'MAP'`. Keeps every old link working: `readinessHref`
  (`lib/eventReadiness.ts:40`, readiness items still say `step: 'vendors' | 'floor-map'` +
  `formId`), emails, bookmarks, `WizardRedirect` routes. Better: also teach `readinessHref` to
  use `formFlowHref` when `item.formId` is set, so no hop.
- Review step keeps `ReviewForms` ("Open applications when I publish"); its empty-state link
  and the Done step get the **Add to this event** list (below) as "What's next".

## Form flows

### Route + registry
- Route: `frontend/src/app/admin/events/[eventId]/setup/[flow]/page.tsx`
  (`flow` ∈ `vendors | special-guests | volunteers | other-applications`, the existing
  `ApplicationStepKey`), query `?step=<key>&form=<id>&org=`. Wrapped in `Suspense` +
  `OrgFromUrlGate` like `setup/page.tsx`.
- New `frontend/src/components/event-setup/formFlows.ts`: `FORM_FLOWS: Record<ApplicationStepKey, FlowStep[]>`,
  each step `{ key, title, visible(ctx), complete(ctx), needsForm }`, ctx = `{ form, guestsCount }`.
  Reuses `APPLICATION_STEPS` config (`addLabel`, `nameSuffix`, `defaultKind`, `purposes`) from
  `applicationSteps.ts`. Exports `formFlowHref(eventId, flow, { form?, step?, org? })`.

| Flow | Steps |
|---|---|
| vendors | Start · Details · Spaces & pricing (PAID) · Floor map (MAP) · Questions · Review & open |
| special-guests | Lineup · Application form (create, or "Finish without a form") · Details · Questions · Review & open |
| volunteers | Start · Details · Shifts · Questions · Review & open |
| other-applications | Start (purpose picker) · Details · Questions · Review & open |

### Step content (all reuse, minimal new code)
- **Start**: body of `AddFormDialog.tsx` (name prefilled, purpose for Other, Paid toggle hidden
  for `FREE_ONLY`, Start from template list) rendered inline, not as a dialog — extract its
  fields into `AddFormFields` and keep `AddFormDialog` as a thin wrapper only if still used
  (else delete). Above it, "Continue editing" links to this event's existing forms of the type
  (`formsOnStep`). Next = `api.createForm` → `router.replace(?step=details&form=<new id>)`.
- **Details / Spaces & pricing**: split `SettingsCard` (`components/applications/FormEditorCards.tsx:86`)
  with an optional `section?: 'details' | 'payment'` prop (details = name, slug, intro,
  status/opens/closes, standing fields; payment = space selection, reserve, fees, due days,
  overdue, tax). Absent = today's full card, so templates and standing forms
  (`content/forms`) are untouched. Spaces & pricing = payment section + `TiersCard`.
- **Floor map**: existing `FloorMapStep` unchanged; update `FloorMapParts.tsx:13` `returnTo` and
  `wizardLink('floor-map')` (`applicationSteps.ts:90`) to the vendor flow URL (needs `formId`;
  `FormEditorCards.tsx:275` passes `form.id`).
- **Shifts**: `ShiftsCard`. **Questions**: `QuestionsCard`. **Lineup**: `GuestLineupEditor`.
- **Review & open**: summary (`FormResults`-style facts), Status control, "Open when the event
  publishes" note for DRAFT events (event Review still owns `openFormIds`), Save as template,
  View public form, Delete/Close (from `FormRow` actions). Exit → event Overview `?saved=1`.
- Purpose-locked rules, `PURPOSE_KIND_MISMATCH`, payments-disabled notice: unchanged (they live in
  the reused cards/backend).

### Saving
Card-based steps (Details, Spaces & pricing settings) are `<form>`s: give the card an `id` prop
and a `hideSubmit` prop; `SetupFooter` Next becomes `type="submit" form=<id>` and navigates
after the save resolves (error = stay, `role="alert"` already in place). List editors (tiers,
shifts, questions, lineup) save per item already; Next just navigates. Dirty card + step
change = `useHistoryGuard` confirm (already exists). No autosave for forms (matches today).

### Shell
Reuse `SetupShell`, `SetupHeader` (title "Vendor application · <event name>"),
`SetupProgress`, `SetupFooter`, `StepMenu`/`StepMenuSheet`, `PreviewPane` (anchor
`get-involved` / `guests`). Write a small `useFormFlow(eventId, flow)` (≈ `useSetupFlow` minus
event autosave): loads form via `useSetupForms`, resolves `?step=` (invalid/needs-form-without-form
→ first step), `neighbours`, `stepPosition`. Step change focuses the h1 (`stepFocus.ts`).

### Remove from event wizard code
`ApplicationsStep.tsx` + `FormRow.tsx` expand/collapse list go away (Start step + Overview
list replace them); `StepContent.tsx` application/floor-map branches move to the flow page;
`StepContent` descriptions for those keys move to `formFlows.ts`.

## Entry points ("Add to this event")

- New `components/events/AddToEventCard.tsx` on the Overview
  (`app/admin/events/[eventId]/page.tsx` main column, above `ApplicationsSection`), built on
  `OverviewSection` (`EventOverviewSections.tsx:34`). Four link tiles from
  `APPLICATION_STEPS` labels with a lucide icon, one-line description, and count when forms
  exist ("2 vendor applications · Add another"). Grid: 1 col phone, `sm:grid-cols-2`.
  Tiles are `<Link>` in a `<ul>`, `min-h-14`, visible focus ring, accessible name = label +
  description via `aria-describedby`. Hidden when `!useCan('applications.forms')`.
- `detailsEditLinks` (`lib/eventWizard.ts:35`): `form(f)` → `formFlowHref(..., { form, step: 'details' })`,
  `newForm` → removed in favour of `addForm(flow)`, `guests` → special-guests flow `lineup`,
  `map` → vendor flow floor-map step.
- Other hardcoded links → flow URLs: `ApplicationsHeader.tsx:24` ("Manage forms" → "Add a form"
  menu of the four flows), `SubmissionsTable.tsx:597`, `ReviewForms.tsx:38`,
  `AddToLineup.tsx:17`, `applications/forms/page.tsx` + `forms/[formId]/page.tsx` redirects.
- Done step (`steps/DoneStep.tsx`): add the same four rows ("What's next") using its `row`/`tile` style.

## UI rules (load `frontend-ui-engineering` before UI work)
Mobile first (design at 390 px, no horizontal scroll at 320 px), 44 px targets, admin
Tailwind conventions (`ui.ts` buttons, `OverviewSection`), light + dark, `motion-safe` only,
one h1 per page, focus to h1 on step change, `aria-live` step announcement (SetupShell has it),
errors in `role="alert"`, axe clean.

## Cards (as planned; built together on one branch, one PR)
- **051-A** registry + route + `useFormFlow` + Start/Details/Questions/Review steps (other-applications flow end to end); `SettingsCard section` prop; `formFlowHref`.
- **051-B** vendor flow: Spaces & pricing, Floor map step, map return links. (needs A)
- **051-C** volunteers (Shifts) + special guests (Lineup first, optional form). (needs A)
- **051-D** event wizard trim: steps/fixture/backend list, `resumeKey`, legacy redirects, `readinessHref`. (needs B, C)
- **051-E** entry points: AddToEventCard, `detailsEditLinks`, Applications header menu, Done/Review links, hardcoded links. (needs A)
- **051-F** docs: `docs/wiki/features/event-setup-wizard.md` + new `application-setup-flows.md`, root AGENTS gotcha 39 + frontend AGENTS wizard bullet, `specs/051-.../plan.md`.

## As built (differences from the plan)

- `SettingsCard` `section` has a third part, `status`, used by Review and open; the footer's "Save and finish" submits it.
- Next after a settings save picks the next step from the PATCH response (`flowSteps(flow, updated)`), so MAP goes straight to Floor map.
- The Floor map step shows for any vendor form with `spaceSelection: MAP` (matching `detailsEditLinks` and the old wizard), not only PAID.
- The special guests tile and menu entry read **Add special guests** (the flow starts at the lineup).
- The map builder's `returnTo` is the flow's Floor map URL (`FloorMapStep` `returnTo` prop).
- `FULL_SCREEN` in `AdminLayoutClient.tsx` covers `setup/<flow>`.
- Readiness `MAP_FORM_WITHOUT_PUBLISHED_MAP` now carries `formId`.
- The event wizard Review's empty forms state is text (no link): forms are added after setup.

## Verification
- Vitest: `formFlows.test.ts` (visible steps per flow × kind × spaceSelection; needsForm guard;
  `formFlowHref`), update `eventSetupSteps.test.ts` (8 steps, resume of a legacy key),
  `eventWizard.test.ts` (`detailsEditLinks`).
- Jest: `backend/tests/unit/eventSetupSteps.test.js` with the trimmed fixture; `cd backend && npm test`.
- Playwright (mocked API, `signInAsStaff`): move `admin-event-setup-applications`,
  `-volunteer-shifts`, `event-guest-lineup` wizard block to the flow URLs; new
  `admin-event-add-to-event.spec.ts` (tiles → flow, count copy, hidden without permission);
  legacy `?step=vendors&form=x` and `?step=floor-map` redirect; axe light/dark under
  `reducedMotion: 'reduce'`; 390 px and 320 px no horizontal scroll; 3 cold runs.
- `cd frontend && npx tsc --noEmit -p . && npm run test:unit`.
- Manual (`/run`): create event (8 steps) → Overview → Add a vendor application (PAID, MAP) →
  walk to Review & open → Overview list shows it; repeat on phone viewport.
- CI green on PRs is the completion gate.

## Update (2026-10-12): shifts removed

Volunteer shifts (spec 050-R/S) were removed because there is no use case yet. The volunteers flow is Start · Form details · Questions · Review and open, and migration `20261109120000_drop_volunteer_shifts` drops `VolunteerShift` and `ApplicationShift`.
