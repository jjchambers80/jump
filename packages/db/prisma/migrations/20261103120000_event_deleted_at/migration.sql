-- Soft delete for cancelled events and drafts with order history.
-- Nullable column, no backfill.
ALTER TABLE "Event" ADD COLUMN "deletedAt" TIMESTAMP(3);
