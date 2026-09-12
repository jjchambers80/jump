-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('LIGHT', 'DARK', 'SYSTEM', 'USER');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "themeMode" "ThemeMode" NOT NULL DEFAULT 'USER';
