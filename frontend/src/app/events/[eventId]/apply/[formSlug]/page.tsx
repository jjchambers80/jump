// Public application form (spec 011): contact, business profile with photos,
// the organizer's questions, submit. Submits as multipart straight to the
// backend (public route, IP rate-limited there). On success the applicant
// lands on their status page (token in the URL).
//
// Spec 037 phase 5 (apply-then-choose): nobody picks a category, a space,
// add-ons or pays here, and there is no Stripe step. Every form submits
// straight away; on a PAID form the organizer assigns the category when
// approving and the vendor then chooses their space and pays from the status
// page.
//
// Layout: numbered steps on the left, a sticky summary on the right (below
// the steps on phones) that explains what happens next and holds the submit
// button.
'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import api from '@/services/api';
import { acceptanceLine, type PublicForm } from '@/lib/applications';
import ApplyShell from '../ApplyShell';
import { ApplySteps, useApplyForm } from '@/components/applications/ApplySteps';

export default function ApplyFormPage({ params }: { params: { eventId: string; formSlug: string } }) {
  const router = useRouter();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useApplyForm(form, { submitUrl: `/events/${params.eventId}/applications` });
  const { submitting, error } = apply;

  useEffect(() => {
    api
      .get<PublicForm>(`/events/${params.eventId}/applications/forms/${params.formSlug}`)
      .then(setForm)
      .catch((err) => setLoadError(err?.message || 'This form is not available'));
  }, [params.eventId, params.formSlug]);

  const closedLine = form ? acceptanceLine(form.acceptance) : null;

  const handleSubmit = async (e: FormEvent) => {
    const result = await apply.submit(e);
    if (result) router.push(new URL(result.statusUrl).pathname + new URL(result.statusUrl).search);
  };

  const submitLabel = submitting ? 'Submitting…' : 'Submit application';

  return (
    <ApplyShell eventId={params.eventId} title={form?.name} kicker="Application" width={form && !closedLine && !loadError ? 'wide' : 'narrow'}>
      {() => {
        if (loadError) return <p role="alert" className="text-red-700 dark:text-red-300">{loadError}</p>;
        if (!form) return <p className="text-gray-600 dark:text-slate-400">Loading…</p>;
        if (closedLine) {
          return (
            <div className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800" data-testid="apply-closed">
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                <Lock className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-gray-900 dark:text-slate-100">
                  {form.acceptance.reason === 'sales_closed' ? 'Applications are closed.' : `This form is ${closedLine.toLowerCase()}.`}
                </p>
                <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                  {form.acceptance.reason === 'sales_closed'
                    ? 'The organizer has closed sales for this event.'
                    : 'Check back later, or head back to the event page for tickets.'}
                </p>
              </div>
            </div>
          );
        }
        return (
          <form onSubmit={handleSubmit} noValidate data-testid="apply-form" className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-10">
            <ApplySteps form={form} apply={apply} />

            {/* Summary: what happens next and the submit button; sticks beside the steps from lg up */}
            <aside className="mt-6 lg:sticky lg:top-6 lg:mt-0" aria-label="Application summary">
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
                      disabled={submitting}
                      className="w-full rounded-xl bg-brand py-3 font-semibold text-brand-fg transition-[background-color,transform] hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 active:scale-[0.99] disabled:opacity-60 dark:focus-visible:ring-offset-slate-800"
                    >
                      {submitLabel}
                    </button>
                    <p className="flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      Reviewed by the organizer
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </form>
        );
      }}
    </ApplyShell>
  );
}
