'use client';

// Spec 050-O/P: the old event editor and event-level forms configuration
// routes send bookmarks and email links to the wizard step that now owns their fields. `to` may look something up first
// (an old link's target); if that fails the fallback step still opens. The
// organization in the old link (`?orgId=`, or `?org=`) rides along as `?org=`,
// which the wizard selects before it loads (OrgFromUrlGate).

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function withOrg(href: string): string {
  const query = new URLSearchParams(window.location.search);
  const org = query.get('orgId') || query.get('org');
  if (!org) return href;
  const url = new URL(href, window.location.origin);
  url.searchParams.set('org', org);
  return url.pathname + url.search;
}

export default function WizardRedirect({ to, fallback }: { to: () => string | Promise<string>; fallback: string }) {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(to)
      .catch(() => fallback)
      .then((href) => live && router.replace(withOrg(href)));
    return () => {
      live = false;
    };
    // Runs once per mount: the target is fixed by the URL that brought us here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <p role="status" className="px-4 py-8 text-sm text-gray-600 dark:text-slate-400">
      Opening the event setup…
    </p>
  );
}
