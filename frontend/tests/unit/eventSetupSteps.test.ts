// Spec 050 §5.1 step registry: visibility, counting, resume and state, plus
// key parity with the backend's EVENT_SETUP_STEPS via the shared fixture.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  EVENT_STEPS, FIELD_IDS, isReachable, neighbours, registrationFlowSteps, resumeKey, stepByKey, stepPosition, visibleSteps, wizardProgress,
  type SavedEvent, type StepCtx,
} from '@/components/event-setup/steps';
import { PREVIEW_MESSAGE, isPreviewMessage } from '@/components/event-setup/previewMessages';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../../backend/tests/fixtures/eventSetupSteps.fixtures.json'), 'utf8'));

const ZONE = 'America/New_York';
const NOW = new Date('2030-01-01T12:00:00Z');
const fields = { name: '', slug: '', venueId: '', date: '', endDate: '' };
const row = (patch: Partial<SavedEvent> = {}): SavedEvent => ({
  id: 'e1', name: 'Fair', slug: 'fair', venueId: 'v1', date: '2030-06-01T20:00:00.000Z', endDate: null,
  status: 'DRAFT', admissionMode: 'TICKETED', setupStep: null, setupCompletedAt: null, ...patch,
});
const ctx = (patch: Partial<StepCtx> = {}): StepCtx => ({ saved: null, fields, zone: ZONE, savedZone: ZONE, forms: [], now: NOW, ...patch });
const keys = (c: StepCtx) => visibleSteps(c).map((s) => s.key);

describe('keys', () => {
  test('match the backend EVENT_SETUP_STEPS (reserved slots excluded)', () => {
    expect(EVENT_STEPS.filter((s) => !s.reserved).map((s) => s.key)).toEqual(fixture.keys);
  });

  test('reserved slots exist but never show', () => {
    const reserved = EVENT_STEPS.filter((s) => s.reserved).map((s) => s.key);
    expect(reserved).toEqual(['attendee-questions', 'discounts', 'reminders']);
    for (const key of reserved) expect(keys(ctx({ saved: row() }))).not.toContain(key);
  });
});

describe('visible and counting', () => {
  test('a new live event has 9 steps: type first; applications are their own flows (spec 051)', () => {
    expect(keys(ctx())).toEqual(['type', 'name', 'venue', 'date', 'description', 'image', 'tickets', 'collect-more', 'review']);
    expect(stepPosition('date', ctx())).toEqual({ index: 4, total: 9 });
  });

  test('a registration event swaps tickets for its form flow and has no Describe step (spec 057)', () => {
    const reg = { ...fields, type: 'REGISTRATION' as const };
    // A free form (or none yet) sells no add-ons: no Collect more.
    expect(keys(ctx({ fields: reg }))).toEqual(['type', 'name', 'venue', 'date', 'image', 'registration', 'review']);
    expect(keys(ctx({ fields: reg, forms: [{ id: 'f', kind: 'PAID' }] }))).toEqual(['type', 'name', 'venue', 'date', 'image', 'registration', 'collect-more', 'review']);
    const saved = row({ type: 'REGISTRATION' });
    expect(keys(ctx({ saved }))).toContain('registration');
    expect(keys(ctx({ saved }))).not.toContain('tickets');
  });

  test('one count across a registration event and its form flow (spec 057)', () => {
    const saved = row({ type: 'REGISTRATION' });
    const free = ctx({ saved, forms: [{ id: 'f', kind: 'FREE' }] });
    const flow = registrationFlowSteps(free).map((s) => s.key);
    expect(flow).toEqual(['questions', 'start']);
    // 5 event steps, 2 flow steps, Review (a free form has no Collect more).
    expect(wizardProgress(free, 'image', 0, 2)).toEqual({ index: 5, total: 8 });
    expect(wizardProgress(free, null, 0, 2)).toEqual({ index: 6, total: 8 });
    expect(wizardProgress(free, null, 1, 2)).toEqual({ index: 7, total: 8 });
    expect(wizardProgress(free, 'review', 0, 2)).toEqual({ index: 8, total: 8 });
    // Add-ons already on a free registration keep the step, so they stay editable.
    const withAddOns = ctx({ saved: row({ type: 'REGISTRATION', addOnCount: 1 }), forms: [{ id: 'f', kind: 'FREE' }] });
    expect(wizardProgress(withAddOns, 'review', 0, 2)).toEqual({ index: 9, total: 9 });
    expect(wizardProgress(ctx(), 'review')).toEqual({ index: 9, total: 9 });
  });

  test('a registration form sells a floor map only when linked to a live event', () => {
    const forms = [{ id: 'f', kind: 'PAID', spaceSelection: 'MAP' as const }];
    expect(registrationFlowSteps({ saved: row({ type: 'REGISTRATION' }), forms }).map((s) => s.key)).not.toContain('floor-map');
    expect(registrationFlowSteps({ saved: row({ type: 'REGISTRATION', linkedEventId: 'live' }), forms }).map((s) => s.key)).toContain('floor-map');
  });

  test('the type step is reachable before the row', () => {
    expect(isReachable('type', ctx())).toBe(true);
  });

  test('the count does not move once the row exists', () => {
    expect(stepPosition('date', ctx())).toEqual(stepPosition('date', ctx({ saved: row() })));
  });

  test('Collect more shows for RSVP events too (050-O: old editor parity)', () => {
    const rsvp = row({ admissionMode: 'RSVP' });
    expect(keys(ctx({ saved: rsvp }))).toContain('collect-more');
    expect(keys(ctx({ saved: rsvp, donationsEligible: true }))).toContain('collect-more');
  });

  test('a MAP form adds no event step: the floor map is in the form flow', () => {
    expect(keys(ctx({ saved: row(), forms: [{ id: 'f', spaceSelection: 'MAP' }] }))).not.toContain('floor-map');
  });

  test('later steps need the server row', () => {
    expect(isReachable('date', ctx())).toBe(true);
    expect(isReachable('description', ctx())).toBe(false);
    expect(isReachable('description', ctx({ saved: row() }))).toBe(true);
  });

  test('neighbours skip hidden steps', () => {
    const c = ctx({ saved: row() });
    expect(neighbours('collect-more', c).next?.key).toBe('review');
    expect(neighbours('type', c).prev).toBeNull();
    expect(neighbours('name', c).prev?.key).toBe('type');
    expect(neighbours('review', c).next).toBeNull();
  });
});

