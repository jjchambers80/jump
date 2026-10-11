// Review's donation suggestion slot (spec 050 §10, spec 047 D1 §0.2): one
// line, "Accept donations on this event?", linking to Collect more, for an
// eligible org with gifts off. D1-G wires the hook to its settings payload.

import Link from 'next/link';
import { HeartHandshake } from 'lucide-react';

/** ponytail: always false until D1 ships `acceptGifts` and the eligibility answer. */
export function useDonationSuggestion(_eventId: string): boolean {
  return false;
}

export default function DonationSuggestion({ eventId }: { eventId: string }) {
  if (!useDonationSuggestion(eventId)) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
      <HeartHandshake className="h-4 w-4 shrink-0" aria-hidden />
      <Link href={`/admin/events/${eventId}/setup?step=collect-more`} className="font-medium underline underline-offset-2">
        Accept donations on this event?
      </Link>
    </p>
  );
}
