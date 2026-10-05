// Theme FeatureGrid section: a heading, an intro and up to 12 Feature blocks
// (image, title, text) in 2-4 columns. The grid is the Puck slot itself, so
// the column count is a class on the slot, never a prop on the blocks.

import type { ReactNode } from 'react';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface FeatureGridProps {
  id: string;
  heading?: string;
  intro?: string;
  columns?: '2' | '3' | '4';
  alignment?: 'center' | 'left';
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  /** Puck renders the Feature blocks into this slot. */
  Items: (props?: { className?: string }) => ReactNode;
  ctx: SectionContext;
}

const COLUMNS = { '2': 'sm:grid-cols-2', '3': 'sm:grid-cols-2 lg:grid-cols-3', '4': 'sm:grid-cols-2 lg:grid-cols-4' } as const;

export default function FeatureGridSection({ id, heading = '', intro = '', columns = '3', alignment = 'center', Items, ctx: _ctx, ...common }: FeatureGridProps) {
  const headingId = `features-${id}`;
  const centered = alignment === 'center';
  return (
    <SectionShell type="FeatureGrid" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          {(heading || intro) && (
            <div className={`max-w-3xl ${centered ? 'mx-auto text-center' : ''}`}>
              {heading && (
                <h2 id={headingId} className="text-balance text-3xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-4xl">
                  {heading}
                </h2>
              )}
              {intro && <p className="mt-3 text-lg text-gray-600 dark:text-slate-300">{intro}</p>}
            </div>
          )}
          <Items
            className={`grid grid-cols-1 gap-x-8 gap-y-10 ${COLUMNS[columns] ?? COLUMNS['3']} ${heading || intro ? 'mt-10' : ''} ${centered ? 'text-center' : ''}`}
          />
        </div>
      </section>
    </SectionShell>
  );
}
