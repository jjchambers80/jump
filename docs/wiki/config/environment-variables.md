# Environment Variables

**Last Updated**: 2026-09-25

Complete reference for every environment variable the Jump platform reads.

This page is the reference; the root [`AGENTS.md`](../../../AGENTS.md) table is the agent-facing
summary of the same facts. `backend/tests/unit/envVarDocs.test.js` fails the build when code
reads a `process.env.X` that is not listed here, so the two cannot drift apart silently. When you
add a variable, add a row here in the same commit.

## Ports (read this first)

The dev backend listens on **3002**, not 3000 — `backend/src/api/server.js` defaults `PORT` to
`3002`, `frontend/.env.local` ships `NEXT_PUBLIC_API_URL=http://localhost:3002`, and
`frontend/src/lib/legal.ts` / `frontend/src/middleware.ts` both fall back to it. The frontend
listens on **3001** (`next dev -p 3001`).

| Service | Port | Set by |
|---------|------|--------|
| Backend | 3002 | `PORT`, default `3002` |
| Frontend | 3001 | `PORT` on Railway; `-p 3001` in the `dev` / `start` scripts |

## Shared (packages/db, backend, frontend)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Format: `postgresql://user:pass@host:5432/dbname?schema=public`. Must be the same database across all three locations. |
| `NODE_ENV` | No | `development`, `test` or `production`. Default: development |

## Backend (backend/.env)

### Core

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | JWT signing secret (HS256). **Must match the frontend value exactly** |
| `PORT` | No | Server port. Default: **3002**. Must be set explicitly on Railway |
| `FRONTEND_URL` | Production | Comma-separated allowlist of frontend origins, used for CORS and email links. Outside production any `localhost` / `127.0.0.1` port is also allowed, so worktree previews need no env change. ACTIVE organization custom domains are allowed dynamically |
| `BACKEND_URL` | No | Public backend base URL for absolute image links in emails. Falls back to `https://$RAILWAY_PUBLIC_DOMAIN`, then `http://localhost:$PORT` |
| `REDIS_URL` | No | Redis connection string. Default: `redis://localhost:6379`. Connects lazily and never under test |
| `LOG_LEVEL` | No | Pino level for `backend/src/utils/logger.js`. Default: `info` |

### Payments (Stripe)

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes | Stripe API secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret (`whsec_...`). Get from `stripe listen` CLI output locally |
| `STRIPE_CONNECT_ENABLED` | No | `true` turns on Stripe Connect payouts (spec 010 phase 2): organizations with an active connected account receive destination charges. Default off — the migration and code deploy dark |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | With Connect | Signing secret for the *Connect* webhook endpoint (`POST /webhooks/stripe/connect`, "listen to events on connected accounts"). Different from `STRIPE_WEBHOOK_SECRET`; unset = unverified (dev/test only) |
| `BILLING_ENABLED` | No | `true` turns on Jump subscriptions (spec 022 phase 2): the subscribe step in `/signup` and Settings › Plan. Needs `JUMP_STARTER_PRICE_ID`; without it billing stays off (warning at startup) |
| `JUMP_STARTER_PRICE_ID` | With billing | Stripe Price id (`price_...`) of the STARTER plan in Jump's own account |
| `BILLING_TRIAL_DAYS` | No | Free-trial length offered at signup (default 30; 0 = no trial) |
| `STRIPE_BILLING_WEBHOOK_SECRET` | With billing | Signing secret for `POST /webhooks/stripe/billing` (subscription events). Same account as `STRIPE_WEBHOOK_SECRET`, separate endpoint; unset = unverified (dev/test only) |

### Email

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | Yes | Resend email API key (`re_...`) |
| `RESEND_FROM_EMAIL` | No | `From:` on every transactional email the backend sends (tickets, refunds, digests). Default: `Jump <noreply@jump.events>`. The production value needs a verified Resend domain |

