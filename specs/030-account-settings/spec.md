# Spec 030: Account settings — General and Security

**Status**: Specified 2026-09-20; all four features built the same day (A PR #109, D PR #112, B PR #115, C on `feat/030-account-two-step`). The audit below records the starting state.
**Supersedes**: the five parallel drafts in `drafts/` (kept for reference; this file is the source of truth).
**Plans**: one per feature, each built on its own worktree —
[`plan-general.md`](./plan-general.md) · [`plan-security.md`](./plan-security.md) · [`plan-two-step.md`](./plan-two-step.md) · [`plan-devices.md`](./plan-devices.md).

---

## 1. Outcome

A signed-in staff member clicks their **name / email** at the bottom of the organization menu and lands in their own account settings — not the organization's. Two pages:

- **General** — photo, first / last name, email, phone, preferred language, time zone.
- **Security** — passkeys, password, secondary email, two-step authentication, devices.

Account settings belong to the `User`, never to an organization, venue, event, storefront, `OrganizationMember` or `Contact`. Switching the active organization does not change what these pages show or edit. Preferred language and time zone shape the Jump administration experience for this user only; they never touch what customers see on an online store.

## 2. Audit — what exists today (2026-09-20)

| Capability | Built? | Evidence |
|---|---|---|
| Account entry in the organization menu | **No** | `frontend/src/components/OrgSwitcher.tsx` renders name + email as a static `<div>`; only *Log out* and the theme toggle are actions |
| Account settings pages | **No** | `frontend/src/app/admin/settings/*` are all organization settings. `/admin/settings/users` is the org **Users** (role) page, not personal settings |
| Profile photo / avatar | **No** | `User.image` exists (Auth.js, filled by Google's picture URL) but nothing uploads, removes or renders it. `ImageService` + `Image` (`usageType`) + `middleware/imageUpload.js` exist for org logos / covers and are reusable |
| First / last name | **Partial** | `User.firstName`, `lastName`, `name` columns exist; only `PATCH /users/:id` (ADMIN, edits *other* users' role/status) touches `User`. No self-service edit |
| Email change | **No** | `User.email @unique`; no change / verification flow. `VerificationToken` table exists (Auth.js magic link) |
| Phone | **No** | No column on `User` (`Contact.phone` is the buyer's, unrelated) |
| Preferred language | **No** | No column, no i18n layer in the admin |
| Time zone | **No** | No column. Spec 021 (Proposed, unbuilt) adds an *organization* time zone — a different setting |
| Google disconnect / external providers | **No** | `Account` rows exist (Google via `@auth/prisma-adapter`); nothing lists or deletes them |
| Password | **No** | No hash column, no Credentials provider except the dev-only `dev-email` one |
| Passkeys | **No** | No `Authenticator` / passkey model, no WebAuthn dependency |
| Secondary email | **No** | — |
| Two-step authentication | **No** | No TOTP / recovery-code model, no dependency, no enforcement in `middleware.ts` or `requireAuth` |
| Devices / sessions | **No** | Sessions are stateless HS256 JWTs (`frontend/src/lib/authJwt.ts`, 30 d). No session table, no `sid`, no revocation. `signOut` only clears the cookie |
| Security notifications / audit trail | **No** | `EmailService` has order / buyer / application mail only |

Reusable foundations: `SettingsNav` + `SettingsDialog` + per-card PATCH pattern (`/admin/settings`), `ImageService`, `makeLimiter` (spec 020), `LegalAcceptance` hashed-IP pattern (`LEGAL_IP_SALT`), `sessionClaims.ts` 60 s claims refresh (the hook for revocation and for pushing `locale` / `timeZone` into the JWT), `EmailService` + Resend, `QRService` (`qrcode`), `clientIpForRateLimit`.

## 3. Feature split and worktrees

| Feature | Worktree branch | Depends on | Plan |
|---|---|---|---|
| A. General (entry, shell, profile, photo, email change, phone, language, time zone) | `feat/030-account-general` | main | `plan-general.md` |
| B. Security — sign-in methods (password, passkeys, Google disconnect / connect, secondary email, step-up re-authentication, security notices, audit trail) | `feat/030-account-security` | A (shell + `/account` router) | `plan-security.md` |
| C. Two-step authentication (authenticator app, recovery codes, trusted devices, security key as second step) | `feat/030-account-two-step` | A, B (step-up + passkeys) | `plan-two-step.md` |
| D. Devices (session inventory, log out one / all, geo + device labels, revocation) | `feat/030-account-devices` | A (shell) | `plan-devices.md` |

Merge order **A → D → B → C** is the least conflict-prone (D introduces `sid` in the JWT that B and C then use to sign out other devices). B and D can be built in parallel on top of A; C starts once B is merged.

## 4. Routes and navigation

- `/admin/account` — General
- `/admin/account/security` — Security

Not under `/admin/settings/*` (organization settings) and not in the sidebar. Entry: the name / email block in `OrgSwitcher` becomes a link (**Manage account**) to `/admin/account`. Left nav `AccountNav` (General · Security) mirrors `SettingsNav`. Both pages are `AdminRoute`-guarded like every admin page and subject to the edge redirect for unauthenticated visitors.

Backend: new router `backend/src/api/routes/account.js` mounted at `/account`, router-level `requireAuth`. **Every handler derives the subject from `req.user.id`; a user id in params or body is never accepted.** No role gate beyond authentication (an account is personal), and no `X-Jump-Org` scoping.

## 5. General (feature A)

### 5.1 Profile photo
Upload / replace / remove. JPG, PNG, GIF, WebP ≤ 5 MB, MIME sniffed server-side by `ImageService.processUpload(…, 'avatar')`. Square crop is not required at launch (`sharp` `cover` fit on the thumbnail variant). Removal confirms, then deletes the `Image` and falls back to initials. The Google-supplied `User.image` URL is only a display fallback; it is never copied into the avatar and *Remove* on an avatar never touches it.

### 5.2 Personal information
- **First name / last name** — 1–80 chars each, trimmed; `User.name` is rewritten as `"First Last"` so the JWT `name` claim, the org menu and every "by …" label stay consistent.
- **Email** — verified change. Enter new address → Jump emails a confirmation link to the *new* address (valid 1 h) → clicking it swaps `User.email`, sets `emailVerified`, notifies the *old* address. Until then General shows "Pending: new@… · Resend · Cancel". Uniqueness is checked when requested and again when confirmed. A Google-linked account keeps its link (it is keyed on `providerAccountId`).
- **Phone** — optional, stored E.164 (`libphonenumber-js`, default region US), shown national-formatted. Add / edit / remove. Not verified at launch (no SMS provider in the stack); the field says "Used for account recovery contact only".

### 5.3 Preferences
- **Preferred language** — `User.locale` (BCP 47). Copy: *"When you're logged in to Jump, this is the language you'll see. It doesn't affect the language your customers see on your online store."* Launch list: `en-US` only, from one shared `SUPPORTED_LOCALES` constant; the value drives `Intl` number / date formatting in the admin now and translations when an i18n layer exists.
- **Time zone** — `User.timeZone` (IANA). Copy: *"This is the time zone for your account. It's used for the dates and times you see in Jump."* (Add *"To set the time zone for your store, go to Settings › General"* only once spec 021 ships.) `null` = browser zone, shown as "Browser default (America/New_York)". List from `Intl.supportedValuesOf('timeZone')`, grouped by region, with current UTC offset. Validated server-side with `Intl.DateTimeFormat`.
- Both are pushed into the JWT claims (`sessionClaims.ts`) so `useSession()` exposes them without an extra fetch; admin date formatting goes through one `useAccountFormat()` helper.

## 6. Security (features B, C, D)

Section order on the page: **Passkeys (recommended)** · **Password** · **Secondary email** · **Two-step authentication** · **Devices**. Every mutation here requires **recent authentication**: a 10-minute step-up proof obtained with the password, a passkey, or — for accounts that have neither — a 6-digit code emailed to the primary address. Every mutation writes a `SecurityEvent` row and sends a security notice to the primary (and verified secondary) email.

### 6.1 Passkeys (B)
WebAuthn resident credentials. Register (label defaults to the device from the user agent), rename, remove, "last used". Sign in with a passkey from `/auth/signin`. Private keys never reach Jump.

### 6.2 Password (B)
Add / change / remove. 12–128 chars, not the email, not in the HIBP breach corpus (k-anonymity range lookup, fail-open). `/auth/signin` gains an email + password form; magic link and Google stay. Changing or removing the password signs out all other devices (D). Removal is allowed — magic link remains — and says so.

### 6.3 Connected accounts (B)
Lists linked providers (Google today) with the provider email. **Disconnect** deletes the `Account` row and best-effort revokes the Google token. Always allowed: the magic link to the verified primary email is the floor, and the confirmation says so. **Connect Google** links a Google account whose verified email equals the primary email.

### 6.4 Secondary email (B)
Copy: *"A secondary email can be used to restore access to your account. Security notifications are also sent to this email."* Add → verify by link → verified. Remove with confirmation. Recovery: `/auth/recover` accepts a verified secondary address and emails it a one-time sign-in link for the *primary* account.

### 6.5 Two-step authentication (C)
Copy: *"After entering your password, verify your identity with an authentication method."* → in Jump: *"After signing in, verify your identity with a second step."* (magic-link and Google sign-ins also get the second step — otherwise 2FA would be void for most staff). Methods: **Authenticator app** (TOTP) and **Security key / passkey** (a registered passkey used as the second factor); **recovery codes** (10, shown once, downloadable) as backup. "Remember this device for 30 days" trusted-device cookie. While the second step is pending the session can reach only `/auth/two-step`; the backend rejects the token. Disabling requires a current code.

### 6.6 Devices (D)
Copy: *"You're currently logged in to Jump on these devices. If you don't recognize a device, log out to keep your account secure."* Rows: device (OS · browser from the user agent), **This device** badge, last active, city / region / country ("Location unavailable" when unknown), **Log out**. **Log out all other devices** keeps the current one. Revocation is real: the backend rejects a revoked session immediately; the browser cookie is dropped within one claims-refresh (≤ 60 s). Pre-existing sessions without a `sid` are adopted on their next refresh.

## 7. Cross-cutting requirements

- Self-service only. No administrator override, support access or impersonation is implied by this spec; the org Users page keeps managing roles, not personal data.
- PATCH validators whitelist keys and validate only what is present (the `validateUpdateBusinessDetails` pattern).
- Secrets (password, TOTP secret, recovery codes, step-up codes, tokens) are hashed or encrypted at rest and never logged. Responses never echo them.
- Rate limits via `makeLimiter`: `ACCOUNT_EMAIL_CHANGE`, `ACCOUNT_REAUTH`, `PASSWORD_SIGNIN`, `PASSKEY_CEREMONY`, `TWO_STEP_VERIFY`, `ACCOUNT_RECOVERY`. Generic responses where enumeration would leak.
- Destructive actions (remove photo, remove phone, disconnect provider, remove passkey / password / secondary email, disable 2FA, log out device(s)) confirm and state consequences.
- Keyboard-operable dialogs (`SettingsDialog`), labelled controls, `aria-live` status, single-column on narrow viewports.
- Every mutation and every sign-in factor change appears in `SecurityEvent`.

## 8. Decisions taken (change in the plan if wrong)

1. Routes `/admin/account*`, not `/admin/settings/users/*` (that path is org Users).
2. Email change is verified-pending, never immediate.
3. Phone is stored, not verified (no SMS provider).
4. Launch locale list is `en-US` only; the control ships so the preference is stored from day one.
5. Password hashing: Node `crypto.scrypt` (no native dependency; Railpack-safe).
6. Passkeys: `@simplewebauthn` in our own Next route handlers + a one-time-token Credentials bridge into Auth.js — not the experimental Auth.js WebAuthn provider.
7. 2FA applies to every first factor, including magic link and Google.
8. Geolocation: `geoip-lite` (bundled GeoLite2, attribution required) behind `GEOIP_ENABLED`; off → "Location unavailable".
9. "Log out all devices" keeps the current session.

## 9. Open decisions

1. Whether an ADMIN may ever see or reset another member's security settings (default: no).
2. HIBP breach check on password set (default: on, fail-open).
3. Google `allowDangerousEmailAccountLinking` for **Connect Google** (default: on for Google only — Google verifies emails).
4. Whether UNASSIGNED users (signed in, no org yet) should reach `/admin/account` (today `AdminRoute` sends them to `/signup`).
