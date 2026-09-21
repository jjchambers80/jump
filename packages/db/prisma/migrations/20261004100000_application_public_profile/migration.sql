-- Spec 014 phase 3: organizer-controlled public vendor directory visibility.
ALTER TABLE "Application"
ADD COLUMN "publicProfile" BOOLEAN NOT NULL DEFAULT true;
