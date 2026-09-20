# Implementation Plan: Account settings › Security — Devices (spec 030, feature D)

**Status**: Built 2026-09-20 on `feat/030-account-devices` (see `docs/wiki/features/devices-sessions.md`). Deviations: device/location columns are filled by the **backend** `SessionService.touch` on API calls (no Next-layout touch — the browser talks to the backend directly, so the real IP and UA are there); `geoip-lite` lives in the backend workspace; Redis made lazy + fail-fast because the cache joined the auth path.
**Branch / worktree**: `feat/030-account-devices` at `.claude/worktrees/030-account-devices`, based on `feat/030-account-general` (rebase onto `main` once A merges). Independent of B and C; B / C call `SessionService.revokeOthers` once this lands.
**Spec**: [`spec.md`](./spec.md) §6.6.
**Dependencies**: `ua-parser-js` (backend). Optional `geoip-lite` (backend; bundled MaxMind GeoLite2, CC BY-SA 4.0 — attribution line on the Devices card).

---

## 1. What exists and is reused

| Piece | Where | Reuse |
|---|---|---|
| Stateless JWT session | `frontend/src/lib/authJwt.ts` (encode/decode), `auth.ts` `jwt` callback (60 s claims refresh via `sessionClaims.ts`), `auth.config.ts` (edge decode) | Add a `sid` claim; the refresh path becomes the frontend revocation check |
| Backend auth | `backend/src/middleware/auth.js` `requireAuth` | Revocation check on every request |
| Redis cache | `backend/src/utils/cache.js` (`cacheGet` / `cacheSet`, fail-open) | 60 s cache of `sid → revoked?` to avoid a DB hit per request |
| Client IP | `backend/src/utils/clientIp.js` `clientIpForRateLimit` (trust proxy 1) | Same IP for geo + `ipHash` |
| Hashed IP | `LEGAL_IP_SALT` pattern | `UserSession.ipHash` — raw IP never stored |
| Admin layout | `frontend/src/app/admin/layout.tsx` (server) | Touches the session row (UA, IP, lastSeen) |
| Security events / notices | B (`SecurityEvent`, `sendSecurityNotice`) — if B is not merged yet, D adds `SecurityEvent` itself with the same definition and B rebases | `SESSION_REVOKED`, `SESSIONS_REVOKED_ALL` |
| Shell + Devices stub | A / B: Security page card | Card replaces the stub |

## 2. Schema

```prisma
model UserSession {
  id          String    @id @default(cuid())   // = JWT `sid`
  userId      String
  createdAt   DateTime  @default(now())
  lastSeenAt  DateTime  @default(now())
  revokedAt   DateTime?
  revokedBy   String?                            // 'user' | 'logout-all' | 'password-change' | 'two-step' | 'sign-out'
  userAgent   String?
  deviceType  String?                            // desktop | mobile | tablet | unknown
  os          String?
  browser     String?
  ipHash      String?
  city        String?
  region      String?
  country     String?                            // ISO 3166-1 alpha-2
  provider    String?                            // how it signed in: resend | google | password | passkey | recovery
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, revokedAt])
  @@index([lastSeenAt])
}
```
Retention: a daily sweep deletes rows with `revokedAt < now − 30 d` or `lastSeenAt < now − 30 d` (the JWT lifetime).

## 3. Session lifecycle

1. **Mint.** `auth.ts` `jwt` callback, fresh sign-in (`user` set): `SessionService`-equivalent Prisma call in Next — `prisma.userSession.create({ userId, provider: account?.provider })` → `token.sid`. (`account` is available in the `jwt` callback on sign-in.) `authJwt.ts` encodes `sid`; `session` callback exposes `session.sid`; backend `req.user.sid`.
2. **Adopt legacy tokens.** Refresh path (`shouldRefreshClaims`) with no `token.sid`: create a row, set `sid`. Old cookies therefore appear in Devices within a minute of use.
3. **Touch.** `frontend/src/app/admin/layout.tsx` (server component, already wrapping every admin page): `touchSession(sid, headers())` — throttled: only when `lastSeenAt` is older than 5 min (cheap `updateMany … where lastSeenAt < now − 5 min`); fills `userAgent` / `deviceType` / `os` / `browser` (`ua-parser-js`), `ipHash`, and geo from `x-forwarded-for`. Lives in `frontend/src/lib/sessionTouch.ts` (Prisma via `@jump/db`, server-only). UA parsing and geo run here, where the request headers are; the backend only serializes the stored columns.
4. **Revoke.** `SessionService.revoke(userId, sid, by)`, `revokeOthers(userId, currentSid, by)`, `revokeAll(userId, by)` set `revokedAt` and `cacheSet('sid:revoked:<sid>', true, 60)`… the cache is a *positive* revocation hint; the authoritative read is the row.
5. **Enforce — backend.** `requireAuth`: if `decoded.sid` → `SessionService.isRevoked(sid)` (Redis `sid:<sid>` → `{ revoked }` cached 60 s, else DB) → 401 `SESSION_REVOKED`. Tokens without `sid` (legacy, ≤ 60 s window) pass. Fail-open on Redis errors to the DB read, never on DB errors (throw → 500 like any DB outage).
6. **Enforce — frontend.** `loadUserClaims` also selects the session row by `token.sid`; `revokedAt` set → return `null` → Auth.js drops the cookie on the next request (≤ 60 s). `middleware.ts` is edge and stays DB-free; the `/admin` server layout additionally calls `auth()` and, when the API client receives `SESSION_REVOKED`, `api.ts` calls `signOut({ callbackUrl: '/auth/signin?reason=revoked' })`.
7. **Sign out.** `signOut` → `events.signOut` in `auth.ts` revokes the row (`by: 'sign-out'`) so it disappears from Devices immediately.

