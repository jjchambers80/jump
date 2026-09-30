'use client';

// HeroCarousel island (spec 041): the rounded frame around the slide track
// plus previous / next, one dot per slide and an optional rotation. The
// rotation has a pause control (WCAG 2.2.2), stops while the pointer or focus
// is inside, and never starts under prefers-reduced-motion. The track is
// server-rendered slot markup, so slides are found in the DOM, not in props.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { CAROUSEL_TRACK_CLASS } from './islandClasses';

export interface CarouselLabels {
  carousel: string;
  previous: string;
  next: string;
  pause: string;
  /** "Slide {n} of {total}" */
  slide: string;
}

const slideLabel = (template: string, n: number, total: number) =>
  template.replace('{n}', String(n)).replace('{total}', String(total));

export default function HeroCarouselFrame({
  id,
  intervalMs,
  showArrows,
  showDots,
  labels,
  children,
}: {
  id: string;
  intervalMs: number;
  showArrows: boolean;
  showDots: boolean;
  labels: CarouselLabels;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLElement>(null);
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const reduced = useRef(false);

  const track = () => frameRef.current?.querySelector<HTMLElement>(`.${CAROUSEL_TRACK_CLASS}`) ?? null;
  const slides = () => Array.from(track()?.children ?? []) as HTMLElement[];

  // Slide count, slide semantics and the active slide. The editor adds and
  // removes slides under us, so the track is observed, not read once.
  useEffect(() => {
    reduced.current = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if (reduced.current) setPaused(true);
    const el = track();
    if (!el) return;
    let visible: IntersectionObserver | null = null;
    const label = () => {
      const list = slides();
      setCount(list.length);
      list.forEach((slide, i) => {
        slide.setAttribute('role', 'group');
        slide.setAttribute('aria-roledescription', 'slide');
        slide.setAttribute('aria-label', slideLabel(labels.slide, i + 1, list.length));
      });
      visible?.disconnect();
      if (typeof IntersectionObserver === 'undefined') return;
      visible = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) setIndex(list.indexOf(entry.target as HTMLElement));
          }
        },
        { root: el, threshold: 0.6 },
      );
      list.forEach((slide) => visible?.observe(slide));
    };
    label();
    const changes = new MutationObserver(label);
    changes.observe(el, { childList: true });
    return () => {
      changes.disconnect();
      visible?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels.slide]);

  const goTo = useCallback((to: number) => {
    const el = track();
    const list = slides();
    if (!el || !list.length) return;
    const next = (to + list.length) % list.length;
    // Every slide is exactly one track wide.
    el.scrollTo({ left: next * el.clientWidth, behavior: reduced.current ? 'auto' : 'smooth' });
    setIndex(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotating = count > 1 && intervalMs > 0 && !paused && !holding;
  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => goTo(index + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [rotating, intervalMs, index, goTo]);

  const many = count > 1;
  const round =
    'inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-white';

  return (
    <section
      ref={frameRef}
      id={`carousel-${id}`}
      aria-roledescription="carousel"
      aria-label={labels.carousel}
      data-testid="hero-carousel"
      className="relative overflow-hidden rounded-[32px] bg-slate-900"
      onMouseEnter={() => setHolding(true)}
      onMouseLeave={() => setHolding(false)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.carouselControl) return;
        if (e.key === 'ArrowLeft') goTo(index - 1);
        if (e.key === 'ArrowRight') goTo(index + 1);
      }}
    >
      {/* Focus on a slide's link holds the rotation; focus on the controls does
          not, so Play works from the keyboard. */}
      <div
        aria-live={rotating ? 'off' : 'polite'}
        className="contents"
        onFocus={() => setHolding(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHolding(false);
        }}
      >
        {children}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[32px] ring-1 ring-inset ring-white/10" />
      {many && showArrows && (
        <>
          <button type="button" data-carousel-control="1" className={`${round} absolute left-3 top-1/2 -translate-y-1/2 sm:left-4`} onClick={() => goTo(index - 1)} aria-label={labels.previous}>
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button type="button" data-carousel-control="1" className={`${round} absolute right-3 top-1/2 -translate-y-1/2 sm:right-4`} onClick={() => goTo(index + 1)} aria-label={labels.next}>
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </>
      )}
      {many && (showDots || intervalMs > 0) && (
        <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3">
          {showDots && (
            <div className="flex items-center gap-1 rounded-full bg-black/35 px-2 py-1 backdrop-blur-sm">
              {Array.from({ length: count }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  data-carousel-control="1"
                  onClick={() => goTo(i)}
                  aria-label={slideLabel(labels.slide, i + 1, count)}
                  aria-current={i === index ? 'true' : undefined}
                  className="group inline-flex h-6 w-6 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <span
                    aria-hidden
                    className={`block h-2 rounded-full bg-white transition-all motion-reduce:transition-none ${i === index ? 'w-5 opacity-100' : 'w-2 opacity-60 group-hover:opacity-90'}`}
                  />
                </button>
              ))}
            </div>
          )}
          {intervalMs > 0 && (
            <button type="button" data-carousel-control="1" className={`${round} h-8 w-8`} onClick={() => setPaused((p) => !p)} aria-pressed={paused} aria-label={labels.pause}>
              {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
