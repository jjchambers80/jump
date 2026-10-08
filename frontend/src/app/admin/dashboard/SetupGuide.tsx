'use client';

// Dashboard setup banner (spec 022 §5.6): one line pointing at the onboarding
// checklist (/admin/onboarding) until every step is done or the guide is
// dismissed. The steps themselves live on that page.

import Link from 'next/link';
import { useSetupGuide } from '@/components/onboarding/useSetupGuide';
import ProgressRing from '@/components/onboarding/ProgressRing';

export default function SetupGuide() {
  const { guide, done, total, complete } = useSetupGuide();
  if (!guide || guide.dismissedAt || complete || total === 0) return null;

  return (
    <section
      className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
      aria-labelledby="setup-guide-heading"
      data-testid="setup-guide"
    >
      <ProgressRing done={done} total={total} className="h-6 w-6" />
      <div className="min-w-0 flex-1">
        <h2 id="setup-guide-heading" className="text-sm font-semibold text-gray-900 dark:text-slate-100">
          Finish setting up your store
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {done} of {total} done
        </p>
      </div>
      <Link
        href="/admin/onboarding"
        className="rounded-md bg-accent-500 px-3 py-1.5 text-sm font-semibold text-gray-950 hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
      >
        Continue setup
      </Link>
    </section>
  );
}
