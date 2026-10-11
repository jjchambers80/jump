// Spec 050-L: which forms an application step lists, and which templates "Start from" offers.
import { describe, expect, test } from 'vitest';
import { formsOnStep, stepForPurpose, templatesFor } from '@/components/event-setup/applicationSteps';
import type { FormTemplateSummary } from '@/lib/applications';

const tpl = (id: string, kind: 'PAID' | 'FREE', purpose: FormTemplateSummary['purpose']): FormTemplateSummary => ({
  id, name: id, kind, purpose, tierCount: 0, questionCount: 0, sourceFormId: null, createdAt: '', updatedAt: '',
});

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

describe('templatesFor', () => {
  const all = [tpl('paid-vendor', 'PAID', 'VENDOR'), tpl('free-vendor', 'FREE', 'VENDOR'), tpl('old-paid', 'PAID', null), tpl('old-free', 'FREE', null), tpl('press', 'FREE', 'PRESS')];
  const ids = (purpose: Parameters<typeof templatesFor>[1], kind: 'PAID' | 'FREE') => templatesFor(all, purpose, kind).map((t) => t.id);

  test('templates of the same purpose and kind win', () => {
    expect(ids('VENDOR', 'PAID')).toEqual(['paid-vendor']);
    expect(ids('VENDOR', 'FREE')).toEqual(['free-vendor']);
  });

  test('else same-kind templates saved before purposes existed, never another purpose', () => {
    expect(ids('SPONSOR', 'PAID')).toEqual(['old-paid']);
    expect(ids('VOLUNTEER', 'FREE')).toEqual(['old-free']);
  });

  test('nothing saved: blank only', () => expect(templatesFor([], 'VENDOR', 'PAID')).toEqual([]));
});
