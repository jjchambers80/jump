-- Spec 044A: organization-level (standing) application forms.
CREATE TYPE "ApplicationMessageScope" AS ENUM ('EVENT', 'STANDING');

ALTER TABLE "ApplicationForm"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "collectBusiness" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "buttonLabel" TEXT,
  ADD COLUMN "successMessage" TEXT;

UPDATE "ApplicationForm" AS form
SET "organizationId" = venue."organizationId"
FROM "Event" AS event
JOIN "Venue" AS venue ON venue."id" = event."venueId"
WHERE form."eventId" = event."id";

ALTER TABLE "ApplicationForm"
  ALTER COLUMN "organizationId" SET NOT NULL,
  ALTER COLUMN "eventId" DROP NOT NULL;

ALTER TABLE "Application"
  ALTER COLUMN "eventId" DROP NOT NULL,
  ALTER COLUMN "profileId" DROP NOT NULL;

ALTER TABLE "Application"
  DROP CONSTRAINT "Application_eventId_fkey",
  DROP CONSTRAINT "Application_profileId_fkey",
  ADD CONSTRAINT "Application_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Application_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "ApplicantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApplicationMessageTemplate"
  ADD COLUMN "scope" "ApplicationMessageScope" NOT NULL DEFAULT 'EVENT';

DROP INDEX "ApplicationMessageTemplate_organizationId_action_key";
CREATE UNIQUE INDEX "ApplicationMessageTemplate_organizationId_scope_action_key"
  ON "ApplicationMessageTemplate"("organizationId", "scope", "action");

CREATE UNIQUE INDEX "ApplicationForm_standing_organizationId_slug_key"
  ON "ApplicationForm"("organizationId", "slug")
  WHERE "eventId" IS NULL;
CREATE INDEX "ApplicationForm_organizationId_status_idx"
  ON "ApplicationForm"("organizationId", "status");

ALTER TABLE "ApplicationForm"
  ADD CONSTRAINT "ApplicationForm_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ApplicationForm_standing_free_check"
  CHECK ("eventId" IS NOT NULL OR "kind" = 'FREE');

-- Compatibility for direct event-form inserts: the database still guarantees
-- organizationId is NOT NULL while deriving it from the event when omitted.
CREATE FUNCTION set_application_form_organization() RETURNS trigger AS $$
BEGIN
  IF NEW."organizationId" IS NULL AND NEW."eventId" IS NOT NULL THEN
    SELECT venue."organizationId" INTO NEW."organizationId"
    FROM "Event" event
    JOIN "Venue" venue ON venue."id" = event."venueId"
    WHERE event."id" = NEW."eventId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ApplicationForm_set_organization"
BEFORE INSERT OR UPDATE OF "eventId", "organizationId" ON "ApplicationForm"
FOR EACH ROW EXECUTE FUNCTION set_application_form_organization();
