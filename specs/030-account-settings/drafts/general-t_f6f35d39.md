# Spec 030: Account Settings — General

**Status:** Proposed product specification
**Scope:** Signed-in staff account settings in the administration area

## 1. Summary

Clicking the signed-in user's name or email in the organization menu opens that user's account settings, not organization settings. The destination is the administration user-management area with **General** selected:

`/admin/settings/users/general`

The account settings area has two sections in its local navigation:

- **General** — profile photo, name, email, phone, language, and time zone.
- **Security** — passkeys, password, secondary email, two-step authentication, linked external login providers, and active sessions/devices.

The existing organization-level **Settings › General** page remains separate. It continues to edit the selected organization's business details and must not be reused for personal account fields.

This document specifies navigation and General-page behavior. Security is included as the adjacent navigation destination and an integration boundary; its detailed interaction design should be specified separately.

## 2. Entry point and navigation state

1. An authenticated staff user opens the organization menu in the administration header.
2. The menu displays the user's name and email as one clearly labelled account entry. The name and email are both part of the hit target; neither is a decorative-only label.
3. Activating the entry navigates to `/admin/settings/users/general`.
4. The administration shell remains visible. The user-management/settings local navigation is visible, with **General** selected and exposed in the URL and active-state styling.
5. A direct visit to `/admin/settings/users/general` produces the same state. A refresh preserves the General destination.
6. Selecting **Security** navigates to the sibling Security page without changing the active organization.
7. If the user is not authenticated, normal admin middleware redirects to sign-in and preserves the requested callback URL. If the user lacks permission, the route returns the standard administration access-denied state; it must not expose another user's data.

The account page is always scoped to the authenticated user. The active organization may remain in the header for context, but changing organizations must not change the profile being edited.

## 3. Page hierarchy and section order

Desktop page hierarchy:

- Administration shell
  - Settings / User management context
    - Local navigation: General, Security
    - Page title: **General**
    - Introductory text: manage the information used for the user's Jump account; these settings do not change the customer-facing online store
    - Profile photo section
    - Personal information section
    - Preferences section
    - Page action area

Sections appear in this order:

### 3.1 Profile photo

Heading: **Profile photo**

Show the current photo when one exists. When no photo exists, show a neutral avatar fallback based on the user's initials or an accessible generic avatar; do not show a broken-image state.

Actions:

- **Upload photo** when no photo exists.
- **Change photo** when a photo exists.
- **Remove photo** when a photo exists.

Upload and replacement must validate the file before saving. The experience may use a crop step, but crop behavior is not required by this navigation specification. The implementation must provide a usable square avatar result and preserve the original until the replacement succeeds. A failed upload must leave the prior photo unchanged.

Launch guidance:

- Accept JPEG, PNG, and WebP images.
- Reject unsupported formats, corrupt files, and files above the product's configured size limit with an actionable message.
- Decode and validate the image server-side; do not trust the filename or MIME type supplied by the browser.
- Do not require a photo.

Removing a photo requires confirmation because it is destructive. After confirmation, the fallback avatar is shown and the user receives a success announcement. If removal fails, retain the current photo and show an error with a retry action.

### 3.2 Personal information

Heading: **Personal information**

Fields, in order:

1. **First name** — required; editable text.
2. **Last name** — required; editable text.
3. **Email address** — required; editable email address.
4. **Phone number** — optional; empty on a new account and editable thereafter.

Each field has a persistent label. Existing values are loaded from the authenticated user's account. Empty optional phone state uses an explicit prompt such as “Add phone number,” not a blank unlabeled control.

The form is one logical save unit for these fields. A user can edit any combination and save once. The page must not silently save a partially edited field when the user navigates away.

#### Field behavior

- Trim leading and trailing whitespace from names, email, and phone input before validation.
- Names must be non-empty after trimming and may contain normal human-name punctuation and Unicode letters. Do not impose an arbitrary ASCII-only rule.
- Email must pass the product's server-side email validation and is normalized consistently (at minimum trim and lowercase the address used for uniqueness checks). The canonical stored/displayed form is returned by the server.
- Phone is optional. When present, validate and normalize to the product's supported phone representation; show a clear format error rather than accepting an arbitrary string. The initial implementation must document the supported country behavior before engineering starts.
- An unchanged field is valid and must not create an unnecessary update.
- Clearing the optional phone field is supported and is distinct from omitting it.
- Unknown fields are rejected by the API; the client must not rely on client-only validation.

