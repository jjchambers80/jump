import { describe, expect, it } from 'vitest';
import { currentMenuPath } from '../../src/lib/menus';

describe('currentMenuPath', () => {
  const home = '/organizations/rrg';
  const events = '/organizations/rrg/events';

  it('marks only Events on the events page, not Home as well', () => {
    expect(currentMenuPath(events, [home, events])).toBe(events);
  });

  it('marks Home on the home page', () => {
    expect(currentMenuPath(home, [home, events])).toBe(home);
  });

  it('prefers the longest parent for a child page', () => {
    expect(currentMenuPath(`${home}/pages/about/team`, [home, `${home}/pages/about`])).toBe(`${home}/pages/about`);
  });

  it('falls back to Home when no deeper item matches', () => {
    expect(currentMenuPath(`${home}/blogs/news`, [home, events])).toBe(home);
  });

  it('never prefix-matches the custom-domain root', () => {
    expect(currentMenuPath('/events', ['/', '/events'])).toBe('/events');
    expect(currentMenuPath('/pages/faq', ['/', '/events'])).toBeNull();
    expect(currentMenuPath('/', ['/', '/events'])).toBe('/');
  });

  it('ignores hashes and external links', () => {
    expect(currentMenuPath(home, [`${home}#about`])).toBe(home);
    expect(currentMenuPath(home, ['https://example.com/organizations/rrg'])).toBeNull();
  });
});
