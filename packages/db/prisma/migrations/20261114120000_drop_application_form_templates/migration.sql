-- Spec 056: application form templates are gone. Forms start blank in the
-- setup wizard and on Contacts › Forms; event duplication copies forms directly.
DROP TABLE "ApplicationFormTemplate";
ALTER TABLE "ApplicationForm" DROP COLUMN "createdFromTemplateId";
