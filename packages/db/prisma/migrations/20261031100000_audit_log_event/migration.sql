-- Spec 048-D: the event an audit row belongs to, for the event workspace's
-- History tab. Older rows stay null.
ALTER TABLE "AuditLog" ADD COLUMN "eventId" TEXT;

CREATE INDEX "AuditLog_organizationId_eventId_createdAt_idx" ON "AuditLog"("organizationId", "eventId", "createdAt");
