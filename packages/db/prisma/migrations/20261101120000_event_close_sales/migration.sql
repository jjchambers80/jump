-- Spec 050-D: close sales on a published event. Nullable, no backfill.
ALTER TABLE "Event" ADD COLUMN     "salesClosedAt" TIMESTAMP(3),
ADD COLUMN     "salesClosedById" TEXT;
