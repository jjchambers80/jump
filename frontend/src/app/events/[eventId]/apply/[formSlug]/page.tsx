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
// Layout lives in ApplyFormBody (shared with the setup wizard's preview).
'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import api from '@/services/api';
import { acceptanceLine, type PublicForm } from '@/lib/applications';
import ApplyShell from '../ApplyShell';
import { useApplyForm } from '@/components/applications/ApplySteps';
import ApplyFormBody from '@/components/applications/ApplyFormBody';

export default function ApplyFormPage({ params }: { params: { eventId: string; formSlug: string } }) {
  const router = useRouter();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useApplyForm(form, { submitUrl: `/events/${params.eventId}/applications` });

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
        return <ApplyFormBody form={form} apply={apply} onSubmit={handleSubmit} />;
      }}
    </ApplyShell>
  );
}
