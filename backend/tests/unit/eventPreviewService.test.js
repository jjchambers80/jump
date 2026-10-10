// Unit tests for EventPreviewService (spec 050 F): mint/verify, audience
// separation from theme previews and staff sessions, org + event scope, expiry.

import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const mockFindFirst = jest.fn();
jest.unstable_mockModule('@jump/db', () => ({ prisma: { event: { findFirst: mockFindFirst } } }));
jest.unstable_mockModule('../../src/utils/storefrontUrl.js', () => ({
  storefrontFor: async () => ({ base: 'https://tickets.example.com', custom: true }),
}));

const { default: eventPreviewService } = await import('../../src/services/EventPreviewService.js');
const { default: themePreviewService, previewSecret } = await import('../../src/services/ThemePreviewService.js');

const tokenOf = (url) => new URL(url).searchParams.get('token');

describe('EventPreviewService', () => {
  beforeEach(() => mockFindFirst.mockResolvedValue({ id: 'evt-1' }));

  it('mints a 1 h link on the storefront base, scoped to the org', async () => {
    const { url, expiresAt } = await eventPreviewService.mint('org-1', 'evt-1');
    expect(url).toMatch(/^https:\/\/tickets\.example\.com\/api\/events\/preview\?token=/);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'evt-1', venue: { organizationId: 'org-1' } } }));
    expect(eventPreviewService.verify(tokenOf(url), 'org-1', 'evt-1')).toMatchObject({ organizationId: 'org-1', eventId: 'evt-1' });
  });

  it('404s an event outside the organization', async () => {
    mockFindFirst.mockResolvedValue(null);
    await expect(eventPreviewService.mint('org-1', 'evt-x')).rejects.toThrow('Event not found');
  });

  it('refuses another org or another event', async () => {
    const token = tokenOf((await eventPreviewService.mint('org-1', 'evt-1')).url);
    expect(eventPreviewService.verify(token, 'org-2', 'evt-1')).toBeNull();
    expect(eventPreviewService.verify(token, 'org-1', 'evt-2')).toBeNull();
    expect(eventPreviewService.verifyOrganization(token, 'org-1')).toMatchObject({ eventId: 'evt-1' });
    expect(eventPreviewService.verifyOrganization(token, 'org-2')).toBeNull();
  });

  it('is never a theme-preview token, and a theme token is never an event token', async () => {
    const token = tokenOf((await eventPreviewService.mint('org-1', 'evt-1')).url);
    expect(themePreviewService.verify(token, 'org-1')).toBeNull();
    const theme = jwt.sign({ orgId: 'org-1', themeId: 't1', eventId: 'evt-1', share: false }, previewSecret(), { audience: 'theme-preview' });
    expect(eventPreviewService.verify(theme, 'org-1', 'evt-1')).toBeNull();
  });

  it('is never a session token, and a session token is never an event token', async () => {
    const token = tokenOf((await eventPreviewService.mint('org-1', 'evt-1')).url);
    expect(() => jwt.verify(token, process.env.AUTH_SECRET, { algorithms: ['HS256'] })).toThrow();
    expect(jwt.decode(token).typ).toBe('event-preview');
    const session = jwt.sign({ sub: 'u1', orgId: 'org-1', eventId: 'evt-1' }, process.env.AUTH_SECRET, { audience: 'event-preview' });
    expect(eventPreviewService.verify(session, 'org-1', 'evt-1')).toBeNull();
  });

  it('refuses an untyped or expired token', () => {
    const untyped = jwt.sign({ orgId: 'org-1', eventId: 'evt-1' }, previewSecret(), { audience: 'event-preview' });
    expect(eventPreviewService.verify(untyped, 'org-1', 'evt-1')).toBeNull();
    const expired = jwt.sign(
      { typ: 'event-preview', orgId: 'org-1', eventId: 'evt-1', exp: Math.floor(Date.now() / 1000) - 1 },
      previewSecret(),
      { audience: 'event-preview' }
    );
    expect(eventPreviewService.verify(expired, 'org-1', 'evt-1')).toBeNull();
    expect(eventPreviewService.verify(null, 'org-1', 'evt-1')).toBeNull();
  });
});
