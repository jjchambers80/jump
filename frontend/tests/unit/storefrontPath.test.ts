import { describe, expect, it } from 'vitest';
import { storefrontHref } from '@/lib/storefrontPath';

describe('storefrontHref', () => {
  it('keeps platform paths on platform hosts', () => {
    expect(storefrontHref('/organizations/org_1/pages/faq', 'localhost:3001')).toBe(
      '/organizations/org_1/pages/faq'
    );
    expect(storefrontHref('/events/e1', 'jump.up.railway.app')).toBe('/events/e1');
  });
  it('shortens organization paths on tenant hosts', () => {
    expect(storefrontHref('/organizations/org_1', 'tickets.example.com')).toBe('/');
    expect(storefrontHref('/organizations/org_1#events', 'tickets.example.com')).toBe(
      '/#events'
    );
    expect(storefrontHref('/organizations/org_1/pages/faq', 'tickets.example.com')).toBe(
      '/pages/faq'
    );
    expect(
      storefrontHref('/organizations/org_1/blogs/news/recap', 'tickets.example.com')
    ).toBe('/blogs/news/recap');
    expect(storefrontHref('/organizations/org_1/account', 'tickets.example.com')).toBe(
      '/account'
    );
    expect(storefrontHref('/events/e1', 'tickets.example.com')).toBe('/events/e1');
    // Spec 038 (test 9): the Events page short path.
    expect(storefrontHref('/organizations/org_1/events', 'tickets.example.com')).toBe('/events');
    expect(storefrontHref('/organizations/org_1/events', 'localhost:3001')).toBe('/organizations/org_1/events');
    expect(storefrontHref('https://x.test', 'tickets.example.com')).toBe('https://x.test');
    // Menu and theme links name the organization by slug.
    expect(storefrontHref('/organizations/acme/pages/about', 'acme.eventimus.net')).toBe('/pages/about');
    expect(storefrontHref('/organizations/acme?x=1', 'tickets.example.com')).toBe('/?x=1');
  });
});
