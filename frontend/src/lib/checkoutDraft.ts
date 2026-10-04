// Per-tab memory for the storefront checkout. Stripe's cancel_url sends the
// buyer back to the event page with `?status=cancelled`; without this the cart
// and contact details they typed are gone and they start over. sessionStorage
// only: it can be missing or throw (private mode, blocked storage), so every
// read and write is guarded and the flow still works without it.

export interface CheckoutCartLine {
  priceTierId: string;
  quantity: number;
}

export interface CheckoutAddOnLine {
  addOnId: string;
  quantity: number;
}

export interface CheckoutDraft {
  items: CheckoutCartLine[];
  addOns: CheckoutAddOnLine[];
}

export interface CheckoutContactDraft {
  firstName: string;
  lastName: string;
  email: string;
}

const cartKey = (eventId: string) => `jump.checkout.cart.${eventId}`;
// Contact details are scoped to one organization: a shared device must never
// prefill one organizer's checkout with a buyer typed in at another.
const contactKey = (scope: string) => `jump.checkout.contact.${scope}`;

function read<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the draft is a convenience only */
  }
}

function positiveLines<T extends { quantity: number }>(value: unknown, idKey: keyof T): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (line): line is T =>
      typeof line?.[idKey] === 'string' && Number.isInteger(line?.quantity) && line.quantity > 0
  );
}

export function saveCheckoutDraft(eventId: string, draft: CheckoutDraft) {
  write(cartKey(eventId), draft);
}

export function loadCheckoutDraft(eventId: string): CheckoutDraft | null {
  const stored = read<Partial<CheckoutDraft>>(cartKey(eventId));
  if (!stored) return null;
  const items = positiveLines<CheckoutCartLine>(stored.items, 'priceTierId');
  if (items.length === 0) return null;
  return { items, addOns: positiveLines<CheckoutAddOnLine>(stored.addOns, 'addOnId') };
}

export function clearCheckoutDraft(eventId: string) {
  try {
    window.sessionStorage.removeItem(cartKey(eventId));
  } catch {
    /* ignore */
  }
}

export function saveContactDraft(scope: string, contact: CheckoutContactDraft) {
  write(contactKey(scope), contact);
}

export function loadContactDraft(scope: string): CheckoutContactDraft | null {
  const stored = read<Partial<CheckoutContactDraft>>(contactKey(scope));
  if (!stored) return null;
  return {
    firstName: typeof stored.firstName === 'string' ? stored.firstName : '',
    lastName: typeof stored.lastName === 'string' ? stored.lastName : '',
    email: typeof stored.email === 'string' ? stored.email : '',
  };
}
