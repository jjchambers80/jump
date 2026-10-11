// Whether the organization may accept gifts on its events (spec 047 D1 §3.8:
// NEXT_PUBLIC_DONATIONS_ENABLED, Connect direct charges on, DV-verified,
// DONATION_TERMS accepted). Feeds StepCtx.donationsEligible, which shows the
// Collect more step on RSVP events too (spec 050 §10).
// ponytail: always false until D1 ships its settings payload; D1-G reads it here.
export function useDonationsEligible(_orgId: string | null): boolean {
  return false;
}
