// Theme Stat block: one row of a Stats list. The label comes first in the
// markup (dt before dd, read as "Attendees a year, 25,000+") and the number
// is shown on top.

import type { SectionContext } from './context';

export interface StatProps {
  id: string;
  value?: string;
  label?: string;
  ctx: SectionContext;
}

export default function StatBlock({ value = '', label = '' }: StatProps) {
  if (!value && !label) return null;
  return (
    <div data-stat className="flex flex-col-reverse justify-end gap-2 bg-white px-5 py-6 dark:bg-slate-800 sm:px-6 sm:py-8">
      <dt className="text-pretty text-sm font-medium leading-snug text-gray-600 dark:text-slate-300 sm:text-base">{label}</dt>
      {/* Words ("Indoor & outdoor") step down a size so they stay one or two lines on a phone. */}
      <dd className={`font-extrabold tabular-nums tracking-tight text-brand-link ${value.length > 8 ? 'text-2xl sm:text-3xl' : 'text-4xl sm:text-5xl'}`}>{value}</dd>
    </div>
  );
}
