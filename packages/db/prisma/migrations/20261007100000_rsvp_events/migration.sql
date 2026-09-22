CREATE TYPE "AdmissionMode" AS ENUM ('TICKETED', 'RSVP');
CREATE TYPE "RsvpStatus" AS ENUM ('GOING', 'CANCELLED');

ALTER TYPE "EmailSubscribedSource" ADD VALUE 'RSVP';
ALTER TYPE "LegalSource" ADD VALUE 'RSVP';

ALTER TABLE "Event"
ADD COLUMN "admissionMode" "AdmissionMode" NOT NULL DEFAULT 'TICKETED',
ADD COLUMN "rsvpLimit" INTEGER,
ADD COLUMN "rsvpMaxPartySize" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "EventRsvp" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "partySize" INTEGER NOT NULL DEFAULT 1,
  "status" "RsvpStatus" NOT NULL DEFAULT 'GOING',
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventRsvp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventRsvp_eventId_contactId_key" ON "EventRsvp"("eventId", "contactId");
CREATE INDEX "EventRsvp_eventId_status_idx" ON "EventRsvp"("eventId", "status");
CREATE INDEX "EventRsvp_contactId_idx" ON "EventRsvp"("contactId");

ALTER TABLE "EventRsvp" ADD CONSTRAINT "EventRsvp_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventRsvp" ADD CONSTRAINT "EventRsvp_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
