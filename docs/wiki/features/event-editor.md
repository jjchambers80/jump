# Event Editor (Admin) — retired

**Status**: Retired in spec 050-P (2026-10-11). The [Event Setup Wizard](event-setup-wizard.md) is the only event editor.
**Last Updated**: 2026-10-11

The old event editor (spec 037 phase 3: `/admin/events/new`'s one-page form and the two section editors `edit/details` and `edit/sales` over `edit/EventEditor.tsx`, plus the four Details flyouts in `components/events/EventFlyouts.tsx`) was deleted once the owner signed the wizard parity checklist (PR #431) and the wizard went on in prod. Its history is in git (last on `main` before 050-P).

## What the old URLs do now

| Old URL | Now |
|---|---|
| `/admin/events/new` | The setup wizard, steps 1–3 (no row until the date step) |
| `/admin/events/:id/edit#event-…` | Redirect to the wizard step that owns the section (`legacyEditStep` in `frontend/src/lib/eventWizard.ts`; fallback `name`) |
| `/admin/events/:id/edit/details#…` | Same map, fallback `name` |
| `/admin/events/:id/edit/sales#…` | Same map, fallback `tickets` |
| `/admin/events/:id/applications/forms` | `setup?step=vendors` |
| `/admin/events/:id/applications/forms/:formId` | `setup?step=<the form's purpose step>&form=<id>` |

Every redirect is `components/event-setup/WizardRedirect.tsx`, which carries `?orgId=` / `?org=` as `&org=` so a member of two organizations lands in the right one. Keep these routes for bookmarks and email links; never put a form back on them.

## What stayed

- `components/events/EventFormLayout.tsx` (`EventFormShell`, `FormCard`, `FormAlert`, `EventFormActions`, `AdmissionModeField`, `RsvpSettingsFields`, the input classes), `EventSaveCard` and `jumpTo` in `EventEditSummary.tsx`: the venue editor and the wizard's Tickets step use them.
- `components/events/tierForm.ts`, `EventTaxSummary.tsx`, `TierEditDialog`, `TierCard`, `TierPresetMenu`, `EventMediaCard`, `VenueFlyout`, `SlugField`, `AddOnsSection` (moved to `components/events/add-ons/`): the wizard's steps compose them.
- The rule that admin pages never scroll with a plain `#anchor` or `scrollIntoView` (scroll `<main>` with `jumpTo`) still holds; see `frontend/AGENTS.md`.

## Related Features

- [Event Setup Wizard](event-setup-wizard.md)
- [Event Details](event-details.md)
