# Railway Deployment

**Status:** Implemented
**Last Updated:** 2026-09-07

## Overview

Production deployment on Railway with two services (backend and frontend) and a provisioned PostgreSQL database. Each service uses Railpack build configs. Cross-service communication uses Railway internal URLs.

## Key Files

| File | Purpose |
|------|---------|
| `railpack.backend.json` | Railpack build configuration for the backend service |
| `railpack.frontend.json` | Railpack build configuration for the frontend service |

## Configuration

| Variable | Description |
|----------|-------------|
| `PORT` | Explicit port for each service (required by Railway) |
| `FRONTEND_URL` | Backend needs this to allow CORS and generate links |
| `BACKEND_URL` | Internal Railway URL for backend service |
| `NEXT_PUBLIC_API_URL` | Frontend env var pointing to the backend Railway domain |
| `DATABASE_URL` | PostgreSQL connection string (provisioned by Railway) |
| `BUCKET_NAME`, `BUCKET_ENDPOINT`, `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY`, `BUCKET_REGION` | Railway Bucket credentials (auto-injected when the bucket is attached to the backend service). Selects `RemoteStorageBackend` for image uploads |
| `BUCKET_PUBLIC_URL` | Optional. Leave unset — Railway Buckets deny anonymous reads, so images are served through the backend proxy `GET /images/:id/:hash/:variant` |

All development environment variables are also required in production (e.g., `AUTH_SECRET`, `RESEND_API_KEY`, Stripe keys).

## How It Works

1. Each service has a Railpack config (`railpack.backend.json`, `railpack.frontend.json`) defining the build.
2. Railway builds and deploys each service independently.
3. The frontend communicates with the backend via `NEXT_PUBLIC_API_URL`.
4. Cross-service calls use Railway internal URLs for lower latency.
5. PostgreSQL is provisioned on Railway and connected via `DATABASE_URL`.
6. Database migrations are applied via SSH tunnel to the Railway PostgreSQL instance.

## Gotchas

- Both services need `PORT` explicitly set — Railway does not infer it automatically.
- `NEXT_PUBLIC_API_URL` must point to the backend's Railway domain (public URL), not the internal URL.
- Database migrations must be run via SSH tunnel — there is no direct migration step in the deploy pipeline.
- Environment variables must be set per-service in the Railway dashboard.
- The backend container filesystem is ephemeral. Any image stored under `backend/uploads/` (the pre-Sep-2026 `multer.diskStorage` path, `logoUrl` like `/uploads/logos/<uuid>.png`) is lost on every redeploy and cannot be recovered — re-upload via the admin UI so it lands in the bucket.
- The Railway Bucket is private (anonymous GET → 403). Do not emit direct `BUCKET_ENDPOINT` URLs; `ImageService.formatImageResponse` routes through the backend proxy unless `BUCKET_PUBLIC_URL` is explicitly set.

## Related Features

- [Database Architecture](database-architecture.md) — shared Prisma schema and migrations deployed via Railway.
- [Observability](observability.md) — health checks used by Railway for service monitoring.
