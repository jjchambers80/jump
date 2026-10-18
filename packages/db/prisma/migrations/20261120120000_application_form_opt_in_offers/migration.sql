-- Organizer settings: whether the apply form offers the account and marketing opt-ins.
ALTER TABLE "ApplicationForm" ADD COLUMN "offerAccount" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ApplicationForm" ADD COLUMN "offerMarketing" BOOLEAN NOT NULL DEFAULT true;
