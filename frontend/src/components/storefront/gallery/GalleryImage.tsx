'use client';

// A gallery photo that keeps its reserved box if it fails to load and shows
// its alt text there in muted type, instead of a broken-image icon.

import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

interface GalleryImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  /** Shown when the image fails; the img's own alt may be '' because its button carries the name. */
  fallbackText: string;
}

export default function GalleryImage({ fallbackText, className = '', width, height, ...img }: GalleryImageProps) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // A server-rendered image can fail before hydration attaches onError.
  useEffect(() => {
    const el = ref.current;
    if (el?.complete && el.naturalWidth === 0 && el.currentSrc) setFailed(true);
  }, []);
  if (failed) {
    return (
      <span
        className={`flex items-center justify-center bg-gray-100 p-3 text-center text-sm text-gray-600 dark:bg-slate-800 dark:text-slate-400 ${className}`}
        style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}
      >
        {fallbackText}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img ref={ref} {...img} width={width} height={height} className={className} onError={() => setFailed(true)} />;
}
