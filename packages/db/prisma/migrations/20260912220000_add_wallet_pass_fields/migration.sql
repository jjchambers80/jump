-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "nfcToken" TEXT,
ADD COLUMN     "passUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "googleObjectId" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "googleClassId" TEXT,
ADD COLUMN     "googleClassSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_nfcToken_key" ON "Ticket"("nfcToken");
