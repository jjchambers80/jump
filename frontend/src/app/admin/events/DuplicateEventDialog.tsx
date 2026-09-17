'use client';

// Duplicate an event as a new DRAFT on a new date (spec 011 phase 3). Copies
// price tiers and application forms (tiers + questions); never orders,
// tickets or applications.

import { useState } from 'react';
import api from '@/services/api';

interface Props {
  orgId: string;
  event: { id: string; name: string };
  onClose: () => void;
  onDone: (created: { id: string; name: string; copiedForms: number }) => void;
}

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100';

export default function DuplicateEventDialog({ orgId, event, onClose, onDone }: Props) {
  const [name, setName] = useState(`Copy of ${event.name}`);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) {
      setError('Pick the new event date');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string; name: string; copiedForms: number }>(`/organizations/${orgId}/events/${event.id}/duplicate`, {
        name: name.trim() || undefined,
        date: new Date(date).toISOString(),
      });
      onDone(created);
    } catch (err) {
      setError((err as Error).message || 'Could not duplicate the event');
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="duplicate-event-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-800" data-testid="duplicate-event-dialog">
        <h2 id="duplicate-event-title" className="text-lg font-semibold text-gray-900 dark:text-white">Duplicate event</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          Creates a draft with the same venue, description, price tiers and application forms. Ticket inventory and applications start empty; forms stay in draft until you open them.
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
        )}
        <label htmlFor="duplicate-name" className="mt-4 block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400">Name</label>
        <input id="duplicate-name" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} className={`${field} mt-1`} />
        <label htmlFor="duplicate-date" className="mt-3 block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400">Date and time</label>
        <input id="duplicate-date" type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} className={`${field} mt-1`} />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? 'Duplicating…' : 'Duplicate'}
          </button>
        </div>
      </form>
    </div>
  );
}
