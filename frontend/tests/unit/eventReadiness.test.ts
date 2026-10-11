import { describe, expect, it } from 'vitest';
import { publishBlockers, readinessHref, readinessSettingsFix } from '@/lib/eventReadiness';

const item = (code: string, step: string) => ({ code, step, message: code });

describe('publishBlockers', () => {
  it('reads the blockers of a 422 EVENT_NOT_READY only', () => {
    const blockers = [item('NO_ACTIVE_TIER', 'tickets')];
    expect(publishBlockers({ status: 422, code: 'EVENT_NOT_READY', details: { blockers } })).toEqual(blockers);
    expect(publishBlockers({ status: 409, code: 'EVENT_NOT_READY', details: { blockers } })).toBeNull();
    expect(publishBlockers({ status: 422, code: 'OTHER' })).toBeNull();
    expect(publishBlockers(null)).toBeNull();
  });
});

describe('readinessHref', () => {
  const base = '/admin/events/e1';
  it.each([
    ['NAME_MISSING', 'name', `${base}/edit/details?orgId=o1#event-details`],
    ['VENUE_MISSING', 'venue', `${base}/edit/details?orgId=o1#event-when-where`],
    ['DATE_IN_PAST', 'date', `${base}/edit/details?orgId=o1#event-when-where`],
    ['CAPACITY_MISSING', 'tickets', `${base}/edit/sales?orgId=o1#event-admission`],
    ['TIERS_EXCEED_CAPACITY', 'tickets', `${base}/edit/sales?orgId=o1#event-price-tiers`],
    ['NO_IMAGE', 'image', `${base}/edit/details?orgId=o1#event-media`],
    ['FORM_HAS_NO_QUESTIONS', 'vendors', `${base}/applications/forms?orgId=o1`],
    ['MAP_FORM_WITHOUT_PUBLISHED_MAP', 'floor-map', `${base}/map?orgId=o1`],
    ['PAYMENTS_UNAVAILABLE', 'review', '/admin/settings/payments'],
    ['TAX_RATE_UNRESOLVED', 'review', '/admin/settings/tax'],
  ])('%s links to its editor', (code, step, href) => {
    expect(readinessHref(item(code, step), 'e1', 'o1')).toBe(href);
  });

  it('omits the org query when there is none', () => {
    expect(readinessHref(item('NO_ACTIVE_TIER', 'tickets'), 'e1', null)).toBe(`${base}/edit/sales#event-price-tiers`);
  });
});

describe('readinessSettingsFix', () => {
  it('names the permission and the admin hint for org-settings fixes only', () => {
    expect(readinessSettingsFix(item('PAYMENTS_UNAVAILABLE', 'review'))).toMatchObject({ permission: 'settings.payments', who: 'An admin needs to finish payments setup.' });
    expect(readinessSettingsFix(item('TAX_RATE_UNRESOLVED', 'review'))).toMatchObject({ permission: 'settings.tax', who: 'An admin needs to finish tax setup.' });
    expect(readinessSettingsFix(item('NO_ACTIVE_TIER', 'tickets'))).toBeNull();
  });
});
