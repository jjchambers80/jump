// Public: forms a visitor can apply to for an event (spec 011).
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import api from '@/services/api';
import { acceptanceLine, money, type PublicForm } from '@/lib/applications';
import ApplyShell from './ApplyShell';

function priceRange(form: PublicForm): string | null {
  if (form.kind !== 'PAID' || form.tiers.length === 0) return null;
  const prices = form.tiers.map((t) => t.applicantPays);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? money(min) : `${money(min)} – ${money(max)}`;
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
        <div className="space-y-4" data-testid="apply-forms">
          {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
          {forms && forms.length === 0 && <p className="text-gray-600 dark:text-slate-400">This event is not taking applications right now.</p>}
          {forms?.map((form) => {
            const closed = acceptanceLine(form.acceptance);
            const range = priceRange(form);
            const inner = (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{form.name}</h2>
                  {form.intro && <p className="mt-1 text-sm text-gray-600 dark:text-slate-400 line-clamp-2">{form.intro}</p>}
                  <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">
                    {form.kind === 'PAID' ? `${form.tiers.length} option${form.tiers.length === 1 ? '' : 's'}${range ? ` · ${range}` : ''}` : 'Free to apply'}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${closed ? 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300' : 'bg-brand text-brand-fg'}`}>
                  {closed ?? 'Apply'}
                </span>
              </div>
            );
            return closed ? (
              <div key={form.id} className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-5 opacity-80" data-testid={`apply-form-${form.slug}`}>
                {inner}
              </div>
            ) : (
              <Link key={form.id} href={`/events/${params.eventId}/apply/${form.slug}`} className="block bg-white dark:bg-slate-800 rounded-lg shadow-sm p-5 hover:shadow-md transition-shadow" data-testid={`apply-form-${form.slug}`}>
                {inner}
              </Link>
            );
          })}
        </div>
      )}
    </ApplyShell>
  );
}
