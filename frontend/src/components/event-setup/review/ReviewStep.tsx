'use client';

// Step 13, Review and publish (spec 050 §5.1 `review`, card 050-N). Reads
// readiness, forms and tax (useReviewData); Publish sends `openFormIds` and
// hands the per-form results to Done; Save as draft (create mode) marks setup
// complete with PATCH {setupCompleted:true}. A 422 EVENT_NOT_READY shows the
// focused error summary (PublishBlockers) with links to each step.

import { useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import PublishBlockers from '@/components/events/PublishBlockers';
import EventTaxSummary from '@/components/events/EventTaxSummary';
import { publishBlockers, wizardReadinessHref, type ReadinessItem } from '@/lib/eventReadiness';
import type { OverviewEvent } from '@/lib/eventOverview';
import type { SavedEvent } from '../steps';
import { secondaryButton } from '../ui';
import { useReviewData } from './useReviewData';
import ReadinessChecklist from './ReadinessChecklist';
import ReviewForms, { formLockReason } from './ReviewForms';
import BrandSummary from './BrandSummary';
import DonationSuggestion from './DonationSuggestion';
import ReviewActions from './ReviewActions';
import { setPublishOutcome, type FormResult } from './publishOutcome';

export interface ReviewStepProps {
  orgId: string;
  saved: SavedEvent;
  createMode: boolean;
  /** Saves pending edits from earlier steps; false when that failed. */
  flush: () => Promise<boolean>;
  /** The updated row after Publish or Save as draft; the wizard moves to Done. */
  onFinished: (row: OverviewEvent) => void;
  /** True while Publish / Save as draft is in flight: the shell holds Back and the step menu. */
  onBusyChange?: (busy: boolean) => void;
}

const card = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:p-6';

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the review" className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
      ))}
    </div>
  );
}

export default function ReviewStep({ orgId, saved, createMode, flush, onFinished, onBusyChange }: ReviewStepProps) {
  const { load, preview, reload, reloadPreview } = useReviewData(orgId, saved.id);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [blockers, setBlockers] = useState<ReadinessItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'publish' | 'draft' | null>(null);
  // A result that lands after the organizer left Review must not pull them to Done.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onBusyChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => onBusyChange?.(!!busy), [busy, onBusyChange]);

  // Every draft form that can open starts ticked (§3); set once, not on a readiness reload.
  useEffect(() => {
    if (load.status !== 'ready' || selected) return;
    const { forms } = load.overview.applications;
    setSelected(new Set(forms.filter((f) => f.status === 'DRAFT' && !formLockReason(f, load.readiness.warnings)).map((f) => f.id)));
  }, [load, selected]);

  if (load.status === 'loading') return <Skeleton />;
  if (load.status === 'error')
    return (
      <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
        <p>Couldn&apos;t load the review: {load.message}</p>
        <button type="button" onClick={reload} className={`${secondaryButton} mt-3`}>
          Try again
        </button>
      </div>
    );

  const { readiness, overview } = load;
  const forms = overview.applications.forms;
  const event = overview.event;
  const chosen = selected ?? new Set<string>();
  const base = `/organizations/${orgId}/events/${encodeURIComponent(saved.id)}`;

  async function submit(kind: 'publish' | 'draft') {
    setBusy(kind);
    setError(null);
    setBlockers([]);
    try {
      if (!(await flush())) {
        setError('Your latest changes are not saved yet. Save them, then try again.');
        return;
      }
      if (kind === 'draft') {
        setPublishOutcome(null);
        const row = await api.patch<OverviewEvent>(base, { setupCompleted: true });
        if (mounted.current) onFinished(row);
        return;
      }
      // Re-checked at send time: a reload after a 422 can lock a form that was ticked.
      const openFormIds = forms.filter((f) => chosen.has(f.id) && f.status === 'DRAFT' && !formLockReason(f, readiness.warnings)).map((f) => f.id);
      const row = await api.post<OverviewEvent & { formResults?: FormResult[] }>(`${base}/publish`, { openFormIds });
      const names = new Map(forms.map((f) => [f.id, f.name]));
      setPublishOutcome({ eventId: saved.id, results: (row.formResults ?? []).map((r) => ({ ...r, name: names.get(r.formId) ?? 'A form' })) });
      if (mounted.current) onFinished(row);
    } catch (err) {
      const refused = publishBlockers(err);
      if (refused) {
        setBlockers(refused);
        reload();
      } else setError(`Couldn't ${kind === 'publish' ? 'publish' : 'save'} the event. ${(err as Error)?.message || 'Try again.'}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <PublishBlockers blockers={blockers} eventId={saved.id} orgId={orgId} hrefFor={(item) => wizardReadinessHref(item, saved.id)} />
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      <ReadinessChecklist readiness={readiness} eventId={saved.id} />
      {event.admissionMode === 'TICKETED' && event.tax && (
        <section aria-labelledby="review-tax" className={card}>
          <h2 id="review-tax" className="text-base font-semibold text-gray-900 dark:text-white">
            Sales tax
          </h2>
          <EventTaxSummary tax={event.tax} className="mt-1 text-sm" />
        </section>
      )}
      <ReviewForms
        forms={forms}
        warnings={readiness.warnings}
        selected={chosen}
        published={saved.status !== 'DRAFT'}
        eventId={saved.id}
        onToggle={(id, open) =>
          setSelected((prev) => {
            const next = new Set(prev ?? []);
            if (open) next.add(id);
            else next.delete(id);
            return next;
          })
        }
      />
      <BrandSummary />
      <DonationSuggestion eventId={saved.id} />
      <ReviewActions
        status={saved.status}
        createMode={createMode}
        busy={busy}
        onPublish={() => void submit('publish')}
        onSaveDraft={() => void submit('draft')}
        preview={preview}
        onRetryPreview={reloadPreview}
        eventId={saved.id}
      />
    </div>
  );
}
