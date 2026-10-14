'use client';

// "Add to this event" (spec 051): the four application flows, started from
// the event's Overview (and the wizard's Done screen). Event setup stays
// short; vendors, special guests, volunteers and other applications are each
// their own task. Links, one per flow. An event has one form per flow
// (spec 056), so a tile never counts forms; Special guests says how many
// guests are in the lineup.

import Link from 'next/link';
import { ChevronRight, FileText, HandHeart, Sparkles, Store, type LucideIcon } from 'lucide-react';
import { useCan } from '@/components/OrgContext';
import { APPLICATION_STEPS } from '@/components/event-setup/applicationSteps';
import type { FormFlowKey } from '@/components/event-setup/formFlows';
import { OverviewSection } from './EventOverviewSections';

export const ADD_TO_EVENT: { flow: FormFlowKey; title: string; icon: LucideIcon; detail: string }[] = [
  { flow: 'vendors', title: APPLICATION_STEPS.vendors.addLabel, icon: Store, detail: 'Vendors apply for a space, then choose it and pay.' },
  // The flow starts at the lineup; the application form is optional.
  { flow: 'special-guests', title: 'Add special guests', icon: Sparkles, detail: 'Your lineup, and an optional form for guests to apply.' },
  { flow: 'volunteers', title: APPLICATION_STEPS.volunteers.addLabel, icon: HandHeart, detail: 'People sign up to help.' },
  { flow: 'other-applications', title: APPLICATION_STEPS['other-applications'].addLabel, icon: FileText, detail: 'Sponsors, press, panels and anything else.' },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What is already there: only the lineup size, on Special guests. */
const summary = (flow: FormFlowKey, guests: number | null) => (flow === 'special-guests' && guests ? `${plural(guests, 'guest')} in the lineup` : '');

export const addTile =
  'group flex h-full min-h-16 w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-accent-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-accent-400/60 dark:hover:bg-slate-700/60 dark:focus-visible:ring-offset-slate-800';

export function AddToEventCard({
  hrefFor,
  guests,
  delay,
}: {
  hrefFor: (flow: FormFlowKey) => string;
  /** Lineup size; null while loading or unknown. */
  guests: number | null;
  delay?: number;
}) {
  const canEdit = useCan('applications.forms');
  if (!canEdit) return null;
  return (
    <OverviewSection id="add-to-event" title="Add to this event" delay={delay}>
      <p className="text-sm text-gray-600 dark:text-slate-400">Set up each one on its own, step by step.</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {ADD_TO_EVENT.map(({ flow, title, icon: Icon, detail }) => {
          const id = `add-to-event-${flow}`;
          const already = summary(flow, guests);
          return (
            <li key={flow}>
              <Link href={hrefFor(flow)} aria-describedby={`${id}-detail`} className={addTile} data-testid={id}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-800 dark:bg-slate-700 dark:text-accent-300">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
                  <span id={`${id}-detail`} className="mt-0.5 block text-xs text-gray-600 dark:text-slate-300">
                    {detail}
                    {already && <span className="mt-1 block font-medium text-gray-800 dark:text-slate-200">{already}</span>}
                  </span>
                </span>
                <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-gray-400 group-hover:text-gray-600 dark:text-slate-500" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </OverviewSection>
  );
}
