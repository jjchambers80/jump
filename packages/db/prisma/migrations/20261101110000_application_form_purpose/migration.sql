-- Spec 050 §6.2 (card 050-B): what each application form is for.
CREATE TYPE "ApplicationFormPurpose" AS ENUM ('VENDOR', 'SPONSOR', 'PRESS', 'PANEL', 'SPECIAL_GUEST', 'VOLUNTEER', 'OTHER');

-- Constant default: no table rewrite.
ALTER TABLE "ApplicationForm" ADD COLUMN "purpose" "ApplicationFormPurpose" NOT NULL DEFAULT 'OTHER';

-- One-time backfill from the name patterns the storefront "Get involved" pills
-- used before this column existed (GetInvolved.tsx), first match wins.
-- Unmatched PAID event forms sold vendor space; everything else stays OTHER.
-- Standing forms get the same rules (used only for labels).
UPDATE "ApplicationForm"
SET "purpose" = (
  CASE
    WHEN "name" ~* 'vendor|exhibit|booth|merchant|artist' THEN 'VENDOR'
    WHEN "name" ~* 'sponsor' THEN 'SPONSOR'
    WHEN "name" ~* 'press|media' THEN 'PRESS'
    WHEN "name" ~* 'panel|speaker|talk' THEN 'PANEL'
    WHEN "name" ~* 'volunteer' THEN 'VOLUNTEER'
    WHEN "name" ~* 'guest|celebrity|talent' THEN 'SPECIAL_GUEST'
    WHEN "kind" = 'PAID' AND "eventId" IS NOT NULL THEN 'VENDOR'
    ELSE 'OTHER'
  END
)::"ApplicationFormPurpose"
WHERE "purpose" = 'OTHER';
