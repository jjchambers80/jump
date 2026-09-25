-- Spec 034: vendor check-in at the door.
--
-- Additive only. The arrival record stays `Application.checkedInAt` (spec 019
-- phase 3); these columns record *who* stamped it and *how*, so the arrivals
-- view can show provenance. Both are nullable, so every existing stamp keeps
-- working and rollback is a plain DROP COLUMN plus DROP TYPE.
CREATE TYPE "CheckInMethod" AS ENUM ('SEARCH', 'SCAN', 'TOGGLE');

ALTER TABLE "Application" ADD COLUMN "checkedInById" TEXT;
ALTER TABLE "Application" ADD COLUMN "checkedInVia" "CheckInMethod";

-- The door roster reads approved vendors for one event ordered by arrival
-- state; the existing (eventId, status) index covers the filter.
