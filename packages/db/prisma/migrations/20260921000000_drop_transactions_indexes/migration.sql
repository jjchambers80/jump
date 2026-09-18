-- Transactions (spec 018 phase 1) removed: drop the indexes that only served
-- the /admin/transactions UNION ALL read model.
DROP INDEX IF EXISTS "Order_createdAt_idx";
DROP INDEX IF EXISTS "Application_organizationId_paidAt_idx";
DROP INDEX IF EXISTS "Application_organizationId_submittedAt_idx";
