-- Spec 014 phase 1: Floor maps, booths, and manual booth assignments.
-- Adds FloorMap (one per event), Booth rows, enums, and mapBound on ApplicationTier.

-- Enums
CREATE TYPE "public"."FloorMapStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "public"."BoothKind" AS ENUM ('BOOTH', 'TABLE');
CREATE TYPE "public"."BoothStatus" AS ENUM ('AVAILABLE', 'HELD', 'SOLD', 'RESERVED', 'BLOCKED');

-- FloorMap: one optional map per event
CREATE TABLE "FloorMap" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "FloorMapStatus" NOT NULL DEFAULT 'DRAFT',
  "unit" TEXT NOT NULL DEFAULT 'ft',
  "gridSize" INTEGER NOT NULL DEFAULT 10,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "underlayFileId" TEXT,
  "underlayOpacity" INTEGER NOT NULL DEFAULT 40,
  "layout" JSONB NOT NULL DEFAULT '{"version":1,"elements":[]}',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FloorMap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FloorMap_eventId_key" UNIQUE ("eventId")
);

CREATE INDEX "FloorMap_organizationId_idx" ON "FloorMap"("organizationId");

ALTER TABLE "FloorMap" ADD CONSTRAINT "FloorMap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "FloorMap" ADD CONSTRAINT "FloorMap_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE;
ALTER TABLE "FloorMap" ADD CONSTRAINT "FloorMap_underlayFileId_fkey" FOREIGN KEY ("underlayFileId") REFERENCES "StoreFile"("id") ON DELETE SET NULL;

-- Booth: individual spaces on a floor map
CREATE TABLE "Booth" (
  "id" TEXT NOT NULL,
  "mapId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "kind" "BoothKind" NOT NULL DEFAULT 'BOOTH',
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "w" INTEGER NOT NULL,
  "h" INTEGER NOT NULL,
  "rotation" INTEGER NOT NULL DEFAULT 0,
  "tierId" TEXT,
  "status" "BoothStatus" NOT NULL DEFAULT 'AVAILABLE',
  "applicationId" TEXT,
  "holdApplicationId" TEXT,
  "holdExpiresAt" TIMESTAMP(3),
  "assignedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Booth_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Booth_applicationId_key" UNIQUE ("applicationId"),
  CONSTRAINT "Booth_mapId_label_key" UNIQUE ("mapId", "label")
);

CREATE INDEX "Booth_mapId_status_idx" ON "Booth"("mapId", "status");
CREATE INDEX "Booth_tierId_idx" ON "Booth"("tierId");

ALTER TABLE "Booth" ADD CONSTRAINT "Booth_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "FloorMap"("id") ON DELETE CASCADE;
ALTER TABLE "Booth" ADD CONSTRAINT "Booth_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "ApplicationTier"("id") ON DELETE SET NULL;
ALTER TABLE "Booth" ADD CONSTRAINT "Booth_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL;

-- ApplicationTier.mapBound (spec 014): when true, quantityTotal is derived from booths
ALTER TABLE "ApplicationTier" ADD COLUMN "mapBound" BOOLEAN NOT NULL DEFAULT false;