-- Shared public-resource slug persistence.
--
-- Existing Organization/Page/BlogPost values are never rewritten. Their
-- provenance is inferred conservatively: an exact normalized-title match is
-- generated; every other existing value is treated as custom.
ALTER TABLE "Organization" ADD COLUMN "slugCustomized" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Page" ADD COLUMN "slugCustomized" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BlogPost" ADD COLUMN "slugCustomized" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Organization"
SET "slugCustomized" = true
WHERE "slug" <> COALESCE(
  NULLIF(trim(BOTH '-' FROM substring(regexp_replace(regexp_replace(normalize(lower("name"), NFKD), U&'[\0300-\036f]', '', 'g'), '[^a-z0-9]+', '-', 'g') FROM 1 FOR 60)), ''),
  'org'
);

UPDATE "Page"
SET "slugCustomized" = true
WHERE "slug" <> COALESCE(
  NULLIF(trim(BOTH '-' FROM substring(regexp_replace(regexp_replace(normalize(lower("title"), NFKD), U&'[\0300-\036f]', '', 'g'), '[^a-z0-9]+', '-', 'g') FROM 1 FOR 60)), ''),
  "id"
);

-- BlogPost.handle remains the physical slug column for backwards compatibility
-- with the existing blog API and routes.
UPDATE "BlogPost"
SET "slugCustomized" = true
WHERE "handle" <> COALESCE(
  NULLIF(trim(BOTH '-' FROM substring(regexp_replace(regexp_replace(normalize(lower("title"), NFKD), U&'[\0300-\036f]', '', 'g'), '[^a-z0-9]+', '-', 'g') FROM 1 FOR 60)), ''),
  "id"
);

ALTER TABLE "Venue" ADD COLUMN "slug" TEXT;
ALTER TABLE "Venue" ADD COLUMN "slugCustomized" BOOLEAN NOT NULL DEFAULT false;

WITH base AS (
  SELECT
    id,
    COALESCE(
      NULLIF(trim(BOTH '-' FROM substring(regexp_replace(regexp_replace(normalize(lower("name"), NFKD), U&'[\0300-\036f]', '', 'g'), '[^a-z0-9]+', '-', 'g') FROM 1 FOR 60)), ''),
      'venue'
    ) AS value,
    "createdAt"
  FROM "Venue"
), ranked AS (
  SELECT id, value, row_number() OVER (PARTITION BY value ORDER BY "createdAt", id) AS n
  FROM base
)
UPDATE "Venue" v
SET "slug" = CASE
  WHEN r.n = 1 THEN r.value
  ELSE rtrim(substring(r.value FROM 1 FOR (60 - length(r.n::text) - 1)), '-') || '-' || r.n
END
FROM ranked r
WHERE v.id = r.id;

-- A generated numeric suffix can itself match another title (for example,
-- "Hall" + duplicate "Hall" beside "Hall 2"). Re-key every colliding group
-- from the row id and repeat in case that value matched another natural slug.
-- md5 keeps every fallback comfortably inside the 60-character contract.
DO $$
BEGIN
  WHILE EXISTS (
    SELECT 1 FROM "Venue" GROUP BY "slug" HAVING count(*) > 1
  ) LOOP
    UPDATE "Venue" v
    SET "slug" = 'venue-' || md5(v.id)
    WHERE v."slug" IN (
      SELECT "slug" FROM "Venue" GROUP BY "slug" HAVING count(*) > 1
    );
  END LOOP;
END $$;

ALTER TABLE "Venue" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Venue_slug_key" ON "Venue"("slug");

ALTER TABLE "Event" ADD COLUMN "slug" TEXT;
ALTER TABLE "Event" ADD COLUMN "slugCustomized" BOOLEAN NOT NULL DEFAULT false;

WITH base AS (
  SELECT
    id,
    COALESCE(
      NULLIF(trim(BOTH '-' FROM substring(regexp_replace(regexp_replace(normalize(lower("name"), NFKD), U&'[\0300-\036f]', '', 'g'), '[^a-z0-9]+', '-', 'g') FROM 1 FOR 60)), ''),
      'event'
    ) AS value,
    "createdAt"
  FROM "Event"
), ranked AS (
  SELECT id, value, row_number() OVER (PARTITION BY value ORDER BY "createdAt", id) AS n
  FROM base
)
UPDATE "Event" e
SET "slug" = CASE
  WHEN r.n = 1 THEN r.value
  ELSE rtrim(substring(r.value FROM 1 FOR (60 - length(r.n::text) - 1)), '-') || '-' || r.n
END
FROM ranked r
WHERE e.id = r.id;

DO $$
BEGIN
  WHILE EXISTS (
    SELECT 1 FROM "Event" GROUP BY "slug" HAVING count(*) > 1
  ) LOOP
    UPDATE "Event" e
    SET "slug" = 'event-' || md5(e.id)
    WHERE e."slug" IN (
      SELECT "slug" FROM "Event" GROUP BY "slug" HAVING count(*) > 1
    );
  END LOOP;
END $$;

ALTER TABLE "Event" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");
