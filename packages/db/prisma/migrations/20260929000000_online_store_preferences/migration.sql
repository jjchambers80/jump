-- Online Store › Preferences: store access (private mode + password), homepage
-- search engine listing, and the automatic language redirection toggle.
ALTER TABLE "Organization" ADD COLUMN "storefrontPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "storefrontPasswordHash" TEXT;
ALTER TABLE "Organization" ADD COLUMN "storefrontMessage" TEXT;
ALTER TABLE "Organization" ADD COLUMN "seoTitle" TEXT;
ALTER TABLE "Organization" ADD COLUMN "seoDescription" TEXT;
ALTER TABLE "Organization" ADD COLUMN "autoRedirectLanguage" BOOLEAN NOT NULL DEFAULT false;
