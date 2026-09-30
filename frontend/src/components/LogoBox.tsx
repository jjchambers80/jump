interface LogoBoxProps {
  src: string;
  alt: string;
  /** Extra classes for the outer box (size, rounding, margins). */
  className?: string;
  /** Force a square box (default). `false` lets the box take the logo's own aspect ratio. */
  square?: boolean;
  /** Drop the flat background so the logo sits directly on the surface behind it. */
  bare?: boolean;
  /**
   * `height`: the box is as tall as `className` says and as wide as the logo
   * at that height (capped by a max-width class), aligned left. For wordmarks
   * in slim bars, where a square box would shrink them to a smudge.
   */
  fit?: 'box' | 'height';
}

/**
 * Square container that fits a logo of any aspect ratio.
 *
 * - Square logo: fills the box 100%.
 * - Landscape logo: spans full width, letterboxed top/bottom.
 * - Portrait logo: spans full height, pillarboxed left/right.
 *
 * Empty bands show the flat container background (none when `bare`); no image is painted behind.
 */
export default function LogoBox({ src, alt, className = '', square = true, bare = false, fit = 'box' }: LogoBoxProps) {
  return (
    <div
      data-testid="logo-box"
      className={`relative ${fit === 'height' ? 'flex ' : square ? 'aspect-square ' : ''}overflow-hidden ${bare ? '' : 'bg-gray-100 dark:bg-slate-800 '}${className}`}
    >
      <img
        src={src}
        alt={alt}
        className={fit === 'height' ? 'h-full w-auto max-w-full object-contain object-left' : 'h-full w-full object-contain'}
      />
    </div>
  );
}
