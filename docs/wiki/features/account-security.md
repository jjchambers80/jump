# Account Settings › Security — sign-in methods

**Status:** Implemented (spec 030 feature B)
**Last Updated:** 2026-09-20

## Overview

Account › Security lets a staff member manage how they sign in: **passkeys** (recommended), an optional **password**, **connected accounts** (Google) and a **secondary email** for recovery and security notices. Every change first asks the user to **confirm it's them** (step-up) with a password, a passkey or a code emailed to the primary address; the proof lasts 10 minutes. Every change writes a `SecurityEvent` and emails a notice to the primary (and verified secondary) address. Magic link and Google keep working; a password is never required.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/middleware/recentAuth.js` | `issueReauthProof` / `verifyReauthProof` (HS256 `typ: 'reauth'`, 10 min) and `requireRecentAuth` → 401 `REAUTH_REQUIRED` without `X-Jump-Reauth` |
| `backend/src/services/SecurityService.js` | `overview`, `reauthStart` / `reauth` (5 failures / 15 min → `REAUTH_LOCKED`), `setPassword` (policy + HIBP, revokes other sessions), `removePassword`, `verifyPasswordSignIn`, `issueBridgeToken`, `disconnectProvider` (+ Google token revoke), secondary email add / resend / confirm / remove, `requestRecovery` / `completeRecovery` |
| `backend/src/services/PasskeyService.js` | `@simplewebauthn/server` registration + authentication; challenges in `VerificationToken` (`webauthn-reg:<userId>`, `webauthn-auth:<challengeId>`, 5 min); `rpID` = host of the first `FRONTEND_URL` (`WEBAUTHN_RP_ID` override); any localhost origin accepted outside production |
| `backend/src/utils/password.js`, `passwordPolicy.js`, `oneTimeTokens.js` | scrypt (`scrypt$N$r$p$salt$hash`, N=2¹⁵); rules 12–128 chars, not the email, HIBP k-anonymity (fail-open, `HIBP_CHECK=false` off); one-time tokens / codes over `VerificationToken` (`<purpose>:<subject>`, sha256 stored) |
| `backend/src/api/routes/account.js` | `GET /account/security`, `POST /account/reauth/start`, `POST /account/reauth`, `POST/DELETE /account/password`, `/account/passkeys*` (register options/verify need step-up; rename does not), `DELETE /account/providers/:provider`, `/account/secondary-email*` (`confirm` public). `POST /account/email` is now step-up gated |
| `backend/src/api/routes/staffAuth.js` (`/auth`) | `POST /auth/password` (frontend only: `X-Jump-Internal` = `AUTH_SECRET`), `POST /auth/passkey/options` / `verify` → `{ bridgeToken }`, `POST /auth/recover` (always 200), `POST /auth/recover/complete` → `{ bridgeToken }` |
| `frontend/src/auth.ts`, `lib/staffAuth.ts`, `auth.config.ts` | Credentials providers `password` (calls the backend with the signed client IP) and `token-bridge` (consumes `bridge:<userId>` rows); `events.linkAccount` → `PROVIDER_CONNECTED`; Google `allowDangerousEmailAccountLinking: true` so *Connect Google* links to the same-email user |
| `frontend/src/app/admin/account/useReauth.tsx`, `ReauthDialog.tsx` | `ReauthProvider` + `withReauth(fn)`: retry once after the dialog; proof stored via `setReauthToken` in `services/api.ts` (`X-Jump-Reauth`) |
| `frontend/src/app/admin/account/security/SignInMethodsCards.tsx`, `PasswordDialog.tsx`, `SecondaryEmailDialog.tsx`, `page.tsx` | The cards |
| `frontend/src/app/auth/signin/page.tsx` | *Sign in with a passkey*, *Sign in with a password instead*, *Restore access* link |
| `frontend/src/app/auth/recover/`, `recover/complete/`, `confirm-secondary-email/` | Landing pages for the emailed links |
| `package.json` `overrides` | `next` pinned to the frontend's 14.2.21 and one `@auth/core` — see Gotchas |

## Configuration

