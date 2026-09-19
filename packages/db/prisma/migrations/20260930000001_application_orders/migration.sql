-- Spec 024 (application orders), part 2 of 2: a PAID-form application is an
-- Order. Adds the order-side columns, backfills one Order (with lines, payment
-- and refunds) per application on a PAID form, then drops the application-side
-- money columns and tables. Idempotent per application (skips rows that
-- already have an order). The same backfill exists as
-- backend/src/scripts/backfill-application-orders.js for `db push` databases.

-- ─── 1. Add ──────────────────────────────────────────────────────────────────

ALTER TABLE "Order" ADD COLUMN     "applicationId" TEXT,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "feeMode" "FeeMode" NOT NULL DEFAULT 'PASS',
ADD COLUMN     "kind" "OrderKind" NOT NULL DEFAULT 'TICKET',
ADD COLUMN     "orgReceives" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paidAt" TIMESTAMP(3);

ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_priceTierId_fkey";
ALTER TABLE "OrderItem" ADD COLUMN     "applicationTierId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "kind" "OrderItemKind" NOT NULL DEFAULT 'TICKET_TIER',
ADD COLUMN     "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
ALTER COLUMN "priceTierId" DROP NOT NULL;

ALTER TABLE "PaymentTransaction" ADD COLUMN     "offlineMethod" "OfflinePaymentMethod",
ADD COLUMN     "offlineReference" TEXT,
ADD COLUMN     "recordedById" TEXT,
ADD COLUMN     "source" "PaymentSource" NOT NULL DEFAULT 'STRIPE';

