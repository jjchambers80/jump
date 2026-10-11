// "Continue setup" (spec 050 §4): shown on the events list card, the Details
// hero and the dashboard attention list for a DRAFT whose create flow is still
// running. Renders nothing otherwise, so callers keep their usual action.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { continueSetupHref } from '@/lib/eventWizard';

export default function ContinueSetupLink({
  event,
  className = '',
}: {
  event: { id: string; name: string; status: string; setupStep?: string | null; setupCompletedAt?: string | null };
  className?: string;
}) {
  const href = continueSetupHref(event);
  if (!href) return null;
  return (
    <Link
      href={href}
      aria-label={`Continue setup: ${event.name}`}
      className={`relative inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${className}`}
    >
      Continue setup
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}
