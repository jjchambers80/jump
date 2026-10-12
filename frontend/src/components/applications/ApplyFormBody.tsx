'use client';

// The application form's body (spec 011, apply-then-choose since spec 037
// phase 5): numbered steps on the left, a sticky summary on the right (below
// the steps on phones) that explains what happens next and holds the submit
// button. The public apply page and the setup wizard's live preview (spec
// 051, `preview`: submit off) both render it.

import type { FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { PublicForm } from '@/lib/applications';
import { ApplySteps, type ApplyFormState } from './ApplySteps';

export default function ApplyFormBody({
  form,
  apply,
  onSubmit,
  preview = false,
}: {
  form: PublicForm;
  apply: ApplyFormState;
  onSubmit: (e: FormEvent) => void;
  preview?: boolean;
}) {
  const { submitting, error } = apply;
  const submitLabel = submitting ? 'Submitting…' : 'Submit application';
  return (
    <form onSubmit={onSubmit} noValidate data-testid="apply-form" className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-10">
      <ApplySteps form={form} apply={apply} />

      {/* Summary: what happens next and the submit button; sticks beside the steps from lg up */}
      <aside id="apply-summary" className="mt-6 lg:sticky lg:top-6 lg:mt-0" aria-label="Application summary">
        <div className="tier-stub-shadow">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="px-5 pb-4 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-slate-400">Your application</p>
              <p className="mt-1 font-semibold leading-snug text-gray-900 dark:text-slate-100">{form.name}</p>
            </div>

            <div className="border-t-2 border-dashed border-gray-200 px-5 py-4 dark:border-slate-700">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-gray-600 dark:text-slate-400">Cost to apply</span>
                <span className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-slate-50">Free</span>
              </div>
              {form.kind === 'PAID' && (
                <ol className="mt-4 space-y-2.5 text-sm text-gray-700 dark:text-slate-300" data-testid="apply-next-steps" aria-label="What happens next">
                  {[
                    ['Apply', 'No payment and no card today.'],
                    ['Get approved', 'The organizer reviews your application and picks your category.'],
                    ['Choose your space and pay', 'From the list, or on the floor map when there is one. Your space is held while you pay.'],
                  ].map(([title, detail], i) => (
                    <li key={title} className="flex gap-3">
                      <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 text-[11px] font-bold tabular-nums text-gray-600 dark:border-slate-600 dark:text-slate-300">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-gray-900 dark:text-slate-100">{title}</span>
                        <span className="block text-xs leading-relaxed text-gray-500 dark:text-slate-400">{detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="space-y-3 border-t border-gray-200 bg-gray-50/60 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/30">
              {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting || preview}
                className="w-full rounded-xl bg-brand py-3 font-semibold text-brand-fg transition-[background-color,transform] hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 active:scale-[0.99] disabled:opacity-60 dark:focus-visible:ring-offset-slate-800"
              >
                {submitLabel}
              </button>
              <p className="flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                Reviewed by the organizer
              </p>
              {preview && <p className="text-center text-xs text-gray-500 dark:text-slate-400">Submitting is off in preview</p>}
            </div>
          </div>
        </div>
      </aside>
    </form>
  );
}
