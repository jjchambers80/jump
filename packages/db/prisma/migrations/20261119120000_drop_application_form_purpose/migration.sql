-- Forms have no type: no code reads or writes it since the previous release.
ALTER TABLE "ApplicationForm" DROP COLUMN "purpose";
DROP TYPE "ApplicationFormPurpose";
