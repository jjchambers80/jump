// Spec 048: generic change capture for the audit trail.
//
// A Prisma query extension records every model write made while an audit
// context is active (staff request, CLI token, MCP agent, sweep, webhook) as a
// field diff on `store.events`. It never writes the audit row itself — the
// backend flushes the buffer once the request or job has succeeded
// (backend/src/audit/AuditLogService.js). Without a context, or with
// AUDIT_LOG_ENABLED=false, every query passes straight through.

import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "../generated/client/index.js";

export const auditContext = new AsyncLocalStorage();

// Models that are themselves logs, sessions or caches: auditing them is noise
// or recursion. Every other model is audited (backend/src/audit/features.js
// must map it — a unit test enforces that).
export const AUDIT_EXCLUDED_MODELS = new Set([
  "AuditLog",
  "AgentAuditLog",
  "SecurityEvent",
  "UserSession",
  "VerificationToken",
  "StripeWebhookEvent",
  "BuyerLoginToken",
  "DeveloperAuthCode",
  "OAuthAuthCode",
  "OAuthToken",
  "TrustedDevice",
  "ThemeRevision",
  "StoreFileReference",
  "LegalAcceptance",
]);

// Columns that change on every write and say nothing about the change.
const IGNORED_FIELDS = new Set(["updatedAt", "lastUsedAt"]);

const SINGLE = new Set(["create", "update", "upsert", "delete"]);
const BULK = { createMany: "BULK_CREATE", createManyAndReturn: "BULK_CREATE", updateMany: "BULK_UPDATE", updateManyAndReturn: "BULK_UPDATE", deleteMany: "BULK_DELETE" };

const scalarFields = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    model.fields.filter((field) => field.kind === "scalar" || field.kind === "enum").map((field) => field.name),
  ]),
);

const delegateName = (model) => model.charAt(0).toLowerCase() + model.slice(1);

function comparable(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && typeof value.toFixed === "function") return value.toString(); // Decimal
  if (value instanceof Uint8Array) return "[binary]";
  return value === undefined ? null : value;
}

/** { field: [before, after] } over scalar columns, skipping unchanged and ignored ones. */
export function diffRows(model, before, after) {
  const changes = {};
  for (const field of scalarFields.get(model) || []) {
    if (IGNORED_FIELDS.has(field)) continue;
    const a = comparable(before?.[field]);
    const b = comparable(after?.[field]);
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = [a, b];
  }
  return changes;
}

// Relation keys in `data` are nested writes; record that they happened.
function nestedKeys(model, data) {
  if (!data || typeof data !== "object") return [];
  const scalars = new Set(scalarFields.get(model) || []);
  return Object.keys(data).filter((key) => !scalars.has(key) && !key.endsWith("Id"));
}

// A caller's `select` may hide columns the diff needs; ask for all scalars and
// strip the extras again before handing the result back.
function widenSelect(model, args) {
  if (!args?.select) return { args, added: [] };
  const added = (scalarFields.get(model) || []).filter((field) => args.select[field] === undefined);
  const select = { ...args.select };
  for (const field of added) select[field] = true;
  return { args: { ...args, select }, added };
}

function capturing(model) {
  if (process.env.AUDIT_LOG_ENABLED === "false") return null;
  if (AUDIT_EXCLUDED_MODELS.has(model)) return null;
  const store = auditContext.getStore();
  if (!store || !(store.actor || store.req?.user)) return null;
  return store;
}

/** Wraps a base client with change capture. `base` performs the before-reads. */
export function withAudit(base) {
  return base.$extends({
    name: "audit",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const store = (SINGLE.has(operation) || BULK[operation]) && capturing(model);
          if (!store) return query(args);

          if (BULK[operation]) {
            const result = await query(args);
            const count = Array.isArray(result) ? result.length : result?.count;
            if (count) {
              store.events.push({
                model,
                operation: BULK[operation],
                entityId: null,
                row: null,
                changes: null,
                meta: { count, where: args?.where ?? null },
              });
            }
            return result;
          }

          // ponytail: the before-read runs on the base client, outside an
          // interactive transaction, so it can miss that transaction's own
          // earlier writes. Good enough for an audit diff.
          const before = operation === "create" ? null
            : await base[delegateName(model)].findUnique({ where: args.where }).catch(() => null);
          const { args: widened, added } = widenSelect(model, args);
          const result = await query(widened);

          const after = operation === "delete" ? null : result;
          const changes = diffRows(model, before, after);
          const kind = operation === "delete" ? "DELETE" : operation === "create" || (operation === "upsert" && !before) ? "CREATE" : "UPDATE";
          const nested = nestedKeys(model, args?.data ?? args?.update ?? args?.create);
          if (kind !== "UPDATE" || Object.keys(changes).length || nested.length) {
            store.events.push({
              model,
              operation: kind,
              entityId: (after ?? before)?.id ?? null,
              row: after ?? before,
              changes,
              meta: nested.length ? { nested } : null,
            });
          }

          if (added.length && result && typeof result === "object") {
            const trimmed = { ...result };
            for (const field of added) delete trimmed[field];
            return trimmed;
          }
          return result;
        },
      },
    },
  });
}
