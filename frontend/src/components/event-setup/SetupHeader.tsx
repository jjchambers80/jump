// Wizard header (spec 050 §11.2): 56 px, the Eventimus mark or the event's
// name, the step menu and preview buttons (labelled, 44 × 44) where those live
// behind buttons, and Exit (before the row exists) or Save & exit.

import { Eye, Menu } from 'lucide-react';
import EventimusLogo from '@/components/EventimusLogo';
import { iconButton, secondaryButton } from './ui';

export default function SetupHeader({
  eventName,
  hasRow,
  saving,
  showMenuButton,
  menuButtonClass,
  onMenu,
  onPreview,
  onExit,
}: {
  eventName: string | null;
  hasRow: boolean;
  saving: boolean;
  showMenuButton: boolean;
  /** Breakpoint classes: the edit-mode rail replaces the button from xl. */
  menuButtonClass: string;
  onMenu: () => void;
  onPreview: () => void;
  onExit: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-900 sm:px-4">
      {showMenuButton && (
        <button type="button" onClick={onMenu} aria-label="Setup steps" className={`${iconButton} ${menuButtonClass}`}>
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      )}
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
      <button type="button" onClick={onExit} disabled={saving} className={secondaryButton}>
        {hasRow ? 'Save & exit' : 'Exit'}
      </button>
    </header>
  );
}
