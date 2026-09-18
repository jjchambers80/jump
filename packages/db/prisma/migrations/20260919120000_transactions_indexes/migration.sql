-- Spec 018 phase 1: indexes for the transactions union (orders + application payments).
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX "Application_organizationId_paidAt_idx" ON "Application"("organizationId", "paidAt");
CREATE INDEX "Application_organizationId_submittedAt_idx" ON "Application"("organizationId", "submittedAt");
