-- Spec 011 phase 3: organizer daily digest of new application submissions.
ALTER TABLE "Organization" ADD COLUMN "applicationDigestEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Organization" ADD COLUMN "applicationDigestAt" TIMESTAMP(3);
