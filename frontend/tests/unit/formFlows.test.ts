import { describe, expect, it } from 'vitest';
import { flowSteps, formEditHref, formFlowHref, legacyFlowHref, type FlowForm } from '@/components/event-setup/formFlows';

const keys = (flow: Parameters<typeof flowSteps>[0], form: FlowForm | null) => flowSteps(flow, form).map((s) => s.key);

describe('application flows (spec 051)', () => {
  it('walks a vendor form: spaces only when it charges, the floor map only on MAP', () => {
    expect(keys('vendors', null)).toEqual(['start', 'details', 'options', 'payment', 'questions', 'review']);
    expect(keys('vendors', { kind: 'PAID', spaceSelection: 'TIERS' })).toEqual(['start', 'details', 'options', 'payment', 'questions', 'review']);
    expect(keys('vendors', { kind: 'PAID', spaceSelection: 'MAP' })).toEqual(['start', 'details', 'options', 'payment', 'floor-map', 'questions', 'review']);
    // Maps off or hidden for the role: no floor-map step even on a MAP form.
    expect(flowSteps('vendors', { kind: 'PAID', spaceSelection: 'MAP' }, { maps: false }).map((s) => s.key)).not.toContain('floor-map');
    expect(keys('vendors', { kind: 'FREE', spaceSelection: null })).toEqual(['start', 'details', 'questions', 'review']);
  });

  it('starts special guests at the lineup and gives volunteers shifts', () => {
    expect(keys('special-guests', null)).toEqual(['lineup', 'start', 'details', 'questions', 'review']);
    expect(keys('volunteers', { kind: 'FREE' })).toEqual(['start', 'details', 'shifts', 'questions', 'review']);
    expect(keys('other-applications', { kind: 'FREE' })).toEqual(['start', 'details', 'questions', 'review']);
  });

  it('needs the form row after Start, but never for the lineup', () => {
    const needs = Object.fromEntries(flowSteps('special-guests', null).map((s) => [s.key, s.needsForm]));
    expect(needs).toEqual({ lineup: false, start: false, details: true, questions: true, review: true });
  });

  it('builds flow links', () => {
    expect(formFlowHref('e 1', 'vendors')).toBe('/admin/events/e%201/setup/vendors');
    expect(formFlowHref('e1', 'volunteers', { step: 'shifts', form: 'f1', org: 'o1' })).toBe('/admin/events/e1/setup/volunteers?step=shifts&form=f1&org=o1');
    expect(formEditHref('e1', { id: 'f1', purpose: 'SPONSOR' })).toBe('/admin/events/e1/setup/other-applications?step=details&form=f1');
  });
});

describe('legacyFlowHref', () => {
  const forms = [
    { id: 'v1', purpose: 'VENDOR' as const, kind: 'PAID', spaceSelection: 'MAP' },
    { id: 'g1', purpose: 'SPECIAL_GUEST' as const, kind: 'FREE' },
  ];
  it('sends the old application step links to the form flow', () => {
    expect(legacyFlowHref('e1', 'vendors', 'g1', forms, 'o1')).toBe('/admin/events/e1/setup/special-guests?step=details&form=g1&org=o1');
    expect(legacyFlowHref('e1', 'volunteers', null, forms)).toBe('/admin/events/e1/setup/volunteers');
    expect(legacyFlowHref('e1', 'special-guests', null, forms)).toBe('/admin/events/e1/setup/special-guests?step=lineup');
    expect(legacyFlowHref('e1', 'floor-map', null, forms)).toBe('/admin/events/e1/setup/vendors?step=floor-map&form=v1');
    expect(legacyFlowHref('e1', 'floor-map', null, [])).toBe('/admin/events/e1/setup/vendors');
  });
  it('leaves event steps alone', () => {
    expect(legacyFlowHref('e1', 'tickets', null, forms)).toBeNull();
    expect(legacyFlowHref('e1', null, null, forms)).toBeNull();
  });
});
