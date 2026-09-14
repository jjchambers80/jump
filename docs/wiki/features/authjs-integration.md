# Auth.js Integration

**Status:** Implemented
**Last Updated:** 2026-09-13

## Overview

Auth.js v5 (next-auth 5.0.0-beta.30) handles authentication on the frontend using PrismaAdapter. Supports Google OAuth and email magic links (via Resend). Uses JWT strategy (HS256) with no database sessions. The session callback injects an accessToken used for backend API calls. The backend verifies JWTs from the `Authorization: Bearer` header. A dev-only credentials provider exists for testing.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/auth.ts` | Auth.js configuration, providers, callbacks |
| `backend/src/middleware/auth.js` | JWT verification middleware for backend routes |

## Configuration

| Variable | Description |
|----------|-------------|
| `AUTH_SECRET` | Shared secret for JWT signing/verification (must match across frontend and backend) |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `AUTH_RESEND_KEY` | API key for Resend email provider (magic links) |

## How It Works

1. User authenticates via Google OAuth or email magic link on the frontend.
2. Auth.js creates a JWT (HS256) containing user claims: `role`, `name`, `email`, first membership `organizationId`, and `claimsRefreshedAt`.
3. The session callback injects an `accessToken` into the session object.
4. Frontend attaches the token as `Authorization: Bearer <token>` on API requests.
5. Backend `auth.js` middleware extracts and verifies the JWT using the shared `AUTH_SECRET`.
6. Verified user context is attached to the request for downstream handlers.

## Gotchas

- **Cookie codec lives in `auth.config.ts`** (`lib/authJwt.ts`, `jose` HS256) so `src/middleware.ts` can decode sessions on the edge and redirect unauthenticated `/admin*`. `auth.ts` only adds the Prisma adapter, the dev credentials provider, and the backend `accessToken`. Tokens are interchangeable with `jsonwebtoken`-signed ones (same alg, claims, secret bytes), so existing sessions survived the switch.
- **Middleware must not include the email provider.** It requires an adapter; on the edge `Auth()` throws `MissingAdapter` and the protection silently no-ops. `src/middleware.ts` filters it out.

- **Auth.js is staff-only.** Buyers sign in with single-use emailed links and a separate `jump_buyer` cookie (`typ: 'buyer'` JWT) — see [Buyer Accounts](buyer-accounts.md). `middleware/auth.js` rejects buyer tokens and `requireBuyer` rejects staff tokens even though both use `AUTH_SECRET`.
- **JWT claims refresh every 60 s.** The `jwt` callback reloads `role`/`name`/`email`/first-membership `organizationId` from `User` whenever `claimsRefreshedAt` is older than `CLAIMS_REFRESH_MS` (`lib/sessionClaims.ts`), and returns `null` (cookie cleared) for a missing or soft-deleted user. Before this, a role change needed a sign-out; a stale `ADMIN` token made a promoted `SYSTEM_ADMIN` see an empty org switcher. The backend still treats `organizationId` as a preference and re-verifies it against memberships in `resolveOrgScope` — see [Org Switcher](org-switcher.md).

- `AUTH_SECRET` must be identical across frontend and backend services. Mismatch causes JWT verification to fail silently.
- The credentials provider is dev-only and must not be enabled in production.
- No database sessions are used — all session state lives in the JWT.
- PrismaAdapter is used for user/account persistence, not session storage.

## Related Features

- [RBAC](rbac.md) — role-based access control built on top of authenticated sessions.
- [Admin Dashboard](admin-dashboard.md) — requires authenticated organizer/admin sessions.
