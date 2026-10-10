-- Spec 050-A: event draft fields for the setup wizard.
-- capacity may be null only on a draft (or an RSVP event); publish still needs it.
ALTER TABLE "Event" ALTER COLUMN "capacity" DROP NOT NULL,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "setupStep" TEXT,
ADD COLUMN     "setupRequestId" TEXT,
-- The default is the backfill: every existing row reads the migration time, so
-- no existing event can enter the wizard's create flow.
ADD COLUMN     "setupCompletedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "Event_setupRequestId_key" ON "Event"("setupRequestId");

ALTER TABLE "Event" ADD CONSTRAINT "Event_capacity_draft_check"
  CHECK ("capacity" IS NOT NULL OR "status" = 'DRAFT' OR "admissionMode" = 'RSVP');
