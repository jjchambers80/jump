import { PrismaClient } from "../generated/client/index.js";

// Singleton pattern — prevents connection exhaustion during hot reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Secrets never leave the database unless a query opts in
// (`omit: { storefrontPasswordHash: false }` or an explicit `select`).
const clientOptions = { omit: { organization: { storefrontPasswordHash: true } } };

export const prisma = globalForPrisma.prisma ?? new PrismaClient(clientOptions);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Re-export all types from the generated client
export * from "../generated/client/index.js";
export { PrismaClient };
