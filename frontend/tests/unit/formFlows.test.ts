import { describe, expect, it } from 'vitest';
import { flowSteps, formEditHref, formFlowHref, legacyFlowHref, type FlowForm } from '@/components/event-setup/formFlows';

const keys = (flow: Parameters<typeof flowSteps>[0], form: FlowForm | null) => flowSteps(flow, form).map((s) => s.key);

describe('setup flows (spec 051, 057)', () => {
  it('walks a registration form: options and payment only when it charges, the floor map only on MAP', () => {
    expect(keys('registration', null)).toEqual(['start', 'details', 'questions']);
    expect(keys('registration', { kind: 'PAID', spaceSelection: 'TIERS' })).toEqual(['start', 'details', 'options', 'payment', 'questions']);
    expect(keys('registration', { kind: 'PAID', spaceSelection: 'MAP' })).toEqual(['start', 'details', 'options', 'payment', 'floor-map', 'questions']);
    // Maps off or hidden for the role, or no linked live event: no floor-map step even on a MAP form.
    expect(flowSteps('registration', { kind: 'PAID', spaceSelection: 'MAP' }, { maps: false }).map((s) => s.key)).not.toContain('floor-map');
    expect(flowSteps('registration', { kind: 'PAID', spaceSelection: 'MAP' }, { mapEvent: false }).map((s) => s.key)).not.toContain('floor-map');
  });

  it('special guests is the lineup only, which never needs a form', () => {
    expect(flowSteps('special-guests', null).map((s) => [s.key, s.needsForm])).toEqual([['lineup', false]]);
  });

  it('builds flow links; a form is edited in the registration flow', () => {
    expect(formFlowHref('e 1', 'registration')).toBe('/admin/events/e%201/setup/registration');
    expect(formFlowHref('e1', 'registration', { step: 'questions', form: 'f1', org: 'o1' })).toBe('/admin/events/e1/setup/registration?step=questions&form=f1&org=o1');
    expect(formEditHref('e1', { id: 'f1' })).toBe('/admin/events/e1/setup/registration?step=details&form=f1');
  });
});

describe('legacyFlowHref', () => {
  it('sends the old application step links to the registration flow, special guests to the lineup', () => {
    expect(legacyFlowHref('e1', 'vendors', 'f1', 'o1')).toBe('/admin/events/e1/setup/registration?step=details&form=f1&org=o1');
    expect(legacyFlowHref('e1', 'volunteers', null)).toBe('/admin/events/e1/setup/registration');
    expect(legacyFlowHref('e1', 'special-guests', null)).toBe('/admin/events/e1/setup/special-guests?step=lineup');
    expect(legacyFlowHref('e1', 'special-guests', 'g1')).toBe('/admin/events/e1/setup/registration?step=details&form=g1');
    expect(legacyFlowHref('e1', 'floor-map', 'v1')).toBe('/admin/events/e1/setup/registration?step=floor-map&form=v1');
  });
  it('leaves event steps alone', () => {
    expect(legacyFlowHref('e1', 'tickets', null)).toBeNull();
    expect(legacyFlowHref('e1', null, null)).toBeNull();
  });
});
