-- Spec 024 phase 3: legal acceptances (spec 023 §8.1), marketing consent
-- provenance on Contact (spec 023 LR-07) and apply-form opt-ins on Application.
-- CreateEnum
CREATE TYPE "EmailSubscribedSource" AS ENUM ('CHECKOUT', 'APPLY', 'ADMIN', 'IMPORT');

-- CreateEnum
CREATE TYPE "LegalSubject" AS ENUM ('USER', 'CONTACT', 'ANONYMOUS_EMAIL');

-- CreateEnum
CREATE TYPE "LegalDocument" AS ENUM ('TERMS', 'PRIVACY', 'ORGANIZER_TERMS', 'CARD_AUTHORIZATION', 'SUBSCRIPTION_TERMS', 'CONNECT_TERMS', 'MARKETING');

-- CreateEnum
CREATE TYPE "LegalSource" AS ENUM ('CHECKOUT', 'APPLY', 'SIGNUP', 'SUBSCRIBE', 'CONNECT', 'ACCOUNT', 'ADMIN_INTERSTITIAL');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "optInAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optInMarketing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optInsAppliedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "emailSubscribedAt" TIMESTAMP(3),
ADD COLUMN     "emailSubscribedSource" "EmailSubscribedSource",
ADD COLUMN     "emailUnsubscribedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "subjectType" "LegalSubject" NOT NULL,
    "subjectId" TEXT,
    "email" TEXT NOT NULL,
    "organizationId" TEXT,
    "document" "LegalDocument" NOT NULL,
    "version" TEXT NOT NULL,
    "source" "LegalSource" NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "presentedText" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalAcceptance_email_document_idx" ON "LegalAcceptance"("email", "document");

-- CreateIndex
CREATE INDEX "LegalAcceptance_subjectType_subjectId_idx" ON "LegalAcceptance"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "LegalAcceptance_referenceType_referenceId_idx" ON "LegalAcceptance"("referenceType", "referenceId");

