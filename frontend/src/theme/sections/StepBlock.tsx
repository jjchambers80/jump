// Theme Step block: one item of a Steps list. Its number is the list's CSS
// counter (decorative; the <ol> already numbers it for screen readers). The
// text is organizer HTML sanitised on write, rendered only through ContentHtml.

import ContentHtml from '@/components/storefront/ContentHtml';
import type { SectionContext } from './context';

export interface StepProps {
  id: string;
  title?: string;
  text?: string;
  ctx: SectionContext;
}

export default function StepBlock({ title = 'Step', text = '' }: StepProps) {
  if (!title && !text) return null;
  return (
    <li className="relative flex flex-col rounded-[var(--theme-container-radius,1.5rem)] bg-white p-6 ring-1 ring-inset ring-gray-200 [counter-increment:step] before:mb-4 before:block before:text-5xl before:font-extrabold before:leading-none before:tracking-tight before:text-brand-link before:tabular-nums before:[content:counter(step,decimal-leading-zero)] dark:bg-slate-800 dark:ring-slate-700 sm:p-8">
      {title && <h3 className="text-xl font-semibold text-gray-900 dark:text-slate-100">{title}</h3>}
      {text && <ContentHtml html={text} className={title ? 'mt-3' : ''} />}
    </li>
  );
}
