# Implementation Plan: Account settings › Security — sign-in methods (spec 030, feature B)

**Status**: Planned (2026-09-20). Not implemented.
**Branch / worktree**: `feat/030-account-security` at `.claude/worktrees/030-account-security`, based on `feat/030-account-general` (rebase onto `main` once A merges).
**Spec**: [`spec.md`](./spec.md) §6.1–§6.4, §7. **Blocks**: C (needs step-up + passkeys).
**Dependencies**: `@simplewebauthn/server` + `@simplewebauthn/browser` (pin the same major). Password hashing uses Node `crypto.scrypt` — no native module.

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Account router + service + shell | A: `backend/src/api/routes/account.js`, `AccountService`, `frontend/src/app/admin/account/layout.tsx` | Security page replaces A's stub; new endpoints join the router |
| Auth.js config | `frontend/src/auth.ts` (providers, `jwt` / `session` callbacks, Prisma adapter), `auth.config.ts` (edge: Resend + Google), `lib/authJwt.ts` | Add a `password` Credentials provider and a `token-bridge` Credentials provider (passkey sign-in, secondary-email recovery) in `auth.ts` only — never in the edge config |
| Sign-in page | `frontend/src/app/auth/signin/page.tsx` | Gains password form + "Sign in with a passkey" + "Can't sign in?" link |
| `VerificationToken` | Auth.js table | Step-up email codes, bridge tokens, secondary-email verification, WebAuthn challenges (`identifier` prefixes below) |
| Rate limiter | `makeLimiter` | `ACCOUNT_REAUTH`, `PASSKEY_CEREMONY`, `ACCOUNT_RECOVERY` on Express; password sign-in is limited inside the Credentials `authorize` with a tiny in-memory window (Next side) until spec 020 phase 2 |
| Hashed IP | `LEGAL_IP_SALT` / `AUTH_SECRET` pattern in `LegalAcceptanceService` | `SecurityEvent.ipHash` |
| Email | `EmailService` | `sendSecurityNotice`, `sendReauthCode`, `sendSecondaryEmailVerification`, `sendRecoveryLink` |
| Dialog / summary UI | `SettingsDialog`, `SummaryRow` | Every Security card |

## 2. Schema

```prisma
model User {
  passwordHash             String?     // "scrypt$N$r$p$<salt b64>$<hash b64>"
  passwordUpdatedAt        DateTime?
  secondaryEmail           String?
  secondaryEmailVerifiedAt DateTime?
  passkeys                 Passkey[]
  securityEvents           SecurityEvent[]
}

model Passkey {
  id           String   @id @default(cuid())
  userId       String
  credentialId String   @unique        // base64url
  publicKey    Bytes
  counter      Int      @default(0)
  transports   String[]
  deviceType   String                  // singleDevice | multiDevice
  backedUp     Boolean  @default(false)
  aaguid       String?
  label        String                  // "MacBook · Chrome", editable
  createdAt    DateTime @default(now())
  lastUsedAt   DateTime?
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model SecurityEvent {                  // append-only, no updatedAt
  id        String   @id @default(cuid())
  userId    String
  type      String                     // PASSWORD_SET | PASSWORD_CHANGED | PASSWORD_REMOVED | PASSKEY_ADDED | PASSKEY_REMOVED | PROVIDER_DISCONNECTED | PROVIDER_CONNECTED | SECONDARY_EMAIL_ADDED | SECONDARY_EMAIL_VERIFIED | SECONDARY_EMAIL_REMOVED | EMAIL_CHANGED | REAUTH_OK | REAUTH_FAILED | SIGN_IN | …(C, D add theirs)
  ipHash    String?
  userAgent String?
  meta      Json?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
}
```

`VerificationToken.identifier` prefixes: `reauth:<userId>` (6-digit code, 10 min), `bridge:<userId>` (one-time sign-in token, 2 min), `secondary-email:<userId>` (link, 1 h), `webauthn-reg:<userId>` / `webauthn-auth:<challengeId>` (challenge, 5 min). Tokens stored hashed (sha256); codes compared with `timingSafeEqual`.

## 3. Step-up ("recent authentication") — the primitive everything else uses

