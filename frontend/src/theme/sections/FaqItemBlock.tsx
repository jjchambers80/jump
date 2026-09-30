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
  ctx: SectionContext;
}

export default function FaqItemBlock({ question = 'Question', answer = '' }: FaqItemProps) {
  if (!question) return null;
  return (
    <details className="group py-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 text-left text-lg font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-slate-100 [&::-webkit-details-marker]:hidden">
        <span>{question}</span>
        <ChevronDown aria-hidden className="h-5 w-5 shrink-0 text-gray-500 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none dark:text-slate-400" />
      </summary>
      {answer && <ContentHtml html={answer} className="pb-5 pr-9" />}
    </details>
  );
}
