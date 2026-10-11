// Spec 050: the event setup wizard ships dark behind this build-time flag
// until 050-O reaches parity; 050-P flips it on in prod and deletes it.
export const EVENT_WIZARD_ENABLED = process.env.NEXT_PUBLIC_EVENT_WIZARD_ENABLED === 'true';
