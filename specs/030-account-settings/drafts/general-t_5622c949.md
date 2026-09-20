# Spec 030: Account Settings — General

Status: Implementation-ready product requirements
Scope: Signed-in staff users' own account settings in the administration area

## 1. Product outcome and boundaries

A signed-in staff member can open their own account settings from the organization menu and manage personal account information without confusing it with organization/store settings. The General page supports profile photo, name, email, phone, preferred language, and account time zone. It gives clear loading, empty, validation, saving, success, failure, verification, and concurrency outcomes.

This is self-service account data. It is not the existing organization Settings > General page, which remains responsible for selected-organization business details and store contact information. Changing the active organization must not change the account record shown or edited here. Preferred language affects Jump's authenticated administration UI for the user only; time zone affects the user's account presentation and notifications only. Neither changes public storefront, buyer communications, checkout, organization reporting semantics, or event times.

Launch does not authorize administrators to edit another user's personal profile. The unfinished source phrase "Remove their…" is preserved as an unresolved clarification; no behavior is inferred from it.

## 2. Entry point, route, and navigation

1. The authenticated user opens the organization menu in the administration header.
2. The menu presents the signed-in user's name and email as one labelled account entry. Both are part of the hit target.
3. Activating the entry navigates to `/admin/settings/users/general`.
4. The administration shell remains visible. The account-settings local navigation shows:
   - General — profile photo, personal information, and preferences.
   - Security — passkeys, password, secondary email, two-step authentication, linked external providers, and active sessions/devices.
5. General is selected in both the URL and active navigation styling. A direct visit or refresh produces the same state.
6. Security is a sibling destination and does not change the active organization.
7. Normal admin middleware handles unauthenticated access by redirecting to sign-in with the return URL. Standard access-denied behavior applies when access is not permitted; no other user's data is exposed.

The backend always derives the target user from the verified staff session. The browser cannot choose a user ID, email, organization ID, role, or membership to select the account.

## 3. Page structure and visual hierarchy

Desktop hierarchy, in order:

- Administration shell
  - Account settings/user-management context
    - Local navigation: General, Security
    - Page title: General
    - Introductory text: manage information used for the user's Jump account; these settings do not change the customer-facing online store.
    - Profile photo section
    - Personal information section
    - Preferences section
    - Page action area

The page uses one logical form/save unit for text fields and preferences. Photo operations may be implemented as independent file operations, but must not discard unsaved text or preference edits. If the product instead puts photo changes into the common Save action, the UI must preserve the old saved photo until the whole operation succeeds.

### 3.1 Profile photo

Heading: Profile photo.

- No saved photo: show a deterministic initials avatar when either name is available, otherwise a generic person avatar. This is a fallback state, not an uploaded file. Show Upload photo.
- Existing saved photo: show the image with an accessible description such as `Profile photo for <full name>`. Show Change photo and Remove photo.
- Selected but unsaved photo: show a local preview and a pending indicator. The saved photo remains the fallback until saving succeeds.
- Image-load failure: fall back to initials/generic avatar and show a recoverable error; do not make the rest of the form unusable.

Photo controls are labelled buttons/file inputs, keyboard accessible, and usable by screen readers. The visible helper text is: `JPG, PNG, GIF, or WebP up to 5 MB.`

Launch photo rules:

- Accept JPEG/JPG, PNG, GIF, and WebP; reject SVG.
- Maximum size is 5 MB.
- Validate quickly in the browser and authoritatively on the server using detected content/MIME, not the filename or browser MIME value.
- Reject unsupported, oversized, corrupted, unreadable, or disguised files without replacing the saved photo.
- The server owns resizing/normalization, metadata stripping, and cleanup of replaced assets. Internal storage paths are never shown.
- Profile photo data is private account data and is scoped to the authenticated user; do not expose a public organization-wide image URL by default.
- Replacing is atomic from the user's perspective: the previous image remains until the new one validates and saves successfully.
- Recommended launch behavior is a square crop/position step before upload. If cropping is deferred, the avatar container must safely crop the source. Whether crop is mandatory and whether animated GIFs remain animated are explicit decisions before implementation.

