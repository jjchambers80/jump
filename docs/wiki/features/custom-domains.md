# Custom Domains (White-Label Storefronts)

**Status**: Implemented (spec 007 phase 3, shipped 2026-09-13)
**Last Updated**: 2026-09-13

## Overview

An organization can point a subdomain it owns (for example `tickets.venue.com`) at Jump. After publishing a CNAME and a TXT record and verifying, that hostname serves the organization's storefront: its org page at `/`, event and checkout pages, the buyer account page at `/account`, and the links in confirmation and sign-in emails and Stripe return URLs. Admin, staff sign-in, and other organizations do not exist on that host.

## Key Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/schema.prisma` | `OrganizationDomain`, `DomainStatus` |
| `backend/src/services/DomainService.js` | Hostname validation, add/remove/primary, DNS verification, status lifecycle, host→org resolution, CORS allowlist, background sweep |
| `backend/src/lib/railwayDomains.js` | Optional Railway GraphQL client: attach the hostname to the frontend service for TLS |
| `backend/src/api/routes/admin.js` | `/admin/settings/domains` (GET, POST), `/:id/verify`, `/:id/primary`, `DELETE` |
| `backend/src/api/routes/domains.js` | Public `GET /domains/resolve?host=` |
| `backend/src/api/server.js` | Dynamic CORS for ACTIVE hosts; 10-minute domain sweep timer |
| `backend/src/utils/storefrontUrl.js` | Async per-organization URL builders used by emails, magic links, Stripe redirects |
| `frontend/src/middleware.ts` | Tenant-host routing (must live in `src/`; see Gotchas) |
| `frontend/src/lib/storefrontHost.ts` | Pure routing rules: platform-host detection, path rewrite map |
| `frontend/src/app/admin/settings/domains/page.tsx` | Settings › Domains UI (add, DNS records with copy, verify, make primary, remove) |
| `frontend/src/app/admin/settings/SettingsNav.tsx` | Shared Settings section nav |
| `backend/tests/unit/domainService.test.js`, `tests/contract/domains.test.js`, `frontend/tests/unit/storefrontHost.test.ts` | 36 tests |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `STOREFRONT_CNAME_TARGET` | No | Hostname organizations CNAME to. Default: host of the first `FRONTEND_URL`. Set it to the frontend's public Railway host in production |
| `PLATFORM_HOSTS` (backend) / `NEXT_PUBLIC_PLATFORM_HOSTS` (frontend) | No | Comma-separated platform hostnames that can never be claimed and never route as a tenant. `localhost`, `127.0.0.1`, `*.up.railway.app`, and the hosts of `FRONTEND_URL` / `AUTH_URL` are always platform |
| `RAILWAY_API_TOKEN`, `RAILWAY_FRONTEND_SERVICE_ID` | No | Together with Railway-injected `RAILWAY_PROJECT_ID` and `RAILWAY_ENVIRONMENT_ID`, enables automatic custom-domain creation on the frontend service so Railway issues the certificate. Unset: a DNS-verified domain goes straight to ACTIVE and the operator adds it in the Railway dashboard |
| `DOMAIN_SWEEP_INTERVAL_MS` | No | Re-check interval for the background sweep (default 600000) |

## How It Works

1. **Add.** `POST /admin/settings/domains { hostname }`. `normalizeHostname` lowercases, strips scheme/port/path, requires a subdomain (apex domains are rejected because a CNAME cannot live at an apex on most providers), and rejects platform hosts. A 32-hex `verificationToken` is generated. If the Railway client is configured the domain is created there first and its required CNAME value becomes `cnameTarget`. The first domain of an organization is `isPrimary`.
2. **Instructions.** The response (and the Settings page) shows two records:
   ```
   CNAME  <hostname>               <cnameTarget>
   TXT    _jump-verify.<hostname>  jump-verify=<verificationToken>
   ```
3. **Verify.** `POST /admin/settings/domains/:id/verify` (or the sweep) resolves the TXT and CNAME with `dns.promises`. TXT chunks are joined; CNAME comparison ignores case and trailing dots. On success: `verifiedAt` set, `lastError` cleared; status becomes `ACTIVE` when Railway reports a valid certificate or when Railway is not configured, otherwise `VERIFIED` with "waiting for certificate". On failure: `lastError` explains exactly which record is wrong; a never-verified domain stays `PENDING`; a previously verified one keeps its status for 72 h (`failingSince`) and then becomes `FAILED`.
4. **Sweep.** `server.js` runs `DomainService.checkAll()` 15 s after boot and every 10 minutes: non-ACTIVE domains every run, ACTIVE ones once a day. The timer is `unref()`'d and skipped under `NODE_ENV=test`.
5. **Routing.** `frontend/src/middleware.ts` normalizes the `Host` header. Platform hosts pass through untouched. Any other host is resolved via `GET /domains/resolve?host=` (60 s cache in the edge isolate and 60 s cache in `DomainService`). Unknown host → 404. Known host → `routeForTenantHost`:
   - `/` → rewrite to `/organizations/<orgId>`
   - `/account…` → rewrite to `/organizations/<orgId>/account…`
   - `/organizations/<orgId>/…` (same org), `/events/*`, `/checkout/*`, `/confirmation`, `/orders/:id`, `/tickets/*`, `/venues/*` → pass
   - `/organizations/<other>`, `/admin*`, `/auth*`, `/dashboard*`, `/my-tickets`, `/orders` (list), `/orders/lookup`, anything else → 404
   Pages receive the same `params.orgId` as on the platform host, so no page is host-aware. `/api/*` is excluded by the matcher, so `/api/buyer/*` works unchanged and the `jump_buyer` cookie is first-party on the tenant host.
