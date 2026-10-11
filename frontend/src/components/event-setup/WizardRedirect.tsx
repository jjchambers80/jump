'use client';

// Spec 050-O: with the wizard flag on, the old event editors and the
// event-level forms configuration pages send bookmarks and email links to the
// wizard step that now owns their fields. `to` may look something up first
// (a form's purpose); if that fails the fallback step still opens.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function WizardRedirect({ to, fallback }: { to: () => string | Promise<string>; fallback: string }) {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(to)
      .catch(() => fallback)
      .then((href) => live && router.replace(href));
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
