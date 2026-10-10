-- Spec 049: the organization owns its brand identity (Settings › Brand).
ALTER TABLE "Organization" ADD COLUMN     "brandSecondaryColor" TEXT,
ADD COLUMN     "shortDescription" TEXT,
ADD COLUMN     "slogan" TEXT,
ADD COLUMN     "socialLinks" JSONB,
ADD COLUMN     "squareLogoImageId" TEXT,
ADD COLUMN     "squareLogoUrl" TEXT;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_squareLogoImageId_fkey" FOREIGN KEY ("squareLogoImageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One-time copy from each organization's MAIN theme into the empty brand
-- columns: settings.brand.headline → slogan, settings.brand.description →
-- shortDescription, https settings.social links → socialLinks. Theme values
-- stay in place as overrides with identical values, so nothing changes visually.
WITH main AS (
  SELECT DISTINCT ON ("organizationId") "organizationId", "settings"
  FROM "Theme"
  WHERE "role" = 'MAIN'
  ORDER BY "organizationId", "updatedAt" DESC
),
src AS (
  SELECT
    m."organizationId",
    NULLIF(btrim(m."settings"->'brand'->>'headline'), '') AS slogan,
    NULLIF(btrim(m."settings"->'brand'->>'description'), '') AS "shortDescription",
    (
      SELECT jsonb_object_agg(s.key, s.value)
      FROM jsonb_each_text(
        CASE WHEN jsonb_typeof(m."settings"->'social') = 'object' THEN m."settings"->'social' ELSE '{}'::jsonb END
      ) AS s
      WHERE s.value LIKE 'https://%'
    ) AS "socialLinks"
  FROM main m
)
UPDATE "Organization" o
SET
  "slogan" = COALESCE(o."slogan", src.slogan),
  "shortDescription" = COALESCE(o."shortDescription", src."shortDescription"),
  "socialLinks" = COALESCE(o."socialLinks", src."socialLinks")
FROM src
WHERE o."id" = src."organizationId"
  AND (src.slogan IS NOT NULL OR src."shortDescription" IS NOT NULL OR src."socialLinks" IS NOT NULL);
