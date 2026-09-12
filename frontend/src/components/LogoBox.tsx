'use client';

import { useEffect, useRef, useState } from 'react';

interface LogoBoxProps {
  src: string;
  alt: string;
  /** Extra classes for the outer square (size, rounding, margins). */
  className?: string;
}

// Logos within this ratio of 1:1 are treated as square — no backdrop needed.
const SQUARE_TOLERANCE = 0.02;

/**
 * Square container that fits a logo of any aspect ratio.
 *
 * - Square logo: fills the box 100%.
 * - Landscape logo: spans full width, letterboxed top/bottom.
 * - Portrait logo: spans full height, pillarboxed left/right.
 *
 * For non-square logos the same image is painted behind, scaled to cover
 * and blurred, so the empty bands are filled with the logo's own colours
 * instead of a flat background.
 */
export default function LogoBox({ src, alt, className = '' }: LogoBoxProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [isSquare, setIsSquare] = useState<boolean | null>(null);

  const measure = (img: HTMLImageElement) => {
    const { naturalWidth, naturalHeight } = img;
    if (!naturalWidth || !naturalHeight) return;
    setIsSquare(Math.abs(naturalWidth / naturalHeight - 1) <= SQUARE_TOLERANCE);
  };

  // A cached image can finish loading before hydration, so onLoad never fires.
  useEffect(() => {
    setIsSquare(null);
    const img = imgRef.current;
    if (img?.complete) measure(img);
  }, [src]);

  return (
    <div
      data-testid="logo-box"
      data-logo-fit={isSquare === null ? 'pending' : isSquare ? 'square' : 'backdrop'}
      className={`relative aspect-square overflow-hidden bg-gray-100 dark:bg-slate-800 ${className}`}
    >
      {isSquare === false && (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          data-testid="logo-box-backdrop"
          className="absolute inset-0 h-full w-full scale-125 object-cover blur-xl opacity-80"
        />
      )}
      <img
        src={src}
        alt={alt}
        ref={imgRef}
        onLoad={(event) => measure(event.currentTarget)}
        className="relative h-full w-full object-contain"
      />
    </div>
  );
}
