-- Business details split into fields a form asks one by one. collectBusiness
-- stays until a follow-up drops it, so the previous release keeps working
-- while this one deploys.
ALTER TABLE "ApplicationForm" ADD COLUMN "businessFields" TEXT[] DEFAULT ARRAY['businessName', 'description', 'website', 'socials', 'photos']::TEXT[];

UPDATE "ApplicationForm" SET "businessFields" = ARRAY[]::TEXT[] WHERE "collectBusiness" = false;
