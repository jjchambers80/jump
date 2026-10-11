import { describe, expect, it } from 'vitest';
import { continueSetupHref } from '@/lib/eventWizard';

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
