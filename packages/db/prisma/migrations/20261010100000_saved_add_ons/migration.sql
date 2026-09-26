-- Spec 037 phase 4: saved add-ons.
--
-- 1. AddOnProduct: the organization-level saved add-on an event's AddOn
--    offering points at (name / description / scope / taxable shared, price
--    only a default). Case-insensitive name uniqueness is enforced in
--    AddOnProductService; the index below is the exact-spelling backstop.
-- 2. AddOn.productId: nullable until `npm run db:backfill:037-add-ons` has
--    linked every legacy row. The one-offering-per-event unique constraint
--    waits until the backfill report shows no same-event duplicates.
-- 3. OrderAddOn.name: the add-on's name at purchase, so renaming a saved
--    add-on never rewrites a past receipt. Backfilled from the current
--    AddOn.name before any rename is possible, then NOT NULL.

-- CreateTable
CREATE TABLE "AddOnProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultPrice" DECIMAL(10,2) NOT NULL,
    "scope" "AddOnScope" NOT NULL DEFAULT 'BOTH',
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddOnProduct_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AddOnProduct_organizationId_isArchived_idx" ON "AddOnProduct"("organizationId", "isArchived");
CREATE UNIQUE INDEX "AddOnProduct_organizationId_name_key" ON "AddOnProduct"("organizationId", "name");

ALTER TABLE "AddOnProduct" ADD CONSTRAINT "AddOnProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: AddOn → AddOnProduct
ALTER TABLE "AddOn" ADD COLUMN "productId" TEXT;
CREATE INDEX "AddOn_productId_idx" ON "AddOn"("productId");
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "AddOnProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: OrderAddOn name snapshot
ALTER TABLE "OrderAddOn" ADD COLUMN "name" TEXT;
UPDATE "OrderAddOn" AS l SET "name" = a."name" FROM "AddOn" AS a WHERE a."id" = l."addOnId";
UPDATE "OrderAddOn" SET "name" = 'Add-on' WHERE "name" IS NULL;
ALTER TABLE "OrderAddOn" ALTER COLUMN "name" SET NOT NULL;