Remove photo is visible only when a saved photo exists (or when a selected unsaved photo can be canceled). Confirmation explains that removal returns the account to the default initials/generic avatar. A confirmed removal is marked pending or executed through the chosen photo-save flow; it must not prematurely destroy the saved asset. Success shows the fallback and announces `Profile photo removed.` Failure retains the saved image and offers retry.

## 4. Personal information requirements

Fields appear in this order and have persistent visible labels:

1. First name — required.
2. Last name — required.
3. Email address — required.
4. Phone number — optional.

Existing values come from the authenticated user's account. An empty optional phone field remains visibly empty and provides an explicit affordance such as Add phone number; placeholder text is not a value.

### 4.1 Shared field behavior

- Trim leading/trailing whitespace before validation. The server is authoritative.
- Unknown fields are rejected by the API.
- Save only sends changed attributes (plus an explicit photo operation when the selected design uses the common Save action). A field changed and then returned to its last successfully loaded/saved value is clean and omitted.
- Server-normalized values replace local values only after a successful response.
- Validation errors are adjacent to the field, linked with `aria-describedby`, and preserve the user's raw input where correction is needed.
- General server/network errors appear in a page-level error region, preserve all edits, and leave Save retryable.
- A failed initial fetch is not treated as an empty profile and must not render a form that could overwrite data.

### 4.2 First name and last name

Both fields:

- are required and reject empty/whitespace-only values on Save;
- allow Unicode letters and ordinary human-name punctuation (spaces, hyphens, apostrophes, periods);
- reject control characters, markup, and values with no visible characters;
- use a recommended maximum of 100 characters, pending product confirmation;
- trim leading/trailing whitespace and collapse repeated internal whitespace while preserving capitalization and legitimate punctuation;
- show `Enter your first name.` or `Enter your last name.` for empty values and focus the first invalid field;
- omit unchanged values from the update payload.

The server returns and displays the normalized saved values. No arbitrary ASCII-only or forced title-case rule is allowed.

### 4.3 Email address

Email is required. It must be a single syntactically valid address, contain no spaces/control characters, and fit the server's supported length limit. Normalize surrounding whitespace and lowercase the domain; preserve local-part case unless the identity system has an explicit canonicalization rule. Uniqueness uses the documented canonical form.

Duplicate or unavailable addresses return a generic conflict such as `That email address cannot be used.` without identifying another account. An unchanged canonical address causes no email-change workflow or notification.

Recommended security behavior is pending confirmation: require recent step-up authentication, keep the current address active for sign-in/notifications until the new address confirms, send a single-use short-lived confirmation link to the new address, notify the current address, and support safe resend/expired-link recovery. The UI must say `Check your email to confirm this change.` while pending and must not announce that the address is updated until confirmation is effective. Confirmation is idempotent, and superseded/expired tokens cannot be replayed. The exact immediate-vs-confirmed policy must be decided before implementation.

### 4.4 Phone number

Phone is optional. Empty untouched phone is valid. Clearing a saved number is a deliberate removal and is distinct from omitting the field.

- Accept user-friendly national or international input only with a defined country selector/default-country rule.
- Reject letters, impossible lengths, control characters, unsupported numbers, and arbitrary digit strings.
- Store a canonical international representation (E.164 recommended), including country context; display a localized human-readable form.
- Creating, replacing, or clearing a number must not trigger work when the canonical value is unchanged.
- Recommended security behavior is to keep a new/replaced number pending and unverified until a one-time code succeeds. The old verified number remains active until replacement verification succeeds.
- A duplicate active/recovery phone returns a generic conflict such as `That phone number cannot be used.` without identifying the owner.
- Clearing a verified phone requires recent step-up authentication and, if it is the last usable recovery method, another method first.
- Provider failures leave the prior verified value unchanged and make the pending operation retryable or cancellable.

Success messaging distinguishes `Phone number added.`, `Phone number updated.`, and `Phone number removed.`; pending verification instead says to enter the code sent. Country support, uniqueness scope, and verification policy are unresolved product decisions.

