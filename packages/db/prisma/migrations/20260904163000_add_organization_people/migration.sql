-- CreateTable
CREATE TABLE "OrganizationPerson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "isAccountRepresentative" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationPerson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationPerson_organizationId_idx" ON "OrganizationPerson"("organizationId");

-- Enforce at most one account representative per organization without limiting ordinary people.
CREATE UNIQUE INDEX "OrganizationPerson_one_account_representative_per_org" ON "OrganizationPerson" ("organizationId") WHERE "isAccountRepresentative" = true;

-- AddForeignKey
ALTER TABLE "OrganizationPerson" ADD CONSTRAINT "OrganizationPerson_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
