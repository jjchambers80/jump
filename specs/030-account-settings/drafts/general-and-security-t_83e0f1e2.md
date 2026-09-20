# Feature Specification: Account Settings — General and Security

**Feature Branch**: `030-account-settings`
**Created**: 2026-09-20
**Status**: Draft — implementation-ready after product decisions
**Input**: Account controls opened from the signed-in user's name and email in the organization menu. The request covers personal profile, Jump-local preferences, connected login methods, account security, and active sessions.

## Scope and terminology

This feature is for the authenticated Jump account, not an organization, venue, event, or storefront. A user's preferred language and time zone affect the Jump administration experience only; they do not localize customer-facing storefronts. “Remove their phone number” is interpreted as remove the phone number from the account. The source phrase ends with “Remove their…” in one place; no additional deletion behavior is inferred from that unfinished phrase.

The existing frontend has Google OAuth and magic-link authentication (`frontend/src/auth.ts`). Password, passkey, two-step authentication, secondary email, provider disconnect, and device-session controls must not be represented as available until their backend/auth support is implemented and verified.

## User scenarios and priorities

### Story 1 — Open personal settings (P1)

A signed-in staff user clicks their name/email in the organization menu and chooses the account settings entry. Jump opens `/admin/settings/users/general`, with a settings navigation containing General and Security. The page is account-scoped and does not change when the active organization changes.

Acceptance scenarios:

1. Given an authenticated ADMIN, ORGANIZER, or SYSTEM_ADMIN, when they activate their name/email menu, then they can reach General in one action.
2. Given an authenticated user, when they visit `/admin/settings/users/general`, then the account settings shell renders and General is selected.
3. Given an unauthenticated visitor, when they request either account-settings route, then middleware redirects to sign-in with a callback URL.
4. Given an authenticated user without staff/admin access, when they request either route, then the route denies access using the existing admin authorization behavior.
5. The organization switcher and storefront settings are not shown as substitutes for personal account settings.

### Story 2 — Maintain profile information (P1)

The user can upload, replace, preview, and remove an avatar/photo; edit first name, last name, email address, and phone number; and save or cancel changes. Personal profile changes are independent of organization membership and organization contact details.

Acceptance scenarios:

1. The page loads the current values, including an empty state for missing photo, phone, or optional name fields.
2. The user can select a supported image, see a local preview, replace it before saving, or remove an existing photo with confirmation.
3. The server validates image MIME by content, not only filename; rejects unsupported or oversized files without replacing the current photo.
4. Name, email, and phone edits show field-level validation and preserve valid unsaved values after a failed save.
5. Save sends only changed fields/files. Cancel restores the last server snapshot and clears the dirty state.
6. An email change does not silently make the new address active if product policy requires confirmation; the UI explains pending confirmation and recovery behavior.
7. Removing a phone number is explicit, reversible by adding it again, and does not affect customer Contact records.

### Story 3 — Set Jump-only preferences (P1)

The user can set a preferred language and account time zone. These values control authenticated administration UI formatting and copy only; they do not alter public store language, organization auto-redirect behavior, or customer communications unless separately specified.

Acceptance scenarios:

1. Language options are limited to the supported list and show the current value.
2. Time zone uses an IANA identifier and displays a human-readable label plus UTC offset where useful.
3. A preference save is scoped to the account and remains after organization switching and a new session.
4. Changing language or time zone does not change the active organization's storefront settings.
5. If the browser locale or time zone is used as an initial default, it is only a default; it must not overwrite an explicit account value.

### Story 4 — Manage authentication and recovery (P1, phased)

On Security, the user can manage the authentication methods that the current auth system actually supports: connected external providers, any local password/passkey capability, secondary recovery email, and two-step authentication. Security-sensitive changes require recent authentication or step-up verification when defined by the final security policy.

Acceptance scenarios:

1. Security lists each connected provider without exposing provider access tokens.
2. Disconnecting a provider is refused when it would leave the user with no usable sign-in/recovery method, unless the user first adds another method.
3. Provider disconnect revokes/deletes the local provider account link and records an audit event; it does not claim to revoke a provider token unless the provider integration supports that operation.
4. Password creation/change uses a masked form, never displays or logs the password, and rejects weak/reused values according to the selected policy.
5. Passkey enrollment uses WebAuthn/browser prompts and shows the registered credential label and last-used metadata; private keys never enter Jump.
6. Two-step setup requires verification before activation; recovery codes are shown once with a download/copy path and cannot be retrieved in plaintext later.
7. Secondary email add/remove requires confirmation and cannot be used as an unverified recovery channel.
8. A user can see which security methods are active and receives clear failure/retry guidance.

### Story 5 — Review and revoke sessions (P1)

The user can inspect active devices/sessions and revoke one device or all other devices. Each row includes device type, approximate last-login time, city/state/country when available, and a clear logout action.

