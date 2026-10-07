'use client';

// Gallery carousel (spec 046, WAI-ARIA APG basic carousel): a scroll-snap row
// of whole photos with the next one peeking in. Previous / next are visible
// at every width (swipe is never the only way, 2.5.7). Autoplay is opt-in:
// the pause button comes first, rotation holds on hover and focus, stops for
// good once the visitor moves, and never starts under reduced motion (2.2.2).

import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveAssetUrl } from '@/lib/assets';
import { fillCount, resolveSrcset, type FlatGalleryItem, type GalleryLabels } from '@/lib/galleries';
import { GALLERY_OPEN_ATTR } from '@/theme/sections/islandClasses';

interface GalleryCarouselProps {
  items: FlatGalleryItem[];
  title: string;
  /** The placement heading names the carousel when there is one. */
  labelledBy?: string;
  labels: GalleryLabels;
  autoplayMs: number;
  showCaptions: boolean;
}

const control =
  'inline-flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 aria-disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950';

export default function GalleryCarousel({ items, title, labelledBy, labels, autoplayMs, showCaptions }: GalleryCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const [paused, setPaused] = useState(autoplayMs <= 0);
  const [holding, setHolding] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const total = items.length;
  const timed = autoplayMs > 0 && total > 1;
  const rotating = timed && !paused;

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setPaused(true);
  }, []);

  const step = () => {
    const track = trackRef.current;
    const first = track?.children[0] as HTMLElement | undefined;
    if (!track || !first) return 0;
    return first.offsetWidth + parseFloat(getComputedStyle(track).columnGap || '0');
  };

  const sync = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const width = step();
    setIndex(width ? Math.round(track.scrollLeft / width) : 0);
    setAtEnd(track.scrollLeft + track.clientWidth >= track.scrollWidth - 2);
  }, []);

  const goTo = useCallback((to: number) => {
    const track = trackRef.current;
    if (!track) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ left: Math.max(0, to) * step(), behavior: reduced ? 'auto' : 'smooth' });
  }, []);

  /** The visitor moved the photos: stop rotating for good, say where they are. */
  const byVisitor = (to: number) => {
    setPaused(true);
    setAnnounce(true);
    goTo(to);
  };

  useEffect(() => {
    if (!rotating || holding) return;
    const timer = window.setTimeout(() => goTo(atEnd ? 0 : index + 1), autoplayMs);
    return () => window.clearTimeout(timer);
  }, [rotating, holding, index, atEnd, autoplayMs, goTo]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label={labelledBy ? undefined : title}
      aria-labelledby={labelledBy}
      onMouseEnter={() => setHolding(true)}
      onMouseLeave={() => setHolding(false)}
      onFocus={() => setHolding(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHolding(false);
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        {timed && (
          <button
            type="button"
            className={control}
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused}
            aria-label={labels.pause}
          >
            {paused ? <Play className="h-4 w-4 translate-x-px" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
          </button>
        )}
        <p className="sr-only" aria-live={rotating ? 'off' : 'polite'} aria-atomic="true">
          {announce ? fillCount(labels.counter, index + 1, total) : ''}
        </p>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={control}
            aria-label={labels.previous}
            aria-disabled={index === 0}
            onClick={() => index > 0 && byVisitor(index - 1)}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            className={control}
            aria-label={labels.next}
            aria-disabled={atEnd}
            onClick={() => !atEnd && byVisitor(index + 1)}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>
      {/* Slides are groups (APG), not list items: a list may only hold items. */}
      <div
        ref={trackRef}
        onScroll={sync}
        onTouchStart={() => setPaused(true)}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <div
            key={item.id}
            role="group"
            aria-roledescription="slide"
            aria-label={fillCount(labels.counter, i + 1, total)}
            className="w-[85%] shrink-0 snap-start md:w-[38%] lg:w-[27%]"
          >
            <button
              type="button"
              {...{ [GALLERY_OPEN_ATTR]: i }}
              aria-label={`${fillCount(labels.open, i + 1, total)}${item.alt ? `: ${item.alt}` : ''}`}
              className="flex h-[clamp(14rem,50vw,28rem)] w-full items-center justify-center overflow-hidden rounded-lg bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:bg-slate-800 dark:focus-visible:ring-offset-slate-950"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveAssetUrl(item.src) || undefined}
                srcSet={resolveSrcset(item.srcset)}
                sizes="(min-width: 1024px) 27vw, (min-width: 768px) 38vw, 85vw"
                width={item.width ?? undefined}
                height={item.height ?? undefined}
                alt=""
                loading={i < 3 ? 'eager' : 'lazy'}
                decoding="async"
                className="h-full w-full object-contain"
              />
            </button>
            {showCaptions && item.caption && (
              <p className="mt-1.5 text-sm text-gray-600 dark:text-slate-400">{item.caption}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
