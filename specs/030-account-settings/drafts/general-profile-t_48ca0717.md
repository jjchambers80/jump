# Account settings: General profile and personal information

**Status:** Draft product specification
**Scope:** Profile photo/avatar and personal information in the signed-in user's General account settings.
**Source:** `t_83e0f1e2` (account settings request), decomposed field-behavior requirements.

## 1. Outcome

When a signed-in staff member opens their account from the organization menu, the General area lets them see and update their own profile photo, first name, last name, email address, and phone number. The form must make the current saved state clear, prevent invalid submissions, preserve edits after recoverable errors, and give an unambiguous result after a save.

This is personal account information, not organization/store contact information. It must not be conflated with the existing Settings › General organization details form or its store phone number.

## 2. Form-level behavior

### 2.1 Initial state

- Load the authenticated user's current profile from the server; do not use organization-selected data as the source of truth.
- Show a loading state while the profile is fetched. Controls are disabled until the initial response completes.
- On a successful load, populate every saved value. Empty optional fields remain visibly empty and show their optional status; do not display placeholder text as if it were a value.
- If loading fails, show an inline/page-level error with Retry. Do not show a blank form that could overwrite data.
- A failed load must not be treated as an empty profile.

### 2.2 Editing and save

- The form starts clean. Save is disabled or absent while there are no changes.
- Dirty state is computed against the last successfully loaded/saved values, not against the initial browser render.
- A field changed and then returned exactly to its saved value makes the form clean again.
- Save submits only changed profile attributes plus an explicit photo operation when applicable; unchanged fields must not be rewritten.
- While saving, disable duplicate submissions and show a progress state on the save action. Keep the user's values visible.
- On success, replace the local baseline with the server response, clear dirty state, and announce `Personal information saved.` in an aria-live status region. Show the updated avatar/name immediately in the account menu when the session shell supports it.
- On validation or server failure, keep all unsaved values, identify the affected field when possible, show a non-field-specific error for general failures, and leave Save available after the error is dismissed or corrected.
- Cancel/navigation away while dirty must use the product's standard unsaved-changes confirmation. Cancel restores the last saved baseline; it must not send a request.
- A concurrent update response must not silently overwrite local edits. Reload the server version and ask the user whether to keep/reapply their changes; the implementation may use an optimistic version/updated-at token.

## 3. Profile photo/avatar

### 3.1 Default and existing states

- **No photo:** Show a deterministic default avatar using the user's initials when either name is available; otherwise use the product's generic person avatar. The default must not be represented as a fake uploaded file.
- **Existing photo:** Show the saved image with an accessible name such as `Profile photo for <full name>`, plus `Change photo` and `Remove photo` actions.
- **Selected but unsaved photo:** Show a local preview and a clear pending state. The saved photo remains the fallback until Save succeeds.
- If an image URL fails to load, fall back to the initials/generic avatar and provide a recoverable error; do not make the form unusable.

### 3.2 Upload and replacement

- The upload control label is `Upload photo` when no photo exists and `Change photo` when one exists. It must be usable by keyboard and screen readers and expose accepted types to assistive technology.
- Supported launch formats: JPEG/JPG, PNG, GIF, and WebP. SVG is not accepted. Product must confirm whether animated GIFs are retained as animation; the default recommendation is to accept GIF input but store/display a safe static rendition.
- Maximum file size: 5 MB. The UI should state `JPG, PNG, GIF, or WebP up to 5 MB.` before selection.
- Validate client-side for type and size for fast feedback, and validate again server-side using detected MIME/content rather than trusting the filename or browser MIME type.
- Reject corrupted, unreadable, unsupported, oversized, or disguised files with an inline photo error; never replace the saved photo on a rejected upload.
- Recommended launch behavior is a square crop step before upload: show a crop/position preview, allow confirm or cancel, and create a square rendition. If cropping is deferred, preserve the source aspect ratio only if the avatar container safely crops it; this is a product/engineering decision that must be resolved before implementation.
- Replacing an existing photo is atomic from the user's perspective: the old saved photo remains until the new upload validates and saves successfully. A failed replacement leaves the old photo intact.
- The upload should not submit unrelated dirty text fields until the user presses the form Save action, unless the final design explicitly makes photo upload an independent saved action.

### 3.3 Remove photo/avatar

- `Remove photo` is visible only when a saved photo exists (or when a selected unsaved photo can be canceled).
- Removing a saved photo requires a confirmation because it is destructive: explain that the account will return to its default initials/generic avatar.
- On confirmation, mark the photo for removal; do not immediately delete the saved asset if the form has a shared Save action.
- On successful save, show the default avatar and announce `Profile photo removed.`
- On failure, retain the saved photo and show an actionable error.
- The source request contains an unfinished phrase, `Remove their…`. This specification intentionally does not infer whether it means removing the phone number, an external login, or another account attribute. Product clarification is required before adding any additional Remove action beyond the profile-photo behavior above.

