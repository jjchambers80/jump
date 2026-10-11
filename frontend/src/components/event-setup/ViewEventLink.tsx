'use client';

// "View event" in the wizard header (050-O parity with the old editors' View
// page): the public page of a published event, or a signed private preview
// (POST …/preview-link, spec 050-F) of a draft, in a new tab. Icon-only on
// phones, with the same accessible name.

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import api from '@/services/api';
import { secondaryButton } from './ui';

const cls = `${secondaryButton} px-3 sm:px-4`;

function Label() {
  return (
    <>
      <ExternalLink className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">View event</span>
      <span className="sr-only sm:hidden">View event</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </>
  );
}

export default function ViewEventLink({ orgId, event }: { orgId: string; event: { id: string; slug: string; status: string } }) {
  const [failed, setFailed] = useState(false);
  if (event.status === 'PUBLISHED')
    return (
      <a href={`/events/${encodeURIComponent(event.slug || event.id)}`} target="_blank" rel="noreferrer" className={cls}>
        <Label />
      </a>
    );

  const open = () => {
    setFailed(false);
    // Opened inside the click, so no popup blocker stops it; the link fills it in.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    api
      .post<{ url: string }>(`/organizations/${orgId}/events/${encodeURIComponent(event.id)}/preview-link`, {})
      .then(({ url }) => {
        if (tab) tab.location.href = url;
        else window.open(url, '_blank', 'noopener');
      })
      .catch(() => {
        tab?.close();
        setFailed(true);
      });
  };
  return (
    <>
      <button type="button" onClick={open} className={cls}>
        <Label />
      </button>
      <span role="status" className="sr-only">
        {failed ? "Couldn't open the preview. Try again." : ''}
      </span>
    </>
  );
}
