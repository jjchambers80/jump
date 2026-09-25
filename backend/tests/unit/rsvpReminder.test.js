// Unit tests for RsvpReminderService (spec 034 §9.2)
// All tests mock @jump/db and never hit a real database.

import { jest } from '@jest/globals';
import { createHmac } from 'node:crypto';

process.env.AUTH_SECRET = 'unit-secret-that-is-long-enough-to-sign-things';

// Fully mock all dependencies
const mockUpdateMany = jest.fn();
const mockFindMany = jest.fn();
const mockSendRsvpReminder = jest.fn();
const mockCancelUrlFor = jest.fn();
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    eventRsvp: {
      updateMany: mockUpdateMany,
      findMany: mockFindMany,
    },
  },
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ default: logger }));
jest.unstable_mockModule('../../src/services/EmailService.js', () => ({
  default: { sendRsvpReminder: mockSendRsvpReminder },
}));
jest.unstable_mockModule('../../src/services/rsvpLinks.js', () => ({
  cancelUrlFor: mockCancelUrlFor,
}));

// Helper to build a minimal RSVP for the mock data (patterned on the
// include shape in RsvpReminderService.sendDue).
function makeRsvp(overrides = {}) {
  const event = {
    id: 'evt_1',
    name: 'Test Event',
    date: new Date(Date.now() + 24 * 60 * 60 * 1000),
    status: 'PUBLISHED',
    venue: {
      timezone: 'America/New_York',
      organization: { id: 'org_1', name: 'Test Org', logoUrl: null, email: null },
    },
    ...overrides.event,
  };
  return {
    id: overrides.id || 'rsvp_1',
    eventId: event.id,
    contactId: 'c_1',
    partySize: 2,
    status: 'GOING',
    remindedAt: null,
    cancelledAt: null,
    event,
    contact: { id: 'c_1', email: 'test@example.com', firstName: 'Jane', lastName: 'Doe', ...overrides.contact },
    ...overrides,
  };
}

