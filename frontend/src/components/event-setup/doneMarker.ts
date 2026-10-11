// "This tab just finished setting up this event" (spec 050-I). Done belongs
// to the create flow only: Review (050-N) calls markSetupFinished(id) before it
// opens ?step=done. Without the marker, a set-up event is in edit mode and
// ?step=done goes to its Details page. sessionStorage, so a refresh on Done
// stays there; it can be missing or throw (private mode), then Done is skipped.

const keyFor = (eventId: string) => `jump:event-setup-done:${eventId}`;

export function markSetupFinished(eventId: string) {
  try {
    window.sessionStorage.setItem(keyFor(eventId), '1');
  } catch {
    // Storage blocked: Save & exit still lands on Details.
  }
}

export function setupJustFinished(eventId: string) {
  try {
    return window.sessionStorage.getItem(keyFor(eventId)) === '1';
  } catch {
    return false;
  }
}

export function clearSetupFinished(eventId: string) {
  try {
    window.sessionStorage.removeItem(keyFor(eventId));
  } catch {
    // Nothing to clear.
  }
}
