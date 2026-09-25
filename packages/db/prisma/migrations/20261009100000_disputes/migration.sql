-- Disputes / chargebacks (spec 037)
-- One row per Stripe dispute, resolved to exactly one Order through the
-- order's PaymentTransaction. The money Stripe pulls back is projected as a
-- Refund row carrying "disputeId" so every existing money reader (order
-- refunded/net, analytics, the tax report, the CSV export) stays correct.

CREATE TYPE "DisputeState" AS ENUM ('OPEN', 'WON', 'LOST');

CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "stripePaymentIntentId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "reason" TEXT,
    "stripeStatus" TEXT NOT NULL,
    "state" "DisputeState" NOT NULL DEFAULT 'OPEN',
    "inquiry" BOOLEAN NOT NULL DEFAULT false,
    "fundsWithdrawn" BOOLEAN NOT NULL DEFAULT false,
    "evidenceDueBy" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "voidedTickets" JSONB,
    "closedAddOnIds" TEXT[],
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "lastEventType" TEXT NOT NULL,
    "lastEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Dispute_stripeDisputeId_key" ON "Dispute"("stripeDisputeId");
CREATE INDEX "Dispute_orderId_idx" ON "Dispute"("orderId");
CREATE INDEX "Dispute_state_idx" ON "Dispute"("state");

ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Refund" ADD COLUMN "disputeId" TEXT;

-- One money-out row per dispute, enforced by the database rather than by a
-- read-then-write in the webhook handler.
CREATE UNIQUE INDEX "Refund_disputeId_key" ON "Refund"("disputeId");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
