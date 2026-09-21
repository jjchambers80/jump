-- Spec 032 phase 1: contact phone numbers and organizer-defined tags.
ALTER TABLE "Contact" ADD COLUMN "phone" TEXT;
ALTER TABLE "Contact" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "Contact_tags_idx" ON "Contact" USING GIN ("tags");