-- Spec 047 D0-C: Order.organizationId (backfilled, required) and nullable
-- Order.eventId. Gifts without a ticket and monthly gifts (D1/D3) have no
-- event, so org scope moves from event -> venue -> organization onto the order.

-- 1. Expand
ALTER TABLE "Order" ADD COLUMN "organizationId" TEXT;

-- 2. Backfill from the event's venue
UPDATE "Order" AS o
SET "organizationId" = venue."organizationId"
FROM "Event" AS event
JOIN "Venue" AS venue ON venue."id" = event."venueId"
WHERE event."id" = o."eventId";

-- 3. Verify: every order has an organization, and it agrees with the
-- contact's (contacts are per organization since spec 007).
DO $$
DECLARE
  missing integer;
  mismatched integer;
BEGIN
  SELECT count(*) INTO missing FROM "Order" WHERE "organizationId" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'Order.organizationId backfill left % row(s) null', missing;
  END IF;

  SELECT count(*) INTO mismatched
  FROM "Order" AS o
  JOIN "Contact" AS contact ON contact."id" = o."contactId"
  WHERE contact."organizationId" <> o."organizationId";
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'Order.organizationId disagrees with Contact.organizationId on % row(s)', mismatched;
  END IF;
END
$$;

-- 4. Contract
ALTER TABLE "Order"
  ALTER COLUMN "organizationId" SET NOT NULL,
  ALTER COLUMN "eventId" DROP NOT NULL;

CREATE INDEX "Order_organizationId_status_createdAt_idx" ON "Order"("organizationId", "status", "createdAt");
CREATE INDEX "Order_organizationId_kind_status_idx" ON "Order"("organizationId", "kind", "status");

-- Same delete behaviour as Order_eventId_fkey: no cascade.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Ticket and application orders keep their event; only D1's DONATION kind
-- may omit it.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_event_required_check"
  CHECK ("eventId" IS NOT NULL OR "kind" NOT IN ('TICKET', 'APPLICATION'));

-- 6. Compatibility for raw inserts: derive organizationId from the event when
-- omitted (copied from set_application_form_organization, spec 044).
CREATE FUNCTION set_order_organization() RETURNS trigger AS $$
BEGIN
  IF NEW."organizationId" IS NULL AND NEW."eventId" IS NOT NULL THEN
    SELECT venue."organizationId" INTO NEW."organizationId"
    FROM "Event" event
    JOIN "Venue" venue ON venue."id" = event."venueId"
    WHERE event."id" = NEW."eventId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Order_set_organization"
BEFORE INSERT OR UPDATE OF "eventId", "organizationId" ON "Order"
FOR EACH ROW EXECUTE FUNCTION set_order_organization();
