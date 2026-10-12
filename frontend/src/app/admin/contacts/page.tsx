'use client';

// Contacts: the organization's one contact list (buyers, RSVPs, form
// submitters, subscribers).

import { Suspense } from 'react';
import ContactsHeader from './ContactsHeader';
import ContactsList from './ContactsList';

export default function ContactsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">Loading contacts…</div>}>
      <ContactsList basePath="/admin/contacts" header={(count) => <ContactsHeader active="contacts" subtitle={count} />} />
    </Suspense>
  );
}
