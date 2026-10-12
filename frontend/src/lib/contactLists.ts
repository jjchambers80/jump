// Contacts › Lists (spec 055). Types and the plain-words filter summary shared
// by the Lists tab, a list's page and the create / edit dialog.

export type ContactListType = 'AUTOMATIC' | 'MANUAL';

export interface ContactListFilters {
  scope?: 'customers';
  source?: 'tickets' | 'rsvp' | 'subscribed' | 'form';
  formId?: string;
  rsvpEventId?: string;
  ticketEventId?: string;
  tag?: string;
  minSpent?: number;
  activeWithinDays?: number;
}

export interface ContactList {
  id: string;
  name: string;
  type: ContactListType;
  builtIn: boolean;
  filters: ContactListFilters | null;
  contactCount: number;
  createdBy: { id: string; name: string | null } | null;
  createdAt: string | null;
  lastActivityAt: string | null;
  filterWarnings?: { field: string; message: string }[];
}

export interface NamedOption {
  id: string;
  name: string;
}

const SOURCE_WORDS: Record<NonNullable<ContactListFilters['source']>, string> = {
  tickets: 'Bought tickets',
  rsvp: "RSVP'd",
  subscribed: 'Subscribed to email',
  form: 'Submitted a form',
};

/** $50, $12.50 */
const money = (amount: number) => {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
};

/** "Bought tickets to Spring Market · spent at least $50"; "Everyone" when no filter is set. */
export function describeFilters(
  filters: ContactListFilters | null | undefined,
  { events = [], forms = [] }: { events?: NamedOption[]; forms?: NamedOption[] } = {}
): string {
  const f = filters ?? {};
  const name = (options: NamedOption[], id: string, fallback: string) => options.find((o) => o.id === id)?.name ?? fallback;
  const parts: string[] = [];
  if (f.scope === 'customers') parts.push('Paying contacts');
  if (f.source === 'form') parts.push(f.formId ? `Submitted ${name(forms, f.formId, 'a form')}` : SOURCE_WORDS.form);
  else if (f.source) parts.push(SOURCE_WORDS[f.source]);
  if (f.ticketEventId) parts.push(`Bought tickets to ${name(events, f.ticketEventId, 'an event')}`);
  if (f.rsvpEventId) parts.push(`RSVP'd to ${name(events, f.rsvpEventId, 'an event')}`);
  if (f.tag) parts.push(`Tagged “${f.tag}”`);
  if (f.minSpent) parts.push(`spent at least ${money(f.minSpent)}`);
  if (f.activeWithinDays) parts.push(`active in the last ${f.activeWithinDays} days`);
  if (parts.length === 0) return 'Everyone';
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Drop empty values so the API stores only what was chosen. */
export function cleanFilters(filters: ContactListFilters): ContactListFilters {
  const out: ContactListFilters = {};
  for (const [key, value] of Object.entries(filters) as [keyof ContactListFilters, unknown][]) {
    if (value === undefined || value === null || value === '' || Number.isNaN(value)) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  if (out.source !== 'form') delete out.formId;
  return out;
}

export const contactListHref = (id: string) => `/admin/contacts/lists/${encodeURIComponent(id)}`;
