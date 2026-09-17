-- Spec 011: applications (forms, tiers, questions, applicant profiles, applications, decisions, refunds, templates)
-- and Contact.stripeCustomerId. Additive; no backfill.
-- CreateEnum
CREATE TYPE "ApplicationFormKind" AS ENUM ('PAID', 'FREE');

-- CreateEnum
CREATE TYPE "ApplicationFormStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChargeTiming" AS ENUM ('SUBMIT', 'APPROVAL');

-- CreateEnum
CREATE TYPE "FeeMode" AS ENUM ('PASS', 'ABSORB');

-- CreateEnum
CREATE TYPE "OverduePolicy" AS ENUM ('WITHDRAW', 'HOLD');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'WAITLISTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicationPayment" AS ENUM ('NOT_REQUIRED', 'AWAITING_CARD', 'CARD_ON_FILE', 'PROCESSING', 'PAID', 'PAYMENT_DUE', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "CapacitySlot" AS ENUM ('NONE', 'RESERVED', 'APPROVED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'CHECKBOX', 'URL', 'EMAIL', 'PHONE', 'NUMBER', 'PHOTO');

-- CreateEnum
CREATE TYPE "ApplicationAction" AS ENUM ('RECEIVED', 'APPROVED', 'REJECTED', 'WAITLISTED', 'WITHDRAWN', 'PAYMENT_DUE');

-- CreateEnum
CREATE TYPE "WithdrawnBy" AS ENUM ('ORGANIZER', 'APPLICANT', 'SYSTEM');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "stripeCustomerId" TEXT;

-- CreateTable
CREATE TABLE "ApplicationForm" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "ApplicationFormKind" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "intro" TEXT,
    "status" "ApplicationFormStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "chargeTiming" "ChargeTiming" NOT NULL DEFAULT 'APPROVAL',
    "feeMode" "FeeMode" NOT NULL DEFAULT 'PASS',
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "paymentDueDays" INTEGER NOT NULL DEFAULT 7,
    "overduePolicy" "OverduePolicy" NOT NULL DEFAULT 'WITHDRAW',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationTier" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "quantityTotal" INTEGER NOT NULL,
    "quantityApproved" INTEGER NOT NULL DEFAULT 0,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationQuestion" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "type" "QuestionType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ApplicationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "socials" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantProfileImage" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApplicantProfileImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "tierId" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "ApplicationPayment" NOT NULL DEFAULT 'NOT_REQUIRED',
    "capacitySlot" "CapacitySlot" NOT NULL DEFAULT 'NONE',
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "platformFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "processingFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "applicantPays" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "orgReceives" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "feeMode" "FeeMode" NOT NULL DEFAULT 'PASS',
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentMethodId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeAccountId" TEXT,
    "applicationFee" DECIMAL(10,2),
    "chargeAttempts" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paymentDueAt" TIMESTAMP(3),
    "overdue" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "internalNote" TEXT,
    "withdrawnBy" "WithdrawnBy",
    "withdrawReason" TEXT,
    "boothLabel" TEXT,
    "statusTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAnswer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueJson" JSONB,
    "imageId" TEXT,

    CONSTRAINT "ApplicationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDecision" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "action" "ApplicationAction" NOT NULL,
    "byUserId" TEXT,
    "note" TEXT,
    "emailSubject" TEXT,
    "emailBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationRefund" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "stripeRefundId" TEXT,
    "initiatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationMessageTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "action" "ApplicationAction" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationForm_eventId_status_idx" ON "ApplicationForm"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationForm_eventId_slug_key" ON "ApplicationForm"("eventId", "slug");

-- CreateIndex
CREATE INDEX "ApplicationTier_formId_idx" ON "ApplicationTier"("formId");

-- CreateIndex
CREATE INDEX "ApplicationQuestion_formId_idx" ON "ApplicationQuestion"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantProfile_organizationId_contactId_key" ON "ApplicantProfile"("organizationId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantProfileImage_profileId_imageId_key" ON "ApplicantProfileImage"("profileId", "imageId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_stripeCheckoutSessionId_key" ON "Application"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_stripePaymentIntentId_key" ON "Application"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_statusTokenHash_key" ON "Application"("statusTokenHash");

-- CreateIndex
CREATE INDEX "Application_eventId_status_idx" ON "Application"("eventId", "status");

-- CreateIndex
CREATE INDEX "Application_formId_status_idx" ON "Application"("formId", "status");

-- CreateIndex
CREATE INDEX "Application_contactId_idx" ON "Application"("contactId");

-- CreateIndex
CREATE INDEX "Application_organizationId_idx" ON "Application"("organizationId");

-- CreateIndex
CREATE INDEX "Application_paymentStatus_paymentDueAt_idx" ON "Application"("paymentStatus", "paymentDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationAnswer_applicationId_questionId_key" ON "ApplicationAnswer"("applicationId", "questionId");

-- CreateIndex
CREATE INDEX "ApplicationDecision_applicationId_idx" ON "ApplicationDecision"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationRefund_stripeRefundId_key" ON "ApplicationRefund"("stripeRefundId");

-- CreateIndex
CREATE INDEX "ApplicationRefund_applicationId_idx" ON "ApplicationRefund"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationMessageTemplate_organizationId_action_key" ON "ApplicationMessageTemplate"("organizationId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_stripeCustomerId_key" ON "Contact"("stripeCustomerId");

-- AddForeignKey
ALTER TABLE "ApplicationForm" ADD CONSTRAINT "ApplicationForm_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationTier" ADD CONSTRAINT "ApplicationTier_formId_fkey" FOREIGN KEY ("formId") REFERENCES "ApplicationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationQuestion" ADD CONSTRAINT "ApplicationQuestion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "ApplicationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantProfile" ADD CONSTRAINT "ApplicantProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantProfile" ADD CONSTRAINT "ApplicantProfile_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantProfileImage" ADD CONSTRAINT "ApplicantProfileImage_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ApplicantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantProfileImage" ADD CONSTRAINT "ApplicantProfileImage_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_formId_fkey" FOREIGN KEY ("formId") REFERENCES "ApplicationForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ApplicantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "ApplicationTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ApplicationQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDecision" ADD CONSTRAINT "ApplicationDecision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationRefund" ADD CONSTRAINT "ApplicationRefund_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationMessageTemplate" ADD CONSTRAINT "ApplicationMessageTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

