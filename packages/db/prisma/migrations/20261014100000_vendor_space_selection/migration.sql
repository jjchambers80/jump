-- Spec 039 (vendor space selection), card 039A: columns only.
--   ApplicationForm.spaceSelection: TIERS (vendor picks a tier) or MAP
--     (vendor picks a spot on the floor map within the approved category).
--   Booth.price: overrides the booth's tier price when set.
-- Existing forms move with `npm run db:backfill:039-space-selection`
-- (dry run unless DRY_RUN=false): forms whose event has a published map
-- with booths on their tiers become MAP.

-- CreateEnum
CREATE TYPE "SpaceSelectionMode" AS ENUM ('TIERS', 'MAP');

-- AlterTable
ALTER TABLE "ApplicationForm" ADD COLUMN "spaceSelection" "SpaceSelectionMode" NOT NULL DEFAULT 'TIERS';

-- AlterTable
ALTER TABLE "Booth" ADD COLUMN "price" DECIMAL(10,2);
