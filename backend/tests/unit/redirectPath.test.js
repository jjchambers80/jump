// Content › URL redirects (spec 028): path normalisation and rules.

import {
  isReservedPath,
  normalizeFromPath,
  normalizeToPath,
} from '../../src/utils/redirectPath.js';

describe('normalizeFromPath', () => {
  it('lowercases, prefixes, strips trailing slashes, query and hash', () => {
    expect(normalizeFromPath('Vendor-Info/')).toBe('/vendor-info');
    expect(normalizeFromPath('/Old/Page?x=1#top')).toBe('/old/page');
    expect(normalizeFromPath('https://tickets.example.com/Flyer/')).toBe('/flyer');
    expect(normalizeFromPath('//double//slash')).toBe('/double/slash');
    expect(normalizeFromPath('/')).toBe('/');
    expect(normalizeFromPath('')).toBe('');
  });
});

describe('isReservedPath', () => {
  it('protects live storefront routes', () => {
    for (const p of [
      '/',
      '/account',
      '/account/verify',
      '/events/e1',
      '/checkout/e1',
      '/orders/o1',
      '/venues/v1',
      '/api/x',
      '/admin',
      '/auth/signin',
      '/organizations/o1',
      '/rsvp/cancel',
    ]) {
      expect(isReservedPath(p)).toBe(true);
    }
    for (const p of ['/vendor-info', '/pages/faq', '/blogs/news', '/eventsz', '/accounting']) {
      expect(isReservedPath(p)).toBe(false);
    }
  });
});

describe('normalizeToPath', () => {
  it('accepts storefront paths and https URLs, rejects other schemes', () => {
    expect(normalizeToPath('pages/faq')).toBe('/pages/faq');
    expect(normalizeToPath('/blogs/news')).toBe('/blogs/news');
    expect(normalizeToPath('https://tix.partner.com/show?x=1')).toBe(
      'https://tix.partner.com/show?x=1'
    );
    expect(normalizeToPath('javascript:alert(1)')).toBeNull();
    expect(normalizeToPath('mailto:x@y.z')).toBeNull();
    expect(normalizeToPath('')).toBeNull();
    expect(normalizeToPath('/has space')).toBeNull();
  });
});
