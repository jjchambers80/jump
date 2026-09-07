-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "taxRate" DECIMAL(6,5);

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "postalCode" TEXT;
