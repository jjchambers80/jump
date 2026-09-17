-- Spec 012 phase 1: add-ons sold with ticket tiers (and, in phase 2, application tiers).
-- CreateEnum
CREATE TYPE "AddOnScope" AS ENUM ('TICKET', 'APPLICATION', 'BOTH');

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "orderAddOnId" TEXT;

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "scope" "AddOnScope" NOT NULL DEFAULT 'BOTH',
    "allTiers" BOOLEAN NOT NULL DEFAULT true,
    "quantityTotal" INTEGER,
    "quantitySold" INTEGER NOT NULL DEFAULT 0,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "maxPerOrder" INTEGER,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTierAddOn" (
    "priceTierId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,

    CONSTRAINT "PriceTierAddOn_pkey" PRIMARY KEY ("priceTierId","addOnId")
);

-- CreateTable
CREATE TABLE "ApplicationTierAddOn" (
    "applicationTierId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,

    CONSTRAINT "ApplicationTierAddOn_pkey" PRIMARY KEY ("applicationTierId","addOnId")
);

-- CreateTable
CREATE TABLE "OrderAddOn" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "platformFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "processingFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAddOn" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "addOnId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AddOn_eventId_isActive_idx" ON "AddOn"("eventId", "isActive");

-- CreateIndex
CREATE INDEX "PriceTierAddOn_addOnId_idx" ON "PriceTierAddOn"("addOnId");

-- CreateIndex
CREATE INDEX "ApplicationTierAddOn_addOnId_idx" ON "ApplicationTierAddOn"("addOnId");

-- CreateIndex
CREATE INDEX "OrderAddOn_addOnId_idx" ON "OrderAddOn"("addOnId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAddOn_orderId_addOnId_key" ON "OrderAddOn"("orderId", "addOnId");

-- CreateIndex
CREATE INDEX "ApplicationAddOn_addOnId_idx" ON "ApplicationAddOn"("addOnId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationAddOn_applicationId_addOnId_key" ON "ApplicationAddOn"("applicationId", "addOnId");

-- CreateIndex
CREATE INDEX "Refund_orderAddOnId_idx" ON "Refund"("orderAddOnId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderAddOnId_fkey" FOREIGN KEY ("orderAddOnId") REFERENCES "OrderAddOn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTierAddOn" ADD CONSTRAINT "PriceTierAddOn_priceTierId_fkey" FOREIGN KEY ("priceTierId") REFERENCES "PriceTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceTierAddOn" ADD CONSTRAINT "PriceTierAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationTierAddOn" ADD CONSTRAINT "ApplicationTierAddOn_applicationTierId_fkey" FOREIGN KEY ("applicationTierId") REFERENCES "ApplicationTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationTierAddOn" ADD CONSTRAINT "ApplicationTierAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAddOn" ADD CONSTRAINT "OrderAddOn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAddOn" ADD CONSTRAINT "OrderAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAddOn" ADD CONSTRAINT "ApplicationAddOn_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAddOn" ADD CONSTRAINT "ApplicationAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

