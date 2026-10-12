// Wizard header (spec 050 §11.2): 56 px, the Eventimus mark or the event's
// name, the preview button (labelled, 44 × 44) below lg
// behind buttons, and Exit (before the row exists) or Save & exit.

import { Eye } from 'lucide-react';
import EventimusLogo from '@/components/EventimusLogo';
import { iconButton, secondaryButton } from './ui';

export default function SetupHeader({
  eventName,
  hasRow,
  saving,
  onPreview,
  onExit,
  viewEvent,
}: {
  eventName: string | null;
  hasRow: boolean;
  saving: boolean;
  onPreview: () => void;
  onExit: () => void;
  /** "View event" (once the row exists). */
  viewEvent?: React.ReactNode;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-900 sm:px-4">
      <button type="button" onClick={onPreview} aria-label="Show preview" className={`${iconButton} lg:hidden`}>
        <Eye className="h-5 w-5" aria-hidden />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-3 pl-1">
        <EventimusLogo className="hidden h-4 shrink-0 sm:block" />
        {eventName && (
          <span className="truncate text-sm font-medium text-gray-900 dark:text-white sm:border-l sm:border-gray-200 sm:pl-3 sm:dark:border-slate-700">
            {eventName}
          </span>
        )}
      </div>
      {viewEvent}
      <button type="button" onClick={onExit} disabled={saving} className={secondaryButton}>
        {hasRow ? 'Save & exit' : 'Exit'}
      </button>
    </header>
  );
}
