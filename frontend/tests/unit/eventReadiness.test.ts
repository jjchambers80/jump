import { describe, expect, it } from 'vitest';
import { publishBlockers, readinessHref, readinessSettingsFix } from '@/lib/eventReadiness';

const item = (code: string, step: string, formId?: string) => ({ code, step, message: code, ...(formId && { formId }) });

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
  const base = '/admin/events/e1/setup';
  it.each([
    ['NAME_MISSING', 'name', `${base}?step=name&org=o1`],
    ['CAPACITY_MISSING', 'tickets', `${base}?step=tickets&org=o1`],
    ['PAYMENTS_UNAVAILABLE', 'review', '/admin/settings/payments'],
    ['TAX_RATE_UNRESOLVED', 'review', '/admin/settings/tax'],
  ])('%s opens its wizard step or settings page', (code, step, href) => {
    expect(readinessHref(item(code, step), 'e1', 'o1')).toBe(href);
  });

  // Spec 051: application items open the form's flow.
  it.each([
    ['FORM_HAS_NO_QUESTIONS', 'vendors', 'f1', `${base}/vendors?step=details&form=f1&org=o1`],
    ['PAID_FORMS_DISABLED', 'special-guests', 'f2', `${base}/special-guests?step=details&form=f2&org=o1`],
    ['MAP_FORM_WITHOUT_PUBLISHED_MAP', 'floor-map', 'f1', `${base}/vendors?step=floor-map&form=f1&org=o1`],
    ['FORM_HAS_NO_QUESTIONS', 'other-applications', undefined, `${base}/other-applications?org=o1`],
  ])('%s on %s opens the form flow', (code, step, formId, href) => {
    expect(readinessHref(item(code, step, formId), 'e1', 'o1')).toBe(href);
  });

  it('omits the org when there is none', () => {
    expect(readinessHref(item('NO_ACTIVE_TIER', 'tickets'), 'e1', null)).toBe(`${base}?step=tickets`);
    expect(readinessHref(item('NO_IMAGE', 'image'), 'e1')).toBe(`${base}?step=image`);
  });
});

describe('readinessSettingsFix', () => {
  it('names the permission and the admin hint for org-settings fixes only', () => {
    expect(readinessSettingsFix(item('PAYMENTS_UNAVAILABLE', 'review'))).toMatchObject({ permission: 'settings.payments', who: 'An admin needs to finish payments setup.' });
    expect(readinessSettingsFix(item('TAX_RATE_UNRESOLVED', 'review'))).toMatchObject({ permission: 'settings.tax', who: 'An admin needs to finish tax setup.' });
    expect(readinessSettingsFix(item('NO_ACTIVE_TIER', 'tickets'))).toBeNull();
  });
});