ALTER TABLE "Refund" ADD COLUMN     "manual" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Order_applicationId_key" ON "Order"("applicationId");
CREATE INDEX "Order_kind_status_idx" ON "Order"("kind", "status");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX "OrderItem_applicationTierId_idx" ON "OrderItem"("applicationTierId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_priceTierId_fkey" FOREIGN KEY ("priceTierId") REFERENCES "PriceTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_applicationTierId_fkey" FOREIGN KEY ("applicationTierId") REFERENCES "ApplicationTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── 2. Ticket orders: orgReceives and paidAt ────────────────────────────────

UPDATE "Order" SET "orgReceives" = "subtotalAmount" WHERE "kind" = 'TICKET';
UPDATE "Order" o
SET "paidAt" = COALESCE((SELECT p."createdAt" FROM "PaymentTransaction" p WHERE p."orderId" = o."id"), o."createdAt")
WHERE o."kind" = 'TICKET' AND o."status" IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND o."paidAt" IS NULL;

-- ─── 3. Backfill application orders ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION jump_order_ref() RETURNS text AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  r text := '';
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    r := r || substr(chars, 1 + floor(random() * 32)::int, 1);
  END LOOP;
  RETURN 'JMP-' || r;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  a RECORD;
  ref text;
  order_id text;
  order_status "OrderStatus";
  money_moved boolean;
  tier_platform numeric(10,2);
  tier_processing numeric(10,2);
  tier_tax numeric(10,2);
  addon_sub numeric(10,2);
  taxable_sub numeric(10,2);
  l RECORD;
BEGIN
  FOR a IN
    SELECT app.*, f."taxable" AS form_taxable, t."price" AS tier_price, t."name" AS tier_name
    FROM "Application" app
    JOIN "ApplicationForm" f ON f."id" = app."formId"
    LEFT JOIN "ApplicationTier" t ON t."id" = app."tierId"
    WHERE f."kind" = 'PAID'
      AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."applicationId" = app."id")
    ORDER BY app."createdAt"
  LOOP
    money_moved := a."paymentStatus" IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED');
    IF a."status" IN ('REJECTED', 'WITHDRAWN') AND NOT money_moved THEN
      order_status := 'CANCELLED';
    ELSE
      order_status := CASE a."paymentStatus"
        WHEN 'PAID' THEN 'COMPLETED'::"OrderStatus"
        WHEN 'REFUNDED' THEN 'REFUNDED'::"OrderStatus"
        WHEN 'PARTIALLY_REFUNDED' THEN 'PARTIALLY_REFUNDED'::"OrderStatus"
        WHEN 'NOT_REQUIRED' THEN 'COMPLETED'::"OrderStatus" -- waived balance
        ELSE 'PENDING'::"OrderStatus"
      END;
    END IF;

    -- Unique order reference
    LOOP
      ref := jump_order_ref();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Order" WHERE "orderRef" = ref);
    END LOOP;

    order_id := 'c' || substr(md5(a."id" || ':order'), 1, 24);
    INSERT INTO "Order" ("id", "kind", "eventId", "contactId", "applicationId", "orderRef", "totalAmount", "subtotalAmount",
      "platformFeeAmount", "processingFeeAmount", "taxAmount", "orgReceives", "feeMode", "currency", "quantity", "status",
      "paidAt", "dueAt", "optInAccount", "optInMarketing", "createdAt", "updatedAt")
    VALUES (order_id, 'APPLICATION', a."eventId", a."contactId", a."id", ref, a."applicantPays", a."subtotal",
      a."platformFee", a."processingFee", a."tax", a."orgReceives", a."feeMode", a."currency", 1, order_status,
      a."paidAt", a."paymentDueAt", false, false, a."createdAt", a."updatedAt");

    -- Add-on lines: fees and tax allocated in proportion to the line subtotal;
    -- the tier line takes the remainder so every column sums to the order.
    SELECT COALESCE(SUM(x."unitPrice" * x."quantity"), 0) INTO addon_sub FROM "ApplicationAddOn" x WHERE x."applicationId" = a."id";
    SELECT COALESCE(SUM(x."unitPrice" * x."quantity"), 0) INTO taxable_sub
      FROM "ApplicationAddOn" x JOIN "AddOn" ad ON ad."id" = x."addOnId" WHERE x."applicationId" = a."id" AND ad."taxable";
    IF a.form_taxable THEN taxable_sub := taxable_sub + COALESCE(a.tier_price, 0); END IF;

    tier_platform := a."platformFee"; tier_processing := a."processingFee"; tier_tax := a."tax";
    FOR l IN
      SELECT x.*, ad."taxable" AS addon_taxable FROM "ApplicationAddOn" x JOIN "AddOn" ad ON ad."id" = x."addOnId"
      WHERE x."applicationId" = a."id"
    LOOP
      DECLARE
        line_sub numeric(10,2) := l."unitPrice" * l."quantity";
        line_platform numeric(10,2) := CASE WHEN a."subtotal" > 0 THEN round(a."platformFee" * line_sub / a."subtotal", 2) ELSE 0 END;
        line_processing numeric(10,2) := CASE WHEN a."subtotal" > 0 THEN round(a."processingFee" * line_sub / a."subtotal", 2) ELSE 0 END;
        line_tax numeric(10,2) := CASE WHEN l.addon_taxable AND taxable_sub > 0 THEN round(a."tax" * line_sub / taxable_sub, 2) ELSE 0 END;
      BEGIN
        INSERT INTO "OrderAddOn" ("id", "orderId", "addOnId", "quantity", "unitPrice", "platformFee", "processingFee", "tax", "refundedAt", "createdAt")
        VALUES (l."id", order_id, l."addOnId", l."quantity", l."unitPrice", line_platform, line_processing, line_tax, NULL, l."createdAt");
        tier_platform := tier_platform - line_platform;
        tier_processing := tier_processing - line_processing;
        tier_tax := tier_tax - line_tax;
      END;
    END LOOP;

    -- Tier line
    IF a."tierId" IS NOT NULL THEN
      INSERT INTO "OrderItem" ("id", "orderId", "kind", "priceTierId", "applicationTierId", "description", "quantity", "unitPrice",
        "platformFee", "processingFee", "tax", "createdById", "createdAt")
      VALUES ('c' || substr(md5(a."id" || ':tier'), 1, 24), order_id, 'APPLICATION_TIER', NULL, a."tierId", a.tier_name, 1, a.tier_price,
        tier_platform, tier_processing, tier_tax, NULL, a."createdAt");
    END IF;

    -- Adjustment and waiver lines
    INSERT INTO "OrderItem" ("id", "orderId", "kind", "priceTierId", "applicationTierId", "description", "quantity", "unitPrice",
      "platformFee", "processingFee", "tax", "createdById", "createdAt")
    SELECT adj."id", order_id, CASE WHEN adj."kind" = 'WAIVER' THEN 'WAIVER'::"OrderItemKind" ELSE 'ADJUSTMENT'::"OrderItemKind" END,
      NULL, NULL, adj."reason", 1, adj."amount", 0, 0, 0, adj."createdById", adj."createdAt"
    FROM "ApplicationAdjustment" adj WHERE adj."applicationId" = a."id";

    -- Payment
    IF a."stripePaymentIntentId" IS NOT NULL THEN
      INSERT INTO "PaymentTransaction" ("id", "orderId", "stripePaymentIntentId", "amount", "currency", "status", "failureReason",
        "stripeAccountId", "applicationFee", "source", "createdAt")
      VALUES ('c' || substr(md5(a."id" || ':payment'), 1, 24), order_id, a."stripePaymentIntentId", a."applicantPays", a."currency",
        CASE WHEN money_moved THEN 'SUCCEEDED'::"PaymentStatus" WHEN a."paymentStatus" = 'PAYMENT_DUE' THEN 'FAILED'::"PaymentStatus" ELSE 'PENDING'::"PaymentStatus" END,
        NULL, a."stripeAccountId", a."applicationFee", 'STRIPE', COALESCE(a."paidAt", a."updatedAt"));
    ELSIF a."paymentSource" = 'OFFLINE' AND a."paymentStatus" = 'PAID' THEN
      INSERT INTO "PaymentTransaction" ("id", "orderId", "stripePaymentIntentId", "amount", "currency", "status", "failureReason",
        "stripeAccountId", "applicationFee", "source", "offlineMethod", "offlineReference", "recordedById", "createdAt")
      VALUES ('c' || substr(md5(a."id" || ':payment'), 1, 24), order_id, NULL, a."applicantPays", a."currency", 'SUCCEEDED', NULL,
        NULL, NULL, 'OFFLINE', a."offlinePaymentMethod", a."offlinePaymentReference", a."offlinePaymentRecordedById", COALESCE(a."paidAt", a."updatedAt"));
    END IF;

    -- Refunds
    INSERT INTO "Refund" ("id", "orderId", "ticketId", "orderAddOnId", "stripeRefundId", "amount", "reason", "status", "initiatedBy", "manual", "createdAt")
    SELECT r."id", order_id, NULL, NULL, r."stripeRefundId", r."amount", r."reason", r."status", r."initiatedBy", r."manual", r."createdAt"
    FROM "ApplicationRefund" r WHERE r."applicationId" = a."id";
  END LOOP;
