-- Booth-first applications (spec 037): give a HELD booth a stated reason, and
-- therefore a stated clock.
--
-- WHY: before this, HELD meant exactly one thing — a checkout in flight, expiring
-- in BOOTH_HOLD_MS (15 min). Booth-first needs a second kind of hold: the booth a
-- vendor picked on the apply form, which must survive days of organizer review.
-- Sweeping that on a 15-minute timer would hand the vendor's spot away while the
-- organizer was still reading the application; leaving it with no expiry at all
-- would leak inventory forever on an abandoned application. `holdKind` names
-- which clock a hold runs on so neither happens.
--
-- Backfill-safe: every existing HELD booth is a checkout hold by definition,
-- because that was the only hold the code could create. It is labelled CHECKOUT
-- and keeps the exact holdExpiresAt it already had. No hold is created, released
-- or re-timed by this migration, and no money moves.
--
-- Rollback (safe at any time; drops a label, never a hold):
--   ALTER TABLE "Booth" DROP CONSTRAINT "Booth_hold_state_check";
--   ALTER TABLE "Booth" ADD CONSTRAINT "Booth_hold_state_check" CHECK (
--     ("status" = 'HELD') = ("holdApplicationId" IS NOT NULL AND "holdExpiresAt" IS NOT NULL)
--   );
--   ALTER TABLE "Booth" DROP COLUMN "holdKind";
--   DROP TYPE "BoothHoldKind";
-- Rolling back while APPLICATION holds exist leaves them HELD on the old
-- 15-minute sweep, so they are reclaimed early rather than stranded — the
-- pre-spec-037 behaviour. Nothing is double-booked either way.

CREATE TYPE "BoothHoldKind" AS ENUM ('APPLICATION', 'CHECKOUT');

ALTER TABLE "Booth" ADD COLUMN "holdKind" "BoothHoldKind";

-- Every hold that exists today is a checkout hold; label it as one so the new
-- CHECK below can be added without failing on live rows.
UPDATE "Booth" SET "holdKind" = 'CHECKOUT' WHERE "status" = 'HELD';

-- Defensive: a kind parked on a booth that is not HELD is stale bookkeeping.
-- Cannot happen on a fresh column, but keeps the statement order rerun-safe.
UPDATE "Booth" SET "holdKind" = NULL WHERE "status" <> 'HELD' AND "holdKind" IS NOT NULL;

-- Extend the invariant from 20261009100000_booth_hold_uniqueness: HELD now means
-- "somebody is holding this, until a deadline, for a stated reason".
ALTER TABLE "Booth" DROP CONSTRAINT "Booth_hold_state_check";
ALTER TABLE "Booth" ADD CONSTRAINT "Booth_hold_state_check" CHECK (
  ("status" = 'HELD') = (
    "holdApplicationId" IS NOT NULL AND "holdExpiresAt" IS NOT NULL AND "holdKind" IS NOT NULL
  )
);

-- The sweep reads (status, holdKind, holdExpiresAt) on every tick.
CREATE INDEX "Booth_holdKind_holdExpiresAt_idx" ON "Booth"("holdKind", "holdExpiresAt");
