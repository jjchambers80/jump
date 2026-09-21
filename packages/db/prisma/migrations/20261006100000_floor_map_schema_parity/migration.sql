-- Spec 014 phase 1 shipped a hand-written migration whose foreign keys lack ON UPDATE CASCADE and whose
-- updatedAt / layout columns carry database defaults that schema.prisma does not declare. Prisma sets both
-- columns on every write, so this only brings the migration history back in line with the schema
-- (the CI 'migration safety' replay check compares the two).
-- DropForeignKey
ALTER TABLE "Booth" DROP CONSTRAINT "Booth_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "Booth" DROP CONSTRAINT "Booth_mapId_fkey";

-- DropForeignKey
ALTER TABLE "Booth" DROP CONSTRAINT "Booth_tierId_fkey";

-- DropForeignKey
ALTER TABLE "FloorMap" DROP CONSTRAINT "FloorMap_eventId_fkey";

-- DropForeignKey
ALTER TABLE "FloorMap" DROP CONSTRAINT "FloorMap_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "FloorMap" DROP CONSTRAINT "FloorMap_underlayFileId_fkey";

-- AlterTable
ALTER TABLE "Booth" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FloorMap" ALTER COLUMN "layout" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "FloorMap" ADD CONSTRAINT "FloorMap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorMap" ADD CONSTRAINT "FloorMap_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorMap" ADD CONSTRAINT "FloorMap_underlayFileId_fkey" FOREIGN KEY ("underlayFileId") REFERENCES "StoreFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booth" ADD CONSTRAINT "Booth_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "FloorMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booth" ADD CONSTRAINT "Booth_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "ApplicationTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booth" ADD CONSTRAINT "Booth_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