- `POST /account/reauth/start` → `{ methods: ['password'|'passkey'|'email'] }` for the current user; when the method is `email`, sends the 6-digit code to the primary address. Limiter `ACCOUNT_REAUTH` (10 / 15 min per IP).
- `POST /account/reauth` body one of `{ password }`, `{ passkey: <assertion> }`, `{ code }` → verifies → returns `{ reauthToken, expiresAt }` — an HS256 JWT `{ typ: 'reauth', sub, jti, exp: +10 min }` signed with `AUTH_SECRET`. Failed attempts log `REAUTH_FAILED`; 5 failures / 15 min per user → 429.
- Middleware `requireRecentAuth` (`backend/src/middleware/recentAuth.js`): reads `X-Jump-Reauth`, verifies `typ`, `sub === req.user.id`, not expired → else 401 `REAUTH_REQUIRED`. Applied to every mutating Security endpoint below and, in A's router, to `POST /account/email` (email change becomes step-up-gated once B lands).
- Frontend `useReauth()` (`frontend/src/app/admin/account/security/useReauth.tsx`): holds the token in memory; `withReauth(fn)` runs `fn`, on 401 `REAUTH_REQUIRED` opens `ReauthDialog` (password / passkey / email code tabs), stores the token, retries once. `api.ts` sends `X-Jump-Reauth` when set.

## 4. Password

| Method | Path | Guard | Notes |
|---|---|---|---|
| POST | `/account/password` | `requireRecentAuth` | `{ password }` set or change; policy in `backend/src/utils/passwordPolicy.js`: 12–128 chars, ≠ email local part / full email, HIBP range check (`https://api.pwnedpasswords.com/range/<5>`; 2 s timeout, fail-open, env `HIBP_CHECK=false` disables). Hash `scrypt` N=2^15, r=8, p=1, 32-byte salt. Event `PASSWORD_SET` / `PASSWORD_CHANGED`; notice email; **revoke other sessions** via `SessionService.revokeOthers(userId, currentSid)` when D is present (guard with `if (SessionService)` until merged) |
| DELETE | `/account/password` | `requireRecentAuth` | Allowed always (magic link remains). Event + notice |

Auth.js `password` Credentials provider (`auth.ts`): `authorize({ email, password })` → `AccountService.verifyPassword` (`scrypt` compare, constant-time) → returns `{ id, email, name }`; a user without `passwordHash` fails identically to a wrong password. Sign-in page: email + password form under the magic-link form; error copy "Wrong email or password".

## 5. Passkeys

Own WebAuthn ceremony in Next route handlers (they need `AUTH_SECRET`, the RP origin and to call `signIn`), storage and listing on Express.

- `frontend/src/app/api/auth/passkey/register/options/route.ts` (signed-in only) → `generateRegistrationOptions({ rpID, rpName: 'Jump', userID: user.id, userName: email, excludeCredentials, authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' } })`; challenge stored via backend `POST /account/passkeys/challenge`.
- `…/register/verify` → `verifyRegistrationResponse` → backend `POST /account/passkeys` (`requireRecentAuth`) stores the credential; label from `ua-parser-js` (`"MacBook · Chrome"`).
- `…/login/options` (public) → `generateAuthenticationOptions({ rpID, allowCredentials: [] })` (discoverable credential); `…/login/verify` → `verifyAuthenticationResponse` against `Passkey` by `credentialId`, update `counter`, `lastUsedAt` → mint `bridge:<userId>` token → `signIn('token-bridge', { token })`.
- `rpID` = hostname of the first `FRONTEND_URL`; `expectedOrigin` = the `FRONTEND_URL` list. Custom storefront domains never host sign-in, so no per-tenant RP.
- Express: `GET /account/passkeys` (list: id, label, createdAt, lastUsedAt, deviceType, backedUp), `PATCH /account/passkeys/:id` `{ label }`, `DELETE /account/passkeys/:id` (`requireRecentAuth`), `POST /account/passkeys/challenge` + `GET /account/passkeys/challenge/:id` (challenge store). Limiter `PASSKEY_CEREMONY` (20 / 15 min per IP).
- Auth.js `token-bridge` Credentials provider: `authorize({ token })` → hash → `VerificationToken` lookup (`bridge:` prefix, single use) → user. Shared with secondary-email recovery.
- Security card "Passkeys (recommended)": list + *Add passkey* (browser prompt via `@simplewebauthn/browser` `startRegistration`) + rename + remove (confirm). Sign-in page: *Sign in with a passkey* button (`startAuthentication`, conditional UI `autocomplete="webauthn"` on the email field).

## 6. Connected accounts (Google)

- `GET /account/providers` — `Account` rows → `[{ provider, providerAccountId (masked), email? (from `id_token` claims if present), createdAt }]`. Tokens never serialized.
- `DELETE /account/providers/:provider` (`requireRecentAuth`) — deletes the row; best-effort `POST https://oauth2.googleapis.com/revoke?token=<refresh_token ?? access_token>` (ignore failures, log). Event `PROVIDER_DISCONNECTED` + notice. Confirmation copy: "You can still sign in with an email link to <primary>."
- Connect Google: card button → `signIn('google', { callbackUrl: '/admin/account/security' })`. Requires `allowDangerousEmailAccountLinking: true` on the Google provider (spec §9.3; Google verifies emails) so the adapter links to the existing user instead of `OAuthAccountNotLinked`. Event `PROVIDER_CONNECTED` written from `events.linkAccount` in `auth.ts`.

