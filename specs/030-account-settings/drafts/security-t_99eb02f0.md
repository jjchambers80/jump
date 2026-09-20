# Feature Specification: Account settings permissions and security

**Feature**: Staff account settings opened from the signed-in user's name and email in the organization menu
**Status**: Planned
**Scope**: Authorization and safety requirements for the user-owned **General** account area. This document does not authorize organization-level editing or administrator management of another user's account.
**Builds on**: Auth.js staff sessions, shared HS256 `AUTH_SECRET`, organization membership and org switcher (`X-Jump-Org`), existing Settings modal patterns, and spec 020 rate limiting.

## Problem and security boundary

The organization menu should take a signed-in staff member to their own account settings, not to an organization-scoped user-management editor. A member may manage profile and authentication methods belonging to their own `User` record. The selected organization is navigation context only; it MUST NOT change which user record the endpoint edits.

The server is the authority for identity and permissions. A client-supplied user id, email, organization id, role, or membership MUST NOT select the target account for self-service mutations.

## Actors and permissions

| Operation | Signed-in account owner | Other staff member | ADMIN / SYSTEM_ADMIN override |
|---|---:|---:|---:|
| View own General settings | Allowed | N/A | N/A |
| Edit own name, avatar, language, timezone | Allowed | Denied | Not defined by this feature |
| Add, replace, remove own phone | Allowed, with verification rules | Denied | Not defined by this feature |
| Start or complete own email change | Allowed, with current-session and confirmation checks | Denied | Not defined by this feature |
| Manage own external login connection | Allowed, only if another recovery method remains | Denied | Not defined by this feature |
| View or revoke own sessions/devices | Allowed | Denied | Not defined by this feature |
| Manage another user's profile, email, phone, sessions, or authenticators | Denied | Denied | **Open product decision** |

The launch implementation MUST support self-service only. Whether an administrator may later recover, edit, suspend, or revoke another member's account is an explicit follow-up decision; do not infer an override from the existing organization `Users` role-management page. If approved later, it needs separate routes, permission checks, disclosure, and audit requirements rather than weakening the owner endpoints.

An authenticated user with role `UNASSIGNED` remains subject to the same account-owner rules, but cannot gain organization data or organization-management permissions from this page.

## Allowed self-service operations

The General page may expose:

- first and last name;
- avatar upload, replacement, and removal;
- primary email change;
- phone add, replacement, and removal;
- connected external login status and disconnect action;
- preferred language for Jump's authenticated/admin UI only;
- account timezone for account timestamps, notifications, and admin presentation;
- links into Security for passkeys, password, two-step authentication, secondary email, and active devices when those capabilities exist.

Language and timezone are account preferences. They do not alter an organization's public storefront, buyer communications, or customer-facing locale.

## Authentication and session requirements

1. Every read and mutation requires a valid staff session. Buyer JWTs, expired sessions, and unauthenticated requests are rejected by the staff auth middleware.
2. The server derives `userId` from the verified session (`req.user.id` or equivalent). Endpoints MUST ignore or reject a path/body user id that is not the authenticated subject.
3. Ordinary preference edits may use the current session. Sensitive operations MUST require step-up authentication completed recently (recommended maximum age: 10 minutes): primary email change, phone replacement/removal, external-login disconnect, password/passkey/2FA changes, secondary-email changes, and session revocation-all.
4. Step-up may be satisfied by the current password, a passkey/security key, an enrolled second factor, or a fresh reauthentication through a currently linked external provider. The API returns a generic step-up-required result; it must not reveal which recovery method exists.
5. A successful step-up is scoped to the authenticated user, operation family, and short expiry. It is single-use for destructive/security mutations where practical. It MUST NOT be accepted as a client-supplied boolean.
6. Successful email, phone, credential, authenticator, and session changes invalidate or refresh affected session claims and return the user to a safe authenticated state. Email change and disconnect operations MUST revoke sessions/tokens that were issued under the superseded identity when the auth provider requires it.
7. If changing the primary email would leave the account without a usable recovery/authentication method, the server refuses the change until another method is enrolled.

