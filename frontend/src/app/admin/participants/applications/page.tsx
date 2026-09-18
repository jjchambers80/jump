// Admin › Participants › Applications (spec 019 phase 2 lands forms across
// events and templates here). Phase 1 keeps the tab so the header's
// navigation is complete and points at the per-event form editors.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDate, STATUS_LABEL, type OrgForm } from '@/lib/applications';
import { describeError } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import ParticipantsHeader from '../ParticipantsHeader';
import { useParticipantsApi } from '../useParticipantsApi';

const FORM_STATUS_STYLE: Record<OrgForm['status'], string> = {
  DRAFT: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200',
  OPEN: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  CLOSED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

export default function ParticipantsApplicationsPage() {
  const api = useParticipantsApi();
  const [forms, setForms] = useState<OrgForm[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .forms()
      .then((r) => setForms(r.data))
      .catch((err) => setError(describeError(err, 'Could not load application forms')));
  }, [api]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ParticipantsHeader />
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700" data-testid="participants-forms-table">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-slate-900/40 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Form</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Submissions</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {forms?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-600 dark:text-slate-400">
                  No application forms yet. Open an event under{' '}
                  <Link href="/admin/events" className="text-indigo-600 hover:underline dark:text-indigo-300">
                    Events
                  </Link>{' '}
                  to create one.
                </td>
              </tr>
            )}
            {forms?.map((f) => (
              <tr key={f.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40" data-testid={`participants-form-${f.id}`}>
                <td className="px-3 py-2 text-gray-800 dark:text-slate-200">
                  {f.event.name}
                  <div className="text-xs text-gray-600 dark:text-slate-400">{formatDate(f.event.date)}</div>
                  {f.organization && <div className="text-xs text-gray-500 dark:text-slate-500">{f.organization.name}</div>}
                </td>
                <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{f.name}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{f.kind === 'PAID' ? 'Paid' : 'Free'}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${FORM_STATUS_STYLE[f.status]}`}>{f.status === 'OPEN' ? 'Open' : f.status === 'CLOSED' ? 'Closed' : 'Draft'}</span>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/admin/participants?event=${f.eventId}&form=${f.id}`} className="text-indigo-600 hover:underline dark:text-indigo-300">
                    {f.applicationCount} {f.applicationCount === 1 ? 'submission' : 'submissions'}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/admin/events/${f.eventId}/applications/forms/${f.id}`} className="text-indigo-600 hover:underline dark:text-indigo-300">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
