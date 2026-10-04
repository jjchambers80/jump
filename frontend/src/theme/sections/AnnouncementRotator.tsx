'use client';

// Announcement bar island: one announcement at a time, previous/next when
// there are several, an optional rotation with a pause control (WCAG 2.2.2)
// that never auto-starts under prefers-reduced-motion, and an optional close
// button remembered for the browser session. `marquee` scrolls every
// announcement across the bar instead, with the same pause control; under
// prefers-reduced-motion it falls back to the static one-at-a-time bar.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';

export interface Announcement {
  id: string;
  text: string;
  href: string | null;
}

const DISMISS_KEY = 'jump.announcement.dismissed.';

export default function AnnouncementRotator({
  barId,
  announcements,
  intervalMs,
  marquee = false,
  dismissible,
  labels,
}: {
  barId: string;
  announcements: Announcement[];
  intervalMs: number;
  marquee?: boolean;
  dismissible: boolean;
  labels: { pause: string; close: string };
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const many = announcements.length > 1;
  const rotating = many && intervalMs > 0 && !paused;

  useEffect(() => {
    try {
      if (dismissible && window.sessionStorage.getItem(DISMISS_KEY + barId)) setDismissed(true);
    } catch {
      /* storage blocked: show it */
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setPaused(true);
      setReducedMotion(true);
    }
  }, [barId, dismissible]);

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % announcements.length), intervalMs);
    return () => window.clearInterval(timer);
  }, [rotating, intervalMs, announcements.length]);

  if (dismissed) return null;
  const current = announcements[index % announcements.length];
  const button =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-current';
  const text = (a: Announcement, focusable = true) =>
    a.href ? (
      <Link href={a.href} tabIndex={focusable ? undefined : -1} className="underline-offset-4 hover:underline">
        {a.text}
      </Link>
    ) : (
      a.text
    );
  const closeButton = dismissible && (
    <button
      type="button"
      className={button}
      aria-label={labels.close}
      onClick={() => {
        setDismissed(true);
        try {
          window.sessionStorage.setItem(DISMISS_KEY + barId, '1');
        } catch {
          /* not remembered: fine */
        }
      }}
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  );

  if (marquee && !reducedMotion) {
    // Two copies of the run: the second is presentational, so the -50% loop is seamless.
    const run = (copy: number) => (
      <ul className="flex shrink-0 items-center" aria-hidden={copy > 0 || undefined}>
        {announcements.map((a) => (
          <li key={a.id} className="whitespace-nowrap px-8 font-medium">
            {text(a, copy === 0)}
          </li>
        ))}
      </ul>
    );
    return (
      <div role="region" aria-label="Announcements" className="bg-brand text-brand-fg" data-testid="announcement-bar">
        <div className="flex items-center gap-2 px-4 py-1.5 text-sm sm:px-6 lg:px-8">
          <div className="group min-w-0 flex-1 overflow-hidden">
            <div
              className="flex w-max animate-marquee group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]"
              style={paused ? { animationPlayState: 'paused' } : undefined}
              data-testid="announcement-marquee"
            >
              {run(0)}
              {run(1)}
            </div>
          </div>
          <button type="button" className={button} onClick={() => setPaused((p) => !p)} aria-pressed={paused} aria-label={labels.pause}>
            {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
          </button>
          {closeButton}
        </div>
      </div>
    );
  }

  return (
    <div role="region" aria-label="Announcements" className="bg-brand text-brand-fg" data-testid="announcement-bar">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5 text-sm sm:px-6 lg:px-8">
        {many && (
          <button type="button" className={button} onClick={() => setIndex((i) => (i - 1 + announcements.length) % announcements.length)} aria-label="Previous announcement">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        <p className="min-w-0 flex-1 text-center font-medium" aria-live={rotating ? 'off' : 'polite'}>
          {text(current)}
        </p>
        {many && (
          <button type="button" className={button} onClick={() => setIndex((i) => (i + 1) % announcements.length)} aria-label="Next announcement">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        )}
        {many && intervalMs > 0 && (
          <button type="button" className={button} onClick={() => setPaused((p) => !p)} aria-pressed={paused} aria-label={labels.pause}>
            {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
          </button>
        )}
        {closeButton}
      </div>
    </div>
  );
}
