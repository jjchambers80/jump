-- Stripe webhook delivery receipts (EVE-3).
-- Purely additive: a new table, no change to any existing money table.
-- Rollback is DROP TABLE "StripeWebhookEvent";

CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accountId" TEXT,
    "objectId" TEXT,
    "apiVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "deliveries" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "stripeCreatedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- The dedup key. The insert is the lock: a concurrent redelivery of the same
-- event on the same endpoint loses here rather than reaching a handler twice.
CREATE UNIQUE INDEX "StripeWebhookEvent_endpoint_stripeEventId_key" ON "StripeWebhookEvent"("endpoint", "stripeEventId");

CREATE INDEX "StripeWebhookEvent_type_receivedAt_idx" ON "StripeWebhookEvent"("type", "receivedAt");
CREATE INDEX "StripeWebhookEvent_status_receivedAt_idx" ON "StripeWebhookEvent"("status", "receivedAt");
CREATE INDEX "StripeWebhookEvent_objectId_idx" ON "StripeWebhookEvent"("objectId");
