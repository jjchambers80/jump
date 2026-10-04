-- Spec 037 phase 5 (vendor apply-then-choose), part 2 of 2: columns.
--   ApplicationForm.reserveOnApproval (D5): approval takes a slot in the
--     category (default) or nothing (first-come at selection).
--   Application.selectionHeldUntil: the 15-minute hold on a chosen space.
-- In-flight applications move with `npm run db:backfill:037-applications`
-- (dry run unless DRY_RUN=false), not here: it has to release holds and
-- cancel unpaid orders row by row.

-- AlterTable
ALTER TABLE "ApplicationForm" ADD COLUMN "reserveOnApproval" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "selectionHeldUntil" TIMESTAMP(3);
