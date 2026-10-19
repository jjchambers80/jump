import { describe, expect, it } from 'vitest';
import { continueSetupHref, detailsEditLinks, legacyEditStep, wizardStepHref, withOrg } from '@/lib/eventWizard';

describe('continueSetupHref (050-I)', () => {
  const draft = { id: 'e1', status: 'DRAFT', setupStep: 'tickets', setupCompletedAt: null };
  it('resumes a mid-setup draft at its step', () => {
    expect(continueSetupHref(draft)).toBe('/admin/events/e1/setup?step=tickets');
    expect(continueSetupHref({ ...draft, setupStep: null })).toBe('/admin/events/e1/setup');
  });
  it('is null when the event is set up, published, or the field is missing', () => {
    expect(continueSetupHref({ ...draft, setupCompletedAt: '2026-10-10T00:00:00Z' })).toBeNull();
    expect(continueSetupHref({ ...draft, status: 'PUBLISHED' })).toBeNull();
    expect(continueSetupHref({ id: 'e1', status: 'DRAFT' })).toBeNull();
  });
});

describe('edit-mode links (050-O)', () => {
  const at = (q: string) => `/admin/events/e1/setup?${q}`;

  it('opens each Details section at its wizard step, with tier and form deep links', () => {
    const links = detailsEditLinks('e1', [{ id: 'f-v', spaceSelection: 'TIERS' }, { id: 'f-g' }]);
    expect(links).toMatchObject({
      name: at('step=name'), venue: at('step=venue'), date: at('step=date'), description: at('step=description'),
      image: at('step=image'), tickets: at('step=tickets'), addOns: at('step=collect-more'), listing: at('step=name'),
      map: null, guests: '/admin/events/e1/setup/special-guests?step=lineup',
    });
    expect(links.tier('t 1')).toBe(at('step=tickets&tier=t+1'));
    // A form opens the registration flow at Start; the lineup opens its step.
    const flow = (path: string) => `/admin/events/e1/setup/${path}`;
    expect(links.form({ id: 'f-g' })).toBe(flow('registration?step=start&form=f-g'));
    expect(links.guests).toBe(flow('special-guests?step=lineup'));
  });

  it('carries the organization on wizard links only', () => {
    expect(detailsEditLinks('e1', [], 'o 1').name).toBe(at('step=name&org=o%201'));
    expect(detailsEditLinks('e1', [], 'o1').tier('t1')).toBe(at('step=tickets&tier=t1&org=o1'));
    expect(withOrg('/admin/settings/tax', 'o1')).toBe('/admin/settings/tax');
    expect(withOrg(at('step=date'), null)).toBe(at('step=date'));
  });

  it('links the map card to the floor-map step only while a form uses a map', () => {
    expect(detailsEditLinks('e1', [{ id: 'f', spaceSelection: 'MAP' }], 'o1').map).toBe('/admin/events/e1/setup/registration?step=floor-map&form=f&org=o1');
    expect(detailsEditLinks('e1', [{ id: 'f', spaceSelection: 'TIERS' }]).map).toBeNull();
  });

  it('maps the old editor routes and hashes to a step', () => {
    expect(legacyEditStep(null, '#event-price-tiers')).toBe('tickets');
    expect(legacyEditStep(null, '#event-add-ons')).toBe('collect-more');
    expect(legacyEditStep(null, '#event-media')).toBe('image');
    expect(legacyEditStep(null, '#event-when-where')).toBe('date');
    expect(legacyEditStep(null, '#event-listing')).toBe('name');
    expect(legacyEditStep(null, '#event-category')).toBe('name');
    expect(legacyEditStep(null, '#event-capacity')).toBe('tickets');
    expect(legacyEditStep(null, '#event-rsvp-limit')).toBe('tickets');
    expect(legacyEditStep(null, '#event-rsvp-party-size')).toBe('tickets');
    expect(legacyEditStep(null, '#event-tax-summary')).toBe('tickets');
    expect(legacyEditStep('details', '')).toBe('name');
    expect(legacyEditStep('sales', '')).toBe('tickets');
    expect(legacyEditStep('sales', '#unknown')).toBe('tickets');
    expect(wizardStepHref('e1', 'vendors', { form: 'f1' })).toBe(at('step=vendors&form=f1'));
  });
});
