-- Spec 008: Settings › Domains setup page.
-- The ownership TXT record is now stored as a (host label, full value) pair so
-- Railway's own _railway-verify record can be used when the Railway API is
-- configured. Existing rows keep verifying: their token becomes the full
-- "jump-verify=<token>" value they already published.

ALTER TABLE "OrganizationDomain"
    ADD COLUMN "verificationHost" TEXT NOT NULL DEFAULT '_jump-verify',
    ADD COLUMN "certificateStatus" TEXT,
    ADD COLUMN "dnsProvider" TEXT,
    ADD COLUMN "lastDnsSnapshot" JSONB;

UPDATE "OrganizationDomain"
SET "verificationToken" = 'jump-verify=' || "verificationToken"
WHERE "verificationToken" NOT LIKE '%=%';
