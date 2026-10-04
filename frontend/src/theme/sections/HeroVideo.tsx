'use client';

// Hero islands: the background video and the "fill the window" height.
//
// Video (WCAG 2.2.2): muted, looping, decorative. It starts from script, never
// from an autoplay attribute, so it never starts under prefers-reduced-motion
// (the poster stays) or in the editor; a pause / play button is always there.

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export function HeroVideo({
  sources,
  poster,
  pauseLabel,
  autoplay,
  edgeToEdge,
}: {
  sources: { url: string; type?: string }[];
  poster?: string;
  pauseLabel: string;
  autoplay: boolean;
  edgeToEdge: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!autoplay || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ref.current?.play().catch(() => {});
  }, [autoplay]);

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  return (
    <>
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={poster}
        aria-hidden
        tabIndex={-1}
        data-testid="hero-video"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="absolute inset-0 -z-10 h-full w-full object-cover"
      >
        {sources.map((s) => (
          <source key={s.url} src={s.url} type={s.type} />
        ))}
      </video>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={!playing}
        aria-label={pauseLabel}
        className={`absolute bottom-4 right-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 motion-reduce:transition-none ${
          edgeToEdge ? 'sm:bottom-6 sm:right-6' : ''
        }`}
      >
        {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4 translate-x-px" aria-hidden />}
      </button>
    </>
  );
}

/**
 * Sets `--hero-offset` on its parent to the bottom of the storefront header
 * (announcement bar included), so `calc(100svh - var(--hero-offset))` fills
 * the rest of the window. Renders nothing.
 */
export function HeroScreenOffset() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const target = ref.current?.parentElement;
    if (!target) return;
    const measure = () => {
      const header = document.querySelector('[data-section="Header"]');
      const bottom = header ? header.getBoundingClientRect().bottom + window.scrollY : 0;
      target.style.setProperty('--hero-offset', `${Math.max(0, Math.round(bottom))}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return <span ref={ref} hidden />;
}