## 5. Preferences

### Preferred language

Provide a searchable or keyboard-operable selection from a defined supported-language list. It changes Jump's authenticated/admin UI for this user only. It does not change storefront, public event pages, buyer emails, checkout, or organization content. Supported languages and default/fallback behavior must be product-defined before implementation.

### Time zone

Provide a searchable or keyboard-operable IANA time-zone selection. Display a stable UTC offset or exemplar city so similar zones are distinguishable and daylight-saving changes are understandable. Store the IANA identifier, not a browser-local offset. The default for a new account must be explicit (for example, UTC or an organization-derived default); do not silently persist the browser zone. This preference must not alter organization reporting, event times, or customer-facing semantics.

## 6. Form lifecycle and state behavior

### Load

Show the shell, General heading, and navigation context while the profile is loading; controls are disabled and values are not guessed. On success, populate every saved value, show empty optional fields explicitly, and establish the clean baseline. On failure, show a retryable error and no editable stale values unless clearly marked stale.

### Edit, dirty state, Save, and Cancel

- Start clean. Save is disabled/absent with no tracked changes.
- Dirty state compares with the last successfully loaded/saved server baseline.
- Save validates all changed fields, prevents duplicate submission, and shows progress while keeping values visible.
- On success, adopt the server response as the baseline, clear dirty state, remain on General, and announce `Personal information saved.` or the precise photo/pending-verification result. Update the account menu identity where supported.
- On validation/server failure, preserve every unsaved value, associate field errors where possible, show a general error otherwise, and leave Save actionable.
- Cancel sends no request and restores the last saved baseline. If dirty, require the standard unsaved-changes confirmation.
- Browser back, local navigation, organization-menu navigation, Security navigation, and page close use the platform's unsaved-change protection where supported.

### Verification and re-authentication

The General UI must handle `STEP_UP_REQUIRED`, pending email/phone verification, resend, expired/replayed challenge, and session-expired outcomes without discarding unrelated edits. Sensitive operations recommended for step-up are primary email change, phone replacement/removal, external-login disconnect, password/passkey/2FA changes, and logout-all. A recent step-up should be server-enforced, scoped to the authenticated user and operation family, short-lived (recommended maximum ten minutes), and never represented by a client-supplied boolean.

### Concurrency and retries

Use an optimistic version or updated-at token. A stale write returns a conflict and never silently overwrites newer data; refetch and let the user review/reapply changes. Sensitive writes should accept a server-persisted idempotency key so a network retry cannot repeat a change, notification, verification consumption, or audit event. After an ambiguous network result, refetch before retrying.

## 7. Permissions, privacy, and conceptual API/data needs

Every read and mutation requires a valid staff session. The server derives `userId` from the verified session (`req.user.id` or equivalent). Buyer JWTs, expired sessions, and requests naming another user are rejected. The active organization and `X-Jump-Org` context are not selectors for the profile target. `UNASSIGNED` users follow the same self-service account rules but gain no organization permissions.

Administrator override of another user's profile, email, phone, sessions, or authenticators is not launch behavior. If approved later, it requires separate routes, permissions, disclosure, step-up, notifications, and audit requirements.

Conceptual API contract (exact naming follows existing backend conventions):

- `GET /admin/settings/users/me` returns the authenticated user's profile, photo metadata/state, preferences, and supported language/time-zone options.
- `PATCH /admin/settings/users/me` partially updates changed names, email, phone, language, and time zone; rejects unknown fields, validates server-side, accepts version/idempotency metadata as needed, and returns normalized values plus pending outcomes.
- `POST /admin/settings/users/me/photo` validates and stores a new photo, returning current metadata/state.
- `DELETE /admin/settings/users/me/photo` removes the saved photo and returns fallback state.
- Verification/re-authentication endpoints are conceptually separate and return stable generic outcomes; raw tokens/codes never appear in logs or API responses.

