'use client';

// "Add to list" (spec 055-C): put the selected contacts (or every contact the
// filters match) on a manual list, or on a new one made here.

import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import api from '@/services/api';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import type { ContactList } from '@/lib/contactLists';
import type { ContactSelection } from '../ContactsList';

const NEW = '__new';
const control =
  'h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 aria-[invalid=true]:border-red-600 dark:border-slate-600 dark:bg-slate-800 dark:text-white';
const label = 'mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200';

export interface AddToListResult {
  list: { id: string; name: string };
  added: number;
  alreadyOn: number;
}

/** "Added 3 to Stage crew (1 was already on it)". */
export function addedMessage({ list, added, alreadyOn }: AddToListResult): string {
  const people = `${added} ${added === 1 ? 'contact' : 'contacts'}`;
  const already = alreadyOn ? ` (${alreadyOn} ${alreadyOn === 1 ? 'was' : 'were'} already on it)` : '';
  return `Added ${people} to ${list.name}${already}`;
}

export default function AddToListDialog({
  selection,
  defaultListId,
  returnFocusRef,
  onClose,
  onDone,
}: {
  selection: ContactSelection;
  defaultListId?: string;
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onDone: (result: AddToListResult) => void;
}) {
  const [lists, setLists] = useState<ContactList[] | null>(null);
  const [target, setTarget] = useState(defaultListId ?? '');
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ lists: ContactList[] }>('/admin/contact-lists?type=MANUAL')
      .then((result) => {
        if (cancelled) return;
        const manual = result.lists.filter((list) => list.type === 'MANUAL');
        setLists(manual);
        // No manual list yet: start on "New manual list".
        setTarget((current) => current || (manual[0]?.id ?? NEW));
      })
      .catch(() => {
        if (cancelled) return;
        setLists([]);
        setTarget(NEW);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (target === NEW) newNameRef.current?.focus();
  }, [target]);

  const people = `${selection.count} ${selection.count === 1 ? 'contact' : 'contacts'}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (target === NEW && !newName.trim()) {
      setNameError('Give the new list a name.');
      newNameRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const list =
        target === NEW
          ? await api.post<ContactList>('/admin/contact-lists', { name: newName.trim(), type: 'MANUAL' })
          : lists!.find((entry) => entry.id === target)!;
      const body = selection.kind === 'ids' ? { contactIds: selection.ids } : { query: selection.query };
      const result = await api.post<{ added: number; alreadyOn: number }>(
        `/admin/contact-lists/${encodeURIComponent(list.id)}/members`,
        body
      );
      onDone({ list: { id: list.id, name: list.name }, ...result });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'LIST_NAME_TAKEN') {
        setNameError('A list with this name already exists.');
        newNameRef.current?.focus();
      } else {
        setError(e.message || 'Could not add to the list.');
      }
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="add-to-list-title"
      title={`Add ${people} to a list`}
      dirty={false}
      submitWhenClean
      saving={saving}
      saveDisabled={lists === null || !target}
      submitLabel="Add to list"
      savingLabel="Adding…"
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="add-to-list-target" className={label}>List</label>
          <select
            id="add-to-list-target"
            value={target}
            disabled={lists === null}
            onChange={(e) => {
              setTarget(e.target.value);
              setNameError(null);
            }}
            className={control}
          >
            {lists === null && <option value="">Loading lists…</option>}
            {lists?.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.contactCount})
              </option>
            ))}
            {lists !== null && <option value={NEW}>New manual list…</option>}
          </select>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            Only manual lists take people by hand; automatic lists follow their filters.
          </p>
        </div>

        {target === NEW && (
          <div>
            <label htmlFor="add-to-list-new-name" className={label}>New list name</label>
            <input
              ref={newNameRef}
              id="add-to-list-new-name"
              type="text"
              maxLength={80}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setNameError(null);
              }}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'add-to-list-name-error' : undefined}
              placeholder="e.g. Volunteers 2026"
              className={control}
            />
            {nameError && (
              <p id="add-to-list-name-error" className="mt-1 text-sm text-red-700 dark:text-red-400">
                {nameError}
              </p>
            )}
          </div>
        )}

        {selection.kind === 'query' && (
          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800 dark:bg-slate-800 dark:text-slate-200">
            Everyone who matches the current filters is added now. People who match later are not added; use an
            automatic list for that.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </SettingsDialog>
  );
}
