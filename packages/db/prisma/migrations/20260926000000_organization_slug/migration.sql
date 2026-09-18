-- Organization.slug: URL handle for /admin/organization/[slug]. Backfilled
-- from the name ("Raleigh Retro Gamers" -> "raleigh-retro-gamers"); duplicates
-- get -2, -3, ... by creation order.
ALTER TABLE "Organization" ADD COLUMN "slug" TEXT;

WITH base AS (
  SELECT
    id,
    "createdAt",
    COALESCE(
      NULLIF(
        left(
          regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'),
          60
        ),
        ''
      ),
      'org'
    ) AS b
  FROM "Organization"
),
numbered AS (
  SELECT id, b, row_number() OVER (PARTITION BY b ORDER BY "createdAt", id) AS n FROM base
)
UPDATE "Organization" o
SET "slug" = CASE WHEN n.n = 1 THEN n.b ELSE n.b || '-' || n.n END
FROM numbered n
WHERE o.id = n.id;

-- Guard against a generated "-N" suffix colliding with an existing name
-- (e.g. "Acme 2" next to two "Acme"s): fall back to the id.
UPDATE "Organization" o
SET "slug" = o."slug" || '-' || o.id
WHERE o."slug" IN (
  SELECT "slug" FROM "Organization" GROUP BY "slug" HAVING count(*) > 1
)
AND o.id <> (
  SELECT min(id) FROM "Organization" d WHERE d."slug" = o."slug"
);

ALTER TABLE "Organization" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
