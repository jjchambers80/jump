-- DropIndex
DROP INDEX IF EXISTS "Refund_stripeRefundId_key";

-- CreateTable
CREATE TABLE "TierPreset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "minPerOrder" INTEGER,
    "maxPerOrder" INTEGER,
    "visibility" "TierVisibility" NOT NULL DEFAULT 'PUBLIC',
    "isRefundable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TierPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TierPreset_organizationId_idx" ON "TierPreset"("organizationId");

-- AddForeignKey
ALTER TABLE "TierPreset" ADD CONSTRAINT "TierPreset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
