-- Online Store › Preferences › Automatic redirection: language toggle.
ALTER TABLE "Organization" ADD COLUMN "autoRedirectLanguage" BOOLEAN NOT NULL DEFAULT false;
