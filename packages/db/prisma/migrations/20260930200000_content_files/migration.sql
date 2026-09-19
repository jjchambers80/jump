-- Spec 025: Content › Files — organization-scoped assets over the shared
-- content-addressed File table, plus "Used in" references.
CREATE TYPE "ContentRefKind" AS ENUM ('PAGE', 'BLOG_POST');

CREATE TABLE "StoreFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "imageId" TEXT,
    "name" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "altText" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreFileReference" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" "ContentRefKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,

    CONSTRAINT "StoreFileReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreFile_imageId_key" ON "StoreFile"("imageId");
CREATE INDEX "StoreFile_organizationId_createdAt_idx" ON "StoreFile"("organizationId", "createdAt");
CREATE INDEX "StoreFile_organizationId_name_idx" ON "StoreFile"("organizationId", "name");
CREATE INDEX "StoreFile_fileId_idx" ON "StoreFile"("fileId");
CREATE UNIQUE INDEX "StoreFileReference_fileId_kind_targetId_field_key" ON "StoreFileReference"("fileId", "kind", "targetId", "field");
CREATE INDEX "StoreFileReference_kind_targetId_idx" ON "StoreFileReference"("kind", "targetId");

ALTER TABLE "StoreFile" ADD CONSTRAINT "StoreFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreFile" ADD CONSTRAINT "StoreFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreFile" ADD CONSTRAINT "StoreFile_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreFileReference" ADD CONSTRAINT "StoreFileReference_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoreFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
