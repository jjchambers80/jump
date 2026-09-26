// Public: forms a visitor can apply to for an event (spec 011).
'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import api from '@/services/api';
import { acceptanceLine, money, type PublicForm } from '@/lib/applications';
import ApplyShell from './ApplyShell';

/** Lowest applicant price, and whether other options cost more ("from $X"). */
function priceFrom(form: PublicForm): { price: string; from: boolean } | null {
  if (form.kind !== 'PAID' || form.tiers.length === 0) return null;
  const prices = form.tiers.map((t) => t.applicantPays);
  const min = Math.min(...prices);
  return { price: money(min), from: Math.max(...prices) !== min };
}

export default function ApplyIndexPage({ params }: { params: { eventId: string } }) {
  const [forms, setForms] = useState<PublicForm[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: PublicForm[] }>(`/events/${params.eventId}/applications/forms`)
      .then((r) => setForms(r.data))
      .catch((err) => setError(err?.message || 'Could not load applications'));
  }, [params.eventId]);

  return (
    <ApplyShell eventId={params.eventId}>
      {() => (
        <div className="space-y-3" data-testid="apply-forms">
          {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
          {forms && forms.length === 0 && <p className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">This event is not taking applications right now.</p>}
          {forms?.map((form, i) => {
            const closed = acceptanceLine(form.acceptance);
            const range = priceFrom(form);
            const inner = (
              <span className="tier-stub relative grid grid-cols-1 overflow-hidden rounded-2xl border border-gray-200 bg-white transition-colors duration-200 group-hover:border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:group-hover:border-slate-600 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <span className={`min-w-0 py-4 pl-5 pr-4 sm:py-5 sm:pl-6 ${closed ? 'opacity-70' : ''}`}>
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-slate-400">
                    {form.kind === 'PAID' ? `${form.tiers.length} option${form.tiers.length === 1 ? '' : 's'}` : 'Free to apply'}
                  </span>
                  <h2 className="mt-1 text-[17px] font-semibold leading-snug tracking-tight text-gray-900 dark:text-slate-100">{form.name}</h2>
                  {form.intro && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-gray-600 dark:text-slate-400">{form.intro}</p>}
                </span>
                <span className="relative flex h-16 items-center justify-between gap-3 border-t-2 border-dashed border-gray-200 pl-5 pr-4 dark:border-slate-700 sm:h-auto sm:flex-col sm:justify-center sm:gap-2 sm:border-l-2 sm:border-t-0 sm:px-3 sm:py-4 sm:text-center">
                  <span className="whitespace-nowrap text-lg font-extrabold tabular-nums tracking-tight text-gray-900 dark:text-slate-50">
                    {range?.from && <span className="mr-1 text-xs font-medium text-gray-500 dark:text-slate-400">from</span>}
                    {range ? range.price : 'Free'}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                      closed ? 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300' : 'bg-brand text-brand-fg'
                    }`}
                  >
                    {closed ?? (
                      <>
                        Apply <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                      </>
                    )}
                  </span>
                </span>
              </span>
            );
            const style = { animationDelay: `${Math.min(i, 5) * 50}ms` };
            return closed ? (
              <div key={form.id} className="tier-stub-shadow block motion-safe:animate-card-in" style={style} data-testid={`apply-form-${form.slug}`}>
                {inner}
              </div>
            ) : (
              <Link
                key={form.id}
                href={`/events/${params.eventId}/apply/${form.slug}`}
                className="tier-stub-shadow group block rounded-2xl motion-safe:animate-card-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link"
                style={style}
                data-testid={`apply-form-${form.slug}`}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      )}
    </ApplyShell>
  );
}
