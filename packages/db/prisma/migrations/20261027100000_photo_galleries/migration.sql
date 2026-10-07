-- AlterEnum
ALTER TYPE "ContentRefKind" ADD VALUE 'GALLERY';

-- CreateTable
CREATE TABLE "Gallery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gallery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GallerySection" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "title" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "GallerySection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "altText" TEXT,
    "decorative" BOOLEAN NOT NULL DEFAULT false,
    "caption" TEXT,

    CONSTRAINT "GalleryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Gallery_organizationId_handle_key" ON "Gallery"("organizationId", "handle");

-- CreateIndex
CREATE INDEX "GallerySection_galleryId_position_idx" ON "GallerySection"("galleryId", "position");

-- CreateIndex
CREATE INDEX "GalleryItem_sectionId_position_idx" ON "GalleryItem"("sectionId", "position");

-- CreateIndex
CREATE INDEX "GalleryItem_fileId_idx" ON "GalleryItem"("fileId");

-- AddForeignKey
ALTER TABLE "Gallery" ADD CONSTRAINT "Gallery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GallerySection" ADD CONSTRAINT "GallerySection_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryItem" ADD CONSTRAINT "GalleryItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "GallerySection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryItem" ADD CONSTRAINT "GalleryItem_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoreFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

