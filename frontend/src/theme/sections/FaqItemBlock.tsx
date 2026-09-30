// Theme FaqItem block (spec 041): one question as a native disclosure. The
// answer is organizer HTML sanitised on write and rendered only through
// ContentHtml (gotcha 20).

import { ChevronDown } from 'lucide-react';
import ContentHtml from '@/components/storefront/ContentHtml';
import type { SectionContext } from './context';

export interface FaqItemProps {
  id: string;
  question?: string;
  answer?: string;
  /** Theme editor: this question is selected, so it shows its answer. */
  editorSelected?: boolean;
  ctx: SectionContext;
}

export default function FaqItemBlock({ question = 'Question', answer = '', editorSelected }: FaqItemProps) {
  if (!question) return null;
  return (
    <details className="group" open={editorSelected || undefined}>
      <summary className="-mx-3 flex cursor-pointer list-none items-center justify-between gap-6 rounded-lg px-3 py-5 text-left text-lg font-semibold text-gray-900 transition-colors hover:text-brand-link focus:outline-none focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none dark:text-slate-100 [&::-webkit-details-marker]:hidden">
        <span className="text-pretty">{question}</span>
        <span
          aria-hidden
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-[transform,background-color,color] duration-200 group-open:rotate-180 group-open:bg-brand group-open:text-brand-fg group-hover:bg-gray-200 group-open:group-hover:bg-brand-hover motion-reduce:transition-none dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-slate-700"
        >
          <ChevronDown className="h-4 w-4" />
        </span>
      </summary>
      {answer && (
        <div data-faq-answer className="pb-6 pr-12">
          <ContentHtml html={answer} className="text-base leading-relaxed" />
        </div>
      )}
    </details>
  );
}
