-- Spec 047 D0-S: an applicant's Stripe Customer (saved card, spec 011) is
-- created on the organization's own connected account once charges move
-- there. Record which account holds it (null = Jump's platform account) so
-- erasure deletes it in the right place and a Customer from before the
-- organization connected is never reused on the new account. Additive.
ALTER TABLE "Contact" ADD COLUMN "stripeCustomerAccountId" TEXT;
