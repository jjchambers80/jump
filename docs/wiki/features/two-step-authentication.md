# Account Settings › Security — Two-step authentication

**Status:** Implemented (spec 030 feature C)
**Last Updated:** 2026-09-20

## Overview

With two-step on, every sign-in — email link, Google, password or passkey — must complete a **second step** before the admin area opens: a code from an authenticator app, a registered passkey used as a security key, or a single-use recovery code. "Remember this device for 30 days" skips the step on that browser. The session cookie carries the state (`mfa: 'pending' | 'ok'`); a pending session can reach only `/auth/two-step` and the two-step API. Turning it on hands out ten recovery codes once and signs out every other device.

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/TwoStepService.js` | `status`, `setup` (otpauth URI + QR + secret; idempotent until enabled), `enable` (live code → on, recovery codes, `revokeOthers`, proof for the enabling browser), `disable`, `regenerateRecoveryCodes`, `verify` (app / recovery / passkey, lockout after 5 failures / 15 min, optional trusted token), `trustedCheck`, `revokeTrustedDevice`, `passkeyOptions` |
| `backend/src/utils/secretBox.js` | AES-256-GCM `seal` / `open`; key = HKDF(`AUTH_SECRET`, purpose). Holds the TOTP seed (`User.totpSecretEnc`) |
| `backend/src/middleware/recentAuth.js` | `issueMfaProof(userId, jti)` — HS256 `typ: 'mfa'`, 2 min; the backend records `mfa-proof:<jti>` in `VerificationToken` |
| `backend/src/middleware/auth.js` | `requireAuth` → 401 `TWO_STEP_REQUIRED` for `mfa: 'pending'`; `requireAuthAllowPending` (sets `req.user.twoStepPending`); `optionalAuth` treats pending as anonymous |
| `backend/src/api/routes/twoStep.js` (`/account/two-step`, mounted **before** `/account`) | Pending-allowed: `POST /verify`, `POST /passkey-options`, `POST /trusted-check`. Signed in: `GET /`, and with step-up `POST /setup`, `/enable`, `/disable`, `/recovery-codes`, `DELETE /trusted-devices/:id` |
| `backend/src/services/SecurityService.js` | Bridge tokens from a user-verified passkey are `bridge:<userId>:uv`; a new password clears trusted devices |
| `frontend/src/lib/staffAuth.ts` | `resolveMfaState` (the state machine), `consumeMfaProof` (single use), `consumeBridgeToken` returns `mfaSatisfied` |
| `frontend/src/auth.ts` | `jwt` callback sets `token.mfa`; `session` exposes `mfaPending`; the Bearer token carries `mfa` |
| `frontend/src/auth.config.ts` | Edge `session` callback exposing `mfaPending` so `middleware.ts` can redirect |
| `frontend/src/middleware.ts` | `/admin*` + `mfaPending` → `/auth/two-step?callbackUrl=` |
| `frontend/src/services/api.ts` | 401 `TWO_STEP_REQUIRED` → `/auth/two-step?callbackUrl=<here>` |
| `frontend/src/app/auth/two-step/page.tsx` | The verify page: trusted-check first, then app code / security key / recovery code, remember device, sign out, restore-access link |
| `frontend/src/app/api/account/two-step/{trust,trusted-check}/route.ts`, `lib/trustedDevice.ts` | The `jump_trusted` httpOnly cookie (set after verify, checked before the form) |
| `frontend/src/app/admin/account/security/TwoStepCard.tsx` | Turn on wizard (`EnableDialog`: scan → code → `RecoveryCodesPanel` with copy / download / "I've saved" gate), status rows, regenerate, trusted devices, `DisableDialog` |
| `frontend/e2e/helpers/session.ts` | `StaffUser.mfa` mints pending / ok cookies |

## Configuration

| Variable | Where | Notes |
|---|---|---|
| `TWO_STEP_TRUST_DAYS` | backend + frontend | Trusted-device lifetime (default 30) |
| `RATE_LIMIT_TWO_STEP_VERIFY_*` | backend | Spec 020 override (15 / 15 min per IP; the service also locks per user after 5 failures) |

`AUTH_SECRET` rotation makes every stored TOTP seed unreadable (users must set two-step up again) — noted in the launch checklist.

## How It Works

### State machine (`resolveMfaState`)
| Situation | Result |
|---|---|
| Two-step off | no claim |
| Fresh sign-in | `pending`, or `ok` when the sign-in was a user-verified passkey (`bridge:…:uv`) |
| `update({ mfaProof })` with a valid single-use proof | `ok` |
| Claims refresh, token already `ok` | `ok` |
| Claims refresh, token has no state (signed in before two-step was turned on, or an old cookie) | `pending` |

### Enforcement
1. **Edge**: `middleware.ts` redirects `/admin*` when `req.auth.mfaPending`.
2. **API**: `requireAuth` refuses `mfa: 'pending'` (401 `TWO_STEP_REQUIRED`); `api.ts` sends the browser to `/auth/two-step`.
3. **Escape hatch**: only `/account/two-step/verify`, `/passkey-options`, `/trusted-check` accept a pending token.

### Turning on
`POST /setup` (step-up) stores an encrypted seed and returns the QR; `POST /enable { code }` verifies with ±30 s tolerance, sets `twoStepEnabledAt`, creates 10 recovery codes (returned **once**, sha256 stored), revokes other sessions (`by: 'two-step'`), emails a notice, and returns a proof so the enabling browser's own session — which predates two-step — flips to `ok` via `update()`.

### Verifying
`POST /verify` with `{ code }` | `{ recoveryCode }` | `{ passkey }` (+ `rememberDevice`). Recovery codes are single use and trigger a "recovery code was used" notice with the remaining count. Success returns `{ proof, method, trustToken? }`; the page posts `trustToken` to `/api/account/two-step/trust` (cookie) and calls `update({ mfaProof })`. Failures are `TWO_STEP_FAILED` events; the sixth in 15 minutes is `TWO_STEP_LOCKED`.

### Trusted devices
Random 32-byte token in the `jump_trusted` cookie; `TrustedDevice.tokenHash` server-side with `expiresAt`. `/auth/two-step` calls `/api/account/two-step/trusted-check` first; a hit returns a proof without showing the form. Listed on the card with *Remove*; cleared by disable and by a password change.

## Testing

- `backend/tests/unit/twoStep.test.js` — secret box, recovery-code normalization, proof shape, pending gate in `requireAuth` / `requireAuthAllowPending`.
- `backend/tests/contract/accountTwoStep.test.js` — setup → enable (codes once, other device out, proof recorded, notice), pending token blocked everywhere but the two-step router, verify by app / recovery (single use, notice) / trusted device, lockout, regenerate, disable, stray pending with two-step off.
- `frontend/tests/unit/twoStepClaims.test.ts` — `consumeMfaProof`, `resolveMfaState`.
- `frontend/e2e/account-two-step.spec.ts` — edge redirect with callback, app code with remember device (cookie route + `update({ mfaProof })` observed), recovery code, trusted device silent completion, complete session skips the page, turn-on wizard, regenerate / trusted devices / turn off.

## Gotchas

- Mount order matters: `/account/two-step` must stay registered **before** `/account` in `server.js`, or the pending-allowed endpoints hit the account router's `requireAuth`.
- Never add a Next page a pending session needs outside `/auth/*` — the middleware only exempts what is not under `/admin`, and `api.ts` redirects on the first `TWO_STEP_REQUIRED`.
- `setup` is idempotent until `enable`; a user who abandons the wizard keeps an unconfirmed seed (`setupPending`) and no enforcement.
- e2e: `update()` re-mints the cookie in real life; specs that need the flip swap the cookie inside the mocked `POST /api/auth/session` (see `signInPending`).

## Related

- Spec: `specs/030-account-settings/spec.md`, plan `plan-two-step.md`
- [Account Security — sign-in methods](account-security.md), [Devices & Sessions](devices-sessions.md)
