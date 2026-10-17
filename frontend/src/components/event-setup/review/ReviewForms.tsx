'use client';

// Review's forms list (spec 050 §3 planner decisions): each DRAFT form gets
// "Open applications when I publish", feeding `openFormIds`. A form readiness
// says cannot open (a PAID form while APPLICATIONS_PAYMENTS_ENABLED is off,
// gotcha 15) is disabled with that reason as its description.

import type { OverviewForm } from '@/lib/eventOverview';
import type { ReadinessItem } from '@/lib/eventReadiness';

const STATUS: Record<OverviewForm['status'], string> = { DRAFT: 'Draft', OPEN: 'Open', CLOSED: 'Closed' };

/** Why a draft form can't open on publish, from the readiness warnings; null when it can. */
export function formLockReason(form: OverviewForm, warnings: ReadinessItem[]): string | null {
  return warnings.find((w) => (w.code === 'PAID_FORMS_DISABLED' || w.code === 'PAID_FORM_NO_OPTIONS') && w.formId === form.id)?.message ?? null;
}

interface Props {
  forms: OverviewForm[];
  warnings: ReadinessItem[];
  selected: Set<string>;
  onToggle: (formId: string, open: boolean) => void;
  /** Live events: forms open from their own step, not from here. */
  published: boolean;
  /** Spec 057: a registration event's one form reads "Registration form". */
  title?: string;
}

export default function ReviewForms({ forms, warnings, selected, onToggle, published, title = 'Applications' }: Props) {
  return (
    <section aria-labelledby="review-forms" className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:p-6">
      <h2 id="review-forms" className="text-base font-semibold text-gray-900 dark:text-white">
        {title}
      </h2>
      {forms.length === 0 ? (
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          No application forms on this event.{' '}
          After setup, add vendor, special guest and volunteer applications from the event page.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-200 dark:divide-slate-700">
          {forms.map((form) => {
            const id = `review-open-${form.id}`;
            const reason = form.status === 'DRAFT' ? formLockReason(form, warnings) : null;
            const canChoose = form.status === 'DRAFT' && !published;
            return (
              <li key={form.id} className="py-3 text-sm">
                <p className="font-medium text-gray-900 dark:text-white">
                  {form.name} <span className="font-normal text-gray-600 dark:text-slate-400">· {form.kind === 'PAID' ? 'Paid' : 'Free'} · {STATUS[form.status]}</span>
                </p>
                {canChoose && (
                  <>
                    <label htmlFor={id} className={`flex min-h-11 items-center gap-3 ${reason ? 'cursor-not-allowed text-gray-500 dark:text-slate-400' : 'cursor-pointer text-gray-800 dark:text-slate-200'}`}>
                      <input
                        id={id}
                        type="checkbox"
                        checked={!reason && selected.has(form.id)}
                        disabled={!!reason}
                        onChange={(e) => onToggle(form.id, e.target.checked)}
                        aria-describedby={reason ? `${id}-reason` : undefined}
                        // The visible label first (label in name), then which form: several boxes share the label.
                        aria-label={`Open applications when I publish: ${form.name}`}
                        className="h-5 w-5 shrink-0 rounded border-gray-400 accent-accent-600 disabled:cursor-not-allowed"
                      />
                      Open applications when I publish
                    </label>
                    {reason && (
                      <p id={`${id}-reason`} className="pl-8 text-gray-700 dark:text-slate-300">
                        Not available: {reason}
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
