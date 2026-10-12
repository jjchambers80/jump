'use client';

// One contact list (spec 055): what it is, then its contacts in the Contacts
// table (`ContactsList` with `listId`), so search, sort and paging match.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, UserMinus, UserPlus } from 'lucide-react';
import api from '@/services/api';
import { useCan, useOrg } from '@/components/OrgContext';
import ActionsMenu from '@/components/ActionsMenu';
import ToastHost, { showToast } from '@/components/content/Toast';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import { contactListHref, describeFilters, type ContactList } from '@/lib/contactLists';
import ContactsList from '../../ContactsList';
import ListFormDialog from '../ListFormDialog';
import { ListTypeBadge, listMenuItems } from '../listUi';
import { useListOptions } from '../useListOptions';

function ListPage({ listId }: { listId: string }) {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const canEdit = useCan('customers.lists');
  const router = useRouter();
  const [list, setList] = useState<ContactList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  // Remount the table after an edit so it reloads the new members.
  const [version, setVersion] = useState(0);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const { events, forms } = useListOptions(list?.type === 'AUTOMATIC');

  const load = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setList(await api.get<ContactList>(`/admin/contact-lists/${encodeURIComponent(listId)}`));
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || 'Could not load the list');
    }
  }, [selectedOrgId, listId]);

  useEffect(() => {
    if (!orgLoading) load();
  }, [orgLoading, load]);

  const duplicate = async () => {
    try {
      const copy = await api.post<ContactList>(`/admin/contact-lists/${encodeURIComponent(listId)}/duplicate`, {});
      showToast(`Created “${copy.name}”`);
      router.push(contactListHref(copy.id));
    } catch (err) {
      showToast((err as Error)?.message || 'Could not duplicate the list');
    }
  };

  const [removing, setRemoving] = useState(false);
  // Takes people off this manual list; they stay in Contacts.
  const removeMembers = async (contactIds: string[], done: () => void) => {
    setRemoving(true);
    try {
      const { removed } = await api.delete<{ removed: number }>(`/admin/contact-lists/${encodeURIComponent(listId)}/members`, {
        body: JSON.stringify({ contactIds }),
      });
      showToast(`Removed ${removed} ${removed === 1 ? 'contact' : 'contacts'} from the list`);
      done();
      load();
    } catch (err) {
      showToast((err as Error)?.message || 'Could not remove them from the list');
    } finally {
      setRemoving(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/admin/contact-lists/${encodeURIComponent(listId)}`);
      router.push('/admin/contacts/lists');
    } catch (err) {
      showToast((err as Error)?.message || 'Could not delete the list');
      setBusy(false);
    }
  };

  const back = (
    <Link
      href="/admin/contacts/lists"
      className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 dark:text-slate-300 dark:hover:text-white"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden />
      Lists
    </Link>
  );

  if (error && !list) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {back}
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  const header = (count: ReactNode) => (
    <header className="mb-6">
      {back}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{list?.name ?? 'List'}</h1>
            {list && <ListTypeBadge type={list.type} />}
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            {count}
            {list?.type === 'AUTOMATIC' && <> · {describeFilters(list.filters, { events, forms })}</>}
            {list?.builtIn && <> · Automatically created</>}
          </p>
        </div>
        {list && canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {list.type === 'MANUAL' && (
              <Link
                href={`/admin/contacts?addTo=${encodeURIComponent(list.id)}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Add contacts
              </Link>
            )}
            {!list.builtIn && (
              <button
                type="button"
                onClick={(e) => {
                  focusReturnRef.current = e.currentTarget;
                  setEditing(true);
                }}
                className="inline-flex min-h-[44px] items-center rounded-md border border-gray-300 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 dark:border-slate-600 dark:text-white dark:hover:bg-slate-700"
              >
                {list.type === 'AUTOMATIC' ? 'Edit list' : 'Rename'}
              </button>
            )}
            <ActionsMenu
              label={`More actions for ${list.name}`}
              items={listMenuItems(list, {
                canEdit,
                open: false,
                edit: false,
                onDuplicate: duplicate,
                onDelete: (trigger) => {
                  focusReturnRef.current = trigger;
                  setDeleting(true);
                },
              })}
            />
          </div>
        )}
      </div>
      {list?.filterWarnings?.map((warning) => (
        <p
          key={warning.field}
          role="status"
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {warning.message}
        </p>
      ))}
    </header>
  );

  return (
    <>
      <ContactsList
        key={version}
        basePath={contactListHref(listId)}
        listId={listId}
        header={header}
        emptyState={
          list?.type === 'MANUAL'
            ? {
                title: 'Nobody on this list yet',
                body: canEdit ? 'Choose Add contacts, select people in Contacts, then Add to list.' : 'This manual list is empty.',
              }
            : { title: 'Nobody matches this list yet', body: 'Contacts join as soon as they match its filters.' }
        }
        selectAllMatching={false}
        bulkActions={
          list?.type === 'MANUAL' && canEdit
            ? (selection, done) => (
                <button
                  type="button"
                  disabled={removing}
                  onClick={() => selection.kind === 'ids' && removeMembers(selection.ids, () => done(true))}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20"
                >
                  <UserMinus className="h-4 w-4" aria-hidden />
                  {removing ? 'Removing…' : 'Remove from list'}
                </button>
              )
            : undefined
        }
      />

      {editing && list && (
        <ListFormDialog
          list={list}
          returnFocusRef={focusReturnRef}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            setList(saved);
            setVersion((v) => v + 1);
            showToast('List saved');
          }}
        />
      )}

      {deleting && list && (
        <ConfirmDialog
          titleId="delete-list-title"
          title={`Delete “${list.name}”?`}
          confirmLabel="Delete list"
          busyLabel="Deleting…"
          busy={busy}
          danger
          returnFocusRef={focusReturnRef}
          onClose={() => setDeleting(false)}
          onConfirm={remove}
        >
          <p>
            The list goes away. Its {list.contactCount} {list.contactCount === 1 ? 'contact stays' : 'contacts stay'} in Contacts.
          </p>
        </ConfirmDialog>
      )}

      <ToastHost />
    </>
  );
}

export default function ContactListPage({ params }: { params: { listId: string } }) {
  const listId = decodeURIComponent(params.listId);
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">Loading list…</div>}>
      <ListPage listId={listId} />
    </Suspense>
  );
}
