'use client';

// Step 1, "What do you want to create?" (spec 057): a live event (tickets or
// RSVPs) or a registration event (one form vendors, or anyone the organizer
// chooses, register through). Client state until the date step creates the
// row; the type is fixed after that.

import { ClipboardList, Ticket, type LucideIcon } from 'lucide-react';
import { useCan } from '@/components/OrgContext';
import type { EventType } from '@/lib/eventOverview';
import { hintClass } from '../ui';
import type { StepFormProps } from './types';

const TYPES: { value: EventType; title: string; detail: string; icon: LucideIcon }[] = [
  { value: 'LIVE', title: 'Live event', detail: 'Sell tickets or take free RSVPs.', icon: Ticket },
  {
    value: 'REGISTRATION',
    title: 'Registration event',
    detail: 'Vendors, sponsors, volunteers or anyone you choose register through a form, free or with a fee.',
    icon: ClipboardList,
  },
];

export default function TypeStep({ fields, onChange, locked }: StepFormProps & { locked: boolean }) {
  // A registration event is an application form: it needs the form permission.
  const canRegister = useCan('applications.forms');
  const chosen = fields.type ?? 'LIVE';
  const options = TYPES.filter((t) => t.value === 'LIVE' || canRegister || chosen === t.value);

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Event type" aria-describedby={locked ? 'setup-type-locked' : undefined} className="space-y-3">
        {options.map(({ value, title, detail, icon: Icon }) => (
          <label
            key={value}
            className="flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border border-gray-300 bg-white p-4 hover:border-gray-400 has-[:checked]:border-accent-600 has-[:checked]:bg-accent-50 has-[:disabled]:cursor-default has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 has-[:focus-visible]:ring-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-slate-500 dark:has-[:checked]:border-accent-400 dark:has-[:checked]:bg-slate-700 dark:has-[:focus-visible]:ring-offset-slate-900"
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-700 dark:text-slate-300" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
              <span className="mt-0.5 block text-sm text-gray-600 dark:text-slate-400">{detail}</span>
            </span>
            <input
              type="radio"
              name="setup-type"
              value={value}
              checked={chosen === value}
              disabled={locked}
              onChange={() => onChange({ type: value, ...(value === 'LIVE' && { linkedEventId: '' }) })}
              className="mt-1 h-5 w-5 shrink-0 accent-accent-600"
            />
          </label>
        ))}
      </div>
      {locked && (
        <p id="setup-type-locked" className={hintClass}>
          The type can&apos;t change once the event is created.
        </p>
      )}
    </div>
  );
}