Responses exclude password hashes, passkeys/TOTP secrets, recovery tokens, raw pending email addresses where unnecessary, full phone values where masking is sufficient, storage paths, and unnecessary security metadata. Profile/photo and security mutations are append-only audited with actor/target user (same subject), event, timestamp, outcome, correlation ID, and privacy-safe metadata. Never audit raw passwords, codes, tokens, full phone numbers, or raw IP addresses. Audit/storage/database failure fails a security mutation closed or uses a durable retry path; the UI never claims success before durable completion.

Apply rate limits before email/SMS/provider work: generous profile/photo writes; strict email/phone challenge, verification, step-up, and resend limits keyed by authenticated subject, destination where safe, and real client IP. Return `429`, stable generic error codes, and the existing RateLimit headers without enabling account enumeration.

## 8. Required user-visible states

| State | Required behavior |
|---|---|
| Initial loading | Preserve shell/context; disable controls; show no guessed values. |
| Empty photo | Deterministic initials/generic avatar and Upload photo; no error. |
| Existing photo | Image, Change photo, Remove photo; image failure has fallback. |
| Selected photo | Local preview/pending state; saved photo remains safe until success. |
| Empty optional phone | Explicit empty/Add phone state; valid and not dirty by itself. |
| Empty required field | Block submit, show field error, focus first invalid control. |
| Invalid/duplicate field | Preserve input, show associated error, block or safely reject update. |
| Invalid photo | Reject selection; preserve saved image; show file-specific error. |
| Unchanged form | Save disabled/no request/no success message. |
| Valid dirty form | Save enabled and unsaved navigation protected. |
| Saving | Prevent duplicates, show progress, preserve values. |
| Success | Server-normalized values become baseline; announce precise/common success. |
| Pending verification | Explain pending state and provide safe resend/restart; never claim effective change. |
| Step-up required | Open approved re-auth flow; preserve safe local edits. |
| Expired/replayed challenge | Generic recoverable error; allow restart/resend subject to limits. |
| Unauthorized/session expired | Standard sign-in recovery; preserve a safe return URL and edits where safe. |
| Network/provider/server failure | Retryable error, no false success, prior verified data intact. |
| Concurrent update | Conflict/review/reapply path; never silently overwrite. |

## 9. Accessibility and responsive requirements

- Use semantic heading order and a visible General page title.
- Every input has a visible programmatic label; help/error text is associated with the relevant control.
- Errors use `role="alert"` where urgent and success/loading status uses an appropriate `role="status"`/aria-live region. Do not rely on color.
- On failed submit, focus the first invalid control. Dialogs/crop flows trap focus appropriately and return focus to the invoking control when closed.
- Photo actions are real buttons with meaningful accessible names; file input is keyboard accessible and exposes accepted types. Decorative fallback art is hidden from assistive technology.
- Keyboard users can operate local navigation, language/time-zone selectors, upload, remove confirmation, Save, and Cancel with visible focus.
- Respect reduced-motion preferences; no required outcome depends on animation.
- Desktop keeps local navigation associated with a readable content column and actions consistently reachable.
- Mobile stacks sections/fields vertically, preserves labels/help/errors with controls, and avoids horizontal scrolling. Collapse local navigation into a clearly labelled control or stacked navigation while preserving General selection.
- A sticky action area is allowed only if it respects safe-area insets, does not cover fields or the on-screen keyboard, and keeps the final field reachable. Photo actions must not require precise gestures.

## 10. Launch requirements and optional enhancements

### Launch

- Organization-menu account entry reaches `/admin/settings/users/general`.
- General/Security local navigation is visible; General is active and organization context is preserved without selecting the profile.
- Self-service only: read/update targets the authenticated user and does not leak secrets or other accounts.
- Profile photo no-photo/upload/change/remove lifecycle with server-side MIME/content validation, 5 MB guidance, safe replacement, and recoverable failure.
- Editable required first/last name, required email, and optional phone with documented validation/normalization and clear creation/update/removal states.
- Preferred language and IANA account time zone with explicitly limited scope.
- Save/Cancel, dirty-state protection, partial changed-field updates, loading/empty/error/success states, concurrency protection, and retry behavior.
- Required step-up, verification, rate-limit, audit, and privacy contracts for sensitive operations, once the listed policy decisions are approved.
- Responsive and keyboard/screen-reader accessible behavior.

