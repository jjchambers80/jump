-- Spec 010 phase 1: per-organization payment configuration. A null suffix
-- derives from the organization name; an empty method list keeps today's
-- cards-and-wallets checkout, so no backfill is needed.
ALTER TABLE "Organization" ADD COLUMN "statementDescriptorSuffix" TEXT;
ALTER TABLE "Organization" ADD COLUMN "enabledPaymentMethods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Organization" ADD COLUMN "paymentSettingsUpdatedAt" TIMESTAMP(3);
