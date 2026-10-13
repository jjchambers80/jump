// Spec 050-L: which forms an application step lists.
import { describe, expect, test } from 'vitest';
import { formsOnStep, stepForPurpose } from '@/components/event-setup/applicationSteps';

describe('formsOnStep', () => {
  const forms = [
    { id: 'v', purpose: 'VENDOR' as const },
    { id: 's', purpose: 'SPONSOR' as const },
    { id: 'p', purpose: 'PRESS' as const },
    { id: 'g', purpose: 'SPECIAL_GUEST' as const },
    { id: 'vol', purpose: 'VOLUNTEER' as const },
    { id: 'legacy', purpose: null },
  ];
  const ids = (key: Parameters<typeof formsOnStep>[0]) => formsOnStep(key, forms).map((f) => f.id);

  test('each step lists its purposes; a form without one is Other', () => {
    expect(ids('vendors')).toEqual(['v']);
    expect(ids('special-guests')).toEqual(['g']);
    expect(ids('volunteers')).toEqual(['vol']);
    expect(ids('other-applications')).toEqual(['s', 'p', 'legacy']);
  });

  test('no forms yet', () => expect(formsOnStep('vendors')).toEqual([]));

  test('stepForPurpose is the inverse', () => {
    expect(stepForPurpose('PANEL')).toBe('other-applications');
    expect(stepForPurpose('VOLUNTEER')).toBe('volunteers');
    expect(stepForPurpose(null)).toBe('other-applications');
  });
});