## Primary email changes

- The user enters a syntactically valid, normalized email address and completes step-up authentication.
- The requested address is checked case-insensitively against the unique user identity before any commit. A duplicate produces a conflict without disclosing the other account's details.
- The current email remains the login and notification address until the new address is confirmed. The pending address is not shown as active in the session or to other users.
- Send a single-use, hashed, short-lived confirmation token to the new address. Do not put the raw token in logs, analytics, or API responses. Notify the current address that a change was requested, without exposing the new address beyond what is necessary.
- Confirmation is idempotent: a repeated valid click shows the already-completed outcome and does not create another change. A token for a superseded request is invalidated.
- On confirmation, atomically update the normalized email, clear the pending request, record an audit event, refresh/revoke affected sessions as required, and require sign-in again if the provider cannot safely refresh the session.
- Resend is rate limited and invalidates the prior token. Expired or malformed tokens show a generic expired-link message and offer a safe restart; they never reveal whether an account or email exists.

## Phone verification

- Store phone country code and normalized number in a form suitable for uniqueness comparison; do not use display formatting for identity checks.
- Adding or replacing a phone creates a pending value and sends a one-time verification code through the configured provider. The unverified number is not used for recovery, security notifications, or displayed as verified.
- A verified phone is required before it becomes active. Removing a verified phone requires step-up authentication and, when it is the last recovery method, another verified recovery method first.
- Duplicate phone values return a generic conflict (`PHONE_ALREADY_IN_USE`) without identifying the owning account. A phone may not be attached to two active staff accounts if the data model treats it as a recovery factor.
- Codes are single-use, short-lived, attempt-limited, and never logged. Expired, already-used, or too-many-attempt codes return the same recoverable verification failure; the user may request a new code after the resend limit permits.
- Verification and removal are atomic. A failed provider call leaves the previous verified number unchanged and leaves a pending replacement retryable or explicitly cancellable.

## External login disconnect

A user may disconnect Google or another currently supported external login only after step-up authentication and only when the account retains a password, passkey, verified secondary email, or another supported recovery method. The server must refuse removal of the last usable authentication/recovery method with an actionable message. Disconnect is not a membership or organization operation, and it must not delete the User row. It records the provider removal and security audit event; any provider-specific token/session revocation is best effort and must be reported as incomplete if it fails.

## Audit logging

Audit security-relevant events append-only with actor user id, event type, target user id (always the actor for this scope), timestamp, outcome, request correlation id, and privacy-safe metadata such as provider or reason. Include at least:

- profile update and avatar add/remove;
- email-change requested, confirmed, rejected, expired, and failed;
- phone verification requested, succeeded, failed, and removed;
- external login connected/disconnected;
- step-up success/failure;
- password/passkey/2FA/secondary-email changes;
- session logout and logout-all;
- rate-limit and authorization denials where operationally useful.

Never store passwords, passkeys, TOTP secrets, raw verification codes/tokens, full phone numbers, or raw IP addresses in the audit payload. If request metadata is retained, follow the existing privacy-safe hashing policy. Audit-write failure MUST fail a security mutation closed, or place it in a durable retry path that guarantees the event is not silently lost; the UI must not claim success before the mutation and audit record are durable.

## Rate limiting and abuse controls

Apply named, configurable limiters through the existing spec 020 mechanism, keyed by the real client IP and authenticated subject where appropriate:

- profile/avatar mutations: generous per-user and per-IP write limits;
- email-change and phone-code requests: strict per-user, destination, and IP limits;
- verification attempts: strict per-challenge and per-IP attempt limits;
- step-up attempts and login/security recovery: strict failure limits;
- resend endpoints: stricter than ordinary reads.

Rate-limited responses use `429`, draft-7 `RateLimit-*` headers, and a stable generic error code. Do not reveal whether a destination belongs to an account. Limiters must run before email/SMS/provider work and must not create partial profile changes.

