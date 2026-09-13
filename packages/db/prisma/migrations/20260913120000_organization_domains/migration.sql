-- Spec 007 phase 3: white-label custom domains per organization.

CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'ACTIVE', 'FAILED');

CREATE TABLE "OrganizationDomain" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'PENDING',
    "verificationToken" TEXT NOT NULL,
    "cnameTarget" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "railwayDomainId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "failingSince" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationDomain_hostname_key" ON "OrganizationDomain"("hostname");
CREATE INDEX "OrganizationDomain_organizationId_idx" ON "OrganizationDomain"("organizationId");
CREATE INDEX "OrganizationDomain_status_idx" ON "OrganizationDomain"("status");

ALTER TABLE "OrganizationDomain" ADD CONSTRAINT "OrganizationDomain_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
