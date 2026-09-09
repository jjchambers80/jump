'use client';

import { resolveAssetUrl, API_URL } from '@/lib/assets';

interface JumpImageProps {
  imageId?: string | null;
  hash?: string | null;
  variant?: 'original' | 'thumb' | 'card' | 'hero';
  focalX?: number;
  focalY?: number;
  fallbackUrl?: string | null;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Unified image component with focal-point positioning.
 * Uses content-addressed image system when imageId/hash available,
 * falls back to resolveAssetUrl(fallbackUrl) for legacy logos.
 */
export default function JumpImage({
  imageId,
  hash,
  variant = 'card',
  focalX = 0.5,
  focalY = 0.5,
  fallbackUrl,
  alt,
  className = '',
  style,
}: JumpImageProps) {
  let src: string | null = null;

  if (imageId && hash) {
    src = `${API_URL}/images/${imageId}/${hash}/${variant}`;
  } else if (fallbackUrl) {
    src = resolveAssetUrl(fallbackUrl);
  }

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500 ${className}`}
        style={style}
      >
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={{
        objectFit: 'cover',
        objectPosition: `${focalX * 100}% ${focalY * 100}%`,
        ...style,
      }}
    />
  );
}
