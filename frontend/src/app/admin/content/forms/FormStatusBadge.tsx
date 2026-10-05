// Status of a standing form (spec 044): a dot plus the word, so it never relies on colour alone.
import type { FormStatus } from '@/lib/applications';

export const FORM_STATUS_LABEL: Record<FormStatus, string> = { OPEN: 'Open', DRAFT: 'Draft', CLOSED: 'Closed' };

const STYLE: Record<FormStatus, string> = {
  OPEN: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-900/30 dark:text-emerald-300',
  DRAFT: 'bg-gray-50 text-gray-700 ring-gray-500/20 dark:bg-slate-700/50 dark:text-slate-300',
  CLOSED: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-900/30 dark:text-amber-300',
};
const DOT: Record<FormStatus, string> = { OPEN: 'bg-emerald-500', DRAFT: 'bg-gray-400', CLOSED: 'bg-amber-500' };

export function FormStatusBadge({ status }: { status: FormStatus }) {
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLE[status]}`} data-testid="form-status">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
      {FORM_STATUS_LABEL[status]}
    </span>
  );
}
