'use client';

// "Create a list" (spec 055 §4.4): choose Automatic or Manual, then name it and,
// for an automatic list, pick its filters with a live count. The same dialog
// edits a list (no type step; a list's type never changes).

import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ListFilter, Users } from 'lucide-react';
import api from '@/services/api';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import {
  cleanFilters,
  type ContactList,
  type ContactListFilters,
  type ContactListType,
} from '@/lib/contactLists';
import FilterFields from './FilterFields';
import { useListOptions } from './useListOptions';

const TYPES: { value: ContactListType; title: string; body: string; Icon: typeof ListFilter }[] = [
  {
    value: 'AUTOMATIC',
    title: 'Automatic list',
    body: 'Contacts are added automatically when they match your filters. The list stays up to date on its own.',
    Icon: ListFilter,
  },
  {
    value: 'MANUAL',
    title: 'Manual list',
    body: "You choose exactly who's in it: add contacts by hand or pick them from your contacts.",
    Icon: Users,
  },
];

export default function ListFormDialog({
  list,
  returnFocusRef,
  onClose,
  onSaved,
}: {
  /** The list to edit; omit to create one. */
  list?: ContactList;
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onSaved: (list: ContactList) => void;
}) {
  const editing = Boolean(list);
  const [step, setStep] = useState<'type' | 'details'>(editing ? 'details' : 'type');
  const [type, setType] = useState<ContactListType>(list?.type ?? 'AUTOMATIC');
  const [name, setName] = useState(list?.name ?? '');
  const [filters, setFilters] = useState<ContactListFilters>(list?.filters ?? {});
  const [spent, setSpent] = useState(list?.filters?.minSpent ? String(list.filters.minSpent) : '');
  const [count, setCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const automatic = type === 'AUTOMATIC';
  const { events, forms } = useListOptions(automatic);

  const spentValue = Number(spent);
  const chosen = cleanFilters({ ...filters, minSpent: spent && spentValue > 0 ? spentValue : undefined });
  const chosenKey = JSON.stringify(chosen);
  const spentInvalid = spent !== '' && !(spentValue > 0);

  useEffect(() => {
    if (step === 'details') nameRef.current?.focus();
  }, [step]);

  // Live "N contacts match", after a short pause.
  useEffect(() => {
    if (step !== 'details' || !automatic || spentInvalid) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .post<{ count: number }>('/admin/contact-lists/preview', { filters: chosen })
        .then((result) => !cancelled && setCount(result.count))
        .catch(() => !cancelled && setCount(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // chosenKey stands for `chosen`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, automatic, chosenKey, spentInvalid]);

  const dirty = editing
    ? name.trim() !== list!.name || (automatic && chosenKey !== JSON.stringify(cleanFilters(list!.filters ?? {})))
    : step === 'details' || type !== 'AUTOMATIC';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step === 'type') {
      setStep('details');
      return;
    }
    if (!name.trim()) {
      setNameError('Give the list a name.');
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    setNameError(null);
    try {
      const body = editing
        ? { name: name.trim(), ...(automatic && { filters: chosen }) }
        : { name: name.trim(), type, ...(automatic && { filters: chosen }) };
      const saved = editing
        ? await api.patch<ContactList>(`/admin/contact-lists/${encodeURIComponent(list!.id)}`, body)
        : await api.post<ContactList>('/admin/contact-lists', body);
      onSaved(saved);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'LIST_NAME_TAKEN') {
        setNameError('A list with this name already exists.');
        nameRef.current?.focus();
      } else {
        setError(e.message || 'Could not save the list.');
      }
      setSaving(false);
    }
  };

  const title = editing ? (automatic ? 'Edit list' : 'Rename list') : 'Create a list';

  return (
    <SettingsDialog
      titleId="list-form-title"
      title={title}
      dirty={dirty}
      saving={saving}
      submitWhenClean={step === 'type'}
      saveDisabled={spentInvalid}
      submitLabel={step === 'type' ? 'Continue' : editing ? 'Save' : 'Create list'}
      savingLabel={editing ? 'Saving…' : 'Creating…'}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      {step === 'type' ? (
        <fieldset>
          <legend className="mb-3 text-sm font-medium text-gray-800 dark:text-slate-200">How do you want to build this list?</legend>
          <div className="space-y-3">
            {TYPES.map(({ value, title: optionTitle, body, Icon }) => (
              <label
                key={value}
                className={`flex cursor-pointer gap-3 rounded-lg border p-4 focus-within:ring-2 focus-within:ring-accent-500 ${
                  type === value
                    ? 'border-accent-700 bg-accent-50 dark:border-accent-300 dark:bg-accent-900/20'
                    : 'border-gray-200 hover:border-gray-300 dark:border-slate-700 dark:hover:border-slate-500'
                }`}
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent-700 dark:text-accent-300" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-gray-900 dark:text-white">{optionTitle}</span>
                  <span className="mt-0.5 block text-sm text-gray-600 dark:text-slate-400">{body}</span>
                </span>
                <input
                  type="radio"
                  name="list-type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                  className="mt-1 h-5 w-5 shrink-0 accent-accent-600"
                />
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <div className="space-y-6">
          <div>
            <label htmlFor="list-name" className="mb-1 block text-sm font-medium text-gray-800 dark:text-slate-200">
              List name
            </label>
            <input
              ref={nameRef}
              id="list-name"
              type="text"
              maxLength={80}
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'list-name-error' : undefined}
              placeholder={automatic ? 'e.g. Spring market buyers' : 'e.g. Volunteers 2026'}
              className="h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 aria-[invalid=true]:border-red-600 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
            {nameError && (
              <p id="list-name-error" className="mt-1 text-sm text-red-700 dark:text-red-400">
                {nameError}
              </p>
            )}
          </div>

          {automatic ? (
            <>
              <FilterFields
                filters={filters}
                spent={spent}
                onChange={setFilters}
                onSpentChange={setSpent}
                events={events}
                forms={forms}
              />
              <p
                aria-live="polite"
                className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800 dark:bg-slate-800 dark:text-slate-200"
              >
                {spentInvalid
                  ? 'Enter an amount above $0, or leave it empty.'
                  : count === null
                  ? 'Counting contacts…'
                  : <><strong className="font-semibold tabular-nums">{count}</strong> {count === 1 ? 'contact matches' : 'contacts match'} right now</>}
              </p>
            </>
          ) : (
            !editing && (
              <p className="text-sm text-gray-600 dark:text-slate-400">
                The list starts empty.
              </p>
            )
          )}

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      )}
    </SettingsDialog>
  );
}
