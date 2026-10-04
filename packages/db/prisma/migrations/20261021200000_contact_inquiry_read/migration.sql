-- Spec 042: admin inbox for contact-form messages; null readAt = unread.
ALTER TABLE "ContactInquiry" ADD COLUMN "readAt" TIMESTAMP(3);
CREATE INDEX "ContactInquiry_organizationId_readAt_idx" ON "ContactInquiry"("organizationId", "readAt");
