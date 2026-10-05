// Theme ImageWithText section: an image beside a heading, rich text and up
// to two buttons; side by side from `lg`, image first on phones. The body is
// organizer HTML sanitised on write and rendered only through ContentHtml.

import type { ReactNode } from 'react';
import ContentHtml from '@/components/storefront/ContentHtml';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface ImageWithTextProps {
  id: string;
  image?: { fileId: string; alt?: string; decorative?: boolean } | null;
  imagePosition?: 'left' | 'right';
  heading?: string;
  body?: string;
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  Buttons: (props?: { className?: string }) => ReactNode;
  ctx: SectionContext;
}

export default function ImageWithTextSection({ id, image, imagePosition = 'left', heading = '', body = '', Buttons, ctx, ...common }: ImageWithTextProps) {
  const file = image?.fileId ? ctx.resolved.files[image.fileId] : null;
  const alt = image?.decorative ? '' : (image?.alt ?? file?.alt ?? '');
  const headingId = `image-text-${id}`;
  return (
    <SectionShell type="ImageWithText" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className="px-4 py-12 sm:px-6 lg:px-8">
        <div className={`mx-auto grid max-w-7xl items-center gap-8 lg:gap-16 ${file ? 'lg:grid-cols-2' : ''}`}>
          {file && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.url}
              alt={alt}
              loading="lazy"
              width={file.width ?? undefined}
              height={file.height ?? undefined}
              className={`aspect-[4/3] w-full rounded-[var(--theme-media-radius,1rem)] object-cover ${imagePosition === 'right' ? 'lg:order-2' : ''}`}
            />
          )}
          <div className={file ? '' : 'mx-auto max-w-3xl'}>
            {heading && (
              <h2 id={headingId} className="text-balance text-3xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-4xl">
                {heading}
              </h2>
            )}
            {body && <ContentHtml html={body} className={heading ? 'mt-4' : ''} />}
            <Buttons className="mt-8 flex flex-wrap gap-3" />
          </div>
        </div>
      </section>
    </SectionShell>
  );
}
