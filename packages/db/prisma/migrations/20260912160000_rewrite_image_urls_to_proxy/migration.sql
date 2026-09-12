-- Rewrite stored image URLs to the backend proxy route.
--
-- Rows uploaded before ImageService.formatImageResponse switched to proxy URLs
-- hold either a direct private-bucket URL (https://<endpoint>/<bucket>/<key>,
-- returns 403 anonymously) or a local static path (/uploads/images/<key>).
-- Both are replaced with /images/<imageId>/<hash>/<variant>, which the backend
-- serves from whichever storage backend is configured.
--
-- Legacy /uploads/logos/<uuid> rows have no Image record and are left alone
-- (the underlying files no longer exist). Idempotent: rows already starting
-- with /images/ are skipped.

UPDATE "Event" e
SET "logoUrl" = '/images/' || i.id || '/' || f.hash || '/original'
FROM "Image" i
JOIN "File" f ON f.id = i."fileId"
WHERE e."imageId" = i.id
  AND e."logoUrl" IS NOT NULL
  AND e."logoUrl" NOT LIKE '/images/%';

UPDATE "Venue" v
SET "logoUrl" = '/images/' || i.id || '/' || f.hash || '/original'
FROM "Image" i
JOIN "File" f ON f.id = i."fileId"
WHERE v."imageId" = i.id
  AND v."logoUrl" IS NOT NULL
  AND v."logoUrl" NOT LIKE '/images/%';

UPDATE "Organization" o
SET "logoUrl" = '/images/' || i.id || '/' || f.hash || '/original'
FROM "Image" i
JOIN "File" f ON f.id = i."fileId"
WHERE o."logoImageId" = i.id
  AND o."logoUrl" IS NOT NULL
  AND o."logoUrl" NOT LIKE '/images/%';

UPDATE "Organization" o
SET "coverUrl" = '/images/' || i.id || '/' || f.hash || '/original'
FROM "Image" i
JOIN "File" f ON f.id = i."fileId"
WHERE o."coverImageId" = i.id
  AND o."coverUrl" IS NOT NULL
  AND o."coverUrl" NOT LIKE '/images/%';
