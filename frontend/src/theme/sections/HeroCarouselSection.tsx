// Theme HeroCarousel section (spec 041): up to six Slide blocks in the Hero's
// rounded frame. The slides are a CSS scroll-snap track, so they swipe and
// scroll without JavaScript; HeroCarouselFrame adds arrows, dots and autoplay.

import type { CSSProperties, ReactNode } from 'react';
import SectionShell from './SectionShell';
import HeroCarouselFrame from './HeroCarouselFrame';
import { CAROUSEL_TRACK_CLASS } from './islandClasses';
import { MIN_HEIGHT } from './HeroSection';
import { t, type SectionContext } from './context';

type SlotProps = { className?: string; style?: CSSProperties; collisionAxis?: 'x' | 'y' | 'dynamic' };

export interface HeroCarouselProps {
  id: string;
  autoplay?: 'off' | '5s' | '8s';
  height?: 'small' | 'medium' | 'large';
  overlay?: number;
  showArrows?: boolean;
  showDots?: boolean;
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  /** Puck renders the Slide blocks into this slot. */
  Slides: (props?: SlotProps) => ReactNode;
  ctx: SectionContext;
}

export default function HeroCarouselSection({
  id,
  autoplay = '5s',
  height = 'medium',
  overlay = 40,
  showArrows = true,
  showDots = true,
  Slides,
  ctx,
  ...common
}: HeroCarouselProps) {
  // Slides are rendered by Puck, not by this section, so the section-wide
  // overlay reaches them as a CSS variable on the track.
  const style = { '--carousel-overlay': Math.min(80, Math.max(0, overlay)) / 100 } as CSSProperties;
  // Full width is edge to edge: no gutters, no rounded corners.
  const full = common.sectionWidth === 'full';
  return (
    <SectionShell type="HeroCarousel" props={common}>
      <div className={full ? 'w-full' : 'mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8'}>
        <HeroCarouselFrame
          id={id}
          intervalMs={ctx.editing ? 0 : autoplay === '5s' ? 5000 : autoplay === '8s' ? 8000 : 0}
          showArrows={showArrows}
          showDots={showDots}
          edgeToEdge={full}
          labels={{
            carousel: t(ctx, 'carousel.label'),
            previous: t(ctx, 'carousel.previous'),
            next: t(ctx, 'carousel.next'),
            pause: t(ctx, 'carousel.pause'),
            slide: ctx.content?.['carousel.slide'] ?? 'Slide {n} of {total}',
          }}
        >
          <Slides
            className={`${CAROUSEL_TRACK_CLASS} flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:w-full [&>*]:shrink-0 [&>*]:snap-start [&>*]:snap-always ${MIN_HEIGHT[height] ?? MIN_HEIGHT.medium}`}
            style={style}
            collisionAxis="x"
          />
        </HeroCarouselFrame>
      </div>
    </SectionShell>
  );
}