6. **Cross-origin API calls.** Storefront pages call the backend at `NEXT_PUBLIC_API_URL` from the tenant origin; `server.js` CORS allows the static `FRONTEND_URL` list first, then any ACTIVE hostname (`DomainService.isActiveOrigin`, https only in production).
7. **Links.** `storefrontFor(organizationId)` returns `https://<primary ACTIVE host>` or the platform URL. `orderUrl`, `confirmationUrl`, `eventUrl`, `buyerAccountUrl`, `buyerVerifyUrl`, `orgPageUrl` build on it, so confirmation emails, welcome/sign-in links and Stripe `success_url`/`cancel_url` follow the domain automatically. A primary domain that is not yet ACTIVE is ignored until it is.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/settings/domains` | Organizer/Admin (SYSTEM_ADMIN: `?organizationId=`) | List this organization's domains with DNS records |
| POST | `/admin/settings/domains` | Organizer/Admin | `{ hostname }` → 201 domain; 400 invalid/apex/platform; 409 already registered |
| POST | `/admin/settings/domains/:id/verify` | Organizer/Admin | Re-check DNS now; returns the updated domain |
| POST | `/admin/settings/domains/:id/primary` | Organizer/Admin | Make primary |
| DELETE | `/admin/settings/domains/:id` | Organizer/Admin | Remove (also from Railway when managed); promotes the oldest remaining domain to primary |
| GET | `/domains/resolve?host=` | None | `{ organizationId }` for an ACTIVE host; 404 otherwise; `Cache-Control: public, max-age=60` |

## Database

`OrganizationDomain`: `id, organizationId (FK cascade), hostname (unique), status DomainStatus, verificationToken, cnameTarget, isPrimary, railwayDomainId?, verifiedAt?, lastCheckedAt?, failingSince?, lastError?, createdAt, updatedAt`; indexes on `organizationId`, `status`. `DomainStatus`: `PENDING | VERIFIED | ACTIVE | FAILED`. Migration `20260913120000_organization_domains` (additive). See [Database Architecture](database-architecture.md).

## Gotchas

- **Middleware location.** This project uses the `src/` layout, so Next loads `frontend/src/middleware.ts` only. The old `frontend/middleware.ts` at the package root was never executed. Staff protection now runs on the edge: `auth.config.ts` carries the HS256 cookie codec (`lib/authJwt.ts`, `jose`), and the middleware builds its Auth.js instance without the Resend provider — that provider requires a database adapter and would make `Auth()` throw `MissingAdapter` on the edge, silently disabling the check. Tenant hosts 404 `/admin` before any auth check runs.
- **Subdomains only.** `example.com` is rejected; `tickets.example.com` is required. If an organization insists on an apex, that needs ALIAS/ANAME support at their DNS provider and is not handled here.
- **Railway GraphQL client is untested against a live token.** Field names follow Railway's public schema; the first real attach will confirm them. Errors surface as `lastError` and in logs; the domain still activates on DNS proof when the client is unconfigured.
- **ACTIVE without a certificate is possible** when Railway is unconfigured: DNS proof activates and links start using the host. Attach the domain in Railway before or immediately after verifying, or buyers will hit a TLS error.
- **72 h grace.** An ACTIVE domain whose records disappear keeps serving for three days, with `lastError` set, before it is marked FAILED and links fall back to the platform URL.
- **Local testing.** Spoof the host: `curl -H 'Host: tickets.example.test' http://localhost:3001/`. Insert an ACTIVE `OrganizationDomain` row directly for the org; `localhost` itself is always a platform host.
- **The sweep runs on every backend instance** (in-process timer). With several replicas the same domain is re-checked by each; the work is idempotent and cheap, but a distributed lock would be needed before scaling out significantly.
- **Cross-org public pages.** `tickets.a.com/events/<org-b-event-id>` renders org B's public event page if the id is known. It is public on the platform host too; a per-host organization check on event/checkout pages is a follow-up.
- **Per-organization sending domain is not implemented.** Emails are still sent from `RESEND_FROM_EMAIL`; only the links change.

## Related Features

- [Tenant Identity](tenant-identity.md) — per-org buyers and memberships this builds on
- [Buyer Accounts](buyer-accounts.md) — the `/account` page and magic links that follow the domain
- [Organization Branding](organization-branding.md) — the storefront pages themselves
- [Railway Deployment](railway-deployment.md) — where TLS for custom domains is provisioned
- Plan and decision record: `specs/007-tenant-identity/{spec,plan}.md`
