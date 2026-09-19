interface LogoBoxProps {
  src: string;
  alt: string;
  /** Extra classes for the outer square (size, rounding, margins). */
  className?: string;
}

/**
 * Square container that fits a logo of any aspect ratio.
 *
 * - Square logo: fills the box 100%.
 * - Landscape logo: spans full width, letterboxed top/bottom.
 * - Portrait logo: spans full height, pillarboxed left/right.
 *
 * Empty bands show the flat container background; no image is painted behind.
 */
export default function LogoBox({ src, alt, className = '' }: LogoBoxProps) {
  return (
    <div
      data-testid="logo-box"
      className={`relative aspect-square overflow-hidden bg-gray-100 dark:bg-slate-800 ${className}`}
    >
      <img src={src} alt={alt} className="h-full w-full object-contain" />
    </div>
  );
}
