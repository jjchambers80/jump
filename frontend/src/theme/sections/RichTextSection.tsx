// Theme RichText section (spec 038 §7, card 038S). The body is organizer HTML
// sanitised on write and rendered only through ContentHtml (gotcha 20).

import type { ReactNode } from 'react';
import ContentHtml from '@/components/storefront/ContentHtml';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface RichTextProps {
  id: string;
  heading?: string;
  body?: string;
  alignment?: 'left' | 'center';
  width?: 'narrow' | 'normal' | 'wide';
  colorScheme?: string;
  paddingTop?: number;
  paddingBottom?: number;
  Buttons: (props?: { className?: string }) => ReactNode;
  ctx: SectionContext;
}

const WIDTH = { narrow: 'max-w-2xl', normal: 'max-w-3xl', wide: 'max-w-5xl' } as const;

export default function RichTextSection({ id, heading = '', body = '', alignment = 'left', width = 'normal', Buttons, ctx: _ctx, ...common }: RichTextProps) {
  const headingId = `richtext-${id}`;
  const centered = alignment === 'center';
  return (
    <SectionShell type="RichText" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className="px-4 py-12 sm:px-6 lg:px-8">
        <div className={`mx-auto ${WIDTH[width] ?? WIDTH.normal} ${centered ? 'text-center' : ''}`}>
          {heading && (
            <h2 id={headingId} className="text-3xl font-bold tracking-tight text-gray-900 dark:text-slate-100">
              {heading}
            </h2>
          )}
          {body && <ContentHtml html={body} className={heading ? 'mt-4' : ''} />}
          <Buttons className={`mt-6 flex flex-wrap gap-3 ${centered ? 'justify-center' : ''}`} />
        </div>
      </section>
    </SectionShell>
  );
}
