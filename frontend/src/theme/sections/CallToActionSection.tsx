// Theme CallToAction section (spec 038 §7, card 038S): a short heading, one
// line of text and up to two buttons on the page's accent band.

import type { ReactNode } from 'react';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface CallToActionProps {
  id: string;
  heading?: string;
  text?: string;
  colorScheme?: string;
  paddingTop?: number;
  paddingBottom?: number;
  Buttons: (props?: { className?: string }) => ReactNode;
  ctx: SectionContext;
}

export default function CallToActionSection({ id, heading = '', text = '', Buttons, ctx: _ctx, ...common }: CallToActionProps) {
  const headingId = `cta-${id}`;
  return (
    <SectionShell type="CallToAction" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[var(--theme-page-width,80rem)] rounded-[var(--theme-container-radius,1.5rem)] bg-white px-6 py-12 text-center ring-1 ring-inset ring-gray-200 dark:bg-slate-800 dark:ring-slate-700 sm:px-12">
          {heading && (
            <h2 id={headingId} className="text-3xl font-bold tracking-tight text-gray-900 dark:text-slate-100">
              {heading}
            </h2>
          )}
          {text && <p className="mx-auto mt-3 max-w-2xl text-lg text-gray-600 dark:text-slate-300">{text}</p>}
          <Buttons className="mt-8 flex flex-wrap justify-center gap-3" />
        </div>
      </section>
    </SectionShell>
  );
}