Acceptance scenarios:

1. The current session is identifiable and cannot be accidentally revoked by the single-device action without confirmation.
2. Revoking a session invalidates its server-side/session token at the next request; it does not only remove a UI row.
3. “Log out all devices” requires confirmation and clearly states whether the current device remains signed in. The final policy must be consistent everywhere.
4. Unknown location data is shown as unavailable, not guessed.
5. Session/device data is privacy-minimized and never exposes raw tokens, password material, or provider credentials.

## Page structure and interaction

Route hierarchy:

- `/admin/settings/users/general`
- `/admin/settings/users/security`

The organization-menu account item should show the signed-in user's display name, email, and avatar when available. It links to General; it must not be confused with organization Users management. The settings shell reuses the existing admin settings conventions (`SummaryRow`, `SettingsDialog`, focus trapping, Escape handling, discard confirmation, and per-card PATCH behavior) where applicable.

General sections, in order:

1. Profile photo: current avatar, upload/replace, remove.
2. Personal information: first name, last name, email, phone.
3. Jump preferences: language and time zone.

Security sections, in order:

1. Sign-in methods: password/passkey and connected providers supported by the implementation.
2. Recovery: secondary email and recovery codes where supported.
3. Two-step authentication.
4. Devices/sessions.

Each editable card has a stable heading, current-value summary, Edit action, and a modal or dedicated form. Forms provide Save and Cancel, disabled save while a request is in flight, field errors, success feedback, and an unsaved-change guard. No save should be implied by changing a select or uploading a preview.

## Functional requirements

- **FR-001**: The organization-menu name/email entry MUST link to account-scoped General settings.
- **FR-002**: General and Security MUST be reachable at the route hierarchy above and protected by existing authenticated-admin middleware/guards.
- **FR-003**: Personal profile data MUST be stored on the authenticated User identity, not on Organization, OrganizationMember, Contact, or storefront records.
- **FR-004**: The system MUST support first name, last name, email, optional phone, preferred language, optional time zone, and optional avatar/photo state according to finalized schema constraints.
- **FR-005**: PATCH operations MUST whitelist fields and validate only supplied fields; unrelated cards MUST not overwrite each other.
- **FR-006**: Photo uploads MUST use server-side content/MIME validation, configured size/type limits, safe generated storage names, and removal of old files only after the replacement is durable.
- **FR-007**: Email and phone changes MUST define their verification, uniqueness, normalization, notification, and rollback behavior before implementation.
- **FR-008**: Account preferences MUST be separate from customer/storefront localization settings.
- **FR-009**: Security mutations MUST be self-service by default, require recent authentication/step-up where the final policy says so, and create auditable events without recording secrets.
- **FR-010**: External-login disconnect MUST enforce a recovery/sign-in floor and accurately describe provider-token revocation limits.
- **FR-011**: Password/passkey/2FA controls MUST use established secure protocols and must not accept or persist plaintext secrets, passkeys, OTPs, or recovery codes in application logs.
- **FR-012**: Session revocation MUST invalidate the relevant server-side/session credential, not merely hide it from the list.
- **FR-013**: Session listings MUST expose only privacy-minimized metadata and must tolerate missing/unknown geolocation.
- **FR-014**: All account-settings forms MUST be keyboard accessible, label controls, expose errors programmatically, preserve focus on dialog close, and support responsive layouts.
- **FR-015**: Destructive actions (photo removal, provider disconnect, session logout, logout-all, recovery-method removal) MUST require an explicit confirmation and explain consequences.
- **FR-016**: The UI MUST distinguish loading, empty, dirty, saving, success, validation failure, authorization failure, conflict, network failure, and expired-session states.

## Conceptual data and API needs

The implementation should extend the existing User identity and auth schema rather than introduce duplicate account records. Exact names remain an implementation decision, but the design needs:

- User profile fields: first name, last name, normalized email/pending email state, phone representation, preferred language, IANA time zone, avatar reference.
- Avatar/file lifecycle: ownership, content type/size metadata, safe public/private delivery policy, replacement/removal cleanup.
- Auth links: provider identifier and provider account metadata without access-token exposure.
- Password/passkey/2FA/recovery records only if those capabilities are enabled; secrets must be hashed/encrypted as appropriate.
- Sessions/devices: revocable session identifier, user agent/device category, last-used time, approximate location metadata if legally and technically available, created/revoked timestamps.
- Audit events for profile/security mutations, actor, result, timestamp, and request metadata subject to privacy limits.

Possible API surface (names are guidance, not a frozen contract):

- `GET /admin/account`
- `PATCH /admin/account/profile`
- `POST /admin/account/avatar` and `DELETE /admin/account/avatar`
- `POST /admin/account/email/verify` or equivalent confirmation flow
- `GET /admin/account/security`
- `POST/DELETE /admin/account/providers/:provider`
- password/passkey/2FA/recovery endpoints only when their auth implementation is selected
- `GET /admin/account/sessions`, `DELETE /admin/account/sessions/:id`, and an explicit logout-all endpoint

