-- Spec 056: a form can ask for an email only. Existing forms keep asking for a name.
ALTER TABLE "ApplicationForm" ADD COLUMN "collectName" BOOLEAN NOT NULL DEFAULT true;
