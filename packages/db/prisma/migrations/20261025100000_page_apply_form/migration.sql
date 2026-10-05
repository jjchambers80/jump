-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "applicationFormId" TEXT,
ADD COLUMN     "applyLabel" TEXT;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_applicationFormId_fkey" FOREIGN KEY ("applicationFormId") REFERENCES "ApplicationForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
