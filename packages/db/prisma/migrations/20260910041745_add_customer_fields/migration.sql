-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "emailSubscribed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "note" TEXT;
