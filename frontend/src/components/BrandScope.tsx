import type { CSSProperties, ReactNode } from 'react';
import { brandCssVars } from '@/lib/color';

interface BrandScopeProps {
  /** Organization brand color (#rrggbb). Null/undefined keeps platform defaults. */
  color: string | null | undefined;
  className?: string;
  children: ReactNode;
}

/**
 * Applies an organization's brand color to everything inside via CSS custom properties.
 * Children use the `brand` Tailwind tokens (bg-brand, hover:bg-brand-hover, text-brand-fg,
 * text-brand-link); with no color the tokens resolve to the platform blue from globals.css.
 */
export default function BrandScope({ color, className, children }: BrandScopeProps) {
  const vars = brandCssVars(color);
  return (
    <div
      className={className ? `brand-scope ${className}` : 'brand-scope'}
      style={vars as CSSProperties | undefined}
      data-brand-color={vars ? vars['--brand'] : undefined}
    >
      {children}
    </div>
  );
}
