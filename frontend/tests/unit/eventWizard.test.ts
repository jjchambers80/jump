import { describe, expect, it } from 'vitest';
import { continueSetupHref, detailsEditLinks, legacyEditStep, wizardStepHref } from '@/lib/eventWizard';

describe('continueSetupHref (050-I)', () => {
  const draft = { id: 'e1', status: 'DRAFT', setupStep: 'tickets', setupCompletedAt: null };
  it('resumes a mid-setup draft at its step', () => {
    expect(continueSetupHref(draft, true)).toBe('/admin/events/e1/setup?step=tickets');
    expect(continueSetupHref({ ...draft, setupStep: null }, true)).toBe('/admin/events/e1/setup');
  });
  it('is null when the flag is off, the event is set up, published, or the field is missing', () => {
    expect(continueSetupHref(draft, false)).toBeNull();
    expect(continueSetupHref({ ...draft, setupCompletedAt: '2026-10-10T00:00:00Z' }, true)).toBeNull();
    expect(continueSetupHref({ ...draft, status: 'PUBLISHED' }, true)).toBeNull();
    expect(continueSetupHref({ id: 'e1', status: 'DRAFT' }, true)).toBeNull();
  });
});

describe('edit-mode links (050-O)', () => {
  const at = (q: string) => `/admin/events/e1/setup?${q}`;

  it('opens each Details section at its wizard step, with tier and form deep links', () => {
    const links = detailsEditLinks('e1', [
      { id: 'f-v', purpose: 'VENDOR', spaceSelection: 'TIERS' },
      { id: 'f-g', purpose: 'SPECIAL_GUEST' },
    ]);
    expect(links).toMatchObject({
      name: at('step=name'), venue: at('step=venue'), date: at('step=date'), description: at('step=description'),
      image: at('step=image'), tickets: at('step=tickets'), addOns: at('step=collect-more'), listing: at('step=description'),
      newForm: at('step=vendors'), map: null,
    });
    expect(links.tier('t 1')).toBe(at('step=tickets&tier=t+1'));
    expect(links.form({ id: 'f-g', purpose: 'SPECIAL_GUEST' })).toBe(at('step=special-guests&form=f-g'));
    expect(links.form({ id: 'f-p', purpose: 'PRESS' })).toBe(at('step=other-applications&form=f-p'));
    expect(links.form({ id: 'f-x', purpose: null })).toBe(at('step=other-applications&form=f-x'));
    expect(links.form({ id: 'f-vol', purpose: 'VOLUNTEER' })).toBe(at('step=volunteers&form=f-vol'));
  });

  it('links the map card to the floor-map step only while a vendor form uses a map', () => {
    expect(detailsEditLinks('e1', [{ id: 'f', purpose: 'VENDOR', spaceSelection: 'MAP' }]).map).toBe(at('step=floor-map'));
    expect(detailsEditLinks('e1', [{ id: 'f', purpose: 'SPONSOR', spaceSelection: 'MAP' }]).map).toBeNull();
  });

  it('maps the old editor routes and hashes to a step', () => {
    expect(legacyEditStep(null, '#event-price-tiers')).toBe('tickets');
    expect(legacyEditStep(null, '#event-add-ons')).toBe('collect-more');
    expect(legacyEditStep(null, '#event-media')).toBe('image');
    expect(legacyEditStep(null, '#event-when-where')).toBe('date');
    expect(legacyEditStep(null, '#event-listing')).toBe('description');
    expect(legacyEditStep('details', '')).toBe('name');
    expect(legacyEditStep('sales', '')).toBe('tickets');
    expect(legacyEditStep('sales', '#unknown')).toBe('tickets');
    expect(wizardStepHref('e1', 'vendors', { form: 'f1' })).toBe(at('step=vendors&form=f1'));
  });
});
