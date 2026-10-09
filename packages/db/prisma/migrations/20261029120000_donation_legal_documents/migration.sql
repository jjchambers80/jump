-- Spec 047 D0-D: donation legal documents. DONATION_TERMS is the charity
-- agreement an org admin accepts before taking gifts (DV); RECURRING_GIFT is
-- the donor's recurring authorization (D3). No caller writes them yet.

-- AlterEnum
ALTER TYPE "LegalDocument" ADD VALUE 'DONATION_TERMS';
ALTER TYPE "LegalDocument" ADD VALUE 'RECURRING_GIFT';
