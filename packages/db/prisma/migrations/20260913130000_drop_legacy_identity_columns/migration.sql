-- Spec 007 phase 4: remove the pre-tenancy identity leftovers.
--
-- - User.organizationId: superseded by OrganizationMember (phase 1). Values were
--   copied there in 20260913000000; nothing has read this column since.
-- - Contact.userId: buyers are never Users (spec 007 D1); checkout stopped
--   writing it in phase 2 and nothing reads it.
-- - UserRole CUSTOMER -> UNASSIGNED: Auth.js still creates a User row for every
--   fresh sign-in with the default role, so a non-staff value must remain; the
--   name now says what it means.

ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_userId_fkey";
DROP INDEX IF EXISTS "Contact_userId_idx";
ALTER TABLE "Contact" DROP COLUMN IF EXISTS "userId";

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_organizationId_fkey";
DROP INDEX IF EXISTS "User_organizationId_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "organizationId";

ALTER TYPE "UserRole" RENAME VALUE 'CUSTOMER' TO 'UNASSIGNED';
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'UNASSIGNED';
