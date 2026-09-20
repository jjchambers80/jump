-- Spec 031 phase 1: Settings › Customer accounts — sign-in links toggle
ALTER TABLE "Organization" ADD COLUMN "buyerSignInLinks" BOOLEAN NOT NULL DEFAULT true;
