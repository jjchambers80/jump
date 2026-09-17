-- Spec 010 phase 2: Stripe Connect (Express) accounts per organization and the
-- account a charge was routed to. Additive; every existing PaymentTransaction is
-- a platform-account charge, so null is correct and no backfill runs.
CREATE TABLE "OrganizationStripeAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "transfersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "disabledReason" TEXT,
    "currentlyDue" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bankName" TEXT,
    "bankLast4" TEXT,
    "currency" TEXT,
    "payoutInterval" TEXT,
    "payoutAnchor" TEXT,
    "payoutDelayDays" INTEGER,
    "payoutDescriptor" TEXT,
    "lastPayoutAt" TIMESTAMP(3),
    "lastPayoutFailure" TEXT,
    "disconnectedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationStripeAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationStripeAccount_stripeAccountId_key" ON "OrganizationStripeAccount"("stripeAccountId");
CREATE UNIQUE INDEX "OrganizationStripeAccount_organizationId_mode_key" ON "OrganizationStripeAccount"("organizationId", "mode");
CREATE INDEX "OrganizationStripeAccount_stripeAccountId_idx" ON "OrganizationStripeAccount"("stripeAccountId");

ALTER TABLE "OrganizationStripeAccount" ADD CONSTRAINT "OrganizationStripeAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentTransaction" ADD COLUMN "stripeAccountId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN "applicationFee" DECIMAL(10,2);
