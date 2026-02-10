// Plain JS entry point for @jump/db (used by backend runtime and Jest)
// Mirrors packages/db/src/index.ts but without TypeScript syntax

import { PrismaClient } from "../generated/client/index.js";

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

export { PrismaClient };
export * from "../generated/client/index.js";
