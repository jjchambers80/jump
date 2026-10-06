// Theme Button block (spec 038 §7). A link whose target is gone or hidden
// renders nothing (D8).

import Link from 'next/link';
import { linkHref, type ThemeLink } from '../links';
import type { SectionContext } from './context';

export interface ButtonBlockProps {
  label?: string;
  link?: ThemeLink | null;
  style?: 'primary' | 'secondary';
  size?: 'medium' | 'large';
  ctx: SectionContext;
}

const base =
  'inline-flex min-h-11 items-center justify-center rounded-[var(--theme-button-radius,8px)] font-semibold transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';
const sizes = {
  medium: 'px-5 py-2.5 text-sm',
  large: 'px-7 py-3.5 text-lg',
};
const styles = {
  primary: 'bg-brand text-brand-fg hover:bg-brand-hover',
  secondary: 'bg-transparent text-current ring-1 ring-inset ring-current hover:bg-black/5 dark:hover:bg-white/10',
};

export default function ButtonBlock({ label, link, style = 'primary', size = 'medium', ctx }: ButtonBlockProps) {
  const href = linkHref(link, ctx);
  if (!href || !label) return null;
  const className = `${base} ${sizes[size] ?? sizes.medium} ${styles[style] ?? styles.primary}`;
  return /^https?:\/\//.test(href) ? (
    <a href={href} className={className} rel="noopener">
      {label}
    </a>
  ) : (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}
