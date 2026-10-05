// Theme Stats section: a heading, an intro and up to six Stat blocks as one
// description list, each number large in the brand color over its label.
// The list is the Puck slot (`as="dl"`), so the blocks are its rows.

import type { ReactNode } from 'react';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface StatsProps {
  id: string;
  heading?: string;
  intro?: string;
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  /** Puck renders the Stat blocks into this slot. */
  Items: (props?: Record<string, unknown>) => ReactNode;
  ctx: SectionContext;
}

export default function StatsSection({ id, heading = '', intro = '', Items, ctx: _ctx, ...common }: StatsProps) {
  const headingId = `stats-${id}`;
  return (
    <SectionShell type="Stats" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          {(heading || intro) && (
            <div className="mx-auto max-w-3xl text-center">
              {heading && (
                <h2 id={headingId} className="text-balance text-3xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-4xl">
                  {heading}
                </h2>
              )}
              {intro && <p className="mt-3 text-pretty text-lg text-gray-600 dark:text-slate-300">{intro}</p>}
            </div>
          )}
          <Items
            as="dl"
            className={`grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-px overflow-hidden rounded-[var(--theme-container-radius,1.5rem)] bg-gray-200 ring-1 ring-inset ring-gray-200 dark:bg-slate-700 dark:ring-slate-700 ${heading || intro ? 'mt-10' : ''}`}
          />
        </div>
      </section>
    </SectionShell>
  );
}
