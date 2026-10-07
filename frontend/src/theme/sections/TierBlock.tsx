// Theme Tier block: one package of a Tiers section. Name, tagline and its
// benefits (one per line of plain text) as a list; a highlighted tier gets a
// brand ring and a label on its top edge, after the name in reading order.

import { Check } from 'lucide-react';
import type { SectionContext } from './context';

export interface TierProps {
  id: string;
  name?: string;
  tagline?: string;
  benefits?: string;
  featured?: boolean;
  badge?: string;
  ctx: SectionContext;
}

export function benefitLines(benefits: string): string[] {
  return benefits
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function TierBlock({ name = 'Tier', tagline = '', benefits = '', featured = false, badge = 'Most popular' }: TierProps) {
  const lines = benefitLines(benefits);
  if (!name && !lines.length) return null;
  return (
    <li
      data-featured={featured || undefined}
      className={`relative flex flex-col rounded-[var(--theme-container-radius,1.5rem)] bg-white p-6 dark:bg-slate-800 sm:p-8 ${
        featured ? 'ring-2 ring-inset ring-brand' : 'ring-1 ring-inset ring-gray-200 dark:ring-slate-700'
      }`}
    >
      <div>
        {name && (
          <h3 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100">
            {name}
          </h3>
        )}
        {featured && badge && (
          <p className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-fg sm:left-8">
            {badge}
          </p>
        )}
        {tagline && <p className="mt-1 text-pretty text-sm text-gray-600 dark:text-slate-300">{tagline}</p>}
      </div>
      {lines.length > 0 && (
        <ul role="list" className="mt-6 space-y-3 border-t border-gray-200 pt-6 dark:border-slate-700">
          {lines.map((line, i) => (
            <li key={i} className="flex items-start gap-3">
              <Check aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-brand-link" strokeWidth={2.5} />
              <span className="text-pretty leading-relaxed text-gray-800 dark:text-slate-200">{line}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
