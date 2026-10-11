// Spec 050-O: Details → wizard → Details. The Edit control the organizer
// clicked is remembered for this tab (sessionStorage; a convenience, so every
// access is guarded and the page works without it) and focused again when
// Save & exit comes back. The key is the link's href plus its accessible name,
// so two controls opening the same step ("Edit tickets", "Edit admission")
// stay apart.

const KEY = (eventId: string) => `jump:details-edit-control:${eventId}`;
const WIZARD_LINK = 'a[href*="/setup?"]';

const controlKey = (link: Element) =>
  `${link.getAttribute('href')}|${link.getAttribute('aria-label') ?? link.textContent?.trim() ?? ''}`;

/** onClickCapture on the Details page: remembers which wizard link was used. */
export function rememberEditControl(eventId: string, target: EventTarget | null) {
  const link = (target as Element | null)?.closest?.(WIZARD_LINK);
  if (!link) return;
  try {
    window.sessionStorage.setItem(KEY(eventId), controlKey(link));
  } catch {
    /* storage blocked: focus falls back to the title */
  }
}

/** The remembered control on this page (read once), else null. */
export function takeEditControl(eventId: string): HTMLElement | null {
  let key: string | null = null;
  try {
    key = window.sessionStorage.getItem(KEY(eventId));
    window.sessionStorage.removeItem(KEY(eventId));
  } catch {
    return null;
  }
  if (!key) return null;
  return Array.from(document.querySelectorAll<HTMLElement>(WIZARD_LINK)).find((el) => controlKey(el) === key) ?? null;
}
