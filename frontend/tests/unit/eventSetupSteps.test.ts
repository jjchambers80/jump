// Spec 050 §5.1 step registry: visibility, counting, resume and state, plus
// key parity with the backend's EVENT_SETUP_STEPS via the shared fixture.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  EVENT_STEPS, FIELD_IDS, isReachable, neighbours, resumeKey, stepByKey, stepPosition, stepState, visibleSteps,
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
  test('a new ticketed event has 12 steps; floor map and done are hidden', () => {
    expect(keys(ctx())).toEqual([
      'name', 'venue', 'date', 'description', 'image', 'tickets', 'collect-more', 'vendors',
      'special-guests', 'volunteers', 'other-applications', 'review',
    ]);
    expect(stepPosition('date', ctx())).toEqual({ index: 3, total: 12 });
  });

  test('the count does not move once the row exists', () => {
    expect(stepPosition('date', ctx())).toEqual(stepPosition('date', ctx({ saved: row() })));
  });

  test('RSVP hides Collect more unless donations are eligible', () => {
    const rsvp = row({ admissionMode: 'RSVP' });
    expect(keys(ctx({ saved: rsvp }))).not.toContain('collect-more');
    expect(keys(ctx({ saved: rsvp, donationsEligible: true }))).toContain('collect-more');
  });

  test('a MAP vendor form shows the Floor map step right after Vendors', () => {
    const list = keys(ctx({ saved: row(), forms: [{ spaceSelection: 'MAP' }] }));
    expect(list[list.indexOf('vendors') + 1]).toBe('floor-map');
    expect(stepPosition('review', ctx({ saved: row(), forms: [{ spaceSelection: 'MAP' }] })).total).toBe(13);
  });

  test('later steps need the server row', () => {
    expect(isReachable('date', ctx())).toBe(true);
    expect(isReachable('description', ctx())).toBe(false);
    expect(isReachable('description', ctx({ saved: row() }))).toBe(true);
  });

  test('neighbours skip hidden steps', () => {
    const c = ctx({ saved: row() });
    expect(neighbours('vendors', c).next?.key).toBe('special-guests');
    expect(neighbours('name', c).prev).toBeNull();
    expect(neighbours('review', c).next).toBeNull();
  });
});

describe('resume key', () => {
  test('no row and no draft starts at name; a draft resumes its step', () => {
    expect(resumeKey(ctx(), null)).toBe('name');
    expect(resumeKey(ctx(), 'date')).toBe('date');
  });

  test('a fresh row resumes after the date step that created it', () => {
    expect(resumeKey(ctx({ saved: row() }), null)).toBe('description');
  });

  test('a saved step resumes there', () => {
    expect(resumeKey(ctx({ saved: row() }), 'tickets')).toBe('tickets');
  });

  test('a step hidden since resumes at the next visible one', () => {
    expect(resumeKey(ctx({ saved: row() }), 'floor-map')).toBe('special-guests');
  });

  test('an unknown key falls back to the first step', () => {
    expect(resumeKey(ctx({ saved: row() }), 'nope')).toBe('name');
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
});

describe('state', () => {
  test('complete, current, skipped and todo', () => {
    const saved = row({ setupStep: 'tickets' });
    const c = ctx({ saved, fields: { ...fields, name: 'Fair', venueId: 'v1', date: '2030-06-01T16:00' } });
    expect(stepState(stepByKey('name')!, 'tickets', c)).toBe('complete');
    expect(stepState(stepByKey('tickets')!, 'tickets', c)).toBe('current');
    expect(stepState(stepByKey('description')!, 'tickets', c)).toBe('skipped');
    expect(stepState(stepByKey('vendors')!, 'tickets', c)).toBe('todo');
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