| Variable | Where | Notes |
|---|---|---|
| `HIBP_CHECK` | backend | `false` skips the breach lookup (default on, fail-open, 2 s timeout) |
| `WEBAUTHN_RP_ID` | backend | Optional RP id override (default: host of the first `FRONTEND_URL`) |
| `RATE_LIMIT_ACCOUNT_REAUTH_*`, `_PASSKEY_CEREMONY_*`, `_PASSWORD_SIGNIN_*`, `_ACCOUNT_RECOVERY_*` | backend | Spec 020 overrides (10 / 15 min, 20 / 15 min, 10 / 15 min, 3 / h) |

## How It Works

### Step-up
1. `withReauth(fn)` runs `fn`. On 401 `REAUTH_REQUIRED` the dialog opens and calls `POST /account/reauth/start` for the available methods (`passkey` if any registered, `password` if set, `email` always).
2. Email: `start { method: 'email' }` sends a 6-digit code (10 min, single use, constant-time compare). Passkey: `start { method: 'passkey' }` returns assertion options scoped to `reauth-<userId>`. Password: `POST /account/reauth { password }`.
3. Success returns `{ reauthToken }`; `api.ts` sends it as `X-Jump-Reauth` and `fn` is retried. Failures are `REAUTH_FAILED` events; five in 15 minutes lock step-up (`REAUTH_LOCKED`).

### Password
Set / change → `PASSWORD_SET` / `PASSWORD_CHANGED`, `SessionService.revokeOthers(userId, sid, 'password-change')`, notice. Sign-in: the `password` Credentials provider posts to `POST /auth/password`; a missing password fails like a wrong one and is a `SIGN_IN_FAILED` event.

### Passkeys
Register: `POST /account/passkeys/register/options` (step-up) → `startRegistration` in the browser → `POST …/register/verify` stores the credential (label from the user agent, e.g. "macOS · Chrome"). Sign in: `POST /auth/passkey/options` → `startAuthentication` → `POST /auth/passkey/verify` → `{ bridgeToken }` → `signIn('token-bridge', { token })`. The bridge row (`bridge:<userId>`, 2 min, single use) is the **only** way a ceremony outside Auth.js becomes a session.

### Connected accounts
Disconnect deletes the `Account` row and best-effort POSTs the stored token to Google's revoke endpoint; always allowed because the magic link to the primary address remains. Connect = `signIn('google')` while signed in; `events.linkAccount` records it.

### Secondary email and recovery
Add (step-up) → link to the new address (1 h) → verified. Recovery: `/auth/recover` posts the address; only a **verified** secondary gets a 15-minute one-time link → `/auth/recover/complete` → bridge token → session. Unknown addresses get the same response and no email.

## Testing

- `backend/tests/unit/security.test.js` — scrypt, rules, HIBP (mocked, fail-open, disabled), proof verify, middleware.
- `backend/tests/contract/accountSecurity.test.js` — step-up required everywhere; wrong/right code, single use, user-bound proof; password set / policy / sign-in / change revokes others / remove; Google disconnect + revoke call; secondary email add → verify → recovery → bridge row; passkey options + bogus assertion refused + challenge single use. `account.test.js` updated for the gated email change.
- `frontend/e2e/account-security.spec.ts` — reauth dialog flow, password add with proof retry, **passkey registration through Chrome's virtual authenticator**, Google disconnect, secondary email, cancel path, sign-in page entry points, confirmation landing page.

## Gotchas

- `npm install` re-resolved the tree when `@simplewebauthn` was added: next-auth's peer `next` landed at the root as **next 16** and `@auth/core` split, breaking `middleware.ts` types. Root `package.json` `overrides` pin `next` to `14.2.21` and `@auth/core` to `0.41.1`. Bump both together when upgrading Next.
- Passkey rename does not need step-up; add / remove do.
- `POST /auth/password` is only for the frontend (`X-Jump-Internal`); browsers never call it.
- The `token-bridge` provider consumes rows the backend wrote — both sides hash with sha256 and use the `bridge:` prefix; change them together.
- Spec C (two-step) should treat a bridge token minted after a user-verified passkey assertion as two factors already (`userVerified` is logged, not yet stored).

## Related

- Spec: `specs/030-account-settings/spec.md`, plan `plan-security.md`
- [Account Settings › General](account-settings.md), [Devices & Sessions](devices-sessions.md)
