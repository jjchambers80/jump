-- Search engine listing for Online Store pages: URL handle + SEO title/description.
ALTER TABLE "Page" ADD COLUMN "slug" TEXT;
ALTER TABLE "Page" ADD COLUMN "seoTitle" TEXT;
ALTER TABLE "Page" ADD COLUMN "seoDescription" TEXT;

-- Backfill existing rows from the title; fall back to the id when the title
-- has no letters or digits, and suffix the id on a clash within the organization.
UPDATE "Page"
SET "slug" = COALESCE(
  NULLIF(trim(BOTH '-' FROM regexp_replace(lower("title"), '[^a-z0-9]+', '-', 'g')), ''),
  "id"
);
UPDATE "Page" p
SET "slug" = p."slug" || '-' || p."id"
WHERE EXISTS (
  SELECT 1 FROM "Page" q
  WHERE q."organizationId" = p."organizationId" AND q."slug" = p."slug" AND q."id" < p."id"
);

ALTER TABLE "Page" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Page_organizationId_slug_key" ON "Page"("organizationId", "slug");
