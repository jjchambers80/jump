-- Spec 057: registration events. An event is LIVE (tickets or RSVPs) or
-- REGISTRATION (one application form); a registration event may link to a
-- LIVE event of its organization.
CREATE TYPE "EventType" AS ENUM ('LIVE', 'REGISTRATION');

ALTER TABLE "Event" ADD COLUMN "type" "EventType" NOT NULL DEFAULT 'LIVE',
ADD COLUMN "linkedEventId" TEXT;

CREATE INDEX "Event_linkedEventId_idx" ON "Event"("linkedEventId");

ALTER TABLE "Event" ADD CONSTRAINT "Event_linkedEventId_fkey" FOREIGN KEY ("linkedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A registration event has no admission, so no capacity, published or not.
ALTER TABLE "Event" DROP CONSTRAINT "Event_capacity_draft_check";
ALTER TABLE "Event" ADD CONSTRAINT "Event_capacity_draft_check"
  CHECK ("capacity" IS NOT NULL OR "status" = 'DRAFT' OR "admissionMode" = 'RSVP' OR "type" = 'REGISTRATION');
