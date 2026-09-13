-- Spec 007 phase 1: per-organization buyer identity + staff membership.
--
-- 1. Contact becomes scoped to an organization. Uniqueness moves from (email)
--    to (organizationId, email). A buyer who ordered from N organizations is
--    split into N Contact rows; Order.contactId and Ticket.contactId are
--    repointed so each order belongs to the Contact of its own organization.
-- 2. OrganizationMember replaces User.organizationId for ADMIN/ORGANIZER
--    scoping. Existing assignments are copied. User.organizationId is kept
--    (nullable, unused) until phase 4.
-- 3. Contact.emailSubscribed default flips to false. Existing rows keep their
--    value; consent is not retroactively changed.
-- 4. Contact.accountCreatedAt is added for the phase 2 checkout opt-in.
--
-- Runs in a single transaction (Prisma wraps Postgres migrations), so a
-- failure anywhere leaves the schema untouched. Contacts with no orders at all
-- have nothing referencing them and are deleted rather than guessed at.

-- ---------------------------------------------------------------------------
-- Enum + membership table
-- ---------------------------------------------------------------------------

CREATE TYPE "MemberRole" AS ENUM ('ORGANIZER', 'ADMIN');

CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationMember_organizationId_idx" ON "OrganizationMember"("organizationId");
CREATE UNIQUE INDEX "OrganizationMember_userId_organizationId_key" ON "OrganizationMember"("userId", "organizationId");

ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy existing staff assignments. Only ADMIN/ORGANIZER carry an org role;
-- SYSTEM_ADMIN is unscoped and CUSTOMER is not staff.
INSERT INTO "OrganizationMember" ("id", "userId", "organizationId", "role", "createdAt")
SELECT gen_random_uuid()::text, u."id", u."organizationId", u."role"::text::"MemberRole", u."createdAt"
FROM "User" u
WHERE u."organizationId" IS NOT NULL
  AND u."role" IN ('ADMIN', 'ORGANIZER')
  AND u."deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Contact: add columns (nullable first so the backfill can run)
-- ---------------------------------------------------------------------------

ALTER TABLE "Contact"
    ADD COLUMN "accountCreatedAt" TIMESTAMP(3),
    ADD COLUMN "organizationId" TEXT,
    ALTER COLUMN "emailSubscribed" SET DEFAULT false;

-- Every (contact, organization) pair that has at least one order, any status,
-- with the timestamp of the earliest order for that pair.
CREATE TEMP TABLE contact_orgs ON COMMIT DROP AS
SELECT o."contactId", v."organizationId", MIN(o."createdAt") AS "firstOrderAt"
FROM "Order" o
JOIN "Event" e ON e."id" = o."eventId"
JOIN "Venue" v ON v."id" = e."venueId"
GROUP BY o."contactId", v."organizationId";

-- Primary organization = the one the contact ordered from first. The existing
-- row keeps its id so admin URLs and any external references stay valid.
UPDATE "Contact" c
SET "organizationId" = p."organizationId"
FROM (
    SELECT DISTINCT ON ("contactId") "contactId", "organizationId"
    FROM contact_orgs
    ORDER BY "contactId", "firstOrderAt" ASC, "organizationId" ASC
) p
WHERE c."id" = p."contactId";

-- Contacts with no orders reference nothing and nothing references them
-- (Order and Ticket are the only FKs). Remove rather than assign arbitrarily.
DELETE FROM "Contact" WHERE "organizationId" IS NULL;

-- The global email uniqueness has to go before clones can be inserted.
DROP INDEX "Contact_email_key";

-- Additional organizations get a clone of the contact. note/emailSubscribed
-- cannot be attributed to one organization, so they are copied to every clone.
CREATE TEMP TABLE contact_clones ON COMMIT DROP AS
SELECT gen_random_uuid()::text AS "newId", co."contactId" AS "oldId", co."organizationId"
FROM contact_orgs co
JOIN "Contact" c ON c."id" = co."contactId"
WHERE co."organizationId" <> c."organizationId";

INSERT INTO "Contact" ("id", "organizationId", "email", "firstName", "lastName", "location", "note",
                       "emailSubscribed", "accountCreatedAt", "userId", "createdAt", "updatedAt")
SELECT cc."newId", cc."organizationId", c."email", c."firstName", c."lastName", c."location", c."note",
       c."emailSubscribed", NULL, c."userId", c."createdAt", CURRENT_TIMESTAMP
FROM contact_clones cc
JOIN "Contact" c ON c."id" = cc."oldId";

-- Repoint orders whose organization differs from their contact's primary org.
UPDATE "Order" o
SET "contactId" = cc."newId"
FROM "Event" e, "Venue" v, contact_clones cc
WHERE e."id" = o."eventId"
  AND v."id" = e."venueId"
  AND cc."oldId" = o."contactId"
  AND cc."organizationId" = v."organizationId";

-- Tickets follow their order.
UPDATE "Ticket" t
SET "contactId" = o."contactId"
FROM "Order" o
WHERE o."id" = t."orderId"
  AND t."contactId" <> o."contactId";

-- Guard: every remaining contact must be scoped, and every order/ticket must
-- point at a contact of its own organization. Abort (rolling back everything)
-- if not.
DO $$
DECLARE
    unscoped INT;
    mismatched_orders INT;
    mismatched_tickets INT;
BEGIN
    SELECT COUNT(*) INTO unscoped FROM "Contact" WHERE "organizationId" IS NULL;
    IF unscoped > 0 THEN
        RAISE EXCEPTION 'contact backfill left % unscoped contact(s)', unscoped;
    END IF;

    SELECT COUNT(*) INTO mismatched_orders
    FROM "Order" o
    JOIN "Contact" c ON c."id" = o."contactId"
    JOIN "Event" e ON e."id" = o."eventId"
    JOIN "Venue" v ON v."id" = e."venueId"
    WHERE c."organizationId" <> v."organizationId";
    IF mismatched_orders > 0 THEN
        RAISE EXCEPTION 'contact backfill left % order(s) pointing at a contact of another organization', mismatched_orders;
    END IF;

    SELECT COUNT(*) INTO mismatched_tickets
    FROM "Ticket" t
    JOIN "Order" o ON o."id" = t."orderId"
    WHERE t."contactId" <> o."contactId";
    IF mismatched_tickets > 0 THEN
        RAISE EXCEPTION 'contact backfill left % ticket(s) whose contact differs from their order', mismatched_tickets;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Contact: finalize constraints
-- ---------------------------------------------------------------------------

ALTER TABLE "Contact" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE UNIQUE INDEX "Contact_organizationId_email_key" ON "Contact"("organizationId", "email");

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
