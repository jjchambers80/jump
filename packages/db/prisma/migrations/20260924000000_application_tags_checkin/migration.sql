-- Spec 019 phase 3: organizer tags and on-site check-in on applications.
ALTER TABLE "Application" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Application" ADD COLUMN "checkedInAt" TIMESTAMP(3);
ALTER TABLE "Application" ADD COLUMN "checkedOutAt" TIMESTAMP(3);
CREATE INDEX "Application_tags_idx" ON "Application" USING GIN ("tags");
