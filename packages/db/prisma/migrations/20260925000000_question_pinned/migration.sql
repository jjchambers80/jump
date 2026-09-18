-- Spec 019 follow-up: pinned answer columns on the submissions list.
ALTER TABLE "ApplicationQuestion" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
