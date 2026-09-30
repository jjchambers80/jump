-- Spec 040 card B: patron account — profile edits by the buyer, verified
-- email change, marketing preference, sign out of all devices.

-- AlterEnum
ALTER TYPE "BuyerTokenPurpose" ADD VALUE 'EMAIL_CHANGE';
ALTER TYPE "BuyerTokenPurpose" ADD VALUE 'DELETE_CONFIRM';

-- AlterEnum
ALTER TYPE "EmailSubscribedSource" ADD VALUE 'ACCOUNT';

-- AlterEnum
ALTER TYPE "ContactCommentKind" ADD VALUE 'PROFILE_UPDATED';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "buyerSessionsValidAfter" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BuyerLoginToken" ADD COLUMN "payload" JSONB;

-- AlterTable: a null author is the customer, editing from their own account.
ALTER TABLE "ContactComment" ALTER COLUMN "authorUserId" DROP NOT NULL;
