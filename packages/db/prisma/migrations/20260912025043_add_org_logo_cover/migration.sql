-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "coverImageId" TEXT,
ADD COLUMN     "coverUrl" TEXT,
ADD COLUMN     "logoImageId" TEXT,
ADD COLUMN     "logoUrl" TEXT;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_logoImageId_fkey" FOREIGN KEY ("logoImageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;
