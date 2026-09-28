-- Spec 038: online store themes (theme library, documents, full-state revisions).

-- CreateEnum
CREATE TYPE "ThemeRole" AS ENUM ('MAIN', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "ThemeDocumentKind" AS ENUM ('HEADER_GROUP', 'FOOTER_GROUP', 'TEMPLATE', 'PAGE');

-- AlterEnum
ALTER TYPE "ContentRefKind" ADD VALUE 'THEME';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "themesEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "presetKey" TEXT NOT NULL,
    "presetVersion" TEXT NOT NULL,
    "role" "ThemeRole" NOT NULL DEFAULT 'UNPUBLISHED',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "content" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "lastSavedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSavedById" TEXT,
    "importedFrom" TEXT,
    "scheduledPublishAt" TIMESTAMP(3),
    "scheduledById" TEXT,
    "scheduleError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeDocument" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "kind" "ThemeDocumentKind" NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeRevision" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedKeys" TEXT[],
    "savedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Theme_organizationId_role_idx" ON "Theme"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeDocument_themeId_key_key" ON "ThemeDocument"("themeId", "key");

-- CreateIndex
CREATE INDEX "ThemeRevision_themeId_createdAt_idx" ON "ThemeRevision"("themeId", "createdAt");

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeDocument" ADD CONSTRAINT "ThemeDocument_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeRevision" ADD CONSTRAINT "ThemeRevision_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One MAIN (live) theme per organization; ThemeService.ensureMain also locks the organization row.
CREATE UNIQUE INDEX "Theme_one_main_per_org" ON "Theme"("organizationId") WHERE "role" = 'MAIN';

-- At most one scheduled publish per organization (card 038O).
CREATE UNIQUE INDEX "Theme_one_scheduled_per_org" ON "Theme"("organizationId") WHERE "scheduledPublishAt" IS NOT NULL;
