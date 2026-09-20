# Implementation Plan: Account settings › Security — Two-step authentication (spec 030, feature C)

**Status**: Built 2026-09-20 on `feat/030-account-two-step` (see `docs/wiki/features/two-step-authentication.md`). Deviations: the trusted-device cookie is read by a Next route handler (`/api/account/two-step/trusted-check`) called from the client page rather than a server component; `otplib` v13 functional API (`epochTolerance: 30`); a user-verified passkey sign-in is marked in the bridge token subject (`:uv`).
**Branch / worktree**: `feat/030-account-two-step` at `.claude/worktrees/030-account-two-step`, based on `feat/030-account-security` (rebase onto `main` once A + B merge).
**Spec**: [`spec.md`](./spec.md) §6.5. **Depends on**: A (shell), B (step-up `requireRecentAuth`, `Passkey`, `SecurityEvent`, notices). Optional: D (`sid`) for "sign out other devices when 2FA is turned on".
**Dependencies**: `otplib` (backend). QR via existing `qrcode` (`QRService`).

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Step-up | B: `requireRecentAuth`, `withReauth` | Enable / disable / regenerate codes are step-up gated |
| Passkeys | B: `Passkey` table, `/api/auth/passkey/login/*` handlers | Same assertion ceremony, `userVerification: 'discouraged'`, serves as the **security key** second step |
| JWT claims + refresh | `auth.ts` `jwt` callback, `sessionClaims.ts`, `authJwt.ts` encode/decode | `mfa` state travels in the cookie; the `update` trigger clears it |
| Edge guard | `frontend/src/middleware.ts` (`STAFF_ONLY_PREFIXES`) | Redirects a pending session to `/auth/two-step` |
| Backend guard | `backend/src/middleware/auth.js` `requireAuth` | Rejects a pending token |
| QR | `backend/src/services/QRService.js` (`qrcode`) | `otpauth://` QR as data URL |
| Hashed tokens | B helpers | Recovery codes hashed the same way |

## 2. Schema

```prisma
model User {
  twoStepEnabledAt DateTime?
  totpSecretEnc    String?        // AES-256-GCM, key = HKDF(AUTH_SECRET, 'totp'); "iv.tag.ciphertext" b64
  recoveryCodes    RecoveryCode[]
  trustedDevices   TrustedDevice[]
}
model RecoveryCode {
  id        String    @id @default(cuid())
  userId    String
  codeHash  String                 // sha256(code) — 10 codes, "xxxxx-xxxxx"
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}
model TrustedDevice {
  id         String   @id @default(cuid())
  userId     String
  tokenHash  String   @unique
  userAgent  String?
  createdAt  DateTime @default(now())
  lastUsedAt DateTime @default(now())
  expiresAt  DateTime                 // +30 d
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}
```
`SecurityEvent.type` adds `TWO_STEP_ENABLED | TWO_STEP_DISABLED | TWO_STEP_VERIFIED | TWO_STEP_FAILED | RECOVERY_CODE_USED | RECOVERY_CODES_REGENERATED | TRUSTED_DEVICE_ADDED | TRUSTED_DEVICE_REVOKED`.

## 3. Enforcement — how a pending second step is represented

