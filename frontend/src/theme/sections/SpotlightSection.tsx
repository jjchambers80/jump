// Theme Spotlight section: a quiet band with a small badge or logo, an
// eyebrow, a short heading, one line of text and up to two buttons. Badge
// beside the text from phones up (it is small), buttons full width on phones
// and to the right from `md`. The badge is shown whole (`object-contain`).

import type { ReactNode } from 'react';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface SpotlightProps {
  id: string;
  image?: { fileId: string; alt?: string; decorative?: boolean } | null;
  eyebrow?: string;
  heading?: string;
  text?: string;
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  Buttons: (props?: { className?: string }) => ReactNode;
  ctx: SectionContext;
}

export default function SpotlightSection({ id, image, eyebrow = '', heading = '', text = '', Buttons, ctx, ...common }: SpotlightProps) {
  const file = image?.fileId ? ctx.resolved.files[image.fileId] : null;
  const alt = image?.decorative ? '' : (image?.alt ?? file?.alt ?? '');
  const headingId = `spotlight-${id}`;
  return (
    <SectionShell type="Spotlight" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-5 rounded-[var(--theme-container-radius,1.5rem)] bg-white px-5 py-6 ring-1 ring-inset ring-gray-200 dark:bg-slate-800 dark:ring-slate-700 sm:px-8 md:flex-row md:items-center md:gap-8">
          <div className="flex flex-1 items-center gap-4 sm:gap-6">
            {file && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.url}
                alt={alt}
                loading="lazy"
                width={file.width ?? undefined}
                height={file.height ?? undefined}
                className="size-20 shrink-0 object-contain sm:size-24"
              />
            )}
            <div className="min-w-0">
              {eyebrow && <p className="text-xs font-semibold uppercase tracking-widest text-gray-600 dark:text-slate-300">{eyebrow}</p>}
              {heading && (
                <h2 id={headingId} className="text-balance text-xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-2xl">
                  {heading}
                </h2>
              )}
              {text && <p className="mt-1 text-pretty text-sm text-gray-600 dark:text-slate-300 sm:text-base">{text}</p>}
            </div>
          </div>
          <Buttons className="flex flex-col gap-3 sm:flex-row md:shrink-0" />
        </div>
      </section>
    </SectionShell>
  );
}
