# Spec 053 — Notification templates

Status: **Planned** (2026-10-11). Follows PR #445 (Settings › Applications became Settings › Notifications, one row per email, edit in a dialog).

## 1. Goal

Settings › Notifications lists **every email the system sends on the store's behalf**. The store can edit the wording of the customer-facing ones. Today only the 15 application decision emails can be edited (`ApplicationMessageTemplate`). Every other email is an HTML string hardcoded in `backend/src/services/EmailService.js`.

Out of scope: SMS or push, per-event overrides, a visual HTML email builder, and translations (the language toggle stores the language only, spec 030).

## 2. Inventory (2026-10-11, `EmailService.js`)

| Email | Sender method | Called from | Branding | Plan |
|---|---|---|---|---|
| Order confirmation | `sendOrderConfirmation` | `PaymentService` (webhook), `admin.js` resend | Store | **Editable** |
| Event cancelled (tickets / RSVP) | `sendCancellationNotification` | `EventService` cancel | Store | **Editable**, two keys |
| RSVP confirmation | `sendRsvpConfirmation` | `RsvpService` | Store | **Editable** |
| RSVP reminder (~24 h before) | `sendRsvpReminder` | `RsvpReminderService` sweep | Store | **Editable** |
| Application payment receipt | `sendApplicationReceipt` | `ApplicationPaymentService` | Store | **Editable** |
| Application decisions (11 event + 4 standing) | `sendApplicationMessage` | `ApplicationTemplateService` | Store | Editable already, moves to the new table (phase 3) |
| Buyer sign-in link / code | `sendBuyerLoginEmail` | buyer auth, `admin.js` | Store | Listed, **locked** (security) |
| Buyer email change confirm / notice | `sendBuyerEmailChange*` | buyer account | Store | Listed, **locked** |
| Data export / erasure notices (4) | `sendBuyerNotice` | `ContactErasureService` | Store | Listed, **locked** (spec 040 legal copy) |
| Daily application digest | `sendApplicationMessage({ staff: true })` | `ApplicationDigestService` | Eventimus | Listed under Staff, toggle only (exists) |
| Dispute alert | `sendApplicationMessage({ staff: true })` | `DisputeService` | Eventimus | Listed under Staff, not editable |
| Contact-form inquiry (to the store) | `sendContactInquiry` | `ContactInquiryService` | Store → store | Listed under Staff, not editable |
| Staff invite, system admin invite, security notices, re-auth code, recovery, secondary email, staff email change | `sendStaffInvite` etc. | account / security services | Eventimus | **Not listed**: account email, not store communication |

**Rule:** the store can edit what it says to its customers. It cannot edit security or legal mail (a broken sign-in or erasure email locks people out or breaks spec 040), and it cannot edit Eventimus account mail.

Bug found during the inventory: `sendCancellationNotification` tells buyers to contact `support@jump.events`. Fix it in phase 1 by using the store email as `reply_to` and in the text.

## 3. Design

### 3.1 What the store edits

A template is **subject + message** (plain text, `{{merge.fields}}`, `{{#section}}…{{/section}}`), the same syntax and renderer as today (`renderTemplate` in `ApplicationTemplateService.js`, moved to `utils/renderTemplate.js`). Every merged value is escaped, and organizers never write HTML.

The **system blocks** that carry function stay out of the template. The renderer appends them below the message and the dialog names them ("Added automatically: order summary, View tickets button"):

- order confirmation: tickets / add-ons / total card, View tickets button, the "account is ready" box
- cancellation: event date in the venue zone (spec 033)
- RSVP confirmation / reminder: event card, Add to calendar (.ics), cancel link
- application receipt: the line items and the payment method

That way a store cannot delete the ticket link or the cancel link, and money lines always come from the ledger (gotcha 17), never from text the store typed.

### 3.2 Data

```prisma
model NotificationTemplate {
  id             String   @id @default(cuid())
  organizationId String
  key            String   // registry key, e.g. "order.confirmation"
  subject        String
  body           String
  enabled        Boolean  @default(true) // only for keys the registry marks optional
  updatedAt      DateTime @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([organizationId, key])
}
```

A row exists **only when the store changes something** (the same lazy defaults as application templates), so "Customized" = a row exists and differs from the default. `key` is a string checked against the registry, not a Prisma enum, so adding an email never needs a migration.

Register the model in `backend/src/audit/features.js` (gotcha 35). This is not buyer data, so spec 040 export and erasure are not affected.

### 3.3 Registry — `backend/src/config/notifications.js`

One entry per key: `{ key, group, label, when, audience: 'buyer'|'staff', editable, optional, mergeFields, defaults: { subject, body }, blocks: [...] }`. It is the single source for:

- the API list (the frontend renders groups and rows from it, with no frontend copy of the labels)
- validation (unknown key → 404, merge fields → warning on unknown `{{x}}`, matching how missing alt text is a warning in spec 046)
- tests (each key renders its default against a sample context without throwing)

Groups shown in Settings › Notifications: **Orders & tickets** · **RSVPs** · **Event applications** · **Standing forms** · **Account & privacy** (locked rows) · **Staff notifications**.

### 3.4 Service — `NotificationTemplateService`

