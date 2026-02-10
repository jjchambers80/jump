import { PrismaClient } from "../generated/client/index.js";

// Singleton pattern — prevents connection exhaustion during hot reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Re-export all types from the generated client
export * from "../generated/client/index.js";
export { PrismaClient };
