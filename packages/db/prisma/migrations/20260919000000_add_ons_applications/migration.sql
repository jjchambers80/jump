-- Spec 012 phase 2: add-ons on application tiers.
-- AlterEnum
ALTER TYPE "ApplicationAction" ADD VALUE 'ADD_ONS_CHANGED';

-- AlterTable
ALTER TABLE "ApplicationAddOn" ADD COLUMN     "applicantPays" DECIMAL(10,2) NOT NULL DEFAULT 0;
