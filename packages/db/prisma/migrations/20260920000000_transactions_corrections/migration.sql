-- Spec 018 phase 3: corrections on application money — adjustments, waived
-- balances, offline payments and manual refunds.
CREATE TYPE "PaymentSource" AS ENUM ('STRIPE', 'OFFLINE');
CREATE TYPE "OfflinePaymentMethod" AS ENUM ('CHEQUE', 'CASH', 'BANK_TRANSFER', 'COMPED', 'OTHER');
CREATE TYPE "AdjustmentKind" AS ENUM ('ADJUSTMENT', 'WAIVER');

ALTER TYPE "ApplicationAction" ADD VALUE 'TIER_CHANGED';
ALTER TYPE "ApplicationAction" ADD VALUE 'ADJUSTED';
ALTER TYPE "ApplicationAction" ADD VALUE 'WAIVED';
ALTER TYPE "ApplicationAction" ADD VALUE 'OFFLINE_PAID';
ALTER TYPE "ApplicationAction" ADD VALUE 'MANUAL_REFUND';

ALTER TABLE "Application" ADD COLUMN "paymentSource" "PaymentSource" NOT NULL DEFAULT 'STRIPE';
ALTER TABLE "Application" ADD COLUMN "offlinePaymentMethod" "OfflinePaymentMethod";
ALTER TABLE "Application" ADD COLUMN "offlinePaymentReference" TEXT;
ALTER TABLE "Application" ADD COLUMN "offlinePaymentRecordedById" TEXT;

ALTER TABLE "ApplicationRefund" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ApplicationAdjustment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "AdjustmentKind" NOT NULL DEFAULT 'ADJUSTMENT',
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplicationAdjustment_applicationId_idx" ON "ApplicationAdjustment"("applicationId");

ALTER TABLE "ApplicationAdjustment" ADD CONSTRAINT "ApplicationAdjustment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
