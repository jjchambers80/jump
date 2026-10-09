-- Spec 047 D0-B: per-line fee mode. Null means the order's feeMode; nothing
-- writes a non-null value until donations (D1), so no backfill.
ALTER TABLE "OrderItem" ADD COLUMN "feeMode" "FeeMode";