Inline validation appears adjacent to the invalid field, is announced to assistive technology, and prevents submission until corrected. Server errors (including duplicate email) are mapped to the relevant field where possible and otherwise shown in a page-level error region.

### 3.3 Preferences

Heading: **Preferences**

Fields:

- **Preferred language** — controls the language of Jump's authenticated administration experience for this user only. It does not change the language customers see in the online store, public event pages, emails, or checkout.
- **Time zone** — controls the account user's administration display time zone. It does not silently change an organization's store/reporting time zone or customer-facing event times.

Use a searchable or otherwise keyboard-operable list for language and time-zone selection. Display time-zone names with a stable UTC offset or exemplar city to distinguish similar zones and handle daylight-saving changes. Store an IANA time-zone identifier rather than a browser-local offset.

The supported language list and default language are product configuration and must be defined before implementation. The default time zone should be explicit (for example, the organization's configured zone or UTC); do not infer a permanent account setting from the browser without a documented product decision.

### 3.4 Actions

The primary action is **Save changes**. The secondary action is **Cancel**.

- Save is disabled while no tracked value has changed, and enabled when there are valid unsaved changes.
- Save shows an in-progress state and prevents duplicate submissions.
- On success, the server response becomes the new form baseline, a concise success message is announced, and the page remains on General.
- Cancel restores the last saved values. If there are unsaved changes, require confirmation before discarding them.
- Browser back, local-navigation changes, organization-menu navigation, and page close must use the same unsaved-changes protection where the platform supports it.
- On a failed save, retain the user's edits, identify the failure, and allow retry. Never report success based only on an optimistic client update.

Photo actions may save independently because they are file operations, but their success and failure states follow the same rules and must not unexpectedly discard unsaved text-field changes.

## 4. Loading, empty, error, and concurrency states

- **Initial loading:** show a page-level loading state that preserves the General heading/navigation context without displaying guessed values.
- **No photo:** show the fallback avatar and Upload photo action.
- **No phone:** show an empty optional phone field and Add phone number affordance.
- **No secondary data:** General must still render if optional profile values are absent.
- **Fetch failure:** show a clear error, retry action, and no editable stale values unless the last known values are explicitly marked stale.
- **Validation failure:** keep the form open and preserve all input.
- **Unauthorized/expired session:** use the standard session recovery path; do not retry writes indefinitely.
- **Duplicate email:** explain that the address is already in use and leave the entered value available for correction. Whether email changes require confirmation is a product/security decision and must not be assumed by the UI.
- **Concurrent update:** if the server detects that the record changed after the form loaded, refuse or safely reconcile the stale write, explain that newer changes exist, and offer reload/review rather than silently overwriting them.
- **Network/server error:** show an inline or page-level error with retry. The Save button returns to an actionable state.

## 5. Permissions and conceptual data/API contract

The page is self-service: the authenticated user may read and update only their own profile. The browser must not choose a user id to authorize the update. The backend derives the target from the authenticated session.

Existing administrator user-management permissions for listing users, changing roles, and deactivating accounts remain separate from this self-service page. Whether an administrator may impersonate or edit another user's personal profile is an open product decision and is out of launch scope unless separately specified.

Conceptual endpoints (exact naming may follow existing API conventions):

- `GET /admin/settings/users/me` — returns the authenticated user's General profile and supported preference options.
- `PATCH /admin/settings/users/me` — partial update for first name, last name, email, phone, preferred language, and time zone; rejects unknown fields and performs server-side validation.
- `POST /admin/settings/users/me/photo` — validates and stores a new photo, returning the current photo metadata/URL.
- `DELETE /admin/settings/users/me/photo` — removes the photo and returns the fallback state.

The response must not expose password hashes, authentication secrets, recovery tokens, or unnecessary security metadata. Sensitive changes should be auditable. Email/phone verification, recent-authentication requirements, rate limits, and audit-event fields belong to the Security/permissions specification; the General UI must support a pending-verification or re-authentication result if those policies are enabled.

## 6. Responsive and accessibility expectations

Desktop:

- Keep the account-settings local navigation and General content visibly associated.
- Use a readable content column; avoid requiring users to scan a full-width form.
- Keep the primary and secondary actions consistently available at the end of the form, with a sticky action area only if it does not obscure content.

Mobile:

- Collapse local navigation into a clearly labelled control or stacked navigation while preserving the selected General state.
- Stack fields vertically and keep labels, help text, errors, and controls together.
- Keep Save and Cancel reachable without horizontal scrolling. A sticky bottom action area is acceptable if it respects safe-area insets and does not cover the last field.
- Photo actions remain available without requiring precise gestures.
- Unsaved-change confirmation must work for menu navigation and browser back.

Accessibility for all sizes:

- Use semantic headings in the order specified above and make the page title available to screen readers.
- Every input has a programmatically associated label; help and error text use appropriate descriptions.
- Keyboard users can reach all navigation, upload, remove, Save, and Cancel actions and see focus clearly.
- Do not use color alone for active, error, or success states.
- Announce loading completion, save success, upload/removal success, and errors through an appropriate live/status region.
- Photo controls provide meaningful accessible names and an alt description for the current photo; decorative fallback artwork is hidden from the accessibility tree.
- Respect reduced-motion preferences and do not make status changes dependent on animation.

## 7. Launch requirements versus optional enhancements

Launch requirements:

- Organization-menu name/email entry reaches the user's account settings General page.
- General is visibly selected under user management, with Security as a sibling destination.
- Photo empty/upload/change/remove lifecycle with server validation and failure recovery.
- Editable first name, last name, email, and optional phone number.
- Preferred language and account time zone, with explicit scope limited to the Jump administration experience.
- Save, Cancel, dirty-state protection, inline validation, loading/error/success states.
- Self-only authorization and no leakage of secrets.
- Responsive desktop/mobile behavior and keyboard/screen-reader accessibility.

Optional enhancements after launch:

- Client-side crop/rotation and preview before upload.
- Drag-and-drop photo upload.
- Photo history or restore of a previous photo.
- Locale-specific name fields or pronunciation metadata.
- Automatic browser-language/time-zone suggestions with explicit user confirmation.
- Avatar generation beyond initials.

## 8. Explicit product clarifications required

These questions must be answered before implementation estimates are final:

1. The source request ends with the incomplete phrase **“Remove their…”**. It is ambiguous whether this means remove the phone number, remove a linked login, remove a secondary email, or another account action. Do not invent behavior from that fragment. The requested phone removal and external-login disconnection are listed separately where their meaning is explicit.
2. Are email changes immediately active, or must the new address be confirmed? What happens to the old address during the pending state?
3. Is phone verification required before the phone can be used for recovery or two-step authentication?
4. Which languages are supported, and what is the default/fallback language?
5. What default time zone applies to a new account, and does it inherit the organization setting or default independently?
6. Which image size limit, maximum dimensions, and phone-number country rules should the launch enforce?
7. May an administrator edit another user's personal profile, or is all profile editing self-service only?
8. What recent-authentication and audit requirements apply to email, phone, photo, and preference changes?

## 9. Acceptance checklist

- [ ] Clicking the signed-in name or email from the organization menu opens `/admin/settings/users/general`.
- [ ] The administration shell identifies the user-management context and marks General active.
- [ ] Security is a sibling section and navigation does not alter the active organization.
- [ ] Existing organization Settings › General remains distinct.
- [ ] Profile photo supports no-photo, upload, replace, remove-confirmation, success, and failure states.
- [ ] First name and last name are required and validated server-side.
- [ ] Email is required, normalized consistently, and duplicate/error behavior is visible.
- [ ] Phone is optional, can be added, updated, and cleared, with defined format validation.
- [ ] Language changes Jump's admin UI only; it does not change the customer storefront.
- [ ] Time zone is stored/displayed as an account preference and does not change organization/customer time semantics.
- [ ] Save, Cancel, dirty protection, retry, and success feedback are implemented.
- [ ] Self-service authorization prevents reading or updating another user's profile.
- [ ] Loading, empty, validation, unauthorized, server-error, and concurrent-edit states are specified.
- [ ] Desktop and mobile layouts remain usable without horizontal scrolling.
- [ ] Keyboard navigation, focus, labels, errors, live announcements, and reduced-motion behavior meet accessibility expectations.
- [ ] The unfinished “Remove their…” requirement is recorded as a clarification, not implemented by inference.
