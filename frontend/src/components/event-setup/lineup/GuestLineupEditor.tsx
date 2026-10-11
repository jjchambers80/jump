'use client';

// Special guest lineup editor (spec 050 §7.6, card 050-Q) for the wizard's
// Special guests step: add guests by hand (no form needed, §14 #2), edit,
// reorder with buttons, hide, remove. Each save refreshes the preview.
// Reorders and toggles are announced in a polite role="status" region.

import { useEffect, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { describeError } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import type { AdminEventGuest } from '@/lib/eventGuests';
import { secondaryButton } from '../ui';
import GuestDialog from './GuestDialog';
import GuestRow from './GuestRow';
import { useGuestLineup, type GuestInput } from './useGuestLineup';

export default function GuestLineupEditor({ orgId, eventId, refreshPreview }: { orgId: string; eventId: string; refreshPreview: () => void }) {
  const lineup = useGuestLineup(orgId, eventId, refreshPreview);
  const [editing, setEditing] = useState<AdminEventGuest | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Where focus goes after the list re-renders (§11.4: never lost to <body>).
  const [focusTo, setFocusTo] = useState<{ id?: string; action: 'up' | 'down' | 'edit' } | 'add' | null>(null);
  const guests = lineup.guests;

  useEffect(() => {
    if (!focusTo) return;
    if (focusTo === 'add') {
      document.getElementById('lineup-add')?.focus();
    } else {
      const row = document.querySelector(`[data-guest-id="${focusTo.id}"]`);
      const other = focusTo.action === 'up' ? 'down' : focusTo.action === 'down' ? 'up' : 'edit';
      const button =
        row?.querySelector<HTMLButtonElement>(`button[data-action="${focusTo.action}"]:not([disabled])`) ??
        row?.querySelector<HTMLButtonElement>(`button[data-action="${other}"]:not([disabled])`);
      button?.focus();
    }
    setFocusTo(null);
  }, [focusTo, guests]);

  const run = async (fn: () => Promise<unknown>, message: string, fallback: string) => {
    setError(null);
    try {
      await fn();
      setStatus(message);
    } catch (err) {
      setError(describeError(err, fallback));
    }
  };

  const save = async (input: GuestInput, image: { file?: File | null; remove?: boolean }) => {
    setBusy(true);
    setDialogError(null);
    try {
      const isNew = editing === 'new';
      const row = await lineup.save(isNew || !editing ? null : editing.id, input, image, (created) => setEditing(created));
      setStatus(`${row.name} saved`);
      setEditing(null);
      // A new guest's opener (the empty state's Add button) may be gone: land on the new row.
      if (isNew) setFocusTo({ id: row.id, action: 'edit' });
    } catch (err) {
      setDialogError(describeError(err, 'Could not save this guest'));
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const guest = guests![index];
    const to = index + delta;
    run(() => lineup.move(index, delta), `${guest.name} moved to position ${to + 1} of ${guests!.length}`, 'Could not reorder the lineup');
    // Same button in the row's new place; the other one when it hit the top or bottom.
    setFocusTo({ id: guest.id, action: delta < 0 ? 'up' : 'down' });
  };

  const remove = (guest: AdminEventGuest) => {
    if (!window.confirm(`Remove ${guest.name} from the lineup?`)) return;
    const index = guests!.indexOf(guest);
    const next = guests![index + 1] ?? guests![index - 1];
    run(async () => {
      await lineup.remove(guest);
      setFocusTo(next ? { id: next.id, action: 'edit' } : 'add');
    }, `${guest.name} removed`, 'Could not remove this guest');
  };

  return (
    <section aria-labelledby="lineup-heading" className="mt-8" data-testid="lineup-editor">
      <h2 id="lineup-heading" className="text-lg font-semibold text-gray-900 dark:text-white">Guest lineup</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Guests shown on the event page, in this order. Add anyone by hand, or add an approved applicant from their application.</p>

      <p role="status" aria-live="polite" className="sr-only">{status}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}

      {lineup.loadError ? (
        <div role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          Couldn&apos;t load the lineup.{' '}
          <button type="button" className="font-medium underline" onClick={lineup.reload}>Try again</button>
        </div>
      ) : guests === null ? (
        <div className="mt-4 space-y-2" aria-busy="true" aria-label="Loading the lineup">
          {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none dark:bg-slate-800" />)}
        </div>
      ) : guests.length === 0 ? (
        <div className="mt-4 flex flex-col items-start gap-3 rounded-lg border border-dashed border-gray-300 p-4 dark:border-slate-600">
          <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300"><Users className="h-4 w-4" aria-hidden /> No guests in the lineup yet.</p>
          <button id="lineup-add" type="button" className={secondaryButton} onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden /> Add a guest</button>
        </div>
      ) : (
        <>
          <ul className="mt-4 space-y-2" aria-label="Guest lineup">
            {guests.map((g, i) => (
              <GuestRow
                key={g.id}
                guest={g}
                index={i}
                count={guests.length}
                onMove={(d) => move(i, d)}
                onToggle={(v) => run(() => lineup.setVisible(g, v), `${g.name} ${v ? 'shown on' : 'hidden from'} the event page`, 'Could not change visibility')}
                onEdit={() => { setDialogError(null); setEditing(g); }}
                onRemove={() => remove(g)}
              />
            ))}
          </ul>
          <button id="lineup-add" type="button" className={`${secondaryButton} mt-3`} onClick={() => { setDialogError(null); setEditing('new'); }}><Plus className="h-4 w-4" aria-hidden /> Add a guest</button>
        </>
      )}

      {editing && <GuestDialog guest={editing === 'new' ? null : editing} busy={busy} error={dialogError} onSave={save} onCancel={() => setEditing(null)} />}
    </section>
  );
}
