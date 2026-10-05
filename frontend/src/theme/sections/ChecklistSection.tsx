// Theme Checklist section: a heading, an intro and up to 30 short lines in
// 1-3 columns, each with a check (who we want) or a cross (who we don't).
// The list is the Puck slot (`as="ul"`); the marker choice shows one of the
// two icons every ChecklistItem carries, so the blocks need no section props.

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface ChecklistProps {
  id: string;
  heading?: string;
  intro?: string;
  marker?: 'check' | 'cross';
  columns?: '1' | '2' | '3';
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  /** Puck renders the ChecklistItem blocks into this slot. */
  Items: (props?: Record<string, unknown>) => ReactNode;
  ctx: SectionContext;
}

const WIDTH = { '1': 'max-w-3xl', '2': 'max-w-5xl', '3': 'max-w-7xl' } as const;
const COLUMNS = { '1': '', '2': 'sm:grid-cols-2', '3': 'sm:grid-cols-2 lg:grid-cols-3' } as const;
const MARKER = { check: '[&_[data-mark=cross]]:hidden', cross: '[&_[data-mark=check]]:hidden' } as const;

// Puck passes the slot only className/style/ref, so the role rides on the
// element: Safari drops list semantics from a list-style: none list.
const RoleList = forwardRef<HTMLUListElement, ComponentPropsWithoutRef<'ul'>>(function RoleList(props, ref) {
  return <ul ref={ref} role="list" {...props} />;
});

export default function ChecklistSection({ id, heading = '', intro = '', marker = 'check', columns = '2', Items, ctx: _ctx, ...common }: ChecklistProps) {
  const headingId = `checklist-${id}`;
  return (
    <SectionShell type="Checklist" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className="px-4 py-12 sm:px-6 lg:px-8">
        <div className={`mx-auto ${WIDTH[columns] ?? WIDTH['2']}`}>
          {heading && (
            <h2 id={headingId} className="text-balance text-3xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-4xl">
              {heading}
            </h2>
          )}
          {intro && <p className="mt-3 max-w-3xl text-pretty text-lg text-gray-600 dark:text-slate-300">{intro}</p>}
          <Items
            as={RoleList}
            className={`grid grid-cols-1 gap-3 ${COLUMNS[columns] ?? COLUMNS['2']} ${MARKER[marker] ?? MARKER.check} ${heading || intro ? 'mt-8' : ''}`}
          />
        </div>
      </section>
    </SectionShell>
  );
}
