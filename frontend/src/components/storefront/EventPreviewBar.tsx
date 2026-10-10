'use client';

// Draft event preview bar (spec 050 §7.5). Rendered only when the backend
// answered `preview: true` for a verified X-Event-Preview — never from the
// cookie alone. Exit expires the cookie through /api/events/preview and goes
// to the store's home (short path on a tenant host via storefrontHref).

import { Eye, X } from 'lucide-react';
import { storefrontHref } from '@/lib/storefrontPath';

export default function EventPreviewBar({ organizationId }: { organizationId?: string | null }) {
  const home = organizationId ? storefrontHref(`/organizations/${organizationId}`, organizationId) : '/';
  return (
    <div
      role="region"
      aria-label="Event preview"
      data-testid="event-preview-bar"
      className="sticky top-0 z-40 bg-brand text-brand-fg"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <Eye className="h-5 w-5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 text-sm leading-snug">
          <strong className="font-semibold">Preview, not published.</strong>{' '}
          <span>Only staff with this link can see it. Checkout, RSVP and applications are off.</span>
        </p>
        <a
          href={`/api/events/preview?to=${encodeURIComponent(home)}`}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-md px-2 text-sm font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <X className="h-4 w-4" aria-hidden />
          Exit preview
        </a>
      </div>
    </div>
  );
}
