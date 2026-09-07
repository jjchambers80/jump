'use client';

import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { OrganizationPersonSummary } from './types';
import AddPersonDialog from './AddPersonDialog';

interface PeopleSectionProps {
  onChildActiveChange: (active: boolean) => void;
}

function personName(person: OrganizationPersonSummary) {
  return `${person.firstName.trim()} ${person.lastName.trim()}`.trim();
}

function initials(person: OrganizationPersonSummary) {
  return `${person.firstName.trim().charAt(0)}${person.lastName.trim().charAt(0)}`.toUpperCase() || '?';
}

export default function PeopleSection({ onChildActiveChange }: PeopleSectionProps) {
  const [people, setPeople] = useState<OrganizationPersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState('');
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState('');
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<{ people: OrganizationPersonSummary[] }>('/admin/settings/people');
      setPeople(response.people);
    } catch {
      setError('Unable to load people.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  const removePerson = async (person: OrganizationPersonSummary) => {
    const name = personName(person);
    if (!window.confirm(`Remove ${name}?`)) return;
    setRemovingId(person.id);
    setRemoveErrors((current) => ({ ...current, [person.id]: '' }));
    try {
      await api.delete(`/admin/settings/people/${encodeURIComponent(person.id)}`);
      setPeople((current) => current.filter((candidate) => candidate.id !== person.id));
      setAnnouncement(`${name} removed.`);
    } catch {
      setRemoveErrors((current) => ({ ...current, [person.id]: `Unable to remove ${name}.` }));
    } finally {
      setRemovingId('');
    }
  };

  return (
    <section aria-labelledby="people-heading" className="mt-8 border-t border-gray-200 pt-6 dark:border-slate-700">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="people-heading" className="text-sm font-semibold text-gray-900 dark:text-white">People</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            Add account representative, all owners, executives and directors
          </p>
        </div>
        <button ref={addButtonRef} type="button" onClick={() => { setAdding(true); onChildActiveChange(true); }} className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          Add
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-gray-500 dark:text-slate-400">Loading people…</p>
      ) : error ? (
        <div className="mt-4 text-sm" role="alert">
          <span className="text-red-600 dark:text-red-400">{error}</span>{' '}
          <button type="button" onClick={() => void loadPeople()} className="font-semibold text-indigo-600 underline dark:text-indigo-400">Retry</button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {people.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No people added yet.</p>}
          {people.map((person) => {
            const name = personName(person);
            return (
              <div key={person.id} className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200">
                    {initials(person)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-gray-900 dark:text-white">{name}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {person.isAccountRepresentative ? 'Account Representative' : 'Business person'}
                    </p>
                  </div>
                  <button type="button" aria-label={`Remove ${name}`} disabled={Boolean(removingId)} onClick={() => void removePerson(person)} className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30">
                    {removingId === person.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
                {removeErrors[person.id] && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{removeErrors[person.id]}</p>}
              </div>
            );
          })}
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      {adding && (
        <AddPersonDialog
          currentRepresentative={people.find((person) => person.isAccountRepresentative)}
          returnFocusRef={addButtonRef as RefObject<HTMLButtonElement>}
          onClose={() => { setAdding(false); onChildActiveChange(false); }}
          onAdded={(added) => {
            setPeople((current) => [
              added,
              ...current.map((person) => added.isAccountRepresentative ? { ...person, isAccountRepresentative: false } : person),
            ]);
            setAnnouncement(`${personName(added)} added.`);
          }}
        />
      )}
    </section>
  );
}