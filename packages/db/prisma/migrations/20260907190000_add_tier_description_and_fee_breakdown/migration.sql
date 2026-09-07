-- AlterTable: PriceTier - add optional description field
ALTER TABLE "PriceTier" ADD COLUMN "description" TEXT;

-- AlterTable: Order - add fee breakdown fields for FTC all-in pricing compliance
ALTER TABLE "Order" ADD COLUMN "subtotalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
                    ADD COLUMN "platformFeeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
                    ADD COLUMN "processingFeeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
                    ADD COLUMN "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable: OrderItem - add per-item fee breakdown
ALTER TABLE "OrderItem" ADD COLUMN "platformFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
                        ADD COLUMN "processingFee" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Backfill existing orders: subtotalAmount = totalAmount (no fees were charged)
UPDATE "Order" SET "subtotalAmount" = "totalAmount";