### Optional later enhancements

- Crop/zoom/rotate editor if not selected for launch, client-side compression, upload progress, or drag-and-drop.
- Photo history/restore and generated avatars.
- Pending-email banner with cancel-change action.
- Phone status badge and richer change-number flow.
- Browser language/time-zone suggestions with explicit confirmation.
- Locale-specific name fields or pronunciation metadata.
- Recent profile-change history visible to the account owner.

## 11. Open decisions that block final implementation estimates

1. What does the unfinished source phrase "Remove their…" mean? It may not be interpreted as phone removal, external-login disconnection, secondary-email removal, or any other action without clarification.
2. Are changed email addresses immediately active or confirmed first? What remains active during pending state?
3. Is phone verification required before recovery/two-step use, and what notification provider/channel is supported?
4. Can a user remove their only recovery/authentication method? Which methods count as sufficient recovery?
5. Is phone uniqueness global across staff accounts, organization-scoped, or not an identity constraint?
6. Is administrator override ever allowed? If yes, define exact roles, organization scope, disclosure, notification, step-up, and audit behavior.
7. Which external providers and provider-token revocation capabilities are supported?
8. Which languages and fallback/default language are supported?
9. What is the new-account time-zone default: UTC, organization-derived, or another explicit rule?
10. Are international phone numbers supported, and which country selector/formatting library is approved?
11. Is square crop mandatory at launch? Are animated GIFs accepted as animation or stored/displayed as a static rendition?
12. Confirm final photo dimensions/size limits, recent-authentication age, audit retention, and whether photo/preference changes need step-up.

## 12. Acceptance criteria checklist

- [ ] Clicking the signed-in name/email opens `/admin/settings/users/general`; direct navigation and refresh preserve General.
- [ ] The administration shell shows account-settings context with General active and Security as a sibling; changing organization does not change the profile target.
- [ ] Organization Settings > General remains distinct from personal account settings.
- [ ] A signed-in user can read/update only their own record; body/path user IDs and organization context cannot redirect the target.
- [ ] Loading, fetch failure, retry, unauthorized/session-expired, empty optional, and no-photo states are safe and testable.
- [ ] Photo states include fallback, existing image, selected preview, upload/change, remove confirmation, success, image-load failure, invalid/oversized/corrupt/disguised rejection, and failed replacement without loss of the old image.
- [ ] Photo guidance visibly names JPG/PNG/GIF/WebP and 5 MB; server validation does not trust browser metadata; SVG is rejected.
- [ ] First and last name are required, Unicode/name-punctuation aware, normalized, server-validated, and have explicit empty/invalid/unchanged/success outcomes.
- [ ] Email is required, normalized consistently, protected from duplicate-account disclosure, and has an explicitly decided pending/effective verification outcome.
- [ ] Phone is optional and supports add, replace, canonical normalization, unchanged no-op, clear/remove, invalid, duplicate, provider failure, and pending-verification outcomes under the approved policy.
- [ ] Language changes authenticated Jump UI only; time zone stores an IANA identifier and does not change organization/customer time semantics.
- [ ] Save sends only changed values, prevents duplicates, returns server-normalized data, and handles idempotency/concurrency safely.
- [ ] Cancel restores the server baseline without a request; dirty navigation uses confirmation; failed saves preserve edits and remain retryable.
- [ ] Sensitive operations enforce recent server-side step-up, rate limits, privacy-safe audit events, and safe session refresh/revocation as applicable.
- [ ] Error, status, success, focus, keyboard, labels, live announcements, reduced-motion, desktop, mobile, and safe-area behaviors meet the accessibility/responsive requirements.
- [ ] Every unresolved decision in section 11 is resolved and recorded before implementation; in particular, the phrase "Remove their…" is not implemented by inference.
