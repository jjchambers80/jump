'use client';

// HeroCarousel island (spec 041): the rounded frame around the slide track
// plus previous / next, one dot per slide and an optional rotation. The track
// is server-rendered slot markup, so slides are found in the DOM, not props.
//
// Rotation (WCAG 2.2.2): a pause button; holds while the pointer is over the
// carousel or a slide's link has focus; stops for good once the visitor moves
// the slides themselves; never starts under prefers-reduced-motion. The active
// dot fills over the interval and its animation end advances the slide, so the
// progress shown and the timer can never drift apart.

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
  edgeToEdge = false,
  children,
}: {
  id: string;
  intervalMs: number;
  showArrows: boolean;
  showDots: boolean;
  labels: CarouselLabels;
  /** sectionWidth "full": square corners so the frame meets the viewport edges. */
  edgeToEdge?: boolean;
  children: ReactNode;
}) {
  const corners = edgeToEdge ? '' : 'rounded-[32px]';
  const frameRef = useRef<HTMLElement>(null);
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [announce, setAnnounce] = useState(false);
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
    // Theme editor: bring the slide selected in the Sections panel into view.
    const follow = () => {
      const i = slides().findIndex((slide) => slide.matches('[data-editor-selected]') || slide.querySelector('[data-editor-selected]'));
      if (i >= 0) goToRef.current(i);
    };
    label();
    follow();
    const changes = new MutationObserver((records) => {
      if (records.some((r) => r.type === 'childList' && r.target === el)) label();
      follow();
    });
    changes.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-editor-selected'] });
    return () => {
      changes.disconnect();
      visible?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels.slide]);

  // The active slide's copy settles in (globals.css, motion-safe only).
  useEffect(() => {
    slides().forEach((slide, i) => slide.toggleAttribute('data-active', i === index));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count]);

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

  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  /** The visitor moved the slides: stop rotating and say where they are. */
  const byVisitor = (to: number) => {
    setPaused(true);
    setAnnounce(true);
    goTo(to);
  };

  const many = count > 1;
  const timed = many && intervalMs > 0;
  const rotating = timed && !paused;
  const round =
    'inline-flex items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40';

  // Fills over the interval; its end is the rotation's only clock.
  const progress = (className: string) =>
    rotating ? (
      <span
        key={`progress-${index}`}
        aria-hidden
        className={`hero-carousel-progress ${className}`}
        style={{ animationDuration: `${intervalMs}ms`, animationPlayState: holding ? 'paused' : 'running' }}
        onAnimationEnd={() => goTo(index + 1)}
      />
    ) : null;

  return (
    <section
      ref={frameRef}
      id={`carousel-${id}`}
      aria-roledescription="carousel"
      aria-label={labels.carousel}
      data-testid="hero-carousel"
      className={`relative overflow-hidden bg-slate-900 ${corners}`}
      onMouseEnter={() => setHolding(true)}
      onMouseLeave={() => setHolding(false)}
      onKeyDown={(e) => {
        if (!(e.target as HTMLElement).dataset.carouselControl) return;
        if (e.key === 'ArrowLeft') byVisitor(index - 1);
        if (e.key === 'ArrowRight') byVisitor(index + 1);
      }}
    >
      {/* Focus on a slide's link holds the rotation; focus on the controls
          does not, so Play works from the keyboard. A swipe is the visitor
          taking over, like an arrow press. */}
      <div
        className="contents"
        onFocus={() => setHolding(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHolding(false);
        }}
        onTouchStart={() => setPaused(true)}
      >
        {children}
      </div>
      <div aria-hidden className={`pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10 ${corners}`} />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce && many ? slideLabel(labels.slide, index + 1, count) : ''}
      </p>

      {/* Phones swipe; arrows would sit on the text there. */}
      {many && showArrows && (
        <>
          <button
            type="button"
            data-carousel-control="1"
            className={`${round} absolute left-4 top-1/2 hidden h-11 w-11 -translate-y-1/2 sm:inline-flex`}
            onClick={() => byVisitor(index - 1)}
            aria-label={labels.previous}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            data-carousel-control="1"
            className={`${round} absolute right-4 top-1/2 hidden h-11 w-11 -translate-y-1/2 sm:inline-flex`}
            onClick={() => byVisitor(index + 1)}
            aria-label={labels.next}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </>
      )}

      {many && (showDots || timed) && (
        <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-2">
          {showDots && (
            <div className="flex items-center rounded-full bg-black/40 px-1.5 py-0.5 backdrop-blur-sm">
              {Array.from({ length: count }, (_, i) => {
                const active = i === index;
                return (
                  <button
                    key={i}
                    type="button"
                    data-carousel-control="1"
                    onClick={() => byVisitor(i)}
                    aria-label={slideLabel(labels.slide, i + 1, count)}
                    aria-current={active ? 'true' : undefined}
                    className="group inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <span
                      aria-hidden
                      className={`relative block h-1.5 overflow-hidden rounded-full transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none ${
                        active ? `w-6 ${rotating ? 'bg-white/35' : 'bg-white'}` : 'w-1.5 bg-white/55 group-hover:bg-white/85'
                      }`}
                    >
                      {active && progress('absolute inset-0 rounded-full bg-white')}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {timed && (
            <button
              type="button"
              data-carousel-control="1"
              className={`${round} h-8 w-8`}
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              aria-label={labels.pause}
            >
              {paused ? <Play className="h-3.5 w-3.5 translate-x-px" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
            </button>
          )}
        </div>
      )}
      {/* Without dots, the interval shows as a hairline along the bottom edge. */}
      {!showDots && progress('absolute inset-x-0 bottom-0 h-0.5 bg-white/70')}
    </section>
  );
}
