import { describe, expect, it } from 'vitest';
import { storefrontHref } from '@/lib/storefrontPath';

describe('storefrontHref', () => {
  const org = 'org_1';
  it('keeps platform paths on platform hosts', () => {
    expect(storefrontHref('/organizations/org_1/pages/faq', org, 'localhost:3001')).toBe(
      '/organizations/org_1/pages/faq'
    );
    expect(storefrontHref('/events/e1', org, 'jump.up.railway.app')).toBe('/events/e1');
  });
  it('shortens organization paths on tenant hosts', () => {
    expect(storefrontHref('/organizations/org_1', org, 'tickets.example.com')).toBe('/');
    expect(storefrontHref('/organizations/org_1#events', org, 'tickets.example.com')).toBe(
      '/#events'
    );
    expect(storefrontHref('/organizations/org_1/pages/faq', org, 'tickets.example.com')).toBe(
      '/pages/faq'
    );
    expect(
      storefrontHref('/organizations/org_1/blogs/news/recap', org, 'tickets.example.com')
    ).toBe('/blogs/news/recap');
    expect(storefrontHref('/organizations/org_1/account', org, 'tickets.example.com')).toBe(
      '/account'
    );
    expect(storefrontHref('/events/e1', org, 'tickets.example.com')).toBe('/events/e1');
    expect(storefrontHref('https://x.test', org, 'tickets.example.com')).toBe('https://x.test');
  });
});
