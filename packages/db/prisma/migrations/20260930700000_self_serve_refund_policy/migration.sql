-- Spec 031 phase 2: self-serve refund policy + fee retained on Refund rows
CREATE TYPE "SelfServeRefundFeeType" AS ENUM ('NONE', 'FIXED', 'PERCENT');

ALTER TABLE "Organization"
  ADD COLUMN "selfServeRefundsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "selfServeRefundCutoffHours" INTEGER,
  ADD COLUMN "selfServeRefundFeeType" "SelfServeRefundFeeType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "selfServeRefundFeeValue" DECIMAL(10,2);

ALTER TABLE "Refund" ADD COLUMN "feeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
