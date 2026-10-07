// Theme Tiers section: a heading, an intro and up to six Tier blocks
// (sponsorship levels, booth packages), one column on phones and two from md,
// so long benefit lists stay readable. The list is the Puck slot (`as="ul"`).

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface TiersProps {
  id: string;
  heading?: string;
  intro?: string;
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  /** Puck renders the Tier blocks into this slot. */
  Items: (props?: Record<string, unknown>) => ReactNode;
  ctx: SectionContext;
}

// Puck passes the slot only className/style/ref, so the role rides on the
// element: Safari drops list semantics from a list-style: none list.
const RoleList = forwardRef<HTMLUListElement, ComponentPropsWithoutRef<'ul'>>(function RoleList(props, ref) {
  return <ul ref={ref} role="list" {...props} />;
});

export default function TiersSection({ id, heading = '', intro = '', Items, ctx: _ctx, ...common }: TiersProps) {
  const headingId = `tiers-${id}`;
  return (
    <SectionShell type="Tiers" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          {(heading || intro) && (
            <div className="max-w-3xl">
              {heading && (
                <h2 id={headingId} className="text-balance text-3xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-4xl">
                  {heading}
                </h2>
              )}
              {intro && <p className="mt-3 text-pretty text-lg text-gray-600 dark:text-slate-300">{intro}</p>}
            </div>
          )}
          {/* pt-3 leaves room for a highlighted tier's label above its card. */}
          <Items
            as={RoleList}
            className={`grid grid-cols-1 gap-6 pt-3 md:grid-cols-2 ${heading || intro ? 'mt-8' : ''}`}
          />
        </div>
      </section>
    </SectionShell>
  );
}