All account endpoints must derive the subject from the authenticated session; accepting an arbitrary user id from the browser is prohibited.

## Permissions and security boundaries

The default policy is self-service only: a user may modify their own account, while organization administrators cannot silently edit another user's personal/security settings. Administrator override, support access, and impersonation are separate product decisions and must not be added by inference. Existing role and organization membership checks still apply to reach the admin area, but organization selection must not change the account subject.

Rate-limit verification, password, provider, 2FA, recovery, and session-revocation operations. Return generic responses where account enumeration or provider enumeration could leak sensitive information. Notify the current and newly verified email address for security-sensitive changes according to the final notification policy.

## Edge cases and failure behavior

- Duplicate email/phone: reject without losing unrelated edits; explain the conflict without leaking another account's data.
- Invalid or expired verification: preserve pending state safely, allow a bounded resend, and provide restart guidance.
- Last auth method: block removal and direct the user to add a replacement.
- Concurrent edits: use optimistic versioning or server timestamps; never silently overwrite a newer profile/photo/security change.
- Stale page: refresh current values after success and show a conflict if the server version changed.
- Partial outage: profile reads and each security subsection should fail independently where possible; never render a false “saved” state.
- Expired session during a mutation: return to sign-in safely and preserve no sensitive form values.
- Photo replacement failure: retain the previous photo and report a retryable error.
- User has no photo, phone, provider, password, passkey, or sessions beyond the current one: render deliberate empty states.
- Location unavailable: display “Location unavailable” rather than infer city/state/country from IP in the browser.

## Accessibility and responsive requirements

Use semantic headings and landmark navigation, visible focus styles, keyboard-operable menus/dialogs, labelled upload controls, text alternatives for avatars, and `aria-live` feedback for save/error status. Dialogs must trap focus, return it to the invoking control, close on Escape unless a destructive confirmation is pending, and never rely on color alone. On narrow screens, cards become a single column, actions remain reachable, long provider/device metadata wraps, and the settings navigation remains usable without horizontal scrolling.

## Open product and implementation decisions

Resolve these before coding against the affected area:

1. Email changes: immediate activation versus verified pending email; notification and rollback policy.
2. Phone: verification requirement, country-code/international support, normalization, uniqueness scope, and whether SMS is available.
3. Avatar: final type/size limits, crop behavior, animated GIF policy, storage/visibility, and retention cleanup.
4. Languages: supported launch list, fallback/default, translation coverage, and whether language changes require reload.
5. Time zone: default (browser, UTC, or product choice), DST display, and formatting conventions.
6. Auth methods: password and passkey launch scope; supported external providers beyond current Google OAuth and magic link; provider unlink/token-revocation behavior.
7. Recovery: secondary-email rules, verification, removal floor, notification, and recovery-code policy.
8. Two-step authentication: supported methods, trusted-device duration, backup-code lifecycle, lockout/recovery, and rate limits.
9. Sessions: token/session storage model, device geolocation source/retention, current-session behavior for logout-all, and exact “last login” semantics.
10. Administrator/support override: whether it exists, who may use it, required step-up, audit, and notification.
11. “Remove their…”: clarify whether the unfinished source phrase requests any action beyond removing the phone number.

## Success criteria

- **SC-001**: A signed-in staff user reaches General from the organization menu in one action and can return without losing organization context.
- **SC-002**: Profile, avatar, language, and time-zone edits persist after reload and organization switching, with no storefront preference changes.
- **SC-003**: Invalid/oversized photos and invalid fields are rejected server-side with the current saved value intact.
- **SC-004**: Security actions never expose secrets and leave an auditable result; unsupported capabilities are not displayed as functional.
- **SC-005**: A revoked session can no longer authenticate, and logout-all behavior matches the documented current-session policy.
- **SC-006**: 100% of account-setting destructive/security actions have explicit confirmation and appropriate recent-authentication/step-up enforcement once policy is finalized.
- **SC-007**: Keyboard and narrow-viewport smoke tests cover navigation, each edit dialog, validation errors, confirmations, and session revocation.

## Suggested delivery slices

1. Navigation shell, General route, self-profile read, and account-scoped authorization.
2. Profile fields and avatar lifecycle with validation, verification decisions, and tests.
3. Language/time-zone persistence and authenticated UI consumption.
4. Security foundation: provider inventory/unlink rules, recent-authentication/audit primitives.
5. Password/passkey/secondary-email/2FA capabilities selected in the decisions above.
6. Device/session inventory, single revoke, logout-all, notifications, and end-to-end security tests.

Do not begin schema/API implementation for slices 2–5 until the corresponding open decisions are resolved; otherwise estimates and security behavior are not reliable.
