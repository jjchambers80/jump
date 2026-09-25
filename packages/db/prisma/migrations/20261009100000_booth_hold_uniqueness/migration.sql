-- Booth holds: push the HELD invariant into Postgres (spec 014 phase 2 hardening).
--
-- WHY: `Booth.applicationId` was already @unique, so SOLD could never be handed
-- to two applications. HELD had no such backstop — it rested entirely on every
-- caller remembering to lock Application before Booth. This makes the same
-- guarantee a database fact for the hold slot too.
--
-- Rollback:
--   ALTER TABLE "Booth" DROP CONSTRAINT "Booth_hold_state_check";
--   DROP INDEX "Booth_holdApplicationId_key";
-- Both are safe to run at any time; neither drops or rewrites data.

-- 1. Repair any row that already violates the invariant, so the constraints can
--    be added without a table rewrite failing. All three repairs return booths to
--    a valid state; none of them touch a SOLD booth or move money.

-- 1a. A hold slot filled on a booth that is not HELD is stale bookkeeping: clear it.
UPDATE "Booth"
   SET "holdApplicationId" = NULL, "holdExpiresAt" = NULL
 WHERE "status" <> 'HELD'
   AND ("holdApplicationId" IS NOT NULL OR "holdExpiresAt" IS NOT NULL);

-- 1b. A HELD booth with no holder (or no deadline) can never be claimed or swept.
--     Return it to the pool.
UPDATE "Booth"
   SET "status" = 'AVAILABLE', "holdApplicationId" = NULL, "holdExpiresAt" = NULL,
       "applicationId" = NULL, "assignedById" = NULL
 WHERE "status" = 'HELD'
   AND ("holdApplicationId" IS NULL OR "holdExpiresAt" IS NULL);

-- 1c. One application holding several booths: keep the oldest hold, release the rest.
--     The applicant only ever sees one booth, so the extras are leaked inventory.
UPDATE "Booth" b
   SET "status" = 'AVAILABLE', "holdApplicationId" = NULL, "holdExpiresAt" = NULL,
       "applicationId" = NULL, "assignedById" = NULL
  FROM (
    SELECT "id",
           row_number() OVER (
             PARTITION BY "holdApplicationId"
             ORDER BY "holdExpiresAt" ASC, "id" ASC
           ) AS rn
      FROM "Booth"
     WHERE "holdApplicationId" IS NOT NULL
  ) ranked
 WHERE b."id" = ranked."id"
   AND ranked.rn > 1;

-- 2. One application can hold at most one booth. NULLs are distinct in Postgres,
--    so every booth without a hold is unconstrained.
CREATE UNIQUE INDEX "Booth_holdApplicationId_key" ON "Booth"("holdApplicationId");

-- 3. HELD means exactly "somebody is holding this until a deadline". Without this,
--    the unique index above could be sidestepped by parking a holder on a booth in
--    some other status, and the hold sweep would never see it.
ALTER TABLE "Booth" ADD CONSTRAINT "Booth_hold_state_check" CHECK (
  ("status" = 'HELD') = ("holdApplicationId" IS NOT NULL AND "holdExpiresAt" IS NOT NULL)
);
