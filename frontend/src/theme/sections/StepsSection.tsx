// Theme Steps section: a heading, an intro and up to six numbered Step
// blocks. The list is the Puck slot (`as="ol"`), so screen readers hear
// "1 of 3"; the large numbers are a CSS counter, never text to keep in sync.

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface StepsProps {
  id: string;
  heading?: string;
  intro?: string;
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  /** Puck renders the Step blocks into this slot. */
  Items: (props?: Record<string, unknown>) => ReactNode;
  ctx: SectionContext;
}

// Puck passes the slot only className/style/ref, so the role rides on the
// element: Safari drops list semantics from a list-style: none list.
const RoleList = forwardRef<HTMLOListElement, ComponentPropsWithoutRef<'ol'>>(function RoleList(props, ref) {
  return <ol ref={ref} role="list" {...props} />;
});

export default function StepsSection({ id, heading = '', intro = '', Items, ctx: _ctx, ...common }: StepsProps) {
  const headingId = `steps-${id}`;
  return (
    <SectionShell type="Steps" props={common}>
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
          <Items
            as={RoleList}
            className={`grid grid-cols-1 gap-4 [counter-reset:step] md:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] ${heading || intro ? 'mt-10' : ''}`}
          />
        </div>
      </section>
    </SectionShell>
  );
}
