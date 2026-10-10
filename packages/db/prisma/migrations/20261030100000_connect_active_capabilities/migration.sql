-- Spec 047 D0-S: charges are created on the organization's own Stripe account,
-- so the payment methods Checkout may offer depend on that account's
-- capabilities, not the platform's. Snapshot of the active ones, written by
-- every account sync (ConnectService.accountToRow). Additive, nullable-safe.
ALTER TABLE "OrganizationStripeAccount" ADD COLUMN "activeCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[];
