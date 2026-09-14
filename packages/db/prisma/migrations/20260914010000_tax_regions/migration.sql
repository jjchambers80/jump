-- Spec 009: Settings › Tax.
-- Per-organization tax regions (US states) decide whether tax is collected and
-- by which source. Event.taxRateSource records which path produced the cached
-- rate so the admin can tell "0% because not collecting" from "0% because the
-- lookup failed".

CREATE TYPE "TaxSource" AS ENUM ('STRIPE', 'MANUAL');

ALTER TABLE "Event" ADD COLUMN "taxRateSource" "TaxSource";

CREATE TABLE "TaxRegion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "region" TEXT NOT NULL,
    "collecting" BOOLEAN NOT NULL DEFAULT false,
    "source" "TaxSource" NOT NULL DEFAULT 'STRIPE',
    "manualRate" DECIMAL(6,5),
    "lastRate" DECIMAL(6,5),
    "lastSource" "TaxSource",
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRegion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxRegion_organizationId_country_region_key" ON "TaxRegion"("organizationId", "country", "region");
CREATE INDEX "TaxRegion_organizationId_idx" ON "TaxRegion"("organizationId");

ALTER TABLE "TaxRegion" ADD CONSTRAINT "TaxRegion_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Venue.state was free text. Normalise full US state names to the two-letter
-- code so region keys are stable; anything unmatched is left alone and shows
-- under "Needs address" on the settings page.
UPDATE "Venue" v
SET "state" = m.code
FROM (VALUES
    ('ALABAMA','AL'),('ALASKA','AK'),('ARIZONA','AZ'),('ARKANSAS','AR'),('CALIFORNIA','CA'),
    ('COLORADO','CO'),('CONNECTICUT','CT'),('DELAWARE','DE'),('DISTRICT OF COLUMBIA','DC'),
    ('FLORIDA','FL'),('GEORGIA','GA'),('HAWAII','HI'),('IDAHO','ID'),('ILLINOIS','IL'),
    ('INDIANA','IN'),('IOWA','IA'),('KANSAS','KS'),('KENTUCKY','KY'),('LOUISIANA','LA'),
    ('MAINE','ME'),('MARYLAND','MD'),('MASSACHUSETTS','MA'),('MICHIGAN','MI'),('MINNESOTA','MN'),
    ('MISSISSIPPI','MS'),('MISSOURI','MO'),('MONTANA','MT'),('NEBRASKA','NE'),('NEVADA','NV'),
    ('NEW HAMPSHIRE','NH'),('NEW JERSEY','NJ'),('NEW MEXICO','NM'),('NEW YORK','NY'),
    ('NORTH CAROLINA','NC'),('NORTH DAKOTA','ND'),('OHIO','OH'),('OKLAHOMA','OK'),('OREGON','OR'),
    ('PENNSYLVANIA','PA'),('RHODE ISLAND','RI'),('SOUTH CAROLINA','SC'),('SOUTH DAKOTA','SD'),
    ('TENNESSEE','TN'),('TEXAS','TX'),('UTAH','UT'),('VERMONT','VT'),('VIRGINIA','VA'),
    ('WASHINGTON','WA'),('WEST VIRGINIA','WV'),('WISCONSIN','WI'),('WYOMING','WY'),
    ('PUERTO RICO','PR')
) AS m(name, code)
WHERE upper(trim(v."state")) = m.name;

UPDATE "Venue"
SET "state" = upper(trim("state"))
WHERE "state" IS NOT NULL AND length(trim("state")) = 2;

-- Behaviour-preserving backfill: every organization keeps collecting via
-- Stripe Tax in every state it already has a venue in (what happens implicitly
-- today). Regions that appear later default to not collecting.
INSERT INTO "TaxRegion" ("id", "organizationId", "country", "region", "collecting", "source", "createdAt", "updatedAt")
SELECT
    md5(random()::text || v."organizationId" || v."state" || clock_timestamp()::text),
    v."organizationId",
    'US',
    v."state",
    true,
    'STRIPE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Venue" v
WHERE v."state" ~ '^[A-Z]{2}$'
GROUP BY v."organizationId", v."state";

-- Events that already carry a cached rate got it from Stripe Tax.
UPDATE "Event" SET "taxRateSource" = 'STRIPE' WHERE "taxRate" IS NOT NULL AND "taxRate" > 0;