1. **Claim.** `authJwt.ts` `SessionClaims` gains `mfa?: 'pending' | 'ok'`; `encodeSessionToken` writes it; `session` callback exposes `session.mfaPending`.
2. **Sign-in.** `auth.ts` `jwt` callback: when `user` is set (fresh sign-in, any provider — Resend, Google, password, token-bridge) and the DB user has `twoStepEnabledAt`, set `token.mfa = 'pending'` unless the request carried a valid trusted-device cookie (see 5). Sign-ins that arrive through the `token-bridge` after a **passkey** ceremony with `userVerification` performed count as two factors already → `mfa = 'ok'` (possession + biometric/PIN; the bridge token carries `uv: true`).
3. **Edge.** `middleware.ts`: on platform hosts, if `req.auth?.mfaPending` and the path is not `/auth/two-step*`, `/api/auth/*` or static → redirect `/auth/two-step?callbackUrl=`. A completed session visiting `/auth/two-step` is sent to `callbackUrl`.
4. **Backend.** `requireAuth`: `decoded.mfa === 'pending'` → 401 `TWO_STEP_REQUIRED`. Only `POST /account/two-step/verify` (its own router mount with a `requireAuthAllowPending` variant) accepts a pending token.
5. **Completion.** `POST /account/two-step/verify` `{ code }` | `{ recoveryCode }` | `{ passkey }` → on success returns `{ proof }`, an HS256 JWT `{ typ: 'mfa', sub, jti, exp: +2 min }`. The page calls `useSession().update({ mfaProof: proof })`; the `jwt` callback (`trigger === 'update'`) verifies `proof` (`typ`, `sub`, single-use `jti` via `VerificationToken` `mfa-proof:<jti>`) and sets `token.mfa = 'ok'`. Event `TWO_STEP_VERIFIED`. Failures: limiter `TWO_STEP_VERIFY` 5 / 15 min per user+IP, then 429 with lockout copy; event `TWO_STEP_FAILED`.
6. **Existing sessions** when a user turns 2FA on: `token.mfa` is absent → treated as `'ok'` for tokens minted before `twoStepEnabledAt` **only if** D is merged and the current `sid` is kept; other sessions are revoked (`SessionService.revokeOthers`). Without D: existing tokens stay valid until they refresh claims (≤ 60 s), at which point a missing `mfa` on a 2FA-enabled user becomes `'pending'` — the current browser included, so the enable flow finishes by calling `update({ mfaProof })` with the proof returned by the enable endpoint.

