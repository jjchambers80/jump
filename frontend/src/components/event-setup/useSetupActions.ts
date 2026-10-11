'use client';

// What the footer, header and step menu do (spec 050 §4, §11.4, §11.5).
// Next validates first and, on failure, raises the error summary (focused);
// before the row exists Next on the date step creates the draft once
// (Idempotency-Key from the session draft); after that Next saves and moves on.

import { useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { clearSessionDraft, ensureRequestKey } from './sessionDraft';
import { FIELD_IDS, sameInstant, stepByKey, visibleSteps, type FieldError, type StepKey } from './steps';
import { focusAfterStepChange } from './stepFocus';
import type { SetupFlow } from './useSetupFlow';
import { toSaved } from './useSetupData';
import type { OverviewEvent } from '@/lib/eventOverview';

const SERVER_FIELDS: Record<string, string> = {
  name: FIELD_IDS.name,
  slug: FIELD_IDS.slug,
  venueId: FIELD_IDS.venueId,
  date: FIELD_IDS.date,
  endDate: FIELD_IDS.endDate,
};

/** API error → summary entries; a taken URL sends the organizer back to the Name step. */
export function serverErrors(err: { status?: number; message?: string; details?: unknown }): FieldError[] {
  if (err?.status === 409) return [{ field: FIELD_IDS.slug, step: 'name', message: err.message || 'This URL is taken. Choose another.' }];
  const details = Array.isArray(err?.details) ? (err.details as { field?: string; message?: string }[]) : [];
  const mapped = details
    .filter((d) => d.field && SERVER_FIELDS[d.field])
    .map((d) => ({ field: SERVER_FIELDS[d.field!], message: d.message || 'Check this field' }));
  if (mapped.length) return mapped;
  const reason = err?.status === 403 ? "You don't have access to create events here." : err?.message || 'Something went wrong.';
  return [{ field: FIELD_IDS.date, message: `Couldn't create the event. ${reason}` }];
}

interface CreatedRow {
  id: string;
  name: string;
  date: string | null;
  endDate?: string | null;
  venue?: { id: string } | null;
}

/**
 * A replayed create (same Idempotency-Key, e.g. after a lost response) returns
 * the first row as it was. If the organizer changed anything since, PATCH the
 * difference, so what they see is what was saved.
 */
async function reconcileReplay(
  orgId: string,
  row: CreatedRow,
  sent: { name: string; venueId: string; date: string | null; endDate: string | null }
) {
  const body: Record<string, unknown> = {};
  if (row.name !== sent.name) body.name = sent.name;
  if (row.venue?.id !== sent.venueId) body.venueId = sent.venueId;
  if (!sameInstant(row.date, sent.date)) body.date = sent.date;
  if (!sameInstant(row.endDate ?? null, sent.endDate)) body.endDate = sent.endDate;
  if (Object.keys(body).length) await api.patch(`/organizations/${orgId}/events/${encodeURIComponent(row.id)}`, body);
}

const dedupe = (list: FieldError[]) => list.filter((e, i) => list.findIndex((o) => o.field === e.field) === i);

/** Name and venue problems, each linked to its own step. */
const clientErrors = (ctx: SetupFlow['ctx']) =>
  (['name', 'venue'] as const).flatMap((key) => (stepByKey(key)?.validate?.(ctx) ?? []).map((e) => ({ ...e, step: key })));

export function useSetupActions(flow: SetupFlow) {
  const { orgId, ctx, current, step, list, at, saveState, router, urlFor, fields, iso, mode } = flow;
  const saved = ctx.saved;
  const [showErrors, setShowErrors] = useState(false);
  const [apiErrors, setApiErrors] = useState<FieldError[]>([]);
  const [creating, setCreating] = useState(false);
  const [summaryTick, setSummaryTick] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (summaryTick) summaryRef.current?.focus();
  }, [summaryTick]);
  // An edit clears the server's verdict; the live checks keep running.
  useEffect(() => setApiErrors([]), [fields]);

  const live = showErrors ? step.validate?.(ctx) ?? [] : [];
  // The summary lists every problem (links open other steps); inline messages
  // keep the server's verdict on its field after the summary closes.
  const summary = showErrors ? dedupe([...live, ...apiErrors]) : [];
  const inline = dedupe([...live, ...apiErrors]);
  const raise = (list: FieldError[]) => {
    setApiErrors(list);
    setShowErrors(true);
    setSummaryTick((n) => n + 1);
  };

  const go = (key: StepKey, field?: string) => {
    // Moving between steps saves a DRAFT; a live event keeps its edits pending
    // until Save / Next / Save & exit (§11.5). Nothing is lost: every built
    // step's changes stay in the form and in the next save body.
    if (saved?.status === 'DRAFT') void saveState.flush();
    setShowErrors(false);
    if (field) focusAfterStepChange({ field });
    router.push(urlFor(key));
  };
  const prev = at > 0 ? list[at - 1] : null;
  const next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;

  async function create() {
    if (!orgId) return;
    setCreating(true);
    const requestKey = ensureRequestKey(orgId, { ...fields, step: 'date' });
    const sent = { name: fields.name.trim(), venueId: fields.venueId, date: iso.date, endDate: iso.endDate };
    try {
      const created = await api.post<CreatedRow>(
        `/organizations/${orgId}/events`,
        {
          setup: true, name: sent.name, slug: fields.slug || undefined, venueId: sent.venueId,
          date: sent.date, ...(sent.endDate ? { endDate: sent.endDate } : {}), admissionMode: 'TICKETED',
        },
        { headers: { 'Idempotency-Key': requestKey } }
      );
      await reconcileReplay(orgId, created, sent);
      clearSessionDraft(orgId);
      focusAfterStepChange();
      router.replace(`/admin/events/${created.id}/setup?step=description`);
    } catch (err) {
      setCreating(false);
      raise(serverErrors(err as never));
    }
  }

  async function onNext() {
    const failed = step.validate?.(ctx) ?? [];
    if (failed.length) return raise([]);
    // The create needs steps 1–2 as well, which the step menu lets one skip past.
    const earlier = !saved && current === 'date' ? clientErrors(ctx) : [];
    if (earlier.length) return raise(earlier);
    setShowErrors(false);
    if (!saved) return current === 'date' ? create() : next && router.push(urlFor(next.key));
    if (!(await saveState.flush())) return;
    // Record the furthest step reached while the create flow runs (resume point).
    const order = visibleSteps(ctx).map((s) => s.key as string);
    if (mode === 'create' && next && order.indexOf(next.key) > order.indexOf(saved.setupStep ?? '')) {
      api
        .patch<OverviewEvent>(`/organizations/${orgId}/events/${saved.id}`, { setupStep: next.key })
        .then((row) => flow.data.setSaved(toSaved(row)))
        // A missed resume point only costs a step on the next visit.
        .catch(() => undefined);
    }
    if (next) router.push(urlFor(next.key));
    else await onExit();
  }

  async function onExit() {
    if (!saved) {
      const typed = !!(fields.name || fields.venueId || fields.date);
      if (typed && !window.confirm('Discard this event?')) return;
      if (orgId) clearSessionDraft(orgId);
      router.push('/admin/events');
      return;
    }
    const ok = await saveState.flush();
    if (!ok && !window.confirm('Your latest changes are not saved. Leave anyway?')) return;
    router.push(`/admin/events/${saved.id}`);
  }

  return {
    summary,
    inline,
    summaryRef,
    creating,
    go,
    onNext,
    onExit,
    onBack: prev ? () => go(prev.key) : undefined,
    onSkip: next && step.rule !== 'R' && !step.complete(ctx) ? () => go(next.key) : undefined,
    onSave: saved && saved.status === 'PUBLISHED' ? () => void saveState.flush() : undefined,
    nextLabel: creating ? 'Creating…' : next ? 'Next' : 'Save & exit',
  };
}
