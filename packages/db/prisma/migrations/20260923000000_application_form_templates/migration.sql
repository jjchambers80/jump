-- Spec 019 phase 2: reusable application form templates (JSON snapshots per
-- organization) and the informational back-reference on forms created from one.
CREATE TABLE "ApplicationFormTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ApplicationFormKind" NOT NULL,
    "definition" JSONB NOT NULL,
    "sourceFormId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationFormTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApplicationFormTemplate_organizationId_name_key" ON "ApplicationFormTemplate"("organizationId", "name");
CREATE INDEX "ApplicationFormTemplate_organizationId_updatedAt_idx" ON "ApplicationFormTemplate"("organizationId", "updatedAt");

ALTER TABLE "ApplicationFormTemplate" ADD CONSTRAINT "ApplicationFormTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApplicationForm" ADD COLUMN "createdFromTemplateId" TEXT;
