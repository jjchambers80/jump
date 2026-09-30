// Theme Slide block (spec 041): one HeroCarousel slide, drawn like the
// full-bleed Hero. Its button is fields on the slide because theme blocks
// cannot hold blocks of their own.

import ButtonBlock from './ButtonBlock';
import { HeroMedia } from './HeroSection';
import type { ThemeLink } from '../links';
import type { SectionContext } from './context';

export interface SlideProps {
  id: string;
  image?: { fileId: string; alt?: string; decorative?: boolean } | null;
  heading?: string;
  subheading?: string;
  buttonLabel?: string;
  link?: ThemeLink | null;
  alignment?: 'center' | 'left';
  ctx: SectionContext;
}

export default function SlideBlock({ image, heading = '', subheading = '', buttonLabel = '', link, alignment = 'center', ctx }: SlideProps) {
  const file = image?.fileId ? ctx.resolved.files[image.fileId] : null;
  const alt = image?.decorative ? '' : (image?.alt ?? file?.alt ?? '');
  const centered = alignment === 'center';
  return (
    <div data-slide className="relative isolate flex min-h-full items-center overflow-hidden">
      {/* Off-screen slides load lazily; the first is on screen, so it loads at once. */}
      {file && <HeroMedia url={file.url} alt={alt} overlay="var(--carousel-overlay, 0.4)" loading="lazy" />}
      <div className="w-full px-6 pb-20 pt-16 sm:px-20 lg:px-24">
        <div data-slide-copy className={`${centered ? 'mx-auto text-center' : ''} max-w-2xl`}>
          {heading && <h2 className="text-balance text-4xl font-bold tracking-tight text-white [text-shadow:0_1px_16px_rgb(0_0_0/0.35)] sm:text-5xl">{heading}</h2>}
          {subheading && <p className="mt-4 text-pretty text-lg text-white/90 [text-shadow:0_1px_12px_rgb(0_0_0/0.35)]">{subheading}</p>}
          {buttonLabel && (
            <div className={`mt-8 flex ${centered ? 'justify-center' : ''} empty:hidden`}>
              <ButtonBlock label={buttonLabel} link={link} ctx={ctx} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
