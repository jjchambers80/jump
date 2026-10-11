import { describe, expect, it } from 'vitest';
import { outsideEventWarning, shiftErrorText, validateShiftDraft } from '@/components/event-setup/shiftEditor';

const NY = 'America/New_York';
const draft = (p = {}) => ({ name: 'Gate', start: '', end: '', capacity: '', ...p });

describe('validateShiftDraft (050-S)', () => {
  it('accepts a role without a time or cap', () => expect(validateShiftDraft(draft(), NY)).toEqual({}));
  it('needs a name', () => expect(validateShiftDraft(draft({ name: '  ' }), NY).name).toBeTruthy());
  it('needs a start before an end, and the end after it', () => {
    expect(validateShiftDraft(draft({ end: '2027-09-18T12:00' }), NY).end).toMatch(/start time/);
    expect(validateShiftDraft(draft({ start: '2027-09-18T12:00', end: '2027-09-18T11:00' }), NY).end).toMatch(/after/);
  });
  it('capacity is a whole number of at least 1 or empty', () => {
    expect(validateShiftDraft(draft({ capacity: '0' }), NY).capacity).toBeTruthy();
    expect(validateShiftDraft(draft({ capacity: '2.5' }), NY).capacity).toBeTruthy();
    expect(validateShiftDraft(draft({ capacity: '4' }), NY)).toEqual({});
  });
});

describe('outsideEventWarning (050-S)', () => {
  const start = '2027-09-18T14:00:00.000Z';
  const end = '2027-09-18T22:00:00.000Z';
  it('is quiet inside the event and for a role without a time', () => {
    expect(outsideEventWarning({ startsAt: '2027-09-18T15:00:00Z', endsAt: '2027-09-18T18:00:00Z' }, start, end)).toBeNull();
    expect(outsideEventWarning({ startsAt: null, endsAt: null }, start, end)).toBeNull();
  });
  it('names setup before and teardown after', () => {
    expect(outsideEventWarning({ startsAt: '2027-09-18T12:00:00Z', endsAt: '2027-09-18T15:00:00Z' }, start, end)).toMatch(/before/);
    expect(outsideEventWarning({ startsAt: '2027-09-18T21:00:00Z', endsAt: '2027-09-18T23:00:00Z' }, start, end)).toMatch(/after/);
  });
  it('without an event end only "starts before" is known', () => {
    expect(outsideEventWarning({ startsAt: '2027-09-19T21:00:00Z', endsAt: null }, start, null)).toBeNull();
  });
});

describe('shiftErrorText (050-S)', () => {
  it('words the two 409s', () => {
    expect(shiftErrorText({ code: 'SHIFT_CAPACITY_BELOW_ASSIGNED', details: { assigned: 3 } }, 'Gate', 'x')).toBe(
      '3 volunteers are already assigned to Gate. Set the capacity to at least 3, or leave it empty for no limit.'
    );
    expect(shiftErrorText({ code: 'SHIFT_HAS_ASSIGNED', details: { assigned: 1 } }, 'Gate', 'x')).toMatch(/^Gate can't be deleted: 1 volunteer is assigned/);
  });
  it('falls back to the server message', () => expect(shiftErrorText({ message: 'nope' }, 'Gate', 'x')).toBe('nope'));
});
