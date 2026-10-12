# Settings › Notifications (store-edited emails)

**Status**: Implemented (spec 053, 2026-10-12)
**Last Updated**: 2026-10-12

## Overview

**Settings › Notifications** (`/admin/settings/notifications`) lists every email a store sends to its customers, vendors and guests, grouped in cards. `/admin/settings/applications` (the old name) 308-redirects here.

- Each email is a row (name, subject, **Customized** when the store changed it, **Off** when an optional email is switched off). The row opens a dialog built on `SettingsDialog`:
  - **Subject** and **Message**: plain text with `{{merge.fields}}` and `{{#section}}…{{/section}}`. Every merged value is escaped; stores never write HTML.
  - **Added automatically below your message**: the email's system blocks (see below).
  - **Preview** tab: the unsaved draft rendered with sample data in a sandboxed iframe (`srcdoc`, `sandbox=""`). Sample data is fixed; no real buyer is ever shown.
  - **Send me a test**: sends the draft, subject prefixed `[Test]`, to the signed-in staff member only.
  - **Reset to default** (customized emails) and a **Send this email** switch (optional emails only).
- **Staff notifications** card: the daily application digest switch (spec 011 phase 3). It is a switch, not an editable email.

| Group | Key | Sent when | System blocks |
|---|---|---|---|
| Orders & tickets | `order.confirmation` | A ticket order is paid | Order summary + total, View Tickets button and QR note, account sign-in box |
| RSVPs | `rsvp.confirmation` | A guest RSVPs | Event card (when, where, party size), cancel link, `.ics` invite |
| RSVPs | `rsvp.reminder` (**optional**) | ~24 h before the event | Event card, Cancel RSVP button, why-you-got-this note |
| RSVPs | `rsvp.cancelled` | An RSVP event is cancelled | Event date in the venue zone |
| Application payments | `application.receipt` | An application order is paid (card or offline) | Lines, total paid, payment method, booth + map link, application and account links |
| Event applications | `application.event.<ACTION>` (11) | Decisions on event application forms | None: the message is the whole email |
| Standing forms | `application.standing.<ACTION>` (4) | Decisions on standing forms (spec 044) | None |

Not listed and not editable: buyer sign-in links and codes, buyer email change, data export / erasure notices (spec 040), and Eventimus account email (invites, security notices). Those are security or legal mail.

Cancelling a **paid** event sends ticket buyers no email today; only RSVP guests get `rsvp.cancelled`.

## Model

- `NotificationTemplate { organizationId, key, subject, body, enabled }`, unique on `(organizationId, key)`. A row exists only once the store saves a change; reset deletes it. `enabled` is accepted only for keys the registry marks `optional`.
- The **registry** `backend/src/config/notifications.js` is the single source for keys, groups, labels, "sent when" copy, merge fields, system-block descriptions and defaults. A key is a string, not an enum: a new email needs a registry entry, a sample in `EmailService` (`SAMPLES`) and a `build…` method, not a migration. Application decision defaults and merge fields stay in `config/applications.js` and are pulled in from there.
- `NotificationTemplateService`: `list`, `get`, `update`, `reset`, and `resolve(orgId, key)`, which returns the store's wording or the default and never throws for a known key, so a failed lookup never stops an order email.
- `EmailService` splits each editable email into `build…` (a pure message: rendered template + system blocks + plain-text part) and the sender (resolve → build → deliver). `previewNotification` / `sendNotificationTest` reuse the builders with sample data.
- Application decision emails were stored in `ApplicationMessageTemplate` until spec 053-D: migration `20261106120000` copied the rows to `application.<event|standing>.<ACTION>` keys and `20261107120000` dropped the old table. `ApplicationTemplateService` still renders and sends them (`render`, `send`, `contextFor`); staff can still edit one per applicant in the decision dialog.

## API

| Method | Path | Guard |
|---|---|---|
| GET | `/admin/settings/notifications` → `{ groups: [{ key, label, notifications: [...] }] }` | any staff |
| PUT | `/admin/settings/notifications/:key` `{ subject, body, enabled? }` | `settings.notifications` |
| DELETE | `/admin/settings/notifications/:key` (reset) | `settings.notifications` |
| POST | `/admin/settings/notifications/:key/preview` `{ subject?, body? }` → `{ subject, html }` | any staff |
| POST | `/admin/settings/notifications/:key/test` `{ subject?, body? }` → `{ sentTo }` | `settings.notifications`, limiter `NOTIFICATION_TEST` (10 / h) |
| GET / PATCH | `/admin/settings/application-digest` | any staff / `settings.notifications` |

Unknown key → 404; empty or over-long subject/body, unbalanced sections, unknown fields or `enabled` on a non-optional key → 400.

## Permissions

Catalog action **`settings.notifications`** (ADMIN by default), under the locked `settings` feature. It replaced `settings.applications`: a role override saved for the old key still applies to the new one until one is saved for it (`SPLIT_KEYS` in `PermissionService`).

## Files

| File | Role |
|---|---|
| `backend/src/config/notifications.js` | Registry |
| `backend/src/services/NotificationTemplateService.js` | Storage, defaults, resolve |
| `backend/src/services/EmailService.js` | Builders, samples, preview, test send |
| `backend/src/utils/renderTemplate.js` | `renderTemplate`, `cleanTemplate` (shared with application emails) |
| `frontend/src/app/admin/settings/notifications/page.tsx` | The page |
| `frontend/src/app/admin/settings/notifications/TemplateDialog.tsx` | Edit / Preview dialog |
| `frontend/src/app/admin/settings/notifications/useNotificationsApi.ts` | API hook |
| `backend/tests/contract/notificationTemplates.test.js`, `frontend/e2e/admin-settings-notifications.spec.ts` | Tests |

Spec: `specs/053-notification-templates/plan.md`.
