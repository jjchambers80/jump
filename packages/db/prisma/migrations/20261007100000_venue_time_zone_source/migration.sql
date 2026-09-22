-- Spec 033 phase 2: derive a venue's time zone from its address instead of
-- asking the organizer to type an IANA identifier.
--
-- `country` exists so the resolver can decline for a non-US address rather than
-- misapply the US state table; it is not an organizer-facing field yet, and
-- every existing row is US.
--
-- `timezoneSource` records where the stored zone came from, so a later address
-- edit knows whether it may re-derive. Existing rows are DEFAULT ("never
-- resolved"); the phase 3 backfill decides between DERIVED and MANUAL by
-- looking at whether the stored value is still the schema default.

-- CreateEnum
CREATE TYPE "VenueTimeZoneSource" AS ENUM ('DERIVED', 'MANUAL', 'DEFAULT');

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'US',
ADD COLUMN     "timezoneSource" "VenueTimeZoneSource" NOT NULL DEFAULT 'DEFAULT';