## 4. Endpoints (`/account/two-step*`, `requireAuth`)

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/account/two-step` | — | `{ enabled, enabledAt, methods: { app: bool, securityKey: passkeyCount > 0 }, recoveryCodes: { total, remaining }, trustedDevices: [{ id, userAgent, lastUsedAt, current }] }` |
| POST | `/account/two-step/setup` | `requireRecentAuth` | Generates secret (`otplib authenticator.generateSecret()`), stores it encrypted **but not enabled**; returns `{ otpauthUrl, qrDataUrl, secret (manual entry) }`. Idempotent until enable |
| POST | `/account/two-step/enable` | `requireRecentAuth` | `{ code }` → `authenticator.check(code, secret)` (window 1) → `twoStepEnabledAt = now`, generate 10 recovery codes (returned **once** in the response), event + notice, returns `{ recoveryCodes, proof }` |
| POST | `/account/two-step/disable` | `requireRecentAuth` | `{ code \| recoveryCode }` → clears secret, enabledAt, recovery codes, trusted devices; event + notice |
| POST | `/account/two-step/recovery-codes` | `requireRecentAuth` | Regenerate (invalidates old) → returned once |
| POST | `/account/two-step/verify` | pending-allowed | §3.5. `{ rememberDevice: true }` → also sets the trusted-device cookie (§5) |
| DELETE | `/account/two-step/trusted-devices/:id` | `requireRecentAuth` | Revoke one |

`TwoStepService` (`backend/src/services/TwoStepService.js`): `encryptSecret` / `decryptSecret` (AES-256-GCM with a key derived from `AUTH_SECRET` via HKDF — no new env var), `verifyTotp`, `consumeRecoveryCode` (transaction, single use), `issueProof`, `trustDevice` / `isTrusted`.

## 5. Trusted device ("Remember this device for 30 days")

Cookie `jump_trusted` — httpOnly, Secure, SameSite=Lax, 30 d, value = random 32 bytes b64url; DB stores `sha256(value)`. Set by the Next `/api/account/two-step/trust` route handler (cookies are set by the frontend origin, as `jump_buyer` is) after a successful verify with `rememberDevice`. The `jwt` callback cannot read cookies, so the check lives in the `/auth/two-step` **server component**: it reads the cookie, calls backend `POST /account/two-step/trusted-check` (`{ tokenHash }`), and if valid immediately completes via the proof path without showing the form. Trusted devices are listed on the 2FA card with *Revoke*. Disabling 2FA or changing the password (B) clears them.

## 6. Frontend

- `frontend/src/app/auth/two-step/page.tsx` — "Verify it's you": authenticator code input (autofocus, 6 digits, paste-friendly), *Use a security key* (passkey assertion via B's `startAuthentication`), *Use a recovery code*, checkbox *Remember this device for 30 days*, lockout message. On success → `update({ mfaProof })` → `router.replace(callbackUrl)`.
- Security page card **Two-step authentication** (replaces B's stub): copy from spec §6.5 + the "How it works" list; state *Off* → *Turn on* (wizard dialog: 1 scan QR / enter key → 2 enter code → 3 save recovery codes with copy + download `.txt` + "I've saved these" gate) ; state *On since <date>* → methods list (Authenticator app ✓, Security key: n passkeys or "Add a passkey in Passkeys"), *Recovery codes: 8 of 10 left · Regenerate*, *Trusted devices* list, *Turn off* (dialog asks for a current code).
- `api.ts`: `api.account.twoStep.get/setup/enable/disable/regenerateCodes/verify/revokeTrusted`.

## 7. Env / config
| Var | Where | Notes |
|---|---|---|
| `RATE_LIMIT_TWO_STEP_VERIFY_*` | backend | Spec 020 override (default 5 / 15 min) |
| `TWO_STEP_TRUST_DAYS` | backend | Optional, default 30 |

## 8. Tests
- **Unit**: secret encrypt/decrypt round-trip and tamper detection; TOTP verify with `otplib` fixed time; recovery code single use; proof verify (typ / sub / jti reuse → reject); `requireAuth` rejects `mfa: 'pending'`.
- **Contract**: setup → enable (codes returned once, second GET shows only counts) → verify with code / recovery / wrong code → 429 after 5; disable clears everything; trusted-check with valid / expired hash; every `/account/*` route except verify returns 401 `TWO_STEP_REQUIRED` for a pending token.
- **Frontend unit** (vitest): `jwt` callback sets `pending` on fresh sign-in for a 2FA user, clears on valid `mfaProof`, ignores a reused `jti`; `middleware.ts` redirect for pending sessions (existing middleware test file pattern).
- **E2E**: enable wizard (stub QR), sign in with `signInAsStaff` variant that mints a `mfa: 'pending'` cookie → redirected to `/auth/two-step` → enter code → lands on `/admin`; remember-device cookie skips the prompt on the next sign-in.

## 9. Delivery slices
1. Claim plumbing: `mfa` in `authJwt.ts` / `sessionClaims.ts` / `session`, `jwt` callback pending + proof handling, `middleware.ts` redirect, backend `requireAuth` rejection + pending-allowed variant. Ship dark (no user has `twoStepEnabledAt`).
2. `TwoStepService` + setup / enable / disable / recovery codes + card wizard.
3. `/auth/two-step` page + verify endpoint + security-key path.
4. Trusted devices.
5. Docs: wiki `two-step-authentication.md`, `backend/AGENTS.md` (pending tokens, proof single-use), root `AGENTS.md` gotcha ("a session with `mfa: 'pending'` can reach only `/auth/two-step` — never mount a new Next route outside that allowlist expecting it to work mid-challenge"), `specs/STATUS.md`.

## 10. Risks / notes
- Clock drift: `otplib` window 1 (±30 s). Document "check your phone's clock" in the lockout copy.
- `AUTH_SECRET` rotation would make every `totpSecretEnc` unreadable — note in `docs/wiki/config/production-launch-checklist.md`; a future `TOTP_KEY` env can be introduced if rotation is ever needed.
- Keep SMS and email-code second factors out: email is already the magic-link first factor.
