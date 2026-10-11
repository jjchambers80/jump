// A field the organizer has not set yet, in preview mode only (spec 050 §8.2).
// Faded, but never colour alone: it is real text ("Add a date") in italics,
// and both tones keep 4.5:1 in light and dark.

import type { ReactNode } from 'react';

const TONES = {
  /** On the dark hero. */
  hero: 'text-gray-200',
  /** On the page or card surface. */
  surface: 'text-gray-600 dark:text-slate-300',
};

export default function Placeholder({ children, tone = 'surface' }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return (
    <span data-placeholder className={`italic ${TONES[tone]}`}>
      {children}
    </span>
  );
}
