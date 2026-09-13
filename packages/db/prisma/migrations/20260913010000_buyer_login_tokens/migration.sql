-- Spec 007 phase 2: passwordless buyer sign-in tokens + checkout opt-in flags.

-- Opt-ins are stored on the Order and applied to the Contact on payment
-- completion, never at order creation.
ALTER TABLE "Order"
    ADD COLUMN "optInAccount" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "optInMarketing" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "BuyerTokenPurpose" AS ENUM ('WELCOME', 'LOGIN');

CREATE TABLE "BuyerLoginToken" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "BuyerTokenPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerLoginToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuyerLoginToken_tokenHash_key" ON "BuyerLoginToken"("tokenHash");
CREATE INDEX "BuyerLoginToken_contactId_idx" ON "BuyerLoginToken"("contactId");
CREATE INDEX "BuyerLoginToken_expiresAt_idx" ON "BuyerLoginToken"("expiresAt");

ALTER TABLE "BuyerLoginToken" ADD CONSTRAINT "BuyerLoginToken_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
