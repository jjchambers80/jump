-- Remove USER from ThemeMode; SYSTEM becomes the default.
-- Postgres cannot drop an enum value in place, so migrate rows, then swap the type.
UPDATE "Organization" SET "themeMode" = 'SYSTEM' WHERE "themeMode" = 'USER';

ALTER TABLE "Organization" ALTER COLUMN "themeMode" DROP DEFAULT;

CREATE TYPE "ThemeMode_new" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');
ALTER TABLE "Organization" ALTER COLUMN "themeMode" TYPE "ThemeMode_new" USING ("themeMode"::text::"ThemeMode_new");
DROP TYPE "ThemeMode";
ALTER TYPE "ThemeMode_new" RENAME TO "ThemeMode";

ALTER TABLE "Organization" ALTER COLUMN "themeMode" SET DEFAULT 'SYSTEM';
