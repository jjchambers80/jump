// Wizard time-zone checks (docs/research/2026-10-18-automatic-event-time-zones.md).

import { describe, expect, it } from 'vitest';
import { viewerTimeLine, zoneMoveNotice, zoneNeedsCheck } from '@/components/event-setup/steps/zoneChecks';

const venue = (patch: Record<string, unknown>) => ({ id: 'v', name: 'V', address: '1 Main St', timezone: 'America/Chicago', ...patch });

describe('zoneNeedsCheck', () => {
  it('flags a fallback zone and a derived zone near a line, never a chosen one', () => {
    expect(zoneNeedsCheck(venue({ timezoneSource: 'DEFAULT', timezone: 'America/New_York' }))).toBe(true);
    expect(zoneNeedsCheck(venue({ timezoneSource: 'DERIVED', state: 'TX' }))).toBe(true);
    expect(zoneNeedsCheck(venue({ timezoneSource: 'DERIVED', state: 'IL', postalCode: '60601' }))).toBe(false);
    expect(zoneNeedsCheck(venue({ timezoneSource: 'MANUAL', state: 'TX' }))).toBe(false);
    expect(zoneNeedsCheck(venue({}))).toBe(false);
  });
});

describe('viewerTimeLine', () => {
  const at = new Date('2026-10-31T17:00:00Z'); // 12:00 PM CDT
  it('says nothing when the viewer reads the same clock', () => {
    expect(viewerTimeLine(at, 'America/Chicago', 'America/Chicago')).toBeNull();
    expect(viewerTimeLine(at, 'America/Chicago', null)).toBeNull();
  });
  it('gives the viewer’s time, with the date when it differs', () => {
    expect(viewerTimeLine(at, 'America/Chicago', 'America/New_York')).toBe("That's 1:00 PM EDT your time.");
    expect(viewerTimeLine(new Date('2026-11-01T05:30:00Z'), 'America/Chicago', 'America/Los_Angeles')).toBe(
      "That's Sat, Oct 31, 2026 · 10:30 PM PDT your time."
    );
  });
});

describe('zoneMoveNotice', () => {
  const saved = { date: '2026-10-31T00:00:00Z', holders: 12 }; // 8:00 PM EDT Oct 30
  it('warns when people hold the old start and the zone moves it', () => {
    expect(zoneMoveNotice(saved, 'America/New_York', 'America/Chicago')).toBe(
      '12 people already have this event at Fri, Oct 30, 2026 · 8:00 PM EDT. Here it becomes Fri, Oct 30, 2026 · 8:00 PM CDT, 1 hour later for them. Let them know when you save.'
    );
  });
  it('stays quiet with no holders, the same zone or an equivalent zone', () => {
    expect(zoneMoveNotice({ ...saved, holders: 0 }, 'America/New_York', 'America/Chicago')).toBeNull();
    expect(zoneMoveNotice(saved, 'America/New_York', 'America/New_York')).toBeNull();
    expect(zoneMoveNotice(saved, 'America/New_York', 'America/Detroit')).toBeNull();
    expect(zoneMoveNotice(null, 'America/New_York', 'America/Chicago')).toBeNull();
  });
});
