-- Spec 037 phase 6: cleanup.
--
-- 1. Every event add-on is an offering of a saved add-on (AddOn.productId
--    NOT NULL) and a saved add-on is offered at most once per event. Rows the
--    phase 4 backfill (`db:backfill:037-add-ons`) did not reach — a database
--    that never ran it — are linked here first: one saved add-on per
--    organization and exact name, created when missing. Production ran the
--    backfill on 2026-09-26 (1 add-on linked, 0 conflicts, 0 same-event
--    duplicates), so this is a no-op there.
-- 2. The FK becomes RESTRICT: saved add-ons are archived, never deleted
--    while an event offers them (SET NULL would violate NOT NULL).
-- 3. ApplicationTier.mapBound is dropped: phase 5 derives map binding from
--    the published map's booths and nothing reads the column.

INSERT INTO "AddOnProduct" ("id", "organizationId", "name", "description", "defaultPrice", "scope", "taxable", "isArchived", "createdAt", "updatedAt")
SELECT DISTINCT ON (v."organizationId", a."name")
       'aop' || substr(md5(random()::text || a."id"), 1, 22),
       v."organizationId", a."name", a."description", a."price", a."scope", a."taxable", false, now(), now()
FROM "AddOn" a
JOIN "Event" e ON e."id" = a."eventId"
JOIN "Venue" v ON v."id" = e."venueId"
WHERE a."productId" IS NULL
ORDER BY v."organizationId", a."name", a."createdAt" DESC
ON CONFLICT ("organizationId", "name") DO NOTHING;

UPDATE "AddOn" a
SET "productId" = p."id"
FROM "Event" e, "Venue" v, "AddOnProduct" p
WHERE a."productId" IS NULL
  AND e."id" = a."eventId"
  AND v."id" = e."venueId"
  AND p."organizationId" = v."organizationId"
  AND p."name" = a."name";

ALTER TABLE "AddOn" DROP CONSTRAINT "AddOn_productId_fkey";
ALTER TABLE "AddOn" ALTER COLUMN "productId" SET NOT NULL;
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "AddOnProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "AddOn_eventId_productId_key" ON "AddOn"("eventId", "productId");

ALTER TABLE "ApplicationTier" DROP COLUMN "mapBound";
