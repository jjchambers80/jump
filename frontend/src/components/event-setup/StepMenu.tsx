'use client';

// "Jump to edit…" (spec 050 §11.4): a <nav> list of links, Tab order = list
// order, each link naming its state. A 240 px rail in edit mode from xl; a
// sheet behind the menu button everywhere else (focus starts on the current
// step, Escape closes, focus returns to the button).

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '@/lib/useDialog';
import { StepStateIcon, stateText } from './SetupProgress';
import type { EventStep, StepKey, StepState } from './steps';
import { iconButton } from './ui';

export interface MenuItem {
  step: EventStep;
  state: StepState;
  href: string;
  reachable: boolean;
}

function StepLinks({ items, onGo }: { items: MenuItem[]; onGo: (key: StepKey) => void }) {
  return (
    <nav aria-label="Jump to edit">
      <ul className="space-y-1">
        {items.map(({ step, state, href, reachable }) => {
          const base = 'flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-sm';
          const label = (
            <>
              <StepStateIcon state={state} />
              <span className="min-w-0 flex-1 truncate">{step.title}</span>
            </>
          );
          return (
            <li key={step.key}>
              {reachable ? (
                <a
                  href={href}
                  aria-current={state === 'current' ? 'step' : undefined}
                  // The visible title first (label in name), then its state.
                  aria-label={state === 'current' ? undefined : `${step.title}, ${stateText(state)}`}
                  data-step-link={step.key}
                  onClick={(event) => {
                    event.preventDefault();
                    onGo(step.key);
                  }}
                  className={`${base} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                    state === 'current'
                      ? 'bg-gray-100 font-semibold text-gray-900 dark:bg-slate-800 dark:text-white'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {label}
                </a>
              ) : (
                <span className={`${base} text-gray-600 dark:text-slate-400`}>
                  {label}
                  <span className="sr-only">(available after the date step)</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function StepRail({ items, onGo }: { items: MenuItem[]; onGo: (key: StepKey) => void }) {
  return (
    <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 xl:block">
      <StepLinks items={items} onGo={onGo} />
    </aside>
  );
}

export function StepMenuSheet({
  items,
  onGo,
  onClose,
}: {
  items: MenuItem[];
  onGo: (key: StepKey) => void;
  onClose: () => void;
}) {
  const panelRef = useDialog<HTMLDivElement>(true, onClose);
  // useDialog focused the first control; start on the current step instead.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[aria-current="step"]')?.focus();
  }, [panelRef]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-slate-900/40" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-step-menu-title"
        className="relative flex h-full w-full max-w-xs flex-col bg-white shadow-sm motion-safe:animate-slide-in-left dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-slate-700">
          <h2 id="setup-step-menu-title" className="text-sm font-semibold text-gray-900 dark:text-white">
            Setup steps
          </h2>
          <button type="button" onClick={onClose} aria-label="Close setup steps" className={iconButton}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <StepLinks
            items={items}
            onGo={(key) => {
              onClose();
              onGo(key);
            }}
          />
        </div>
      </div>
    </div>
  );
}
