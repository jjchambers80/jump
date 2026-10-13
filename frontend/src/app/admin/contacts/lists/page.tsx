'use client';

// Contacts › Lists (spec 055): built-in and saved lists with their type, size,
// author and last change. New list opens the Create a list dialog.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ListChecks, Plus, Search } from 'lucide-react';
import api, { downloadCsv } from '@/services/api';
import { ReauthProvider, isReauthCancelled, useReauth } from '@/app/admin/account/useReauth';
import { useCan, useOrg } from '@/components/OrgContext';
import ActionsMenu from '@/components/ActionsMenu';
import ToastHost, { showToast } from '@/components/content/Toast';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import { contactListHref, type ContactList, type ContactListType } from '@/lib/contactLists';
import ContactsHeader from '../ContactsHeader';
import ListFormDialog from './ListFormDialog';
import { ListTypeBadge, formatRelative, listMenuItems } from './listUi';

const TYPE_FILTERS: { value: ContactListType; label: string }[] = [
  { value: 'AUTOMATIC', label: 'Automatic' },
  { value: 'MANUAL', label: 'Manual' },
];

function ContactListsPageContent() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const canEdit = useCan('customers.lists');
  const canExport = useCan('customers.export');
  const { withReauth } = useReauth();
  const router = useRouter();
  const [lists, setLists] = useState<ContactList[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<ContactListType | null>(null);
  const [dialog, setDialog] = useState<{ list?: ContactList } | null>(null);
  const [deleting, setDeleting] = useState<ContactList | null>(null);
  const [busy, setBusy] = useState(false);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrgId) return;
    setError(null);
    try {
      setLists((await api.get<{ lists: ContactList[] }>('/admin/contact-lists')).lists);
    } catch (err) {
      setError((err as Error)?.message || 'Could not load lists');
    }
  }, [selectedOrgId]);

  useEffect(() => {
    if (!orgLoading) load();
  }, [orgLoading, load]);

  const term = search.trim().toLowerCase();
  const shown = (lists ?? []).filter((list) => (!type || list.type === type) && (!term || list.name.toLowerCase().includes(term)));

  const duplicate = async (list: ContactList) => {
    try {
      const copy = await api.post<ContactList>(`/admin/contact-lists/${encodeURIComponent(list.id)}/duplicate`, {});
      showToast(`Created “${copy.name}”`);
      load();
    } catch (err) {
      showToast((err as Error)?.message || 'Could not duplicate the list');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/admin/contact-lists/${encodeURIComponent(deleting.id)}`);
      showToast(`Deleted “${deleting.name}”`);
      setDeleting(null);
      load();
    } catch (err) {
      showToast((err as Error)?.message || 'Could not delete the list');
    } finally {
      setBusy(false);
    }
  };

  const exportList = async (list: ContactList) => {
    try {
      await withReauth(() =>
        downloadCsv(`/admin/customers/export.csv?scope=all&list=${encodeURIComponent(list.id)}`, 'contacts.csv')
      );
    } catch (err) {
      if (!isReauthCancelled(err)) showToast((err as Error)?.message || 'Could not export the list');
    }
  };

  const menuFor = (list: ContactList) =>
    listMenuItems(list, {
      canEdit,
      onEdit: (trigger) => {
        focusReturnRef.current = trigger;
        setDialog({ list });
      },
      onDuplicate: () => duplicate(list),
      onExport: canExport ? () => exportList(list) : undefined,
      onDelete: (trigger) => {
        focusReturnRef.current = trigger;
        setDeleting(list);
      },
    });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <ContactsHeader
        active="lists"
        subtitle="Groups of contacts you keep: automatic lists follow your filters, manual lists hold exactly who you add."
        action={
          canEdit && (
            <button
              ref={newButtonRef}
              type="button"
              onClick={() => {
                focusReturnRef.current = newButtonRef.current;
                setDialog({});
              }}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New list
            </button>
          )
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}{' '}
          <button type="button" onClick={load} className="font-semibold underline">
            Try again
          </button>
        </div>
      )}

      {!orgLoading && !selectedOrgId && (
        <p className="py-12 text-center text-sm text-gray-600 dark:text-slate-400">Pick an organization from the menu in the top right.</p>
      )}

      {selectedOrgId && (
        <section aria-label="Lists" className="rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col gap-3 border-b border-gray-200 p-3 dark:border-slate-700 sm:flex-row sm:items-center">
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-slate-400" aria-hidden />
              <input
                type="search"
                aria-label="Search lists"
                placeholder="Search lists"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-400"
              />
            </div>
            <div role="group" aria-label="Filter by type" className="flex gap-2">
              {TYPE_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={type === option.value}
                  onClick={() => setType((current) => (current === option.value ? null : option.value))}
                  className={`min-h-[44px] rounded-full border px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 ${
                    type === option.value
                      ? 'border-gray-900 bg-gray-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                      : 'border-gray-300 text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {lists === null && !error ? (
            <div aria-busy="true" aria-label="Loading lists" className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none dark:bg-slate-700/60" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                <ListChecks className="h-6 w-6" aria-hidden />
              </span>
              <h2 className="mt-4 text-base font-semibold text-gray-900 dark:text-white">No lists match</h2>
              <p className="mt-1 max-w-sm text-sm text-gray-600 dark:text-slate-400">Try another search or type.</p>
            </div>
          ) : (
            <>
              {/* Phones and tablets */}
              <ul className="divide-y divide-gray-200 dark:divide-slate-700 lg:hidden" data-testid="lists-cards">
                {shown.map((list) => (
                  <li key={list.id} className="flex items-start gap-3 px-4 py-3.5">
                    <Link
                      href={contactListHref(list.id)}
                      className="min-w-0 flex-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
                    >
                      <span className="block truncate font-medium text-gray-900 dark:text-white">{list.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-slate-400">
                        <ListTypeBadge type={list.type} />
                        <span className="tabular-nums">
                          {list.contactCount} {list.contactCount === 1 ? 'contact' : 'contacts'}
                        </span>
                      </span>
                    </Link>
                    <ActionsMenu label={`Actions for ${list.name}`} items={menuFor(list)} />
                  </li>
                ))}
              </ul>

              {/* Desktop */}
              <table className="hidden w-full text-left text-sm lg:table">
                <caption className="sr-only">Contact lists</caption>
                <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">List name</th>
                    <th scope="col" className="px-4 py-3 font-medium">Type</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Contacts</th>
                    <th scope="col" className="px-4 py-3 font-medium">Created by</th>
                    <th scope="col" className="px-4 py-3 font-medium">Last activity</th>
                    <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {shown.map((list) => (
                    <tr key={list.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40">
                      <td className="max-w-[20rem] px-4 py-3">
                        <Link
                          href={contactListHref(list.id)}
                          className="block truncate font-medium text-gray-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 dark:text-white"
                        >
                          {list.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3"><ListTypeBadge type={list.type} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-white">{list.contactCount}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300">
                        {list.builtIn ? 'Automatically created' : list.createdBy?.name || 'A former staff member'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300">
                        {list.lastActivityAt ? (
                          <time dateTime={list.lastActivityAt} title={new Date(list.lastActivityAt).toLocaleString()}>
                            {formatRelative(list.lastActivityAt)}
                          </time>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ActionsMenu label={`Actions for ${list.name}`} items={menuFor(list)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {dialog && (
        <ListFormDialog
          list={dialog.list}
          returnFocusRef={focusReturnRef}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            if (dialog.list) {
              showToast('List saved');
              load();
            } else {
              router.push(contactListHref(saved.id));
            }
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          titleId="delete-list-title"
          title={`Delete “${deleting.name}”?`}
          confirmLabel="Delete list"
          busyLabel="Deleting…"
          busy={busy}
          danger
          returnFocusRef={focusReturnRef}
          onClose={() => setDeleting(null)}
          onConfirm={remove}
        >
          <p>
            The list goes away. Its {deleting.contactCount} {deleting.contactCount === 1 ? 'contact stays' : 'contacts stay'} in
            Contacts.
          </p>
        </ConfirmDialog>
      )}

      <ToastHost />
    </div>
  );
}

export default function ContactListsPage() {
  return (
    <ReauthProvider>
      <ContactListsPageContent />
    </ReauthProvider>
  );
}
