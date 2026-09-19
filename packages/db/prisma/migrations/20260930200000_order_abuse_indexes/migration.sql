-- Spec 020 phase 1: indexes for the abandoned-checkout sweep (status, createdAt)
-- and the per-buyer PENDING hold cap (contactId, eventId, status).

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_contactId_eventId_status_idx" ON "Order"("contactId", "eventId", "status");
