-- Spec 037 phase 5 (vendor apply-then-choose), part 1 of 2: enum values.
-- Postgres refuses to use an enum value in the transaction that adds it, so
-- the values ship on their own (the spec 024 pattern). The data move for
-- in-flight applications is `npm run db:backfill:037-applications`.

-- AlterEnum
ALTER TYPE "ApplicationPayment" ADD VALUE IF NOT EXISTS 'NOT_DUE';
ALTER TYPE "ApplicationPayment" ADD VALUE IF NOT EXISTS 'AWAITING_SELECTION';

-- AlterEnum
ALTER TYPE "ApplicationAction" ADD VALUE IF NOT EXISTS 'CHOOSE_SPACE';
