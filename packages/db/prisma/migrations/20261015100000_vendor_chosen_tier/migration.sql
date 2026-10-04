-- Spec 039 card 039B: Application.tierChosenByVendor. True while a vendor on a
-- TIERS form (approved without a category) holds the tier they picked at
-- selection; releasing the selection clears the tier again. Existing rows had
-- their category assigned by the organizer, so the default is right for them.

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "tierChosenByVendor" BOOLEAN NOT NULL DEFAULT false;
