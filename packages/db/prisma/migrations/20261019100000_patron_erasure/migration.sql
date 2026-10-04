-- Spec 040 card D: "Delete my data" — a grace period, then anonymization.

-- AlterEnum
ALTER TYPE "ContactCommentKind" ADD VALUE 'ERASURE_SCHEDULED';
ALTER TYPE "ContactCommentKind" ADD VALUE 'ERASURE_CANCELLED';
ALTER TYPE "ContactCommentKind" ADD VALUE 'ANONYMIZED';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "erasureScheduledAt" TIMESTAMP(3),
ADD COLUMN "anonymizedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Contact_erasureScheduledAt_idx" ON "Contact"("erasureScheduledAt");

-- CreateTable
CREATE TABLE "ErasureSuppression" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErasureSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErasureSuppression_organizationId_emailHash_key" ON "ErasureSuppression"("organizationId", "emailHash");

-- AddForeignKey
ALTER TABLE "ErasureSuppression" ADD CONSTRAINT "ErasureSuppression_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
