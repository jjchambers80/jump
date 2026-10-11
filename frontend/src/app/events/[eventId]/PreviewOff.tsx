// Controls that are off in preview (spec 050 §8.2, review of #409): they stay
// focusable with aria-disabled and point at a short visible note saying why,
// because the wizard's in-pane preview has no preview bar to explain it.
// Activation is blocked in the handler, not by the native `disabled`.

import type { ReactNode } from 'react';

/** aria-disabled + aria-describedby when `reasonId` is set, nothing otherwise. */
export const offProps = (reasonId?: string) =>
  reasonId ? { 'aria-disabled': true as const, 'aria-describedby': reasonId } : {};

/** Native-disabled look for aria-disabled controls. */
export const OFF_CLASS = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

export function PreviewNote({ id, children, className = '' }: { id: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} data-preview-note className={`text-xs text-gray-600 dark:text-slate-300 ${className}`}>
      {children}
    </p>
  );
}