### 3.4 Photo privacy and storage

- A profile photo is account/profile data. Access and mutation must be scoped to the authenticated user; do not expose an organization-wide public image URL by default.
- The server owns resizing, normalization, metadata stripping, and storage cleanup. Old assets must not be orphaned after a successful replacement/removal.
- Do not reveal storage paths or internal error details in the UI.

## 4. Personal information fields

The following rules apply to each text field. Labels, required status, empty behavior, validation, normalization, inline errors, unchanged state, and success behavior are explicit.

### 4.1 First name

- **Label:** `First name`
- **Required:** Yes.
- **Empty:** Reject on Save with `Enter your first name.` and focus the field.
- **Format:** Unicode letters and ordinary name punctuation (spaces, hyphens, apostrophes, and periods) are allowed. Reject control characters, markup, and values that contain no visible characters. Product must approve the maximum length; recommended launch limit is 100 characters.
- **Normalization:** Trim leading/trailing whitespace and collapse repeated internal whitespace. Preserve capitalization and legitimate punctuation; do not force title case.
- **Inline error:** Render below the field, associated with `aria-describedby`; do not rely on color alone.
- **Unchanged:** No request for this field and no success message specific to it.
- **Success:** Display the normalized saved value after the response; include it in the common save confirmation.

### 4.2 Last name

- **Label:** `Last name`
- **Required:** Yes.
- **Empty:** Reject on Save with `Enter your last name.` and focus the field.
- **Format:** Same name rules as First name; recommended maximum 100 characters.
- **Normalization:** Same trim, whitespace, and capitalization-preservation rules as First name.
- **Inline error:** As above, tied to the field and announced accessibly.
- **Unchanged:** Omit from the update payload.
- **Success:** Display the normalized server value and include it in the common save confirmation.

### 4.3 Email address

- **Label:** `Email address`
- **Required:** Yes.
- **Empty:** Reject on Save with `Enter your email address.`
- **Format:** Must be a syntactically valid, single email address with no spaces/control characters and within the server's supported length limit. Client validation is advisory; server validation is authoritative.
- **Normalization:** Trim surrounding whitespace and lowercase the domain. Preserve the local-part case unless the identity system explicitly canonicalizes it. Compare uniqueness using the system's documented canonical form.
- **Duplicate:** Reject with a non-disclosing message such as `That email address cannot be used.`; do not reveal another account's details.
- **Unchanged:** Do not trigger email-change workflow or send a notification when the canonical address is unchanged.
- **Changed:** Product decision required: whether a changed address is applied immediately or remains pending until confirmation. Recommended launch behavior is confirmation to the new address, notification to the old address, and retaining the old address for sign-in until confirmation. The form must show `Check your email to confirm this change.` and support resend/expired-link recovery if this recommendation is accepted.
- **Inline error:** Show malformed, duplicate, expired, or failed-change outcomes below the field or in an associated status region.
- **Success:** Only announce `Email address updated.` after the server confirms the new address is effective. If pending, announce the pending state instead and do not claim it is updated.

### 4.4 Phone number

- **Label:** `Phone number`
- **Required:** No.
- **Empty:** Allowed. Clearing an existing number means remove it, but only after the user saves and, if verification is required, completes the required confirmation. A blank untouched field is not an error.
- **Format:** Accept a user-friendly national or international entry, then validate as a real phone-number shape using the selected/default country context. Reject letters, impossible lengths, control characters, and unsupported numbers. Do not silently accept an arbitrary digit string.
- **Normalization:** Store a canonical international representation (E.164 recommended) and display a localized human-readable format. Do not assume the US country code without a product-defined country selector or account locale rule; the country context is a product decision if international users are supported.
- **Creation:** Entering a previously empty number and saving creates the number; unchanged empty remains no-op.
- **Update:** Editing a saved number replaces it only after successful validation and any required verification.
- **Remove:** Clearing the field and saving removes the saved number after the applicable confirmation/verification policy. The exact relationship to the unfinished source phrase `Remove their…` remains an open product question.
- **Duplicate:** Product/security decision required. Recommended behavior is to reject a number already bound to another account without revealing which account, unless phone reuse is explicitly allowed.
- **Unchanged:** Canonical-equivalent values must not trigger a verification SMS or update request.
- **Inline errors:** Use specific messages such as `Enter a valid phone number.` or `Enter a country code.`; preserve the user's raw input so it can be corrected.
- **Success:** Announce `Phone number added.` for creation, `Phone number updated.` for replacement, and `Phone number removed.` for clearing. If verification is pending, announce `Enter the code we sent to finish adding your phone number.` instead.

