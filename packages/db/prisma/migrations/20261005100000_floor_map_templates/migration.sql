-- Spec 014 phase 3: organization-scoped reusable vector map templates.
CREATE TABLE "FloorMapTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "sourceMapId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorMapTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FloorMapTemplate_organizationId_name_key" ON "FloorMapTemplate"("organizationId", "name");
CREATE INDEX "FloorMapTemplate_organizationId_updatedAt_idx" ON "FloorMapTemplate"("organizationId", "updatedAt");

ALTER TABLE "FloorMapTemplate"
ADD CONSTRAINT "FloorMapTemplate_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FloorMap" ADD COLUMN "createdFromTemplateId" TEXT;