- `list(orgId)` → registry merged with stored rows
- `update(orgId, key, { subject, body, enabled? })`, `reset(orgId, key)`
- `render(orgId, key, context)` → `{ subject, text, html }`: the stored row or the default, then `renderTemplate`, then the shared branded shell plus the key's blocks
- `preview(orgId, key, draft?)` → render against a **sample context** (fake buyer, the store's next event or a stub). It powers the dialog preview and never sends anything

`EmailService` senders become thin wrappers. They build the context, call `render`, then `deliver` (with the order-confirmation retry loop kept as is). The HTML shells are factored into one store-branded `storeEmail({ organization, heading, paragraphs, blocks })` so every editable email looks the same. This is the riskiest part, so each email moves in its own card with a snapshot test of the rendered default (see §6).

A disabled optional email (`enabled: false`) is skipped with a log line. Only the **RSVP reminder** is optional in v1. Order, cancellation and receipt emails can never be turned off.

### 3.5 API (`admin.js`, `activeOrgFor`)

```
GET    /admin/settings/notifications                 → { groups: [{ key, label, rows: [...] }] }
PUT    /admin/settings/notifications/:key            requirePermission('settings.notifications')
DELETE /admin/settings/notifications/:key            (reset)  same guard
POST   /admin/settings/notifications/:key/preview    { subject, body } → { subject, html }
POST   /admin/settings/notifications/:key/test       sends the preview to req.user.email, rate-limited (new limiter NOTIFICATION_TEST, 10 / h)
```

The old `/admin/settings/application-templates*` routes stay as wrappers until phase 3 ends.

### 3.6 Permission

Add the catalog action `settings.notifications` ("Edit notification emails and the application digest"). For one release, `PermissionService` reads an existing `settings.applications` override as the value of `settings.notifications` when the new key has none. After that, remove `settings.applications` (with a test that no stored override is lost). The contract test pins `permissionService._cache` and checks that a role without the action gets 403 on PUT, DELETE and test.

### 3.7 Frontend

The PR #445 page renders from `GET /admin/settings/notifications`:

- a row per key (label, subject, "Customized", "Off" for a disabled optional email, a lock icon + "Sent by Eventimus for security" for locked keys)
- `TemplateDialog` gains a **Preview** tab (sandboxed `srcdoc` iframe of the rendered HTML, debounced 400 ms), an **"Added automatically"** list of the key's blocks, merge-field chips that insert at the cursor, **Send me a test**, and an on/off switch for optional keys
- locked rows open the same dialog read-only, with the preview only

## 4. Phases / cards

| Card | Scope | Depends on |
|---|---|---|
| **053-A** | Registry, model + migration, service (`list/update/reset/render/preview`), `utils/renderTemplate.js` extraction, `storeEmail` shell, `settings.notifications` action + alias, API, audit mapping. **Order confirmation** moved onto it. Snapshot tests | — |
| **053-B** | Cancellation (tickets + RSVP keys; fixes `support@jump.events`), RSVP confirmation, RSVP reminder (optional toggle), application receipt | A |
| **053-C** | Frontend: page from the new API, groups, Preview tab, Send me a test, locked rows, optional switch | A (B for the full list) |
| **053-D** | Expand/contract application templates: backfill `ApplicationMessageTemplate` rows into `NotificationTemplate` (`application.event.APPROVED`, `application.standing.RECEIVED`…), switch `ApplicationTemplateService` + `DecisionDialog` to read them, keep the old table read-only for one deploy, then drop it with the old routes and the `settings.applications` key | A, C |
| **053-E** | Wiki `docs/wiki/features/notifications.md`, AGENTS gotcha, STATUS row | all |

## 5. Risks

- **Rendering regressions in money mail.** The order confirmation and receipt are the emails buyers keep. Mitigation: snapshot the default HTML before and after each move. The money block is never template text.
- **Deliverability.** Edited copy can trip spam filters. Mitigation: plain-text part always sent (it is not today for orders), unchanged From/reply-to, Send me a test.
- **Merge-field misuse.** An unknown field renders empty. The dialog warns and does not block (an empty name beats a refused save).
- **Old link targets.** `DecisionDialog` and the digest copy say "Settings › Notifications" since #445, so the frontend needs no URL change.
- **Spec 040.** Locked buyer notices stay in code. Do not move them into the registry as editable.

## 6. Tests

- unit: `renderTemplate` (moved, existing cases), registry shape (every key has defaults, label, group; every `{{x}}` in a default is in its merge fields), and `render` of every key against the sample context
- snapshot: the default HTML of each migrated email equals the pre-migration output (whitespace-normalized)
- contract: list/update/reset/preview/test, 403 without `settings.notifications`, 404 unknown key, locked key refuses PUT (409 `NOTIFICATION_LOCKED`), test-send rate limit, a disabled RSVP reminder is not sent by the sweep, and the alias honors an old `settings.applications` override
- e2e (mocked): open a row, edit, preview updates, save, then reset, a locked row is read-only, and axe on the dialog

## 7. Open questions

1. Should **ticket-holder reminders** (like the RSVP reminder, for paid events) exist? Not today. That is a new email and a new sweep, so it belongs in a later card, not this spec.
2. Should the store be able to edit the **sign-in email's intro line** only (not the code or link)? Default: no, locked.
3. Should the **test send** go to the staff member's email or the store email? Default: the staff member's own (`req.user.email`).