### Orders, applications and booths

| Variable | Required | Description |
|----------|----------|-------------|
| `APPLICATIONS_PAYMENTS_ENABLED` | No | `true` lets PAID application forms (vendor / sponsor tiers) open: card on file at submission, off-session charge at approval, pay-now, refunds (spec 011 phase 2). Default off: FREE forms only |
| `APPLICATION_SWEEP_INTERVAL_MS` | No | Interval for the overdue pay-now sweep (default 1 h; first run 30 s after boot) |
| `BOOTH_HOLD_MS` | No | Approved-vendor booth hold lifetime (default 15 min). Expiry never releases a hold while its application payment is `PROCESSING` |
| `BOOTH_SWEEP_INTERVAL_MS` | No | Expired booth-hold sweep interval (default 1 min) |
| `ORDER_MAX_PENDING_PER_CONTACT` | No | Open (PENDING) ticket checkouts one email may hold on one event before `POST /orders` answers 409 (default 3) |
| `ORDER_SWEEP_INTERVAL_MS`, `ORDER_SWEEP_GRACE_MS` | No | Abandoned-checkout sweep: how often (default 5 min; first run 60 s after boot) and how long past the 30-minute Checkout session a PENDING order may sit before Stripe is asked (default 5 min); expired → `failOrder` releases the hold, paid-but-missed → completed |
| `RSVP_REMINDER_SWEEP_INTERVAL_MS` | No | Interval for the RSVP reminder sweep (default 1 h). RSVP events use `EventRsvp` rows, never Orders |
| `ONBOARDING_SWEEP_INTERVAL_MS` | No | Abandoned-signup sweep interval (default 1 h) |
| `ONBOARDING_ABANDON_AFTER_MS` | No | Unfinished signups older than this with no events and no subscription are deleted (default 7 d) |

