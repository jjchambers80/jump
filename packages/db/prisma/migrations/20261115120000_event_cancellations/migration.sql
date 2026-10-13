-- Spec 054: cancelling a paid event (EventCancellation + per-order items).
CREATE TYPE "EventCancellationMode" AS ENUM ('REFUND_ALL', 'MANUAL');
CREATE TYPE "EventCancellationItemStatus" AS ENUM ('PENDING', 'REFUNDED', 'SKIPPED', 'FAILED');

CREATE TABLE "EventCancellation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "mode" "EventCancellationMode" NOT NULL,
    "message" TEXT,
    "initiatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EventCancellation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventCancellationItem" (
    "id" TEXT NOT NULL,
    "cancellationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "EventCancellationItemStatus" NOT NULL DEFAULT 'PENDING',
    "skippedReason" TEXT,
    "refundedAmount" DECIMAL(10,2),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCancellationItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventCancellation_eventId_key" ON "EventCancellation"("eventId");
CREATE UNIQUE INDEX "EventCancellationItem_orderId_key" ON "EventCancellationItem"("orderId");
CREATE INDEX "EventCancellationItem_cancellationId_status_idx" ON "EventCancellationItem"("cancellationId", "status");

ALTER TABLE "EventCancellation" ADD CONSTRAINT "EventCancellation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCancellationItem" ADD CONSTRAINT "EventCancellationItem_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "EventCancellation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCancellationItem" ADD CONSTRAINT "EventCancellationItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