END $$;

DROP FUNCTION jump_order_ref();

-- ─── 4. Drop the application-side ledger ─────────────────────────────────────

ALTER TABLE "ApplicationAddOn" DROP CONSTRAINT "ApplicationAddOn_addOnId_fkey";
ALTER TABLE "ApplicationAddOn" DROP CONSTRAINT "ApplicationAddOn_applicationId_fkey";
ALTER TABLE "ApplicationAdjustment" DROP CONSTRAINT "ApplicationAdjustment_applicationId_fkey";
ALTER TABLE "ApplicationRefund" DROP CONSTRAINT "ApplicationRefund_applicationId_fkey";

DROP INDEX "Application_paymentStatus_paymentDueAt_idx";
DROP INDEX "Application_stripePaymentIntentId_key";

ALTER TABLE "Application" DROP COLUMN "applicantPays",
DROP COLUMN "applicationFee",
DROP COLUMN "currency",
DROP COLUMN "feeMode",
DROP COLUMN "offlinePaymentMethod",
DROP COLUMN "offlinePaymentRecordedById",
DROP COLUMN "offlinePaymentReference",
DROP COLUMN "orgReceives",
DROP COLUMN "paidAt",
DROP COLUMN "paymentDueAt",
DROP COLUMN "paymentSource",
DROP COLUMN "platformFee",
DROP COLUMN "processingFee",
DROP COLUMN "stripeAccountId",
DROP COLUMN "stripePaymentIntentId",
DROP COLUMN "subtotal",
DROP COLUMN "tax";

DROP TABLE "ApplicationAddOn";
DROP TABLE "ApplicationAdjustment";
DROP TABLE "ApplicationRefund";
DROP TYPE "AdjustmentKind";

CREATE INDEX "Application_paymentStatus_idx" ON "Application"("paymentStatus");
