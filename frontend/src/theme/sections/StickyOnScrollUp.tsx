'use client';

// "Sticky on scroll up": the header slides away while scrolling down and
// returns when scrolling up. No motion under prefers-reduced-motion.

import { useEffect, useRef, useState, type ReactNode } from 'react';

export default function StickyOnScrollUp({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > last.current && y > 120);
      last.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div
      className={`sticky top-0 z-40 bg-gray-50/95 backdrop-blur transition-transform duration-200 motion-reduce:transition-none dark:bg-slate-900/95 ${
        hidden ? '-translate-y-full' : 'translate-y-0'
      }`}
      // Keyboard users can always reach it: focusing inside brings it back.
      onFocusCapture={() => setHidden(false)}
    >
      {children}
    </div>
  );
}
