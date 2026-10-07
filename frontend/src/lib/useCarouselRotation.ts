'use client';

// Rotation state shared by the Hero carousel and the gallery carousel (WCAG
// 2.2.2): `paused` is the visitor's choice (and true under reduced motion,
// so nothing ever starts on its own there); `holding` is a hover or focus
// that holds the rotation without stopping it.

import { useEffect, useState } from 'react';

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function useCarouselRotation(timed: boolean) {
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion()) setPaused(true);
  }, []);
  return { paused, setPaused, holding, setHolding, rotating: timed && !paused };
}
