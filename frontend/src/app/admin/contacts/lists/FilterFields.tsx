'use client';

// The automatic-list filter builder (spec 055 §4.2). Every filter is optional
// and they all apply together; the parent shows the live count.

import type { ContactListFilters, NamedOption } from '@/lib/contactLists';

const control =
  'h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white';
const label = 'mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200';

const ACTIVE_WINDOWS = [30, 90, 180, 365];

export default function FilterFields({
  filters,
  spent,
  onChange,
  onSpentChange,
  events,
  forms,
}: {
  filters: ContactListFilters;
  /** Raw text of the "Spent at least" field, so typing "12." is not rewritten. */
  spent: string;
  onChange: (next: ContactListFilters) => void;
  onSpentChange: (value: string) => void;
  events: NamedOption[];
  forms: NamedOption[];
}) {
  const set = (patch: Partial<ContactListFilters>) => onChange({ ...filters, ...patch });

  return (
    <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
        Add contacts who match all of these
      </legend>

      <div>
        <label htmlFor="list-filter-scope" className={label}>Who</label>
        <select
          id="list-filter-scope"
          value={filters.scope ?? ''}
          onChange={(e) => set({ scope: e.target.value === 'customers' ? 'customers' : undefined })}
          className={control}
        >
          <option value="">Everyone</option>
          <option value="customers">Paying contacts only</option>
        </select>
      </div>

      <div>
        <label htmlFor="list-filter-source" className={label}>Source</label>
        <select
          id="list-filter-source"
          value={filters.source ?? ''}
          onChange={(e) =>
            set({ source: (e.target.value || undefined) as ContactListFilters['source'], formId: undefined })
          }
          className={control}
        >
          <option value="">Any source</option>
          <option value="tickets">Bought tickets</option>
          <option value="rsvp">RSVP&apos;d</option>
          <option value="subscribed">Subscribed to email</option>
          <option value="form">Submitted a form</option>
        </select>
      </div>

      {filters.source === 'form' && (
        <div className="sm:col-span-2">
          <label htmlFor="list-filter-form" className={label}>Form</label>
          <select
            id="list-filter-form"
            value={filters.formId ?? ''}
            onChange={(e) => set({ formId: e.target.value || undefined })}
            className={control}
          >
            <option value="">Any form</option>
            {forms.map((form) => (
              <option key={form.id} value={form.id}>{form.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="list-filter-ticket-event" className={label}>Bought tickets to</label>
        <select
          id="list-filter-ticket-event"
          value={filters.ticketEventId ?? ''}
          onChange={(e) => set({ ticketEventId: e.target.value || undefined })}
          className={control}
        >
          <option value="">Any event</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>{event.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="list-filter-rsvp-event" className={label}>RSVP&apos;d to</label>
        <select
          id="list-filter-rsvp-event"
          value={filters.rsvpEventId ?? ''}
          onChange={(e) => set({ rsvpEventId: e.target.value || undefined })}
          className={control}
        >
          <option value="">Any event</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>{event.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="list-filter-spent" className={label}>Spent at least</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-600 dark:text-slate-400" aria-hidden>
            $
          </span>
          <input
            id="list-filter-spent"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="Any amount"
            value={spent}
            onChange={(e) => onSpentChange(e.target.value)}
            className={`${control} pl-7`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="list-filter-active" className={label}>Last activity</label>
        <select
          id="list-filter-active"
          value={filters.activeWithinDays ?? ''}
          onChange={(e) => set({ activeWithinDays: e.target.value ? Number(e.target.value) : undefined })}
          className={control}
        >
          <option value="">Any time</option>
          {[...new Set([...ACTIVE_WINDOWS, ...(filters.activeWithinDays ? [filters.activeWithinDays] : [])])].sort((a, b) => a - b).map((days) => (
            <option key={days} value={days}>In the last {days} days</option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="list-filter-tag" className={label}>Tag</label>
        <input
          id="list-filter-tag"
          type="text"
          maxLength={50}
          placeholder="Any tag"
          value={filters.tag ?? ''}
          onChange={(e) => set({ tag: e.target.value || undefined })}
          className={control}
        />
      </div>
    </fieldset>
  );
}
