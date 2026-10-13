'use client';

// What an approved vendor sees when they choose a space and pay (spec 056),
// inside the wizard's preview frame on Options and pricing: the public
// ChooseSpace over the form's options. Picking works; holding and paying
// answer that this is a preview, so nothing is held or charged.

import type { PublicForm } from '@/lib/applications';
import type { EventPageEvent } from '@/app/events/[eventId]/eventPage';
import { ApplyFrame, type ApplyEvent } from '@/app/events/[eventId]/apply/ApplyShell';
import ChooseSpace, { type SpaceApi } from '@/components/applications/ChooseSpace';
import { spacePreviewApplication } from './previewMessages';

const previewOnly = () => Promise.reject(new Error('This is a preview. Nothing is held or charged.'));
const spaceApi: SpaceApi = { select: previewOnly, pay: previewOnly, release: () => Promise.resolve() };
const noRefresh = () => Promise.resolve(null);

export default function SpacePreview({ event, form }: { event: EventPageEvent; form: PublicForm }) {
  const applyEvent: ApplyEvent = { ...event, date: event.date ?? '', status: event.status ?? 'DRAFT' } as ApplyEvent;
  const application = spacePreviewApplication(form, { id: event.id, name: event.name, date: event.date, timezone: event.venue?.timezone });
  return (
    <div onClickCapture={(e) => (e.target as Element).closest('a[href]') && e.preventDefault()}>
      <ApplyFrame event={applyEvent} title={form.name} kicker="Choose your space" preview>
        <div id="apply-summary">
          {form.tiers.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 dark:border-slate-600 dark:text-slate-400">
              Add an option to see what vendors choose from.
            </p>
          ) : (
            // Keyed by the options: an edit restarts the chooser on fresh choices.
            <ChooseSpace key={form.tiers.map((t) => `${t.id}:${t.price}`).join('|')} application={application} spaceApi={spaceApi} refresh={noRefresh} />
          )}
        </div>
      </ApplyFrame>
    </div>
  );
}