## Privacy and data handling

- Return only the signed-in user's data, with sensitive values masked where full display is unnecessary.
- Do not expose pending email addresses, full phone numbers, recovery addresses, device IPs, or authentication-factor secrets to organization members, public organization routes, search, analytics, or customer APIs.
- Avatar uploads must follow existing private file/storage controls; reject unsupported MIME types and unsafe files, and remove or orphan-clean replaced assets according to the file lifecycle policy.
- Security notifications should identify the event, time, and recovery action without including secrets or sensitive values.
- Error messages distinguish validation errors from actionable verification failures but remain generic for account-existence, duplicate-identity, and unauthorized cases.

## Failure and concurrency behavior

| Condition | Required server result | User-facing outcome |
|---|---|---|
| Missing/expired session | `401` | Sign in again; preserve a safe return URL |
| Authenticated but target is not session subject | `403` or indistinguishable `404` | "This account cannot be edited." No data change |
| Missing recent step-up | `428`/stable `STEP_UP_REQUIRED` | Open verification challenge; preserve unsaved form state locally only |
| Invalid field or unsupported file | `400` with field errors | Inline correction; no other field is discarded |
| Duplicate email/phone | `409` stable conflict code | Explain that the value is unavailable; do not identify owner |
| Expired/used verification | `400` stable expired code | Request a new verification; old token remains unusable |
| Too many attempts/requests | `429` | Show retry guidance without revealing account state |
| Provider/email/SMS outage | `502`/stable retryable code | Keep prior verified value; allow retry; do not claim success |
| Concurrent edit with stale version | `409` conflict | Refetch current record and ask whether to retry; never overwrite silently |
| Audit/storage/database failure | `503` or transaction rollback | Explain that nothing was saved; retry safely |
| Network failure after submit | Unknown outcome; idempotency key required for sensitive writes | Refetch account state before retrying; avoid duplicate email/SMS or audit events |

Use optimistic concurrency (`updatedAt`/version) on profile and security records. Sensitive mutations should accept an idempotency key and persist the outcome so a browser retry cannot repeat a change, send duplicate notifications, or consume a verification token twice.

## Acceptance criteria

- [ ] A user entering General from the organization menu can read and edit only their own account record; changing org context cannot change the target user.
- [ ] Direct requests naming another user are rejected server-side for every self-service endpoint.
- [ ] Name, avatar, language, and timezone edits require authentication and produce no organization/storefront locale change.
- [ ] Email changes remain pending until a single-use confirmation succeeds; duplicate, expired, replayed, and rate-limited cases have the outcomes above.
- [ ] Phone values remain unverified until code confirmation; duplicate, expired, replayed, removal, and provider-failure cases preserve safe state.
- [ ] Disconnecting an external login cannot strand the account without another usable recovery method.
- [ ] Sensitive operations require recent step-up authentication and refresh/revoke affected sessions appropriately.
- [ ] Security mutations create privacy-safe append-only audit events and never log secrets.
- [ ] Rate limits apply before provider work, return stable generic `429` responses, and do not permit account enumeration.
- [ ] Concurrent edits and ambiguous network retries cannot silently overwrite data or repeat a sensitive side effect.
- [ ] Administrator editing of another user's profile is recorded as an explicit open product decision and is not implemented by these requirements.

## Open decisions

1. **Administrator override**: May ADMIN or SYSTEM_ADMIN edit another user's profile, recover their access, revoke their sessions, or manage their authenticators? If yes, define the exact roles, organization scope, step-up requirement, user notification, and audit event before implementation.
2. **Recovery policy**: Which methods count as sufficient recovery for disconnecting an external provider: password, passkey, TOTP, verified phone, secondary email, or a combination?
3. **Phone uniqueness**: Is a verified phone globally unique across staff accounts, organization-scoped, or merely a contact attribute?
4. **Provider support**: Which external providers and notification channels are launch-supported, and which provider tokens can Jump actually revoke?
