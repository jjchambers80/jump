-- Spec 048: append-only audit trail (AuditLog).
-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'DEVELOPER_TOKEN', 'AGENT', 'SYSTEM');
-- CreateEnum
CREATE TYPE "AuditOperation" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'BULK_CREATE', 'BULK_UPDATE', 'BULK_DELETE', 'EXPORT', 'OTHER');
-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "actorRole" TEXT,
    "viaPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "developerTokenId" TEXT,
    "agentGrantId" TEXT,
    "agentClientName" TEXT,
    "action" TEXT NOT NULL,
    "operation" "AuditOperation" NOT NULL,
    "feature" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "changes" JSONB,
    "meta" JSONB,
    "source" TEXT NOT NULL,
    "requestId" TEXT,
    "method" TEXT,
    "route" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "location" TEXT,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entityType_entityId_createdAt_idx" ON "AuditLog"("organizationId", "entityType", "entityId", "createdAt");
-- CreateIndex
CREATE INDEX "AuditLog_organizationId_actorUserId_createdAt_idx" ON "AuditLog"("organizationId", "actorUserId", "createdAt");
-- CreateIndex
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");
-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- Rows are immutable: refuse UPDATE at the database. DELETE stays open for
-- the retention sweep (AuditLogService.sweep).
CREATE FUNCTION "audit_log_refuse_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_no_update" BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_refuse_update"();
