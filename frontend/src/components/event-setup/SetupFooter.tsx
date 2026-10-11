// Sticky footer (spec 050 §11.2): Back (left, text), then Skip for now when
// the step is optional and empty, Save on a live event, and Next as the one
// primary action. Next is never disabled for validation (§11.6): a failed Next
// shows the error summary. It only waits while the create request is out.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { primaryButton, secondaryButton, textButton } from './ui';

/** The element that says why navigation waits (aria-describedby target). */
export const LOCKED_REASON_ID = 'setup-locked-reason';

export default function SetupFooter({
  onBack,
  locked,
  onSkip,
  onSave,
  onNext,
  nextLabel,
  nextForm,
  skipLabel = 'Skip for now',
  busy,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  /** PUBLISHED events save explicitly (§11.5). */
  onSave?: () => void;
  /** Absent on Review, whose own Publish is the primary action. */
  onNext?: () => void;
  nextLabel: string;
  /** Next submits this <form> (by id) instead of calling onNext: the step saves, then moves on. */
  nextForm?: string;
  skipLabel?: string;
  busy: boolean;
  /** Why Back waits (a publish in flight); Back stays focusable with aria-disabled. */
  locked?: string;
}) {
  return (
    <footer className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] dark:border-slate-700 dark:bg-slate-900">
      {onBack && (
        <button
          type="button"
          onClick={locked ? undefined : onBack}
          aria-disabled={locked ? true : undefined}
          aria-describedby={locked ? LOCKED_REASON_ID : undefined}
          className={`${textButton} -ml-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Back
        </button>
      )}
      {locked && (
        <p id={LOCKED_REASON_ID} className="min-w-0 text-sm text-gray-700 dark:text-slate-300">
          {locked}
        </p>
      )}
      <div className="ml-auto flex items-center gap-2">
        {onSkip && (
          <button type="button" onClick={onSkip} className={textButton}>
            {skipLabel}
          </button>
        )}
        {onSave && (
          <button type="button" onClick={onSave} disabled={busy} className={secondaryButton}>
            Save
          </button>
        )}
        {(onNext || nextForm) && (
          <button type={nextForm ? 'submit' : 'button'} form={nextForm} onClick={nextForm ? undefined : onNext} disabled={busy} aria-busy={busy || undefined} className={primaryButton}>
            {nextLabel}
            {!busy && <ChevronRight className="h-4 w-4" aria-hidden />}
          </button>
        )}
      </div>
    </footer>
  );
}
