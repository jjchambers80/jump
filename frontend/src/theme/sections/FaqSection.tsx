// Theme Faq section (spec 041): a heading, an intro and up to 30 FaqItem
// blocks as native <details> disclosures, so questions open and close
// without JavaScript. FaqBehavior adds "one open at a time" and "open the
// first answer", which need the items the slot renders.

import type { ReactNode } from 'react';
import SectionShell from './SectionShell';
import FaqBehavior from './FaqBehavior';
import { FAQ_LIST_CLASS } from './islandClasses';
import type { SectionContext } from './context';

export interface FaqProps {
  id: string;
  heading?: string;
  intro?: string;
  singleOpen?: boolean;
  openFirst?: boolean;
  width?: 'narrow' | 'normal' | 'wide';
  colorScheme?: string;
  paddingTop?: number;
  paddingBottom?: number;
  /** Puck renders the FaqItem blocks into this slot. */
  Items: (props?: { className?: string }) => ReactNode;
  ctx: SectionContext;
}

const WIDTH = { narrow: 'max-w-2xl', normal: 'max-w-3xl', wide: 'max-w-5xl' } as const;

export default function FaqSection({ id, heading = '', intro = '', singleOpen = true, openFirst = false, width = 'normal', Items, ctx, ...common }: FaqProps) {
  const headingId = `faq-${id}`;
  return (
    <SectionShell type="Faq" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className="px-4 py-12 sm:px-6 lg:px-8">
        <div className={`mx-auto ${WIDTH[width] ?? WIDTH.normal}`}>
          {heading && (
            <h2 id={headingId} className="text-3xl font-bold tracking-tight text-gray-900 dark:text-slate-100">
              {heading}
            </h2>
          )}
          {intro && <p className="mt-3 text-lg text-gray-600 dark:text-slate-300">{intro}</p>}
          <FaqBehavior group={`faq-${id}`} singleOpen={singleOpen} openFirst={openFirst && !ctx.editing}>
            <Items className={`${FAQ_LIST_CLASS} ${heading || intro ? 'mt-8' : ''} divide-y divide-gray-200 border-y border-gray-200 dark:divide-slate-700 dark:border-slate-700`} />
          </FaqBehavior>
        </div>
      </section>
    </SectionShell>
  );
}
