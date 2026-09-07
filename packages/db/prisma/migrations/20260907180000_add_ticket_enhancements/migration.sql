-- CreateEnum
CREATE TYPE "TierVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'HIDDEN');

-- AlterTable: PriceTier - add sale windows, visibility, refund policy
ALTER TABLE "PriceTier" ADD COLUMN "saleStartDate" TIMESTAMP(3),
                        ADD COLUMN "saleEndDate" TIMESTAMP(3),
                        ADD COLUMN "visibility" "TierVisibility" NOT NULL DEFAULT 'PUBLIC',
                        ADD COLUMN "isRefundable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Ticket - add ticketNumber (nullable first for backfill)
ALTER TABLE "Ticket" ADD COLUMN "ticketNumber" INTEGER;

-- Backfill existing tickets with sequential numbers per event
UPDATE "Ticket" t
SET "ticketNumber" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "eventId" ORDER BY "createdAt" ASC) AS rn
  FROM "Ticket"
) sub
WHERE t.id = sub.id;

-- Now make ticketNumber NOT NULL
ALTER TABLE "Ticket" ALTER COLUMN "ticketNumber" SET NOT NULL;

-- CreateIndex: unique ticket number per event
CREATE UNIQUE INDEX "Ticket_eventId_ticketNumber_key" ON "Ticket"("eventId", "ticketNumber");
