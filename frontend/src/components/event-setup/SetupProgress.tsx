// Progress (spec 050 §11.2, §11.4): a 4 px fill, the step list as an <ol>
// with aria-current="step" (labels from lg), and "Step n of N — Name". Every
// state is text + icon, never colour alone. Jumping happens in StepMenu.

import { Check, Circle, CircleDot, MinusCircle } from 'lucide-react';
import type { EventStep, StepState } from './steps';

const STATE_TEXT: Record<StepState, string> = {
  complete: 'Completed',
  current: 'Current step',
  skipped: 'Skipped',
  todo: 'Not started',
};

export function StepStateIcon({ state }: { state: StepState }) {
  const cls = 'h-4 w-4 shrink-0';
  if (state === 'complete') return <Check className={`${cls} text-green-700 dark:text-green-400`} aria-hidden />;
  if (state === 'current') return <CircleDot className={`${cls} text-gray-900 dark:text-white`} aria-hidden />;
  if (state === 'skipped') return <MinusCircle className={`${cls} text-gray-500 dark:text-slate-400`} aria-hidden />;
  return <Circle className={`${cls} text-gray-400 dark:text-slate-500`} aria-hidden />;
}

export const stateText = (state: StepState) => STATE_TEXT[state];

export default function SetupProgress({
  steps,
  states,
  index,
  total,
  title,
  aside,
}: {
  steps: EventStep[];
  states: StepState[];
  index: number;
  total: number;
  title: string;
  /** The save indicator, beside the step line. */
  aside: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="h-1 bg-gray-200 dark:bg-slate-700" aria-hidden>
        <div className="h-1 bg-accent-500 motion-safe:transition-[width] motion-safe:duration-200" style={{ width: `${(index / total) * 100}%` }} />
      </div>
      <ol aria-label="Setup steps" className="hidden gap-1 px-4 pt-2 lg:flex">
        {steps.map((step, i) => (
          <li
            key={step.key}
            aria-current={states[i] === 'current' ? 'step' : undefined}
            className={`flex min-w-0 flex-1 items-center gap-1 text-xs ${
              states[i] === 'current' ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-400'
            }`}
          >
            <StepStateIcon state={states[i]} />
            <span className="truncate" title={step.title}>
              {step.title}
            </span>
            <span className="sr-only">, {stateText(states[i])}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <p className="text-sm text-gray-700 dark:text-slate-300">
          Step {index} of {total} — {title}
        </p>
        {aside}
      </div>
    </div>
  );
}
