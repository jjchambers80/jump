-- Spec 009 phase 3: per-organization tax-inclusive pricing (off by default;
-- existing behaviour is tax added on top of the listed tier price).
ALTER TABLE "Organization" ADD COLUMN "taxInclusivePricing" BOOLEAN NOT NULL DEFAULT false;
