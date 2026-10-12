'use client';

// Contacts: the organization's one contact list (buyers, RSVPs, form
// submitters, subscribers). Staff who manage lists can select contacts and
// add them to a manual list (spec 055-C); `?addTo=<listId>` (from a list's
// "Add contacts") preselects that list.

import { Suspense, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ListPlus } from 'lucide-react';
import { useCan } from '@/components/OrgContext';
import ToastHost, { showToast } from '@/components/content/Toast';
import { ReauthProvider } from '@/app/admin/account/useReauth';
import ContactsHeader from './ContactsHeader';
import ContactsList, { type ContactSelection } from './ContactsList';
import AddToListDialog, { addedMessage } from './lists/AddToListDialog';

function ContactsPageContent() {
  const canEditLists = useCan('customers.lists');
  const params = useSearchParams();
  // Read once: changing a filter rewrites the URL without it.
  const [addTo] = useState(() => params.get('addTo') ?? undefined);
  const [adding, setAdding] = useState<{ selection: ContactSelection; done: () => void } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  return (
    <>
      <ContactsList
        basePath="/admin/contacts"
        header={(count) => <ContactsHeader active="contacts" subtitle={count} />}
        bulkActions={
          canEditLists
            ? (selection, done) => (
                <button
                  type="button"
                  onClick={(e) => {
                    triggerRef.current = e.currentTarget;
                    setAdding({ selection, done: () => done() });
                  }}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
                >
                  <ListPlus className="h-4 w-4" aria-hidden />
                  Add to list
                </button>
              )
            : undefined
        }
      />
      {adding && (
        <AddToListDialog
          selection={adding.selection}
          defaultListId={addTo}
          returnFocusRef={triggerRef}
          onClose={() => setAdding(null)}
          onDone={(result) => {
            adding.done();
            setAdding(null);
            showToast(addedMessage(result));
          }}
        />
      )}
      <ToastHost />
    </>
  );
}

export default function ContactsPage() {
  return (
    <ReauthProvider>
      <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">Loading contacts…</div>}>
        <ContactsPageContent />
      </Suspense>
    </ReauthProvider>
  );
}
