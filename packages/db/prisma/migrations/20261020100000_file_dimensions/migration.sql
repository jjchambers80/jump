-- Intrinsic pixel size of image files, so pages can reserve an image's box
-- before it loads (storefront header logo: no layout shift). Null for PDFs
-- and for files uploaded before this column (backfill-image-dimensions.js).
ALTER TABLE "File" ADD COLUMN "width" INTEGER;
ALTER TABLE "File" ADD COLUMN "height" INTEGER;
