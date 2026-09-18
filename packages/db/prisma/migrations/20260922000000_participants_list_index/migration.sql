-- Participants (spec 019 phase 1): the organization-wide submissions list
-- orders by submittedAt within one organization.
CREATE INDEX IF NOT EXISTS "Application_organizationId_submittedAt_idx" ON "Application"("organizationId", "submittedAt");