describe('resume key', () => {
  test('no row and no draft starts at type; a draft resumes its step', () => {
    expect(resumeKey(ctx(), null)).toBe('type');
    expect(resumeKey(ctx(), 'date')).toBe('date');
  });

  test('a fresh row resumes after the date step that created it', () => {
    expect(resumeKey(ctx({ saved: row() }), null)).toBe('description');
  });

  test('a draft saved on a former application step resumes at Review (spec 051)', () => {
    for (const old of ['vendors', 'floor-map', 'special-guests', 'volunteers', 'other-applications']) {
      expect(resumeKey(ctx({ saved: row() }), old)).toBe('review');
    }
  });

  test('a saved step resumes there', () => {
    expect(resumeKey(ctx({ saved: row() }), 'tickets')).toBe('tickets');
  });

  test('an unknown key falls back to the first step', () => {
    expect(resumeKey(ctx({ saved: row() }), 'nope')).toBe('type');
  });
});

describe('validation and payloads', () => {
  test('name is required', () => {
    expect(stepByKey('name')!.validate!(ctx())).toEqual([{ field: FIELD_IDS.name, message: 'Enter a name for your event' }]);
  });

  test('date needs a venue, a future start and an end after it', () => {
    const date = stepByKey('date')!;
    expect(date.validate!(ctx()).map((e) => e.field)).toEqual([FIELD_IDS.venueId, FIELD_IDS.date]);
    const past = { ...fields, venueId: 'v1', date: '2029-01-01T10:00' };
    expect(date.validate!(ctx({ fields: past }))[0].message).toMatch(/future/);
    const backwards = { ...fields, venueId: 'v1', date: '2030-06-01T16:00', endDate: '2030-06-01T15:00' };
    expect(date.validate!(ctx({ fields: backwards }))).toEqual([{ field: FIELD_IDS.endDate, message: 'End time must be after the start time' }]);
  });

  test('date payload is in the venue zone and only what changed', () => {
    const saved = row();
    const same = { ...fields, venueId: 'v1', date: '2030-06-01T16:00' };
    expect(stepByKey('date')!.payload!(ctx({ saved, fields: same }))).toBeNull();
    const later = { ...same, endDate: '2030-06-01T20:00' };
    expect(stepByKey('date')!.payload!(ctx({ saved, fields: later }))).toEqual({ endDate: '2030-06-02T00:00:00.000Z' });
  });

  test('a venue change re-anchors the typed time to the new zone', () => {
    const saved = row();
    const moved = { ...fields, name: 'Fair', venueId: 'v2', date: '2030-06-01T16:00' };
    expect(stepByKey('venue')!.payload!(ctx({ saved, fields: moved, zone: 'America/Chicago' }))).toEqual({
      venueId: 'v2',
      date: '2030-06-01T21:00:00.000Z',
    });
  });

  test("a registration event's link to its live event saves with Where is it?", () => {
    const saved = row({ type: 'REGISTRATION', linkedEventId: null });
    const linked = { ...fields, name: 'Fair', venueId: 'v1', date: '2030-06-01T16:00', type: 'REGISTRATION' as const, linkedEventId: 'live' };
    expect(stepByKey('venue')!.payload!(ctx({ saved, fields: linked }))).toEqual({ linkedEventId: 'live' });
    expect(stepByKey('venue')!.payload!(ctx({ saved: { ...saved, linkedEventId: 'live' }, fields: { ...linked, linkedEventId: '' } }))).toEqual({ linkedEventId: null });
    expect(stepByKey('name')!.payload!(ctx({ saved, fields: linked }))).toBeNull();
  });
});

