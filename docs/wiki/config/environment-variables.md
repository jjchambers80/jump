# Environment Variables

**Last Updated**: 2026-09-07

Complete reference for all environment variables used by the Jump platform.

## Shared (packages/db, backend, frontend)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Format: `postgresql://user:pass@host:5432/dbname?schema=public`. Must be the same database across all three locations. |

## Backend (backend/.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | JWT signing secret (HS256). **Must match frontend value exactly** |
| `STRIPE_SECRET_KEY` | Yes | Stripe API secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret (`whsec_...`). Get from `stripe listen` CLI output locally |
| `RESEND_API_KEY` | Yes | Resend email API key (`re_...`) |
| `PORT` | No | Server port. Default: 3000. Must be set explicitly on Railway |
| `NODE_ENV` | No | `development` or `production`. Default: development |
| `FRONTEND_URL` | Production | Frontend URL for CORS and email links. e.g., `https://frontend.up.railway.app` |
| `REDIS_URL` | No | Redis connection string. Default: `redis://localhost:6379` |

## Frontend (frontend/.env.local)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (for Auth.js PrismaAdapter in server components) |
| `AUTH_SECRET` | Yes | JWT signing secret. **Must match backend value exactly** |
| `NEXT_PUBLIC_API_URL` | Yes | Backend API base URL. `http://localhost:3000` locally, Railway domain in production |
| `AUTH_RESEND_KEY` | No | Resend key for Auth.js magic link emails |
| `AUTH_GOOGLE_ID` | No | Google OAuth client ID (for Google sign-in) |
| `AUTH_GOOGLE_SECRET` | No | Google OAuth client secret |
| `PORT` | No | Frontend port. Default: 3001. Must be set explicitly on Railway |

## Critical Constraints

1. **AUTH_SECRET** must be identical in `backend/.env` and `frontend/.env.local`. Mismatch causes silent JWT verification failures.
2. **DATABASE_URL** should point to the same PostgreSQL database in all three locations (packages/db, backend, frontend).
3. **STRIPE_WEBHOOK_SECRET** is different for local development (`stripe listen` CLI) vs production (Stripe Dashboard webhook settings).
4. **NEXT_PUBLIC_API_URL** is a Next.js public env var — baked into the client bundle at build time. Changes require a rebuild.

## Local Development Setup

```bash
# Generate secrets
openssl rand -base64 32  # Use for AUTH_SECRET

# Stripe CLI for webhook forwarding
stripe listen --forward-to localhost:3000/webhooks/stripe
# Copy whsec_... output to STRIPE_WEBHOOK_SECRET
```

## Production (Railway)

Set all variables via Railway dashboard or CLI. Additionally:
- `PORT` must be explicitly set on both services
- `FRONTEND_URL` on backend for CORS
- `NEXT_PUBLIC_API_URL` on frontend pointing to backend Railway domain
