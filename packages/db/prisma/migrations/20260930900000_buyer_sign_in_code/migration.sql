-- Spec 031 phase 3: one-time code sign-in
CREATE TYPE "BuyerSignInMethod" AS ENUM ('LINK', 'CODE');
ALTER TYPE "BuyerTokenPurpose" ADD VALUE 'CODE';

ALTER TABLE "Organization" ADD COLUMN "buyerSignInMethod" "BuyerSignInMethod" NOT NULL DEFAULT 'LINK';
ALTER TABLE "BuyerLoginToken" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