## 7. Secondary email

- `POST /account/secondary-email` (`requireRecentAuth`) `{ email }` — ≠ primary, not another user's primary or verified secondary (409); stores unverified, sends link `${FRONTEND_URL}/account/confirm-secondary-email?token=`.
- `POST /account/secondary-email/resend`, `DELETE /account/secondary-email` (`requireRecentAuth`, confirm), `POST /account/secondary-email/confirm` `{ token }` (public).
- Notices go to primary + verified secondary (`EmailService.sendSecurityNotice({ user, event })` resolves recipients).
- Recovery: `/auth/recover` page → `POST /account/recovery` (public, limiter `ACCOUNT_RECOVERY` 3 / h per IP, generic 200 always) — if the address is a *verified secondary*, email it a one-time link `/auth/recover/complete?token=` → `signIn('token-bridge')`. A primary address typed here is answered with the normal magic-link hint instead.

## 8. Frontend — Security page

`frontend/src/app/admin/account/security/page.tsx`, cards in this order:
1. **Passkeys (recommended)** — list / add / rename / remove.
2. **Password** — "Not set · Add password" or "Last changed <date> · Change · Remove".
3. **Connected accounts** — Google row with *Disconnect* / *Connect Google*.
4. **Secondary email** — copy from spec §6.4; add / pending (Resend · Cancel) / verified / remove.
5. **Two-step authentication** — stub card "Not available yet" until C.
6. **Devices** — stub until D.

All mutations run through `withReauth`. `ReauthDialog` explains "Confirm it's you" and offers only the methods the account has (+ email code always).

`api.ts`: `api.account.reauthStart()`, `.reauth(body)`, `.setPassword()`, `.removePassword()`, `.passkeys.list/rename/remove`, `.providers.list/disconnect`, `.secondaryEmail.add/resend/remove/confirm`, `.recovery(email)`.

## 9. Env / config
| Var | Where | Notes |
|---|---|---|
| `HIBP_CHECK` | backend | Optional. `false` skips the breach lookup (default on, fail-open) |
| `RATE_LIMIT_ACCOUNT_REAUTH_*`, `RATE_LIMIT_PASSKEY_CEREMONY_*`, `RATE_LIMIT_ACCOUNT_RECOVERY_*` | backend | Spec 020 overrides |
| `WEBAUTHN_RP_ID` | frontend (server) | Optional override; default host of first `FRONTEND_URL` / `NEXTAUTH_URL` |

Add rows to the root `AGENTS.md` env table.

## 10. Tests
- **Unit**: `passwordPolicy` (length, email, HIBP mocked fail-open), scrypt round-trip + constant-time mismatch, `recentAuth` middleware (expired / wrong sub / wrong typ), token hashing helpers.
- **Contract**: reauth start → email code → reauth → password set (notice sent, event written) → second call without header 401; passkey CRUD with a fixture credential; provider disconnect deletes row + revoke fetch mocked; secondary email add/confirm/remove + recovery generic response; `GET /account/providers` never returns `access_token`.
- **Auth.js**: vitest for `authorize` of `password` and `token-bridge` (Prisma mocked).
- **E2E**: sign-in with password; Security page reauth dialog → add password; passkey flow with Playwright's virtual authenticator (`CDPSession` `WebAuthn.addVirtualAuthenticator`); disconnect Google confirm.

## 11. Delivery slices
1. Schema (`Passkey`, `SecurityEvent`, password + secondary columns) + `SecurityEventService` + `EmailService.sendSecurityNotice`.
2. Step-up: `/account/reauth*`, `requireRecentAuth`, `ReauthDialog` + `withReauth`; gate A's email change.
3. Password: set / change / remove + Credentials provider + sign-in form.
4. Passkeys: route handlers, Express CRUD, card, sign-in button, `token-bridge`.
5. Connected accounts + secondary email + recovery.
6. Docs: wiki `account-security.md`, `backend/AGENTS.md` gotcha ("security mutations need `X-Jump-Reauth`; the bridge provider is the only way a non-Auth.js ceremony mints a session"), `specs/STATUS.md`.

## 12. Risks / notes
- Auth.js beta: `allowDangerousEmailAccountLinking` and `events.linkAccount` are stable in v5 beta.30; the WebAuthn *provider* is not used, so no experimental flag.
- The Credentials providers run in Next, so their rate limiting is process-local until spec 020 phase 2 moves sign-in limits to a shared store.
- If D merges first, wire `SessionService.revokeOthers` on password change / removal here; otherwise leave the guarded call and finish in D.
