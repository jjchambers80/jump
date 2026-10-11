// Sticky footer (spec 050 §11.2): Back (left, text), then Skip for now when
// the step is optional and empty, Save on a live event, and Next as the one
// primary action. Next is never disabled for validation (§11.6): a failed Next
// shows the error summary. It only waits while the create request is out.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { primaryButton, secondaryButton, textButton } from './ui';

export default function SetupFooter({
  onBack,
  onSkip,
  onSave,
  onNext,
  nextLabel,
  busy,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  /** PUBLISHED events save explicitly (§11.5). */
  onSave?: () => void;
  onNext: () => void;
  nextLabel: string;
  busy: boolean;
}) {
  return (
    <footer className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] dark:border-slate-700 dark:bg-slate-900">
      {onBack && (
        <button type="button" onClick={onBack} className={`${textButton} -ml-2`}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Back
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        {onSkip && (
          <button type="button" onClick={onSkip} className={textButton}>
            Skip for now
          </button>
        )}
        {onSave && (
          <button type="button" onClick={onSave} disabled={busy} className={secondaryButton}>
            Save
          </button>
        )}
        <button type="button" onClick={onNext} disabled={busy} aria-busy={busy || undefined} className={primaryButton}>
          {nextLabel}
          {!busy && <ChevronRight className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </footer>
  );
}