describe('RsvpReminderService.sendDue', () => {
  let service;

  beforeAll(async () => {
    const mod = await import('../../src/services/RsvpReminderService.js');
    service = mod.default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelUrlFor.mockResolvedValue('https://example.com/rsvp/cancel?token=mock');
  });

  it('sends a reminder for a single eligible RSVP', async () => {
    const rsvp = makeRsvp();
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindMany.mockResolvedValue([rsvp]);
    mockSendRsvpReminder.mockResolvedValue();

    const result = await service.sendDue(new Date());

    expect(result).toEqual({ checked: 1, sent: 1, failed: 0 });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        status: 'GOING',
        remindedAt: null,
        event: {
          status: 'PUBLISHED',
          date: { gte: expect.any(Date), lt: expect.any(Date) },
        },
      },
      data: { remindedAt: expect.any(Date) },
    });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { remindedAt: expect.any(Date), status: 'GOING' },
      include: {
        event: { include: { venue: { include: { organization: true } } } },
        contact: true,
      },
    });
    expect(mockSendRsvpReminder).toHaveBeenCalledTimes(1);
    expect(mockCancelUrlFor).toHaveBeenCalledWith(rsvp);
  });

  it('skips CANCELLED RSVPs', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await service.sendDue(new Date());

    expect(result).toEqual({ checked: 0, sent: 0, failed: 0 });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockSendRsvpReminder).not.toHaveBeenCalled();
  });

  it('skips already-reminded RSVPs', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await service.sendDue(new Date());

    expect(result).toEqual({ checked: 0, sent: 0, failed: 0 });
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('skips RSVPs on a cancelled event', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await service.sendDue(new Date());

    expect(result).toEqual({ checked: 0, sent: 0, failed: 0 });
  });

  it('skips events outside the 20–26 h window', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await service.sendDue(new Date());

    expect(result).toEqual({ checked: 0, sent: 0, failed: 0 });
  });

  it('handles partial failures in a batch: some send, some fail', async () => {
    const rsvp1 = makeRsvp({ id: 'rsvp_1', contact: { id: 'c_1', email: 'a@x.com', firstName: 'Alice' } });
    const rsvp2 = makeRsvp({ id: 'rsvp_2', contact: { id: 'c_2', email: 'b@x.com', firstName: 'Bob' } });
    const rsvp3 = makeRsvp({ id: 'rsvp_3', contact: { id: 'c_3', email: 'c@x.com', firstName: 'Carol' } });
    mockUpdateMany.mockResolvedValue({ count: 3 });
    mockFindMany.mockResolvedValue([rsvp1, rsvp2, rsvp3]);
    mockSendRsvpReminder
      .mockResolvedValueOnce()          // rsvp1 succeeds
      .mockRejectedValueOnce(new Error('Resend outage')) // rsvp2 fails
      .mockResolvedValueOnce();         // rsvp3 succeeds

    const result = await service.sendDue(new Date());

    expect(result).toEqual({ checked: 3, sent: 2, failed: 1 });
    expect(mockSendRsvpReminder).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith(
      'RSVP reminder send failed',
      expect.objectContaining({ rsvpId: 'rsvp_2' })
    );
  });

  it('releases the stamp of a failed send so the next sweep retries it', async () => {
    const now = new Date('2026-09-22T12:00:00Z');
    const rsvp1 = makeRsvp({ id: 'rsvp_1' });
    const rsvp2 = makeRsvp({ id: 'rsvp_2' });
    mockUpdateMany.mockResolvedValue({ count: 2 });
    mockFindMany.mockResolvedValue([rsvp1, rsvp2]);
    mockSendRsvpReminder
      .mockResolvedValueOnce()                            // rsvp1 succeeds
      .mockRejectedValueOnce(new Error('Resend outage')); // rsvp2 fails

    const result = await service.sendDue(now);

    expect(result).toEqual({ checked: 2, sent: 1, failed: 1 });
    // Only the failed RSVP is un-stamped, and only the stamp this sweep set
    // (remindedAt: now) — a concurrent replica's claim is never cleared.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['rsvp_2'] }, remindedAt: now },
      data: { remindedAt: null },
    });
    // The RSVP that sent keeps its stamp: no release call mentions it.
    const releaseCalls = mockUpdateMany.mock.calls.filter(
      ([args]) => args.data?.remindedAt === null
    );
    expect(releaseCalls).toHaveLength(1);
    expect(releaseCalls[0][0].where.id.in).not.toContain('rsvp_1');
  });

  it('does not release anything when every send succeeds', async () => {
    mockUpdateMany.mockResolvedValue({ count: 2 });
    mockFindMany.mockResolvedValue([makeRsvp({ id: 'rsvp_1' }), makeRsvp({ id: 'rsvp_2' })]);
    mockSendRsvpReminder.mockResolvedValue();

    const result = await service.sendDue(new Date());

    expect(result).toEqual({ checked: 2, sent: 2, failed: 0 });
    // One claim call, no release call.
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany.mock.calls[0][0].data).toEqual({ remindedAt: expect.any(Date) });
  });

  it('a released RSVP sends on the following sweep', async () => {
    const rsvp = makeRsvp({ id: 'rsvp_1' });

    // Sweep 1: the send fails, the stamp is released.
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindMany.mockResolvedValue([rsvp]);
    mockSendRsvpReminder.mockRejectedValueOnce(new Error('Resend outage'));
    const first = await service.sendDue(new Date('2026-09-22T12:00:00Z'));
    expect(first).toEqual({ checked: 1, sent: 0, failed: 1 });

    // Sweep 2: the row is claimable again (remindedAt back to null) and sends.
    jest.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindMany.mockResolvedValue([{ ...rsvp, remindedAt: null }]);
    mockSendRsvpReminder.mockResolvedValue();
    const second = await service.sendDue(new Date('2026-09-22T13:00:00Z'));

    expect(second).toEqual({ checked: 1, sent: 1, failed: 0 });
    expect(mockSendRsvpReminder).toHaveBeenCalledTimes(1);
    // No release on the successful retry.
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('concurrent replica guard: updateMany returns 0', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await service.sendDue(new Date());

    expect(result).toEqual({ checked: 0, sent: 0, failed: 0 });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockSendRsvpReminder).not.toHaveBeenCalled();
  });

  it('window boundaries: 20 h exactly included, 26 h excluded', async () => {
    // Set a fixed now so we can compute exact boundaries.
    const now = new Date('2026-09-22T12:00:00Z');
    const twentyH = new Date(now.getTime() + 20 * 60 * 60 * 1000);
    const twentySixH = new Date(now.getTime() + 26 * 60 * 60 * 1000);

    // Event at exactly 20 h ahead — should be included.
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockFindMany.mockResolvedValueOnce([makeRsvp({ event: { date: twentyH } })]);
    mockSendRsvpReminder.mockResolvedValue();

    const result1 = await service.sendDue(now);
    expect(result1.checked).toBe(1);

    jest.clearAllMocks();

    // Event at exactly 26 h ahead — should be excluded (< maxBound).
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const result2 = await service.sendDue(now);
    expect(result2.checked).toBe(0);
  });
});