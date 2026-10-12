'use client';

// The application form inside the wizard's preview frame (spec 051): the
// public apply page's frame and body over the form being built, so the
// organizer sees each change as applicants will. Nothing submits, and links
// stay put: a click never navigates the preview iframe.

import type { FormEvent } from 'react';
import type { PublicForm } from '@/lib/applications';
import type { EventPageEvent } from '@/app/events/[eventId]/eventPage';
import { ApplyFrame, type ApplyEvent } from '@/app/events/[eventId]/apply/ApplyShell';
import ApplyFormBody from '@/components/applications/ApplyFormBody';
import { useApplyForm } from '@/components/applications/ApplySteps';

const noSubmit = (e: FormEvent) => e.preventDefault();

export default function ApplyFormPreview({ event, form }: { event: EventPageEvent; form: PublicForm }) {
  const apply = useApplyForm(form, { submitUrl: '' });
  const applyEvent: ApplyEvent = { ...event, date: event.date ?? '', status: event.status ?? 'DRAFT' } as ApplyEvent;
  return (
    <div onClickCapture={(e) => (e.target as Element).closest('a[href]') && e.preventDefault()}>
      <ApplyFrame event={applyEvent} title={form.name} kicker="Application" width="wide" preview>
        <ApplyFormBody form={form} apply={apply} onSubmit={noSubmit} preview />
      </ApplyFrame>
    </div>
  );
}
