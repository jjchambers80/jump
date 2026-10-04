// Theme Hero section (spec 038 §7, card 038S): heading, text, an optional
// image or looping video (behind the text in a rounded frame, edge to edge at
// full section width, or an image beside it) and up to two buttons.

import type { ReactNode } from 'react';
import SectionShell from './SectionShell';
import { HeroScreenOffset, HeroVideo } from './HeroVideo';
import { t, type SectionContext } from './context';

export interface HeroProps {
  id: string;
  heading?: string;
  subheading?: string;
  image?: { fileId: string; alt?: string; decorative?: boolean } | null;
  video?: { fileId: string } | null;
  videoWebm?: { fileId: string } | null;
  layout?: 'full-bleed' | 'split-left' | 'split-right';
  overlay?: number;
  alignment?: 'center' | 'left';
  height?: 'small' | 'medium' | 'large' | 'screen';
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  /** Puck renders the Button blocks into this slot. */
  Buttons: (props?: { className?: string }) => ReactNode;
  ctx: SectionContext;
}

export const MIN_HEIGHT = {
  small: 'min-h-[18rem]',
  medium: 'min-h-[26rem]',
  large: 'min-h-[36rem]',
  // The window below the header; HeroScreenOffset measures the header.
  screen: 'min-h-[calc(100svh-var(--hero-offset,4rem))]',
} as const;

/**
 * The image fitted whole (contain), whatever its orientation, over a blurred
 * copy of itself so there are never empty bars, under a black overlay
 * (0-1, or a CSS value). Fills its positioned, isolated parent. Shared with
 * the carousel's slides.
 */
export function HeroMedia({
  url,
  alt,
  overlay,
  loading,
  cover = false,
}: {
  url: string;
  alt: string;
  overlay: number | string;
  loading?: 'lazy';
  /** Crop to fill instead (edge-to-edge heroes); no blurred backdrop. */
  cover?: boolean;
}) {
  if (cover) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} loading={loading} className="absolute inset-0 -z-10 h-full w-full object-cover" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-black" style={{ opacity: overlay }} />
      </>
    );
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        aria-hidden
        loading={loading}
        data-testid="hero-backdrop"
        className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-80 blur-2xl saturate-150"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} loading={loading} className="absolute inset-0 -z-10 h-full w-full object-contain" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-black" style={{ opacity: overlay }} />
    </>
  );
}

export default function HeroSection({
  id,
  heading = '',
  subheading = '',
  image,
  video,
  videoWebm,
  layout = 'full-bleed',
  overlay = 40,
  alignment = 'center',
  height = 'medium',
  Buttons,
  ctx,
  ...common
}: HeroProps) {
  const file = image?.fileId ? ctx.resolved.files[image.fileId] : null;
  const videos = [video, videoWebm]
    .map((v) => (v?.fileId ? ctx.resolved.files[v.fileId] : null))
    .filter((f): f is NonNullable<typeof f> => Boolean(f))
    .map((f) => ({ url: f.url, type: f.mimeType }));
  const minHeight = MIN_HEIGHT[height] ?? MIN_HEIGHT.medium;
  const screenOffset = height === 'screen' ? <HeroScreenOffset /> : null;
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

  if ((file || videos.length) && layout === 'full-bleed') {
    // Inside the header and event list container (max-w-7xl) with 32px
    // corners; full section width is edge to edge with square corners.
    const full = common.sectionWidth === 'full';
    const opacity = Math.min(80, Math.max(0, overlay)) / 100;
    return (
      <SectionShell type="Hero" props={common}>
        <div className={full ? 'w-full' : 'mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8'}>
          <section
            aria-labelledby={heading ? headingId : undefined}
            className={`relative isolate flex items-center overflow-hidden bg-slate-900 ${full ? '' : 'rounded-[32px]'} ${minHeight}`}
          >
            {screenOffset}
            {videos.length ? (
              <>
                <HeroVideo
                  sources={videos}
                  poster={file?.url}
                  pauseLabel={t(ctx, 'hero.pauseVideo')}
                  autoplay={!ctx.editing}
                  edgeToEdge={full}
                />
                {/* The video is decorative; the image's alt text still reaches screen readers. */}
                {file && alt && <span className="sr-only" role="img" aria-label={alt} />}
                <div aria-hidden className="absolute inset-0 -z-10 bg-black" style={{ opacity }} />
              </>
            ) : (
              file && <HeroMedia url={file.url} alt={alt} overlay={opacity} cover={full} />
            )}
            {!full && <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[32px] ring-1 ring-inset ring-white/10" />}
            <div className="w-full px-6 py-16 sm:px-10 lg:px-12">{text(true)}</div>
          </section>
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell type="Hero" props={common}>
      <section aria-labelledby={heading ? headingId : undefined} className={`relative flex items-center ${minHeight}`}>
        {screenOffset}
        <div
          className={`mx-auto grid w-full max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:px-8 ${
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