## 4. Endpoints (`/account/sessions*`, `requireAuth`)

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/account/sessions` | — | Active rows (`revokedAt null`, `lastSeenAt > now − 30 d`) ordered current first then `lastSeenAt desc`: `{ id, current, device: { type, os, browser, label }, lastSeenAt, createdAt, location: { city, region, country } \| null, provider }` |
| DELETE | `/account/sessions/:id` | `requireRecentAuth` when B is present, else plain | Must belong to the user (404 otherwise). Revoking the **current** session is allowed but the UI confirms "This will sign you out here" and follows with `signOut()` |
| POST | `/account/sessions/revoke-others` | same | Keeps `req.user.sid`; returns `{ revoked: n }`; event `SESSIONS_REVOKED_ALL` + notice |

`SessionService` (`backend/src/services/SessionService.js`): `list`, `revoke`, `revokeOthers`, `revokeAll`, `isRevoked`, `sweep`. `sweep` wired into the existing interval pattern (`ORDER_SWEEP_INTERVAL_MS` style) as `SESSION_SWEEP_INTERVAL_MS` (default 24 h).

## 5. Geo + device labelling

- `frontend/src/lib/sessionTouch.ts`: `ua-parser-js` → `deviceType` (`device.type ?? 'desktop'`), `os.name`, `browser.name`; label `"${os} · ${browser}"` (e.g. "macOS · Chrome", "iOS · Safari").
- Geo: `GEOIP_ENABLED=true` → `geoip-lite.lookup(ip)` → `{ city, region, country }` (empty strings → null). Private / loopback IPs → null. Off → null → UI "Location unavailable". `geoip-lite` is an `optionalDependency` of the frontend workspace (it runs in the Next server), loaded lazily with `await import()` inside a try so a missing module never breaks the layout. Attribution: "Location data by MaxMind GeoLite2" under the Devices card when enabled (`NEXT_PUBLIC_GEOIP_ENABLED`).

## 6. Frontend — Devices card

`frontend/src/app/admin/account/security/DevicesCard.tsx` (replaces the stub): copy from spec §6.6; rows with device icon (lucide `Monitor` / `Smartphone` / `Tablet`), label, **This device** badge, "Last active <relative>", "<City>, <Region>, <Country>" or "Location unavailable", **Log out** (confirm; current device → confirm + `signOut`). Footer button **Log out all other devices** (confirm: "You'll stay signed in on this device."). Empty state (only this device): "You're only signed in on this device." Relative times via A's `useAccountFormat()`.

`api.ts`: `api.account.sessions.list()`, `.revoke(id)`, `.revokeOthers()`. `api.ts` also maps 401 `SESSION_REVOKED` → `signOut`.

## 7. Env / config
| Var | Where | Notes |
|---|---|---|
| `GEOIP_ENABLED` / `NEXT_PUBLIC_GEOIP_ENABLED` | frontend | Optional. Enables GeoLite2 lookup + attribution. Default off → "Location unavailable" |
| `SESSION_SWEEP_INTERVAL_MS` | backend | Optional. Default 24 h |

Add to the root `AGENTS.md` env table.

## 8. Tests
- **Unit**: `SessionService.isRevoked` cache hit / miss / Redis error fallback; `requireAuth` 401 on revoked `sid`, pass on legacy token; `sessionTouch` throttle + UA parsing + geo off/on (module mocked); sweep boundaries.
- **Contract**: sign-in fixture with `sid` → list shows current first; revoke other → 401 on that token immediately; revoke-others keeps current; another user's session id → 404; revoke current then request → 401 `SESSION_REVOKED`.
- **Frontend unit** (vitest): `jwt` callback creates a row on sign-in, adopts a legacy token on refresh, returns `null` when revoked; `encodeSessionToken` round-trips `sid`.
- **E2E**: Devices card renders stubbed rows; log out one (confirm) removes the row; log out all others shows the count; current-device log out lands on sign-in.

## 9. Delivery slices
1. Schema + `sid` plumbing (`authJwt`, `sessionClaims`, `jwt` callback create/adopt, `events.signOut`), backend `requireAuth` revocation check + `SessionService`. Ship dark: nothing revokes yet.
2. `sessionTouch` in the admin layout (UA, IP hash, geo behind the flag) + sweep.
3. Endpoints + Devices card + `api.ts` revoked handling.
4. Hooks for B / C: export `revokeOthers` and document the call sites (password change / removal, 2FA enable) — wire whichever of B / C is already on `main`.
5. Docs: wiki `devices-sessions.md`, `backend/AGENTS.md` ("`req.user.sid` may be undefined for legacy tokens for ≤ 60 s after deploy; never require it"), `specs/STATUS.md`.

## 10. Risks / notes
- Revocation latency on the cookie side is ≤ 60 s by design (edge middleware cannot read the DB); the API side is immediate. The Devices copy says "Signed out" as soon as the row is revoked, which is true for every API call.
- `geoip-lite` adds ~60 MB to the frontend image and the GeoLite2 data ages; if that is unwanted, the alternative is an `ipinfo.io` token (`IPINFO_TOKEN`) with the same `{ city, region, country }` shape — one adapter file either way.
- Railway sets `x-forwarded-for`; the frontend `sessionTouch` takes the first hop exactly as `clientIpForRateLimit` does on the backend (copy the parsing, do not import across workspaces).
