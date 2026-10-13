# Application Setup Flows

**Status**: Implemented (spec 051; blank start, Fields step and templates list: PR #466; volunteer shifts removed: PR #465)
**Last Updated**: 2026-10-12

Plan: [`specs/051-application-setup-flows/plan.md`](../../../specs/051-application-setup-flows/plan.md). Builds on the [event setup wizard](event-setup-wizard.md) (spec 050).

## Overview

Event setup and application setup are separate tasks. The event wizard covers the event itself (name, venue, date, description, image, tickets, add-ons, review): 8 steps for a new ticketed event, down from 12. Vendor applications, special guests, volunteers and other applications (sponsors, press, panels) are each set up in their own **flow**, one form per run, in the same wizard shell: header, progress bar, Back / Next footer, live preview.

**Live form preview.** On every step that shapes the form (Start, Form details, Options and pricing, How vendors choose and pay, Fields, Review and open) the preview shows the application form itself, as applicants will see it: `previewForm(form, typed, orgName)` (`previewMessages.ts`) builds the public form from the saved one plus the name and intro being typed (`SettingsCard` `onChange`), and the frame renders `ApplyFormPreview` (the public `ApplyFrame` + `ApplyFormBody`, submit off, links inert), scrolled to that step's part (`formAnchor`). Start previews the form too, before it exists: `draftPreviewForm` from the name, purpose and paid choice as they are set (contact details only, plus business details when it charges, until a template fills it). Lineup and Floor map keep the event page (both show there).

**Device frames (both wizards).** `PreviewDevice` puts the page in a phone (390 × 844, status bar and island) or a laptop (1280 × 800, browser bar and base) on a dotted stage, scaled as one to fit. Both frames share one element tree, so switching never reloads the iframe.

**No step menu (both wizards).** The header has no menu button, and the progress area is the `role="progressbar"` fill alone (`aria-valuetext` "Step n of N"): no step labels, no "Step n of N — Title" / "Editing Title" line, no routine "Saving… / Saved". Back and Next move between steps; the edit-mode rail and the step sheet were removed. Save *problems* still show, in the footer beside Back (`SetupFooter` `status`): "Couldn't save — Retry", "Not saved: fix N fields", and "Unsaved changes" on a live event.

**Preview chrome (both wizards).** No "Preview" header bar: the Phone / Desktop choice is an icon radio pair centred above the device on the dotted stage (names in sr-only text, `title` tooltips); on phones the preview sheet keeps a Close button at its top right.

Organizers start a flow from **Add to this event** on the event's Overview, from **What's next** on the wizard's Done screen, or from **Add a form** on the event's Applications tab. Editing an existing form opens its flow at Form details.

## Flows

Route: `/admin/events/<eventId>/setup/<flow>?step=<key>&form=<formId>&org=<orgId>` (full screen, no admin sidebar).

| Flow (`<flow>`) | Purposes | Steps |
|---|---|---|
| `vendors` | VENDOR | Start · Form details · Options and pricing (PAID) · How vendors choose and pay (PAID) · Floor map (MAP) · Fields · Review and open |
| `special-guests` | SPECIAL_GUEST | Lineup · Application form (optional) · Form details · Fields · Review and open |
| `volunteers` | VOLUNTEER | Start · Form details · Fields · Review and open |
| `other-applications` | SPONSOR, PRESS, PANEL, OTHER | Start (purpose picker) · Form details · Fields · Review and open |

- **Start** creates the form: name (prefilled `<Event> Vendor Application`), purpose (Other only) and "Charge for space" (hidden on free-only purposes). Nothing else: no template picker, no list of this event's forms. **One live form per purpose per event**: a single-purpose flow (vendors, volunteers, special guests) whose event already has a form that is not CLOSED skips Start and opens that form's details (`useFormFlow`); on Other applications a purpose that is taken shows "This event already has a … form" with a link and Create does nothing. The wizard creates with `setup: true`, and `createForm` then refuses a second live form of that purpose (409 `FORM_EXISTS`); API callers without the flag (CLI, MCP, tests) are not limited. Next ("Create form") posts the form and continues at Form details with `&form=` in the URL.
- **Steps after Start need the form.** Without `&form=` they are listed but not linked ("available once the form is created"). Anything invalid (an unknown step, a hidden step, a deleted form) is replaced in the URL.
- **Form details** and **How vendors choose and pay** are parts of the shared `SettingsCard` (`section` prop; no card frame in a step, one setting per row, radio groups as `fieldset` + `legend`). The slug is not editable: it is made from the name at create time and never changes. How vendors choose and pay has no floor-map choice: new forms sell options (`spaceSelection: TIERS`), and a form already on MAP keeps it (sent back unchanged) and keeps its Floor map step. **Options and pricing** is `TiersCard` with `embedded` (no frame, the step's h1 names it). The footer's Next submits the card (`<button form=…>`), saves the whole card, and moves on only when the save succeeded.
- **Tiers, questions and the lineup** save each change themselves; Next just moves on.
- **Review and open** lists each part with an Edit link to its step, then Status (saved by "Save and finish"), View public form, View applications, and Delete (no applications yet) or Close (it has some). There is no save-as-template option. On a DRAFT event an open form takes applications once the event publishes; the event wizard's Review still offers "Open applications when I publish".
- **Fields** (step key `questions`, so old `?step=questions` links still work) is `QuestionsCard`: First name, Last name and Email as locked chips (always asked by every apply form), an **Ask for business details** switch (`onToggleBusiness`; locked on for PAID forms, the tick shows at once and settles on the saved value), then the questions to add, edit, reorder and remove.
- **Special guests** starts at the Lineup, which needs no form; Start offers "Finish without a form".
- A form opened in the wrong flow (`&form=` of another purpose) moves to the flow of its purpose.

## Blank start, Fields and templates (PRs #465, #466)

- **A new form starts blank.** `ApplicationFormService.createForm` with no template and no `questions` (the wizard's Create form) creates no questions and sets `collectBusiness = kind === 'PAID'` (a PAID form must collect business details, `_assertEventFormRules`). The per-purpose suggested questions are gone; `applicationFormDefaults.js` keeps only `FORM_PURPOSES` and `FREE_ONLY_PURPOSES`. A caller that sends its own `questions` (CLI, MCP, tests) keeps the column default (`collectBusiness: true`); a template applies its own settings and questions.
- **One business switch.** The "Ask for business details" switch lives in `QuestionsCard` and is shared by the flow's Fields step (`PATCH` the form, then `f.forms.upsert`), the standing-form Fields tab (`/admin/contacts/forms/:id`) and the template editor (`definition.collectBusiness`). Never add a second one.
- **Save as template at finish.** Review's checkbox replaces the Save as template button and dialog in the flows. On "Save and finish" `ReviewFormStep.finish` calls `POST …/save-as-template` (`{ name }`, or `{ replaceTemplateId }` for Update) *before* the status save. A refusal (409 name clash, 400) shows an alert and stays on the step; a template already saved in this visit is updated on retry (`savedTemplateId`), never duplicated. The standing-form page keeps `SaveAsTemplateDialog`.
- **Templates list.** Contacts › Forms (`/admin/contacts/forms`) lists the organization's templates under its standing forms (`GET /admin/application-templates`): name, purpose, Paid / Free, question count, updated date, with **Edit** (`/admin/events/templates/:id`) and **Delete** (`DELETE /admin/application-templates/:id`, confirm) for `applications.forms`. This is the one approved exception to "never add a library page" (spec 037 D2, AGENTS.md gotcha 18). Templates are still *used* from Start's Start with picker.
- **Volunteer shifts removed.** `VolunteerShift` / `ApplicationShift`, the Shifts step, apply-form picker, approval assignment, roster filter / column, CSV column and data-rights entries are gone; migration `20261109120000_drop_volunteer_shifts` dropped the tables (shift rows were discarded). An old `?step=shifts` link falls back to Form details like any unknown step.

## Old links

The spec 050 application step keys still arrive from emails, bookmarks and readiness items:

- `setup?step=vendors|special-guests|volunteers|other-applications[&form=<id>]` → that form's flow at Form details, or the flow's first step (`legacyFlowHref` in `formFlows.ts`, applied by `useSetupFlow`).
- `setup?step=floor-map` → the vendor flow's Floor map step of the first VENDOR form with `spaceSelection: MAP`.
- A draft whose saved `setupStep` is one of those keys resumes at Review (`FORMER_STEPS`). The backend no longer accepts them in `PATCH setupStep` (`EVENT_SETUP_STEPS`).
- Readiness items keep their spec 050 `step` and carry `formId` (`MAP_FORM_WITHOUT_PUBLISHED_MAP` too, since 051); `readinessHref` maps them to the flow.
- `applications/forms` → the vendor flow; `applications/forms/<id>` → the form's flow.

## Permissions

No new catalog key: the flows are a sub-area of **`events`**, and the Templates list on Contacts › Forms is a sub-area of **`customers`** (its Edit / Delete need `applications.forms`, the same action as the template routes) (`/admin/events` in `adminPaths`) and use the existing actions. Add to this event, What's next and Add a form show only with **`applications.forms`** (ADMIN + ORGANIZER by default). Without it a flow is read-only and says so. The lineup keeps its own route guard. See [Roles & permissions](rbac.md).

## Accessibility and layout

Mobile first: one column, 44 px targets, no horizontal scroll at 320 px. Each step change focuses the h1 and announces "Step n of N, <title>" (`aria-live`). Step state is shown by icon and text, never colour alone. The Add a form menu is a disclosure (button with `aria-expanded` + list of links), not an ARIA menu: Tab moves through it, Escape closes it and returns focus. Contrast holds on hover in dark mode (`dark:text-slate-300` on tile and row descriptions).

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/components/event-setup/formFlows.ts` | `FORM_FLOWS` registry, `flowSteps`, `formFlowHref`, `formEditHref`, `legacyFlowHref` |
| `frontend/src/components/event-setup/useFormFlow.ts`, `FormFlowPage.tsx` | Flow state (form, step, URL) and the page in the wizard shell |
| `frontend/src/components/event-setup/steps/StartFormStep.tsx`, `ReviewFormStep.tsx` | Start and Review and open |
| `frontend/src/components/event-setup/ApplyFormPreview.tsx`, `previewMessages.ts` (`previewForm`), `PreviewDevice.tsx` | Live form preview, device frames |
| `frontend/src/components/applications/ApplyFormBody.tsx`, `app/events/[eventId]/apply/ApplyShell.tsx` (`ApplyFrame`) | Apply form body and frame, shared by the public page and the preview |
| `frontend/src/app/admin/events/[eventId]/setup/[flow]/page.tsx` | Route |
| `frontend/src/components/events/AddToEvent.tsx` | `ADD_TO_EVENT` entries and the Overview card |
| `frontend/src/app/admin/events/[eventId]/applications/ApplicationsHeader.tsx` | Add a form menu |
| `frontend/src/components/applications/FormEditorCards.tsx` | `SettingsCard` `section` / `formId` / `hideSubmit`; `QuestionsCard` contact chips + `onToggleBusiness` (Fields) |
| `frontend/src/app/admin/contacts/forms/page.tsx` (`TemplatesSection`) | Templates list under standing forms |
| `backend/src/services/ApplicationFormService.js` (`createForm`), `applicationFormDefaults.js` | Blank start, purposes |
| `backend/src/services/ApplicationFormTemplateService.js` (`saveFrom`) | Save / replace a template from a form |
| `frontend/src/app/admin/AdminLayoutClient.tsx` | `FULL_SCREEN` covers `setup/<flow>` |

## Tests

- Vitest: `tests/unit/formFlows.test.ts`, `previewForm.test.ts`, `eventSetupSteps.test.ts` (8 steps, former keys resume at Review), `eventWizard.test.ts`, `eventReadiness.test.ts`.
- Jest: `tests/unit/eventReadiness.test.js` (map warning `formId`), `tests/contract/eventSetupDraft.test.js` (`setupStep: 'vendors'` → 400), the shared `eventSetupSteps.fixtures.json`.
- Jest: `tests/contract/applicationFormDefaults.test.js` (every purpose starts blank, business only on PAID, explicit `collectBusiness` wins), `applicationFormPurpose.test.js`.
- Playwright: `admin-event-application-flows` (each flow, Fields chips and business switch, MAP → Floor map, purpose lock, old links, axe light / dark, 390 and 320 px), `admin-event-details` (Add to this event), `admin-event-setup-floor-map`, `event-guest-lineup`, `admin-event-edit-mode`, `applications-add-ons`, `participants-templates` (checkbox at finish: name clash keeps you there, then saves), `content-forms` (Templates empty state), `admin-event-setup-entry` (What's next).

## Gotchas

- **One form per run.** Do not bring back a list of forms with inline editors; a second vendor form is a second run.
- **Next decides from the saved form.** A step list computed before a save goes stale (MAP adds Floor map); `saveAndContinue` uses the PATCH response.
- **Deleting ends the run.** Delete leaves for the Overview without reloading the forms, or the flow restarts without its form.
- **Don't bring back default questions.** The wizard preview must show only what the organizer added; suggestions belong in templates.
- **`getByLabel('Name')` is a substring match.** Start's Blank form hint and the business switch avoid the word "name" so Playwright's Name field stays unique.
- **Stay full screen.** A new route under `setup/` needs `FULL_SCREEN` in `AdminLayoutClient.tsx`, or the shell renders inside the admin sidebar.

## Related Features

- [Event Setup Wizard](event-setup-wizard.md), [Event Details](event-details.md)
- [Applications](applications.md), [Vendor Space Selection](vendor-space-selection.md), [Floor Map Builder](map-builder.md)