## 5. Verification and product decisions

The source request does not say whether email or phone verification is required. These must be decided before engineering estimates the final flow:

1. Is a changed email confirmed before it becomes the sign-in/recovery address? Recommended: yes.
2. Is a newly added or changed phone number verified by SMS/call? Recommended: yes if the number is used for recovery or two-step authentication; otherwise defer verification until that use is enabled.
3. Can a user remove their only recovery/authentication method? If not, require a replacement method first and explain why.
4. Are administrators allowed to override another user's profile, or is this strictly self-service? This spec assumes self-service only.
5. What does the unfinished source phrase `Remove their…` refer to? Do not ship an inferred behavior.
6. Are international phone numbers supported, and which default country/formatting library is approved?
7. Is square cropping required at launch, and are animated GIFs static or animated?

## 6. Required state matrix

| State | Expected behavior |
|---|---|
| Empty optional phone/photo | Show empty/default state; no error; Save remains clean until another field changes. |
| Empty required name/email | Inline validation on blur where practical and on Save; block request; focus first invalid field. |
| Invalid name/email/phone | Preserve input, show field error, block Save request until corrected. |
| Invalid/oversized photo | Preserve current saved avatar, reject selection, show file-specific error. |
| Existing values, no edits | Save disabled/no-op; no success toast or network request. |
| Unsaved valid edits | Enable Save and protect against accidental navigation. |
| Saving | Prevent duplicate submit; keep values; provide progress state. |
| Successful text/photo save | Show server-normalized values, clear dirty state, announce precise/common success. |
| Email/phone pending verification | Show pending status and recovery action; never claim effective update. |
| Duplicate email/phone | Reject without account enumeration; preserve edits. |
| Expired verification | Explain expiration and offer resend/restart; do not discard unrelated edits. |
| Unauthorized/expired session | Do not save; show sign-in/session-expired outcome and preserve local edits where safe. |
| Server/network error | Preserve all edits, show retryable error, leave form editable. |
| Concurrent update | Prevent silent overwrite; reload/compare and ask user to reconcile. |

## 7. Accessibility and responsive requirements

- Every control has a visible label; errors are programmatically associated and announced.
- Photo actions are real buttons, not click-only images. File input has a keyboard-accessible label.
- Focus moves to the first invalid control on failed submit and returns predictably after dialogs/crop UI close.
- Success and general errors use `role="status"`/`role="alert"` appropriately and are not conveyed by color alone.
- The form is usable at mobile widths without horizontal scrolling. Photo controls and Save/Cancel actions remain reachable, with a sticky or bottom action area only if it does not obscure fields or the keyboard.
- Touch targets meet the product's minimum size and destructive Remove uses clear text, not an icon alone.

## 8. Launch versus later

### Launch requirements

- Self-service edit of first name, last name, email, and phone.
- Empty/invalid/unchanged/successful states and server-side revalidation.
- Default avatar, upload, replacement, and removal with supported-format/5 MB guidance.
- Dirty-state protection, retryable loading/save errors, accessible inline errors, and precise success feedback.
- Explicit product decisions for verification, phone country handling, cropping, and the unfinished `Remove their…` phrase before implementation begins.

### Optional enhancements

- In-form square crop/zoom/rotate editor if not selected for launch.
- Client-side image compression and progress percentage.
- Pending-email banner with resend and cancel-change actions.
- Phone verification status badge and change-number flow.
- Recent profile-change audit history.

## 9. Acceptance checklist

- [ ] Signed-in user can open their own General profile form from the account identity menu.
- [ ] Form distinguishes organization/store contact data from personal data.
- [ ] Default avatar is deterministic for empty photo state; existing photo, selected preview, replacement, and removal are distinct states.
- [ ] JPG/PNG/GIF/WebP and 5 MB guidance is visible; SVG, oversized, corrupt, and disguised files are rejected client- and server-side.
- [ ] First name and last name are required, normalized, validated, and have explicit empty/invalid/unchanged/success outcomes.
- [ ] Email is required, normalized, validated, protected against duplicate-account disclosure, and has an explicit pending/effective verification outcome.
- [ ] Phone is optional and supports creation, update, canonical normalization, empty/removal, invalid, unchanged, duplicate, and pending-verification outcomes.
- [ ] Save submits only changed values, prevents duplicate requests, and returns server-normalized data.
- [ ] Cancel and navigation protect unsaved changes; failures preserve edits.
- [ ] Loading, unauthorized, concurrent-edit, network/server, validation, and success states are testable.
- [ ] Labels, error associations, live announcements, focus behavior, keyboard access, and mobile layout meet accessibility requirements.
- [ ] Product decisions listed in section 5 are resolved before implementation; no behavior is inferred from `Remove their…`.
