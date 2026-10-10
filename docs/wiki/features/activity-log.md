# Settings › Activity log — the audit trail

**Status:** Implemented
**Last Updated:** 2026-10-09
**Spec:** 048 (plan in the PR description)

## Overview

Every change made inside a store is recorded once in the append-only `AuditLog`. That covers staff in the admin, the Jump CLI, connected MCP agents, Stripe webhooks and scheduled sweeps. Every file a staff user downloads (CSV exports, customer data, map PDFs) is recorded too. Store Admins and SYSTEM_ADMIN read the trail in **Settings › Activity log**, which shows one organization at a time like every admin page.

Each row records:

- **Who:** the actor type (`USER`, `DEVELOPER_TOKEN`, `AGENT`, `SYSTEM`), a name snapshot, the role, and for agents the grant and client.
- **Staff access:** whether SYSTEM_ADMIN acted inside the store.
- **What:** `action` (`event.updated`), `operation`, the feature area, and the record's type, id and name snapshot.
- **The field diff:** `{ field: [before, after] }`.
- **Where:** the source (`admin`, `cli`, `mcp:<tool>`, `webhook:stripe:<endpoint>`, `sweep:<name>`), the request id, method and route pattern, the hashed IP, the user agent, and a city/region/country when `GEOIP_ENABLED`.

## How capture works

1. **`packages/db/src/audit.js`** wraps the shared Prisma client (`withAudit`) in a query extension.
   - Inside an `auditContext` (AsyncLocalStorage) that has an actor, every `create` / `update` / `upsert` / `delete` reads the row before the write and diffs scalar columns afterwards.
   - `*Many` writes are logged as one `BULK_*` row with the count and the `where`.
   - The extension only pushes events onto the store; it never writes the audit row itself.
   - Without a context, or with `AUDIT_LOG_ENABLED=false`, every query passes straight through.
2. **`backend/src/audit/middleware.js`** opens a context for every request.
   - Writes are captured only once a staff user is on `req.user`, so buyers and anonymous traffic are never logged.
   - The rows are written after the response, and only when the status is below 400.
   - A response with `Content-Disposition: attachment` becomes an `EXPORT` row.
3. **`AuditLogService.flush`** resolves the actor, the organization and the request fields.
   - The organization comes from the row's `organizationId`, else the active org, else the relation path in `features.js` (for webhooks).
   - It writes with `createMany`. A failed audit write is logged and never breaks the action it describes.
4. **System actors:**
   - Sweeps in `server.js` run through `runAsSystem(source, label, job)`.
   - Stripe webhooks call `markSystemActor` in `verifyAndClaim`.
   - MCP tools run inside a context with the agent actor (`mcp/src/tools.js` `registerTool`).

## Rules

- **Every Prisma model is either mapped in `backend/src/audit/features.js` (feature area, label column, org path) or excluded in `AUDIT_EXCLUDED_MODELS`.** A unit test fails otherwise.
- **Secrets are never stored.** Columns matching `hash|secret|token|password|totp|recovery|apikey` keep only `[changed]`. Values are cut at 500 characters and a row's diff at about 16 KB.
- **Rows are immutable.** A database trigger refuses `UPDATE` on `AuditLog`. Only the retention sweep deletes, after `AUDIT_RETENTION_DAYS` (default 730).
- **Prisma queries are lazy.** Code that starts a query inside `auditContext.run` must `await` it inside the callback, or the query runs outside the context and is not captured.
- **The CSV export guards against formula injection.** Cells starting with `= + - @` are prefixed with `'`.

## Known limits

- Raw SQL (`$executeRaw`, e.g. the capacity counters) is not captured.
- Nested writes log the parent row, with the relation keys in `meta.nested`.
- The before-read runs outside an interactive transaction.
- A write that committed before the request then failed (status ≥ 400) is dropped.
- Staff sign-in and security events stay in `SecurityEvent`.

## Key files

| File | Purpose |
|------|---------|
| `packages/db/src/audit.js` | Capture extension, `auditContext`, `diffRows`, excluded models |
| `backend/src/audit/AuditLogService.js` | `flush`, `record`, `runAsSystem`, `markSystemActor`, `list`, `exportCsv`, `sweep` |
| `backend/src/audit/features.js` | Model → feature area, label column, org path |
| `backend/src/audit/redact.js` | Secret-field and size rules |
| `backend/src/audit/middleware.js` | Per-request context, download capture, flush on success |
| `backend/src/api/routes/admin.js` | `GET /admin/audit-log`, `GET /admin/audit-log/export.csv` (store ADMIN by membership, or SYSTEM_ADMIN) |
| `frontend/src/app/admin/settings/activity/` | The page and `ActivityEntry` (sentence, badges, diff table) |
| `backend/tests/contract/auditLog.test.js`, `backend/tests/unit/auditLog.test.js`, `frontend/e2e/admin-activity-log.spec.ts` | Tests |
