'use client';

// Live thumbnail of the storefront home page: the real page in a scaled-down,
// inert iframe, so the card always shows what shoppers see. Decorative:
// hidden from assistive tech and unreachable by keyboard.

import { useEffect, useRef, useState } from 'react';

const VIEWPORT = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };

export default function ThemeScreenshot({ src, variant }: { src: string; variant: 'desktop' | 'mobile' }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const { width, height } = VIEWPORT[variant];

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div ref={box} aria-hidden className="relative w-full overflow-hidden bg-white" style={{ aspectRatio: `${width} / ${height}` }}>
      {scale > 0 && (
        <iframe
          src={src}
          title=""
          tabIndex={-1}
          loading="lazy"
          scrolling="no"
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          style={{ width, height, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
}
