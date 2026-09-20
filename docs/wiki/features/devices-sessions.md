# Account Settings › Security › Devices

**Status:** Implemented (spec 030 feature D)
**Last Updated:** 2026-09-20

## Overview

Every browser signed in to a Jump staff account is a `UserSession` row, and the session JWT carries the row id as `sid`. Account › Security › Devices lists them (device label from the user agent, "This device", last active, approximate location or "Location unavailable") with **Log out** per device and **Log out all other devices**. Revocation is real: the backend refuses a revoked `sid` on the next request, the browser that made the request signs itself out with a notice, and the cookie of a device that makes no request is dropped by the next Auth.js claims refresh (≤ 60 s).

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | `UserSession` (`revokedAt`, `revokedBy`, `userAgent`, `deviceType`/`os`/`browser`, `ipHash`, `city`/`region`/`country`, `provider`), `SecurityEvent` (append-only audit trail). Migration `20260930700000_account_devices` |
| `frontend/src/lib/userSessions.ts` | `resolveSessionId` (new row on sign-in, keep a live `sid`, adopt legacy tokens, `null` when revoked), `revokeSessionOnSignOut` |
| `frontend/src/auth.ts` | `jwt` callback calls `resolveSessionId` and returns `null` (cookie cleared) for a revoked row; `session` callback puts `sid` in the Bearer token and `session.sid`; `events.signOut` revokes the row |
| `frontend/src/lib/authJwt.ts`, `sessionClaims.ts` | `sid` claim encode/decode |
| `backend/src/middleware/auth.js` | `requireAuth`: `sid` present → `SessionService.isRevoked` → 401 `SESSION_REVOKED`; otherwise `touch` (fire-and-forget); `req.user.sid` |
| `backend/src/services/SessionService.js` | `isRevoked` (process cache 60 s → Redis 60 s → DB), `touch` (≤ 1 write / 5 min / session: `lastSeenAt`, UA parts via `ua-parser-js`, salted `ipHash`, geo), `list`, `revoke`, `revokeOthers`, `revokeAll`, `sweep`; `describeUserAgent`, `deviceLabel`, `hashSessionIp` |
| `backend/src/services/SecurityEventService.js` | `record(userId, type, { req, meta })` — `SESSION_REVOKED`, `SESSIONS_REVOKED_ALL` (B and C add theirs) |
| `backend/src/utils/geoip.js` | `lookupGeo(ip)` — `null` unless `GEOIP_ENABLED=true` and `geoip-lite` is installed; private ranges always `null` |
| `backend/src/utils/redis.js`, `cache.js` | Redis is now **lazy** (`lazyConnect`, never under test) and every cache call fails open fast unless `redis.status === 'ready'` |
| `backend/src/api/routes/account.js` | `GET /account/sessions`, `DELETE /account/sessions/:id`, `POST /account/sessions/revoke-others` (keeps the current one; security notice email) |
| `backend/src/api/server.js` | Daily `SessionService.sweep()` (`SESSION_SWEEP_INTERVAL_MS`) |
| `frontend/src/app/admin/account/security/DevicesCard.tsx` | The card; `relativeTime`, `locationLabel` |
| `frontend/src/services/api.ts` | 401 `SESSION_REVOKED` → `signOut({ callbackUrl: '/auth/signin?reason=revoked' })` (once) |
| `frontend/src/app/auth/signin/page.tsx` | `?reason=revoked` notice |

## Configuration

| Variable | Where | Notes |
|---|---|---|
| `GEOIP_ENABLED` | backend | `true` enables GeoLite2 lookups. Also run `npm install -w backend geoip-lite` (≈ 60 MB, CC BY-SA 4.0). Default off → "Location unavailable" |
| `NEXT_PUBLIC_GEOIP_ENABLED` | frontend | `true` shows the MaxMind attribution line under the card. Build-time |
| `SESSION_SWEEP_INTERVAL_MS` | backend | Default 24 h. Rows revoked or idle for more than 30 d (the JWT lifetime) are deleted |
| `LEGAL_IP_SALT` | backend | Reused as the salt for `UserSession.ipHash` (falls back to `AUTH_SECRET`) |

## How It Works

### Session lifecycle

1. **Sign-in** (any provider): the `jwt` callback receives `user` + `account` → `resolveSessionId(userId, undefined, { signIn: true, provider })` creates a row → `token.sid`.
2. **Legacy token** (no `sid`): on its next claims refresh a row is created and adopted; device columns are empty until the first API call.
3. **Every backend request**: `requireAuth` checks `isRevoked(sid)`; a hit returns 401 `SESSION_REVOKED`. Otherwise `touch(sid, req)` records `lastSeenAt`, user-agent parts, hashed IP and geo, throttled to one write per 5 min per session.
4. **Revoke**: `SessionService.revoke*` sets `revokedAt` and primes the process + Redis caches, so the *next* request from that device is refused even before the cache TTL.
5. **Frontend**: `loadUserClaims` runs at most every 60 s; when `resolveSessionId` sees `revokedAt`, the callback returns `null` and Auth.js clears the cookie. A browser that hits the API sooner is signed out by `api.ts`.
6. **Sign out**: `events.signOut` revokes the row (`revokedBy: 'sign-out'`).

### Copy

*"You're currently logged in to Jump on these devices. If you don't recognize a device, log out to keep your account secure."* — "Log out all other devices" confirms *"You'll stay signed in on this device."*

### Hooks for B and C

`SessionService.revokeOthers(userId, currentSid, by)` is what password change / removal (B) and enabling two-step (C) call, with `by` = `'password-change'` / `'two-step'`.

## Testing

- `backend/tests/unit/sessionService.test.js` — UA labels, IP hash, cache layers, revoke primes caches.
- `backend/tests/contract/accountSessions.test.js` — legacy token passes; list order + labels; revoke other → immediate 401; revoke-others keeps current + notice; foreign id 404; current-device revoke; missing row refused.
- `frontend/tests/unit/{userSessions,authJwt}.test.ts` — `resolveSessionId` cases with a mocked Prisma; `sid` codec round-trip.
- `frontend/e2e/account-devices.spec.ts` — list, log out one / all others / this device, dismiss, `SESSION_REVOKED` sign-out, axe.

## Gotchas

- `req.user.sid` is `null` for tokens minted before this shipped and for the test helper's tokens (`signToken` without `sid`). Never require it.
- Revocation latency for a browser that makes no request is up to 60 s; the copy says "logged out" because the API side is immediate.
- `isRevoked` treats a **missing** row as revoked, so a `sid` must always point at a real row — the sweep deletes only rows that cannot authenticate anyway.
- The Redis client no longer connects at import. Anything that wants Redis goes through `utils/cache.js`, which starts the connection on first use.

## Related

- Spec: `specs/030-account-settings/spec.md`, plan `plan-devices.md`
- [Account Settings › General](account-settings.md)
- [Org Switcher](org-switcher.md) — the 60 s claims refresh
