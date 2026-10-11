// Spec 050: the event setup wizard ships dark behind this build-time flag
// until 050-O reaches parity; 050-P flips it on in prod and deletes it.
export const EVENT_WIZARD_ENABLED = process.env.NEXT_PUBLIC_EVENT_WIZARD_ENABLED === 'true';

/**
 * "Continue setup" target (spec 050 §4): a DRAFT whose create flow has not
 * finished resumes at its last step. Null when the flag is off, the event is
 * set up, or the payload predates the wizard fields (undefined ≠ null).
 */
export function continueSetupHref(
  event: { id: string; status: string; setupStep?: string | null; setupCompletedAt?: string | null },
  enabled = EVENT_WIZARD_ENABLED
): string | null {
  if (!enabled || event.status !== 'DRAFT' || event.setupCompletedAt !== null) return null;
  const step = event.setupStep ? `?step=${encodeURIComponent(event.setupStep)}` : '';
  return `/admin/events/${encodeURIComponent(event.id)}/setup${step}`;
}
