-- Spec 052: Settings › Policies (written store policies stored as Page rows).
CREATE TYPE "PolicyType" AS ENUM ('REFUND', 'PRIVACY', 'TERMS', 'SHIPPING', 'CONTACT', 'LEGAL_NOTICE', 'ACCESSIBILITY');

ALTER TABLE "Page" ADD COLUMN "policyType" "PolicyType";
CREATE UNIQUE INDEX "Page_organizationId_policyType_key" ON "Page"("organizationId", "policyType");

ALTER TABLE "Organization" ADD COLUMN "showPoliciesInFooter" BOOLEAN NOT NULL DEFAULT true;
