// Onboarding checklist — /admin/onboarding (spec 022 §5.6)
// The setup guide as its own page: grouped steps on the left, the selected
// step's explanation and call to action on the right. On phones the detail
// opens inside the selected row instead. The sidebar links here, with a
// progress ring, until every step is done or the guide is dismissed.
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import type { SetupTask, SetupTaskId } from '@/services/adminService';
import { useSetupGuide } from '@/components/onboarding/useSetupGuide';
import { GROUPS, copyFor } from '@/components/onboarding/setupTasks';

function StepMarker({ task, n }: { task: SetupTask; n: number }) {
  return task.done ? (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900">
      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
      <span className="sr-only">Done:</span>
    </span>
  ) : (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-300 text-xs text-gray-500 dark:border-slate-600 dark:text-slate-400">
      {n}
    </span>
  );
}

function StepDetail({ task, headingId }: { task: SetupTask; headingId?: string }) {
  const copy = copyFor(task);
  return (
    <div data-testid={`setup-detail-${task.id}`} data-done={task.done ? 'true' : 'false'}>
      <div className="flex items-start justify-between gap-3">
        <h2 id={headingId} className="text-xl font-semibold text-gray-900 dark:text-slate-100">
          {task.done ? copy.doneTitle ?? copy.title : copy.title}
        </h2>
        {task.done && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
            <Check className="h-3 w-3" aria-hidden="true" />
            Done
          </span>
        )}
      </div>
      <p className="mt-2 max-w-prose text-sm text-gray-600 dark:text-slate-400">{copy.body}</p>
      <div className="my-6 h-32 max-w-sm rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        {copy.art}
      </div>
      <Link
        href={task.href}
        className={
          task.done
            ? 'inline-flex rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700'
            : 'inline-flex rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-gray-950 hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2'
        }
      >
        {task.done ? 'Review' : copy.cta}
      </Link>
    </div>
  );
}

export default function OnboardingChecklistPage() {
  const { guide, tasks, done, total, complete, dismiss } = useSetupGuide();
  const [picked, setPicked] = useState<SetupTaskId | null>(null);
  const [dismissing, setDismissing] = useState(false);

  if (!guide) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-8 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading checklist">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
      </div>
    );
  }

  const groups = GROUPS.map((g) => ({
    label: g.label,
    tasks: g.ids.map((id) => tasks.find((t) => t.id === id)).filter((t): t is SetupTask => !!t),
  })).filter((g) => g.tasks.length > 0);
  // Steps are numbered across groups, in list order.
  const ordered = groups.flatMap((g) => g.tasks);
  const order = ordered.map((t) => t.id);
  const selected =
    ordered.find((t) => t.id === picked) ?? ordered.find((t) => !t.done) ?? ordered[0];

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await dismiss();
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8" data-testid="onboarding-checklist">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-6 dark:border-slate-700">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Onboarding checklist</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            {complete
              ? "You're all set. Every step on this list is done."
              : 'Finish the core steps that get your store selling.'}
          </p>
        </div>
        {!guide.dismissedAt && (
          <button
            type="button"
            onClick={handleDismiss}
            disabled={dismissing}
            className="text-sm text-gray-500 hover:text-gray-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Dismiss checklist
          </button>
        )}
      </header>

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-[minmax(240px,300px)_1fr] md:gap-0">
        <nav aria-label="Onboarding steps" className="md:border-r md:border-gray-200 md:pr-8 md:dark:border-slate-700">
          {groups.map((group) => {
            const groupDone = group.tasks.filter((t) => t.done).length;
            return (
              <section key={group.label} className="mb-8 last:mb-0" aria-label={group.label}>
                <div className="mb-2 flex items-center justify-between px-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  <span>{group.label}</span>
                  <span aria-label={`${groupDone} of ${group.tasks.length} done`}>
                    {groupDone}/{group.tasks.length}
                  </span>
                </div>
                <ol className="space-y-1">
                  {group.tasks.map((task) => {
                    const isSelected = task.id === selected?.id;
                    const copy = copyFor(task);
                    return (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => setPicked(task.id)}
                          aria-current={isSelected ? 'step' : undefined}
                          data-testid={`setup-step-${task.id}`}
                          data-done={task.done ? 'true' : 'false'}
                          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                            isSelected
                              ? 'bg-accent-50 font-medium text-gray-900 dark:bg-accent-900/30 dark:text-slate-100'
                              : task.done
                                ? 'text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700'
                                : 'text-gray-900 hover:bg-gray-100 dark:text-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          <StepMarker task={task} n={order.indexOf(task.id) + 1} />
                          <span className="min-w-0">{copy.title}</span>
                        </button>
                        {isSelected && (
                          <div className="px-3 pb-4 pt-3 md:hidden">
                            <StepDetail task={task} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </nav>

        {selected && (
          <section className="hidden md:block md:pl-10" aria-live="polite" aria-labelledby="setup-detail-heading">
            <StepDetail task={selected} headingId="setup-detail-heading" />
          </section>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {done} of {total} steps done
      </p>
    </div>
  );
}
