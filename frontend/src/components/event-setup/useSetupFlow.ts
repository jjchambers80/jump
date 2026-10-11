'use client';

// State of one wizard visit (spec 050 §4, §8.1): the form fields, the current
// step (from ?step=, else the resume point), the save hook and the preview
// message. The page component only lays this out.
//
// Every built step's unsaved changes are saved together, so a change made on
// one step is never dropped by moving to another (browser Back included).

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { instantToZonedInput, zonedInputToIso } from '@/lib/eventTime';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { readSessionDraft, writeSessionDraft } from './sessionDraft';
import {
  EVENT_STEPS, isReachable, patchEvent, resumeKey, sameInstant, stepByKey, visibleSteps,
  type SavedEvent, type SetupFields, type StepCtx, type StepKey,
} from './steps';
import { PREVIEW_MESSAGE, type PreviewMessage, type PreviewOverlay } from './previewMessages';
import { toSaved, useSetupData } from './useSetupData';
import { useStepSave } from './useStepSave';
import type { OverviewEvent } from '@/lib/eventOverview';

export const EMPTY_FIELDS: SetupFields = { name: '', slug: '', venueId: '', date: '', endDate: '' };
const BUILT = EVENT_STEPS.filter((step) => step.built);

export function fieldsFromSaved(saved: SavedEvent, zone: string | null): SetupFields {
  return {
    name: saved.name,
    slug: saved.slug,
    venueId: saved.venueId,
    date: instantToZonedInput(saved.date, zone),
    endDate: instantToZonedInput(saved.endDate, zone),
  };
}

export function useSetupFlow(eventId: string | null) {
  const router = useRouter();
  const params = useSearchParams();
  const { selectedOrgId: orgId, loading: orgLoading } = useOrg();
  const data = useSetupData(orgId, orgLoading, eventId);
  const { saved, venues } = data;
  const [fields, setFields] = useState<SetupFields>(EMPTY_FIELDS);
  const [draftStep, setDraftStep] = useState<StepKey | null>(null);
  const [initialised, setInitialised] = useState(false);
  const [revision, setRevision] = useState(0);

  const zoneOf = (venueId: string) => venues.find((v) => v.id === venueId)?.timezone ?? null;
  const zone = zoneOf(fields.venueId);
  const savedZone = saved ? zoneOf(saved.venueId) : null;

  // Fill the form once: the server row, else this tab's draft, else ?venueId=.
  useEffect(() => {
    if (initialised || data.load.status !== 'ready' || !orgId) return;
    if (saved) setFields(fieldsFromSaved(saved, zoneOf(saved.venueId)));
    else {
      const draft = readSessionDraft(orgId);
      const preset = params.get('venueId') ?? '';
      if (draft) {
        const { step, requestKey: _key, ...rest } = draft;
        setFields(rest);
        setDraftStep(step);
      } else if (venues.some((v) => v.id === preset)) setFields({ ...EMPTY_FIELDS, venueId: preset });
    }
    setInitialised(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.load.status, initialised, orgId, saved]);

  const ctx: StepCtx = { saved, fields, zone, savedZone, forms: [] };
  const mode: 'create' | 'edit' = saved?.setupCompletedAt ? 'edit' : 'create';
  const list = visibleSteps(ctx);
  const requested = stepByKey(params.get('step'));
  const valid = !!requested && list.includes(requested) && isReachable(requested.key, ctx);
  const current: StepKey = valid ? requested.key : mode === 'edit' ? 'name' : resumeKey(ctx, saved ? saved.setupStep : draftStep);
  const step = stepByKey(current)!;
  const at = list.indexOf(step);

  const urlFor = (key: StepKey) => (saved ? `/admin/events/${saved.id}/setup?step=${key}` : `/admin/events/new?step=${key}`);

  // Each step is a URL (§11.4): put the resolved step in it, so Back works.
  useEffect(() => {
    if (initialised && !valid) router.replace(urlFor(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialised, valid, current]);

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
      const updated = await patchEvent(api, { orgId, eventId: saved.id }, patch);
      const next = toSaved(updated as OverviewEvent);
      data.setSaved(next);
      // The server owns the final slug; adopt it so the form matches.
      if ('slug' in patch) setFields((f) => ({ ...f, slug: next.slug }));
      setRevision((r) => r + 1);
    },
  });

  const unsaved = !!saved && ['dirty', 'saving', 'error', 'invalid'].includes(saveState.status);
  useUnsavedChanges(unsaved);

  const venue = venues.find((v) => v.id === fields.venueId);
  const iso = { date: zonedInputToIso(fields.date, zone), endDate: zonedInputToIso(fields.endDate, zone) };
  const overlay: PreviewOverlay = {};
  if (!saved || fields.name.trim() !== saved.name) overlay.name = fields.name;
  if (!saved || fields.venueId !== saved.venueId)
    overlay.venue = venue ? { id: venue.id, name: venue.name, address: venue.address, timezone: venue.timezone ?? undefined } : null;
  if (!saved || !sameInstant(iso.date, saved.date)) overlay.date = iso.date;
  if (!saved || !sameInstant(iso.endDate, saved.endDate)) overlay.endDate = iso.endDate;
  const preview: PreviewMessage = {
    type: PREVIEW_MESSAGE, orgId: orgId ?? '', eventId: saved?.id ?? null, overlay, revision, anchor: step.anchor,
  };

  return {
    orgId, data, fields, setFields, ctx, mode, list, current, step, at, zone, iso,
    saveState, unsaved, preview, initialised, urlFor, router,
  };
}

export type SetupFlow = ReturnType<typeof useSetupFlow>;
