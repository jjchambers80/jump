// Shared dashboard building blocks: the panel shell, its "view all" link,
// a loading block and the money / relative-time formatters.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function Panel({
  id,
  title,
  icon,
  action,
  children,
  className = '',
}: {
  id: string;
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800 ${className}`}
    >
      <div className="flex min-h-[3.25rem] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-gray-200 px-4 py-2 dark:border-slate-700 sm:px-5">
        <h2 id={id} className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "View all" link in a panel header. `label` names the destination for screen readers. */
export function PanelLink({ href, label, children = 'View all' }: { href: string; label: string; children?: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex min-h-[2.75rem] items-center gap-1 whitespace-nowrap rounded-md px-2 text-sm font-medium text-accent-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-accent-400"
    >
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-gray-200 motion-reduce:animate-none dark:bg-slate-700 ${className}`} />;
}

export function formatMoney(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "5 minutes ago", "yesterday", "just now". */
export function timeAgo(value: string | Date, now = Date.now()): string {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}
