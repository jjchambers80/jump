// Plain JS entry point for @jump/db (used by backend runtime and Jest)
// Mirrors packages/db/src/index.ts but without TypeScript syntax

import { PrismaClient } from "../generated/client/index.js";
import { withAudit } from "./audit.js";

const globalForPrisma = globalThis;

// Secrets never leave the database unless a query opts in
// (`omit: { storefrontPasswordHash: false }` or an explicit `select`).
const clientOptions = { omit: { organization: { storefrontPasswordHash: true } } };

// Spec 048: writes made inside an audit context are captured for the audit
// trail (see ./audit.js); everything else passes straight through.
export const prisma = globalForPrisma.__prisma ?? withAudit(new PrismaClient(clientOptions));

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

export { PrismaClient };
export { auditContext, diffRows, AUDIT_EXCLUDED_MODELS } from "./audit.js";
export * from "../generated/client/index.js";
