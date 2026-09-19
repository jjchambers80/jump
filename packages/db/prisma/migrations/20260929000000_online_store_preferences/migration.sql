-- Online Store › Preferences: store access (private mode + password) and the
-- homepage search engine listing.
ALTER TABLE "Organization" ADD COLUMN "storefrontPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "storefrontPasswordHash" TEXT;
ALTER TABLE "Organization" ADD COLUMN "storefrontMessage" TEXT;
ALTER TABLE "Organization" ADD COLUMN "seoTitle" TEXT;
ALTER TABLE "Organization" ADD COLUMN "seoDescription" TEXT;
