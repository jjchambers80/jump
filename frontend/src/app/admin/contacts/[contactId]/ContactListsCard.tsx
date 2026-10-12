'use client';

// The manual lists a contact is on (spec 055-C), with remove and Add to list.
// Automatic lists are not shown: they follow filters, not a fact about the person.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ListPlus, X } from 'lucide-react';
import api from '@/services/api';
import { useCan } from '@/components/OrgContext';
import { showToast } from '@/components/content/Toast';
import { contactListHref } from '@/lib/contactLists';
import AddToListDialog, { addedMessage } from '../lists/AddToListDialog';

interface Membership {
  id: string;
  name: string;
}

export default function ContactListsCard({ contactId, contactName }: { contactId: string; contactName: string }) {
  const canEdit = useCan('customers.lists');
  const [lists, setLists] = useState<Membership[] | null>(null);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ lists?: Membership[] }>(`/admin/customers/${encodeURIComponent(contactId)}/lists`);
      setLists(Array.isArray(result?.lists) ? result.lists : []);
    } catch {
      setLists([]);
    }
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (list: Membership) => {
    try {
      await api.delete(`/admin/contact-lists/${encodeURIComponent(list.id)}/members`, {
        body: JSON.stringify({ contactIds: [contactId] }),
      });
      showToast(`Removed from ${list.name}`);
      // The button is gone: keep focus in the card.
      headingRef.current?.focus();
      load();
    } catch (err) {
      showToast((err as Error)?.message || 'Could not remove from the list');
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-slate-700">
        <h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-gray-900 focus:outline-none dark:text-white">
          Lists
        </h2>
        {canEdit && (
          <button
            ref={addRef}
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-md px-2 text-sm font-medium text-accent-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 dark:text-accent-300 dark:hover:bg-slate-700"
          >
            <ListPlus className="h-4 w-4" aria-hidden />
            Add to list
          </button>
        )}
      </div>
      <div className="px-4 py-3">
        {lists === null ? (
          <p className="text-sm text-gray-600 dark:text-slate-400">Loading…</p>
        ) : lists.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-slate-400">Not on any manual list.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Lists ${contactName} is on`}>
            {lists.map((list) => (
              <li key={list.id} className="inline-flex items-center rounded-full border border-gray-300 bg-gray-50 text-sm dark:border-slate-600 dark:bg-slate-700">
                <Link
                  href={contactListHref(list.id)}
                  className="rounded-full py-1 pl-3 pr-2 font-medium text-gray-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 dark:text-white"
                >
                  {list.name}
                </Link>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(list)}
                    aria-label={`Remove ${contactName} from ${list.name}`}
                    className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-600 hover:bg-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 dark:text-slate-300 dark:hover:bg-slate-600"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {adding && (
        <AddToListDialog
          selection={{ kind: 'ids', ids: [contactId], count: 1 }}
          returnFocusRef={addRef}
          onClose={() => setAdding(false)}
          onDone={(result) => {
            setAdding(false);
            showToast(addedMessage(result));
            load();
          }}
        />
      )}
    </div>
  );
}
