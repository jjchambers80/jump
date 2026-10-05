// Theme ChecklistItem block: one line of a Checklist. It carries both marks;
// the section hides the one it does not use. The marks are decorative: the
// section heading says whether the list is "wanted" or "not allowed".

import { Check, X } from 'lucide-react';
import type { SectionContext } from './context';

export interface ChecklistItemProps {
  id: string;
  text?: string;
  ctx: SectionContext;
}

const mark = 'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full';

export default function ChecklistItemBlock({ text = 'List item' }: ChecklistItemProps) {
  if (!text) return null;
  return (
    <li className="flex items-start gap-3 rounded-[var(--theme-card-radius,0.75rem)] bg-white px-4 py-3.5 ring-1 ring-inset ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
      <span aria-hidden data-mark="check" className={`${mark} bg-brand text-brand-fg`}>
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
      <span aria-hidden data-mark="cross" className={`${mark} bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900`}>
        <X className="h-4 w-4" strokeWidth={3} />
      </span>
      <span className="text-pretty leading-relaxed text-gray-800 dark:text-slate-200">{text}</span>
    </li>
  );
}
