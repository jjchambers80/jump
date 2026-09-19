-- Spec 024 (application orders), part 1 of 2: enum values.
-- Postgres refuses to use an enum value added in the same transaction, and the
-- backfill in the next migration writes 'CANCELLED', so the enum change ships
-- on its own.

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('TICKET', 'APPLICATION');

-- CreateEnum
CREATE TYPE "OrderItemKind" AS ENUM ('TICKET_TIER', 'APPLICATION_TIER', 'ADJUSTMENT', 'WAIVER');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'CANCELLED';