describe('complete (Skip for now shows only on an empty optional step)', () => {
  test('Collect more is complete with an add-on', () => {
    const at = (addOnCount?: number) => stepByKey('collect-more')!.complete(ctx({ saved: row({ addOnCount }) }));
    expect(at(2)).toBe(true);
    expect(at(0)).toBe(false);
    expect(at()).toBe(false);
  });
});

describe('preview messages', () => {
  const ok = { type: PREVIEW_MESSAGE, orgId: 'org-1', eventId: 'evt_1', overlay: { name: 'A', venue: null }, revision: 0, anchor: 'event-hero' };
  test('accepts the wizard shape', () => {
    expect(isPreviewMessage(ok)).toBe(true);
    expect(isPreviewMessage({ ...ok, eventId: null })).toBe(true);
  });
  test.each([
    ['a path in the org id', { orgId: '../admin' }],
    ['a slash in the event id', { eventId: 'a/b' }],
    ['a selector as anchor', { anchor: '#x y' }],
    ['a non-number revision', { revision: '1' }],
    ['a non-string name', { overlay: { name: 1 } }],
    ['a malformed venue', { overlay: { venue: { id: 1 } } }],
  ])('refuses %s', (_label, patch) => {
    expect(isPreviewMessage({ ...ok, ...patch })).toBe(false);
  });
});

describe('registration window on "When is it?"', () => {
  const date = stepByKey('date')!;
  const saved = row({ type: 'REGISTRATION', date: '2030-06-01T20:00:00.000Z' });
  const at = (opensAt: string, closesAt: string, forms: StepCtx['forms']) =>
    ctx({ saved, forms, fields: { ...fields, venueId: 'v1', date: '2030-06-01T16:00', opensAt, closesAt } });
  const form = { id: 'f1', kind: 'FREE', opensAt: '2030-05-01T13:00:00.000Z', closesAt: null };

  test('saves a changed window to the form, not the event', () => {
    expect(date.payload!(at('2030-05-01T09:00', '', [form]))).toBeNull();
    expect(date.payload!(at('2030-05-01T09:00', '2030-05-30T17:00', [form]))).toEqual({
      formWindow: { formId: 'f1', opensAt: '2030-05-01T13:00:00.000Z', closesAt: '2030-05-30T21:00:00.000Z' },
    });
    // No form yet (an older draft): nothing to save it to.
    expect(date.payload!(at('2030-05-01T09:00', '', []))).toBeNull();
  });

  test('closes must come after opens', () => {
    expect(date.validate!(at('2030-05-30T09:00', '2030-05-01T09:00', [form]))).toEqual([{ field: FIELD_IDS.closesAt, message: 'Registration must close after it opens' }]);
    expect(date.validate!(at('', '2030-05-01T09:00', [form]))).toEqual([]);
  });
});
