// Plain JS entry point for @jump/db (used by backend runtime and Jest)
// Mirrors packages/db/src/index.ts but without TypeScript syntax

import { PrismaClient } from "../generated/client/index.js";

const globalForPrisma = globalThis;

// Secrets never leave the database unless a query opts in
// (`omit: { storefrontPasswordHash: false }` or an explicit `select`).
const clientOptions = { omit: { organization: { storefrontPasswordHash: true } } };

export const prisma = globalForPrisma.__prisma ?? new PrismaClient(clientOptions);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

export { PrismaClient };
export * from "../generated/client/index.js";