### Auth, sessions and abuse protection

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SWEEP_INTERVAL_MS` | No | Deletes revoked / 30-day-idle `UserSession` rows (default 24 h) |
| `TWO_STEP_TRUST_DAYS` | No | "Remember this device" lifetime for two-step (default 30). Also read by the frontend (spec 030 C) |
| `HIBP_CHECK` | No | `false` skips the Have I Been Pwned range check when a password is set. Default on, fail-open (spec 030 B) |
| `WEBAUTHN_RP_ID` | No | Passkey relying-party id. Default: host of the first `FRONTEND_URL` |
| `GEOIP_ENABLED` | No | `true` resolves city/region/country for Account › Security › Devices via `geoip-lite` (install it in the backend workspace). Default off → "Location unavailable" (spec 030 D) |
| `SCANNER_API_KEY` | No | Shared key for hardware ticket readers calling `POST /tickets/scan` / `/redeem` via `X-Scanner-Key`. Unset: only staff sessions can scan |
| `RATE_LIMIT_<NAME>_LIMIT`, `RATE_LIMIT_<NAME>_WINDOW_MS` | No | Per-limiter overrides (spec 020), read dynamically by name: `BASELINE` (600 / 5 min, skips `/health`, `/metrics`, `/webhooks/*`), `ORDER_CREATE` (10 created orders / 15 min per IP), `ORDER_LOOKUP` (10 / 15 min), `ORDER_VERIFY` (60 / 15 min), `SCANNER_AUTH` (10 failed scanner sign-ins / 15 min), `DOMAIN_RESOLVE` (120 / min), `BUYER_AUTH_REQUEST` (20 / h), `APPLICATION_SUBMIT` (30 / h), `BOOTH_CHOOSE` (10 / min). Keyed on the signed `X-Jump-Client-Ip`, else `req.ip`; refused requests count in `rate_limited_total{route}` |
| `RATE_LIMIT_ENFORCE_IN_TESTS` | No | `1` makes the limiters real under `NODE_ENV=test` (the abuse-protection suite sets it); otherwise every limiter is a pass-through in tests |

### Legal and consent

| Variable | Required | Description |
|----------|----------|-------------|
| `LEGAL_ACCEPTANCE_REQUIRED` | No | `true` makes `POST /orders` refuse a checkout without current `acceptances` (400 `LEGAL_ACCEPTANCE_REQUIRED`). Default off until the legal pages go live (spec 023 phase 1); a stale version is always refused (`LEGAL_VERSION_STALE`). The apply form always requires them |
| `LEGAL_IP_SALT` | No | Salt for the hashed IP on `LegalAcceptance` rows; falls back to `AUTH_SECRET`. The raw IP is never stored |

### Images and file storage

| Variable | Required | Description |
|----------|----------|-------------|
| `BUCKET_NAME`, `BUCKET_ENDPOINT`, `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY`, `BUCKET_REGION` | No | S3-compatible image storage (Railway Bucket). Unset → local `uploads/` disk, which is **ephemeral on Railway** |
| `BUCKET_PUBLIC_URL` | No | Only set for a public bucket / CDN; otherwise images are served through `GET /images/:id/:hash/:variant` |

### Custom domains

| Variable | Required | Description |
|----------|----------|-------------|
| `STOREFRONT_CNAME_TARGET` | No | Hostname organizations CNAME their storefront domain to. Default: host of the first `FRONTEND_URL` (spec 007 phase 3) |
| `PLATFORM_HOSTS` | No | Comma-separated platform hostnames that must never resolve as a tenant storefront. `localhost` and `*.up.railway.app` are always platform |
| `DOMAIN_SWEEP_INTERVAL_MS` | No | Custom-domain re-check interval (default 10 min) |
| `DOMAIN_VERIFY_COOLDOWN_MS` | No | Minimum gap between user-initiated "I updated DNS records" checks (default 15 s; tests use 0) |
| `RAILWAY_API_TOKEN`, `RAILWAY_FRONTEND_SERVICE_ID` | No | With Railway-injected `RAILWAY_PROJECT_ID` + `RAILWAY_ENVIRONMENT_ID`, lets the backend attach verified custom domains to the frontend service for TLS. Unset: domains activate on DNS proof and TLS must be added in the Railway dashboard |
| `RAILWAY_API_URL` | No | Railway GraphQL endpoint override. Default: `https://backboard.railway.com/graphql/v2`. Only useful for tests and mocks |

## Frontend (frontend/.env.local)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (for the Auth.js PrismaAdapter in server components) |
| `AUTH_SECRET` | Yes | JWT signing secret. **Must match the backend value exactly** |
| `NEXT_PUBLIC_API_URL` | Yes | Backend API base URL. `http://localhost:3002` locally, the Railway domain in production. Build-time |
| `PORT` | No | Frontend port. Default: 3001. Must be set explicitly on Railway |
| `NEXT_PUBLIC_APP_URL` | No | Public frontend base URL. Its hostname counts as a platform host alongside `AUTH_URL` / `NEXTAUTH_URL` and `NEXT_PUBLIC_PLATFORM_HOSTS`. Build-time |
| `NEXT_PUBLIC_PLATFORM_HOSTS` | No | Comma-separated platform hostnames the tenant middleware must never treat as a storefront. Build-time |
| `AUTH_RESEND_KEY` | No | Resend key for Auth.js magic-link emails |
| `AUTH_RESEND_FROM` | No | `From:` on Auth.js magic-link emails. Default: `onboarding@resend.dev`, which is Resend's shared sandbox sender — set a verified domain before launch |
| `AUTH_GOOGLE_ID` | No | Google OAuth client ID (for Google sign-in) |
| `AUTH_GOOGLE_SECRET` | No | Google OAuth client secret |
| `SECURITY_CONTACT_EMAIL` | No | Serves RFC 9116 `/.well-known/security.txt` with this `Contact:` address (spec 023 phase 0); unset → 404 until the `security@` mailbox exists. The route is `force-dynamic`, so this takes effect on restart without a rebuild |
| `TWO_STEP_TRUST_DAYS` | No | "Remember this device" lifetime shown in the two-step UI (default 30). Keep equal to the backend value |
| `NEXT_PUBLIC_BILLING_ENABLED` | No | `true` shows Settings › **Plan** in the settings nav (must match the backend's `BILLING_ENABLED`). Build-time |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | With billing | Jump's account publishable key (`pk_...`); mounts embedded Checkout on the subscribe step and Settings › Plan. Build-time |
| `NEXT_PUBLIC_LEGAL_PAGES_ENABLED` | No | `true` renders `/legal/<slug>` from `frontend/content/legal/<slug>.md` and links the consent texts on checkout / apply to `/legal/terms` and `/legal/privacy` (spec 023). Default off: those paths 404 and the texts show without links. Build-time |
| `NEXT_PUBLIC_GEOIP_ENABLED` | No | `true` shows the location column on Account › Security › Devices (must match the backend's `GEOIP_ENABLED`). Build-time |

`AUTH_URL` / `NEXTAUTH_URL` are consumed by Auth.js itself; Jump only reads their hostnames when
computing platform hosts.

## Railway-injected (do not set by hand)

| Variable | Description |
|----------|-------------|
| `RAILWAY_PUBLIC_DOMAIN` | Fallback for `BACKEND_URL` when it is unset |
| `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID` | Required alongside `RAILWAY_API_TOKEN` for automatic custom-domain TLS |

## Script-only

| Variable | Description |
|----------|-------------|
| `DRY_RUN` | `npm run db:backfill:event-descriptions` previews by default; `DRY_RUN=false` writes (spec 026) |
| `VIEWER_ZONE` | Viewer time zone for the spec 033 venue time-zone report (`npm run report:033`). Default: `America/New_York` |

## Critical Constraints

1. **AUTH_SECRET** must be identical in `backend/.env` and `frontend/.env.local`. Mismatch causes silent JWT verification failures.
2. **DATABASE_URL** should point to the same PostgreSQL database in all three locations (packages/db, backend, frontend).
3. **STRIPE_WEBHOOK_SECRET** is different for local development (`stripe listen` CLI) vs production (Stripe Dashboard webhook settings).
4. **`NEXT_PUBLIC_*` variables are baked into the client bundle at build time.** Changing one on Railway does nothing until the frontend is rebuilt. Every row above marked *Build-time* has this property.
5. **Paired flags must match across services**: `BILLING_ENABLED` / `NEXT_PUBLIC_BILLING_ENABLED`, `GEOIP_ENABLED` / `NEXT_PUBLIC_GEOIP_ENABLED`, and `TWO_STEP_TRUST_DAYS` on both sides.

## Local Development Setup

```bash
# Generate secrets
openssl rand -base64 32  # Use for AUTH_SECRET

# Stripe CLI for webhook forwarding — the backend is on 3002
# (add --forward-connect-to only when testing Connect)
stripe listen --forward-to localhost:3002/webhooks/stripe \
  --forward-connect-to localhost:3002/webhooks/stripe/connect
# Copy the whsec_... output to STRIPE_WEBHOOK_SECRET (the CLI uses one secret for both)
```

In a fresh worktree run `./scripts/bootstrap-worktree.sh` first — it copies the gitignored env
files from the primary checkout. Without `backend/.env` the test suite falls back to
`postgres:postgres@localhost:5432` and every contract test fails with `P1000`.

## Production (Railway)

Set all variables via the Railway dashboard or CLI. Additionally:
- `PORT` must be explicitly set on both services
- `FRONTEND_URL` on the backend for CORS
- `NEXT_PUBLIC_API_URL` on the frontend pointing to the backend Railway domain
- Changing any `NEXT_PUBLIC_*` value requires a frontend redeploy, not just a restart
