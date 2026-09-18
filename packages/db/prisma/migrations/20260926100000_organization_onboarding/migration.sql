-- Spec 022: organization onboarding.
-- Existing organizations are treated as already onboarded so none disappears
-- from the org switcher on deploy. No PlatformCustomer rows are backfilled:
-- a missing row means the FREE plan.

CREATE TYPE "PlatformPlan" AS ENUM ('FREE', 'STARTER');

ALTER TABLE "Organization"
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "setupGuideDismissedAt" TIMESTAMP(3);

UPDATE "Organization" SET "onboardingCompletedAt" = "createdAt";

CREATE TABLE "PlatformCustomer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "plan" "PlatformPlan" NOT NULL DEFAULT 'FREE',
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "subscriptionStatus" TEXT,
  "trialEndsAt" TIMESTAMP(3),
  "currentPeriodEndsAt" TIMESTAMP(3),
  "onboarding" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlatformCustomer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformCustomer_organizationId_key" ON "PlatformCustomer"("organizationId");
CREATE UNIQUE INDEX "PlatformCustomer_stripeCustomerId_key" ON "PlatformCustomer"("stripeCustomerId");
CREATE UNIQUE INDEX "PlatformCustomer_stripeSubscriptionId_key" ON "PlatformCustomer"("stripeSubscriptionId");
CREATE INDEX "PlatformCustomer_ownerUserId_idx" ON "PlatformCustomer"("ownerUserId");

ALTER TABLE "PlatformCustomer"
  ADD CONSTRAINT "PlatformCustomer_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformCustomer"
  ADD CONSTRAINT "PlatformCustomer_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
