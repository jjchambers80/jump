'use client';

// State of one wizard visit (spec 050 §4, §8.1): the form fields, the current
// step (from ?step=, else the resume point), the save hook and the preview
// message. The page component only lays this out.
//
// Every built step's unsaved changes are saved together, so a change made on
// one step is never dropped by moving to another (browser Back included).

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { instantToZonedInput, zonedInputToIso } from '@/lib/eventTime';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { readSessionDraft, writeSessionDraft } from './sessionDraft';
import {
  EVENT_STEPS, FORMER_STEPS, isReachable, patchEvent, resumeKey, sameInstant, stepByKey, visibleSteps,
  type SavedEvent, type SetupFields, type StepCtx, type StepKey,
} from './steps';
import { PREVIEW_MESSAGE, type PreviewMessage, type PreviewOverlay } from './previewMessages';
import type { EventVenue } from '@/app/events/[eventId]/eventPage';
import { toSaved, useSetupData } from './useSetupData';
import { useStepSave } from './useStepSave';
import { useSetupForms } from './useSetupForms';
import { useHistoryGuard, useLinkGuard } from './useHistoryGuard';
import { clearSetupFinished, setupJustFinished } from './doneMarker';
import { useDonationsEligible } from './useDonationsEligible';
import type { OverviewEvent } from '@/lib/eventOverview';
import type { AdminForm } from '@/lib/applications';
import { salesFieldsFromSaved } from './contentSteps';
import { formFlowHref, legacyFlowHref } from './formFlows';

export const EMPTY_FIELDS: SetupFields = { name: '', slug: '', venueId: '', date: '', endDate: '', type: 'LIVE', linkedEventId: '' };

/** Keeps what PATCH responses do not carry (lock, tax) when the saved row is replaced. */
export const mergeSaved = (prev: SavedEvent | null, next: SavedEvent): SavedEvent => ({
  ...next,
  admissionLock: next.admissionLock ?? prev?.admissionLock ?? null,
  tax: next.tax ?? prev?.tax,
  holders: next.holders ?? prev?.holders,
});
const BUILT = EVENT_STEPS.filter((step) => step.built);

export function fieldsFromSaved(saved: SavedEvent, zone: string | null): SetupFields {
  return {
    name: saved.name,
    slug: saved.slug,
    venueId: saved.venueId,
    date: instantToZonedInput(saved.date, zone),
    endDate: instantToZonedInput(saved.endDate, zone),
    type: saved.type ?? 'LIVE',
    linkedEventId: saved.linkedEventId ?? '',
    ...salesFieldsFromSaved(saved),
  };
}

