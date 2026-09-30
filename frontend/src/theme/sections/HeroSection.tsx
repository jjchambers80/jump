// Theme Hero section (spec 038 §7, card 038S): heading, text, an optional
// image (behind the text in a rounded frame, or beside it) and up to two buttons.

import type { ReactNode } from 'react';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface HeroProps {
  id: string;
  heading?: string;
  subheading?: string;
  image?: { fileId: string; alt?: string; decorative?: boolean } | null;
  layout?: 'full-bleed' | 'split-left' | 'split-right';
  overlay?: number;
  alignment?: 'center' | 'left';
  height?: 'small' | 'medium' | 'large';
  colorScheme?: string;
  paddingTop?: number;
  paddingBottom?: number;
  /** Puck renders the Button blocks into this slot. */
  Buttons: (props?: { className?: string }) => ReactNode;
  ctx: SectionContext;
}

const MIN_HEIGHT = { small: 'min-h-[18rem]', medium: 'min-h-[26rem]', large: 'min-h-[36rem]' } as const;

export default function HeroSection({
  id,
  heading = '',
  subheading = '',
  image,
  layout = 'full-bleed',
  overlay = 40,
  alignment = 'center',
  height = 'medium',
  Buttons,
  ctx,
  ...common
}: HeroProps) {
  const file = image?.fileId ? ctx.resolved.files[image.fileId] : null;
  const alt = image?.decorative ? '' : (image?.alt ?? file?.alt ?? '');
  const headingId = `hero-${id}`;
  const centered = alignment === 'center';
  const text = (onImage: boolean) => (
    <div className={`${centered ? 'mx-auto text-center' : ''} max-w-2xl`}>
      {heading && (
        <h2 id={headingId} className={`text-4xl font-bold tracking-tight sm:text-5xl ${onImage ? 'text-white' : 'text-gray-900 dark:text-slate-100'}`}>
          {heading}
        </h2>
      )}
      {subheading && (
        <p className={`mt-4 text-lg ${onImage ? 'text-white/90' : 'text-gray-600 dark:text-slate-300'}`}>{subheading}</p>
      )}
      <Buttons className={`mt-8 flex flex-wrap gap-3 ${centered ? 'justify-center' : ''}`} />
    </div>
  );

  if (file && layout === 'full-bleed') {
    // Inside the header and event list container (max-w-7xl) with 32px corners. The image is fitted whole
    // (contain), whatever its orientation, and a blurred copy of itself
    // fills the rest of the frame so there are never empty bars.
    return (
      <SectionShell type="Hero" props={common}>
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
          <section
            aria-labelledby={heading ? headingId : undefined}
            className={`relative isolate flex items-center overflow-hidden rounded-[32px] bg-slate-900 ${MIN_HEIGHT[height]}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={file.url}
              alt=""
              aria-hidden
              data-testid="hero-backdrop"
              className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-80 blur-2xl saturate-150"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={file.url} alt={alt} className="absolute inset-0 -z-10 h-full w-full object-contain" />
            <div aria-hidden className="absolute inset-0 -z-10 bg-black" style={{ opacity: Math.min(80, Math.max(0, overlay)) / 100 }} />
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[32px] ring-1 ring-inset ring-white/10" />
            <div className="w-full px-6 py-16 sm:px-10 lg:px-12">{text(true)}</div>
          </section>
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell type="Hero" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className={`flex items-center ${MIN_HEIGHT[height]}`}>
        <div
          className={`mx-auto grid w-full max-w-[var(--theme-page-width,80rem)] items-center gap-10 px-4 py-16 sm:px-6 lg:px-8 ${
            file ? 'lg:grid-cols-2' : ''
          }`}
        >
          {file && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.url}
              alt={alt}
              className={`aspect-[4/3] w-full rounded-[var(--theme-media-radius,1rem)] object-cover ${layout === 'split-right' ? 'lg:order-2' : ''}`}
            />
          )}
          {text(false)}
        </div>
      </section>
    </SectionShell>
  );
}