export function useSetupFlow(eventId: string | null) {
  const router = useRouter();
  const params = useSearchParams();
  const { selectedOrgId: orgId, loading: orgLoading } = useOrg();
  const data = useSetupData(orgId, orgLoading, eventId);
  const { saved, venues } = data;
  const forms = useSetupForms(eventId);
  const [fields, setFields] = useState<SetupFields>(EMPTY_FIELDS);
  const [draftStep, setDraftStep] = useState<StepKey | null>(null);
  const [initialised, setInitialised] = useState(false);
  const [revision, setRevision] = useState(0);
  /** Location step (Venues off): the address as typed, before "Use this address" saves it. */
  const [draftVenue, setDraftVenue] = useState<EventVenue | null | undefined>(undefined);

  const zoneOf = (venueId: string) => venues.find((v) => v.id === venueId)?.timezone ?? null;
  const zone = zoneOf(fields.venueId);
  const savedZone = saved ? zoneOf(saved.venueId) : null;

  // Fill the form once: the server row, else this tab's draft, else ?venueId=.
  useEffect(() => {
    // Wait for the forms too: an old application step link needs them to find its flow.
    if (initialised || data.load.status !== 'ready' || !orgId || (eventId && forms.load.status === 'loading')) return;
    if (saved) {
      const zone = zoneOf(saved.venueId);
      const form = saved.type === 'REGISTRATION' ? forms.forms[0] : undefined;
      // A registration event's window lives on its form (created with the row).
      const formTimes = form ? { opensAt: instantToZonedInput(form.opensAt, zone), closesAt: instantToZonedInput(form.closesAt, zone) } : {};
      setFields({ ...fieldsFromSaved(saved, zone), ...formTimes });
    }
    else {
      const draft = readSessionDraft(orgId);
      const preset = params.get('venueId') ?? '';
      // Spec 057: "Create registration event" on a live event opens `?type=registration&linked=<id>`.
      const typed = params.get('type') === 'registration'
        ? { type: 'REGISTRATION' as const, linkedEventId: params.get('linked') ?? '' }
        : {};
      if (draft) {
        const { step, requestKey: _key, ...rest } = draft;
        setFields({ ...EMPTY_FIELDS, ...rest, ...typed });
        setDraftStep(step);
      } else setFields({ ...EMPTY_FIELDS, ...(venues.some((v) => v.id === preset) && { venueId: preset }), ...typed });
    }
    setInitialised(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.load.status, forms.load.status, initialised, orgId, saved]);

  const donationsEligible = useDonationsEligible(orgId);
  const ctx: StepCtx = { saved, fields, zone, savedZone, forms: forms.forms, donationsEligible };
  const mode: 'create' | 'edit' = saved?.setupCompletedAt ? 'edit' : 'create';
  const list = visibleSteps(ctx);
  const requested = stepByKey(params.get('step'));
  // Done is the create flow's last screen, not a counted step: only right after
  // Review finished this event in this tab (doneMarker). In edit mode it goes to Details.
  const doneOk = !!saved?.setupCompletedAt && setupJustFinished(saved.id);
  const valid = !!requested && (requested.key === 'done' ? doneOk : list.includes(requested) && isReachable(requested.key, ctx));
  const current: StepKey = valid ? requested.key : mode === 'edit' ? 'name' : resumeKey(ctx, saved ? saved.setupStep : draftStep);
  const step = stepByKey(current)!;
  const at = list.indexOf(step);

  const urlFor = (key: StepKey) => (saved ? `/admin/events/${saved.id}/setup?step=${key}` : `/admin/events/new?step=${key}`);

  // An application step link from before spec 051 (email, bookmark, readiness item): its flow now.
  const rawStep = params.get('step');
  const redirect = eventId && rawStep && FORMER_STEPS.has(rawStep)
    ? legacyFlowHref(eventId, rawStep, params.get('form'), params.get('org'))
    : saved && current === 'registration'
      // Spec 057: the registration form is set up in its flow, from Start.
      ? formFlowHref(saved.id, 'registration', { form: forms.forms[0]?.id, org: params.get('org') })
      : null;

  // Each step is a URL (§11.4): put the resolved step in it, so Back works.
  useEffect(() => {
    if (!initialised) return;
    if (redirect) return router.replace(redirect);
    if (valid) return;
    router.replace(requested?.key === 'done' && saved && mode === 'edit' ? `/admin/events/${saved.id}` : urlFor(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialised, valid, current, redirect]);
  // Leaving Done for a step ends the create flow: Done is not shown again.
  const lastStep = useRef(current);
  useEffect(() => {
    if (saved && lastStep.current === 'done' && current !== 'done') clearSetupFinished(saved.id);
    lastStep.current = current;
  }, [current, saved]);

  // Before the row exists, the form lives in this tab's session (§4).
  useEffect(() => {
    if (initialised && !saved && orgId) writeSessionDraft(orgId, { ...fields, step: current });
  }, [initialised, saved, orgId, fields, current]);

  const merged: Record<string, unknown> = saved ? Object.assign({}, ...BUILT.map((s) => s.payload?.(ctx) ?? {})) : {};
  const body = Object.keys(merged).length ? merged : null;
  const invalidCount = saved ? BUILT.flatMap((s) => s.validate?.(ctx) ?? []).length : 0;

  const saveState = useStepSave({
    autosave: saved?.status === 'DRAFT',
    body,
    invalidCount,
    save: async (patch) => {
      if (!orgId || !saved) return;
      // A registration event's window is its form's (steps.ts `formWindowOf`).
      const { formWindow, ...eventPatch } = patch as { formWindow?: { formId: string; opensAt: string | null; closesAt: string | null } };
      if (formWindow) {
        const { formId, ...times } = formWindow;
        forms.upsert(await api.patch<AdminForm>(`/admin/events/${encodeURIComponent(saved.id)}/application-forms/${encodeURIComponent(formId)}`, times));
        if (!Object.keys(eventPatch).length) return setRevision((r) => r + 1);
      }
      let updated: unknown;
      try {
        updated = await patchEvent(api, { orgId, eventId: saved.id }, eventPatch);
      } catch (err) {
        // Orders or RSVPs arrived since the page loaded: show the server's reason
        // on the Tickets step and go back to the saved mode (nothing left to retry).
        const e = err as { code?: string; message?: string };
        if (e?.code === 'ADMISSION_MODE_LOCKED') {
          data.setSaved((row) => (row ? { ...row, admissionLock: e.message || 'The admission mode can no longer change.' } : row));
          setFields((f) => ({ ...f, admissionMode: saved.admissionMode }));
        }
        throw err;
      }
      const next = mergeSaved(saved, toSaved(updated as OverviewEvent));
      // The server sanitises the description (gotcha 20); compare against what was
      // sent, or the editor's HTML would look unsaved forever.
      if ('description' in patch) next.description = (patch.description as string | null) ?? null;
      data.setSaved(next);
      // The server owns the final slug; adopt it so the form matches.
      if ('slug' in patch) setFields((f) => ({ ...f, slug: next.slug }));
      setRevision((r) => r + 1);
    },
  });

  const unsaved = !!saved && ['dirty', 'saving', 'error', 'invalid'].includes(saveState.status);
  useUnsavedChanges(unsaved);
  // Live edits wait for an explicit save; failed or invalid ones cannot be sent.
  const stuck = !!saved && (saveState.status === 'error' || saveState.status === 'invalid' || (saved.status !== 'DRAFT' && saveState.status === 'dirty'));
  useHistoryGuard(stuck, 'You have unsaved changes. Leave without saving?');
  useLinkGuard(stuck, 'You have unsaved changes. Leave without saving?');

  const venue = venues.find((v) => v.id === fields.venueId);
  const iso = { date: zonedInputToIso(fields.date, zone), endDate: zonedInputToIso(fields.endDate, zone) };
  const overlay: PreviewOverlay = {};
  if (!saved || fields.name.trim() !== saved.name) overlay.name = fields.name;
  if (draftVenue !== undefined) overlay.venue = draftVenue;
  else if (!saved || fields.venueId !== saved.venueId)
    overlay.venue = venue ? { id: venue.id, name: venue.name, address: venue.address, timezone: venue.timezone ?? undefined } : null;
  if (!saved || !sameInstant(iso.date, saved.date)) overlay.date = iso.date;
  if (!saved || !sameInstant(iso.endDate, saved.endDate)) overlay.endDate = iso.endDate;
  // Live as typed; the frame sanitises it (previewHtml.ts) until the save reloads the server's copy.
  if ((fields.description ?? '') !== (saved?.description ?? '')) overlay.description = fields.description || null;
  if (saved && fields.admissionMode && fields.admissionMode !== saved.admissionMode) overlay.admissionMode = fields.admissionMode;
  if (!saved && fields.type) overlay.type = fields.type;
  const preview: PreviewMessage = {
    type: PREVIEW_MESSAGE, orgId: orgId ?? '', eventId: saved?.id ?? null, overlay, revision, anchor: step.anchor,
  };

  return {
    orgId, data, forms, fields, setFields, ctx, mode, list, current, step, at, zone, iso,
    saveState, unsaved, preview, initialised, urlFor, router,
    /** Leaving for an application flow: show nothing of the event steps. */
    redirecting: !!redirect,
    /** After a dialog or upload saved on its own: the frame reloads the event. */
    refreshPreview: () => setRevision((r) => r + 1),
    setDraftVenue,
    setAddOnCount: data.setAddOnCount,
    setMapStatus: data.setMapStatus,
  };
}

export type SetupFlow = ReturnType<typeof useSetupFlow>;
